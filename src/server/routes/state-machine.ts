// =============================================================================
// Fleet Commander — State Machine Routes
// =============================================================================
// Returns the team lifecycle state machine definition with transitions
// and associated message templates. Templates are stored in the database
// and can be edited via the PUT endpoint. All transition definitions come
// from the shared STATE_MACHINE_TRANSITIONS — there are no inline copies.
// =============================================================================

import type {
  FastifyInstance,
  FastifyPluginCallback,
  FastifyRequest,
  FastifyReply,
} from 'fastify';
import { getDatabase } from '../db.js';
import {
  STATES,
  STATE_MACHINE_TRANSITIONS,
} from '../../shared/state-machine.js';

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const stateMachineRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts: Record<string, unknown>,
  done: (err?: Error) => void,
) => {
  // -------------------------------------------------------------------------
  // GET /api/state-machine — full state machine definition enriched with DB templates
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/state-machine',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const db = getDatabase();
        const dbTemplates = db.getMessageTemplates();
        const templateMap = new Map(dbTemplates.map((t) => [t.id, t]));

        const transitions = STATE_MACHINE_TRANSITIONS.map((t) => {
          const dbTmpl = templateMap.get(t.id);

          return {
            id: t.id,
            from: t.from,
            to: t.to,
            trigger: t.trigger,
            triggerLabel: t.triggerLabel,
            description: t.description,
            condition: t.condition,
            hookEvent: t.hookEvent ?? null,
            // Attach message template only when this transition has one
            messageTemplate: t.message
              ? {
                  id: t.id,
                  template: dbTmpl?.template ?? t.message,
                  enabled: dbTmpl?.enabled ?? true,
                  placeholders: t.placeholders ?? [],
                  isDefault: !dbTmpl,
                }
              : null,
          };
        });

        return reply.code(200).send({ states: STATES, transitions });
      } catch (err: unknown) {
        _request.log.error(err, 'Failed to get state machine');
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/message-templates — all message templates from DB
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/message-templates',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const db = getDatabase();
        const templates = db.getMessageTemplates();
        return reply.code(200).send(templates);
      } catch (err: unknown) {
        _request.log.error(err, 'Failed to get message templates');
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // PUT /api/message-templates/:id — upsert a message template in the DB
  // -------------------------------------------------------------------------
  fastify.put(
    '/api/message-templates/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = request.params as { id: string };
        const body = request.body as { template?: string; enabled?: boolean } | null;

        if (!body || (body.template === undefined && body.enabled === undefined)) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'Body must include at least one of: template, enabled',
          });
        }

        const db = getDatabase();
        const existing = db.getMessageTemplate(id);

        if (existing) {
          // Update the existing row
          db.updateMessageTemplate(id, {
            template: body.template,
            enabled: body.enabled,
          });
        } else {
          // Template not yet in DB — look up the default from state machine
          const transition = STATE_MACHINE_TRANSITIONS.find((t) => t.id === id);
          if (!transition?.message) {
            return reply.code(404).send({
              error: 'Not Found',
              message: `No state machine transition with message for id '${id}'`,
            });
          }

          // Insert a new row with the provided overrides
          db.insertMessageTemplate({
            id,
            template: body.template ?? transition.message,
            enabled: body.enabled ?? true,
          });
        }

        // Return the updated/inserted template
        const updated = db.getMessageTemplate(id);
        return reply.code(200).send(updated);
      } catch (err: unknown) {
        request.log.error(err, 'Failed to update message template');
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  done();
};

export default stateMachineRoutes;
