// =============================================================================
// Fleet Commander — State Machine Transitions (authoritative definition)
// =============================================================================
// Single source of truth for ALL team lifecycle transitions. Both the API
// routes and the github-poller reference this array. Message templates use
// {{PLACEHOLDER}} syntax; the DB stores user-edited overrides.
// =============================================================================

export type TriggerType = 'hook' | 'timer' | 'poller' | 'pm_action' | 'system';

export interface StateMachineTransition {
  id: string;
  from: string;
  to: string;
  trigger: TriggerType;
  triggerLabel: string;
  description: string;
  condition: string;
  hookEvent?: string | null;
  message?: string;
  /** Placeholder names available for {{PLACEHOLDER}} substitution */
  placeholders?: string[];
}

export interface StateMachineState {
  id: string;
  label: string;
  color: string;
}

/**
 * All possible team states.
 */
export const STATES: StateMachineState[] = [
  { id: 'queued', label: 'Queued', color: '#8B949E' },
  { id: 'launching', label: 'Launching', color: '#58A6FF' },
  { id: 'running', label: 'Running', color: '#3FB950' },
  { id: 'idle', label: 'Idle', color: '#D29922' },
  { id: 'stuck', label: 'Stuck', color: '#F85149' },
  { id: 'done', label: 'Done', color: '#56D4DD' },
  { id: 'failed', label: 'Failed', color: '#F85149' },
];

/**
 * All state machine transitions with optional message templates.
 * Templates use {{PLACEHOLDER}} syntax for variable substitution.
 *
 * This array is the single source of truth. The route layer enriches each
 * transition with any DB-stored template overrides before sending to the UI.
 */
export const STATE_MACHINE_TRANSITIONS: StateMachineTransition[] = [
  // ---- Lifecycle transitions ----
  {
    id: 'queued-launching',
    from: 'queued',
    to: 'launching',
    trigger: 'system',
    triggerLabel: 'Queue processor',
    description: 'Team slot becomes available; next queued team is launched',
    condition: 'Active teams < maxActiveTeams for project',
    hookEvent: null,
  },
  {
    id: 'launching-running',
    from: 'launching',
    to: 'running',
    trigger: 'hook',
    triggerLabel: 'First hook event received',
    description: 'Claude Code process starts and sends its first lifecycle hook',
    condition: 'Process PID is alive and first event arrives',
    hookEvent: 'session_start',
    message:
      'Team {{TEAM_ID}} is now running on issue #{{ISSUE_NUMBER}} ({{ISSUE_TITLE}})',
    placeholders: ['TEAM_ID', 'ISSUE_NUMBER', 'ISSUE_TITLE', 'WORKTREE_NAME'],
  },
  {
    id: 'running-idle',
    from: 'running',
    to: 'idle',
    trigger: 'timer',
    triggerLabel: 'Idle threshold exceeded',
    description: 'No hook events received within the idle threshold period',
    condition: 'lastEventAt + idleThresholdMin < now',
    hookEvent: null,
    message:
      'Team {{TEAM_ID}} has gone idle on issue #{{ISSUE_NUMBER}} (no activity for {{IDLE_MINUTES}} min)',
    placeholders: ['TEAM_ID', 'ISSUE_NUMBER', 'IDLE_MINUTES'],
  },
  {
    id: 'idle-running',
    from: 'idle',
    to: 'running',
    trigger: 'hook',
    triggerLabel: 'Activity resumes',
    description: 'A new hook event is received from the idle team',
    condition: 'New hook event arrives',
    hookEvent: 'tool_use',
  },
  {
    id: 'running-done',
    from: 'running',
    to: 'done',
    trigger: 'hook',
    triggerLabel: 'Session ends successfully',
    description: 'Claude Code session completes normally with exit code 0',
    condition: 'Process exits with code 0 or session_end event',
    hookEvent: 'session_end',
    message:
      'Team {{TEAM_ID}} completed issue #{{ISSUE_NUMBER}}. PR: #{{PR_NUMBER}}',
    placeholders: [
      'TEAM_ID',
      'ISSUE_NUMBER',
      'ISSUE_TITLE',
      'PR_NUMBER',
      'BRANCH_NAME',
    ],
  },
  {
    id: 'idle-stuck',
    from: 'idle',
    to: 'stuck',
    trigger: 'timer',
    triggerLabel: 'Stuck threshold exceeded',
    description: 'Team has been idle beyond the stuck detection threshold',
    condition: 'lastEventAt + stuckThresholdMin < now',
    hookEvent: null,
    message:
      'Team {{TEAM_ID}} is STUCK on issue #{{ISSUE_NUMBER}} (no activity for {{STUCK_MINUTES}} min)',
    placeholders: ['TEAM_ID', 'ISSUE_NUMBER', 'STUCK_MINUTES'],
  },
  {
    id: 'stuck-failed',
    from: 'stuck',
    to: 'failed',
    trigger: 'pm_action',
    triggerLabel: 'PM marks team as failed',
    description: 'PM decides stuck team cannot recover and stops it',
    condition: 'Manual PM action via API',
    hookEvent: null,
    message:
      'Team {{TEAM_ID}} failed on issue #{{ISSUE_NUMBER}}. Reason: stuck and unrecoverable.',
    placeholders: ['TEAM_ID', 'ISSUE_NUMBER', 'ISSUE_TITLE'],
  },
  {
    id: 'stuck-running',
    from: 'stuck',
    to: 'running',
    trigger: 'pm_action',
    triggerLabel: 'PM restarts team',
    description:
      'PM sends a nudge or restarts the team to recover from stuck state',
    condition: 'Manual PM action via API or new hook event',
    hookEvent: null,
  },
  {
    id: 'running-failed',
    from: 'running',
    to: 'failed',
    trigger: 'system',
    triggerLabel: 'Process crash or CI failure limit',
    description:
      'Claude Code process exits with non-zero code or CI failures exceed threshold',
    condition: 'Process exits abnormally or ciFailCount >= maxUniqueCiFailures',
    hookEvent: null,
    message:
      'Team {{TEAM_ID}} failed on issue #{{ISSUE_NUMBER}}. Exit code: {{EXIT_CODE}}',
    placeholders: ['TEAM_ID', 'ISSUE_NUMBER', 'ISSUE_TITLE', 'EXIT_CODE'],
  },
  {
    id: 'launching-failed',
    from: 'launching',
    to: 'failed',
    trigger: 'system',
    triggerLabel: 'Launch failure',
    description: 'Claude Code process fails to start or crashes immediately',
    condition: 'Process exits before first event or spawn error',
    hookEvent: null,
    message:
      'Team {{TEAM_ID}} failed to launch for issue #{{ISSUE_NUMBER}}',
    placeholders: ['TEAM_ID', 'ISSUE_NUMBER', 'ISSUE_TITLE'],
  },
  {
    id: 'idle-done',
    from: 'idle',
    to: 'done',
    trigger: 'poller',
    triggerLabel: 'PR merged detected by poller',
    description:
      'GitHub poller detects PR has been merged while team was idle',
    condition: 'PR state = merged',
    hookEvent: null,
    message:
      'Team {{TEAM_ID}} completed (PR #{{PR_NUMBER}} merged) for issue #{{ISSUE_NUMBER}}',
    placeholders: ['TEAM_ID', 'ISSUE_NUMBER', 'PR_NUMBER'],
  },

  // ---- Poller / CI event transitions (not state changes, but trigger messages) ----
  {
    id: 'ci_green',
    from: 'running',
    to: 'running',
    trigger: 'poller',
    triggerLabel: 'CI green',
    description: 'All CI checks pass on the PR',
    condition: 'CI status changes to success',
    hookEvent: null,
    message:
      'CI passed on PR #{{PR_NUMBER}}, all checks green. Auto-merge is {{AUTO_MERGE_STATUS}}.',
    placeholders: ['PR_NUMBER', 'AUTO_MERGE_STATUS'],
  },
  {
    id: 'ci_red',
    from: 'running',
    to: 'running',
    trigger: 'poller',
    triggerLabel: 'CI red',
    description: 'One or more CI checks fail on the PR',
    condition: 'CI status changes to failure',
    hookEvent: null,
    message:
      'CI failed on PR #{{PR_NUMBER}}. Failing checks: {{FAILED_CHECKS}}. Fix count: {{FAIL_COUNT}}/{{MAX_FAILURES}}. What went wrong?',
    placeholders: ['PR_NUMBER', 'FAILED_CHECKS', 'FAIL_COUNT', 'MAX_FAILURES'],
  },
  {
    id: 'pr_merged',
    from: '*',
    to: 'done',
    trigger: 'poller',
    triggerLabel: 'PR merged',
    description: 'PR has been merged on GitHub',
    condition: 'PR merge event detected',
    hookEvent: null,
    message:
      'PR #{{PR_NUMBER}} merged. Close the issue, clean up, and finish.',
    placeholders: ['PR_NUMBER'],
  },
  {
    id: 'ci_blocked',
    from: '*',
    to: 'stuck',
    trigger: 'poller',
    triggerLabel: 'CI blocked',
    description:
      'Too many unique CI failure types — team cannot self-recover',
    condition: 'Unique CI failure count >= threshold',
    hookEvent: null,
    message:
      'STOP. {{FAIL_COUNT}} unique CI failure types on PR #{{PR_NUMBER}}. Wait for my instructions.',
    placeholders: ['FAIL_COUNT', 'PR_NUMBER'],
  },
];
