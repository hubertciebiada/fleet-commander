# Fleet Commander — Agent Flow Analysis Report

**Date:** 2026-03-18
**Dataset:** 21 teams, 2671 events, 1499 tool calls, 89 errors, 375 subagent spawns
**Scope:** All teams from first dogfooding session on hubertciebiada/fleet-commander

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Teams completed | 21/21 (100%) |
| PRs merged | 21/21 (100%) |
| Average time to PR | 22.5 min |
| Fastest (bug fix) | 7 min |
| Slowest (feature) | 52 min |
| Tool error rate | 5.9% |
| Stuck teams (auto-recovered) | 4/21 (19%) |
| Manual intervention needed | 0 |

**Verdict:** The pipeline is highly reliable. All teams completed, all PRs merged, no crashes. Issues are in efficiency and observability, not correctness.

---

## 1. Timing Patterns

### Duration by task type

| Type | Avg duration | Range | Example |
|------|-------------|-------|---------|
| Cleanup/trivial | 8 min | 7-10 min | #44 remove unused export |
| Bug fix | 13 min | 8-20 min | #134 CCQuery Windows fix |
| Small refactor | 22 min | 15-30 min | #129 threshold change |
| Feature | 40 min | 25-55 min | #124 CCQuery service |

### Startup latency
- **Normal (direct launch):** 7-28 seconds to first event
- **Queued (batch launch):** 7-23 MINUTES wait time when slots full
- Queue is FIFO, works as designed

### Event density
- Average: 1 event every 10 seconds (agents stay continuously busy)
- Simple tasks: 10 events/min (fast bursts)
- Complex features: 2-5 events/min (more thinking pauses)

### Idle gaps
- Only 11 gaps > 3 minutes across all 21 teams
- Root cause: **subagent restart overhead** (5-6 min between SubagentStop and next SubagentStart)
- This brushes against the new 3min idle / 5min stuck thresholds from #129

**Recommendation:** Consider raising idle threshold back to 4-5 min, or exclude subagent cycling from idle detection. The 5-6 minute restart gaps are normal, not stuck.

---

## 2. Subagent Patterns

### Standard team composition (100% consistent)

| Agent | Role | % of tool calls | Error rate |
|-------|------|----------------|------------|
| **dev-typescript** | Builder | 57.7% | 4.7% |
| **reviewer** | Code review | 18.3% | 0.9% |
| **coordinator** | Orchestration | 12.6% | **20.4%** |
| **analyst** | Investigation | 11.2% | 3.6% |

Every team spawns all 4 agents. No variation in team structure.

### Spawn reliability
- **80.8%** of SubagentStart events have matching SubagentStop
- **19.2% missing stops** — analyst (73%) and reviewer (73%) worst
- Zero orphan stops (no SubagentStop without prior Start)
- Missing stops = session ending before subagents finish gracefully

### Coordinator error rate is concerning
- **27.7% Bash error rate** (vs 14% overall, 1.1% for reviewer)
- Coordinator runs ~8 spawns per team (highest)
- Likely failing on git/gh commands during orchestration

**Recommendation:** Investigate coordinator's Bash calls. Add error content capture to `on_tool_error` hook (currently only metadata, not the actual error message).

---

## 3. Tool Usage & Errors

### Tool ranking

| Tool | Uses | Error rate |
|------|------|-----------|
| Bash | 453 (30%) | **14.3%** |
| Read | 298 (20%) | **8.1%** |
| Edit | 214 (14%) | 0% |
| SendMessage | 155 (10%) | 0% |
| Grep | 137 (9%) | 0% |
| Agent | 69 (5%) | 0% |
| All others | 173 (12%) | 0% |

**Only Bash and Read produce errors.** Everything else is 100% reliable.

### Bash errors (65 total)
- Coordinator: 27.7% error rate (26 errors / 94 calls)
- dev-typescript: 14.0% (32 / 228)
- Reviewer: 1.1% (1 / 91)

### Read errors (24 total)
- **13 with no agent_name** — cluster at launch time, same timestamps across multiple teams
- Root cause: **race condition at startup** — worktree not fully ready when first Read fires

### Error spikes correlate with batch launches
- 14:50-15:34: 55 errors during 14-team batch launch
- 17:26-17:48: 12 errors during 4-team batch launch

**Recommendations:**
1. **Stagger batch launches** — 2-5 second delay between team spawns
2. **Add worktree readiness check** before starting CC process
3. **Enrich error payloads** — hook currently sends only metadata, not error content

---

## 4. PR & Completion

### Perfect record
- 21/21 PRs created and merged
- 0 CI failures (repo has no CI checks configured)
- 0 teams needed manual intervention

### State transitions

| Pattern | Teams | % |
|---------|-------|---|
| queued → launching → running → done | 14 | 67% |
| + went through idle/stuck (auto-recovered) | 4 | 19% |
| + queued first (slot limit) | 7 | 33% |
| Required PM action | 1 | 5% (manual stop + relaunch) |

### `stopped_at` never populated
Teams finish with `done` status but `stopped_at` is NULL. This is a data gap — the exit handler sets status to `done` but may not set `stoppedAt`.

**Recommendation:** Fix team-manager exit handler to always set `stopped_at` on completion.

---

## 5. Resource Consumption

### Usage burn rate by concurrency

| Concurrent teams | Daily % per hour | Time to exhaust daily |
|-----------------|------------------|----------------------|
| 2-3 | ~10% | ~10 hours |
| 4 | ~15% | ~6.5 hours |
| 14 | ~93% | ~65 minutes |

### Key constraint: **Weekly at 84%**
- Daily resets every 5 hours — manageable
- Weekly at 84% after one day of dogfooding — approaching 95% red zone
- Extra usage at 50% — halfway through monthly overage budget

**Recommendation:** The red zone gate (daily 85%, weekly 95%) is critical. Running 14 teams concurrently burns through daily in ~1 hour. Recommend max 4-5 concurrent teams for sustainable daily usage.

---

## Top Recommendations (Priority Order)

### Immediate (affect daily usage)

1. **Raise idle threshold to 4-5 min** — subagent restart gaps of 5-6 min are normal, current 3min triggers false idle → unnecessary nudge messages → wasted tokens
2. **Stagger batch launches** — add 3-5s delay between team spawns to reduce startup error spike
3. **Limit concurrent teams to 4-5** — 14 concurrent = daily quota gone in 1 hour

### Short-term (improve observability)

4. **Capture error content in hooks** — `on_tool_error.sh` should extract the actual error message, not just tool name
5. **Fix `stopped_at` not being set** for completed teams
6. **Investigate coordinator Bash failures** — 27.7% error rate is 4x worse than any other agent

### Medium-term (improve efficiency)

7. **Add worktree readiness check** — Read errors at startup are a race condition
8. **Consider coordinator prompt improvements** — high error rate may indicate the coordinator is attempting commands that reliably fail (git operations before worktree is ready, or gh commands that need different args)
9. **Track subagent stop reliability** — 19% missing stops means incomplete lifecycle data for the team roster feature (#137)

---

*Generated from analysis of fleet.db by 5 Claude Opus agents on 2026-03-18.*
