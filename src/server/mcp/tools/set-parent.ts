// =============================================================================
// MCP Tool: fleet_set_parent
// =============================================================================
// Sets the parent issue for a given issue.
//
// Input:  { projectId: number, issueKey: string, parentKey: string }
// Output: JSON { ok: true }
//
// Service method: IssueRelationsService.setParent(projectId, issueKey, parentKey)
// =============================================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIssueRelationsService } from '../../services/issue-relations-service.js';
import { ServiceError } from '../../services/service-error.js';

/**
 * Registers the `fleet_set_parent` tool on the given MCP server.
 *
 * This tool sets the parent (super-issue) for the specified issue.
 */
export function registerSetParentTool(server: McpServer): void {
  server.tool(
    'fleet_set_parent',
    'Sets the parent issue for a given issue',
    {
      projectId: z.number().describe('Numeric project ID'),
      issueKey: z.string().describe('Issue key of the child issue'),
      parentKey: z.string().describe('Issue key of the parent'),
    },
    async ({ projectId, issueKey, parentKey }) => {
      try {
        const service = getIssueRelationsService();
        await service.setParent(projectId, issueKey, parentKey);

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
