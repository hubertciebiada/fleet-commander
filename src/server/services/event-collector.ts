// =============================================================================
// Fleet Commander -- Event Collector Service
// =============================================================================
// Business logic for processing incoming hook events from Claude Code instances.
// Receives parsed payloads, resolves teams, inserts events, and applies state
// machine transitions per docs/state-machines.md.
// =============================================================================

import { getDatabase } from '../db.js';
import type { Team } from '../../shared/types.js';

// ---------------------------------------------------------------------------
// Payload shape (matches hooks/DESIGN.md section 2.2)
// ---------------------------------------------------------------------------

export interface EventPayload {
  event: string;
  team: string;
  timestamp?: string;
  session_id?: string;
  tool_name?: string;
  agent_type?: string;
  teammate_name?: string;
  message?: string;
  stop_reason?: string;
  worktree_root?: string;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ProcessEventResult {
  event_id: number;
  team_id: number;
  processed: true;
}

// ---------------------------------------------------------------------------
// Recognised event types (hooks/DESIGN.md section 2.2)
// ---------------------------------------------------------------------------

const VALID_EVENT_TYPES = new Set([
  'session_start',
  'session_end',
  'stop',
  'subagent_start',
  'subagent_stop',
  'notification',
  'tool_use',
  'tool_error',
  'pre_compact',
]);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validatePayload(body: unknown): EventPayload {
  if (body === null || body === undefined || typeof body !== 'object') {
    throw new PayloadError('Request body must be a JSON object');
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.event !== 'string' || obj.event.length === 0) {
    throw new PayloadError('Missing or invalid "event" field');
  }

  if (typeof obj.team !== 'string' || obj.team.length === 0) {
    throw new PayloadError('Missing or invalid "team" field');
  }

  if (!VALID_EVENT_TYPES.has(obj.event)) {
    throw new PayloadError(
      `Unknown event type "${obj.event}". Valid types: ${[...VALID_EVENT_TYPES].join(', ')}`
    );
  }

  return {
    event: obj.event,
    team: obj.team,
    timestamp: optString(obj.timestamp),
    session_id: optString(obj.session_id),
    tool_name: optString(obj.tool_name),
    agent_type: optString(obj.agent_type),
    teammate_name: optString(obj.teammate_name),
    message: optString(obj.message),
    stop_reason: optString(obj.stop_reason),
    worktree_root: optString(obj.worktree_root),
  };
}

export class PayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadError';
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function processEvent(payload: EventPayload): ProcessEventResult {
  const db = getDatabase();
  const now = new Date().toISOString();

  // 1. Resolve team by worktree name (e.g. "kea-763")
  let team = db.getTeamByWorktree(payload.team);

  if (!team) {
    // Auto-create team row for unknown team names.
    // Extract issue number from team name (e.g. "kea-763" -> 763)
    const issueNumber = extractIssueNumber(payload.team);
    team = db.insertTeam({
      issueNumber,
      worktreeName: payload.team,
      status: 'launching',
      phase: 'init',
      sessionId: payload.session_id ?? null,
      launchedAt: now,
    });
  }

  // 2. Build extra payload JSON (fields not stored in dedicated columns)
  const extraPayload: Record<string, unknown> = {};
  if (payload.message) extraPayload.message = payload.message;
  if (payload.stop_reason) extraPayload.stop_reason = payload.stop_reason;
  if (payload.worktree_root) extraPayload.worktree_root = payload.worktree_root;
  if (payload.teammate_name) extraPayload.teammate_name = payload.teammate_name;
  if (payload.timestamp) extraPayload.timestamp = payload.timestamp;

  const payloadJson =
    Object.keys(extraPayload).length > 0 ? JSON.stringify(extraPayload) : null;

  // 3. Insert event row
  const event = db.insertEvent({
    teamId: team.id,
    sessionId: payload.session_id ?? null,
    agentName: payload.agent_type ?? payload.teammate_name ?? null,
    eventType: payload.event,
    toolName: payload.tool_name ?? null,
    payload: payloadJson,
  });

  // 4. Update teams.last_event_at
  db.updateTeam(team.id, { lastEventAt: now });

  // 5. Apply state machine transitions
  applyTransitions(team, payload, now);

  return {
    event_id: event.id,
    team_id: team.id,
    processed: true,
  };
}

// ---------------------------------------------------------------------------
// State machine transitions (docs/state-machines.md section 1 + 5)
// ---------------------------------------------------------------------------

function applyTransitions(
  team: Team,
  payload: EventPayload,
  now: string
): void {
  const db = getDatabase();
  const eventType = payload.event;
  const currentStatus = team.status;

  switch (eventType) {
    case 'session_start': {
      // launching -> running (first event received)
      if (currentStatus === 'launching') {
        db.updateTeam(team.id, { status: 'running' });
      }
      // idle -> running (new activity)
      if (currentStatus === 'idle') {
        db.updateTeam(team.id, { status: 'running' });
      }
      // stuck -> running (new event after human intervention)
      if (currentStatus === 'stuck') {
        db.updateTeam(team.id, { status: 'running' });
      }
      // Store session_id on the team
      if (payload.session_id) {
        db.updateTeam(team.id, { sessionId: payload.session_id });
      }
      break;
    }

    case 'session_end': {
      // Check if the team should transition to done.
      // A session_end on a running/idle team may signal completion.
      // Only transition to done if the team is running and this is the active session.
      if (
        (currentStatus === 'running' || currentStatus === 'idle') &&
        payload.session_id &&
        team.sessionId === payload.session_id
      ) {
        db.updateTeam(team.id, {
          status: 'done',
          stoppedAt: now,
        });
      }
      break;
    }

    case 'stop': {
      // Record the stop event. The stop_reason is stored in the event payload.
      // idle -> keep idle (stop is already passive)
      // If team was idle, new event keeps it running
      if (currentStatus === 'idle') {
        db.updateTeam(team.id, { status: 'running' });
      }
      if (currentStatus === 'stuck') {
        db.updateTeam(team.id, { status: 'running' });
      }
      break;
    }

    case 'tool_use': {
      // Heartbeat: just update last_event_at (already done above).
      // If team was idle, return to running.
      if (currentStatus === 'idle') {
        db.updateTeam(team.id, { status: 'running' });
      }
      if (currentStatus === 'stuck') {
        db.updateTeam(team.id, { status: 'running' });
      }
      break;
    }

    case 'tool_error': {
      // Update last_event_at (already done). Return idle/stuck to running.
      if (currentStatus === 'idle') {
        db.updateTeam(team.id, { status: 'running' });
      }
      if (currentStatus === 'stuck') {
        db.updateTeam(team.id, { status: 'running' });
      }
      break;
    }

    case 'notification': {
      // Record notification. If idle, return to running.
      if (currentStatus === 'idle') {
        db.updateTeam(team.id, { status: 'running' });
      }
      if (currentStatus === 'stuck') {
        db.updateTeam(team.id, { status: 'running' });
      }
      break;
    }

    case 'subagent_start': {
      // Record subagent lifecycle. If idle/stuck, return to running.
      if (currentStatus === 'idle') {
        db.updateTeam(team.id, { status: 'running' });
      }
      if (currentStatus === 'stuck') {
        db.updateTeam(team.id, { status: 'running' });
      }
      // launching -> running on first subagent start
      if (currentStatus === 'launching') {
        db.updateTeam(team.id, { status: 'running' });
      }
      break;
    }

    case 'subagent_stop': {
      // Record subagent lifecycle. If idle, return to running.
      if (currentStatus === 'idle') {
        db.updateTeam(team.id, { status: 'running' });
      }
      if (currentStatus === 'stuck') {
        db.updateTeam(team.id, { status: 'running' });
      }
      break;
    }

    case 'pre_compact': {
      // Record context pressure signal. If idle, return to running.
      if (currentStatus === 'idle') {
        db.updateTeam(team.id, { status: 'running' });
      }
      if (currentStatus === 'stuck') {
        db.updateTeam(team.id, { status: 'running' });
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractIssueNumber(teamName: string): number {
  // "kea-763" -> 763, "kea-1234" -> 1234
  const match = teamName.match(/(\d+)$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  // Fallback: use 0 for team names that don't contain a number
  return 0;
}

function optString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}
