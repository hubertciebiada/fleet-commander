// =============================================================================
// MCP Tool: fleet_get_team_timeline
// =============================================================================
// Returns a unified timeline merging stream events and hook events for a team.
//
// Input:  { teamId: number, limit?: number }
// Output: JSON array of timeline entries
//
// Service method: TeamService.getTeamTimeline(teamId, limit)
// =============================================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getTeamService } from '../../services/team-service.js';
import { ServiceError } from '../../services/service-error.js';

/**
 * Registers the `fleet_get_team_timeline` tool on the given MCP server.
 *
 * This tool accepts a team ID and optional limit, returning a merged timeline
 * of stream events and hook events for the specified team.
 */
export function registerGetTeamTimelineTool(server: McpServer): void {
  server.tool(
    'fleet_get_team_timeline',
    'Returns a unified timeline of stream and hook events for a team',
    {
      teamId: z.number().describe('The team ID to get the timeline for'),
      limit: z.number().optional().describe('Maximum number of timeline entries (default 500)'),
    },
    async ({ teamId, limit }) => {
      try {
        const service = getTeamService();
        const timeline = service.getTeamTimeline(teamId, limit);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(timeline, null, 2),
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
