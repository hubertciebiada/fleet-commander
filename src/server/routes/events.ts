// =============================================================================
// Fleet Commander -- Event Routes (POST /api/events + GET /api/events)
// =============================================================================
// Fastify plugin that registers the event collector endpoints.
// POST receives hook events from Claude Code instances via send_event.sh.
// GET queries stored events with optional filters.
// =============================================================================

import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { processEvent, validatePayload, PayloadError } from '../services/event-collector.js';
import { getDatabase } from '../db.js';

// ---------------------------------------------------------------------------
// Query string interface for GET /api/events
// ---------------------------------------------------------------------------

interface EventQuerystring {
  team_id?: string;
  type?: string;
  since?: string;
  limit?: string;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const eventsRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts: Record<string, unknown>,
  done: (err?: Error) => void
) => {
  // -------------------------------------------------------------------------
  // POST /api/events -- receive a hook event
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/events',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Validate the incoming payload
        const payload = validatePayload(request.body);

        // Process the event (insert, resolve team, apply transitions)
        const result = processEvent(payload);

        return reply.code(200).send(result);
      } catch (err: unknown) {
        if (err instanceof PayloadError) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: err.message,
          });
        }

        // Unexpected errors: log and return 500 but never crash
        request.log.error(err, 'Unexpected error processing event');
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Failed to process event',
        });
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /api/events -- query events with filters
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/events',
    async (
      request: FastifyRequest<{ Querystring: EventQuerystring }>,
      reply: FastifyReply
    ) => {
      try {
        const query = request.query;
        const db = getDatabase();

        // Parse optional filters
        const teamId = query.team_id ? parseInt(query.team_id, 10) : undefined;
        const eventType = query.type || undefined;
        const since = query.since || undefined;
        const limit = query.limit ? parseInt(query.limit, 10) : 100;

        // Validate parsed numbers
        if (query.team_id && (isNaN(teamId!) || teamId! < 1)) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'Invalid team_id parameter',
          });
        }
        if (query.limit && (isNaN(limit) || limit < 1)) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'Invalid limit parameter',
          });
        }

        const events = db.getAllEvents({
          teamId,
          eventType,
          since,
          limit,
        });

        return reply.code(200).send(events);
      } catch (err: unknown) {
        request.log.error(err, 'Unexpected error querying events');
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Failed to query events',
        });
      }
    }
  );

  done();
};

export default eventsRoutes;
