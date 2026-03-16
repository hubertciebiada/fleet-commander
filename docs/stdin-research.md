# Stdin Research: Sending Messages to Running Claude Code Processes

**Date:** 2026-03-17
**CC Version:** 2.1.76
**Status:** Research complete

---

## Executive Summary

Claude Code CLI **does** support receiving follow-up messages via stdin in print mode,
using `--input-format stream-json`. This is the CLI equivalent of the Agent SDK's
streaming input mode. Combined with `--output-format stream-json`, it enables
**full bidirectional NDJSON streaming** over stdin/stdout -- exactly what Fleet
Commander needs for PM-to-agent messaging.

There are **three viable approaches**, ranked by recommendation:

| Rank | Approach | Effort | Multi-turn | Mid-session Messaging |
|------|----------|--------|------------|-----------------------|
| 1 | **Agent SDK V2** (`send()`/`stream()`) | Medium | Native | Native |
| 2 | **CLI `--input-format stream-json`** (stdin pipe) | Low | Native | Native |
| 3 | **MCP `fleet_status` pm_message** (current) | Done | Via polling | Indirect (agent must call tool) |

**Recommendation:** Use approach #2 (CLI stdin) as an immediate upgrade, then
migrate to approach #1 (Agent SDK V2) for the full feature set.

---

## 1. Does CC Accept Stdin Input in Print Mode?

### Answer: YES, with `--input-format stream-json`

From `claude --help`:

```
--input-format <format>   Input format (only works with --print):
                          "text" (default), or "stream-json"
                          (realtime streaming input)
                          (choices: "text", "stream-json")
```

**How it works:**

- `--input-format text` (default): Reads stdin as a single text blob, appended to
  the positional prompt. This is what `cat file | claude -p "query"` uses. It reads
  stdin to EOF, then starts processing. **No multi-turn support.**

- `--input-format stream-json`: Reads stdin as NDJSON. Each line is a JSON message
  conforming to the `SDKUserMessage` type. The process stays alive and processes
  messages as they arrive. **Full multi-turn support.**

### Key insight

When `--input-format stream-json` is used:
- The positional prompt argument is ignored (or optional)
- Messages are sent as JSON objects on stdin, one per line
- The process does NOT exit after the first response
- It behaves like the Agent SDK's streaming input mode, but over stdio

---

## 2. The `--input-format stream-json` Protocol

### Input message format (stdin)

Each line sent to stdin must be a JSON object matching the `SDKUserMessage` type:

```typescript
type SDKUserMessage = {
  type: "user";
  session_id: string;       // Can be empty string ""
  message: {
    role: "user";
    content: string | ContentBlock[];  // Simple string or rich content
  };
  parent_tool_use_id: string | null;
};
```

**Minimal example:**
```json
{"type":"user","session_id":"","message":{"role":"user","content":"Say hello"},"parent_tool_use_id":null}
```

**With rich content (images, etc.):**
```json
{"type":"user","session_id":"","message":{"role":"user","content":[{"type":"text","text":"Review this diagram"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"..."}}]},"parent_tool_use_id":null}
```

### Output message format (stdout)

With `--output-format stream-json`, stdout emits NDJSON events:

```jsonl
{"type":"system","subtype":"init","session_id":"abc-123","tools":["Read","Edit","Bash",...],...}
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}},...}
{"type":"assistant","message":{...},"session_id":"abc-123"}
{"type":"result","subtype":"success","session_id":"abc-123","total_cost_usd":0.05,...}
```

### Additional flags

| Flag | Purpose |
|------|---------|
| `--replay-user-messages` | Re-emit user messages from stdin back on stdout for acknowledgment. Only works with `--input-format=stream-json` and `--output-format=stream-json`. |
| `--include-partial-messages` | Emit `stream_event` messages for token-by-token streaming. |
| `--verbose` | Include tool use details in output. |

---

## 3. Multi-Turn Support in Print Mode

### Answer: YES, with two approaches

**Approach A: `--input-format stream-json` (within a single process)**

The process stays alive. You write multiple user messages to stdin over time. Each
message triggers a full agentic response (tool use, thinking, etc.). The process
only exits when stdin closes (EOF) or the budget is exhausted.

```
[Fleet Commander]                    [Claude Code Process]
     |                                      |
     |--- stdin: {"type":"user",...} ------>|
     |                                      |--- (agent works, uses tools)
     |<--- stdout: stream_event ... --------|
     |<--- stdout: assistant ... ------------|
     |<--- stdout: result ... --------------|
     |                                      |
     |  (time passes, PM sends message)     |
     |                                      |
     |--- stdin: {"type":"user",...} ------>|
     |                                      |--- (agent works on new instruction)
     |<--- stdout: stream_event ... --------|
     |<--- stdout: result ... --------------|
     |                                      |
     |--- stdin: EOF ---------------------->|
     |                                      |--- (process exits)
```

**Approach B: `--continue` / `--resume` (new process per turn)**

Spawn a new `claude -p --continue` or `claude -p --resume <session-id>` process
for each follow-up message. This starts a new process that loads the previous
session's context.

```bash
# First turn
session_id=$(claude -p "Do task X" --output-format json | jq -r '.session_id')

# Follow-up turn (new process, same session context)
claude -p --resume "$session_id" "Now focus on Y" --output-format json
```

### Comparison

| Feature | `--input-format stream-json` | `--continue`/`--resume` |
|---------|------------------------------|------------------------|
| Latency per turn | Low (no process startup) | High (new process, reload context) |
| Session continuity | Automatic (same process) | Must track session_id |
| Memory overhead | One long-lived process | Fresh process each time |
| Complexity | Higher (manage stdin pipe) | Lower (fire-and-forget) |
| Mid-task interruption | Yes (send message while agent is working) | No (must wait for process to exit) |

---

## 4. Practical Implementation for Fleet Commander

### Current spawn code (stdin is `'ignore'`)

```typescript
const child = spawn(claudePath, args, {
  cwd: project.repoPath,
  env: spawnEnv,
  stdio: ['ignore', 'pipe', 'pipe'],  // stdin ignored!
  detached: false,
});
```

### Updated spawn with stdin pipe

```typescript
const args = [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--dangerously-skip-permissions',
  '--worktree', worktreeName,
  '--max-budget-usd', String(config.maxBudgetPerTeam || 5),
  '--mcp-config', mcpConfigPath,
];

const child = spawn(claudePath, args, {
  cwd: project.repoPath,
  env: spawnEnv,
  stdio: ['pipe', 'pipe', 'pipe'],  // stdin is now 'pipe'!
  detached: false,
});

// Store stdin reference for later messaging
team.stdinStream = child.stdin;
```

### Sending the initial prompt

```typescript
function sendMessage(stdin: Writable, content: string): void {
  const msg: SDKUserMessage = {
    type: 'user',
    session_id: '',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  };
  stdin.write(JSON.stringify(msg) + '\n');
}

// Send initial task
sendMessage(child.stdin!, `/next-issue ${issueNumber}`);
```

### Sending a PM message mid-session

```typescript
// Called from the dashboard API when PM types a message
function sendPmMessage(teamId: string, message: string): void {
  const team = getTeam(teamId);
  if (!team?.stdinStream || team.stdinStream.destroyed) {
    throw new Error('Team process stdin not available');
  }
  sendMessage(team.stdinStream, message);
}
```

### Parsing NDJSON output

```typescript
import { createInterface } from 'readline';

const rl = createInterface({ input: child.stdout! });

rl.on('line', (line: string) => {
  try {
    const event = JSON.parse(line);
    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          team.sessionId = event.session_id;
        }
        break;

      case 'assistant':
        // Complete assistant message after each turn
        updateDashboard(teamId, event);
        break;

      case 'result':
        if (event.subtype === 'success') {
          team.costUsd = event.total_cost_usd;
          // Agent finished responding to the last user message.
          // The process is still alive if stdin is open.
        }
        break;

      case 'stream_event':
        // Real-time token streaming
        if (event.event?.delta?.type === 'text_delta') {
          appendToOutputBuffer(teamId, event.event.delta.text);
        }
        break;
    }
  } catch {
    // Non-JSON line (e.g., debug output on stderr)
  }
});
```

### Graceful shutdown

```typescript
function stopTeam(teamId: string): void {
  const team = getTeam(teamId);
  if (team?.stdinStream && !team.stdinStream.destroyed) {
    // Close stdin -> Claude Code finishes current work and exits
    team.stdinStream.end();
  }
}
```

---

## 5. Agent SDK Approach (Alternative)

The `@anthropic-ai/claude-agent-sdk` TypeScript SDK provides the same capability
with a higher-level API. There are two versions:

### V1: `query()` with `streamInput()`

```typescript
import { query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

// Create async generator for user messages
async function* userMessages(): AsyncIterable<SDKUserMessage> {
  yield {
    type: "user",
    session_id: "",
    message: { role: "user", content: `/next-issue ${issueNumber}` },
    parent_tool_use_id: null,
  };
}

const agentRun = query({
  prompt: userMessages(),
  options: {
    cwd: worktreeAbsPath,
    allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep", "Write", "Agent"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    maxBudgetUsd: 5.00,
  },
});

// Later, send a follow-up message mid-session:
await agentRun.streamInput(async function*() {
  yield {
    type: "user",
    session_id: "",
    message: { role: "user", content: "Stop and fix the CI failure first" },
    parent_tool_use_id: null,
  };
}());

// Or interrupt the current work:
await agentRun.interrupt();

// Consume output
for await (const message of agentRun) {
  // ... process messages
}
```

### V2 (Preview): `send()` / `stream()` -- Simpler API

```typescript
import { unstable_v2_createSession } from "@anthropic-ai/claude-agent-sdk";

await using session = unstable_v2_createSession({
  model: "claude-opus-4-6",
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
  maxBudgetUsd: 5.00,
  cwd: worktreeAbsPath,
});

// Turn 1: Initial task
await session.send(`/next-issue ${issueNumber}`);
for await (const msg of session.stream()) {
  if (msg.type === "result") {
    console.log("Turn 1 complete, cost:", msg.total_cost_usd);
  }
}

// Turn 2: PM intervention
await session.send("Focus on the database migration first");
for await (const msg of session.stream()) {
  // ... process response
}
```

### SDK vs CLI stdin comparison

| Feature | CLI `--input-format stream-json` | Agent SDK V1 `query()` | Agent SDK V2 `send()`/`stream()` |
|---------|----------------------------------|------------------------|----------------------------------|
| Language | Any (JSON over stdio) | TypeScript | TypeScript |
| Multi-turn | Yes | Yes | Yes |
| Mid-task interrupt | Send message while agent is working | `interrupt()` method | Not yet (V2 limitation) |
| Process model | Subprocess (spawn) | Subprocess (SDK spawns internally) | Subprocess (SDK spawns internally) |
| Budget cap | `--max-budget-usd` | `maxBudgetUsd` option | `maxBudgetUsd` option |
| Session management | Manual session_id tracking | Built-in resume/fork | Built-in resume |
| Hooks | HTTP hooks (file-based) | In-process callbacks | In-process callbacks |
| AbortController | Kill process | `close()` / AbortController | `session.close()` |
| Stability | Stable CLI interface | V1 stable (v2.1.x) | V2 unstable preview |
| Dependency | None (just the CLI) | `@anthropic-ai/claude-agent-sdk` (~60 MB) | Same package |

---

## 6. MCP `fleet_status` pm_message Approach (Current)

### How it works today

1. PM writes a message via the dashboard
2. Message is stored in the team's database record (or `.fleet-pm-message` file)
3. Agent calls `fleet_status` MCP tool during its workflow
4. MCP server returns `pm_message` field in the response
5. Agent reads the message and acts on it

### Does the agent actually see and act on the pm_message?

**Yes, but only when the agent calls the tool.** The MCP `fleet_status` tool returns
a JSON object that includes `pm_message`. Since the agent initiated the tool call,
the response becomes part of its conversation context. The agent's system prompt
(in CLAUDE.md) instructs it to check `fleet_status` periodically and act on PM
messages.

### Limitations of this approach

| Limitation | Impact |
|-----------|--------|
| Agent must proactively call the tool | PM message delivery depends on agent behavior |
| No guaranteed delivery timing | Agent might not call `fleet_status` for minutes or hours |
| Cannot interrupt current work | Agent finishes its current task before checking |
| Polling overhead | Wastes API tokens on periodic status checks |
| One-way only | Agent cannot acknowledge receipt of PM message |

---

## 7. What Works and What Doesn't

### What WORKS

1. **`--input-format stream-json` + `--output-format stream-json`**: Full
   bidirectional NDJSON streaming over stdin/stdout. The CLI supports this natively
   since at least v2.1.x. This is the CLI equivalent of the SDK's streaming input mode.

2. **Multi-turn in print mode**: With `--input-format stream-json`, a single
   Claude Code process can handle multiple user messages over its lifetime.
   Each message triggers a full agentic response.

3. **Mid-session messaging**: You can write a new user message to stdin while
   the agent is still working on a previous message. The message is queued and
   processed after the current turn completes.

4. **`--continue`/`--resume` for stateless follow-ups**: If you prefer spawning
   fresh processes, session resumption works in print mode.

5. **Agent SDK `streamInput()`**: The TypeScript SDK provides a typed API for
   the same stdin streaming protocol.

6. **Agent SDK V2 `send()`/`stream()`**: The new simplified V2 API makes
   multi-turn conversations trivial (though it is still marked as unstable).

7. **MCP pm_message**: Works today but requires agent cooperation.

### What DOES NOT WORK

1. **Plain stdin in default print mode**: With `--input-format text` (the default),
   stdin is read once to EOF and concatenated with the prompt. You cannot send
   follow-up messages. After the initial response, the process exits.

2. **Stdin with `stdio: 'ignore'`**: The current Fleet Commander spawn uses
   `stdio: ['ignore', 'pipe', 'pipe']`. Stdin is not connected at all. Must
   change to `['pipe', 'pipe', 'pipe']`.

3. **Interactive mode for programmatic use**: Without `-p`, Claude Code enters
   interactive/TUI mode which outputs ANSI-encoded terminal content, not
   structured JSON. Not suitable for programmatic consumption.

---

## 8. Recommended Approach for PM-to-Agent Messaging

### Phase 1: CLI Stdin Pipe (Immediate, 1-2 days)

Minimal change to existing architecture:

1. Change spawn `stdio` from `['ignore', 'pipe', 'pipe']` to `['pipe', 'pipe', 'pipe']`
2. Add `--input-format stream-json` to args
3. Send initial prompt as a JSON message on stdin instead of a positional arg
4. Store `child.stdin` reference in the team record
5. Add API endpoint `POST /api/teams/:id/message` that writes to stdin
6. Parse NDJSON from stdout (already partially implemented)

**This gives us:**
- PM can send messages to running agents in real-time
- Messages are delivered immediately (no polling)
- Agent sees the message as a new user turn in its conversation
- No new dependencies
- Works with existing subprocess architecture

### Phase 2: Agent SDK Migration (Later, 3-5 days)

Replace spawn with SDK for additional benefits:

- Typed message objects (no manual JSON serialization)
- `interrupt()` for canceling current work
- In-process hooks (replace HTTP hook system)
- `rewindFiles()` for rolling back changes
- `setPermissionMode()` / `setModel()` for runtime reconfiguration
- `close()` for clean shutdown with proper cleanup
- `listSessions()` / `getSessionMessages()` for session history

### Keep MCP as Fallback

The MCP `fleet_status` approach should remain as a secondary channel:
- Provides agent-initiated status checking (agent pulls, not just PM pushes)
- Works even if stdin pipe breaks
- Gives agents visibility into fleet-wide state, not just their own messages
- PM messages via MCP are "check when you want"; stdin messages are "here now"

---

## 9. Complete Working Example

### Fleet Commander spawn with bidirectional streaming

```typescript
import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { Writable } from 'stream';

interface TeamProcess {
  child: ChildProcess;
  stdin: Writable;
  sessionId: string | null;
  costUsd: number;
}

function spawnTeam(
  claudePath: string,
  worktreeName: string,
  worktreeAbsPath: string,
  repoPath: string,
  initialPrompt: string,
  mcpConfigPath: string,
  maxBudget: number = 5,
): TeamProcess {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--replay-user-messages',
    '--dangerously-skip-permissions',
    '--worktree', worktreeName,
    '--max-budget-usd', String(maxBudget),
    '--mcp-config', mcpConfigPath,
  ];

  const child = spawn(claudePath, args, {
    cwd: repoPath,
    env: {
      ...process.env,
      FLEET_TEAM_ID: worktreeName,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });

  const team: TeamProcess = {
    child,
    stdin: child.stdin!,
    sessionId: null,
    costUsd: 0,
  };

  // Parse NDJSON output
  const rl = createInterface({ input: child.stdout! });
  rl.on('line', (line: string) => {
    try {
      const event = JSON.parse(line);

      if (event.type === 'system' && event.subtype === 'init') {
        team.sessionId = event.session_id;
        console.log(`[${worktreeName}] Session: ${event.session_id}`);
      }

      if (event.type === 'result') {
        team.costUsd = event.total_cost_usd ?? team.costUsd;
        console.log(`[${worktreeName}] Turn complete. Cost: $${team.costUsd}`);
      }

      // Forward to SSE broker for dashboard
      broadcastEvent(worktreeName, event);
    } catch {
      // ignore non-JSON lines
    }
  });

  // Capture stderr for debugging
  child.stderr?.on('data', (data: Buffer) => {
    console.error(`[${worktreeName}] stderr: ${data.toString()}`);
  });

  // Handle process exit
  child.on('exit', (code) => {
    console.log(`[${worktreeName}] Process exited with code ${code}`);
  });

  // Send initial prompt
  sendUserMessage(team.stdin, initialPrompt);

  return team;
}

function sendUserMessage(stdin: Writable, content: string): void {
  const msg = {
    type: 'user',
    session_id: '',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  };
  stdin.write(JSON.stringify(msg) + '\n');
}

// PM intervention endpoint
function handlePmMessage(team: TeamProcess, message: string): boolean {
  if (team.stdin.destroyed) {
    return false;
  }
  sendUserMessage(team.stdin, `[PM Message] ${message}`);
  return true;
}

// Graceful shutdown
function stopTeam(team: TeamProcess): void {
  if (!team.stdin.destroyed) {
    team.stdin.end(); // Close stdin -> process finishes current work and exits
  }
}
```

### Express API endpoint

```typescript
app.post('/api/teams/:teamId/message', (req, res) => {
  const { teamId } = req.params;
  const { message } = req.body;

  const team = teamManager.getTeam(teamId);
  if (!team?.process) {
    return res.status(404).json({ error: 'Team not running' });
  }

  const sent = handlePmMessage(team.process, message);
  if (!sent) {
    return res.status(410).json({ error: 'Team process stdin closed' });
  }

  res.json({ ok: true, message: 'Message sent to agent' });
});
```

---

## 10. Edge Cases and Caveats

### Message queuing behavior

When you send a message via stdin while the agent is in the middle of a tool-use
loop, the message is **queued** by Claude Code's internal message handling. The
agent will see it after the current agentic turn completes (i.e., after it finishes
its current chain of tool calls and produces a response). You cannot interrupt a
tool call in progress via stdin alone -- you need the SDK's `interrupt()` for that.

### Stdin buffer pressure

If the agent is busy and you send many messages rapidly, they queue in the Node.js
stdin pipe buffer. This is fine for occasional PM messages but not for high-frequency
streaming. There is no backpressure signal from Claude Code to the sender.

### Process lifecycle

- **stdin EOF = session end**: When the parent closes stdin (`.end()`), Claude Code
  finishes its current work and exits cleanly. This is the graceful shutdown mechanism.
- **Process crash**: If the Claude Code process crashes, `child.on('exit', ...)` fires.
  The stdin Writable becomes destroyed. Subsequent writes throw.
- **Budget exhaustion**: When `--max-budget-usd` is hit, the process emits a
  `result` event with `subtype: 'error_max_budget_usd'` and exits.

### `--worktree` with `--input-format stream-json`

Both flags work together. The worktree is created on process startup, and all
subsequent user messages in the stream operate within that worktree context.

### Session persistence

With `--input-format stream-json`, the session is persisted to disk by default.
You can resume it later with `--resume <session-id>`. Use `--no-session-persistence`
to disable this if you don't need resume capability.

---

## Appendix: Flag Combinations for Fleet Commander

### Recommended full args

```
claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --replay-user-messages \
  --dangerously-skip-permissions \
  --worktree kea-{N} \
  --max-budget-usd 5 \
  --mcp-config ./mcp-config.json \
  --name "Team kea-{N}: Issue #{N}"
```

### For resume (new process, continuing session)

```
claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --replay-user-messages \
  --dangerously-skip-permissions \
  --resume <session-id> \
  --max-budget-usd 5 \
  --mcp-config ./mcp-config.json
```
