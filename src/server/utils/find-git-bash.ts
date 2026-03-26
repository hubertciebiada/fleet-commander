/**
 * Shared utility: locate Git Bash on Windows.
 *
 * Claude Code requires git-bash on Windows. When the Fleet Commander server
 * is started from cmd.exe or a .bat file (rather than Git Bash itself), the
 * child process may not inherit the right PATH. This helper auto-detects
 * bash.exe so we can set CLAUDE_CODE_GIT_BASH_PATH in the spawn environment.
 */

import { execSync } from 'child_process';
import fs from 'fs';

// Module-level cache: null = not yet resolved, undefined = resolved but not found
let _cachedGitBash: string | undefined | null = null;

export function findGitBash(): string | undefined {
  if (_cachedGitBash !== null) return _cachedGitBash;

  if (process.platform !== 'win32') {
    _cachedGitBash = undefined;
    return _cachedGitBash;
  }

  // Honour explicit override first
  if (process.env['CLAUDE_CODE_GIT_BASH_PATH']) {
    _cachedGitBash = process.env['CLAUDE_CODE_GIT_BASH_PATH'];
    return _cachedGitBash;
  }

  // Well-known install locations
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Git\\scm\\usr\\bin\\bash.exe',
    'C:\\Git\\scm\\bin\\bash.exe',
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      _cachedGitBash = p;
      return _cachedGitBash;
    }
  }

  // Fallback: ask Windows where bash.exe lives
  try {
    const result = execSync('where bash.exe', {
      encoding: 'utf-8',
      timeout: 5000,
      shell: 'cmd.exe',
    });
    const first = result.trim().split('\n')[0]?.trim();
    if (first && fs.existsSync(first)) {
      _cachedGitBash = first;
      return _cachedGitBash;
    }
  } catch {
    /* ignore — where may not find it */
  }

  _cachedGitBash = undefined;
  return _cachedGitBash;
}

/** Reset the cached path — exposed only for unit tests. */
export function _resetForTesting(): void {
  _cachedGitBash = null;
}
