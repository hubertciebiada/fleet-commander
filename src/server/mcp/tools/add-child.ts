// =============================================================================
// MCP Tool: fleet_add_child
// =============================================================================
// Adds a child (sub-issue) to a parent issue.
//
// Input:  { projectId: number, parentKey: string, childKey: string }
// Output: JSON { ok: true }
//
// Service method: IssueRelationsService.addChild(projectId, parentKey, childKey)
// =============================================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIssueRelationsService } from '../../services/issue-relations-service.js';
import { ServiceError } from '../../services/service-error.js';

/**
 * Registers the `fleet_add_child` tool on the given MCP server.
 *
 * This tool adds a child (sub-issue) to the specified parent issue.
 */
export function registerAddChildTool(server: McpServer): void {
  server.tool(
    'fleet_add_child',
    'Adds a child (sub-issue) to a parent issue',
    {
      projectId: z.number().describe('Numeric project ID'),
      parentKey: z.string().describe('Issue key of the parent'),
      childKey: z.string().describe('Issue key of the child to add'),
    },
    async ({ projectId, parentKey, childKey }) => {
      try {
        const service = getIssueRelationsService();
        await service.addChild(projectId, parentKey, childKey);

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
