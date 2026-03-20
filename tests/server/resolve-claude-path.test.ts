// =============================================================================
// Fleet Commander — resolveClaudePath unit tests
// =============================================================================
// Verifies that resolveClaudePath() correctly handles:
// - Explicit FLEET_CLAUDE_CMD override (bypasses auto-detection)
// - Windows auto-detection via `where` when default is in use
// - Non-Windows fallback to 'claude' as-is
// - _resetForTesting() clears the cached path
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock modules before importing resolveClaudePath
// ---------------------------------------------------------------------------

const mockConfig = vi.hoisted(() => ({
  claudeCmd: 'claude',
}));

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock('../../src/server/config.js', () => ({
  default: mockConfig,
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

import { resolveClaudePath, _resetForTesting } from '../../src/server/utils/resolve-claude-path.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveClaudePath', () => {
  beforeEach(() => {
    _resetForTesting();
    mockConfig.claudeCmd = 'claude';
    mockExecSync.mockReset();
  });

  // -------------------------------------------------------------------------
  // Explicit override
  // -------------------------------------------------------------------------

  it('returns explicit FLEET_CLAUDE_CMD without running auto-detection', () => {
    mockConfig.claudeCmd = '/opt/custom/claude-special';

    const result = resolveClaudePath();

    expect(result).toBe('/opt/custom/claude-special');
    // Should NOT have called execSync for `where`
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('returns explicit Windows path without running auto-detection', () => {
    mockConfig.claudeCmd = 'C:\\Program Files\\Claude\\claude.exe';

    const result = resolveClaudePath();

    expect(result).toBe('C:\\Program Files\\Claude\\claude.exe');
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Windows auto-detection
  // -------------------------------------------------------------------------

  it('runs where auto-detection on Windows when default is in use', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    mockExecSync.mockReturnValueOnce('C:\\Users\\me\\AppData\\Local\\npm\\claude.exe\r\n');

    const result = resolveClaudePath();

    expect(result).toBe('C:\\Users\\me\\AppData\\Local\\npm\\claude.exe');
    expect(mockExecSync).toHaveBeenCalledWith('where claude.exe', expect.objectContaining({
      encoding: 'utf-8',
      timeout: 5000,
    }));

    // Restore platform
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('falls back to where claude (no .exe) if where claude.exe fails on Windows', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    // First call (where claude.exe) fails
    mockExecSync.mockImplementationOnce(() => { throw new Error('not found'); });
    // Second call (where claude) succeeds
    mockExecSync.mockReturnValueOnce('C:\\tools\\claude.cmd\r\n');

    const result = resolveClaudePath();

    expect(result).toBe('C:\\tools\\claude.cmd');
    expect(mockExecSync).toHaveBeenCalledTimes(2);

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('falls back to config.claudeCmd if both where calls fail on Windows', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    mockExecSync.mockImplementation(() => { throw new Error('not found'); });

    const result = resolveClaudePath();

    expect(result).toBe('claude');

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  // -------------------------------------------------------------------------
  // Non-Windows fallback
  // -------------------------------------------------------------------------

  it('returns claude as-is on non-Windows without calling where', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const result = resolveClaudePath();

    expect(result).toBe('claude');
    expect(mockExecSync).not.toHaveBeenCalled();

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  // -------------------------------------------------------------------------
  // Caching + _resetForTesting
  // -------------------------------------------------------------------------

  it('caches the resolved path on subsequent calls', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    mockExecSync.mockReturnValueOnce('C:\\cached\\claude.exe\r\n');

    const first = resolveClaudePath();
    const second = resolveClaudePath();

    expect(first).toBe('C:\\cached\\claude.exe');
    expect(second).toBe('C:\\cached\\claude.exe');
    // execSync should only have been called once (cached on second call)
    expect(mockExecSync).toHaveBeenCalledTimes(1);

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('_resetForTesting clears the cached path', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    mockExecSync.mockReturnValueOnce('C:\\first\\claude.exe\r\n');
    resolveClaudePath();
    expect(mockExecSync).toHaveBeenCalledTimes(1);

    _resetForTesting();

    mockExecSync.mockReturnValueOnce('C:\\second\\claude.exe\r\n');
    const result = resolveClaudePath();

    expect(result).toBe('C:\\second\\claude.exe');
    expect(mockExecSync).toHaveBeenCalledTimes(2);

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('caches explicit override and returns it on subsequent calls', () => {
    mockConfig.claudeCmd = '/custom/claude';

    const first = resolveClaudePath();
    const second = resolveClaudePath();

    expect(first).toBe('/custom/claude');
    expect(second).toBe('/custom/claude');
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});
