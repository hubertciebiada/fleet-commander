# Claude Fleet Commander -- State Machines

## 1. Team Lifecycle

```
                    +-----------+
                    |  queued   |  (issue assigned, waiting for worktree)
                    +-----+-----+
                          |
                    create worktree + spawn core team
                          |
                    +-----v-----+
                    | launching |  (worktree created, agents spawning)
                    +-----+-----+
                          |
                    first event received from coordinator
                          |
                    +-----v-----+
               +--->|  running  |<---+
               |    +-----+-----+    |
               |          |          |
               |    no events for    |
               |    IDLE_THRESHOLD   |
               |    (5 min)          |
               |          |          |
               |    +-----v-----+   |
               |    |   idle    |---+  (new event arrives)
               |    +-----+-----+
               |          |
               |    no events for
               |    STUCK_THRESHOLD
               |    (15 min) OR
               |    3+ unique CI failures
               |          |
               |    +-----v-----+
               +----|   stuck   |  (needs human attention)
                    +-----+-----+
                          |
                    human intervention OR
                    auto-recovery
                          |
               +----------+----------+
               |                     |
         +-----v-----+        +-----v-----+
         |   done     |        |  failed   |
         +-----------+        +-----------+
```

### Transition Rules

| From        | To         | Trigger                                              |
|-------------|------------|------------------------------------------------------|
| queued      | launching  | Worktree created, `claude --worktree kea-{N}` started |
| launching   | running    | First event received (SessionStart or SubagentStart)  |
| running     | idle       | No events for `IDLE_THRESHOLD` (5 minutes)            |
| idle        | running    | Any new event received                                |
| idle        | stuck      | No events for `STUCK_THRESHOLD` (15 minutes)          |
| running     | stuck      | 3+ unique CI failure types on associated PR           |
| stuck       | running    | New event after human intervention                    |
| running     | done       | Phase reaches "done" (issue closed, PR merged)        |
| running     | failed     | Unrecoverable error, phase reaches "blocked"          |
| stuck       | failed     | Human marks as failed                                 |
| stuck       | done       | Human resolves, PR merges                             |

### Constants

```typescript
const IDLE_THRESHOLD_MIN = 5;
const STUCK_THRESHOLD_MIN = 15;
const MAX_UNIQUE_CI_FAILURES = 3;
```

---

## 2. Team Phase (workflow stage within "running")

This is the domain workflow from `refactor-workflow.md`, tracked separately from the operational lifecycle above.

```
  +------------+
  | analyzing  |  (analityk reads issue + codebase, produces brief)
  +-----+------+
        |
  brief delivered (BLOCKED=no)
        |
  +-----v---------+
  | implementing  |<-----+  (dev(s) code the solution)
  +-----+---------+      |
        |                |
  dev says "gotowe"      |  REJECT (max 2x)
        |                |
  +-----v------+         |
  | reviewing  |---------+  (weryfikator reviews code)
  +-----+------+
        |
  APPROVE + push
        |
  +-----v--+
  |   pr   |  (PR created, CI running, pr-watcher monitoring)
  +-----+--+
        |
  CI GREEN + auto-merge
        |
  +-----v--+
  |  done  |
  +--------+
```

Any phase can transition to `blocked` on unrecoverable error.

| From          | To            | Trigger                                        |
|---------------|---------------|------------------------------------------------|
| analyzing     | implementing  | Brief received, BLOCKED=no                     |
| analyzing     | blocked       | Brief says BLOCKED=yes                         |
| implementing  | reviewing     | Dev reports "gotowe do review"                 |
| implementing  | blocked       | Escalation (unresolvable issue)                |
| reviewing     | implementing  | REJECT verdict (retry, max 2x)                 |
| reviewing     | pr            | APPROVE verdict, dev pushes                    |
| reviewing     | blocked       | 2x REJECT                                      |
| pr            | done          | CI GREEN, auto-merge succeeds                  |
| pr            | implementing  | CI RED, dev fixes (tracked by ci_fail_count)   |
| pr            | blocked       | 3 unique CI failure types                      |

---

## 3. PR Lifecycle

```
  +------+
  | none |  (no PR exists yet)
  +--+---+
     |
  gh pr create
     |
  +--v---+     can skip draft
  | draft|--+
  +------+  |
            |
  +---------v-+
  |   open    |
  +-----+-----+
        |
  CI workflow triggered
        |
  +-----v--------+
  |  ci_pending  |
  +-----+--------+
        |
  +-----+---+----------+
  |         |          |
  | success | failure  |
  |         |          |
+-v-------+ | +--------v----+
|ci_passing| | | ci_failing  |
+----+-----+ | +------+------+
     |       |        |
     |       |   dev fixes + push
     |       |   (new CI run)
     |       |        |
     |       +--------+
     |
  auto-merge completes
     |
  +--v----+
  | merged|
  +-------+
```

Separately, a PR can transition to `closed` from any state (manually closed without merge).

| From        | To          | Trigger                                      |
|-------------|-------------|----------------------------------------------|
| none        | draft       | `gh pr create --draft`                        |
| none        | open        | `gh pr create`                                |
| draft       | open        | Mark ready for review                         |
| open        | ci_pending  | CI workflow run starts                        |
| ci_pending  | ci_passing  | All checks pass (conclusion=success)          |
| ci_pending  | ci_failing  | Any check fails (conclusion=failure)          |
| ci_passing  | merged      | Auto-merge completes (or manual merge)        |
| ci_failing  | ci_pending  | Dev pushes fix, new CI run starts             |
| *           | closed      | PR closed without merge                       |

### CI Failure Tracking

Each unique failure type (identified by failing check name + error category) increments `ci_fail_count`. Progress on the same bug (e.g., error count decreasing) does NOT count as a new failure type.

---

## 4. Issue Lifecycle (board status)

```
  +---------+
  | Backlog |  (issue exists, not prioritized)
  +----+----+
       |
  prioritized
       |
  +----v---+
  | Ready  |  (ready to be picked up by a team)
  +----+---+
       |
  team launched (queued -> launching)
       |
  +----v-------+
  | InProgress |
  +----+-------+
       |
  +----+----+---------+
  |         |         |
  | PR open | CI RED  |
  |         | (>3x)   |
  |         |         |
  |    +----v-----+   |
  |    | Blocked  |   |
  |    +----------+   |
  |                   |
  PR merged           |
  |                   |
  +----v---+          |
  |  Done  |<---------+ (if unblocked and merged)
  +--------+
```

| From        | To          | Trigger                                       |
|-------------|-------------|-----------------------------------------------|
| Backlog     | Ready       | Prioritized (manual or script)                |
| Ready       | InProgress  | Team launched for this issue                  |
| InProgress  | Done        | PR merged, issue closed                       |
| InProgress  | Blocked     | CI keeps failing (3+ unique types) or manual  |
| Blocked     | InProgress  | Human unblocks, team resumes                  |
| Blocked     | Done        | Resolved and merged                           |

---

## 5. Event Processing Pipeline

Events flow from Claude Code hooks into the database and trigger state transitions:

```
Claude Code Hook
  (SessionStart, Stop, SubagentStart, etc.)
       |
       v
  INSERT INTO events
       |
       v
  State Machine Evaluator
       |
  +----+----+----+----+
  |         |         |
  v         v         v
 Team     Session   Agent
 status   status    status
 update   update    update
```

### Stuck Detection (polling, runs every minute)

```sql
-- Find teams that may be stuck
SELECT team_id, minutes_since_last_event
FROM v_stuck_candidates
WHERE status = 'running' AND minutes_since_last_event > 5;
-- -> transition to 'idle'

SELECT team_id, minutes_since_last_event
FROM v_stuck_candidates
WHERE status = 'idle' AND minutes_since_last_event > 15;
-- -> transition to 'stuck'
```

### Event-to-Transition Mapping

| Event Type     | Team Transition        | Agent Transition         |
|----------------|------------------------|--------------------------|
| SessionStart   | launching -> running   | pending -> running       |
| SessionEnd     | (check if all ended)   | running -> done          |
| Stop           | running -> done/failed | running -> done          |
| SubagentStart  | (no change)            | pending -> running       |
| SubagentStop   | (no change)            | running -> done/failed   |
| Notification   | idle -> running        | idle -> running          |
| CostUpdate     | (no change)            | (update session cost)    |

---

## 6. Relationship Summary

```
Issue 1---* Team 1---* Session
  |            |
  |            +---* Agent
  |            |
  +---* PR 1---* CIRun
  |
  +---* Issue (children via parent_number)

Team 1---* Event
Team 1---* Command
```

An issue can have multiple teams over its lifetime (e.g., first attempt fails, second succeeds). A team has exactly one issue. A PR belongs to one issue but is linked to the team that created it.
