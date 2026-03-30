// =============================================================================
// MCP Tool: fleet_remove_child
// =============================================================================
// Removes a child (sub-issue) from a parent issue.
//
// Input:  { projectId: number, parentKey: string, childKey: string }
// Output: JSON { ok: true }
//
// Service method: IssueRelationsService.removeChild(projectId, parentKey, childKey)
// =============================================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIssueRelationsService } from '../../services/issue-relations-service.js';
import { ServiceError } from '../../services/service-error.js';

/**
 * Registers the `fleet_remove_child` tool on the given MCP server.
 *
 * This tool removes a child (sub-issue) from the specified parent issue.
 */
export function registerRemoveChildTool(server: McpServer): void {
  server.tool(
    'fleet_remove_child',
    'Removes a child (sub-issue) from a parent issue',
    {
      projectId: z.number().describe('Numeric project ID'),
      parentKey: z.string().describe('Issue key of the parent'),
      childKey: z.string().describe('Issue key of the child to remove'),
    },
    async ({ projectId, parentKey, childKey }) => {
      try {
        const service = getIssueRelationsService();
        await service.removeChild(projectId, parentKey, childKey);

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
