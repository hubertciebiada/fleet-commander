// =============================================================================
// MCP Tool: fleet_remove_blocked_by
// =============================================================================
// Removes a blockedBy relation between two issues.
//
// Input:  { projectId: number, issueKey: string, blockerKey: string }
// Output: JSON { ok: true }
//
// Service method: IssueRelationsService.removeBlockedBy(projectId, issueKey, blockerKey)
// =============================================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIssueRelationsService } from '../../services/issue-relations-service.js';
import { ServiceError } from '../../services/service-error.js';

/**
 * Registers the `fleet_remove_blocked_by` tool on the given MCP server.
 *
 * This tool removes a blockedBy relation between two issues.
 */
export function registerRemoveBlockedByTool(server: McpServer): void {
  server.tool(
    'fleet_remove_blocked_by',
    'Removes a blockedBy relation between two issues',
    {
      projectId: z.number().describe('Numeric project ID'),
      issueKey: z.string().describe('Issue key of the blocked issue'),
      blockerKey: z.string().describe('Issue key of the blocker to remove'),
    },
    async ({ projectId, issueKey, blockerKey }) => {
      try {
        const service = getIssueRelationsService();
        await service.removeBlockedBy(projectId, issueKey, blockerKey);

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
