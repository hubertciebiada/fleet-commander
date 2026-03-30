// =============================================================================
// Fleet Commander — Retry Scheduler Tests
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Team } from '../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before import
// ---------------------------------------------------------------------------

const mockDb = {
  getFailedTeamsForRetry: vi.fn<() => Partial<Team>[]>().mockReturnValue([]),
  updateTeamSilent: vi.fn(),
  insertTransition: vi.fn(),
  getTeam: vi.fn(),
};

const mockSseBroker = {
  broadcast: vi.fn(),
};

const mockProcessQueue = vi.fn().mockResolvedValue(undefined);
const mockGetTeamManager = vi.fn(() => ({
  processQueue: mockProcessQueue,
}));

vi.mock('../../src/server/db.js', () => ({
  getDatabase: () => mockDb,
}));

vi.mock('../../src/server/services/sse-broker.js', () => ({
  sseBroker: mockSseBroker,
}));

vi.mock('../../src/server/services/team-manager.js', () => ({
  getTeamManager: (...args: unknown[]) => mockGetTeamManager(...args),
}));

let mockLatestDailyPercent = 0;
vi.mock('../../src/server/services/usage-tracker.js', () => ({
  getLatestDailyPercent: () => mockLatestDailyPercent,
}));

vi.mock('../../src/server/config.js', () => ({
  default: {
    stuckCheckIntervalMs: 60000,
    retryDelayMin: 60,
    retryMaxDailyPct: 75,
    retryMaxCount: 2,
  },
}));

// Import after mocks are set up
const { retryScheduler } = await import('../../src/server/services/retry-scheduler.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTeam(overrides: Partial<Team>): Partial<Team> {
  return {
    id: 1,
    issueNumber: 100,
    issueKey: '100',
    issueProvider: 'github',
    issueTitle: 'Test issue',
    projectId: 1,
    status: 'failed',
    phase: 'implementing',
    pid: null,
    sessionId: null,
    worktreeName: 'test-100',
    branchName: 'feat/100-test',
    prNumber: null,
    customPrompt: null,
    headless: true,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalCostUsd: 0,
    blockedByJson: null,
    retryCount: 0,
    launchedAt: new Date(Date.now() - 120 * 60_000).toISOString(), // 2h ago
    stoppedAt: new Date(Date.now() - 90 * 60_000).toISOString(),   // 90 min ago
    lastEventAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function minutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.getFailedTeamsForRetry.mockReturnValue([]);
  mockLatestDailyPercent = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RetryScheduler', () => {
  describe('check()', () => {
    it('should retry a team that meets all criteria', async () => {
      const team = makeTeam({
        id: 1,
        retryCount: 0,
        stoppedAt: minutesAgo(90), // 90 min ago, > 60 min threshold
        projectId: 5,
      });
      mockDb.getFailedTeamsForRetry.mockReturnValue([team]);
      mockLatestDailyPercent = 50; // below 75% threshold

      await retryScheduler.check();

      // Should insert transition
      expect(mockDb.insertTransition).toHaveBeenCalledWith({
        teamId: 1,
        fromStatus: 'failed',
        toStatus: 'queued',
        trigger: 'timer',
        reason: expect.stringContaining('Auto-retry 1/2'),
      });

      // Should update team
      expect(mockDb.updateTeamSilent).toHaveBeenCalledWith(1, {
        retryCount: 1,
        status: 'queued',
        phase: 'init',
        pid: null,
        sessionId: null,
        stoppedAt: null,
        lastEventAt: null,
        launchedAt: expect.any(String),
      });

      // Should broadcast SSE
      expect(mockSseBroker.broadcast).toHaveBeenCalledWith(
        'team_status_changed',
        {
          team_id: 1,
          status: 'queued',
          previous_status: 'failed',
          retry_count: 1,
        },
        1,
      );

      // Should trigger processQueue for the team's project
      expect(mockProcessQueue).toHaveBeenCalledWith(5);
    });

    it('should NOT retry a team that has exhausted retries', async () => {
      const team = makeTeam({
        id: 2,
        retryCount: 2, // already at max (2)
        stoppedAt: minutesAgo(120),
      });
      mockDb.getFailedTeamsForRetry.mockReturnValue([team]);
      mockLatestDailyPercent = 10;

      await retryScheduler.check();

      expect(mockDb.updateTeamSilent).not.toHaveBeenCalled();
      expect(mockDb.insertTransition).not.toHaveBeenCalled();
      expect(mockSseBroker.broadcast).not.toHaveBeenCalled();
    });

    it('should NOT retry a team that failed less than retryDelayMin ago', async () => {
      const team = makeTeam({
        id: 3,
        retryCount: 0,
        stoppedAt: minutesAgo(30), // only 30 min ago, threshold is 60
      });
      mockDb.getFailedTeamsForRetry.mockReturnValue([team]);
      mockLatestDailyPercent = 10;

      await retryScheduler.check();

      expect(mockDb.updateTeamSilent).not.toHaveBeenCalled();
      expect(mockDb.insertTransition).not.toHaveBeenCalled();
    });

    it('should NOT retry when daily usage exceeds threshold', async () => {
      const team = makeTeam({
        id: 4,
        retryCount: 0,
        stoppedAt: minutesAgo(90),
      });
      mockDb.getFailedTeamsForRetry.mockReturnValue([team]);
      mockLatestDailyPercent = 80; // above 75% threshold

      await retryScheduler.check();

      expect(mockDb.updateTeamSilent).not.toHaveBeenCalled();
      expect(mockDb.insertTransition).not.toHaveBeenCalled();
    });

    it('should skip a team with null stoppedAt', async () => {
      const team = makeTeam({
        id: 5,
        retryCount: 0,
        stoppedAt: null,
      });
      mockDb.getFailedTeamsForRetry.mockReturnValue([team]);
      mockLatestDailyPercent = 10;

      await retryScheduler.check();

      expect(mockDb.updateTeamSilent).not.toHaveBeenCalled();
      expect(mockDb.insertTransition).not.toHaveBeenCalled();
    });

    it('should process multiple eligible failed teams', async () => {
      const team1 = makeTeam({
        id: 10,
        retryCount: 0,
        stoppedAt: minutesAgo(90),
        projectId: 1,
      });
      const team2 = makeTeam({
        id: 11,
        retryCount: 1,
        stoppedAt: minutesAgo(120),
        projectId: 2,
      });
      mockDb.getFailedTeamsForRetry.mockReturnValue([team1, team2]);
      mockLatestDailyPercent = 30;

      await retryScheduler.check();

      // Both teams should be retried
      expect(mockDb.updateTeamSilent).toHaveBeenCalledTimes(2);
      expect(mockDb.insertTransition).toHaveBeenCalledTimes(2);
      expect(mockSseBroker.broadcast).toHaveBeenCalledTimes(2);

      // processQueue should be called for each project
      expect(mockProcessQueue).toHaveBeenCalledWith(1);
      expect(mockProcessQueue).toHaveBeenCalledWith(2);
    });

    it('should call processQueue for the retried team project', async () => {
      const team = makeTeam({
        id: 6,
        retryCount: 0,
        stoppedAt: minutesAgo(90),
        projectId: 42,
      });
      mockDb.getFailedTeamsForRetry.mockReturnValue([team]);
      mockLatestDailyPercent = 10;

      await retryScheduler.check();

      expect(mockProcessQueue).toHaveBeenCalledWith(42);
    });

    it('should NOT call processQueue if projectId is null', async () => {
      const team = makeTeam({
        id: 7,
        retryCount: 0,
        stoppedAt: minutesAgo(90),
        projectId: null,
      });
      mockDb.getFailedTeamsForRetry.mockReturnValue([team]);
      mockLatestDailyPercent = 10;

      await retryScheduler.check();

      // Team is still retried
      expect(mockDb.updateTeamSilent).toHaveBeenCalled();
      // But processQueue is not called since there is no project
      expect(mockProcessQueue).not.toHaveBeenCalled();
    });

    it('should retry at retryCount=1 when maxCount=2', async () => {
      const team = makeTeam({
        id: 8,
        retryCount: 1, // 1 < 2 (maxCount)
        stoppedAt: minutesAgo(90),
        projectId: 1,
      });
      mockDb.getFailedTeamsForRetry.mockReturnValue([team]);
      mockLatestDailyPercent = 10;

      await retryScheduler.check();

      expect(mockDb.updateTeamSilent).toHaveBeenCalledWith(8, expect.objectContaining({
        retryCount: 2,
        status: 'queued',
      }));
    });

    it('should NOT retry at daily usage equal to threshold', async () => {
      const team = makeTeam({
        id: 9,
        retryCount: 0,
        stoppedAt: minutesAgo(90),
      });
      mockDb.getFailedTeamsForRetry.mockReturnValue([team]);
      mockLatestDailyPercent = 75; // exactly at threshold (>= check)

      await retryScheduler.check();

      expect(mockDb.updateTeamSilent).not.toHaveBeenCalled();
    });

    it('should skip ineligible teams but still process eligible ones', async () => {
      const exhausted = makeTeam({
        id: 20,
        retryCount: 2, // maxed out
        stoppedAt: minutesAgo(120),
        projectId: 1,
      });
      const tooRecent = makeTeam({
        id: 21,
        retryCount: 0,
        stoppedAt: minutesAgo(10), // too recent
        projectId: 1,
      });
      const eligible = makeTeam({
        id: 22,
        retryCount: 0,
        stoppedAt: minutesAgo(90),
        projectId: 1,
      });
      mockDb.getFailedTeamsForRetry.mockReturnValue([exhausted, tooRecent, eligible]);
      mockLatestDailyPercent = 10;

      await retryScheduler.check();

      // Only eligible team should be retried
      expect(mockDb.updateTeamSilent).toHaveBeenCalledTimes(1);
      expect(mockDb.updateTeamSilent).toHaveBeenCalledWith(22, expect.objectContaining({
        retryCount: 1,
        status: 'queued',
      }));
    });
  });

  describe('start() / stop()', () => {
    it('should start and stop without errors', () => {
      retryScheduler.start();
      retryScheduler.stop();
    });
  });
});
