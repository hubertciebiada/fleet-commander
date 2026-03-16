// =============================================================================
// Claude Fleet Commander — TypeScript Interfaces
// v1: Monitoring multiple Claude Code agent teams working on GitHub issues
// =============================================================================

// ---------------------------------------------------------------------------
// Enums — all state values as union types
// ---------------------------------------------------------------------------

export type BoardStatus = 'Backlog' | 'Ready' | 'InProgress' | 'Done' | 'Blocked';

export type TeamStatus = 'queued' | 'launching' | 'running' | 'idle' | 'stuck' | 'done' | 'failed';

export type TeamPhase = 'analyzing' | 'implementing' | 'reviewing' | 'pr' | 'done' | 'blocked';

export type AgentRole = 'core' | 'conditional';

export type AgentStatus = 'pending' | 'running' | 'idle' | 'done' | 'failed';

export type PRState = 'draft' | 'open' | 'merged' | 'closed';

export type CIStatus = 'none' | 'pending' | 'passing' | 'failing';

export type MergeState = 'unknown' | 'clean' | 'behind' | 'blocked' | 'dirty';

export type SessionStatus = 'active' | 'paused' | 'ended';

export type CommandStatus = 'pending' | 'delivered' | 'failed';

export type EventType =
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'Notification'
  | 'TeammateIdle'
  | 'ToolUse'
  | 'CostUpdate';

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Issue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  boardStatus: BoardStatus;
  parentNumber: number | null;
  children: Issue[];         // populated client-side from parentNumber
  labels: string[];
  htmlUrl: string;
  syncedAt: string;          // ISO 8601
}

export interface Team {
  id: number;
  issueNumber: number;
  worktreeName: string;      // "kea-763"
  branchName: string | null; // "refactor/fix/763-add-tests"
  status: TeamStatus;
  phase: TeamPhase;
  stuckReason: string | null;
  agents: Agent[];
  sessions: Session[];
  pullRequest: PullRequest | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface Session {
  id: number;
  sessionId: string;         // UUID from Claude Code
  teamId: number;
  status: SessionStatus;
  costUsd: number;
  turns: number;
  durationSec: number;
  model: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface Agent {
  id: number;
  teamId: number;
  name: string;              // "coordinator", "csharp-dev", "analityk", etc.
  agentType: string;         // "kea-coordinator", "kea-csharp-dev", etc.
  role: AgentRole;
  status: AgentStatus;
  sessionId: string | null;
  spawnedAt: string | null;
  finishedAt: string | null;
}

export interface PullRequest {
  id: number;
  number: number;
  issueNumber: number;
  teamId: number | null;
  title: string;
  state: PRState;
  ciStatus: CIStatus;
  mergeState: MergeState;
  autoMerge: boolean;
  ciFailCount: number;       // unique failure types; >= 3 means blocked
  htmlUrl: string;
  headBranch: string | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
}

export interface CIRun {
  id: number;
  runId: number;             // GitHub Actions run databaseId
  prNumber: number;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | null;
  checks: CICheck[];
  startedAt: string;
  completedAt: string | null;
}

export interface CICheck {
  name: string;
  state: string;
  bucket: 'pass' | 'fail' | 'pending';
  link?: string;
}

export interface Event {
  id: number;
  teamId: number;
  sessionId: string | null;
  agentName: string | null;
  eventType: EventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Command {
  id: number;
  teamId: number;
  targetAgent: string | null; // null = team-level
  message: string;
  status: CommandStatus;
  createdAt: string;
  deliveredAt: string | null;
}

// ---------------------------------------------------------------------------
// Dashboard aggregate (v_team_dashboard view)
// ---------------------------------------------------------------------------

export interface TeamDashboardRow {
  teamId: number;
  worktreeName: string;
  teamStatus: TeamStatus;
  phase: TeamPhase;
  issueNumber: number;
  issueTitle: string;
  boardStatus: BoardStatus;
  prNumber: number | null;
  prState: PRState | null;
  ciStatus: CIStatus | null;
  mergeState: MergeState | null;
  activeAgents: number;
  activeSessions: number;
  totalCostUsd: number;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StuckCandidate {
  teamId: number;
  worktreeName: string;
  status: TeamStatus;
  phase: TeamPhase;
  issueNumber: number;
  issueTitle: string;
  lastEventAt: string | null;
  minutesSinceLastEvent: number;
}

export interface CostByIssue {
  number: number;
  title: string;
  boardStatus: BoardStatus;
  teamCount: number;
  sessionCount: number;
  totalCostUsd: number;
  totalTurns: number;
  totalDurationSec: number;
}
