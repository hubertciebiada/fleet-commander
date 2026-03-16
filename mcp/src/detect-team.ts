/**
 * Team Auto-Detection
 *
 * Detects the team ID from the current working directory.
 * Teams work in worktrees at `.claude/worktrees/kea-{N}/` or `../kea-{N}/`.
 * The team ID is derived from the worktree directory name.
 *
 * Detection order:
 * 1. Explicit team_id parameter (if provided)
 * 2. Git branch name: `worktree-kea-{N}` or `refactor/{cat}/{N}-{desc}`
 * 3. Current directory path: `.../kea-{N}/...`
 * 4. Environment variable: FLEET_TEAM_ID
 */

import { execSync } from "node:child_process";
import path from "node:path";

/**
 * Extract team ID from a git branch name.
 *
 * Patterns:
 * - `worktree-kea-763` -> `kea-763`
 * - `refactor/fix/763-add-tests` -> `kea-763`
 */
function fromBranch(branch: string): string | null {
  // worktree-kea-{N}
  const worktreeMatch = branch.match(/worktree-kea-(\d+)/);
  if (worktreeMatch) return `kea-${worktreeMatch[1]}`;

  // refactor/{cat}/{N}-{desc}
  const refactorMatch = branch.match(/refactor\/\w+\/(\d+)/);
  if (refactorMatch) return `kea-${refactorMatch[1]}`;

  return null;
}

/**
 * Extract team ID from a directory path.
 *
 * Patterns:
 * - `.../kea-763/...` -> `kea-763`
 * - `.../worktrees/kea-763/...` -> `kea-763`
 */
function fromPath(dir: string): string | null {
  const normalized = dir.replace(/\\/g, "/");
  const match = normalized.match(/kea-(\d+)/);
  if (match) return `kea-${match[1]}`;
  return null;
}

/**
 * Detect the team ID using all available signals.
 */
export function detectTeamId(explicitId?: string): string | null {
  // 1. Explicit parameter
  if (explicitId) return explicitId;

  // 2. Git branch
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const fromBranchResult = fromBranch(branch);
    if (fromBranchResult) return fromBranchResult;
  } catch {
    // Git not available or not in a repo — continue
  }

  // 3. Current directory
  const cwd = process.cwd();
  const fromPathResult = fromPath(cwd);
  if (fromPathResult) return fromPathResult;

  // 4. Environment variable
  const envTeamId = process.env.FLEET_TEAM_ID;
  if (envTeamId) return envTeamId;

  return null;
}
