// =============================================================================
// Fleet Commander — State Machine Routes
// =============================================================================
// Returns the team lifecycle state machine definition with transitions
// and associated message templates. Templates are stored in the database
// and can be edited via the PUT endpoint.
// =============================================================================

import type {
  FastifyInstance,
  FastifyPluginCallback,
  FastifyRequest,
  FastifyReply,
} from 'fastify';
import { getDatabase } from '../db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MessageTemplate {
  id: string;
  template: string;
  enabled: boolean;
  placeholders: string[];
}

interface Transition {
  id: string;
  from: string;
  to: string;
  trigger: 'hook' | 'timer' | 'poller' | 'pm_action' | 'system';
  triggerLabel: string;
  description: string;
  condition: string;
  hookEvent: string | null;
  messageTemplate: MessageTemplate | null;
}

// ---------------------------------------------------------------------------
// Static state machine definition (defaults)
// ---------------------------------------------------------------------------

const TRANSITIONS: Transition[] = [
  {
    id: 'queued-launching',
    from: 'queued',
    to: 'launching',
    trigger: 'system',
    triggerLabel: 'Queue processor',
    description: 'Team slot becomes available; next queued team is launched',
    condition: 'Active teams < maxActiveTeams for project',
    hookEvent: null,
    messageTemplate: null,
  },
  {
    id: 'launching-running',
    from: 'launching',
    to: 'running',
    trigger: 'hook',
    triggerLabel: 'First hook event received',
    description: 'Claude Code process starts and sends its first lifecycle hook',
    condition: 'Process PID is alive and first event arrives',
    hookEvent: 'session_start',
    messageTemplate: {
      id: 'tpl-launching-running',
      template: 'Team {{TEAM_ID}} is now running on issue #{{ISSUE_NUMBER}} ({{ISSUE_TITLE}})',
      enabled: true,
      placeholders: ['TEAM_ID', 'ISSUE_NUMBER', 'ISSUE_TITLE', 'WORKTREE_NAME'],
    },
  },
  {
    id: 'running-idle',
    from: 'running',
    to: 'idle',
    trigger: 'timer',
    triggerLabel: 'Idle threshold exceeded',
    description: 'No hook events received within the idle threshold period',
    condition: 'lastEventAt + idleThresholdMin < now',
    hookEvent: null,
    messageTemplate: {
      id: 'tpl-running-idle',
      template: 'Team {{TEAM_ID}} has gone idle on issue #{{ISSUE_NUMBER}} (no activity for {{IDLE_MINUTES}} min)',
      enabled: true,
      placeholders: ['TEAM_ID', 'ISSUE_NUMBER', 'IDLE_MINUTES'],
    },
  },
  {
    id: 'idle-running',
    from: 'idle',
    to: 'running',
    trigger: 'hook',
    triggerLabel: 'Activity resumes',
    description: 'A new hook event is received from the idle team',
    condition: 'New hook event arrives',
    hookEvent: 'tool_use',
    messageTemplate: null,
  },
  {
    id: 'running-done',
    from: 'running',
    to: 'done',
    trigger: 'hook',
    triggerLabel: 'Session ends successfully',
    description: 'Claude Code session completes normally with exit code 0',
    condition: 'Process exits with code 0 or session_end event',
    hookEvent: 'session_end',
    messageTemplate: {
      id: 'tpl-running-done',
      template: 'Team {{TEAM_ID}} completed issue #{{ISSUE_NUMBER}}. PR: #{{PR_NUMBER}}',
      enabled: true,
      placeholders: ['TEAM_ID', 'ISSUE_NUMBER', 'ISSUE_TITLE', 'PR_NUMBER', 'BRANCH_NAME'],
    },
  },
  {
    id: 'idle-stuck',
    from: 'idle',
    to: 'stuck',
    trigger: 'timer',
    triggerLabel: 'Stuck threshold exceeded',
    description: 'Team has been idle beyond the stuck detection threshold',
    condition: 'lastEventAt + stuckThresholdMin < now',
    hookEvent: null,
    messageTemplate: {
      id: 'tpl-idle-stuck',
      template: 'Team {{TEAM_ID}} is STUCK on issue #{{ISSUE_NUMBER}} (no activity for {{STUCK_MINUTES}} min)',
      enabled: true,
      placeholders: ['TEAM_ID', 'ISSUE_NUMBER', 'STUCK_MINUTES'],
    },
  },
  {
    id: 'stuck-failed',
    from: 'stuck',
    to: 'failed',
    trigger: 'pm_action',
    triggerLabel: 'PM marks team as failed',
    description: 'PM decides stuck team cannot recover and stops it',
    condition: 'Manual PM action via API',
    hookEvent: null,
    messageTemplate: {
      id: 'tpl-stuck-failed',
      template: 'Team {{TEAM_ID}} failed on issue #{{ISSUE_NUMBER}}. Reason: stuck and unrecoverable.',
      enabled: true,
      placeholders: ['TEAM_ID', 'ISSUE_NUMBER', 'ISSUE_TITLE'],
    },
  },
  {
    id: 'stuck-running',
    from: 'stuck',
    to: 'running',
    trigger: 'pm_action',
    triggerLabel: 'PM restarts team',
    description: 'PM sends a nudge or restarts the team to recover from stuck state',
    condition: 'Manual PM action via API or new hook event',
    hookEvent: null,
    messageTemplate: null,
  },
  {
    id: 'running-failed',
    from: 'running',
    to: 'failed',
    trigger: 'system',
    triggerLabel: 'Process crash or CI failure limit',
    description: 'Claude Code process exits with non-zero code or CI failures exceed threshold',
    condition: 'Process exits abnormally or ciFailCount >= maxUniqueCiFailures',
    hookEvent: null,
    messageTemplate: {
      id: 'tpl-running-failed',
      template: 'Team {{TEAM_ID}} failed on issue #{{ISSUE_NUMBER}}. Exit code: {{EXIT_CODE}}',
      enabled: true,
      placeholders: ['TEAM_ID', 'ISSUE_NUMBER', 'ISSUE_TITLE', 'EXIT_CODE'],
    },
  },
  {
    id: 'launching-failed',
    from: 'launching',
    to: 'failed',
    trigger: 'system',
    triggerLabel: 'Launch failure',
    description: 'Claude Code process fails to start or crashes immediately',
    condition: 'Process exits before first event or spawn error',
    hookEvent: null,
    messageTemplate: {
      id: 'tpl-launching-failed',
      template: 'Team {{TEAM_ID}} failed to launch for issue #{{ISSUE_NUMBER}}',
      enabled: true,
      placeholders: ['TEAM_ID', 'ISSUE_NUMBER', 'ISSUE_TITLE'],
    },
  },
  {
    id: 'idle-done',
    from: 'idle',
    to: 'done',
    trigger: 'poller',
    triggerLabel: 'PR merged detected by poller',
    description: 'GitHub poller detects PR has been merged while team was idle',
    condition: 'PR state = merged',
    hookEvent: null,
    messageTemplate: {
      id: 'tpl-idle-done',
      template: 'Team {{TEAM_ID}} completed (PR #{{PR_NUMBER}} merged) for issue #{{ISSUE_NUMBER}}',
      enabled: true,
      placeholders: ['TEAM_ID', 'ISSUE_NUMBER', 'PR_NUMBER'],
    },
  },
];

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

        // Apply database overrides to message templates
        const transitions = TRANSITIONS.map((t) => {
          if (t.messageTemplate) {
            const dbTmpl = db.getMessageTemplate(t.messageTemplate.id);
            if (dbTmpl) {
              return {
                ...t,
                messageTemplate: {
                  ...t.messageTemplate,
                  template: dbTmpl.template,
                  enabled: dbTmpl.enabled,
                },
              };
            }
          }
          return t;
        });

        return reply.code(200).send({
          states: [
            { id: 'queued', label: 'Queued', color: '#8B949E' },
            { id: 'launching', label: 'Launching', color: '#58A6FF' },
            { id: 'running', label: 'Running', color: '#3FB950' },
            { id: 'idle', label: 'Idle', color: '#D29922' },
            { id: 'stuck', label: 'Stuck', color: '#F85149' },
            { id: 'done', label: 'Done', color: '#56D4DD' },
            { id: 'failed', label: 'Failed', color: '#F85149' },
          ],
          transitions,
        });
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
  // PUT /api/message-templates/:id — update a message template in the DB
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

        // Verify the template exists in DB
        const existing = db.getMessageTemplate(id);
        if (!existing) {
          return reply.code(404).send({
            error: 'Not Found',
            message: `Message template '${id}' not found`,
          });
        }

        db.updateMessageTemplate(id, {
          template: body.template,
          enabled: body.enabled,
        });

        // Return the updated template
        const updated = db.getMessageTemplates().find((t) => t.id === id);
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
