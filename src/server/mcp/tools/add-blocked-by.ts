// =============================================================================
// MCP Tool: fleet_add_blocked_by
// =============================================================================
// Adds a blockedBy relation between two issues.
//
// Input:  { projectId: number, issueKey: string, blockerKey: string }
// Output: JSON { ok: true }
//
// Service method: IssueRelationsService.addBlockedBy(projectId, issueKey, blockerKey)
// =============================================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIssueRelationsService } from '../../services/issue-relations-service.js';
import { ServiceError } from '../../services/service-error.js';

/**
 * Registers the `fleet_add_blocked_by` tool on the given MCP server.
 *
 * This tool adds a blockedBy relation, indicating that the given issue
 * is blocked by the specified blocker issue.
 */
export function registerAddBlockedByTool(server: McpServer): void {
  server.tool(
    'fleet_add_blocked_by',
    'Adds a blockedBy relation between two issues',
    {
      projectId: z.number().describe('Numeric project ID'),
      issueKey: z.string().describe('Issue key of the blocked issue'),
      blockerKey: z.string().describe('Issue key of the blocker'),
    },
    async ({ projectId, issueKey, blockerKey }) => {
      try {
        const service = getIssueRelationsService();
        await service.addBlockedBy(projectId, issueKey, blockerKey);

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
