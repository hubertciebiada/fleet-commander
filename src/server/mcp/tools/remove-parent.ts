// =============================================================================
// MCP Tool: fleet_remove_parent
// =============================================================================
// Removes the parent from an issue.
//
// Input:  { projectId: number, issueKey: string }
// Output: JSON { ok: true }
//
// Service method: IssueRelationsService.removeParent(projectId, issueKey)
// =============================================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIssueRelationsService } from '../../services/issue-relations-service.js';
import { ServiceError } from '../../services/service-error.js';

/**
 * Registers the `fleet_remove_parent` tool on the given MCP server.
 *
 * This tool removes the parent (super-issue) from the specified issue.
 */
export function registerRemoveParentTool(server: McpServer): void {
  server.tool(
    'fleet_remove_parent',
    'Removes the parent from an issue',
    {
      projectId: z.number().describe('Numeric project ID'),
      issueKey: z.string().describe('Issue key to remove the parent from'),
    },
    async ({ projectId, issueKey }) => {
      try {
        const service = getIssueRelationsService();
        await service.removeParent(projectId, issueKey);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: true }, null, 2),
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
