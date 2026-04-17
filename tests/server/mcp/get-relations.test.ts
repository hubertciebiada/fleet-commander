// =============================================================================
// Fleet Commander — MCP get-relations Tool Tests
// =============================================================================
// Smoke tests for the fleet_get_relations MCP tool registration and handler.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceError } from '../../../src/server/services/service-error.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

const mockRelations = {
  parent: { key: '10', title: 'Parent issue', state: 'open' },
  children: [{ key: '20', title: 'Child issue', state: 'open' }],
  blockedBy: [{ key: '30', title: 'Blocker issue', state: 'open' }],
  blocking: [],
  inheritedBlockedBy: [
    { key: '40', title: 'Inherited blocker', state: 'open', viaAncestorKey: '#10' },
  ],
};

const mockGetRelationsWithInherited = vi.fn().mockResolvedValue(mockRelations);

vi.mock('../../../src/server/services/issue-relations-service.js', () => ({
  getIssueRelationsService: () => ({
    getRelationsWithInherited: mockGetRelationsWithInherited,
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

const { registerGetRelationsTool } = await import(
  '../../../src/server/mcp/tools/get-relations.js'
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fleet_get_relations MCP tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredTools.length = 0;
  });

  it('registers with the correct tool name', () => {
    registerGetRelationsTool(mockMcpServer as any);

    expect(mockMcpServer.tool).toHaveBeenCalledOnce();
    expect(registeredTools).toHaveLength(1);
    expect(registeredTools[0]!.name).toBe('fleet_get_relations');
  });

  it('registers with a description', () => {
    registerGetRelationsTool(mockMcpServer as any);

    expect(registeredTools[0]!.description).toBeTruthy();
    expect(typeof registeredTools[0]!.description).toBe('string');
  });

  it('handler returns relations JSON', async () => {
    registerGetRelationsTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = (await handler({ projectId: 1, issueKey: '42' })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result).toHaveProperty('content');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toEqual(mockRelations);
  });

  it('handler passes projectId and issueKey to getRelationsWithInherited', async () => {
    registerGetRelationsTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    await handler({ projectId: 1, issueKey: '42' });

    expect(mockGetRelationsWithInherited).toHaveBeenCalledWith(1, '42');
  });

  it('handler exposes inheritedBlockedBy in the response', async () => {
    registerGetRelationsTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = (await handler({ projectId: 1, issueKey: '42' })) as {
      content: Array<{ type: string; text: string }>;
    };
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed).toHaveProperty('inheritedBlockedBy');
    expect(parsed.inheritedBlockedBy).toHaveLength(1);
    expect(parsed.inheritedBlockedBy[0].key).toBe('40');
    expect(parsed.inheritedBlockedBy[0].viaAncestorKey).toBe('#10');
  });

  it('handler returns isError on ServiceError', async () => {
    mockGetRelationsWithInherited.mockRejectedValueOnce(
      new ServiceError('Project 999 not found', 'NOT_FOUND', 404),
    );

    registerGetRelationsTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = (await handler({ projectId: 999, issueKey: '42' })) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Project 999 not found');
  });

  it('handler re-throws non-ServiceError exceptions', async () => {
    mockGetRelationsWithInherited.mockRejectedValueOnce(new Error('unexpected'));

    registerGetRelationsTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    await expect(handler({ projectId: 1, issueKey: '42' })).rejects.toThrow('unexpected');
  });
});
