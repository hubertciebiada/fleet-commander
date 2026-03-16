/**
 * Usage Tracking Service — Records and broadcasts usage percentage snapshots
 *
 * Replaces cost tracking with usage-percentage tracking that mirrors what
 * Claude Code's /usage command reports: daily, weekly, Sonnet-only, and
 * extra usage as 0-100% progress bars.
 */

import { getDatabase } from '../db.js';
import { sseBroker } from './sse-broker.js';

/**
 * Process and store a usage snapshot, then broadcast via SSE.
 */
export function processUsageSnapshot(data: {
  teamId?: number;
  projectId?: number;
  sessionId?: string;
  dailyPercent?: number;
  weeklyPercent?: number;
  sonnetPercent?: number;
  extraPercent?: number;
  rawOutput?: string;
}): void {
  const db = getDatabase();
  db.insertUsageSnapshot(data);

  sseBroker.broadcast('usage_updated', {
    daily_percent: data.dailyPercent ?? 0,
    weekly_percent: data.weeklyPercent ?? 0,
    sonnet_percent: data.sonnetPercent ?? 0,
    extra_percent: data.extraPercent ?? 0,
  });
}
