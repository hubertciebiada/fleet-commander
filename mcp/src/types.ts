/**
 * Fleet Status MCP Server — Type Definitions
 *
 * These types define the contract between the MCP server and the dashboard.
 * The MCP server is a thin proxy: it forwards requests to the dashboard HTTP API
 * and returns the response to the calling agent.
 */

// ─── Team Status (as seen by the dashboard) ───────────────────────────

export type TeamStatus =
  | "queued"     // Issue assigned, team not yet spawned
  | "launching"  // Team spawned, agents starting up
  | "running"    // Agents actively working (commits, messages flowing)
  | "stuck"      // No activity for >10 minutes while issue still open
  | "idle"       // Agents alive but no recent activity (5-10 min)
  | "done"       // Issue closed, PR merged
  | "failed";    // Blocked state or too many CI failures

// ─── CI Check Summary ─────────────────────────────────────────────────

export interface ChecksSummary {
  passed: number;
  failed: number;
  pending: number;
}

// ─── PR Info ──────────────────────────────────────────────────────────

export interface PrInfo {
  number: number;
  state: "open" | "closed" | "merged";
  ci_status: "passing" | "failing" | "pending" | "none";
  checks: ChecksSummary;
  auto_merge: boolean;
  url: string;
}

// ─── Issue Info ───────────────────────────────────────────────────────

export interface IssueInfo {
  number: number;
  title: string;
  state: "open" | "closed";
  labels: string[];
}

// ─── Fleet Status Response ────────────────────────────────────────────

export interface FleetStatusResponse {
  team: string;                   // e.g. "kea-763"
  issue: IssueInfo;
  status: TeamStatus;
  duration_minutes: number;       // How long the team has been active
  sessions: number;               // Number of active agent sessions
  last_event: string;             // ISO 8601 timestamp of last activity
  pr: PrInfo | null;              // null if no PR created yet
  pm_message: string | null;      // Message from PM/dashboard to the team
  cost_usd: number;               // Estimated cost so far
  workflow_state: string;         // Current state in the coordinator FSM
}

// ─── Dashboard API Error ──────────────────────────────────────────────

export interface DashboardError {
  error: string;
  code: "TEAM_NOT_FOUND" | "DASHBOARD_UNREACHABLE" | "INTERNAL_ERROR";
  suggestion: string;
}

// ─── Tool Input ───────────────────────────────────────────────────────

export interface FleetStatusInput {
  team_id?: string;  // e.g. "kea-763" — optional, auto-detected from worktree
}
