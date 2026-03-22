// =============================================================================
// Fleet Commander — MCP add-project Tool Tests
// =============================================================================
// Smoke tests for the fleet_add_project MCP tool registration and handler.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceError } from '../../../src/server/services/service-error.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

const mockCreatedProject = {
  id: 1,
  name: 'my-repo',
  repoPath: '/repos/my-repo',
  githubRepo: 'owner/my-repo',
  maxActiveTeams: 5,
  model: null,
};

const mockCreateProject = vi.fn().mockReturnValue(mockCreatedProject);

vi.mock('../../../src/server/services/project-service.js', () => ({
  getProjectService: () => ({
    createProject: mockCreateProject,
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

const { registerAddProjectTool } = await import(
  '../../../src/server/mcp/tools/add-project.js'
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fleet_add_project MCP tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredTools.length = 0;
  });

  it('registers with the correct tool name', () => {
    registerAddProjectTool(mockMcpServer as any);

    expect(mockMcpServer.tool).toHaveBeenCalledOnce();
    expect(registeredTools).toHaveLength(1);
    expect(registeredTools[0]!.name).toBe('fleet_add_project');
  });

  it('registers with a description', () => {
    registerAddProjectTool(mockMcpServer as any);

    expect(registeredTools[0]!.description).toBeTruthy();
    expect(typeof registeredTools[0]!.description).toBe('string');
  });

  it('handler returns valid project JSON', async () => {
    registerAddProjectTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = (await handler({ repoPath: '/repos/my-repo' })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result).toHaveProperty('content');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toEqual(mockCreatedProject);
  });

  it('handler passes correct data to createProject with all fields', async () => {
    registerAddProjectTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    await handler({
      repoPath: '/repos/my-repo',
      name: 'Custom Name',
      githubRepo: 'owner/repo',
      maxActiveTeams: 10,
      model: 'opus',
    });

    expect(mockCreateProject).toHaveBeenCalledWith({
      name: 'Custom Name',
      repoPath: '/repos/my-repo',
      githubRepo: 'owner/repo',
      maxActiveTeams: 10,
      model: 'opus',
    });
  });

  it('handler defaults name to directory basename when not provided', async () => {
    registerAddProjectTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    await handler({ repoPath: '/repos/my-repo' });

    expect(mockCreateProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my-repo' }),
    );
  });

  it('handler returns isError on ServiceError', async () => {
    mockCreateProject.mockImplementationOnce(() => {
      throw new ServiceError('Path does not exist: /bad/path', 'VALIDATION', 400);
    });

    registerAddProjectTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = (await handler({ repoPath: '/bad/path' })) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Path does not exist: /bad/path');
  });

  it('handler returns isError on conflict ServiceError', async () => {
    mockCreateProject.mockImplementationOnce(() => {
      throw new ServiceError('A project already exists for this path', 'CONFLICT', 409);
    });

    registerAddProjectTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    const result = (await handler({ repoPath: '/repos/existing' })) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('already exists');
  });

  it('handler re-throws non-ServiceError exceptions', async () => {
    mockCreateProject.mockImplementationOnce(() => {
      throw new Error('unexpected');
    });

    registerAddProjectTool(mockMcpServer as any);

    const handler = registeredTools[0]!.handler;
    await expect(handler({ repoPath: '/repos/my-repo' })).rejects.toThrow('unexpected');
  });
});
