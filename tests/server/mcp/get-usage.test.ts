// =============================================================================
// Fleet Commander — MCP get-usage Tool Tests
// =============================================================================
// Smoke tests for the fleet_get_usage MCP tool registration and handler.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

const mockUsageData = {
  dailyPercent: 42,
  weeklyPercent: 18,
  sonnetPercent: 65,
  extraPercent: 3,
  recordedAt: '2026-03-23T12:00:00Z',
  zone: 'green',
  redThresholds: { daily: 80, weekly: 80, sonnet: 80, extra: 80 },
};

vi.mock('../../../src/server/services/usage-service.js', () => ({
  getUsageService: () => ({
    getLatest: () => mockUsageData,
  }),
}));

// ---------------------------------------------------------------------------
// Capture tool registrations via a mock McpServer
// ---------------------------------------------------------------------------

interface RegisteredTool {
  name: string;
  description: string;
  handler: (...args: unknown[]) => Promise<unknown>;
}

const registeredTools: RegisteredTool[] = [];

const mockMcpServer = {
  tool: vi.fn((...args: unknown[]) => {
    // server.tool(name, description, handler) — 3-arg form
    const name = args[0] as string;
    const description = args[1] as string;
    const handler = args[2] as (...a: unknown[]) => Promise<unknown>;
    registeredTools.push({ name, description, handler });
  }),
};

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

const { registerGetUsageTool } = await import(
  '../../../src/server/mcp/tools/get-usage.js'
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fleet_get_usage MCP tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredTools.length = 0;
  });

  it('registers with the correct tool name', () => {
    registerGetUsageTool(mockMcpServer as any);

    expect(mockMcpServer.tool).toHaveBeenCalledOnce();
    expect(registeredTools).toHaveLength(1);
    expect(registeredTools[0]!.name).toBe('fleet_get_usage');
  });

  it('registers with a description', () => {
    registerGetUsageTool(mockMcpServer as any);

    expect(registeredTools[0]!.description).toBeTruthy();
    expect(typeof registeredTools[0]!.description).toBe('string');
  });

  it('handler returns valid usage JSON', async () => {
    registerGetUsageTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = (await handler()) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result).toHaveProperty('content');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toEqual(mockUsageData);
  });

  it('handler returns usage data with zone indicator', async () => {
    registerGetUsageTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = (await handler()) as {
      content: Array<{ type: string; text: string }>;
    };

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.zone).toBe('green');
  });

  it('handler returns usage data with redThresholds', async () => {
    registerGetUsageTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = (await handler()) as {
      content: Array<{ type: string; text: string }>;
    };

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.redThresholds).toEqual({ daily: 80, weekly: 80, sonnet: 80, extra: 80 });
  });

  it('handler returns properly formatted JSON with indentation', async () => {
    registerGetUsageTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = (await handler()) as {
      content: Array<{ type: string; text: string }>;
    };

    const text = result.content[0]!.text;
    // Verify it's pretty-printed (contains newlines and indentation)
    expect(text).toContain('\n');
    expect(text).toContain('  ');
    // Verify it matches JSON.stringify with indent=2
    expect(text).toBe(JSON.stringify(mockUsageData, null, 2));
  });
});
