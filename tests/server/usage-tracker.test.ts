// =============================================================================
// Fleet Commander — UsageTracker tests
// =============================================================================
// Tests for:
// 1. UsagePoller.start() DB seeding of zone state (issue #66)
// 2. processUsageSnapshot() zone transition and queue drain (issue #533)
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

const mockGetLatestUsage = vi.fn();
const mockInsertUsageSnapshot = vi.fn();
const mockGetProjects = vi.fn();
const mockGetQueuedTeamsByProject = vi.fn();

vi.mock('../../src/server/db.js', () => ({
  getDatabase: () => ({
    getLatestUsage: mockGetLatestUsage,
    insertUsageSnapshot: mockInsertUsageSnapshot,
    getProjects: mockGetProjects,
    getQueuedTeamsByProject: mockGetQueuedTeamsByProject,
  }),
}));

vi.mock('../../src/server/config.js', () => ({
  default: {
    usagePollIntervalMs: 900_000,
    usageRedDailyPct: 85,
    usageRedWeeklyPct: 95,
  },
}));

vi.mock('../../src/server/services/sse-broker.js', () => ({
  sseBroker: {
    broadcast: vi.fn(),
  },
}));

const mockProcessQueue = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/server/services/team-manager.js', () => ({
  getTeamManager: () => ({
    processQueue: mockProcessQueue,
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { usagePoller, getUsageZone, processUsageSnapshot } from '../../src/server/services/usage-tracker.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UsagePoller.start() — DB seeding of zone state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stop any running interval from a previous test
    usagePoller.stop();
  });

  it('seeds _lastZone to red when the latest DB snapshot exceeds the daily threshold', () => {
    mockGetLatestUsage.mockReturnValue({
      id: 1,
      teamId: null,
      projectId: null,
      sessionId: null,
      dailyPercent: 90,
      weeklyPercent: 50,
      sonnetPercent: 0,
      extraPercent: 0,
      dailyResetsAt: null,
      weeklyResetsAt: null,
      rawOutput: null,
      recordedAt: '2026-03-18T00:00:00Z',
    });

    // Stub poll() to prevent actual HTTP calls
    const pollSpy = vi.spyOn(usagePoller, 'poll').mockImplementation(() => {});

    usagePoller.start();

    expect(mockGetLatestUsage).toHaveBeenCalledTimes(1);
    expect(getUsageZone()).toBe('red');

    usagePoller.stop();
    pollSpy.mockRestore();
  });

  it('seeds _lastZone to red when the latest DB snapshot exceeds the weekly threshold', () => {
    mockGetLatestUsage.mockReturnValue({
      id: 2,
      teamId: null,
      projectId: null,
      sessionId: null,
      dailyPercent: 10,
      weeklyPercent: 96,
      sonnetPercent: 0,
      extraPercent: 0,
      dailyResetsAt: null,
      weeklyResetsAt: null,
      rawOutput: null,
      recordedAt: '2026-03-18T00:00:00Z',
    });

    const pollSpy = vi.spyOn(usagePoller, 'poll').mockImplementation(() => {});

    usagePoller.start();

    expect(getUsageZone()).toBe('red');

    usagePoller.stop();
    pollSpy.mockRestore();
  });

  it('seeds _lastZone to green when the latest DB snapshot is below thresholds', () => {
    mockGetLatestUsage.mockReturnValue({
      id: 3,
      teamId: null,
      projectId: null,
      sessionId: null,
      dailyPercent: 40,
      weeklyPercent: 60,
      sonnetPercent: 0,
      extraPercent: 0,
      dailyResetsAt: null,
      weeklyResetsAt: null,
      rawOutput: null,
      recordedAt: '2026-03-18T00:00:00Z',
    });

    const pollSpy = vi.spyOn(usagePoller, 'poll').mockImplementation(() => {});

    usagePoller.start();

    expect(getUsageZone()).toBe('green');

    usagePoller.stop();
    pollSpy.mockRestore();
  });

  it('keeps defaults (green) when no usage snapshots exist in DB', () => {
    mockGetLatestUsage.mockReturnValue(undefined);

    const pollSpy = vi.spyOn(usagePoller, 'poll').mockImplementation(() => {});

    usagePoller.start();

    expect(mockGetLatestUsage).toHaveBeenCalledTimes(1);
    expect(getUsageZone()).toBe('green');

    usagePoller.stop();
    pollSpy.mockRestore();
  });

  it('keeps defaults (green) when getLatestUsage throws', () => {
    mockGetLatestUsage.mockImplementation(() => {
      throw new Error('DB locked');
    });

    const pollSpy = vi.spyOn(usagePoller, 'poll').mockImplementation(() => {});

    // Should not throw — error is caught and logged
    expect(() => usagePoller.start()).not.toThrow();

    expect(getUsageZone()).toBe('green');

    usagePoller.stop();
    pollSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// processUsageSnapshot() — zone transition and queue drain (issue #533)
// ---------------------------------------------------------------------------

describe('processUsageSnapshot() — zone transition and queue drain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProjects.mockReturnValue([]);
    mockGetQueuedTeamsByProject.mockReturnValue([]);
  });

  it('should update _latestDaily and _latestWeekly from submitted data', async () => {
    // Submit low values => zone should be green
    await processUsageSnapshot({ dailyPercent: 50, weeklyPercent: 60 });
    expect(getUsageZone()).toBe('green');

    // Submit high daily value => zone should be red (85 threshold)
    await processUsageSnapshot({ dailyPercent: 90, weeklyPercent: 50 });
    expect(getUsageZone()).toBe('red');
  });

  it('should trigger queue drain on red-to-green transition', async () => {
    mockGetProjects.mockReturnValue([{ id: 1, slug: 'test-proj', status: 'active' }]);
    mockGetQueuedTeamsByProject.mockReturnValue([{ id: 10, status: 'queued' }]);

    // Set zone to red
    await processUsageSnapshot({ dailyPercent: 90, weeklyPercent: 50 });
    expect(getUsageZone()).toBe('red');
    expect(mockProcessQueue).not.toHaveBeenCalled();

    // Transition to green
    await processUsageSnapshot({ dailyPercent: 10, weeklyPercent: 10 });
    expect(getUsageZone()).toBe('green');
    expect(mockProcessQueue).toHaveBeenCalledWith(1);
  });

  it('should not trigger queue drain when zone stays green', async () => {
    await processUsageSnapshot({ dailyPercent: 10, weeklyPercent: 10 });
    expect(getUsageZone()).toBe('green');

    await processUsageSnapshot({ dailyPercent: 20, weeklyPercent: 20 });
    expect(getUsageZone()).toBe('green');

    expect(mockProcessQueue).not.toHaveBeenCalled();
  });

  it('should not trigger queue drain when zone stays red', async () => {
    mockGetProjects.mockReturnValue([{ id: 1, slug: 'test-proj', status: 'active' }]);
    mockGetQueuedTeamsByProject.mockReturnValue([{ id: 10, status: 'queued' }]);

    await processUsageSnapshot({ dailyPercent: 90, weeklyPercent: 50 });
    expect(getUsageZone()).toBe('red');

    await processUsageSnapshot({ dailyPercent: 92, weeklyPercent: 50 });
    expect(getUsageZone()).toBe('red');

    expect(mockProcessQueue).not.toHaveBeenCalled();
  });

  it('should not trigger queue drain on green-to-red transition', async () => {
    await processUsageSnapshot({ dailyPercent: 10, weeklyPercent: 10 });
    expect(getUsageZone()).toBe('green');

    await processUsageSnapshot({ dailyPercent: 90, weeklyPercent: 50 });
    expect(getUsageZone()).toBe('red');

    expect(mockProcessQueue).not.toHaveBeenCalled();
  });
});
