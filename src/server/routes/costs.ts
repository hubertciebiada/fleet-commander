// =============================================================================
// Fleet Commander — Cost Routes (aggregated cost data)
// =============================================================================
// Fastify plugin that registers cost-related API endpoints:
// aggregated costs, per-team breakdown, daily aggregation.
// =============================================================================

import type {
  FastifyInstance,
  FastifyPluginCallback,
  FastifyRequest,
  FastifyReply,
} from 'fastify';
import { getDatabase } from '../db.js';

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const costsRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts: Record<string, unknown>,
  done: (err?: Error) => void,
) => {
  // -------------------------------------------------------------------------
  // GET /api/costs — aggregated costs (overall summary)
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/costs',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const db = getDatabase();
        const summary = db.getCostSummary();

        return reply.code(200).send(summary);
      } catch (err: unknown) {
        _request.log.error(err, 'Failed to get cost summary');
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/costs/by-team — per-team cost breakdown
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/costs/by-team',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const db = getDatabase();
        const breakdown = db.getCostByTeamBreakdown();

        return reply.code(200).send({
          count: breakdown.length,
          teams: breakdown,
        });
      } catch (err: unknown) {
        _request.log.error(err, 'Failed to get per-team cost breakdown');
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/costs/by-day — daily cost aggregation
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/costs/by-day',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const db = getDatabase();
        const daily = db.getCostByDay();

        return reply.code(200).send({
          count: daily.length,
          days: daily,
        });
      } catch (err: unknown) {
        _request.log.error(err, 'Failed to get daily cost data');
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  done();
};

export default costsRoutes;
