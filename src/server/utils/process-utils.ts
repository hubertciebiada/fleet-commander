// =============================================================================
// Fleet Commander — Process Utilities
// =============================================================================
// Cross-platform helpers for inspecting OS processes.
// =============================================================================

import { execSync } from 'child_process';

/**
 * Check whether a process with the given PID is still alive.
 *
 * - On Windows: uses `tasklist /FI "PID eq …"` and checks for the PID in the
 *   output.  This avoids false positives from recycled PIDs.
 * - On POSIX:  sends signal 0 via `process.kill`.  This does not kill the
 *   process — it only checks whether the process exists.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    if (process.platform === 'win32') {
      const result = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
      return result.includes(String(pid));
    } else {
      process.kill(pid, 0);
      return true;
    }
  } catch {
    return false;
  }
}
