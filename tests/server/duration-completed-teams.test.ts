// =============================================================================
// Fleet Commander — Duration fix for completed teams
// =============================================================================
// Verifies that completed (done/failed) teams use stopped_at rather than
// current time when computing duration_min and idle_min.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FleetDatabase } from '../../src/server/db.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: FleetDatabase;
let dbPath: string;

function createTempDb(): FleetDatabase {
  dbPath = path.join(os.tmpdir(), `fleet-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const database = new FleetDatabase(dbPath);
  database.initSchema();
  return database;
}

function cleanupDb(): void {
  try {
    db.close();
  } catch {
    // already closed
  }
  for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // best effort
    }
  }
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

beforeEach(() => {
  db = createTempDb();
});

afterEach(() => {
  cleanupDb();
});

// =============================================================================
// v_team_dashboard — duration_min for completed teams
// =============================================================================

describe('v_team_dashboard duration_min for completed teams', () => {
  it('uses stopped_at for done teams instead of current time', () => {
    // Team launched 120 minutes ago, stopped 90 minutes ago => duration ~30 min
    const launchedAt = minutesAgo(120);
    const stoppedAt = minutesAgo(90);

    db.insertTeam({
      issueNumber: 200,
      worktreeName: 'proj-200',
      status: 'done',
      phase: 'done',
      launchedAt,
    });
    db.updateTeam(1, {
      stoppedAt,
      lastEventAt: minutesAgo(95),
    });

    const rows = db.getTeamDashboard();
    expect(rows).toHaveLength(1);

    const row = rows[0];
    // duration_min should be ~30 (launched 120 ago, stopped 90 ago)
    // NOT ~120 (which would happen if it used current time)
    expect(row.durationMin).toBeGreaterThanOrEqual(28);
    expect(row.durationMin).toBeLessThanOrEqual(32);
  });

  it('uses stopped_at for failed teams instead of current time', () => {
    // Team launched 60 minutes ago, stopped 50 minutes ago => duration ~10 min
    const launchedAt = minutesAgo(60);
    const stoppedAt = minutesAgo(50);

    db.insertTeam({
      issueNumber: 201,
      worktreeName: 'proj-201',
      status: 'failed',
      phase: 'implementing',
      launchedAt,
    });
    db.updateTeam(1, {
      stoppedAt,
      lastEventAt: minutesAgo(52),
    });

    const rows = db.getTeamDashboard();
    expect(rows).toHaveLength(1);

    const row = rows[0];
    // duration_min should be ~10 (launched 60 ago, stopped 50 ago)
    // NOT ~60 (which would happen if it used current time)
    expect(row.durationMin).toBeGreaterThanOrEqual(8);
    expect(row.durationMin).toBeLessThanOrEqual(12);
  });

  it('still uses current time for running teams (no stopped_at)', () => {
    // Team launched 30 minutes ago, still running
    const launchedAt = minutesAgo(30);

    db.insertTeam({
      issueNumber: 202,
      worktreeName: 'proj-202',
      status: 'running',
      phase: 'implementing',
      launchedAt,
    });
    db.updateTeam(1, {
      lastEventAt: minutesAgo(1),
    });

    const rows = db.getTeamDashboard();
    expect(rows).toHaveLength(1);

    const row = rows[0];
    // duration_min should be ~30 (launched 30 ago, no stopped_at => uses now)
    expect(row.durationMin).toBeGreaterThanOrEqual(28);
    expect(row.durationMin).toBeLessThanOrEqual(32);
  });
});

// =============================================================================
// v_team_dashboard — idle_min for completed teams
// =============================================================================

describe('v_team_dashboard idle_min for completed teams', () => {
  it('caps idle_min at stopped_at for done teams', () => {
    // Team launched 120 min ago, last event 100 min ago, stopped 90 min ago
    // idle_min should be ~10 (last_event to stopped_at), NOT ~100 (last_event to now)
    const launchedAt = minutesAgo(120);
    const lastEventAt = minutesAgo(100);
    const stoppedAt = minutesAgo(90);

    db.insertTeam({
      issueNumber: 300,
      worktreeName: 'proj-300',
      status: 'done',
      phase: 'done',
      launchedAt,
    });
    db.updateTeam(1, {
      stoppedAt,
      lastEventAt,
    });

    const rows = db.getTeamDashboard();
    expect(rows).toHaveLength(1);

    const row = rows[0];
    // idle_min should be ~10, NOT ~100
    expect(row.idleMin).toBeGreaterThanOrEqual(8);
    expect(row.idleMin).toBeLessThanOrEqual(12);
  });
});
