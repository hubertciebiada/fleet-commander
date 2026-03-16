# Fleet Commander -- Streaming Claude Code Processes: Research & Plan

**Date:** 2026-03-16
**Status:** Research complete, awaiting decision

---

## 1. Current State

### How Claude Code is spawned today

In `src/server/services/team-manager.ts`, Fleet Commander spawns Claude Code via
`child_process.spawn`:

```typescript
// Headless mode (default): spawn in background, capture output
const child = spawn(config.claudeCmd, args, {
  cwd: project.repoPath,
  env: spawnEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
  detached: false,
});
```

**Arguments passed (launch):**
```
claude --dangerously-skip-permissions --worktree kea-{N} "/next-issue {N}"
```

**Arguments passed (resume):**
```
claude --dangerously-skip-permissions --resume --worktree kea-{N}
```

### Key observation: NO `-p` flag is used

The current spawn does **not** pass `-p` / `--print`. This means Claude Code
starts in **interactive mode**, which is the full agentic mode: it uses tools,
reads files, edits code, runs commands, spawns sub-agents, and continues
autonomously until its task is complete. This can run for hours.

### What we capture today

- **stdout/stderr** are piped and stored in a circular buffer (500 lines per
  team, configurable via `config.outputBufferLines`).
- **Process exit** is handled (`child.on('exit', ...)` and `child.on('error', ...)`).
  On exit, team status transitions to `done` (exit code 0) or `failed` (nonzero).
- **PID** is stored in the database for process management.
- **Hooks** fire HTTP POSTs to Fleet Commander independently (SessionStart,
  Stop, SubagentStart, etc.) -- these drive the state machine regardless of
  stdout capture.

### Interactive mode (non-headless)

When `headless=false` on Windows, a new `cmd.exe` terminal window is opened
via `start`. In this mode, no stdout/stderr capture is possible, but hooks
still function.

---

## 2. Problem Analysis

### Does Claude Code exit too early?

**No.** When spawned without `-p`, Claude Code runs in interactive/agentic mode.
It does NOT return after a single answer. It continues using tools, making API
calls, and working autonomously until the task is complete or it runs out of
things to do. Sessions can run for 1.5+ hours as observed.

### What might look like "early exit"

1. **Interactive mode expects stdin.** When `stdio[0]` is `'ignore'` (current
   config), Claude Code's interactive mode may behave differently than expected
   because it cannot receive user input. However, with `--worktree` and an
   initial prompt, Claude Code should enter agentic mode and work autonomously
   without needing stdin.

2. **The prompt is passed as a positional argument.** The current code passes
   the prompt as `args[args.length - 1]`. This is the correct way to start an
   interactive session with an initial prompt: `claude "do something"`.

3. **Output is plain text, not structured.** Without `--output-format stream-json`,
   stdout contains rendered terminal output (ANSI codes, progress indicators,
   etc.), not structured events. This makes programmatic parsing unreliable.

### Actual gaps

| Gap | Impact | Severity |
|-----|--------|----------|
| No structured output from Claude process | Cannot parse tool use, thinking, cost updates from stdout | Medium |
| Status relies entirely on hooks | If hooks fail to POST, Fleet Commander has no visibility | High |
| No way to send follow-up messages | Cannot intervene mid-session via stdin (stdin is `'ignore'`) | Medium |
| Output buffer is plain text with ANSI codes | Dashboard shows garbled terminal output | Low |
| No budget cap per team | A stuck team can burn unlimited API credits | High |

---

## 3. Option A: CLI Spawn with `--print --output-format stream-json`

### Approach

Switch from interactive mode to print/SDK mode with structured streaming:

```typescript
const args = [
  '-p',                              // print mode (non-interactive, agentic)
  '--output-format', 'stream-json',  // structured JSON streaming
  '--verbose',                        // include tool use details
  '--include-partial-messages',       // token-by-token streaming
  '--dangerously-skip-permissions',
  '--worktree', worktreeName,
  resolvedPrompt,
];
```

### How it works

With `-p`, Claude Code still runs in full agentic mode (uses tools, keeps
going until done). The difference is:
- Output is newline-delimited JSON (NDJSON), one event per line
- Each line has a `type` field: `system`, `assistant`, `result`, `stream_event`
- Tool calls, text, thinking are all structured
- Process exits when the task is complete

### Structured events we would receive

```jsonl
{"type":"system","subtype":"init","session_id":"abc-123",...}
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Let me "}}}
{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"tool_use","name":"Read"}}}
{"type":"assistant","message":{...},"session_id":"abc-123"}
{"type":"result","result":"Task complete...","session_id":"abc-123","cost_usd":1.23}
```

### Additional useful flags

| Flag | Value | Purpose |
|------|-------|---------|
| `--max-budget-usd` | e.g. `5.00` | Hard budget cap per team, prevents runaway spend |
| `--max-turns` | e.g. `200` | Limit agentic loops |
| `--name` | worktree name | Session naming for resume |
| `--session-id` | UUID | Deterministic session ID for tracking |
| `--model` | configurable | Per-team model override |
| `--mcp-config` | path | Fleet Commander MCP server for bidirectional comms |
| `--continue` / `--resume` | session ID | Resume previous session |

### Resuming with `-p`

```typescript
// Resume: continue a previous session in print mode
const args = [
  '-p',
  '--output-format', 'stream-json',
  '--resume', sessionId,       // specific session UUID
  '--dangerously-skip-permissions',
  'Continue working on the task',
];
```

### Pros

- Minimal change to existing architecture (still `child_process.spawn`)
- Structured output enables rich dashboard (tool use display, cost tracking)
- Budget caps (`--max-budget-usd`) protect against runaway costs
- Session ID capture enables reliable resume
- Hooks continue to work as before (belt and suspenders)
- No new dependencies

### Cons

- Still a subprocess -- less control than in-process SDK
- Cannot send follow-up messages mid-session (one prompt per spawn)
- Resume requires re-spawning the process

### Migration effort: LOW (1-2 days)

Change the args array, add NDJSON line parser for stdout, extract session_id
and cost from result events.

---

## 4. Option B: Claude Agent SDK (TypeScript) -- `@anthropic-ai/claude-agent-sdk`

### Package details

- **npm:** `@anthropic-ai/claude-agent-sdk` (v0.2.76, published 2 days ago)
- **Also exists:** `@anthropic-ai/claude-code` (v2.1.76) -- this is the CLI itself
- **Language:** TypeScript (also available as `claude-agent-sdk` for Python)
- **License:** Anthropic Commercial Terms of Service
- **Repo:** https://github.com/anthropics/claude-agent-sdk-typescript

### Core API

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const agentRun = query({
  prompt: `/next-issue ${issueNumber}`,
  options: {
    cwd: worktreeAbsPath,
    allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep", "Write", "Agent"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,    // real-time streaming
    maxBudgetUsd: 5.00,              // budget cap
    maxTurns: 200,                   // turn limit
    model: "opus",                   // or configurable
    resume: previousSessionId,       // resume support
    sessionId: deterministicUUID,    // predictable session IDs
    env: {
      ...process.env,
      FLEET_TEAM_ID: worktreeName,
    },
    settingSources: ["project"],     // load .claude/settings.json
    hooks: {
      PostToolUse: [{ matcher: "Edit|Write", hooks: [onFileChange] }],
      Stop: [{ matcher: "*", hooks: [onAgentStop] }],
    },
    mcpServers: {
      "fleet-commander": {
        command: "node",
        args: ["path/to/fleet-mcp-server.js"],
      },
    },
  },
});
```

### Streaming consumption

```typescript
for await (const message of agentRun) {
  switch (message.type) {
    case "system":
      if (message.subtype === "init") {
        sessionId = message.session_id;
      }
      break;

    case "stream_event":
      // Real-time token streaming
      if (message.event.type === "content_block_delta") {
        if (message.event.delta.type === "text_delta") {
          appendToOutputBuffer(teamId, message.event.delta.text);
        }
      }
      if (message.event.type === "content_block_start") {
        if (message.event.content_block.type === "tool_use") {
          updateDashboard(teamId, `Using ${message.event.content_block.name}...`);
        }
      }
      break;

    case "assistant":
      // Complete assistant message (after each turn)
      processAssistantMessage(teamId, message);
      break;

    case "result":
      // Agent finished
      updateTeamStatus(teamId, "done");
      recordCost(teamId, message.cost_usd);
      break;
  }
}
```

### Key SDK features relevant to Fleet Commander

| Feature | How it helps |
|---------|-------------|
| `abortController` | Clean cancellation of running agents (replaces `taskkill`) |
| `includePartialMessages` | Real-time streaming to dashboard |
| `maxBudgetUsd` | Per-team budget protection |
| `maxTurns` | Prevent infinite loops |
| `resume` / `sessionId` | First-class session management |
| `hooks` (in-process) | Replace file-based hooks with callbacks |
| `agents` | Define sub-agents programmatically |
| `mcpServers` | Bidirectional Fleet Commander MCP |
| `cwd` | Set working directory per agent |
| `env` | Pass environment variables |
| `close()` on Query | Graceful shutdown |
| `interrupt()` on Query | Send interrupt mid-session |
| `streamInput()` | Send follow-up messages to running agent (multi-turn!) |
| `listSessions()` / `getSessionMessages()` | Query session history |

### Multi-turn conversations (intervention)

The SDK supports streaming input mode for multi-turn conversations:

```typescript
import { query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

// Create an async generator for user messages
async function* userMessages(): AsyncIterable<SDKUserMessage> {
  yield { type: "user", content: `/next-issue ${issueNumber}` };
  // ... later, when PM wants to intervene:
  yield { type: "user", content: "Focus on the database migration first" };
}

const agentRun = query({
  prompt: userMessages(),
  options: { /* ... */ }
});
```

Or use `streamInput()` to send messages after the query starts:

```typescript
const agentRun = query({ prompt: initialPrompt, options: { /* ... */ } });

// Later, when PM intervenes from the dashboard:
await agentRun.streamInput(async function*() {
  yield { type: "user", content: "Stop what you're doing and fix the CI failure" };
}());
```

### Pros

- In-process TypeScript -- native integration, no subprocess parsing
- Real-time streaming with typed events
- AbortController for clean cancellation
- Multi-turn support (send messages to running agent!)
- In-process hooks (no HTTP round-trip)
- Budget and turn limits built in
- Session management (resume, fork, list)
- Same tools, capabilities, and context as CLI

### Cons

- New dependency (~60 MB uncompressed)
- Larger refactor of TeamManager (replace spawn with SDK calls)
- SDK is relatively new (v0.2.x) -- API may evolve
- Runs Claude Code in-process (Node.js) -- memory/CPU implications when
  running 10+ concurrent agents in the same server process
- Requires API key auth (not Claude subscription login)

### Migration effort: MEDIUM (3-5 days)

Replace spawn logic in TeamManager with SDK `query()` calls. Refactor output
capture to use async generator. Add AbortController management. Update resume
logic. Keep hooks as fallback or migrate to SDK hooks.

---

## 5. Option C: Python Submodule (`claude-agent-sdk` for Python)

### Package details

- **pip:** `claude-agent-sdk`
- **API:** Identical to TypeScript but in Python async syntax

```python
from claude_agent_sdk import query, ClaudeAgentOptions

async for message in query(
    prompt=f"/next-issue {issue_number}",
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Edit", "Bash"],
        include_partial_messages=True,
        max_budget_usd=5.0,
    ),
):
    # Stream events to Fleet Commander via HTTP or stdout JSONL
    print(json.dumps(message_to_dict(message)))
```

### Architecture

```
Fleet Commander (Node.js)
  |
  +-- spawn python/agent_runner.py --issue 763 --worktree kea-763
  |     |
  |     +-- claude_agent_sdk.query(...)
  |     |     async for message -> stdout JSONL
  |     |
  |     +-- HTTP POST to Fleet Commander on key events
  |
  +-- parse stdout JSONL (same as Option A)
```

### Pros

- Python SDK may be more mature / better documented
- Separate process isolation (memory/CPU)

### Cons

- Adds Python as a runtime dependency
- Two-language codebase (TypeScript + Python)
- Extra serialization layer (Python -> JSONL -> Node.js)
- Effectively the same as Option A but with more complexity
- No advantage over the TypeScript SDK which has feature parity

### Migration effort: HIGH (5-7 days)

Write Python agent runner, IPC protocol, integrate into TeamManager. Not
recommended since TypeScript SDK exists with identical capabilities.

---

## 6. Option D: Anthropic API Direct (`@anthropic-ai/sdk`)

### Approach

Use the low-level Anthropic API SDK to implement a custom tool-use loop:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
let messages = [{ role: "user", content: prompt }];

while (true) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    messages,
    tools: customToolDefinitions,
    max_tokens: 8192,
  });

  if (response.stop_reason === "end_turn") break;

  // Execute tool calls ourselves
  for (const block of response.content) {
    if (block.type === "tool_use") {
      const result = await executeToolLocally(block);
      messages.push({ role: "tool", tool_use_id: block.id, content: result });
    }
  }
}
```

### Pros

- Maximum control over the agent loop
- No dependency on Claude Code at all
- Can customize tool execution precisely

### Cons

- Must reimplement ALL tools (Read, Edit, Bash, Grep, Glob, Write, etc.)
- Must reimplement agent loop, context management, compaction, sub-agents
- Must reimplement file checkpointing, session persistence
- Must handle streaming ourselves
- Massive engineering effort to replicate what Claude Code already does
- Loses Claude Code's optimized system prompt and tool definitions
- No sub-agent support without building it ourselves

### Migration effort: VERY HIGH (weeks to months)

Not recommended. This is rebuilding Claude Code from scratch.

---

## 7. Recommendation

### Primary: Option B -- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)

**This is the clear winner.** Reasons:

1. **Native TypeScript** -- same language as Fleet Commander, typed events,
   no subprocess parsing.

2. **Streaming is first-class** -- `for await (const message of query(...))`
   gives real-time events with typed discriminated unions.

3. **Multi-turn intervention** -- `streamInput()` and `interrupt()` enable
   the "PM sends a message to a running team" feature that is impossible
   with subprocess spawning.

4. **Budget protection** -- `maxBudgetUsd` prevents runaway costs, a critical
   gap in the current implementation.

5. **Clean lifecycle** -- `AbortController` and `close()` replace `taskkill`
   hacks. Proper cancellation propagation.

6. **Session management** -- `resume`, `sessionId`, `listSessions()` are
   built-in. No more fragile PID-based tracking.

7. **In-process hooks** -- Callbacks instead of HTTP POSTs. More reliable,
   lower latency. Can keep HTTP hooks as a fallback during migration.

### Fallback: Option A -- CLI with `--print --output-format stream-json`

If the SDK proves unstable or has memory issues with 10+ concurrent agents:

1. Add `-p --output-format stream-json --include-partial-messages --verbose`
   to the existing spawn args.
2. Add `--max-budget-usd` for cost protection.
3. Parse NDJSON lines from stdout.
4. Extract session_id from the `init` system message for resume support.

This is a much smaller change and provides 80% of the benefit with minimal
risk. It can serve as a stepping stone before full SDK migration.

### Implementation sequence

```
Phase 1 (Quick Win, 1-2 days):
  - Add --max-budget-usd to existing spawn args
  - Add --name flag for better session identification
  - Validate that current spawn actually works for long-running tasks

Phase 2 (Option A, 2-3 days):
  - Switch to -p --output-format stream-json
  - Add NDJSON parser for stdout
  - Extract session_id, cost, tool use events
  - Feed structured events to SSE broker for dashboard

Phase 3 (Option B, 3-5 days):
  - npm install @anthropic-ai/claude-agent-sdk
  - Refactor TeamManager to use query() instead of spawn()
  - Implement AbortController-based stop/cancel
  - Add multi-turn support (streamInput for PM intervention)
  - Migrate hooks to SDK callbacks (keep HTTP hooks as fallback)
  - Add per-team budget and turn limits

Phase 4 (Polish):
  - Dashboard UI for streaming agent output
  - PM intervention UI (send message to running team)
  - Session history browser (listSessions, getSessionMessages)
  - Per-team model configuration
```

### Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| SDK v0.2.x API instability | Pin version, abstract behind TeamManager interface |
| Memory pressure with 10+ in-process agents | Each query() spawns a separate Claude Code process internally; monitor and fall back to Option A if needed |
| API key required (not subscription login) | Document setup; check if subscription auth is supported |
| 60 MB SDK package size | Acceptable for server-side application |

---

## Appendix: Key References

- **Claude Agent SDK (TypeScript):** https://platform.claude.com/docs/en/agent-sdk/typescript
- **Claude Agent SDK (Overview):** https://platform.claude.com/docs/en/agent-sdk/overview
- **Streaming Output:** https://platform.claude.com/docs/en/agent-sdk/streaming-output
- **CLI Reference:** https://code.claude.com/docs/en/cli-reference
- **Headless/Programmatic Mode:** https://code.claude.com/docs/en/headless
- **npm `@anthropic-ai/claude-agent-sdk`:** https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk (v0.2.76)
- **npm `@anthropic-ai/claude-code`:** https://www.npmjs.com/package/@anthropic-ai/claude-code (v2.1.76, the CLI itself)
- **GitHub (TypeScript SDK):** https://github.com/anthropics/claude-agent-sdk-typescript
- **Current TeamManager:** `src/server/services/team-manager.ts`
- **Current Config:** `src/server/config.ts`
