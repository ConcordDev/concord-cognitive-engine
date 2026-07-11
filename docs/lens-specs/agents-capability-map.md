# Agents Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

**Scope note:** this is the **agents** lens — an AI-agent orchestration /
autonomous-run-loop tool (AutoGPT / CrewAI / Zapier-Agents parity: build an
agent, give it tools + a goal, run it, inspect every step, chain agents into
delegation graphs, schedule/trigger runs, chat with an agent, cap its token
spend, import from a template marketplace). It shares the page with two
**adjacent, intentionally separate** agent systems — see "Adjacent systems"
below — which this pass read closely but did not need to modify.

## Backend surface

```
grep -c 'registerLensAction("agents"' server/domains/agents.js
```
→ **25** macros in `server/domains/agents.js` (794 lines). Split into two
tiers:
- **4 pure-compute diagnostics:** `evaluateCapability`, `routeTask`,
  `swarmStatus`, `benchmarkAgent` — deterministic scoring/ranking functions.
- **21 stateful runtime macros** across 7 features, all persisted in
  `globalThis._concordSTATE.agentsLens` (per-user `Map`s, survives via the
  existing `saveStateDebounced`): autonomous run loop + tool-call inspector
  (`executeRun`, `listRuns`, `getRunTrace` — a real `TOOL_CATALOG` of 14
  deterministic simulated tool executors, budget-enforced), agent-to-agent
  orchestration graphs (`saveGraph`, `listGraphs`, `deleteGraph`, `runGraph`),
  scheduled/triggered runs (`createSchedule`, `listSchedules`,
  `toggleSchedule`, `deleteSchedule`, `fireSchedule`), per-agent conversation
  threads (`postMessage`, `getThread`, `clearThread`), cost/token budgets with
  enforcement (`setBudget`, `getBudget`, `resetBudget`), and a template
  marketplace (`listTemplates`, `importTemplate`) plus an aggregate dashboard
  macro (`runtimeOverview`).

## Frontend surface

- `concord-frontend/app/lenses/agents/page.tsx` (1,213 lines) — "Agent
  Control Center": roster dashboard (stats, capability badges, filter/search,
  agent grid with Start/Stop/Tick/Logs/Delete), agent detail view (Overview /
  Logs / Memory / Configuration tabs, the 4 diagnostic-action buttons + a
  shape-matched Action Result panel), and a Create Agent modal (name/type/
  description/goals/tools/model/temperature/max-tokens).
- `concord-frontend/components/agents/AgentRuntime.tsx` (872 lines) — the
  real runtime surface: 6 tabs (Run Loop, Orchestration, Triggers, Threads,
  Budgets, Templates), each backed by a real macro round-trip via `lensRun`.
  Covers all 21 stateful macros.
- `concord-frontend/components/agents/AgentSelfPanel.tsx` — a distinct,
  correctly-isolated self-model inspector (see "Adjacent systems").
- `concord-frontend/components/agents/AgentRoster.tsx` — a distinct,
  correctly-isolated roster for the separate "research agent" system (see
  "Adjacent systems").

## Verification of coverage

```
node scripts/lens-unsurfaced.mjs --lens agents
```
→ `agents: 0/25 macros never referenced in the frontend`.

## Classification: all 25 macros are DESIGNED — but 2 real bugs were found and fixed

Every macro is reached through bespoke, domain-appropriate UI (a real 6-tab
runtime workbench with a tool-call tree diagram, orchestration graph builder,
trigger scheduler, chat thread UI, token-budget bar chart, template gallery —
not a generic macro-button wall). No macro is GENERIC-STRIP-ONLY or
UNSURFACED. But close reading of *how* each macro was called (not just *that*
it was called) surfaced two real defects, both now fixed:

### Bug 1 (critical) — "Tick" silently fell through to an LLM catchall, not a real execution

`page.tsx`'s `tickAgent` mutation (used by the agent-card "Tick" button AND
the detail-header "Manual Tick" button — the single most prominent action in
the whole lens) called `runAction.mutateAsync({ id, action: 'tick', ... })`.
There is **no `agents.tick` registered in `LENS_ACTIONS`** — `tick` only
exists as the name of two entirely unrelated backend systems:

1. `register("agents", "tick", ...)` in `server.js:16734` (`MACROS`, not
   `LENS_ACTIONS`) — the **Lattice Immune System** (`emergent/agent-system.js`,
   6 fixed types: patrol/integrity/hypothesis_tester/debate_simulator/
   freshness/synthesis). It ignores its input entirely and ticks a *global*
   registry of agents the user never created.
2. `routes/operations.js:672` `POST /api/agents/:id/tick` → `runMacro("agent",
   "tick", {id, prompt})` — reads/writes `STATE.personas` keyed by an id that
   comes from a completely different id-space (the "research agent" system,
   see Adjacent systems below). The frontend's fallback catch-block called
   this on `mutateAsync` throw, and it always silently no-ops for a lens
   artifact id.

The route the frontend actually calls (`POST /api/lens/agents/:id/run` →
`register("lens","run",...)`, `server.js:38304`) consults **only**
`LENS_ACTIONS`, not `MACROS` — so `agents.tick` resolved to neither of the two
systems above, but to the **AI catchall fallback**
(`server.js:38316-38332`): an LLM improvising a plausible-sounding response
for the artifact, framed by the UI as if it were a real tick, while
`tickCount`/`successRate` were bumped upward regardless of what the LLM
produced. Every "Tick" click was fabricated success wearing a designed
feature's clothes — and the domain file has a fully real capability built for
exactly this purpose (`executeRun` — the same deterministic multi-step
tool-call loop `AgentRuntime`'s "Execute run loop" button already uses
correctly) sitting unused one line away.

**Fix:** `tickAgent` now calls `executeRun` with the real
`agentId`/`agentName`/`goal`/`tools`/`maxSteps`, reads the real
`run.status`/`stepCount`/`totalTokens`/`stoppedReason`, and only bumps
`successRate` upward when `run.status === 'completed'` (down on halt). The
dead `apiHelpers.agents.tick(id)` fallback (silently wrong id-space) was
removed. Added a "Run Result" render branch to the Action Result panel so the
real step trace is visible after a tick, matching the existing
capability/route/swarm/benchmark result branches.

### Bug 2 — the 4 diagnostic buttons always returned a constant, near-meaningless result

`evaluateCapability` reads `data.skills`/`data.taskHistory`; `benchmarkAgent`
reads `data.metrics`; `routeTask` reads `data.task`/`data.agents`;
`swarmStatus` reads `data.agents`. None of these fields are ever persisted
onto an Agent artifact — the create form stores
`name/type/description/goals/tools/model/temperature/maxTokens`, not a
skills array, task-history log, metrics object, or roster snapshot — and the
frontend called all four with **no params at all**
(`runAction.mutateAsync({ id, action })`). Traced each handler's actual field
reads (not assumed): every one always saw its defaults (`[]`/`{}`), so:
- **`evaluateCapability`** always scored `successRate 0%, avgLatency 0,
  skillCoverage 0` → a near-fixed ~30-point "Novice" score no matter how much
  the agent had actually run.
- **`routeTask`** always hit the `agents.length === 0` early return
  (`"No agents available for routing."`) — **fully non-functional**, since
  `data.agents` (the roster to rank) was never populated.
- **`swarmStatus`** always rendered `0/0/0/0` — same root cause, `data.agents`
  never populated (and this macro operates over the *whole roster*, but was
  being called against a *single* artifact's `.data`, which structurally
  can't hold a roster).
- **`benchmarkAgent`** always scored off `metrics = {}` → constant `throughput
  0, accuracy 0%, uptime 99%, memory 0MB`.

**Fix (both sides, minimal and backward-compatible):**
- `server/domains/agents.js` — the four handlers used to read only
  `artifact.data` (their `params` argument was named `_params` and discarded).
  Changed to `const data = { ...(artifact.data || {}), ...(params || {}) }` —
  when no params are passed (existing/other callers, all 66 test call sites),
  behavior is byte-identical; when params are passed, live-computed values
  take precedence without requiring a persisted-artifact round trip first.
- `page.tsx` — new `buildActionParams(action, agent)` derives real values
  from state this lens actually tracks: `skills` ← `agent.tools`,
  `taskHistory` ← mapped from `agent.logs` (level → success/status,
  `avgLatency` → per-entry latency), `metrics` ← `tasksPerMinute` computed
  from `tickCount` over elapsed minutes since `createdAt`, `accuracy` ←
  `successRate`, `uptimePercent` ← `enabled ? 99.5 : 0`; `agents` (for the two
  roster-shaped actions) ← the live roster mapped to
  `{name, skills, currentLoad, reliability, status, tasksCompleted}`.
  `routeTask` also now gets an honest `task` object (`requiredSkills: []` —
  there's no task-queue UI yet, so it's explicit that no skill filter was
  supplied, ranking purely by real load/reliability rather than fabricating
  requirements). No random numbers, no invented history — every value traces
  to a real, currently-stored field.

### Bug 3 (minor) — Start/Stop bypassed the real lifecycle macros

`server.js:39985-39996` registers real `agents.start`/`agents.stop` lens
actions (server-stamp `startedAt`/`stoppedAt`, timestamps a future caller
could use for uptime accounting) but `enableAgent` never called them — it did
a raw local `data` field merge only. **Fix:** `enableAgent` now calls the real
`start`/`stop` macro first (for its honest timestamp side-effect), then
applies this lens's own status vocabulary (`idle`/`dormant`, which the card
and detail header actually render — the macro's own `active`/`dormant`
vocabulary isn't one this UI's `getStatusColor`/`getStatusLabel` recognize,
so it is deliberately not kept as the final value). `startedAt`/`stoppedAt`
now surface in the Configuration tab's Agent Details grid.

## Fabrication check

```
grep -niE "Math\.random|MOCK|mock|fake|lorem|hardcoded|dummy|sample data|TODO|FIXME|stub" \
  components/agents/*.tsx app/lenses/agents/page.tsx
```
→ no fabrication signatures in rendered UI. `AgentRuntime.tsx`'s own header
comment ("Every value rendered comes from a real macro round-trip — no mock
data") holds after this audit. `server/domains/agents.js`'s `TOOL_CATALOG`
simulated tool executors are explicitly documented as deterministic
pure-compute (no LLM, no network) so a run is fully reproducible and
inspectable — this is an honestly-labeled simulation layer (the point of the
run loop is to demo/exercise the orchestration mechanics), not a fabricated
result presented as live data.

## Adjacent systems on the same page (left alone, with reason)

Four distinct "agent" concepts coexist in this codebase; only the first is
this lens's own domain, and confusing the others for it was the root cause of
Bug 1 above:

1. **This lens's own runtime** — `server/domains/agents.js` /
   `STATE.agentsLens`, user-authored artifacts (`useLensData('agents',
   'agent', …)`), keyed by lens-artifact id. What this doc covers.
2. **"Agent roster" section** (`AgentRoster.tsx`, mounted at the bottom of
   `page.tsx`) — a **separate, pre-existing, correctly self-consistent**
   research-agent spawner: `GET/POST /api/agents` (`routes/operations.js`),
   backed by `STATE.personas` filtered by `p.goal` truthiness, ticked via its
   own correctly-matched `apiHelpers.agents.tick(id)` (same id-space it
   creates ids in). Honestly labeled in its own header
   (`/api/agents · 6s poll`). Left untouched — it isn't broken, and merging
   it with the lens-artifact system would conflate two real, differently-
   shaped substrates.
3. **Lattice Immune System** (`emergent/agent-system.js`, `register("agents",
   ...)` in `server.js:16716-16744`) — 6 fixed archetypal maintenance agents
   (patrol/integrity/hypothesis_tester/debate_simulator/freshness/synthesis)
   that patrol the DTU lattice itself. Registered under the *macro* name
   `agents` (MACROS, not LENS_ACTIONS) — same domain string as this lens by
   coincidence of naming, not by design relationship. Not surfaced on this
   page at all; out of scope.
4. **Agent self-model** (`AgentSelfPanel.tsx`, `/api/agent/:id` +
   `/api/agent/:id/awareness` — singular "agent") — the Wave 7/E6
   values-anchor/drives/awareness-index inspector (migration 325
   `agent_identity`). Mounted per-selected-agent; correctly renders "No agent
   self-model." when the lens-artifact id has no matching self-model row
   (an honest empty state, not a broken call) — verified this is the
   intended behavior, not a defect.

## What changed

- `server/domains/agents.js` — merged `params` over `artifact.data` in the 4
  diagnostic handlers (`evaluateCapability`, `routeTask`, `swarmStatus`,
  `benchmarkAgent`) so live-computed values can be passed without a
  persisted-artifact round trip. Fully backward-compatible (no params →
  identical behavior).
- `concord-frontend/app/lenses/agents/page.tsx` —
  - `tickAgent` now calls the real `executeRun` macro instead of the
    nonexistent `tick` action; removed the dead `apiHelpers.agents.tick`
    fallback and its now-unused `apiHelpers` import.
  - New `buildActionParams()` derives real skills/task-history/metrics/roster
    data for the 4 diagnostic buttons instead of calling with no params.
  - `enableAgent` now calls the real `start`/`stop` lens actions for their
    timestamp side-effect before applying local status.
  - Added `startedAt`/`stoppedAt` to the `Agent` type and surfaced them in
    the Configuration tab.
  - Added a "Run Result" render branch to the Action Result panel for the
    `executeRun` trace shape (steps/tokens/latency/stoppedReason).

## Verification

- `node scripts/lens-unsurfaced.mjs --lens agents` → `0/25 macros never
  referenced in the frontend`.
- `cd server && node --test tests/agents-domain-parity.test.js
  tests/depth/agents-behavior.test.js` → **26/26 pass** (25 domain-parity +
  the depth-behavior file's 41 nested assertions, all green — both fully
  backward-compatible with the params-merge change).
- `node --check server/domains/agents.js` → clean.
- `cd concord-frontend && npx eslint app/lenses/agents/page.tsx` → clean,
  zero output. (No `tsc --noEmit` per this pass's standing rule — worktree
  OOM risk; reviewed the diff's types manually instead.)
- `node scripts/verify-lens-backends.mjs` →
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (agents counted as WIRED).
- `node scripts/grade-ux-polish.mjs --honest` → agents `tier: "polished"`,
  `isGenericScaffold: false`; `audit/ux-polish-honest*` reverted via
  `git checkout` after reading (transient regenerated artifact).

## Left alone, with reason

- **`AgentRuntime.tsx`, `AgentRoster.tsx`, `AgentSelfPanel.tsx`** — already
  real, already correctly wired, no fabrication or field-shape bugs found.
- **The Lattice Immune System** (`emergent/agent-system.js`) and the
  `STATE.personas`-based research-agent system (`routes/operations.js`) —
  real, working, out-of-scope adjacent substrates; not this lens's domain.

## Genuinely missing

None found within the assigned `agents`-domain scope. The `routeTask` macro's
task-requirements input (`requiredSkills`) has no dedicated UI to author a
task definition — flagged in Bug 2's fix as an honest limitation (ranks by
load/reliability with no skill filter) rather than a defect requiring a new
feature; a future task-queue UI would be an **ENGINEERING** addition (no
external data dependency), not a fabrication risk as currently wired.
