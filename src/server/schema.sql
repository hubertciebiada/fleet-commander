-- =============================================================================
-- Fleet Commander — SQLite Schema (v1, aligned with PRD section 4)
-- =============================================================================

-- Schema version tracking for migrations
CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- TEAMS — a Claude Code worktree session working on an issue
-- ---------------------------------------------------------------------------
-- Lifecycle: queued -> launching -> running -> idle (5min) -> stuck (15min) -> done/failed
CREATE TABLE IF NOT EXISTS teams (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_number    INTEGER NOT NULL,
  issue_title     TEXT,
  worktree_name   TEXT NOT NULL UNIQUE,           -- e.g. "kea-763"
  branch_name     TEXT,
  status          TEXT NOT NULL DEFAULT 'queued',  -- queued|launching|running|idle|stuck|done|failed
  phase           TEXT NOT NULL DEFAULT 'init',   -- init|analyzing|implementing|reviewing|pr|done|blocked
  pid             INTEGER,
  session_id      TEXT,
  pr_number       INTEGER,
  launched_at     TEXT,
  stopped_at      TEXT,
  last_event_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_teams_status ON teams(status);
CREATE INDEX IF NOT EXISTS idx_teams_issue ON teams(issue_number);

-- ---------------------------------------------------------------------------
-- PULL REQUESTS — associated with teams, tracked through CI lifecycle
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pull_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_number       INTEGER NOT NULL UNIQUE,
  team_id         INTEGER REFERENCES teams(id),
  title           TEXT,
  state           TEXT,                           -- OPEN|MERGED|CLOSED|draft
  ci_status       TEXT,                           -- none|pending|passing|failing
  merge_state     TEXT,                           -- unknown|clean|behind|blocked|dirty
  auto_merge      INTEGER NOT NULL DEFAULT 0,     -- 0|1
  ci_fail_count   INTEGER NOT NULL DEFAULT 0,     -- unique failure types; >= 3 means blocked
  checks_json     TEXT,                           -- JSON array: [{name, status, conclusion}]
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  merged_at       TEXT
);

-- ---------------------------------------------------------------------------
-- EVENTS — hook events from Claude Code sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id         INTEGER NOT NULL REFERENCES teams(id),
  session_id      TEXT,
  agent_name      TEXT,
  event_type      TEXT NOT NULL,                  -- session_start|session_end|stop|subagent_start|subagent_stop|notification|tool_use|tool_error|pre_compact
  tool_name       TEXT,
  payload         TEXT,                           -- JSON blob
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_team ON events(team_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

-- ---------------------------------------------------------------------------
-- COMMANDS — messages sent to running teams (PM -> agent)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commands (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id         INTEGER NOT NULL REFERENCES teams(id),
  target_agent    TEXT,                           -- null = team-level, or specific agent name
  message         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending|delivered|failed
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at    TEXT
);

-- ---------------------------------------------------------------------------
-- COST ENTRIES — token usage and cost tracking per session
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id         INTEGER NOT NULL REFERENCES teams(id),
  session_id      TEXT,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0.0,
  recorded_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- VIEW: Dashboard overview (one row per team)
-- ---------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_team_dashboard AS
SELECT
  t.id,
  t.issue_number,
  t.issue_title,
  t.status,
  t.phase,
  t.worktree_name,
  t.pr_number,
  t.launched_at,
  t.last_event_at,
  ROUND((julianday('now') - julianday(t.launched_at)) * 24 * 60, 0) AS duration_min,
  ROUND((julianday('now') - julianday(t.last_event_at)) * 24 * 60, 1) AS idle_min,
  COALESCE(SUM(c.cost_usd), 0) AS total_cost,
  COUNT(DISTINCT c.session_id) AS session_count,
  (SELECT COUNT(*) FROM events e WHERE e.team_id = t.id) AS event_count,
  pr.pr_number AS latest_pr_number,
  pr.state AS pr_state,
  pr.ci_status,
  pr.merge_state AS merge_status,
  t.created_at,
  t.updated_at
FROM teams t
LEFT JOIN cost_entries c ON c.team_id = t.id
LEFT JOIN pull_requests pr ON pr.team_id = t.id
GROUP BY t.id;

-- Insert initial schema version
INSERT OR IGNORE INTO schema_version (version) VALUES (1);
