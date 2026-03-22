// =============================================================================
// Fleet Commander — MCP list-issues Tool Tests
// =============================================================================
// Smoke tests for the fleet_list_issues MCP tool registration and handler.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceError } from '../../../src/server/services/service-error.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

const mockIssueResult = {
  projectId: 1,
  projectName: 'test-project',
  tree: [
    { number: 10, title: 'Parent issue', children: [{ number: 11, title: 'Child', children: [] }] },
  ],
  cachedAt: '2025-01-01T00:00:00Z',
  count: 2,
};

const mockGetProjectIssues = vi.fn().mockResolvedValue(mockIssueResult);

vi.mock('../../../src/server/services/issue-service.js', () => ({
  getIssueService: () => ({
    getProjectIssues: mockGetProjectIssues,
  }),
}));

// ---------------------------------------------------------------------------
// Capture tool registrations via a mock McpServer
// ---------------------------------------------------------------------------

interface RegisteredTool {
  name: string;
  description: string;
  schema: unknown;
  handler: (...args: unknown[]) => Promise<unknown>;
}

const registeredTools: RegisteredTool[] = [];

const mockMcpServer = {
  tool: vi.fn((...args: unknown[]) => {
    // server.tool(name, description, schema, handler) — 4-arg form
    const name = args[0] as string;
    const description = args[1] as string;
    const schema = args[2];
    const handler = args[3] as (...a: unknown[]) => Promise<unknown>;
    registeredTools.push({ name, description, schema, handler });
  }),
};

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

const { registerListIssuesTool } = await import(
  '../../../src/server/mcp/tools/list-issues.js'
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fleet_list_issues MCP tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredTools.length = 0;
  });

  it('registers with the correct tool name', () => {
    registerListIssuesTool(mockMcpServer as any);

    expect(mockMcpServer.tool).toHaveBeenCalledOnce();
    expect(registeredTools).toHaveLength(1);
    expect(registeredTools[0]!.name).toBe('fleet_list_issues');
  });

  it('registers with a description', () => {
    registerListIssuesTool(mockMcpServer as any);

    expect(registeredTools[0]!.description).toBeTruthy();
    expect(typeof registeredTools[0]!.description).toBe('string');
  });

  it('handler returns valid issue tree JSON', async () => {
    registerListIssuesTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = (await handler({ projectId: 1 })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result).toHaveProperty('content');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toEqual(mockIssueResult);
  });

  it('handler passes projectId to service', async () => {
    registerListIssuesTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    await handler({ projectId: 42 });

    expect(mockGetProjectIssues).toHaveBeenCalledWith(42);
  });

  it('handler awaits the async service method', async () => {
    registerListIssuesTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = await handler({ projectId: 1 });

    // Verify the result is resolved (not a Promise)
    expect(result).toHaveProperty('content');
  });

  it('handler returns isError on ServiceError', async () => {
    mockGetProjectIssues.mockRejectedValueOnce(
      new ServiceError('Project 999 not found', 'NOT_FOUND', 404),
    );

    registerListIssuesTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = (await handler({ projectId: 999 })) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Project 999 not found');
  });

  it('handler re-throws non-ServiceError exceptions', async () => {
    mockGetProjectIssues.mockRejectedValueOnce(new Error('unexpected'));

    registerListIssuesTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    await expect(handler({ projectId: 1 })).rejects.toThrow('unexpected');
  });
});
