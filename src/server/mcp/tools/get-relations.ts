// =============================================================================
// MCP Tool: fleet_get_relations
// =============================================================================
// Gets all relations (parent, children, blockedBy, blocking, inheritedBlockedBy)
// for an issue. `inheritedBlockedBy` surfaces blockers that apply to this issue
// through its ancestor chain (parent, grandparent, ...) — matching what the
// batch tree API and launch guard use to decide whether an issue is blocked.
//
// Input:  { projectId: number, issueKey: string }
// Output: JSON IssueRelationsWithInherited object
//
// Service method:
//   IssueRelationsService.getRelationsWithInherited(projectId, issueKey)
// =============================================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIssueRelationsService } from '../../services/issue-relations-service.js';
import { ServiceError } from '../../services/service-error.js';

/**
 * Registers the `fleet_get_relations` tool on the given MCP server.
 *
 * This tool retrieves all issue relations (parent, children, blockedBy,
 * blocking, inheritedBlockedBy) for a specific issue within a project.
 */
export function registerGetRelationsTool(server: McpServer): void {
  server.tool(
    'fleet_get_relations',
    'Gets all relations for an issue: parent, children, blockedBy, blocking, and inheritedBlockedBy (blockers inherited via the ancestor chain).',
    {
      projectId: z.number().describe('Numeric project ID'),
      issueKey: z.string().describe('Issue key (e.g. "42" for GitHub, "PROJ-123" for Jira)'),
    },
    async ({ projectId, issueKey }) => {
      try {
        const service = getIssueRelationsService();
        const relations = await service.getRelationsWithInherited(projectId, issueKey);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(relations, null, 2),
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
