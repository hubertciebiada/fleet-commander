// =============================================================================
// MCP Tool: fleet_install_project
// =============================================================================
// Installs (or reinstalls) Fleet Commander hooks for a project.
//
// Input:  { projectId: number }
// Output: JSON { ok, output, error?, installStatus }
//
// Service method: ProjectService.installHooksForProject(projectId)
// =============================================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getProjectService } from '../../services/project-service.js';
import { ServiceError } from '../../services/service-error.js';

/**
 * Registers the `fleet_install_project` tool on the given MCP server.
 *
 * This tool installs or reinstalls Fleet Commander hooks and prompt
 * files for the project identified by its numeric ID.
 */
export function registerInstallProjectTool(server: McpServer): void {
  server.tool(
    'fleet_install_project',
    'Installs or reinstalls Fleet Commander hooks for a project',
    {
      projectId: z.number().describe('Numeric ID of the project to install/reinstall hooks for'),
    },
    async ({ projectId }) => {
      try {
        const service = getProjectService();
        const result = service.installHooksForProject(projectId);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
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
