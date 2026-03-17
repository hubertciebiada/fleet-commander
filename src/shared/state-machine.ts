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
      "Hey team, CI passed on PR #{{PR_NUMBER}} — all checks green. Auto-merge is {{AUTO_MERGE_STATUS}}. Nice work, let's get this merged.",
  },
  {
    id: 'ci_red',
    from: 'ci_pending',
    to: 'ci_failed',
    trigger: 'ci_status_change',
    message:
      "Heads up — CI failed on PR #{{PR_NUMBER}}. Failing checks: {{FAILED_CHECKS}}. That's {{FAIL_COUNT}}/{{MAX_FAILURES}} unique failures before I block you. Look into it and push a fix. What went wrong?",
  },
  {
    id: 'ci_pending',
    from: 'pr_open',
    to: 'ci_pending',
    trigger: 'ci_status_change',
    message:
      'CI is running on PR #{{PR_NUMBER}}. Hold off on pushing more changes until we get results back.',
  },
  {
    id: 'pr_merged',
    from: 'pr_open',
    to: 'done',
    trigger: 'pr_merge',
    message:
      "PR #{{PR_NUMBER}} just merged — great work! Close the issue, clean up after yourselves, and wrap things up.",
  },
  {
    id: 'pr_merged_final',
    from: 'pr_open',
    to: 'done',
    trigger: 'pr_merge_final',
    message:
      'PR #{{PR_NUMBER}} is merged. Wrapping up this session. Thanks for the solid work, team.',
  },
  {
    id: 'ci_blocked',
    from: 'ci_failed',
    to: 'blocked',
    trigger: 'ci_fail_threshold',
    message:
      "STOP. You've hit {{FAIL_COUNT}} unique CI failure types on PR #{{PR_NUMBER}}. I'm blocking you until I review this. Do NOT push more fixes — wait for my instructions.",
  },
];
