// =============================================================================
// Fleet Commander — MCP install-project Tool Tests
// =============================================================================
// Smoke tests for the fleet_install_project MCP tool registration and handler.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceError } from '../../../src/server/services/service-error.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

const mockInstallResult = {
  ok: true,
  output: 'Hooks installed successfully',
  installStatus: {
    hooks: { installed: true },
    prompt: { installed: true },
  },
};

const mockInstallHooksForProject = vi.fn().mockReturnValue(mockInstallResult);

vi.mock('../../../src/server/services/project-service.js', () => ({
  getProjectService: () => ({
    installHooksForProject: mockInstallHooksForProject,
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

const { registerInstallProjectTool } = await import(
  '../../../src/server/mcp/tools/install-project.js'
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fleet_install_project MCP tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredTools.length = 0;
  });

  it('registers with the correct tool name', () => {
    registerInstallProjectTool(mockMcpServer as any);

    expect(mockMcpServer.tool).toHaveBeenCalledOnce();
    expect(registeredTools).toHaveLength(1);
    expect(registeredTools[0]!.name).toBe('fleet_install_project');
  });

  it('registers with a description', () => {
    registerInstallProjectTool(mockMcpServer as any);

    expect(registeredTools[0]!.description).toBeTruthy();
    expect(typeof registeredTools[0]!.description).toBe('string');
  });

  it('handler returns install result JSON', async () => {
    registerInstallProjectTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = (await handler({ projectId: 3 })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result).toHaveProperty('content');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toEqual(mockInstallResult);
  });

  it('handler passes projectId to installHooksForProject', async () => {
    registerInstallProjectTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    await handler({ projectId: 3 });

    expect(mockInstallHooksForProject).toHaveBeenCalledWith(3);
  });

  it('handler returns isError on ServiceError', async () => {
    mockInstallHooksForProject.mockImplementationOnce(() => {
      throw new ServiceError('Project 999 not found', 'NOT_FOUND', 404);
    });

    registerInstallProjectTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = (await handler({ projectId: 999 })) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Project 999 not found');
  });

  it('handler re-throws non-ServiceError exceptions', async () => {
    mockInstallHooksForProject.mockImplementationOnce(() => {
      throw new Error('unexpected');
    });

    registerInstallProjectTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    await expect(handler({ projectId: 3 })).rejects.toThrow('unexpected');
  });
});
