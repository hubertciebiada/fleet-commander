// =============================================================================
// MCP Tool: fleet_get_relations
// =============================================================================
// Gets all relations (parent, children, blockedBy, blocking) for an issue.
//
// Input:  { projectId: number, issueKey: string }
// Output: JSON IssueRelations object
//
// Service method: IssueRelationsService.getRelations(projectId, issueKey)
// =============================================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getIssueRelationsService } from '../../services/issue-relations-service.js';
import { ServiceError } from '../../services/service-error.js';

/**
 * Registers the `fleet_get_relations` tool on the given MCP server.
 *
 * This tool retrieves all issue relations (parent, children, blockedBy,
 * blocking) for a specific issue within a project.
 */
export function registerGetRelationsTool(server: McpServer): void {
  server.tool(
    'fleet_get_relations',
    'Gets all relations (parent, children, blockedBy, blocking) for an issue',
    {
      projectId: z.number().describe('Numeric project ID'),
      issueKey: z.string().describe('Issue key (e.g. "42" for GitHub, "PROJ-123" for Jira)'),
    },
    async ({ projectId, issueKey }) => {
      try {
        const service = getIssueRelationsService();
        const relations = await service.getRelations(projectId, issueKey);

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
