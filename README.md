# Fleet Commander

Web dashboard for orchestrating multiple Claude Code agent teams working on GitHub issues in parallel. A PM can launch, monitor, intervene, and resume teams from a single dark-themed interface.

## Prerequisites

- **Node.js 20+** ([download](https://nodejs.org/))
- **GitHub CLI** (`gh`) authenticated -- run `gh auth status` to verify
- **Git** with worktree support (Git 2.15+)
- **Windows 10+** with Git Bash (or Linux/macOS)

## Quick Start

```bash
git clone https://github.com/user/fleet-commander.git
cd fleet-commander
npm install
npm run build
npm run dev          # Development (Fastify + Vite HMR)
npm start            # Production (port 4680)
```

Open http://localhost:4680 in your browser.

## Installing Hooks into a Target Repo

Fleet Commander monitors agent teams via bash hook scripts. Install them into any target repository:

```bash
./scripts/install.sh /path/to/target/repo
```

This copies hook scripts into the target repo's `.claude/` directory and merges the required `settings.json` entries. Hooks are additive observers -- they do not modify or replace existing hooks.

To cleanly remove all Fleet Commander hooks from a target repo:

```bash
./scripts/uninstall.sh /path/to/target/repo
```

## Development

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend (Fastify) + frontend (Vite) with hot reload |
| `npm run build` | Production build (TypeScript + Vite) |
| `npm test` | Backend unit tests (208+ tests) |
| `npm run test:client` | Frontend component tests (42+ tests) |
| `npm run test:e2e` | End-to-end smoke test (requires running server) |
| `npm run test:watch` | Run backend tests in watch mode |

### Project Structure

```
fleet-commander/
├── src/
│   ├── server/              # Fastify backend
│   │   ├── index.ts         # Server entry point
│   │   ├── config.ts        # Environment-driven configuration
│   │   ├── db.ts            # SQLite database layer (WAL mode)
│   │   ├── routes/          # API route handlers
│   │   │   ├── teams.ts     # Team CRUD + lifecycle
│   │   │   ├── events.ts    # Hook event ingestion
│   │   │   ├── prs.ts       # Pull request management
│   │   │   ├── issues.ts    # GitHub issue tracking
│   │   │   ├── costs.ts     # Cost aggregation
│   │   │   ├── stream.ts    # SSE real-time stream
│   │   │   └── system.ts    # Diagnostics + health
│   │   ├── services/        # Business logic
│   │   │   ├── team-manager.ts      # Spawn/stop/resume via child_process
│   │   │   ├── event-collector.ts   # Process incoming hook events
│   │   │   ├── github-poller.ts     # Poll GitHub via gh CLI (30s)
│   │   │   ├── stuck-detector.ts    # Detect idle/stuck teams (60s)
│   │   │   ├── sse-broker.ts        # Server-Sent Events broadcaster
│   │   │   ├── cost-tracker.ts      # Token/cost accounting
│   │   │   ├── startup-recovery.ts  # Recover state on restart
│   │   │   └── issue-fetcher.ts     # Fetch issues from GitHub
│   │   └── middleware/
│   │       └── error-handler.ts     # Global error handling
│   ├── client/              # React SPA (dark theme)
│   │   ├── main.tsx         # Client entry point
│   │   ├── App.tsx          # Router + layout
│   │   ├── components/      # Reusable UI components
│   │   ├── views/           # Page-level views
│   │   ├── context/         # React context (FleetContext)
│   │   └── hooks/           # Custom hooks (useSSE, useApi)
│   └── shared/
│       └── types.ts         # Shared TypeScript interfaces + enums
├── hooks/                   # Bash hook scripts (installed into target repos)
├── scripts/                 # Install/uninstall scripts
├── mcp/                     # MCP server (fleet_status tool)
├── tests/                   # Test suites (server, client, e2e, integration)
├── docs/                    # Design documents
└── CLAUDE.md                # Agent reference guide
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4680` | Dashboard server port |
| `FLEET_SERVER_URL` | `http://localhost:4680` | Dashboard API base URL (used by hooks) |
| `FLEET_TEAM_ID` | *(auto-detected)* | Override team ID detection in hooks |
| `FLEET_COMMANDER_OFF` | *(unset)* | Set to `1` to disable hook event sending |
| `FLEET_TIMEOUT_MS` | `5000` | HTTP timeout for MCP-to-dashboard API calls |

## Architecture

```
Browser --> React SPA (dark theme, Tailwind CSS)
  |  SSE (real-time updates) + REST API
  v
Fastify Server (port 4680)
  |-- Team Manager     (child_process.spawn for Claude Code)
  |-- Event Collector  (receives hook POST events)
  |-- GitHub Poller    (gh CLI, every 30s for PR/CI status)
  |-- Stuck Detector   (60s check for idle/stuck teams)
  |-- Cost Tracker     (token usage aggregation)
  |-- Startup Recovery (reconstruct state on restart)
  v
SQLite (fleet.db, WAL mode, better-sqlite3)
```

Hook events flow from Claude Code instances via `curl POST` to `/api/events`. The dashboard independently polls GitHub via `gh` CLI for PR and CI status. State can be reconstructed from git and GitHub if events are lost.

## API Overview

| Group | Endpoints | Description |
|-------|-----------|-------------|
| **Teams** | `GET /api/teams`, `GET /api/teams/:id`, `POST /api/teams/launch`, `POST /api/teams/launch-batch`, `POST /api/teams/:id/stop`, `POST /api/teams/:id/resume`, `POST /api/teams/:id/restart`, `POST /api/teams/stop-all`, `POST /api/teams/:id/send-message`, `POST /api/teams/:id/set-phase`, `POST /api/teams/:id/acknowledge`, `GET /api/teams/:id/output` | Team lifecycle and intervention |
| **Events** | `POST /api/events`, `GET /api/events` | Hook event ingestion and query |
| **PRs** | `GET /api/prs`, `GET /api/prs/:number`, `POST /api/prs/refresh`, `POST /api/prs/:number/auto-merge`, `POST /api/prs/:number/update-branch`, `POST /api/prs/:number/retry-ci` | Pull request management |
| **Issues** | `GET /api/issues`, `GET /api/issues/next`, `GET /api/issues/available`, `POST /api/issues/refresh` | GitHub issue tracking |
| **Costs** | `GET /api/costs`, `GET /api/costs/by-team`, `GET /api/costs/by-day` | Cost aggregation and breakdown |
| **Diagnostics** | `GET /api/diagnostics/stuck`, `GET /api/diagnostics/blocked`, `GET /api/diagnostics/health`, `GET /api/status` | Fleet health and diagnostics |
| **Stream** | `GET /api/stream` | SSE real-time event stream |

## Troubleshooting

**Port 4680 already in use**
```bash
PORT=4681 npm run dev
```

**`gh` not authenticated**
```bash
gh auth login
gh auth status   # verify
```

**Git Bash path issues on Windows**
Use forward slashes in all paths. Avoid backslashes in scripts and configuration.

**Database locked**
Ensure only one server instance is running. Fleet Commander uses SQLite in WAL mode, which supports concurrent reads but only one writer.

**Worktree issues**
```bash
git worktree list          # see all worktrees
git worktree prune         # clean up stale entries
```

**Hook events not arriving**
- Verify the server is running on the expected port
- Check that `FLEET_COMMANDER_OFF` is not set to `1`
- Hooks are fire-and-forget; if the server was down, events are dropped

## Design Documents

| Document | Description |
|----------|-------------|
| [PRD](docs/prd.md) | Full product requirements, architecture, API spec, UI wireframes |
| [State Machines](docs/state-machines.md) | 5 FSMs: team status, phase, PR lifecycle, issue board, event pipeline |
| [Data Model](docs/data-model.sql) | SQLite schema (tables, views, indexes) |
| [Type Definitions](docs/types.ts) | TypeScript interfaces and enum types |
| [Hook Architecture](hooks/DESIGN.md) | Hook design, payload format, edge cases |
| [MCP Server](mcp/DESIGN.md) | MCP server design, `fleet_status` tool, auto-detection |
