// =============================================================================
// MCP Tool: fleet_remove_project
// =============================================================================
// Removes a project (git repository) from Fleet Commander.
//
// Input:  { projectId: number }
// Output: JSON { ok: true, projectId }
//
// Service method: ProjectService.deleteProject(projectId)
// =============================================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getProjectService } from '../../services/project-service.js';
import { ServiceError } from '../../services/service-error.js';

/**
 * Registers the `fleet_remove_project` tool on the given MCP server.
 *
 * This tool removes a project identified by its numeric ID, including
 * uninstalling hooks and cleaning up associated teams.
 */
export function registerRemoveProjectTool(server: McpServer): void {
  server.tool(
    'fleet_remove_project',
    'Removes a project from Fleet Commander by its numeric ID',
    {
      projectId: z.number().describe('Numeric ID of the project to remove'),
    },
    async ({ projectId }) => {
      try {
        const service = getProjectService();
        await service.deleteProject(projectId);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true, projectId }, null, 2),
            },
          ],
        };
      } catch (err) {
        if (err instanceof ServiceError) {
          return {
            content: [{ type: 'text' as const, text: err.message }],
            isError: true,
          };
        }
        throw err;
      }
    },
  );
}
