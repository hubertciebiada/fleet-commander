# Fleet Commander

PM dashboard for orchestrating multiple Claude Code agent teams working on GitHub issues.

## Status

Design phase — see [PRD](docs/prd.md) for full specification.

## Architecture

TypeScript web application: Fastify backend + React frontend + SQLite database.
Monitors agent teams via Claude Code hooks, GitHub API polling, and MCP self-inspection.

## Docs

- [PRD](docs/prd.md) — full product requirements document
