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
      '[Fleet Commander] CI GREEN — All checks passed on PR #{{PR_NUMBER}}. Auto-merge is {{AUTO_MERGE_STATUS}}.',
  },
  {
    id: 'ci_red',
    from: 'ci_pending',
    to: 'ci_failed',
    trigger: 'ci_status_change',
    message:
      '[Fleet Commander] CI RED — Failed checks on PR #{{PR_NUMBER}}: {{FAILED_CHECKS}}. Fix count: {{FAIL_COUNT}}/{{MAX_FAILURES}} unique failures before blocked.',
  },
  {
    id: 'ci_pending',
    from: 'pr_open',
    to: 'ci_pending',
    trigger: 'ci_status_change',
    message: '[Fleet Commander] CI running on PR #{{PR_NUMBER}}...',
  },
  {
    id: 'pr_merged',
    from: 'pr_open',
    to: 'done',
    trigger: 'pr_merge',
    message:
      '[Fleet Commander] PR #{{PR_NUMBER}} MERGED — Your work is complete. You may finish up and exit.',
  },
  {
    id: 'pr_merged_final',
    from: 'pr_open',
    to: 'done',
    trigger: 'pr_merge_final',
    message:
      '[Fleet Commander] PR #{{PR_NUMBER}} merged successfully. Issue work is complete. Please finish up — this session will close shortly.',
  },
  {
    id: 'ci_blocked',
    from: 'ci_failed',
    to: 'blocked',
    trigger: 'ci_fail_threshold',
    message:
      '[Fleet Commander] BLOCKED — {{FAIL_COUNT}} unique CI failure types on PR #{{PR_NUMBER}}. Human intervention needed.',
  },
];
