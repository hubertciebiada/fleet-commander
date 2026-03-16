// =============================================================================
// Fleet Commander — Team Manager Service (Spawn / Stop / Resume)
// =============================================================================
// Manages Claude Code agent processes: creates git worktrees, copies hooks,
// spawns child processes, captures output, and handles lifecycle transitions.
//
// Per-project: launch() accepts a projectId and resolves repo path, github
// repo, and worktree naming from the project record in the database.
// =============================================================================

import { spawn, execSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import config from '../config.js';
import { getDatabase } from '../db.js';
import { sseBroker } from './sse-broker.js';
import { findGitBash } from '../utils/find-git-bash.js';
import type { Team } from '../../shared/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_OUTPUT_LINES = config.outputBufferLines;

// ---------------------------------------------------------------------------
// Output buffer: circular array of last N lines per team
// ---------------------------------------------------------------------------

interface OutputBuffer {
  lines: string[];
}

// ---------------------------------------------------------------------------
// TeamManager
// ---------------------------------------------------------------------------

export class TeamManager {
  private outputBuffers: Map<number, OutputBuffer> = new Map();
  private childProcesses: Map<number, ChildProcess> = new Map();

  // -------------------------------------------------------------------------
  // launch — create worktree, copy hooks, spawn Claude Code
  // -------------------------------------------------------------------------

  async launch(
    projectId: number,
    issueNumber: number,
    issueTitle?: string,
    prompt?: string,
    headless?: boolean,
  ): Promise<Team> {
    const db = getDatabase();

    // Look up project to get repo_path, github_repo, name
    const project = db.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    console.log(`[TeamManager] Launch started: project=${project.name} issue=#${issueNumber}`);

    // If no title provided, fetch from GitHub
    if (!issueTitle && project.githubRepo) {
      try {
        const result = execSync(
          `gh issue view ${issueNumber} --repo ${project.githubRepo} --json title --jq .title`,
          { encoding: 'utf-8', timeout: 10000 },
        ).trim();
        if (result) {
          issueTitle = result;
          console.log(`[TeamManager] Fetched issue title from GitHub: "${issueTitle}"`);
        }
      } catch {
        // GitHub fetch failed, use fallback
        issueTitle = `Issue #${issueNumber}`;
        console.log(`[TeamManager] GitHub title fetch failed, using fallback: "${issueTitle}"`);
      }
    } else if (!issueTitle) {
      issueTitle = `Issue #${issueNumber}`;
    }

    // Derive a slug from project name (lowercase, alphanumeric + hyphens)
    const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const worktreeName = `${slug}-${issueNumber}`;
    const branchName = `worktree-${slug}-${issueNumber}`;
    const worktreeRelPath = path.posix.join(config.worktreeDir, worktreeName);
    const worktreeAbsPath = path.join(project.repoPath, config.worktreeDir, worktreeName);

    // Check if a team already exists for this worktree name
    const existing = db.getTeamByWorktree(worktreeName);
    let relaunchTeamId: number | null = null;

    if (existing) {
      if (['running', 'launching', 'idle', 'stuck', 'queued'].includes(existing.status)) {
        throw new Error(`Team already active for issue ${issueNumber} (status: ${existing.status})`);
      }
      // Terminal state (done/failed) — reuse the existing team record
      relaunchTeamId = existing.id;
    }

    // ── Step 1: Insert or reuse team record in DB (status: queued) ──
    // Team appears in FleetGrid immediately at this point.
    const now = new Date().toISOString();
    let team: Team;

    if (relaunchTeamId !== null) {
      // Relaunch: reset the existing terminal team record
      console.log(`[TeamManager] Relaunching existing team record: id=${relaunchTeamId}, worktree=${worktreeName}`);
      db.updateTeam(relaunchTeamId, {
        status: 'queued',
        phase: 'init',
        pid: null,
        sessionId: null,
        issueTitle: issueTitle ?? null,
        launchedAt: now,
        stoppedAt: null,
        lastEventAt: null,
      });
      team = db.getTeam(relaunchTeamId)!;
    } else {
      // Fresh launch: insert new team record
      console.log(`[TeamManager] Inserting team record: worktree=${worktreeName}, branch=${branchName}`);
      team = db.insertTeam({
        projectId,
        issueNumber,
        issueTitle: issueTitle ?? null,
        worktreeName,
        branchName,
        status: 'queued',
        phase: 'init',
        launchedAt: now,
      });
    }

    console.log(`[TeamManager] Team queued: id=${team.id}, status=queued, relaunch=${relaunchTeamId !== null}`);

    // Broadcast immediately so the team appears in the grid right away
    this.broadcastSnapshot();

    // ── Step 2: Create git worktree in the PROJECT's repo ──
    if (!fs.existsSync(worktreeAbsPath)) {
      try {
        execSync(
          `git -C "${project.repoPath}" worktree add "${worktreeRelPath}" -b "${branchName}"`,
          { encoding: 'utf-8', stdio: 'pipe' },
        );
      } catch (err: unknown) {
        // Branch may already exist — try without -b
        try {
          execSync(
            `git -C "${project.repoPath}" worktree add "${worktreeRelPath}" "${branchName}"`,
            { encoding: 'utf-8', stdio: 'pipe' },
          );
        } catch (err2: unknown) {
          const msg = err2 instanceof Error ? err2.message : String(err2);
          console.error(`[TeamManager] ERROR: Worktree creation failed for team ${team.id}: ${msg}`);
          db.updateTeam(team.id, { status: 'failed', stoppedAt: new Date().toISOString() });
          this.broadcastSnapshot();
          throw new Error(`Failed to create worktree: ${msg}`);
        }
      }
    }

    console.log(`[TeamManager] Worktree created: ${worktreeName} at ${worktreeAbsPath}`);

    // Update team status to launching now that worktree exists
    db.updateTeam(team.id, { status: 'launching' });
    this.broadcastSnapshot();

    // ── Step 3: Copy hook scripts from FC's own hooks/ directory into worktree ──
    const hookSrcDir = config.fcHooksDir;
    const hookDestDir = path.join(worktreeAbsPath, config.hookDir);

    fs.mkdirSync(hookDestDir, { recursive: true });

    if (fs.existsSync(hookSrcDir)) {
      const hookFiles = fs.readdirSync(hookSrcDir).filter(
        (f) => f.endsWith('.sh'),
      );
      for (const file of hookFiles) {
        const src = path.join(hookSrcDir, file);
        const dest = path.join(hookDestDir, file);
        fs.copyFileSync(src, dest);
        // Ensure executable on Unix
        if (process.platform !== 'win32') {
          fs.chmodSync(dest, 0o755);
        }
      }
    }

    console.log(`[TeamManager] Hooks copied to worktree`);

    // Generate settings.json from example
    const settingsExamplePath = path.join(hookSrcDir, 'settings.json.example');
    const settingsDestDir = path.join(worktreeAbsPath, '.claude');
    const settingsDestPath = path.join(settingsDestDir, 'settings.json');

    fs.mkdirSync(settingsDestDir, { recursive: true });

    if (fs.existsSync(settingsExamplePath)) {
      fs.copyFileSync(settingsExamplePath, settingsDestPath);
    }

    // ── Step 4: Spawn Claude Code process ──
    const resolvedPrompt = prompt || `${config.defaultPrompt} ${issueNumber}`;
    const args = ['--worktree', worktreeName, resolvedPrompt];

    if (config.skipPermissions) {
      args.unshift('--dangerously-skip-permissions');
    }

    // Build spawn environment — inherit everything from the server process
    // and auto-detect Git Bash so Claude Code can find it on Windows.
    const spawnEnv: Record<string, string | undefined> = {
      ...process.env,
      FLEET_TEAM_ID: worktreeName,
      FLEET_PROJECT_ID: String(projectId),
      FLEET_GITHUB_REPO: project.githubRepo ?? '',
    };
    const gitBash = findGitBash();
    if (gitBash) {
      spawnEnv['CLAUDE_CODE_GIT_BASH_PATH'] = gitBash;
      console.log(`[TeamManager] CLAUDE_CODE_GIT_BASH_PATH=${gitBash}`);
    }

    // Resolve headless flag — default to true if not specified
    const isHeadless = headless !== false;

    console.log(`[TeamManager] Spawning: ${config.claudeCmd} ${args.join(' ')} (headless=${isHeadless})`);

    if (!isHeadless && process.platform === 'win32') {
      // ── Interactive mode (Windows): open Claude Code in a new terminal window ──
      const fullCmd = `${config.claudeCmd} ${args.join(' ')}`;
      const windowTitle = `Team ${worktreeName}`;
      const interactiveChild = spawn(
        'cmd.exe',
        ['/c', 'start', `"${windowTitle}"`, 'cmd.exe', '/k', `cd /d "${worktreeAbsPath}" && ${fullCmd}`],
        {
          env: spawnEnv,
          shell: false,
          detached: true,
          stdio: 'ignore',
        },
      );
      interactiveChild.unref();

      console.log(`[TeamManager] Interactive window opened for team ${team.id} (worktree: ${worktreeName})`);

      // We can't capture output or PID in interactive mode (the `start` command
      // creates a separate process tree), but hooks still POST to the server
      // independently so phase transitions and events will still work.
      db.updateTeam(team.id, { status: 'running' });
      this.broadcastSnapshot();

      // Broadcast launch event
      sseBroker.broadcast(
        'team_launched',
        { team_id: team.id, issue_number: issueNumber, project_id: projectId },
        team.id,
      );

      return db.getTeam(team.id)!;
    }

    // ── Headless mode (default): spawn in background, capture output ──
    const child = spawn(config.claudeCmd, args, {
      cwd: project.repoPath,
      env: spawnEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      // On Windows, use shell so cmd.exe resolves commands in PATH
      shell: process.platform === 'win32',
      // Detach so parent can exit without killing children (if needed)
      detached: false,
    });

    const pid = child.pid;
    if (pid === undefined) {
      console.error(`[TeamManager] ERROR: spawn failed for team ${team.id}: no PID returned`);
      db.updateTeam(team.id, { status: 'failed', stoppedAt: new Date().toISOString() });
      this.broadcastSnapshot();
      throw new Error('Failed to spawn Claude Code process — no PID returned');
    }

    console.log(`[TeamManager] Process spawned: PID ${pid}`);

    // Update team with PID (status stays 'launching' until first event)
    db.updateTeam(team.id, { pid });
    this.broadcastSnapshot();

    // Store child process reference
    this.childProcesses.set(team.id, child);

    // Set up output capture
    this.initOutputBuffer(team.id);
    this.captureOutput(team.id, child);

    // Handle process exit
    child.on('exit', (code, signal) => {
      console.log(`[TeamManager] Process exited for team ${team.id} (code=${code}, signal=${signal})`);
      this.childProcesses.delete(team.id);

      const currentTeam = db.getTeam(team.id);
      if (!currentTeam) return;

      // Only update status if team is still in an active state
      if (['launching', 'running', 'idle', 'stuck'].includes(currentTeam.status)) {
        const exitStatus = (code === 0) ? 'done' : 'failed';
        db.updateTeam(team.id, {
          status: exitStatus,
          pid: null,
          stoppedAt: new Date().toISOString(),
        });

        sseBroker.broadcast(
          'team_stopped',
          { team_id: team.id },
          team.id,
        );

        this.broadcastSnapshot();
      }
    });

    child.on('error', (err) => {
      console.error(`[TeamManager] ERROR: process error for team ${team.id}:`, err.message);
      this.childProcesses.delete(team.id);

      const currentTeam = db.getTeam(team.id);
      if (!currentTeam) return;

      if (['launching', 'running', 'idle', 'stuck'].includes(currentTeam.status)) {
        db.updateTeam(team.id, {
          status: 'failed',
          pid: null,
          stoppedAt: new Date().toISOString(),
        });

        sseBroker.broadcast(
          'team_stopped',
          { team_id: team.id },
          team.id,
        );

        this.broadcastSnapshot();
      }
    });

    // Broadcast launch event
    sseBroker.broadcast(
      'team_launched',
      { team_id: team.id, issue_number: issueNumber, project_id: projectId },
      team.id,
    );

    // Return fresh team record
    return db.getTeam(team.id)!;
  }

  // -------------------------------------------------------------------------
  // stop — kill process tree
  // -------------------------------------------------------------------------

  async stop(teamId: number): Promise<Team> {
    const db = getDatabase();
    const team = db.getTeam(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    if (team.pid) {
      this.killProcess(team.pid);
    }

    // Clean up child process reference
    this.childProcesses.delete(teamId);

    const updated = db.updateTeam(teamId, {
      status: 'done',
      pid: null,
      stoppedAt: new Date().toISOString(),
    });

    sseBroker.broadcast(
      'team_stopped',
      { team_id: teamId },
      teamId,
    );

    this.broadcastSnapshot();

    return updated!;
  }

  // -------------------------------------------------------------------------
  // resume — re-spawn with --resume flag in existing worktree
  // -------------------------------------------------------------------------

  async resume(teamId: number): Promise<Team> {
    const db = getDatabase();
    const team = db.getTeam(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    // Resolve project for repo path
    const project = team.projectId ? db.getProject(team.projectId) : undefined;
    if (!project) {
      throw new Error(`Project for team ${teamId} not found (projectId: ${team.projectId})`);
    }

    // Verify worktree still exists
    const worktreeAbsPath = path.join(
      project.repoPath, config.worktreeDir, team.worktreeName,
    );
    if (!fs.existsSync(worktreeAbsPath)) {
      throw new Error(`Worktree ${team.worktreeName} no longer exists at ${worktreeAbsPath}`);
    }

    // Build args with --resume
    const args = ['--resume', '--worktree', team.worktreeName];

    if (config.skipPermissions) {
      args.unshift('--dangerously-skip-permissions');
    }

    // Update status to launching
    db.updateTeam(teamId, {
      status: 'launching',
      launchedAt: new Date().toISOString(),
      stoppedAt: null,
    });

    // Build spawn environment with Git Bash auto-detection (same as launch)
    const resumeEnv: Record<string, string | undefined> = {
      ...process.env,
      FLEET_TEAM_ID: team.worktreeName,
      FLEET_PROJECT_ID: String(project.id),
      FLEET_GITHUB_REPO: project.githubRepo ?? '',
    };
    const resumeGitBash = findGitBash();
    if (resumeGitBash) {
      resumeEnv['CLAUDE_CODE_GIT_BASH_PATH'] = resumeGitBash;
      console.log(`[TeamManager] Resume: CLAUDE_CODE_GIT_BASH_PATH=${resumeGitBash}`);
    }

    const child = spawn(config.claudeCmd, args, {
      cwd: project.repoPath,
      env: resumeEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      detached: false,
    });

    const pid = child.pid;
    if (pid === undefined) {
      db.updateTeam(teamId, { status: 'failed', stoppedAt: new Date().toISOString() });
      throw new Error('Failed to spawn Claude Code process — no PID returned');
    }

    db.updateTeam(teamId, { pid });

    // Store child process reference
    this.childProcesses.set(teamId, child);

    // Set up output capture
    this.initOutputBuffer(teamId);
    this.captureOutput(teamId, child);

    // Handle process exit
    child.on('exit', (code, _signal) => {
      console.log(`[TeamManager] Resume process exited for team ${teamId} (code=${code})`);
      this.childProcesses.delete(teamId);

      const currentTeam = db.getTeam(teamId);
      if (!currentTeam) return;

      if (['launching', 'running', 'idle', 'stuck'].includes(currentTeam.status)) {
        const exitStatus = (code === 0) ? 'done' : 'failed';
        db.updateTeam(teamId, {
          status: exitStatus,
          pid: null,
          stoppedAt: new Date().toISOString(),
        });

        sseBroker.broadcast('team_stopped', { team_id: teamId }, teamId);
        this.broadcastSnapshot();
      }
    });

    child.on('error', (err) => {
      console.error(`[TeamManager] Resume process error for team ${teamId}:`, err);
      this.childProcesses.delete(teamId);

      const currentTeam = db.getTeam(teamId);
      if (!currentTeam) return;

      if (['launching', 'running', 'idle', 'stuck'].includes(currentTeam.status)) {
        db.updateTeam(teamId, {
          status: 'failed',
          pid: null,
          stoppedAt: new Date().toISOString(),
        });

        sseBroker.broadcast('team_stopped', { team_id: teamId }, teamId);
        this.broadcastSnapshot();
      }
    });

    // Broadcast launch event
    sseBroker.broadcast(
      'team_launched',
      { team_id: teamId, issue_number: team.issueNumber },
      teamId,
    );

    // Broadcast full snapshot so all SSE clients refresh their team list
    this.broadcastSnapshot();

    return db.getTeam(teamId)!;
  }

  // -------------------------------------------------------------------------
  // restart — stop then launch
  // -------------------------------------------------------------------------

  async restart(teamId: number, prompt?: string): Promise<Team> {
    const db = getDatabase();
    const team = db.getTeam(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    // Stop if running
    if (team.pid && ['launching', 'running', 'idle', 'stuck'].includes(team.status)) {
      await this.stop(teamId);
    }

    // Re-launch with the team's project
    const projectId = team.projectId;
    if (!projectId) {
      throw new Error(`Team ${teamId} has no projectId — cannot restart`);
    }

    return this.launch(projectId, team.issueNumber, team.issueTitle ?? undefined, prompt);
  }

  // -------------------------------------------------------------------------
  // stopAll — stop all running teams
  // -------------------------------------------------------------------------

  async stopAll(): Promise<Team[]> {
    const db = getDatabase();
    const activeTeams = db.getActiveTeams();
    const results: Team[] = [];

    for (const team of activeTeams) {
      try {
        const stopped = await this.stop(team.id);
        results.push(stopped);
      } catch {
        // Log but continue stopping other teams
        results.push(team);
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // getOutput — return rolling buffer content
  // -------------------------------------------------------------------------

  getOutput(teamId: number, lines?: number): string[] {
    const buffer = this.outputBuffers.get(teamId);
    if (!buffer) {
      return [];
    }

    if (lines && lines > 0 && lines < buffer.lines.length) {
      return buffer.lines.slice(-lines);
    }

    return [...buffer.lines];
  }

  // -------------------------------------------------------------------------
  // launchBatch — launch multiple teams with optional stagger delay
  // -------------------------------------------------------------------------

  async launchBatch(
    projectId: number,
    issues: Array<{ number: number; title?: string }>,
    prompt?: string,
    delayMs?: number,
    headless?: boolean,
  ): Promise<Team[]> {
    const results: Team[] = [];
    const delay = delayMs ?? 2000; // default 2-second stagger

    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i]!;
      try {
        const team = await this.launch(projectId, issue.number, issue.title, prompt, headless);
        results.push(team);
      } catch (err: unknown) {
        // Push a synthetic error indicator — don't stop the batch
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Batch launch failed at issue #${issue.number} (${i + 1}/${issues.length}): ${msg}. ` +
          `Successfully launched: ${results.length}`,
        );
      }

      // Stagger delay between launches (skip after last)
      if (i < issues.length - 1 && delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Broadcast a full team dashboard snapshot to all SSE clients.
   * Called after any team state change so the Fleet Grid refreshes.
   */
  private broadcastSnapshot(): void {
    try {
      const db = getDatabase();
      const dashboard = db.getTeamDashboard();
      sseBroker.broadcast('snapshot', { teams: dashboard });
    } catch (err) {
      console.error('[TeamManager] Failed to broadcast snapshot:', err);
    }
  }

  private initOutputBuffer(teamId: number): void {
    this.outputBuffers.set(teamId, { lines: [] });
  }

  private captureOutput(teamId: number, child: ChildProcess): void {
    const buffer = this.outputBuffers.get(teamId);
    if (!buffer) return;

    // Resolve the worktree name for log prefixes
    const db = getDatabase();
    const team = db.getTeam(teamId);
    const logPrefix = team ? team.worktreeName : `team-${teamId}`;

    const handleData = (stream: string) => (data: Buffer) => {
      const text = data.toString('utf-8');
      // Log every chunk to server console for debugging
      for (const line of text.split('\n')) {
        if (line.trim()) {
          console.log(`[CC:${logPrefix}:${stream}] ${line}`);
        }
      }

      const newLines = text.split('\n');

      for (const line of newLines) {
        // Skip empty trailing line from split
        if (line === '' && newLines.indexOf(line) === newLines.length - 1) continue;
        buffer.lines.push(line);

        // Trim to max
        while (buffer.lines.length > MAX_OUTPUT_LINES) {
          buffer.lines.shift();
        }
      }
    };

    if (child.stdout) {
      child.stdout.on('data', handleData('stdout'));
    }
    if (child.stderr) {
      child.stderr.on('data', handleData('stderr'));
    }
  }

  private killProcess(pid: number): void {
    try {
      if (process.platform === 'win32') {
        // On Windows, use taskkill to kill the entire process tree
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'pipe' });
      } else {
        // On Unix, send SIGTERM
        process.kill(pid, 'SIGTERM');
      }
    } catch {
      // Process may have already exited — ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: TeamManager | null = null;

export function getTeamManager(): TeamManager {
  if (!_instance) {
    _instance = new TeamManager();
  }
  return _instance;
}

export default TeamManager;
