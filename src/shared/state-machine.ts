// =============================================================================
// Fleet Commander — State Machine Transitions (placeholder)
// =============================================================================
// This file defines the state machine transitions that drive the team lifecycle.
// A research agent (sm-research) may overwrite this with a full definition.
// For now, it provides enough structure for the message template system to work.
// =============================================================================

export interface StateMachineTransition {
  id: string;
  from: string;
  to: string;
  trigger: string;
  message?: string;
}

/**
 * Default state machine transitions with message templates.
 * Templates use {{PLACEHOLDER}} syntax for variable substitution.
 */
export const STATE_MACHINE_TRANSITIONS: StateMachineTransition[] = [
  {
    id: 'ci_green',
    from: 'ci_pending',
    to: 'ci_passed',
    trigger: 'ci_status_change',
    message:
      'PM here. CI is green on PR #{{PR_NUMBER}} — all checks passed. Auto-merge is {{AUTO_MERGE_STATUS}}. If auto-merge is enabled, the PR should merge automatically. If not, you may want to enable it or merge manually. Good work.',
  },
  {
    id: 'ci_red',
    from: 'ci_pending',
    to: 'ci_failed',
    trigger: 'ci_status_change',
    message:
      'PM here. CI failed on PR #{{PR_NUMBER}}. Failed checks: {{FAILED_CHECKS}}. This is failure {{FAIL_COUNT}} of {{MAX_FAILURES}} unique types before I mark you as blocked. Please investigate and push a fix. Focus on the failing checks first.',
  },
  {
    id: 'ci_pending',
    from: 'pr_open',
    to: 'ci_pending',
    trigger: 'ci_status_change',
    message:
      "PM here. CI is now running on PR #{{PR_NUMBER}}. I'll let you know when results come in. Continue working on other tasks if you have any, or wait for the results.",
  },
  {
    id: 'pr_merged',
    from: 'pr_open',
    to: 'done',
    trigger: 'pr_merge',
    message:
      "PM here. Great news — PR #{{PR_NUMBER}} has been merged successfully. Your work on this issue is complete. Please wrap up any remaining tasks, update the issue status, and prepare to shut down. I'll close this session shortly.",
  },
  {
    id: 'pr_merged_final',
    from: 'pr_open',
    to: 'done',
    trigger: 'pr_merge_final',
    message:
      'PM here. PR #{{PR_NUMBER}} is merged and your work is done. Finishing up this session now. Well done, team.',
  },
  {
    id: 'ci_blocked',
    from: 'ci_failed',
    to: 'blocked',
    trigger: 'ci_fail_threshold',
    message:
      "PM here. I'm marking your team as BLOCKED. You've hit {{FAIL_COUNT}} unique CI failure types on PR #{{PR_NUMBER}}, which exceeds our threshold. I need to review this situation before you continue. Stop pushing fixes and wait for my instructions.",
  },
];
