// =============================================================================
// Fleet Commander — findGitBash unit tests
// =============================================================================
// Verifies that findGitBash() correctly handles:
// - Non-Windows returns undefined without calling fs or execSync
// - Env override via CLAUDE_CODE_GIT_BASH_PATH
// - Candidate path lookup via fs.existsSync
// - Fallback to `where bash.exe` when no candidate exists
// - Returns undefined when all lookups fail
// - Caching: resolved paths and undefined results are cached
// - _resetForTesting() clears the cache
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock modules before importing findGitBash
// ---------------------------------------------------------------------------

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('fs', () => ({
  default: { existsSync: mockExistsSync },
  existsSync: mockExistsSync,
}));

import { findGitBash, _resetForTesting } from '../../src/server/utils/find-git-bash.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let originalPlatform: PropertyDescriptor | undefined;

function setPlatform(value: string): void {
  originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

function restorePlatform(): void {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
  originalPlatform = undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('findGitBash', () => {
  const savedEnv = process.env['CLAUDE_CODE_GIT_BASH_PATH'];

  beforeEach(() => {
    _resetForTesting();
    mockExecSync.mockReset();
    mockExistsSync.mockReset();
    delete process.env['CLAUDE_CODE_GIT_BASH_PATH'];
  });

  afterEach(() => {
    restorePlatform();
    if (savedEnv !== undefined) {
      process.env['CLAUDE_CODE_GIT_BASH_PATH'] = savedEnv;
    } else {
      delete process.env['CLAUDE_CODE_GIT_BASH_PATH'];
    }
  });

  // -------------------------------------------------------------------------
  // Non-Windows
  // -------------------------------------------------------------------------

  it('should return undefined on non-Windows without calling fs or execSync', () => {
    setPlatform('linux');

    const result = findGitBash();

    expect(result).toBeUndefined();
    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Env override
  // -------------------------------------------------------------------------

  it('should return env override when CLAUDE_CODE_GIT_BASH_PATH is set', () => {
    setPlatform('win32');
    process.env['CLAUDE_CODE_GIT_BASH_PATH'] = 'D:\\custom\\bash.exe';

    const result = findGitBash();

    expect(result).toBe('D:\\custom\\bash.exe');
    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Candidate path lookup
  // -------------------------------------------------------------------------

  it('should return first matching candidate path', () => {
    setPlatform('win32');

    // First candidate fails, second succeeds
    mockExistsSync
      .mockReturnValueOnce(false) // C:\Program Files\Git\bin\bash.exe
      .mockReturnValueOnce(true); // C:\Program Files\Git\usr\bin\bash.exe

    const result = findGitBash();

    expect(result).toBe('C:\\Program Files\\Git\\usr\\bin\\bash.exe');
    expect(mockExistsSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // where fallback
  // -------------------------------------------------------------------------

  it('should fall through to where bash.exe when no candidate exists', () => {
    setPlatform('win32');

    // All 5 candidates fail, then the where result succeeds
    mockExistsSync
      .mockReturnValueOnce(false)  // C:\Program Files\Git\bin\bash.exe
      .mockReturnValueOnce(false)  // C:\Program Files\Git\usr\bin\bash.exe
      .mockReturnValueOnce(false)  // C:\Program Files (x86)\Git\bin\bash.exe
      .mockReturnValueOnce(false)  // C:\Git\scm\usr\bin\bash.exe
      .mockReturnValueOnce(false)  // C:\Git\scm\bin\bash.exe
      .mockReturnValueOnce(true);  // where result: C:\Windows\System32\bash.exe

    // where bash.exe returns a path
    mockExecSync.mockReturnValueOnce('C:\\Windows\\System32\\bash.exe\r\n');

    const result = findGitBash();

    expect(result).toBe('C:\\Windows\\System32\\bash.exe');
    expect(mockExecSync).toHaveBeenCalledWith('where bash.exe', expect.objectContaining({
      encoding: 'utf-8',
      timeout: 5000,
      shell: 'cmd.exe',
    }));
  });

  it('should return undefined when where also fails', () => {
    setPlatform('win32');

    // All 5 candidates fail
    mockExistsSync
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });

    const result = findGitBash();

    expect(result).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Caching
  // -------------------------------------------------------------------------

  it('should cache the resolved path on subsequent calls', () => {
    setPlatform('win32');

    // First candidate succeeds
    mockExistsSync.mockReturnValueOnce(true);

    const first = findGitBash();
    const second = findGitBash();

    expect(first).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
    expect(second).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
    // existsSync should only have been called once (cached on second call)
    expect(mockExistsSync).toHaveBeenCalledTimes(1);
  });

  it('should cache undefined result when not found', () => {
    setPlatform('win32');

    // All 5 candidates fail
    mockExistsSync
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });

    const first = findGitBash();
    const second = findGitBash();

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    // execSync should only have been called once (cached on second call)
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('should cache non-Windows undefined result', () => {
    setPlatform('linux');

    findGitBash();
    findGitBash();

    // No fs or execSync calls at all — platform check short-circuits both times
    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // _resetForTesting
  // -------------------------------------------------------------------------

  it('should clear cache when _resetForTesting is called', () => {
    setPlatform('win32');

    // First resolution: first candidate succeeds
    mockExistsSync.mockReturnValueOnce(true);
    const first = findGitBash();
    expect(first).toBe('C:\\Program Files\\Git\\bin\\bash.exe');

    // Reset the cache
    _resetForTesting();

    // Second resolution: first candidate fails, second succeeds
    mockExistsSync.mockReturnValueOnce(false);
    mockExistsSync.mockReturnValueOnce(true);
    const second = findGitBash();

    expect(second).toBe('C:\\Program Files\\Git\\usr\\bin\\bash.exe');
    // existsSync called 1 time for first resolve + 2 times for second resolve
    expect(mockExistsSync).toHaveBeenCalledTimes(3);
  });
});
