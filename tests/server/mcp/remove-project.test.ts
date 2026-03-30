// =============================================================================
// Fleet Commander — MCP remove-project Tool Tests
// =============================================================================
// Smoke tests for the fleet_remove_project MCP tool registration and handler.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceError } from '../../../src/server/services/service-error.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

const mockDeleteProject = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../src/server/services/project-service.js', () => ({
  getProjectService: () => ({
    deleteProject: mockDeleteProject,
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

const { registerRemoveProjectTool } = await import(
  '../../../src/server/mcp/tools/remove-project.js'
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fleet_remove_project MCP tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredTools.length = 0;
  });

  it('registers with the correct tool name', () => {
    registerRemoveProjectTool(mockMcpServer as any);

    expect(mockMcpServer.tool).toHaveBeenCalledOnce();
    expect(registeredTools).toHaveLength(1);
    expect(registeredTools[0]!.name).toBe('fleet_remove_project');
  });

  it('registers with a description', () => {
    registerRemoveProjectTool(mockMcpServer as any);

    expect(registeredTools[0]!.description).toBeTruthy();
    expect(typeof registeredTools[0]!.description).toBe('string');
  });

  it('handler returns ok result on success', async () => {
    registerRemoveProjectTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = (await handler({ projectId: 7 })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result).toHaveProperty('content');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toEqual({ ok: true, projectId: 7 });
  });

  it('handler passes projectId to deleteProject', async () => {
    registerRemoveProjectTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    await handler({ projectId: 7 });

    expect(mockDeleteProject).toHaveBeenCalledWith(7);
  });

  it('handler returns isError on ServiceError', async () => {
    mockDeleteProject.mockRejectedValueOnce(
      new ServiceError('Project 999 not found', 'NOT_FOUND', 404),
    );

    registerRemoveProjectTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = (await handler({ projectId: 999 })) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Project 999 not found');
  });

  it('handler re-throws non-ServiceError exceptions', async () => {
    mockDeleteProject.mockRejectedValueOnce(new Error('unexpected'));

    registerRemoveProjectTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    await expect(handler({ projectId: 7 })).rejects.toThrow('unexpected');
  });
});
