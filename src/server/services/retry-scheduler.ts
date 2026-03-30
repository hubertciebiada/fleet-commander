// =============================================================================
// Fleet Commander — Retry Scheduler Service
//
// Periodically checks failed teams for auto-retry eligibility. A failed team
// is retried when:
//   1. It has been failed for at least `retryDelayMin` minutes
//   2. Daily usage is below `retryMaxDailyPct`
//   3. retry_count < retryMaxCount
//
// Retried teams are re-queued and processed through normal queue logic
// (respecting slot limits and dependency checks).
// =============================================================================

import { getDatabase } from '../db.js';
import config from '../config.js';
import { sseBroker } from './sse-broker.js';
import { getLatestDailyPercent } from './usage-tracker.js';

class RetryScheduler {
  private interval: NodeJS.Timeout | null = null;

  /**
   * Start the periodic retry check loop.
   * Reuses the same interval as the stuck detector (default 60s).
   */
  start(): void {
    if (this.interval) {
      return; // already running
    }

    this.interval = setInterval(() => {
      this.check().catch((err: unknown) => {
        console.error(
          '[RetryScheduler] Check failed:',
          err instanceof Error ? err.message : err,
        );
      });
    }, config.stuckCheckIntervalMs);

    if (this.interval.unref) {
      this.interval.unref();
    }

    console.log(
      `[RetryScheduler] Started — delay=${config.retryDelayMin}min, maxRetries=${config.retryMaxCount}, maxDailyPct=${config.retryMaxDailyPct}%`,
    );
  }

  /**
   * Stop the periodic check loop.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('[RetryScheduler] Stopped');
    }
  }

  /**
   * Run a single retry check pass over all failed teams.
   * Can be called manually (e.g. from tests) or is invoked by the timer.
   */
  async check(): Promise<void> {
    const db = getDatabase();
    const failedTeams = db.getFailedTeamsForRetry();

    for (const team of failedTeams) {
      // Skip if retries exhausted
      if (team.retryCount >= config.retryMaxCount) {
        continue;
      }

      // Skip if stoppedAt is missing (should not happen for failed teams)
      if (!team.stoppedAt) {
        console.warn(
          `[RetryScheduler] Team ${team.id} is failed but has no stoppedAt — skipping`,
        );
        continue;
      }

      // Check if enough time has passed since failure
      const failedMinutes = (Date.now() - new Date(team.stoppedAt).getTime()) / 60_000;
      if (failedMinutes < config.retryDelayMin) {
        continue;
      }

      // Check daily usage threshold
      const dailyPct = getLatestDailyPercent();
      if (dailyPct >= config.retryMaxDailyPct) {
        console.log(
          `[RetryScheduler] Team ${team.id} eligible but daily usage too high (${dailyPct}% >= ${config.retryMaxDailyPct}%) — skipping`,
        );
        continue;
      }

      // Execute retry: transition failed -> queued
      const newRetryCount = team.retryCount + 1;

      db.insertTransition({
        teamId: team.id,
        fromStatus: 'failed',
        toStatus: 'queued',
        trigger: 'timer',
        reason: `Auto-retry ${newRetryCount}/${config.retryMaxCount} (daily usage: ${dailyPct}%)`,
      });

      db.updateTeamSilent(team.id, {
        retryCount: newRetryCount,
        status: 'queued',
        phase: 'init',
        pid: null,
        sessionId: null,
        stoppedAt: null,
        lastEventAt: null,
        launchedAt: new Date().toISOString(),
      });

      sseBroker.broadcast(
        'team_status_changed',
        {
          team_id: team.id,
          status: 'queued',
          previous_status: 'failed',
          retry_count: newRetryCount,
        },
        team.id,
      );

      console.log(
        `[RetryScheduler] Auto-retry team ${team.id} (retry ${newRetryCount}/${config.retryMaxCount})`,
      );

      // Trigger queue processing (dynamic import to avoid circular deps)
      if (team.projectId) {
        try {
          const { getTeamManager } = await import('./team-manager.js');
          getTeamManager().processQueue(team.projectId).catch((err: unknown) => {
            console.error(
              `[RetryScheduler] processQueue error for project ${team.projectId}:`,
              err,
            );
          });
        } catch (err: unknown) {
          console.error(
            `[RetryScheduler] Failed to import team-manager for queue processing:`,
            err,
          );
        }
      }
    }
  }
}

// Singleton instance
export const retryScheduler = new RetryScheduler();
