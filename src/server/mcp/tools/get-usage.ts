// =============================================================================
// MCP Tool: fleet_get_usage
// =============================================================================
// Returns current usage percentages with zone indicator and red thresholds.
//
// Input:  (none)
// Output: JSON { dailyPercent, weeklyPercent, sonnetPercent, extraPercent,
//                recordedAt, zone, redThresholds }
//
// Service method: UsageService.getLatest()
// =============================================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getUsageService } from '../../services/usage-service.js';

/**
 * Registers the `fleet_get_usage` tool on the given MCP server.
 *
 * This is a zero-argument tool that returns the current usage percentages
 * (daily, weekly, sonnet, extra) with zone indicator and red thresholds.
 */
export function registerGetUsageTool(server: McpServer): void {
  server.tool(
    'fleet_get_usage',
    'Get current usage percentages (daily, weekly, sonnet, extra) with zone indicator',
    async () => {
      const usageService = getUsageService();
      const usage = usageService.getLatest();

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(usage, null, 2),
          },
        ],
      };
    },
  );
}
