/**
 * Dashboard Client
 *
 * Communicates with the Claude Fleet Commander dashboard server.
 * The dashboard exposes a simple HTTP API:
 *
 *   GET /api/teams/:team_id/status -> FleetStatusResponse
 *
 * If the dashboard is unreachable, the client falls back to
 * local-only status reconstruction from git + GitHub CLI.
 */

import type { FleetStatusResponse, DashboardError, PrInfo, ChecksSummary } from "./types.js";
import { execSync } from "node:child_process";

const REPO = "itsg-global-agentic/itsg-kea";

export class DashboardClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 5000) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  /**
   * Fetch team status from the dashboard server.
   * Falls back to local reconstruction if dashboard is unreachable.
   */
  async getTeamStatus(teamId: string): Promise<FleetStatusResponse | DashboardError> {
    // Try dashboard first
    try {
      const response = await this.fetchFromDashboard(teamId);
      if (response) return response;
    } catch {
      // Dashboard unreachable — fall through to local
    }

    // Fallback: reconstruct status from local signals + GitHub CLI
    return this.reconstructFromLocal(teamId);
  }

  /**
   * Fetch status from dashboard HTTP API.
   */
  private async fetchFromDashboard(teamId: string): Promise<FleetStatusResponse | null> {
    const url = `${this.baseUrl}/api/teams/${encodeURIComponent(teamId)}/status`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "Accept": "application/json" },
      });

      if (response.status === 404) {
        return null; // Team not found — try local reconstruction
      }

      if (!response.ok) {
        return null;
      }

      return await response.json() as FleetStatusResponse;
    } catch {
      return null; // Network error — try local
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Reconstruct team status from local git state and GitHub CLI.
   * This is the offline/standalone fallback when no dashboard server runs.
   *
   * Data sources:
   * - Issue state: `gh issue view`
   * - PR state: `gh pr list` filtered by branch
   * - CI state: `gh pr checks` or signal files
   * - Team activity: git log timestamps
   * - Workflow state: signal files (.pr-watcher-*)
   */
  private async reconstructFromLocal(teamId: string): Promise<FleetStatusResponse | DashboardError> {
    const issueNumber = this.extractIssueNumber(teamId);
    if (!issueNumber) {
      return {
        error: `Cannot extract issue number from team ID: ${teamId}`,
        code: "TEAM_NOT_FOUND",
        suggestion: "Use format 'kea-{number}', e.g. 'kea-763'",
      };
    }

    // Fetch issue info
    const issue = this.getIssueInfo(issueNumber);
    if (!issue) {
      return {
        error: `Issue #${issueNumber} not found`,
        code: "TEAM_NOT_FOUND",
        suggestion: `Check that issue #${issueNumber} exists in ${REPO}`,
      };
    }

    // Fetch PR info (look for PRs that close this issue)
    const pr = this.getPrInfo(issueNumber);

    // Determine workflow state from signal files and git state
    const workflowState = this.detectWorkflowState(pr);

    // Determine team status
    const status = this.determineStatus(issue, pr, workflowState);

    // Get activity info
    const lastEvent = this.getLastEventTime();
    const durationMinutes = this.getDurationMinutes();

    // Check for PM messages (stored as .fleet-pm-message file)
    const pmMessage = this.getPmMessage();

    return {
      team: teamId,
      issue: {
        number: issueNumber,
        title: issue.title,
        state: issue.state as "open" | "closed",
        labels: issue.labels,
      },
      status,
      duration_minutes: durationMinutes,
      sessions: this.countSessions(),
      last_event: lastEvent,
      pr,
      pm_message: pmMessage,
      cost_usd: 0, // Cannot estimate locally
      workflow_state: workflowState,
    };
  }

  private extractIssueNumber(teamId: string): number | null {
    const match = teamId.match(/kea-(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  private getIssueInfo(issueNumber: number): { title: string; state: string; labels: string[] } | null {
    try {
      const json = execSync(
        `gh issue view ${issueNumber} --repo ${REPO} --json title,state,labels`,
        { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
      );
      const data = JSON.parse(json);
      return {
        title: data.title,
        state: data.state.toLowerCase(),
        labels: (data.labels || []).map((l: { name: string }) => l.name),
      };
    } catch {
      return null;
    }
  }

  private getPrInfo(issueNumber: number): PrInfo | null {
    try {
      // Find PRs that reference this issue
      const json = execSync(
        `gh pr list --repo ${REPO} --state all --search "Closes #${issueNumber}" --json number,state,headRefName,url --limit 5`,
        { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
      );
      const prs = JSON.parse(json) as Array<{
        number: number;
        state: string;
        headRefName: string;
        url: string;
      }>;

      if (prs.length === 0) return null;

      // Take the most recent (first) PR
      const pr = prs[0];
      const prState = pr.state.toLowerCase() as "open" | "closed" | "merged";

      // Get CI checks for open PRs
      let checks: ChecksSummary = { passed: 0, failed: 0, pending: 0 };
      let ciStatus: PrInfo["ci_status"] = "none";
      let autoMerge = false;

      if (prState === "open") {
        try {
          const checksJson = execSync(
            `gh pr view ${pr.number} --repo ${REPO} --json statusCheckRollup,autoMergeRequest`,
            { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
          );
          const checksData = JSON.parse(checksJson);

          autoMerge = checksData.autoMergeRequest !== null;

          const rollup = checksData.statusCheckRollup || [];
          for (const check of rollup) {
            const conclusion = (check.conclusion || "").toLowerCase();
            const status = (check.status || "").toLowerCase();
            if (status === "completed" || status === "success") {
              if (conclusion === "success") checks.passed++;
              else if (conclusion === "failure" || conclusion === "error") checks.failed++;
              else checks.pending++;
            } else {
              checks.pending++;
            }
          }

          if (checks.failed > 0) ciStatus = "failing";
          else if (checks.pending > 0) ciStatus = "pending";
          else if (checks.passed > 0) ciStatus = "passing";
        } catch {
          // Cannot get checks — leave as "none"
        }
      }

      return {
        number: pr.number,
        state: prState === "merged" ? "merged" : prState,
        ci_status: ciStatus,
        checks,
        auto_merge: autoMerge,
        url: pr.url,
      };
    } catch {
      return null;
    }
  }

  private detectWorkflowState(pr: PrInfo | null): string {
    // Check signal files for PR watcher state
    try {
      const hasPrWatcherPr = this.fileExists(".pr-watcher-pr");
      const hasPrWatcherGreen = this.fileExists(".pr-watcher-green");
      const hasPrWatcherRed = this.fileExists(".pr-watcher-red");
      const hasPrWatcherMerged = this.fileExists(".pr-watcher-merged");

      if (hasPrWatcherMerged) return "done";
      if (hasPrWatcherGreen) return "pr:ci-green";
      if (hasPrWatcherRed) return "pr:ci-red";
      if (hasPrWatcherPr) return "pr:watching";
    } catch {
      // Signal files not accessible
    }

    // Infer from PR state
    if (pr) {
      if (pr.state === "merged") return "done";
      if (pr.state === "open") {
        if (pr.ci_status === "failing") return "pr:ci-red";
        if (pr.ci_status === "passing") return "pr:ci-green";
        if (pr.ci_status === "pending") return "pr:ci-pending";
        return "pr";
      }
    }

    // No PR yet — infer from git activity
    return "implementing";
  }

  private determineStatus(
    issue: { state: string },
    pr: PrInfo | null,
    workflowState: string
  ): FleetStatusResponse["status"] {
    if (issue.state === "closed") return "done";
    if (workflowState === "done") return "done";
    if (workflowState.startsWith("pr:ci-red")) return "running"; // Team fixing CI
    if (workflowState.startsWith("pr")) return "running";
    if (workflowState === "implementing") return "running";
    return "running";
  }

  private getLastEventTime(): string {
    try {
      const timestamp = execSync(
        'git log -1 --format="%aI"',
        { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
      ).trim();
      return timestamp || new Date().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  private getDurationMinutes(): number {
    try {
      // Time since first commit on this branch (divergence from refactor/main)
      const firstCommitTime = execSync(
        'git log --reverse --format="%aI" origin/refactor/main..HEAD | head -1',
        { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
      ).trim();
      if (!firstCommitTime) return 0;
      const start = new Date(firstCommitTime).getTime();
      const now = Date.now();
      return Math.round((now - start) / 60000);
    } catch {
      return 0;
    }
  }

  private countSessions(): number {
    // Cannot reliably count sessions locally; return 1 (the calling session)
    return 1;
  }

  private getPmMessage(): string | null {
    try {
      if (this.fileExists(".fleet-pm-message")) {
        return execSync("cat .fleet-pm-message", {
          encoding: "utf-8",
          timeout: 2000,
          stdio: ["pipe", "pipe", "pipe"],
        }).trim() || null;
      }
    } catch {
      // No PM message
    }
    return null;
  }

  private fileExists(filename: string): boolean {
    try {
      execSync(`test -f ${filename}`, {
        timeout: 2000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return true;
    } catch {
      return false;
    }
  }
}
