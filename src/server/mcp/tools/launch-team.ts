// =============================================================================
// MCP Tool: fleet_launch_team
// =============================================================================
// Launches a new agent team for a GitHub issue.
//
// Input:  { projectId: number, issueNumber: number, headless?: boolean, force?: boolean }
// Output: JSON result from TeamService.launchTeam
//
// Service method: TeamService.launchTeam(params)
// =============================================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getTeamService } from '../../services/team-service.js';
import { ServiceError } from '../../services/service-error.js';

/**
 * Registers the `fleet_launch_team` tool on the given MCP server.
 *
 * This tool launches a new agent team for a GitHub issue within a project.
 */
export function registerLaunchTeamTool(server: McpServer): void {
  server.tool(
    'fleet_launch_team',
    'Launches a new agent team for a GitHub issue within a project',
    {
      projectId: z.number().describe('Numeric ID of the project to launch the team in'),
      issueNumber: z.number().describe('GitHub issue number to assign the team to'),
      headless: z.boolean().optional().describe('Run without a visible terminal window'),
      force: z.boolean().optional().describe('Bypass dependency checks and force launch'),
    },
    async ({ projectId, issueNumber, headless, force }) => {
      try {
        const service = getTeamService();
        const result = await service.launchTeam({ projectId, issueNumber, headless, force });

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
