// =============================================================================
// Fleet Commander — resolveMessage() Tests
// =============================================================================
// Tests for the message template resolver that reads templates from the DB,
// substitutes {{PLACEHOLDER}} variables, and respects the enabled flag.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before import
// ---------------------------------------------------------------------------

const mockDb = {
  getMessageTemplate: vi.fn(),
};

vi.mock('../../src/server/db.js', () => ({
  getDatabase: () => mockDb,
}));

// Import after mocks are set up
const { resolveMessage } = await import('../../src/server/utils/resolve-message.js');

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Basic placeholder substitution
// =============================================================================

describe('Placeholder substitution', () => {
  it('substitutes a single placeholder', () => {
    mockDb.getMessageTemplate.mockReturnValue({
      id: 'ci_green',
      template: 'CI passed on PR #{{PR_NUMBER}}.',
      enabled: true,
    });

    const result = resolveMessage('ci_green', { PR_NUMBER: '42' });
    expect(result).toBe('CI passed on PR #42.');
  });

  it('substitutes multiple placeholders', () => {
    mockDb.getMessageTemplate.mockReturnValue({
      id: 'ci_red',
      template: 'CI failed on PR #{{PR_NUMBER}}. Fails: {{FAIL_COUNT}}/{{MAX_FAILURES}}.',
      enabled: true,
    });

    const result = resolveMessage('ci_red', {
      PR_NUMBER: '99',
      FAIL_COUNT: '2',
      MAX_FAILURES: '3',
    });
    expect(result).toBe('CI failed on PR #99. Fails: 2/3.');
  });

  it('substitutes all occurrences of the same placeholder', () => {
    mockDb.getMessageTemplate.mockReturnValue({
      id: 'test',
      template: 'Issue #{{NUM}} is about #{{NUM}} again.',
      enabled: true,
    });

    const result = resolveMessage('test', { NUM: '7' });
    expect(result).toBe('Issue #7 is about #7 again.');
  });

  it('leaves unreferenced placeholders in vars without error', () => {
    mockDb.getMessageTemplate.mockReturnValue({
      id: 'simple',
      template: 'Hello {{NAME}}.',
      enabled: true,
    });

    const result = resolveMessage('simple', { NAME: 'World', EXTRA: 'unused' });
    expect(result).toBe('Hello World.');
  });
});

// =============================================================================
// Missing placeholders
// =============================================================================

describe('Missing placeholder handling', () => {
  it('leaves unresolved placeholders in the output when vars are missing', () => {
    mockDb.getMessageTemplate.mockReturnValue({
      id: 'partial',
      template: 'PR #{{PR_NUMBER}} by {{AUTHOR}}.',
      enabled: true,
    });

    const result = resolveMessage('partial', { PR_NUMBER: '10' });
    // {{AUTHOR}} was not provided — left as-is
    expect(result).toBe('PR #10 by {{AUTHOR}}.');
  });

  it('returns template as-is when vars is empty', () => {
    mockDb.getMessageTemplate.mockReturnValue({
      id: 'no_vars',
      template: 'Static message with {{PLACEHOLDER}}.',
      enabled: true,
    });

    const result = resolveMessage('no_vars', {});
    expect(result).toBe('Static message with {{PLACEHOLDER}}.');
  });
});

// =============================================================================
// Template enabled/disabled
// =============================================================================

describe('Template enabled/disabled', () => {
  it('returns null when template is disabled', () => {
    mockDb.getMessageTemplate.mockReturnValue({
      id: 'ci_green',
      template: 'CI passed.',
      enabled: false,
    });

    const result = resolveMessage('ci_green', { PR_NUMBER: '1' });
    expect(result).toBeNull();
  });

  it('returns the resolved message when template is enabled', () => {
    mockDb.getMessageTemplate.mockReturnValue({
      id: 'ci_green',
      template: 'CI passed on PR #{{PR_NUMBER}}.',
      enabled: true,
    });

    const result = resolveMessage('ci_green', { PR_NUMBER: '1' });
    expect(result).toBe('CI passed on PR #1.');
  });
});

// =============================================================================
// Template not found
// =============================================================================

describe('Template not found', () => {
  it('returns null when template ID does not exist', () => {
    mockDb.getMessageTemplate.mockReturnValue(undefined);

    const result = resolveMessage('nonexistent', { KEY: 'value' });
    expect(result).toBeNull();
  });

  it('returns null when getMessageTemplate returns null', () => {
    mockDb.getMessageTemplate.mockReturnValue(null);

    const result = resolveMessage('also_missing', {});
    expect(result).toBeNull();
  });
});

// =============================================================================
// BASE_BRANCH placeholder
// =============================================================================

describe('BASE_BRANCH placeholder', () => {
  it('substitutes BASE_BRANCH with main', () => {
    mockDb.getMessageTemplate.mockReturnValue({
      id: 'branch_behind',
      template:
        'Your PR #{{PR_NUMBER}} is behind {{BASE_BRANCH}}. Please rebase onto origin/{{BASE_BRANCH}} and force-push: `git fetch origin {{BASE_BRANCH}} && git rebase origin/{{BASE_BRANCH}} && git push --force-with-lease`.',
      enabled: true,
    });

    const result = resolveMessage('branch_behind', {
      PR_NUMBER: '42',
      BASE_BRANCH: 'main',
    });
    expect(result).toBe(
      'Your PR #42 is behind main. Please rebase onto origin/main and force-push: `git fetch origin main && git rebase origin/main && git push --force-with-lease`.',
    );
  });

  it('substitutes BASE_BRANCH with a non-main branch', () => {
    mockDb.getMessageTemplate.mockReturnValue({
      id: 'branch_behind',
      template:
        'Your PR #{{PR_NUMBER}} is behind {{BASE_BRANCH}}. Please rebase onto origin/{{BASE_BRANCH}} and force-push: `git fetch origin {{BASE_BRANCH}} && git rebase origin/{{BASE_BRANCH}} && git push --force-with-lease`.',
      enabled: true,
    });

    const result = resolveMessage('branch_behind', {
      PR_NUMBER: '99',
      BASE_BRANCH: 'develop',
    });
    expect(result).toBe(
      'Your PR #99 is behind develop. Please rebase onto origin/develop and force-push: `git fetch origin develop && git rebase origin/develop && git push --force-with-lease`.',
    );
  });

  it('substitutes BASE_BRANCH in branch_behind_resolved template', () => {
    mockDb.getMessageTemplate.mockReturnValue({
      id: 'branch_behind_resolved',
      template:
        'Your PR #{{PR_NUMBER}} branch is now up-to-date with {{BASE_BRANCH}}. No rebase needed.',
      enabled: true,
    });

    const result = resolveMessage('branch_behind_resolved', {
      PR_NUMBER: '55',
      BASE_BRANCH: 'staging',
    });
    expect(result).toBe(
      'Your PR #55 branch is now up-to-date with staging. No rebase needed.',
    );
  });
});

// =============================================================================
// DB lookup
// =============================================================================

describe('DB template lookup', () => {
  it('calls getMessageTemplate with the correct template ID', () => {
    mockDb.getMessageTemplate.mockReturnValue({
      id: 'idle_nudge',
      template: 'Idle for {{IDLE_MINUTES}} min.',
      enabled: true,
    });

    resolveMessage('idle_nudge', { IDLE_MINUTES: '5' });

    expect(mockDb.getMessageTemplate).toHaveBeenCalledTimes(1);
    expect(mockDb.getMessageTemplate).toHaveBeenCalledWith('idle_nudge');
  });
});
