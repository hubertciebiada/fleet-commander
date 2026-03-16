# Fleet Commander — PRD (Product Requirements Document)

**Wersja:** 1.0
**Data:** 2026-03-16
**Autor:** Synteza z 10 agentów research/design

## 1. Problem Statement

### Obecny stan

PM (Tech Lead) orkiestruje zespoły agentów Claude Code pracujących równolegle nad GitHub issues. Obecny flow:

1. **Uruchomienie:** `claude-bonanza.ps1 "763,812,756"` → otwiera taby Windows Terminal, każdy z `claude --worktree kea-{N} '/next-issue-kea {N}'`
2. **Monitorowanie:** ręczne przełączanie między 6-7 tabami, patrzenie na output
3. **Interwencja:** ręczne wpisywanie komend w tab gdy zespół utknął
4. **Status PR/CI:** ręczne `gh pr view`, `gh run list`
5. **Resume:** `claude-bonanza.ps1 -Resume` — bolesne z wieloma zespołami

### Znane problemy

| Problem | Root Cause | Skutek |
|---------|-----------|--------|
| **PR Watcher stuck** | Brak sprawdzania czy team żyje; brak max retry na BEHIND/RED; infinite loop po MERGED bez ACK | Hook kręci się w nieskończoność, zużywa zasoby |
| **Cały zespół idle** | Brak heartbeat; Coordinator jako single point of failure; brak timeout na state machine | Cisza — PM nie wie czy zespół pracuje czy umarł |
| **Resume pain** | Team state in-memory only (TeamCreate/TaskList nie persystuje); staggered 15s startup = race conditions; signal files z poprzedniego runu | Każdy resume to loteria |

### Cel

Webowa aplikacja TypeScript zastępująca manualne zarządzanie: launch, monitor, intervene, resume — wszystko z jednego dashboardu. PM widzi wszystkie zespoły na raz, wie kto pracuje, kto utknął, kto skończył. Może skalować do 15+ zespołów.

---

## 2. Zasady projektowe

1. **Observe, don't ask** — status zespołu opiera się na hookach, git, GitHub API. Nie na opinii agentów o sobie (unikamy halucynacji).
2. **Fire and forget hooks** — hooki nigdy nie blokują Claude Code. Curl w background, exit 0 zawsze.
3. **Essentials first** — minimum viable features, bez bloatu. Rozbudowa w v2+.
4. **Coexist with existing** — nie zastępuje pr-watcher-idle.sh ani bash-worktree-fix.sh. Dodaje się obok.
5. **Single process** — jeden serwer Node.js + SQLite. Zero infrastruktury.
6. **Windows-first** — działa na Windows 10 z Git Bash. Bez tmux.

---

## 3. Architektura

### Diagram komponentów

```
┌──────────────────────────────────────────────────────────────────┐
│                    BROWSER (localhost:4680)                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                 React SPA (Vite + Tailwind)                │  │
│  │  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌─────────────┐ │  │
│  │  │Fleet Grid│ │Issue Tree │ │Team      │ │Cost View    │ │  │
│  │  │(main)    │ │(hierarchy)│ │Detail    │ │             │ │  │
│  │  └──────────┘ └───────────┘ │(slide-   │ └─────────────┘ │  │
│  │                              │ over)    │                  │  │
│  │                              └──────────┘                  │  │
│  └────────────────────────────────────────────────────────────┘  │
│       │ SSE (EventSource)           │ REST API                   │
├───────┼─────────────────────────────┼────────────────────────────┤
│       ▼                             ▼                            │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              FASTIFY SERVER (Node.js)                      │  │
│  │                                                            │  │
│  │  ┌──────────────┐  ┌───────────────┐  ┌────────────────┐ │  │
│  │  │Team Manager  │  │GitHub Poller  │  │Event Collector │ │  │
│  │  │(spawn/stop/  │  │(PR+CI status  │  │(hook HTTP POST │ │  │
│  │  │ resume)      │  │ every 30s)    │  │ receiver)      │ │  │
│  │  └──────┬───────┘  └──────┬────────┘  └───────┬────────┘ │  │
│  │         │                 │                    │           │  │
│  │  ┌──────▼─────────────────▼────────────────────▼────────┐ │  │
│  │  │                  SQLite (fleet.db)                    │ │  │
│  │  └──────────────────────────────────────────────────────┘ │  │
│  │                                                            │  │
│  │  ┌──────────────┐  ┌──────────────────────────────────┐   │  │
│  │  │MCP Server    │  │Claude Code Process Pool          │   │  │
│  │  │(fleet_status │  │ [claude --worktree kea-763 ...]  │   │  │
│  │  │ tool)        │  │ [claude --worktree kea-812 ...]  │   │  │
│  │  └──────────────┘  └──────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────────┘  │
│          │                          │                            │
│          ▼                          ▼                            │
│   ┌──────────┐              ┌────────────┐                      │
│   │Git       │              │GitHub API  │                      │
│   │Worktrees │              │(gh CLI)    │                      │
│   └──────────┘              └────────────┘                      │
└──────────────────────────────────────────────────────────────────┘
```

### Data flow

```
A. LAUNCH:  Dashboard → POST /api/teams → TeamManager.spawn()
            → git worktree add (if needed) → child_process.spawn("claude", [...])
            → store PID + session state in SQLite → SSE broadcast

B. EVENTS:  Claude hooks → POST http://localhost:4680/api/events (fire & forget)
            → EventCollector → SQLite → SSE broadcast → Dashboard updates

C. GITHUB:  setInterval(30s) → gh pr view / gh run list per team with PR
            → compare with cache → if changed → SQLite + SSE broadcast

D. COMMAND: Dashboard → POST /api/teams/:id/message
            → write to claude process stdin OR create signal file

E. MCP:     Claude team calls fleet_status tool → MCP server reads SQLite
            → returns team status as seen by dashboard
```

### Technology stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js 20+ | Claude Code SDK interop, same ecosystem |
| Backend | Fastify | Fast, native TS, JSON schema validation |
| Frontend | React + Vite | Pragmatic choice for greenfield tool |
| Database | SQLite (better-sqlite3) | Zero infra, single file, WAL for concurrent writes |
| Real-time | SSE (Server-Sent Events) | Simpler than WebSocket for unidirectional updates |
| Styling | Tailwind CSS | Fast to build, dark theme |
| Process mgmt | child_process.spawn | Direct control, track PIDs, pipe stdio |
| GitHub | gh CLI (child_process) | Already authenticated, handles rate limits |
| MCP | @modelcontextprotocol/sdk | Official SDK, stdio transport |

---

## 4. Data model

### SQLite schema

```sql
-- Zespoły agentów (1 team = 1 issue = 1 worktree)
CREATE TABLE teams (
  id              INTEGER PRIMARY KEY,
  issue_number    INTEGER NOT NULL,
  issue_title     TEXT,
  status          TEXT NOT NULL DEFAULT 'launching',
    -- launching | running | idle | stuck | done | failed
  phase           TEXT DEFAULT 'init',
    -- init | analyzing | implementing | reviewing | pr | done | blocked
  pid             INTEGER,
  session_id      TEXT,
  worktree_name   TEXT NOT NULL,        -- kea-763
  worktree_path   TEXT,
  branch_name     TEXT,
  pr_number       INTEGER,
  launched_at     TEXT NOT NULL,
  stopped_at      TEXT,
  last_event_at   TEXT,                 -- last hook event timestamp
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_teams_status ON teams(status);
CREATE INDEX idx_teams_issue ON teams(issue_number);

-- Pull requesty powiązane z zespołami
CREATE TABLE pull_requests (
  pr_number       INTEGER PRIMARY KEY,
  team_id         INTEGER REFERENCES teams(id),
  state           TEXT,                 -- OPEN | MERGED | CLOSED
  merge_status    TEXT,                 -- CLEAN | BEHIND | BLOCKED | DIRTY
  ci_status       TEXT,                 -- pending | success | failure
  ci_conclusion   TEXT,
  ci_fail_count   INTEGER DEFAULT 0,   -- max 3 unique → blocked
  checks_json     TEXT,                 -- JSON array: [{name, status, conclusion}]
  auto_merge      INTEGER DEFAULT 0,
  last_polled_at  TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Eventy z hooków Claude Code
CREATE TABLE events (
  id          INTEGER PRIMARY KEY,
  team_id     INTEGER NOT NULL REFERENCES teams(id),
  hook_type   TEXT NOT NULL,
  session_id  TEXT,
  tool_name   TEXT,
  agent_type  TEXT,
  payload     TEXT,                     -- JSON blob (oryginalne dane z hooka)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_team ON events(team_id, created_at);
CREATE INDEX idx_events_type ON events(hook_type);

-- Komendy PM → zespół
CREATE TABLE commands (
  id          INTEGER PRIMARY KEY,
  team_id     INTEGER NOT NULL REFERENCES teams(id),
  message     TEXT NOT NULL,
  sent_at     TEXT NOT NULL DEFAULT (datetime('now')),
  delivered   INTEGER DEFAULT 0
);

-- Koszty per sesja
CREATE TABLE cost_entries (
  id            INTEGER PRIMARY KEY,
  team_id       INTEGER NOT NULL REFERENCES teams(id),
  session_id    TEXT,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd      REAL DEFAULT 0.0,
  recorded_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- View: dashboard overview (jeden wiersz per aktywny team)
CREATE VIEW v_team_dashboard AS
SELECT
  t.id, t.issue_number, t.issue_title, t.status, t.phase,
  t.worktree_name, t.pr_number, t.launched_at, t.last_event_at,
  ROUND((julianday('now') - julianday(t.launched_at)) * 24 * 60, 0) AS duration_min,
  ROUND((julianday('now') - julianday(t.last_event_at)) * 24 * 60, 1) AS idle_min,
  COALESCE(SUM(c.cost_usd), 0) AS total_cost,
  COUNT(DISTINCT c.session_id) AS session_count,
  pr.state AS pr_state, pr.ci_status, pr.merge_status
FROM teams t
LEFT JOIN cost_entries c ON c.team_id = t.id
LEFT JOIN pull_requests pr ON pr.team_id = t.id
GROUP BY t.id;
```

### State machines

**Team operational status:**
```
launching ──► running ──► idle (no events >5min) ──► stuck (no events >15min)
                │                                          │
                ├──► done (PR merged + issue closed)       │
                └──► failed (process crashed)              │
                                                           └──► failed (timeout)
```

**Team domain phase** (self-reported via MCP lub inferred z hooków):
```
init ──► analyzing ──► implementing ──► reviewing ──► pr ──► done
                                                        └──► blocked
```

**Stuck detection (server-side, co 60s):**
- `last_event_at` > 5 min ago → status = `idle`
- `last_event_at` > 15 min ago → status = `stuck`
- CI failing 3+ unique errors → phase = `blocked`

---

## 5. Hook system

### Filozofia

Każdy hook to thin wrapper (~8 linii bash) wołający centralny `send_event.sh`. Hooki:
- Nigdy nie blokują Claude Code (curl w background, exit 0 zawsze)
- Identyfikują team z git worktree path
- Koegzystują z istniejącymi hookami (pr-watcher-idle.sh, bash-worktree-fix.sh)

### send_event.sh (centralny sender)

```bash
#!/bin/bash
# Read hook JSON from stdin
INPUT=$(cat)
EVENT_TYPE="$1"

# Identify team from worktree path
WORKTREE_NAME="${FLEET_TEAM_ID:-}"
if [ -z "$WORKTREE_NAME" ]; then
  TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  if [[ "$TOPLEVEL" == *"/.claude/worktrees/"* ]] || [[ "$TOPLEVEL" == *"\\.claude\\worktrees\\"* ]]; then
    WORKTREE_NAME=$(basename "$TOPLEVEL")
  fi
fi
[ -z "$WORKTREE_NAME" ] && exit 0  # not in a worktree, skip

# Extract fields from hook JSON (no jq dependency — POSIX grep+sed)
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//')
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//')
AGENT_TYPE=$(echo "$INPUT" | grep -o '"agent_type":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//')

# Build payload
PAYLOAD=$(cat <<EOF
{"team":"$WORKTREE_NAME","event":"$EVENT_TYPE","session_id":"$SESSION_ID","tool_name":"$TOOL_NAME","agent_type":"$AGENT_TYPE","timestamp":$(date +%s),"raw":$INPUT}
EOF
)

# Fire and forget (2s timeout, background, always exit 0)
FLEET_URL="${FLEET_COMMANDER_URL:-http://localhost:4680}"
curl -s -X POST "$FLEET_URL/api/events" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --max-time 2 > /dev/null 2>&1 &

exit 0
```

### Hook wrappers (per event type)

Każdy wrapper to:
```bash
#!/bin/bash
cat | .claude/hooks/fleet-commander/send_event.sh "PostToolUse"
```

### Hooki do użycia

| Hook | Cel | Priorytet |
|------|-----|-----------|
| **PostToolUse** | **Heartbeat** — dowód że team żyje | KRYTYCZNY |
| **SessionStart** | Wykrycie startu, capture session_id | KRYTYCZNY |
| **SessionEnd** | Wykrycie końca, reason tracking | KRYTYCZNY |
| **Stop** | Agent główny zatrzymał się (done lub stuck) | WYSOKI |
| **SubagentStart** | Wewnętrzny agent wystartował | MEDIUM |
| **SubagentStop** | Wewnętrzny agent zakończył | MEDIUM |
| **Notification** | Idle/permission prompt — team czeka | WYSOKI |
| **PostToolUseFailure** | Błędy narzędzi (build failures) | MEDIUM |
| **PreCompact** | Context pressure (złożone zadanie) | NISKI |

### Konfiguracja .claude/settings.json

```json
{
  "hooks": {
    "PostToolUse": [
      { "hooks": [{ "type": "command", "command": ".claude/hooks/fleet-commander/on_post_tool_use.sh" }] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": ".claude/hooks/fleet-commander/on_session_start.sh" }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": ".claude/hooks/fleet-commander/on_session_end.sh" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": ".claude/hooks/fleet-commander/on_stop.sh" }] }
    ],
    "SubagentStart": [
      { "hooks": [{ "type": "command", "command": ".claude/hooks/fleet-commander/on_subagent_start.sh" }] }
    ],
    "SubagentStop": [
      { "hooks": [{ "type": "command", "command": ".claude/hooks/fleet-commander/on_subagent_stop.sh" }] }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": ".claude/hooks/fleet-commander/on_notification.sh" }] }
    ],
    "PostToolUseFailure": [
      { "hooks": [{ "type": "command", "command": ".claude/hooks/fleet-commander/on_tool_error.sh" }] }
    ],
    "TeammateIdle": [
      { "hooks": [
        { "type": "command", "command": ".claude/hooks/pr-watcher-idle.sh" },
        { "type": "command", "command": ".claude/hooks/fleet-commander/on_notification.sh" }
      ]}
    ]
  }
}
```

---

## 6. GitHub integration

### Issue hierarchy query (3 levels deep)

```graphql
query GetHierarchy($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    issues(first: 50, after: $cursor, states: [OPEN]) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title state updatedAt
        labels(first: 10) { nodes { name color } }
        parent { number }
        subIssuesSummary { total completed percentCompleted }
        subIssues(first: 50) {
          nodes {
            number title state
            subIssuesSummary { total completed percentCompleted }
            subIssues(first: 50) {
              nodes { number title state }
            }
          }
        }
        closedByPullRequestsReferences(first: 3, includeClosedPrs: true) {
          nodes {
            number state merged mergeStateStatus
            statusCheckRollup { state }
          }
        }
      }
    }
  }
}
```

### PR polling (co 30s per team z PR)

```bash
gh pr view {pr_number} --repo {owner}/{repo} \
  --json number,state,mergeStateStatus,statusCheckRollup,autoMergeRequest,headRefName
```

Kluczowe pola:
- `mergeStateStatus`: CLEAN | BEHIND | BLOCKED | DIRTY | UNSTABLE
- `statusCheckRollup.state`: SUCCESS | PENDING | FAILURE
- `statusCheckRollup.contexts[].{name,status,conclusion}` — individual checks

### Delta polling z `since` (co 60s)

```graphql
issues(first: 50, filterBy: {since: "$LAST_POLL_ISO"}) { ... }
```

Zużycie: ~120 requests/hour = 2.4% rate limit (5000 points/h).

### Project Board integration

Status field ID: `PVTSSF_lADOBA8-2c4BOgAPzg9L0kQ`
Options: Backlog (`ce706fac`), Ready (`68d9ef1f`), InProgress (`c894454c`), Done (`a3bebb19`), Blocked (`bb8b280a`)

Czytanie statusu issue z project board:
```graphql
projectItems(first: 5) {
  nodes {
    fieldValueByName(name: "Status") {
      ... on ProjectV2ItemFieldSingleSelectValue { name }
    }
  }
}
```

---

## 7. MCP Server (team self-inspection)

### Jeden tool: `fleet_status`

```typescript
{
  name: "fleet_status",
  description: "Check how the PM dashboard sees your team's status",
  inputSchema: {
    type: "object",
    properties: {
      team_id: { type: "string", description: "Team ID (e.g., kea-763). Auto-detected if omitted." }
    }
  }
}
```

### Response

```json
{
  "team": "kea-763",
  "status": "running",
  "phase": "implementing",
  "duration_minutes": 42,
  "sessions": 3,
  "total_cost_usd": 4.50,
  "last_event": "2026-03-16T14:30:00Z",
  "idle_minutes": 2,
  "issue": { "number": 763, "title": "AcceptanceMonit tests", "state": "open" },
  "pr": {
    "number": 847,
    "state": "OPEN",
    "ci_status": "failure",
    "merge_status": "BLOCKED",
    "checks": [
      { "name": "Build", "conclusion": "success" },
      { "name": "Unit Tests", "conclusion": "success" },
      { "name": "Integration Tests", "conclusion": "failure" }
    ]
  },
  "pm_message": "Fix integration test NHibernate session setup"
}
```

### Auto-detect team ID

Kolejność: explicit param → git branch (`worktree-kea-{N}`) → directory path → `FLEET_TEAM_ID` env var.

### Dwa tryby

1. **Primary:** HTTP GET do `$FLEET_SERVER_URL/api/teams/:id/status`
2. **Fallback:** rekonstrukcja z `gh pr view` + `git log` + signal files (gdy dashboard jest offline)

### Konfiguracja MCP

```json
// .mcp.json
{
  "fleet": {
    "command": "node",
    "args": ["tools/fleet-mcp/dist/server.js"],
    "env": { "FLEET_SERVER_URL": "http://localhost:4680" }
  }
}
```

---

## 8. UI Design

### Layout

```
┌──────────────────────────────────────────────────────────┐
│ TOPBAR: Fleet Commander  [8 Run][2 Stuck][3 Done] $47.23│
├────┬─────────────────────────────────────────────────────┤
│SIDE│ MAIN CONTENT                                        │
│NAV │                                                     │
│56px│                                                     │
│    │                                                     │
│ ⊞  │   (Fleet Grid | Issue Tree | Cost View)            │
│ 🌳 │                                                     │
│ $  │                                     ┌──────────────┐│
│    │                                     │Team Detail   ││
│    │                                     │(slide-over)  ││
│    │                                     │              ││
│    │                                     └──────────────┘│
├────┴─────────────────────────────────────────────────────┤
│ STATUS: Connected ● | Updated 2s ago | 8 teams           │
└──────────────────────────────────────────────────────────┘
```

### Fleet Grid (main view)

Rows, nie karty — 64px height per row, 12 teamów widocznych bez scrollowania na 1080p.

```
┌────────────────────────────────────────────────────────────┐
│ ● RUNNING  #814 Add unit tests for Contract...  2h14m  3s  $4.12  PR#820 CI●✓  [Msg][■] │
│ ● STUCK    #756 Refactor Report Export...        4h02m  7s  $11.3  PR#818 CI●✗  [Msg][■] │
│ ✓ DONE     #754 Add Dictionary Logic tests       1h45m  2s  $2.88  PR#815 MERGED [Det]   │
└────────────────────────────────────────────────────────────┘
```

**Domyślne sortowanie:** Stuck > Running > Idle > Failed > Done. Wewnątrz grupy: po duration desc.

**Kolory statusów:**
- Running: `#3FB950` (green)
- Stuck: `#F85149` (red, pulsing dot)
- Idle: `#D29922` (amber)
- Done: `#56D4DD` (teal)
- Failed: `#F85149` (red, static X)

### Issue Tree (secondary view)

Hierarchia z GitHub z kolorami statusów i przyciskami Play:
```
▼ #200 Modernizacja .NET 4.5 → 4.8           ○ OPEN
  ▼ #273 Testy kalkulacji E2E                 ○ OPEN
    ├ #302 NHibernate mapping fix    ● RUN    PR#820 CI●
    ├ #522 BorderPost DivideByZero   ○ OPEN          [▶]
    └ #523 Aerial WOT is null        ○ OPEN          [▶]
```

### Team Detail (slide-over panel, 520px, right side)

Sekcje: Header (full title, status, duration, cost) → PR + CI checks → Sessions table → Event timeline (last 20) → Command input → Action buttons.

### Cost View

Tabela posortowana cost desc + daily bar chart. Refresh co 60s.

### Dark theme

Base: `#0D1117`, Surface: `#161B22`, Text: `#E6EDF3`, Accent: `#58A6FF`.

---

## 9. API endpoints

Każdy endpoint zwraca pełny kontekst potrzebny do podjęcia decyzji — bez konieczności drugiego wywołania. Nazwy endpointów odpowiadają akcjom PM, nie operacjom CRUD.

### Teams — lifecycle & interaction

```
POST   /api/teams/launch               Launch single team for an issue
POST   /api/teams/launch-batch         Launch multiple teams at once
GET    /api/teams                      List all teams with full dashboard data
GET    /api/teams/:id                  Full team detail (status, PR, CI, cost, events)
GET    /api/teams/:id/status           Compact team status (MCP-compatible)
POST   /api/teams/:id/stop             Stop a running team (kill process)
POST   /api/teams/:id/resume           Resume a stopped/idle team
POST   /api/teams/:id/restart          Restart team (stop + relaunch in one call)
POST   /api/teams/:id/send-message     Send intervention message to team
POST   /api/teams/:id/set-phase        Manually override team domain phase
POST   /api/teams/:id/acknowledge      Acknowledge stuck/failed/done status (dismiss alert)
POST   /api/teams/stop-all             Stop all running teams
GET    /api/teams/:id/output           Get stdout/stderr rolling buffer
GET    /api/teams/:id/events           Event log for this team (filterable)
GET    /api/teams/:id/sessions         Session history for this team
GET    /api/teams/:id/cost             Cost breakdown for this team
```

### Issues — hierarchy & work planning

```
GET    /api/issues                     Full issue hierarchy tree (cached, 3 levels deep)
GET    /api/issues/:number             Single issue detail with project board status
POST   /api/issues/refresh             Force re-fetch issue hierarchy from GitHub
GET    /api/issues/next                Suggest next issue to work on (Ready, no active team, highest priority)
GET    /api/issues/available           List issues that have no active team assigned
```

### Pull Requests — CI & merge management

```
GET    /api/prs                        All tracked PRs with CI status
GET    /api/prs/:number                Single PR detail with full check breakdown
POST   /api/prs/refresh                Force re-poll all PR statuses from GitHub
POST   /api/prs/:number/refresh        Force re-poll single PR status
POST   /api/prs/:number/enable-auto-merge    Enable auto-merge (squash) for a PR
POST   /api/prs/:number/disable-auto-merge   Disable auto-merge for a PR
POST   /api/prs/:number/update-branch  Update PR branch (merge base into head)
```

### Events — hook receiver & query

```
POST   /api/events                     Receive hook events from Claude Code
GET    /api/events                     Query all events (filterable by team, type, time range)
```

### Diagnostics — stuck detection & fleet health

```
GET    /api/diagnostics/stuck          List all stuck teams with idle duration and last activity
GET    /api/diagnostics/blocked        List teams blocked by CI failures (3+ unique errors)
GET    /api/diagnostics/health         Full fleet health: per-team status, orphan processes, stale worktrees
```

### Costs — tracking & reporting

```
GET    /api/costs                      Aggregated cost summary (total, per-team, per-day)
GET    /api/costs/by-team              Cost breakdown grouped by team
GET    /api/costs/by-day               Daily cost time series
```

### System

```
GET    /api/status                     Server health + config (uptime, DB size, active teams count)
GET    /api/config                     Current server configuration (thresholds, intervals, paths)
```

### Real-time

```
GET    /api/stream                     SSE event stream (all team status changes, events, PR updates)
GET    /api/stream?teams=1,2,3         SSE filtered to specific teams
```

---

## 9b. Action Catalog

Kompletna lista akcji PM z mapowaniem na endpoint, parametry i odpowiedź. Każda akcja odpowiada jednemu kliknięciu, formularzowi lub filtrowi w GUI.

### Fleet overview actions

| # | Akcja PM | Endpoint | Parametry | Odpowiedź |
|---|----------|----------|-----------|-----------|
| 1 | **View fleet dashboard** | `GET /api/teams` | `?status=running,stuck` (opcjonalny filtr) | Array teamów z pełnym dashboard data: `{id, issue_number, issue_title, status, phase, worktree_name, pr_number, launched_at, last_event_at, duration_min, idle_min, total_cost, session_count, pr_state, ci_status, merge_status}` |
| 2 | **Sort/filter fleet grid** | `GET /api/teams` | `?status=stuck&sort=idle_min:desc` | Jak wyżej, przefiltrowane i posortowane |
| 3 | **View fleet health summary** | `GET /api/diagnostics/health` | — | `{total_teams, running, stuck, idle, done, failed, blocked, orphan_processes: [], stale_worktrees: [], total_cost_usd, uptime_minutes}` |

### Team launch actions

| # | Akcja PM | Endpoint | Parametry | Odpowiedź |
|---|----------|----------|-----------|-----------|
| 4 | **Launch team for issue** | `POST /api/teams/launch` | `{issueNumber: 763, prompt?: "/next-issue-kea 763"}` | `{team_id, issue_number, issue_title, worktree_name, pid, status: "launching"}` |
| 5 | **Launch multiple teams** | `POST /api/teams/launch-batch` | `{issues: [763, 812, 756], prompt?: "...", delayMs?: 5000}` | `{launched: [{team_id, issue_number, status}], failed: [{issue_number, error}]}` |
| 6 | **Launch from issue tree** (Play button) | `POST /api/teams/launch` | `{issueNumber: 522}` | Jak #4 |

### Team control actions

| # | Akcja PM | Endpoint | Parametry | Odpowiedź |
|---|----------|----------|-----------|-----------|
| 7 | **Stop team** | `POST /api/teams/:id/stop` | — | `{team_id, status: "idle", stopped_at, pid: null}` |
| 8 | **Stop all teams** | `POST /api/teams/stop-all` | `{confirm: true}` | `{stopped: [team_id, ...], already_stopped: [team_id, ...]}` |
| 9 | **Resume stopped team** | `POST /api/teams/:id/resume` | `{prompt?: "continue from where you left off"}` | `{team_id, status: "launching", pid, session_id}` |
| 10 | **Restart team** (stop + relaunch) | `POST /api/teams/:id/restart` | `{prompt?: "..."}` | `{team_id, status: "launching", pid, previous_sessions: 3}` |

### Team inspection actions

| # | Akcja PM | Endpoint | Parametry | Odpowiedź |
|---|----------|----------|-----------|-----------|
| 11 | **Open team detail** (click row / slide-over) | `GET /api/teams/:id` | — | `{id, issue_number, issue_title, status, phase, pid, session_id, worktree_name, worktree_path, branch_name, pr_number, launched_at, stopped_at, last_event_at, duration_min, idle_min, total_cost, session_count, pr: {number, state, merge_status, ci_status, ci_conclusion, ci_fail_count, checks: [{name, status, conclusion}], auto_merge}, recent_events: [...last 20], sessions: [...], output_tail: "...last 50 lines"}` |
| 12 | **View team status** (compact, MCP) | `GET /api/teams/:id/status` | — | `{team, status, phase, duration_minutes, sessions, total_cost_usd, last_event, idle_minutes, issue: {number, title, state}, pr: {number, state, ci_status, merge_status, checks: [...]}, pm_message}` |
| 13 | **View team output** (stdout/stderr) | `GET /api/teams/:id/output` | `?lines=100&stream=stdout` | `{team_id, lines: ["..."], total_lines, truncated}` |
| 14 | **View team events** (timeline) | `GET /api/teams/:id/events` | `?type=PostToolUse&since=2026-03-16T10:00:00Z&limit=50` | `{team_id, events: [{id, hook_type, session_id, tool_name, agent_type, created_at, payload}], total}` |
| 15 | **View team sessions** | `GET /api/teams/:id/sessions` | — | `{team_id, sessions: [{session_id, started_at, ended_at, duration_min, cost_usd, event_count}]}` |
| 16 | **View team cost** | `GET /api/teams/:id/cost` | — | `{team_id, total_cost_usd, sessions: [{session_id, input_tokens, output_tokens, cost_usd, recorded_at}]}` |

### Team intervention actions

| # | Akcja PM | Endpoint | Parametry | Odpowiedź |
|---|----------|----------|-----------|-----------|
| 17 | **Send message to team** | `POST /api/teams/:id/send-message` | `{message: "Fix NHibernate session setup in test base"}` | `{command_id, team_id, message, delivered: true, sent_at}` |
| 18 | **Set team phase manually** | `POST /api/teams/:id/set-phase` | `{phase: "blocked", reason?: "waiting for DB access"}` | `{team_id, phase: "blocked", previous_phase: "implementing"}` |
| 19 | **Acknowledge team status** (dismiss alert) | `POST /api/teams/:id/acknowledge` | `{status: "stuck", action?: "will resume later"}` | `{team_id, acknowledged: true, status}` |

### Issue management actions

| # | Akcja PM | Endpoint | Parametry | Odpowiedź |
|---|----------|----------|-----------|-----------|
| 20 | **View issue tree** | `GET /api/issues` | — | `{tree: [{number, title, state, labels, parent_number, children: [...recursive...], sub_issues_summary: {total, completed, percent}, active_team: {id, status} or null, pr: {number, state} or null}], cached_at}` |
| 21 | **View single issue** | `GET /api/issues/:number` | — | `{number, title, state, labels, body, project_status, parent_number, children: [...], active_team, pr, assignees}` |
| 22 | **Refresh issue tree** | `POST /api/issues/refresh` | — | `{refreshed_at, issue_count, changed: [{number, field, old, new}]}` |
| 23 | **Get next issue to work on** | `GET /api/issues/next` | `?priority=P0,P1&exclude_labels=blocked` | `{issue: {number, title, state, project_status, priority, labels, parent}, reason: "Highest priority Ready issue with no active team"}` |
| 24 | **List available issues** (no active team) | `GET /api/issues/available` | `?project_status=Ready&labels=P0` | `{issues: [{number, title, state, project_status, priority, labels}]}` |

### PR & CI actions

| # | Akcja PM | Endpoint | Parametry | Odpowiedź |
|---|----------|----------|-----------|-----------|
| 25 | **View all tracked PRs** | `GET /api/prs` | — | `{prs: [{pr_number, team_id, issue_number, state, merge_status, ci_status, ci_conclusion, ci_fail_count, checks: [...], auto_merge, last_polled_at}]}` |
| 26 | **View single PR detail** | `GET /api/prs/:number` | — | `{pr_number, team_id, state, merge_status, ci_status, ci_conclusion, ci_fail_count, auto_merge, checks: [{name, status, conclusion, url}], review_status, last_polled_at}` |
| 27 | **Force refresh all PRs** | `POST /api/prs/refresh` | — | `{refreshed_at, prs_polled, changes: [{pr_number, field, old, new}]}` |
| 28 | **Force refresh single PR** | `POST /api/prs/:number/refresh` | — | `{pr_number, ci_status, merge_status, checks: [...], changed_fields: [...]}` |
| 29 | **Enable auto-merge** | `POST /api/prs/:number/enable-auto-merge` | — | `{pr_number, auto_merge: true, merge_method: "squash"}` |
| 30 | **Disable auto-merge** | `POST /api/prs/:number/disable-auto-merge` | — | `{pr_number, auto_merge: false}` |
| 31 | **Update PR branch** | `POST /api/prs/:number/update-branch` | — | `{pr_number, merge_status, updated: true}` |

### Diagnostics & stuck detection actions

| # | Akcja PM | Endpoint | Parametry | Odpowiedź |
|---|----------|----------|-----------|-----------|
| 32 | **Check for stuck teams** | `GET /api/diagnostics/stuck` | — | `{stuck_teams: [{team_id, issue_number, status, idle_minutes, last_event_at, last_tool_name, phase, pr_number}]}` |
| 33 | **Check for CI-blocked teams** | `GET /api/diagnostics/blocked` | — | `{blocked_teams: [{team_id, issue_number, pr_number, ci_fail_count, unique_errors: [...], last_ci_run_at}]}` |
| 34 | **Full fleet health check** | `GET /api/diagnostics/health` | — | `{total_teams, by_status: {running: N, stuck: N, idle: N, done: N, failed: N}, by_phase: {implementing: N, blocked: N, ...}, orphan_processes: [{pid, worktree}], stale_worktrees: [{name, last_commit_at}], total_cost_usd, uptime_minutes}` |

### Cost tracking actions

| # | Akcja PM | Endpoint | Parametry | Odpowiedź |
|---|----------|----------|-----------|-----------|
| 35 | **View total costs** | `GET /api/costs` | `?since=2026-03-15&until=2026-03-16` | `{total_cost_usd, total_input_tokens, total_output_tokens, team_count, period: {from, to}}` |
| 36 | **View costs by team** | `GET /api/costs/by-team` | `?sort=cost:desc` | `{teams: [{team_id, issue_number, issue_title, total_cost_usd, session_count, input_tokens, output_tokens}]}` |
| 37 | **View daily cost chart** | `GET /api/costs/by-day` | `?days=7` | `{days: [{date, cost_usd, teams_active, sessions}]}` |

### Event actions

| # | Akcja PM | Endpoint | Parametry | Odpowiedź |
|---|----------|----------|-----------|-----------|
| 38 | **Receive hook event** | `POST /api/events` | `{team, event, session_id, tool_name, agent_type, timestamp, raw}` | `{event_id, team_id, processed: true}` |
| 39 | **Query events across teams** | `GET /api/events` | `?team_id=1&type=SessionEnd&since=...&limit=100` | `{events: [{id, team_id, hook_type, session_id, tool_name, created_at}], total}` |

### System actions

| # | Akcja PM | Endpoint | Parametry | Odpowiedź |
|---|----------|----------|-----------|-----------|
| 40 | **Check server health** | `GET /api/status` | — | `{status: "ok", uptime_seconds, db_size_bytes, active_teams, sse_connections, github_rate_limit_remaining, last_github_poll_at}` |
| 41 | **View server config** | `GET /api/config` | — | `{port, repo_root, github_repo, idle_threshold_min, stuck_threshold_min, max_ci_failures, poll_intervals: {github_ms, issues_ms, stuck_ms}}` |

### Real-time stream actions

| # | Akcja PM | Endpoint | Parametry | Odpowiedź |
|---|----------|----------|-----------|-----------|
| 42 | **Subscribe to all updates** | `GET /api/stream` | — | SSE stream: `event: team_status_changed`, `event: team_event`, `event: pr_updated`, `event: ci_changed`, `event: team_launched`, `event: team_stopped`, `event: cost_updated` |
| 43 | **Subscribe to specific teams** | `GET /api/stream?teams=1,2,3` | `?teams=1,2,3` | SSE stream filtered to listed team IDs |

---

## 10. Team lifecycle management

### Launch

```typescript
async function launchTeam(issueNumber: number, prompt?: string) {
  const worktreeName = `kea-${issueNumber}`;
  const worktreePath = path.join(repoRoot, '.claude/worktrees', worktreeName);

  // Create worktree if not exists
  if (!fs.existsSync(worktreePath)) {
    execSync(`git worktree add "${worktreePath}" -b worktree-${worktreeName} origin/refactor/main`);
  }

  // Spawn Claude Code process
  const proc = spawn('claude', [
    '--worktree', worktreeName,
    '--dangerously-skip-permissions',
    prompt || `/next-issue-kea ${issueNumber}`
  ], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    detached: true,
    env: { ...process.env, FLEET_TEAM_ID: worktreeName }
  });

  // Store in DB
  db.insertTeam({ issue_number: issueNumber, worktree_name: worktreeName,
                   pid: proc.pid, status: 'launching', launched_at: new Date().toISOString() });

  // Capture output (rolling buffer, last 500 lines)
  proc.stdout.on('data', (data) => appendOutput(teamId, 'stdout', data));
  proc.stderr.on('data', (data) => appendOutput(teamId, 'stderr', data));
  proc.on('exit', (code) => handleProcessExit(teamId, code));

  return teamId;
}
```

### Stop

```typescript
async function stopTeam(teamId: number) {
  const team = db.getTeam(teamId);
  if (team.pid) {
    // Windows: taskkill with tree flag
    execSync(`taskkill /F /T /PID ${team.pid}`, { stdio: 'ignore' });
  }
  db.updateTeam(teamId, { status: 'idle', stopped_at: new Date().toISOString() });
}
```

### Resume

```typescript
async function resumeTeam(teamId: number) {
  const team = db.getTeam(teamId);
  const proc = spawn('claude', [
    '--worktree', team.worktree_name,
    '--dangerously-skip-permissions',
    '--resume'   // resume last session in that worktree
  ], { /* same options */ });

  db.updateTeam(teamId, { status: 'launching', pid: proc.pid, stopped_at: null });
}
```

### Stuck detection (co 60s)

```typescript
function detectStuckTeams() {
  const teams = db.getActiveTeams();
  for (const team of teams) {
    const idleMinutes = (Date.now() - new Date(team.last_event_at).getTime()) / 60000;

    if (team.status === 'running' && idleMinutes > 5) {
      db.updateTeam(team.id, { status: 'idle' });
      sseBroadcast({ type: 'team_status_changed', team_id: team.id, status: 'idle' });
    }
    if (team.status === 'idle' && idleMinutes > 15) {
      db.updateTeam(team.id, { status: 'stuck' });
      sseBroadcast({ type: 'team_status_changed', team_id: team.id, status: 'stuck' });
    }
  }
}
setInterval(detectStuckTeams, 60_000);
```

---

## 11. Rozwiązania znanych problemów

### Problem 1: PR Watcher stuck

**Rozwiązanie w Fleet Commander:**
- Dashboard monitoruje PR status niezależnie od pr-watcher-idle.sh (polling co 30s)
- Jeśli PR merged → dashboard sam aktualizuje status teamu na `done`
- Jeśli CI failing >3 unique errors → dashboard flaguje team jako `blocked`
- PM widzi to na dashboardzie i może interweniować (stop, resume, message)
- **Nie zastępuje** istniejącego hooka — dodaje redundancję

### Problem 2: Cały zespół idle

**Rozwiązanie w Fleet Commander:**
- `PostToolUse` hook = heartbeat (dowód życia)
- Brak heartbeat >5min → `idle`, >15min → `stuck`
- Dashboard sortuje stuck teams na górę
- PM klika Message → wysyła komendę do zespołu
- PM widzi problem natychmiast, nie po 30 minutach ciszy

### Problem 3: Resume pain

**Rozwiązanie w Fleet Commander:**
- Dashboard przechowuje team state w SQLite (nie in-memory)
- Resume z dashboardu: jeden klik → `claude --worktree kea-{N} --resume`
- Dashboard wykrywa istniejące worktrees przy starcie (skan `.claude/worktrees/`)
- Nie wymaga bonanza.ps1 — launch/resume z UI
- Status teamów persystuje restart serwera

---

## 12. Struktura katalogów projektu

```
fleet-commander/
├── package.json
├── tsconfig.json
├── vite.config.ts
│
├── src/
│   ├── server/
│   │   ├── index.ts              # Fastify setup, route registration
│   │   ├── config.ts             # Ports, paths, intervals, thresholds
│   │   ├── db.ts                 # SQLite schema, migrations, queries
│   │   ├── routes/
│   │   │   ├── teams.ts          # /api/teams/*
│   │   │   ├── issues.ts         # /api/issues/*
│   │   │   ├── prs.ts            # /api/prs/*
│   │   │   ├── events.ts         # /api/events (hook receiver)
│   │   │   ├── stream.ts         # /api/stream (SSE)
│   │   │   └── system.ts         # /api/status, /api/cost
│   │   ├── services/
│   │   │   ├── team-manager.ts   # Spawn/stop/resume Claude processes
│   │   │   ├── github-poller.ts  # PR/CI/issue polling via gh CLI
│   │   │   ├── event-collector.ts # Hook event ingestion
│   │   │   ├── sse-broker.ts     # SSE connection management
│   │   │   ├── stuck-detector.ts # Periodic stuck/idle detection
│   │   │   └── cost-tracker.ts   # Parse output for usage data
│   │   └── types.ts
│   │
│   └── client/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── FleetGrid.tsx     # Main team list
│       │   ├── TeamRow.tsx       # Single team row
│       │   ├── IssueTree.tsx     # GitHub issue hierarchy
│       │   ├── TreeNode.tsx      # Recursive tree node
│       │   ├── TeamDetail.tsx    # Slide-over detail panel
│       │   ├── CostView.tsx      # Usage/cost dashboard
│       │   ├── LaunchDialog.tsx  # Launch team form
│       │   ├── CommandInput.tsx  # Send message to team
│       │   ├── StatusBadge.tsx   # Status indicator
│       │   ├── PRBadge.tsx       # PR + CI status
│       │   └── TopBar.tsx        # Summary pills + total cost
│       ├── hooks/
│       │   ├── useSSE.ts         # SSE connection + state
│       │   └── useApi.ts         # REST fetch wrapper
│       └── types.ts
│
├── hooks/                        # Shell scripts for .claude/hooks/
│   ├── send_event.sh             # Central event sender
│   ├── on_post_tool_use.sh       # Heartbeat hook
│   ├── on_session_start.sh
│   ├── on_session_end.sh
│   ├── on_stop.sh
│   ├── on_subagent_start.sh
│   ├── on_subagent_stop.sh
│   ├── on_notification.sh
│   └── on_tool_error.sh
│
├── mcp/                          # MCP server for team self-inspection
│   ├── server.ts
│   ├── tools.ts
│   ├── detect-team.ts
│   └── dashboard-client.ts
│
├── fleet.db                      # SQLite database (gitignored)
└── .gitignore
```

---

## 13. Fazy implementacji

### Faza 1: Core (MVP)

**Cel:** Zastąpić bonanza.ps1 + manualne monitorowanie

- [ ] Serwer Fastify + SQLite schema
- [ ] POST /api/events — hook receiver
- [ ] Hook scripts (send_event.sh + 9 wrappers)
- [ ] Team Manager (launch/stop z child_process.spawn)
- [ ] Stuck detector (idle/stuck z last_event_at)
- [ ] SSE broker
- [ ] React: Fleet Grid z TeamRow + StatusBadge
- [ ] React: TopBar z summary pills + cost

### Faza 2: GitHub integration

- [ ] GitHub poller (PR status, CI checks co 30s)
- [ ] Issue tree (GraphQL hierarchy query)
- [ ] React: Issue Tree view z Play button
- [ ] React: PRBadge z CI status
- [ ] Auto-detect PR when branch pushed

### Faza 3: Interaction

- [ ] Team Detail slide-over (events, sessions, PR)
- [ ] Command input (send message to team)
- [ ] Resume team z dashboardu
- [ ] Cost view

### Faza 4: MCP + Polish

- [ ] MCP server (fleet_status tool)
- [ ] Fallback mode (gh CLI when dashboard offline)
- [ ] Startup worktree discovery (re-attach to running teams)
- [ ] Cost tracking from Claude output parsing

---

## 14. Co v1 NIE zawiera

- **Multi-user / auth** — to narzędzie lokalne dla jednego PM
- **Docker / deployment** — localhost only
- **Analytics / charts** — surowe dane w tabelach
- **Automatic CI fix retry** — PM decyduje, nie system
- **Remote access** — desktop only
- **Nested teams / team-of-teams** — jeden team = jeden issue
- **GitHub webhooks** — polling via gh CLI (maszyna za firewallem)

---

## 15. Konfiguracja

```typescript
// src/server/config.ts
export const CONFIG = {
  port: 4680,
  repoRoot: process.env.FLEET_REPO_ROOT || findGitRoot(),
  githubRepo: 'itsg-global-agentic/itsg-kea',
  githubOrg: 'itsgglobal',          // for project board
  githubProjectId: 'PVT_kwDOBA8-2c4BOgAP',

  // Intervals
  githubPollIntervalMs: 30_000,      // PR/CI polling
  issuePollIntervalMs: 60_000,       // issue hierarchy refresh
  stuckCheckIntervalMs: 60_000,      // stuck detection loop

  // Thresholds
  idleThresholdMin: 5,               // running → idle
  stuckThresholdMin: 15,             // idle → stuck
  maxUniqueCiFailures: 3,            // ci_fail_count → blocked

  // Claude Code
  claudeCmd: 'claude',
  defaultPrompt: '/next-issue-kea',
  skipPermissions: true,

  // Database
  dbPath: path.join(__dirname, '../../fleet.db'),
};
```

---

## 16. Kluczowe decyzje i trade-offs

| Decyzja | Wybór | Alternatywa | Uzasadnienie |
|---------|-------|-------------|-------------|
| Hooks vs SDK | Hooks (command) | Claude Agent SDK query() | Hooks koegzystują z istniejącym flow bez zmian. SDK wymaga przepisania launch flow. |
| SSE vs WebSocket | SSE | WebSocket | Unidirectional server→client. Prostsze. Native EventSource w browsers. |
| gh CLI vs Octokit | gh CLI | @octokit/rest | Już zauthentykowane na maszynie. Zero konfiguracji. |
| SQLite vs in-memory | SQLite | Map/Array | Persystuje restart serwera. Query via SQL. WAL handles concurrent hook writes. |
| child_process vs SDK | child_process.spawn | claude-agent-sdk query() | Spawn zachowuje interaktywny tryb Claude (teams, subagents). SDK print mode nie wspiera multi-turn teams. |
| Rows vs Cards | Rows (64px) | Card grid | Density: 12 teamów widocznych na 1080p. PM chce overview, nie wizualizację. |
| Phase tracking | Dual (status + phase) | Single status | Rozdziela "czy agent żyje?" (operational) od "na jakim etapie workflow?" (domain). |

---

## Amendments (Phase 2)

### Multi-Project Support

Fleet Commander is a standalone application managing multiple repositories. Each project is a top-level entity that maps to one GitHub repository. The `projects` table stores `repo_root` (local path), `github_repo` (owner/name), `default_prompt`, and `team_prefix` (slug used for team ID generation, e.g., `kea`, `billing`).

Team IDs follow the format `{project_slug}-{ISSUE_NUMBER}` (e.g., `kea-763`, `billing-42`). The `teams` table gains a `project_id` foreign key. All team operations (launch, batch launch) require a `project_id`.

The global environment variables `FLEET_REPO_ROOT` and `FLEET_GITHUB_REPO` are removed. These values are now per-project fields in the `projects` table. `FLEET_COMMANDER_ROOT` replaces them to point to the Fleet Commander installation directory.

```sql
CREATE TABLE projects (
  id              INTEGER PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  repo_root       TEXT NOT NULL,
  github_repo     TEXT NOT NULL,       -- e.g., 'itsg-global-agentic/itsg-kea'
  default_prompt  TEXT,
  team_prefix     TEXT NOT NULL,       -- used in team ID: {prefix}-{issue}
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- teams table gains: project_id INTEGER REFERENCES projects(id)
```

**API endpoints:**
- `GET /api/projects` — list all projects
- `GET /api/projects/:id` — project detail
- `POST /api/projects` — create project
- `PUT /api/projects/:id` — update project
- `DELETE /api/projects/:id` — remove project

### Usage Tracking

Dollar cost tracking (`cost_entries` table, `cost-tracker.ts`, `/api/costs`) is replaced by usage percentage tracking. Fleet Commander now tracks Claude Code usage as a percentage of organization plan limits (input tokens, output tokens, cache read tokens as % of org quota) rather than dollar cost amounts.

```sql
CREATE TABLE usage_snapshots (
  id                INTEGER PRIMARY KEY,
  team_id           INTEGER NOT NULL REFERENCES teams(id),
  project_id        INTEGER REFERENCES projects(id),
  timestamp         TEXT NOT NULL DEFAULT (datetime('now')),
  usage_pct         REAL,              -- overall usage % of plan limit
  input_tokens      INTEGER DEFAULT 0,
  output_tokens     INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0
);
```

**API endpoints (replacing `/api/costs`):**
- `GET /api/usage` — aggregated usage
- `GET /api/usage/by-team` — per-team usage breakdown
- `GET /api/usage/by-day` — daily usage summary
- `GET /api/usage/current` — current usage percentage

The `v_team_dashboard` view is updated to join through `projects` and use `usage_snapshots` instead of `cost_entries`.

**File renames:**
- `src/server/routes/costs.ts` -> `src/server/routes/usage.ts`
- `src/server/services/cost-tracker.ts` -> `src/server/services/usage-tracker.ts`
