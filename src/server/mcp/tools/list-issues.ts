// =============================================================================
// MCP Tool: fleet_list_issues
// =============================================================================
// Returns the issue hierarchy for a specific project, enriched with team info.
//
// Input:  { projectId: number }
// Output: JSON issue tree with metadata (projectId, projectName, tree, cachedAt, count)
//
// Service method: IssueService.getProjectIssues(projectId)  (async)
// =============================================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIssueService } from '../../services/issue-service.js';
import { ServiceError } from '../../services/service-error.js';

/**
 * Registers the `fleet_list_issues` tool on the given MCP server.
 *
 * This tool accepts a project ID and returns the full issue hierarchy
 * for that project, enriched with active team information.
 */
export function registerListIssuesTool(server: McpServer): void {
  server.tool(
    'fleet_list_issues',
    'Returns the issue hierarchy for a project, enriched with team info',
    {
      projectId: z.number().describe('The project ID to list issues for'),
    },
    async ({ projectId }) => {
      try {
        const service = getIssueService();
        const result = await service.getProjectIssues(projectId);

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
