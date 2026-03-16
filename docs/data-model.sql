-- =============================================================================
-- Claude Fleet Commander — Data Model (SQLite)
-- v1: Monitoring multiple Claude Code agent teams working on GitHub issues
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ISSUES — synced from GitHub, enriched with Project Board status
-- ---------------------------------------------------------------------------
CREATE TABLE issues (
    number          INTEGER PRIMARY KEY,            -- GitHub issue number
    title           TEXT NOT NULL,
    state           TEXT NOT NULL DEFAULT 'open',    -- open | closed
    board_status    TEXT NOT NULL DEFAULT 'Backlog', -- Backlog | Ready | InProgress | Done | Blocked
    parent_number   INTEGER REFERENCES issues(number),
    labels          TEXT,                            -- JSON array: ["P0","epic","smoke"]
    html_url        TEXT,
    synced_at       TEXT NOT NULL                    -- ISO 8601
);

CREATE INDEX idx_issues_board_status ON issues(board_status);
CREATE INDEX idx_issues_parent ON issues(parent_number);

-- ---------------------------------------------------------------------------
-- TEAMS — a Claude Code worktree session working on an issue
-- ---------------------------------------------------------------------------
-- Lifecycle: queued -> launching -> running -> stuck -> done | failed
--            running -> idle (no events for threshold)
--            stuck -> running (recovered via new event)
CREATE TABLE teams (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_number    INTEGER NOT NULL REFERENCES issues(number),
    worktree_name   TEXT NOT NULL UNIQUE,            -- e.g. "kea-763"
    branch_name     TEXT,                            -- e.g. "refactor/fix/763-add-tests"
    status          TEXT NOT NULL DEFAULT 'queued',  -- queued|launching|running|idle|stuck|done|failed
    phase           TEXT NOT NULL DEFAULT 'analyzing', -- analyzing|implementing|reviewing|pr|done|blocked
    stuck_reason    TEXT,                            -- null unless stuck/failed
    created_at      TEXT NOT NULL,                   -- ISO 8601
    updated_at      TEXT NOT NULL,                   -- ISO 8601, touched on every status change
    finished_at     TEXT                             -- ISO 8601, set on done/failed
);

CREATE INDEX idx_teams_status ON teams(status);
CREATE INDEX idx_teams_issue ON teams(issue_number);

-- ---------------------------------------------------------------------------
-- SESSIONS — individual Claude Code sessions within a team
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL UNIQUE,            -- from Claude Code (UUID)
    team_id         INTEGER NOT NULL REFERENCES teams(id),
    status          TEXT NOT NULL DEFAULT 'active',  -- active | paused | ended
    cost_usd        REAL NOT NULL DEFAULT 0.0,       -- accumulated cost
    turns           INTEGER NOT NULL DEFAULT 0,
    duration_sec    INTEGER NOT NULL DEFAULT 0,
    model           TEXT,                            -- e.g. "opus", "haiku"
    started_at      TEXT NOT NULL,
    ended_at        TEXT
);

CREATE INDEX idx_sessions_team ON sessions(team_id);
CREATE INDEX idx_sessions_status ON sessions(status);

-- ---------------------------------------------------------------------------
-- AGENTS — subagents within a team (coordinator, csharp-dev, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE agents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id         INTEGER NOT NULL REFERENCES teams(id),
    name            TEXT NOT NULL,                   -- "coordinator", "csharp-dev", "analityk", etc.
    agent_type      TEXT NOT NULL,                   -- "kea-coordinator", "kea-csharp-dev", etc.
    role            TEXT NOT NULL,                   -- "core" | "conditional"
    status          TEXT NOT NULL DEFAULT 'pending', -- pending|running|idle|done|failed
    session_id      TEXT REFERENCES sessions(session_id),
    spawned_at      TEXT,
    finished_at     TEXT
);

CREATE INDEX idx_agents_team ON agents(team_id);
CREATE UNIQUE INDEX idx_agents_team_name ON agents(team_id, name);

-- ---------------------------------------------------------------------------
-- PULL REQUESTS — associated with issues, tracked through CI lifecycle
-- ---------------------------------------------------------------------------
-- Lifecycle: none -> draft -> open -> ci_pending -> ci_passing -> merged
--                                                -> ci_failing -> (retry)
CREATE TABLE pull_requests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    number          INTEGER NOT NULL UNIQUE,         -- GitHub PR number
    issue_number    INTEGER NOT NULL REFERENCES issues(number),
    team_id         INTEGER REFERENCES teams(id),
    title           TEXT NOT NULL,
    state           TEXT NOT NULL DEFAULT 'open',    -- draft|open|merged|closed
    ci_status       TEXT NOT NULL DEFAULT 'none',    -- none|pending|passing|failing
    merge_state     TEXT NOT NULL DEFAULT 'unknown', -- unknown|clean|behind|blocked|dirty
    auto_merge      INTEGER NOT NULL DEFAULT 0,      -- 0|1 — whether auto-merge is set
    ci_fail_count   INTEGER NOT NULL DEFAULT 0,      -- unique failure types (max 3 before blocked)
    html_url        TEXT,
    head_branch     TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    merged_at       TEXT
);

CREATE INDEX idx_prs_issue ON pull_requests(issue_number);
CREATE INDEX idx_prs_state ON pull_requests(state);
CREATE INDEX idx_prs_team ON pull_requests(team_id);

-- ---------------------------------------------------------------------------
-- CI RUNS — individual CI workflow runs for a PR
-- ---------------------------------------------------------------------------
CREATE TABLE ci_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          INTEGER NOT NULL,                -- GitHub Actions run databaseId
    pr_number       INTEGER NOT NULL REFERENCES pull_requests(number),
    status          TEXT NOT NULL,                   -- queued|in_progress|completed
    conclusion      TEXT,                            -- success|failure|cancelled|null
    checks_json     TEXT,                            -- JSON: [{name, state, bucket}]
    started_at      TEXT NOT NULL,
    completed_at    TEXT
);

CREATE INDEX idx_ci_runs_pr ON ci_runs(pr_number);
CREATE UNIQUE INDEX idx_ci_runs_run_id ON ci_runs(run_id);

-- ---------------------------------------------------------------------------
-- EVENTS — hook events from Claude Code sessions
-- ---------------------------------------------------------------------------
-- Sources: SessionStart, SessionEnd, Stop, SubagentStart, SubagentStop,
--          Notification, TeammateIdle, ToolUse, etc.
CREATE TABLE events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id         INTEGER NOT NULL REFERENCES teams(id),
    session_id      TEXT,                            -- may be null for team-level events
    agent_name      TEXT,                            -- which agent generated the event
    event_type      TEXT NOT NULL,                   -- SessionStart|SessionEnd|Stop|SubagentStart|SubagentStop|Notification|ToolUse|CostUpdate
    payload         TEXT,                            -- JSON blob with event-specific data
    created_at      TEXT NOT NULL                    -- ISO 8601
);

CREATE INDEX idx_events_team ON events(team_id);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_created ON events(created_at);
CREATE INDEX idx_events_team_created ON events(team_id, created_at);

-- ---------------------------------------------------------------------------
-- COMMANDS — messages sent to running teams (PM -> agent)
-- ---------------------------------------------------------------------------
CREATE TABLE commands (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id         INTEGER NOT NULL REFERENCES teams(id),
    target_agent    TEXT,                            -- null = team-level, or specific agent name
    message         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending', -- pending|delivered|failed
    created_at      TEXT NOT NULL,
    delivered_at    TEXT
);

CREATE INDEX idx_commands_team ON commands(team_id);
CREATE INDEX idx_commands_status ON commands(status);

-- ---------------------------------------------------------------------------
-- VIEWS — convenient aggregations
-- ---------------------------------------------------------------------------

-- Dashboard overview: one row per active team
CREATE VIEW v_team_dashboard AS
SELECT
    t.id AS team_id,
    t.worktree_name,
    t.status AS team_status,
    t.phase,
    i.number AS issue_number,
    i.title AS issue_title,
    i.board_status,
    pr.number AS pr_number,
    pr.state AS pr_state,
    pr.ci_status,
    pr.merge_state,
    (SELECT COUNT(*) FROM agents a WHERE a.team_id = t.id AND a.status = 'running') AS active_agents,
    (SELECT COUNT(*) FROM sessions s WHERE s.team_id = t.id AND s.status = 'active') AS active_sessions,
    (SELECT SUM(s.cost_usd) FROM sessions s WHERE s.team_id = t.id) AS total_cost_usd,
    (SELECT MAX(e.created_at) FROM events e WHERE e.team_id = t.id) AS last_event_at,
    t.created_at,
    t.updated_at
FROM teams t
JOIN issues i ON i.number = t.issue_number
LEFT JOIN pull_requests pr ON pr.team_id = t.id AND pr.state IN ('open', 'draft')
WHERE t.status NOT IN ('done', 'failed')
ORDER BY t.created_at DESC;

-- Stuck detection: teams with no recent events
CREATE VIEW v_stuck_candidates AS
SELECT
    t.id AS team_id,
    t.worktree_name,
    t.status,
    t.phase,
    i.number AS issue_number,
    i.title AS issue_title,
    (SELECT MAX(e.created_at) FROM events e WHERE e.team_id = t.id) AS last_event_at,
    CAST(
        (julianday('now') - julianday((SELECT MAX(e.created_at) FROM events e WHERE e.team_id = t.id))) * 24 * 60
        AS INTEGER
    ) AS minutes_since_last_event
FROM teams t
JOIN issues i ON i.number = t.issue_number
WHERE t.status IN ('running', 'idle')
ORDER BY minutes_since_last_event DESC;

-- Cost summary per issue
CREATE VIEW v_cost_by_issue AS
SELECT
    i.number,
    i.title,
    i.board_status,
    COUNT(DISTINCT t.id) AS team_count,
    COUNT(DISTINCT s.id) AS session_count,
    COALESCE(SUM(s.cost_usd), 0) AS total_cost_usd,
    COALESCE(SUM(s.turns), 0) AS total_turns,
    COALESCE(SUM(s.duration_sec), 0) AS total_duration_sec
FROM issues i
LEFT JOIN teams t ON t.issue_number = i.number
LEFT JOIN sessions s ON s.team_id = t.id
GROUP BY i.number
ORDER BY total_cost_usd DESC;
