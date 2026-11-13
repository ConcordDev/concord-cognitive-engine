# Tickets CKPT-08 to CKPT-15: the engine

Read `../PLAN.md` "Implementer instructions" and `../ARCHITECTURE.md` sections 2 to 13 first. Types named here (`Run`, `Step`, `Expect`, `StepResult`, `Receipt`) are the typedefs in `ARCHITECTURE.md` section 3.

Shared test helper, created in CKPT-08 and used by every later ticket: `server/tests/cockpit/_helpers.js`.

---

## CKPT-08: Migration 501 and the run store

**Goal.** Persist runs, steps and write effects.
**Why.** Today a chat or agent turn keeps all state in memory; a restart loses it (audit section 2, column "Persisted").
**Probe failure it addresses.** No table holds a plan step with `expects`, `depends_on`, attempts and a receipt.
**Depends on.** CKPT-01. **Flag.** none (schema and library only).
**Reuse.** `agent_marathon_tool_log` through `recordToolDispatch`; `agent_action_log`. **Do not** add columns to `agent_marathon_sessions`, and do not write `CHECK` constraints on status columns.

### Files

- Create `server/migrations/501_cockpit_runs.js`. First run `ls server/migrations | sort | tail -3` on your branch. If 501 is taken, use the next free number and use that number everywhere this plan says 501.
- Create `server/lib/cockpit/run-store.js`
- Create `server/tests/cockpit/_helpers.js`, `server/tests/cockpit/run-store.test.js`

### Migration

Open `server/migrations/500_photography_roll_frame_media.js` and copy its export shape exactly (the same `up` signature and the same way it calls `db.exec`). The SQL is the three `CREATE TABLE` statements and three indexes in `ARCHITECTURE.md` section 4, unchanged. Migrations are append-only: never edit this file after it merges.

### Interfaces

```js
// run-store.js
export const RUN_STATUSES = Object.freeze(["planned","running","awaiting_confirm","verifying","paused","done","failed","cancelled"]);
export const STEP_STATUSES = Object.freeze(["pending","ready","running","awaiting_confirm","verifying","done","failed","skipped"]);
export const DEFAULT_BUDGET = Object.freeze({ maxSteps: 60, maxToolCalls: 120, maxModelCalls: 150, maxTokensIn: 400000, wallMs: 3600000, stepWallMs: 120000 });
export const RESULT_JSON_MAX = 16384;

export function tablesReady(db) {}                       // boolean; SELECT 1 FROM cockpit_runs LIMIT 1 in try/catch
export function newRunId() {}                            // "run_" + crypto.randomBytes(8).toString("hex")
export function newStepId() {}                           // "stp_" + crypto.randomBytes(8).toString("hex")

/** @returns {{ ok: true, run: Run } | { ok: false, reason: string }} */
export function createRun(db, { userId, surface, goal, chatSessionId = null, lensContext = null, modelProfile, budget = {} }) {}
/** Insert steps for a plan version. Steps get seq 1..n in array order. Returns the stored steps. */
export function insertSteps(db, runId, planVersion, steps) {}
export function getRun(db, runId) {}                     // Run | null
export function getRunForUser(db, runId, userId) {}      // Run | null; null when the run belongs to someone else
export function listSteps(db, runId, planVersion = null) {} // Step[] ordered by seq; null means the run's current version
export function getStep(db, stepId) {}
export function listRunsForUser(db, userId, { limit = 20, status = null } = {}) {}
export function findWaitingRun(db, userId, chatSessionId) {} // newest run with status awaiting_confirm in that thread, or null
export function countActiveRuns(db, userId) {}           // status in planned, running, awaiting_confirm, verifying, paused

/** Change run fields. Refuses an unknown status. Always sets updated_at. */
export function updateRun(db, runId, patch) {}
/** Change step fields. Refuses an unknown status. */
export function updateStep(db, stepId, patch) {}
export function addUsage(db, runId, delta) {}            // adds numeric fields into usage_json in one transaction

/** Lease. Returns true when this owner now holds the run. */
export function acquireLease(db, runId, owner, ttlSec = 90, nowSec = Math.floor(Date.now()/1000)) {}
export function releaseLease(db, runId, owner) {}
export function findDueRuns(db, nowSec, limit = 5) {}
```

Rules:
- `createRun`: `goal` is cut to 2,000 characters; `budget` is `{ ...DEFAULT_BUDGET, ...budget }` with `maxSteps` capped at 200; `usage` starts as `{ toolCalls:0, modelCalls:0, tokensIn:0, tokensOut:0, humanInterventions:0 }`; missing `userId` or `goal` returns `{ ok:false, reason:"invalid_input" }`; a missing table returns `{ ok:false, reason:"no_table" }`.
- Row to object mapping: snake_case columns to the camelCase fields of the typedefs; every `*_json` column is parsed with a `safeParse(text, fallback)` that never throws.
- `updateStep` with `result`: store `JSON.stringify(result)` in `result_json` when it is at most `RESULT_JSON_MAX` bytes and set `result_ref = "inline"`; when larger, store `JSON.stringify({ truncated: true, summary: <resultSummary.text> })` and set `result_ref = "inline-truncated"`. (Storing oversized results as DTUs is a later improvement; it is not in this plan.)
- `acquireLease`: one statement,
  `UPDATE cockpit_runs SET lease_owner = ?, lease_until = ? WHERE id = ? AND (lease_owner IS NULL OR lease_owner = ? OR lease_until < ?)`, return `info.changes === 1`.
- `findDueRuns`:
  ```sql
  SELECT id FROM cockpit_runs
  WHERE ((status IN ('running','verifying','planned') AND (lease_until IS NULL OR lease_until < :now))
      OR (status = 'paused' AND resume_at IS NOT NULL AND resume_at <= :now))
  ORDER BY updated_at ASC LIMIT :limit
  ```
- Every function wraps its SQL in `try/catch` and returns `null`, `[]`, `false` or `{ ok:false, reason }` on a throw. Prepare statements inside the function; do not cache prepared statements at module scope (tests use many databases).

### `_helpers.js`

```js
import Database from "better-sqlite3";
import { up as up501 } from "../../migrations/501_cockpit_runs.js";   // match the real export name
export function memDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT, scopes TEXT)`);
  db.exec(`CREATE TABLE agent_action_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT, action TEXT NOT NULL, input_json TEXT, output_summary TEXT, tool TEXT, outcome TEXT, embedding BLOB, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
  db.exec(`CREATE TABLE agent_marathon_tool_log (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, tick_seq INTEGER, call_seq INTEGER NOT NULL, tool_name TEXT NOT NULL, params_json TEXT, status TEXT NOT NULL DEFAULT 'dispatched', result_summary TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), completed_at INTEGER)`);
  up501(db);
  db.prepare(`INSERT INTO users (id, role, scopes) VALUES ('u1','member','["read","write"]')`).run();
  return db;
}
/** A tool executor fake: map of tool id to a function or an array of results consumed in order. */
export function fakeExec(table) {}
```

`fakeExec(table)` returns `async (call) => …` and exposes `.calls` (array of every call). A function entry is called with the call; an array entry is shifted (the last element repeats); a missing entry returns `{ tool: call.tool, ok:false, unknownTool:true, error:`unknown tool: ${call.tool}` }`.

### Tests

`run-store.test.js`: create a run; insert 3 steps and read them back in order with parsed `expects`; `updateRun` with status `"bogus"` returns false and changes nothing; `getRunForUser(db, id, "other")` is null; `acquireLease` by owner A succeeds, by owner B fails, by B after the TTL (pass a later `nowSec`) succeeds; `findDueRuns` returns a paused run only when `resume_at <= now`; a 20,000-byte result is stored as `inline-truncated`; `addUsage` twice sums; `createRun` on a database without the tables returns `{ ok:false, reason:"no_table" }`.

**2B check.** None. **Rollback.** Revert the commit. For a database that already applied 501, the tables are unused and harmless; to remove them, a later migration drops `cockpit_effects`, `cockpit_steps`, `cockpit_runs`.
**Risks.** Migration number collision with Muse's work on the same branch: the `ls` check above. SQLite write contention: all writes are single short statements.
**Done when.** CI green, including the existing migration tests.

---

## CKPT-09: Engine: tick, lease, pump, resume

**Goal.** The state machine that advances a run one step at a time and can be stopped and resumed anywhere.
**Why.** October finding 1 and 7; audit finding 1 (seven loops). This is the one core.
**Probe failure it addresses.** `runAgentLoop` holds the plan in the model's message list and ends when the loop ends.
**Depends on.** CKPT-04, 05, 06, 07, 08. **Flag.** `CONCORD_COCKPIT_RUNS`, default off (the pump does not start without it).
**Reuse.** `executeToolCall`, `runWithRetry`, `nextAction`, `validateAndRepair`, `buildToolMenu`, `buildContextPacket`, `requestStepCall`, `summarizeResult`, `withJob`, `recordToolOutcomeEvent`. **Do not** call `runAgentLoop` from the engine.

### Files

- Create `server/lib/cockpit/executor.js`
- Create `server/lib/cockpit/engine.js`
- Create `server/lib/cockpit/pump.js`
- Modify `server/server.js` (start the pump)
- Create `server/tests/cockpit/executor.test.js`, `server/tests/cockpit/engine.test.js`, `server/tests/cockpit/engine-resume.test.js`

### Interfaces

```js
// executor.js
/**
 * The only way a run executes a tool.
 * @param {{ db: object, run: Run, step: Step, call: {tool:string,args:object},
 *           deps: { exec: (call:{tool:string,params:object}) => Promise<object>, now?: () => number } }} a
 * @returns {Promise<StepResult>}
 */
export async function runTool(a) {}
/** Build the production exec for a user. */
export function makeExec({ db, userId, sessionId, runMacro, lensActions, surface }) {}
/** Turn a cockpit call into an executeToolCall call. */
export function toAgentCall(call) {}
```

`toAgentCall`: an id starting `lens:` becomes `{ tool:"run_lens_action", params:{ domain, action, params: call.args } }`; anything else becomes `{ tool: call.tool, params: call.args }`.

`makeExec` returns `async (agentCall) => executeToolCall(ctx, runMacro, lensActions, agentCall)` where `ctx` is built **once** as:

```js
const role = (() => { try { return db.prepare("SELECT role FROM users WHERE id = ?").get(userId)?.role || "member"; } catch { return "member"; } })();
const ctx = { db, userPrompt: "", surface,
  actor: { userId, id: userId, sessionId: sessionId || null, role, internal: false },
  reqMeta: { sessionId: sessionId || null },
  log: () => {} };
```

`internal` is always `false` for runs: a run never bypasses the council gate, whatever the role. (GB-1498 adds session scopes to this actor in CKPT-14.)

`runTool`: 
1. `const spec = getToolSpec(a.call.tool, …)`; if null return `{ ok:false, errorClass:"unknown_tool", … }`.
2. `const t0 = now()`. Run `a.deps.exec(toAgentCall(a.call))` inside `withJob(`cockpit:${a.call.tool}`, …)` raced against `Math.min(spec.timeoutMs, a.run.budget.stepWallMs)`. On the timer winning, the result is `{ ok:false, reason:"timeout", error:"This step ran out of time." }`.
3. Wrap in `try/catch`; a throw becomes `{ ok:false, reason:"handler_threw", error: String(e.message) }`.
4. Return `{ ok: !!r.ok, tool: a.call.tool, result: r.ok ? (r.result ?? r) : null, errorClass: r.ok ? null : classifyFailure(r).class, error: r.ok ? null : scrubUserFacingToolNames(String(r.error || "failed")), retryHint: r.retryHint || null, artifacts: r.artifacts || (r.artifact ? [r.artifact] : []), latencyMs: now() - t0, provider: null, model: null, raw: r }`.
5. Call `recordToolOutcomeEvent(db, { userId: a.run.userId, sessionId: a.run.chatSessionId, surface: a.run.surface, call: { tool: a.call.tool, params: a.call.args }, result: r })`.

Idempotency and confirmation are added to `runTool` by CKPT-12 and CKPT-13. Leave two marked comments where they go: `// CKPT-12: claim effect here` before step 2 and `// CKPT-13: approval check here` before that.

```js
// engine.js
/**
 * Advance a run by at most one step. Pure orchestration: reads and writes the store,
 * calls deps for everything non-deterministic.
 * @param {{ db: object, runId: string, owner: string,
 *   deps: { exec: Function, stepCall?: Function, verify?: Function, emit?: (event:object)=>void,
 *           now?: () => number, sleep?: (ms:number)=>Promise<void>, lensActions?: Map, recall?: Function } }} a
 * @returns {Promise<{ ok: boolean, status: RunStatus, advanced: boolean, reason?: string }>}
 */
export async function tickRun(a) {}
/** Tick until the run stops moving or the deadline passes. */
export async function driveRun(a /* same as tickRun plus { deadlineMs?: number, maxTicks?: number } */) {}
/** Resolve {"$ref":"stp_x.result.a.b"} and {"$ref":"stp_x.values.key"} in args against done steps. */
export function resolveRefs(args, steps) {}
export function runProgress(steps) {}   // { done, total, failed, skipped }
```

`tickRun` algorithm. `emit` defaults to a no-op; `verify` defaults to `async () => ({ pass: true, checks: [] })` until CKPT-11; `stepCall` defaults to `requestStepCall`.

1. Load the run. Not found: `{ ok:false, reason:"not_found" }`. Status in `done|failed|cancelled`: `{ ok:true, status, advanced:false }`. Status `awaiting_confirm`: `{ ok:true, status, advanced:false }`. Status `paused` with `resumeAt` in the future (or null): `advanced:false`.
2. `acquireLease(db, runId, owner)`; false gives `{ ok:true, status, advanced:false, reason:"leased" }`. Everything below runs in `try { … } finally { releaseLease }`.
3. If status is `planned` or `paused`: `updateRun(status:"running", statusReason:null, resumeAt:null)`; emit a `cockpit:run` event.
4. Budget check (CKPT-14 fills this in; until then only `usage.toolCalls >= budget.maxToolCalls` or steps done `>= budget.maxSteps` gives `updateRun(status:"paused", statusReason:"budget")` and return).
5. `steps = listSteps(db, runId)`. Pick the step: the lowest `seq` whose status is not `done|skipped|failed` and whose every `dependsOn` id is `done` or `skipped`. If a dependency `failed`, mark this step `skipped` with `errorClass:"dependency_failed"` and return `advanced:true`.
6. No such step: if every required step is `done`, `updateRun(status:"done", finishedAt)`; else `updateRun(status:"failed", statusReason:"required_step_failed")`. Emit and return.
7. `updateRun(cursor: step.seq)`. If the step is `pending` or `ready`: `updateStep(status:"running", startedAt, attempts: step.attempts + 1)`.
8. **Resume branch** (step was already `running` when loaded): CKPT-12 fills this in. Until then treat it as a fresh attempt.
9. **Build the call.**
   - `args = resolveRefs(step.args, steps)`.
   - If `step.tool` is set and `args` passes `validateAndRepair` against the spec with `menuIds:[step.tool]`: use it; no model call.
   - Otherwise: `menu = buildToolMenu({ goal: step.goal, runGoal: run.goal, declaredTool: step.fallbackTool || step.tool, lensContext: run.lensContext, profile: run.modelProfile, lensActions, exclude: <tools already failed on this step> })`; `packet = buildContextPacket(…)`; `r = stepCall({ db, userId, profile, packet, forcedTool: step.tool && !step.fallbackTool ? step.tool : null, reask: <stored reask text or null> })`; `addUsage`. If `!r.ok`: go to step 12 with `errorClass = r.errorClass`. If `r.call.tool === "ask_user"`: `updateStep(status:"awaiting_confirm", errorText: r.call.args.question)`, `updateRun(status:"awaiting_confirm", statusReason:"question")`, emit `cockpit:confirm` with `kind:"question"`, return. If `r.call.tool === "done"`: treat as a successful result `{ ok:true, result:{ summary: r.call.args.summary } }` and go to step 11. Otherwise `vr = validateAndRepair(r.call, { menuIds, getSpec, prior })`; append `vr.repairs` to `repairs_json`; `!vr.ok` goes to step 12 with `bad_args` and stores `vr.reask`.
10. **Execute.** `res = runTool({ db, run, step, call, deps })`; `addUsage({ toolCalls: 1 })`. `!res.ok` goes to step 12.
11. **Verify.** `updateStep(status:"verifying", result: res.result, resultSummary: summarizeResult(res.result, { tool }))`; `updateRun(status:"verifying")`. `v = await verify({ db, run, step, call, result: res })`. On `v.pass`: `updateStep(status:"done", finishedAt, errorClass:null)`, `updateRun(status:"running")`, emit `cockpit:step` with status `done`, return `advanced:true`. On fail: `errorClass = v.errorClass || "verify_failed"`, store the failed check names as the reask text, go to step 12.
12. **Failure.** `action = nextAction({ errorClass, attempt: step.attempts (after the increment), required: step.required, spec, triedTools })`. Then:
    | `action.kind` | Do |
    |---|---|
    | `repair`, `reask`, `retry`, `slot_change` | `updateStep(status:"ready", errorClass, errorText)`; for `retry` with `delayMs`, `await sleep(delayMs)`; for `slot_change`, `updateRun(modelProfile: nextProfile(run.modelProfile))` where `nextProfile` maps `local-2b` to `local-9b`, `local-9b` to `local-30b`, others unchanged. Return `advanced:true` |
    | `fallback_tool` | `updateStep(status:"ready", fallbackTool: action.tool, errorClass)`; return `advanced:true` |
    | `ask_user` | `updateStep(status:"awaiting_confirm", errorClass, errorText)`; `updateRun(status:"awaiting_confirm", statusReason:"needs_help")`; emit `cockpit:confirm` with `kind:"help"`; return |
    | `pause` | `updateStep(status:"ready")`; `updateRun(status:"paused", statusReason:"rate_limited", resumeAt: now + 600)`; return |
    | `skip` | `updateStep(status:"skipped", errorClass, finishedAt)`; emit; return `advanced:true` |
    | `fail_step` | `updateStep(status:"failed", errorClass, finishedAt)`; return `advanced:true` |
    | `stop_run` | `updateStep(status:"failed", errorClass)`; `updateRun(status:"failed", statusReason:`hard_stop:${errorText slice 80}`, finishedAt)`; emit; return |
13. **Loop guard.** Before step 10, compute `sig = step.id + "|" + call.tool + "|" + canonicalJson(call.args)`. Keep the last 3 signatures in the step's `repairs_json` under kind `"signature"`. If the same signature is about to run a third time, go to step 12 with `errorClass:"looped"`.

`driveRun`: loop `tickRun` while `advanced === true`, `Date.now() < deadlineMs`, and ticks `< maxTicks` (default 50). Between ticks `await new Promise(setImmediate)` so the event loop turns. Return the last tick result.

`resolveRefs`: walk `args` recursively; an object that is exactly `{ "$ref": "<stepId>.result.<path>" }` or `{ "$ref": "<stepId>.values.<key>" }` is replaced by the value at that path in that step's stored `result` or `resultSummary.values`. A reference that cannot be resolved is left as `undefined` (the key is removed), so the validator reports it as missing and the model is asked.

```js
// pump.js
export function startCockpitPump({ db, makeDeps, intervalMs = 5000 }) {}   // returns { stop() }
export async function pumpOnce({ db, makeDeps, owner, limit = 3 }) {}       // returns number of runs ticked
```

`startCockpitPump`: returns `{ stop(){} }` without starting anything when `!cockpitFlag("RUNS")` or `!tablesReady(db)`. Otherwise `setInterval` (store the handle, call `.unref()`), with a guard so a slow cycle is not overlapped, and the whole body in `try/catch`. `owner` is `pump:${process.pid}`. `pumpOnce` calls `findDueRuns`, then for each id `driveRun({ db, runId, owner, deps: makeDeps(run), deadlineMs: Date.now() + 20000, maxTicks: 5 })`.

`server.js`: next to the cockpit route mount from CKPT-01, add:

```js
try {
  const { startCockpitPump } = await import("./lib/cockpit/pump.js");
  const { makeExec } = await import("./lib/cockpit/executor.js");
  globalThis.__cockpitPump = startCockpitPump({ db, makeDeps: (run) => ({
    exec: makeExec({ db, userId: run.userId, sessionId: run.chatSessionId, runMacro, lensActions: LENS_ACTIONS, surface: run.surface }),
    lensActions: LENS_ACTIONS,
  }) });
} catch (e) { console.warn("[cockpit] pump not started:", e?.message || e); }
```

Do not start the pump when `process.env.NODE_ENV === "test"` or `process.env.CONCORD_NO_LISTEN === "true"` (check inside `startCockpitPump`), so the main test suite has no open timer.

### Tests

`executor.test.js`: `toAgentCall` for a `lens:` id and a plain id; a fake exec that never resolves returns `errorClass:"timeout"` (use a spec override with `timeoutMs: 50`); a fake that throws returns `tool_error`; the error text has tool names scrubbed (`"conkay_design failed"` does not contain `conkay_design`).

`engine.test.js`, all with `memDb()`, `fakeExec`, a mock model, and `sleep: async () => {}`:
1. Three fully specified steps (`web_search` with a query each): `driveRun` ends `done`; the mock model's `calls.length === 0`; `fakeExec.calls.length === 3`.
2. A step with `tool:null`: the mock returns `web_search`; ends `done`; one model call.
3. Second step's exec fails `HTTP 503` once then succeeds: ends `done`; that step's `attempts === 2`.
4. Second step is not required and always fails `unsupported part`: it ends `skipped`, the run ends `done`.
5. Second step is required and always fails `DTU not found` with a mock that keeps returning the same call: the run ends `awaiting_confirm` with `statusReason "needs_help"`, never `failed`.
6. A step fails `forbidden_by_governance`: the run is `failed`, `statusReason` starts with `hard_stop:`, and the third step never ran.
7. `{"$ref":"<step1>.values.dtuId"}` in step 2's args resolves to step 1's value.
8. Two `tickRun` calls with different owners at once (`Promise.all`): exactly one advances.
9. Loop guard: a mock that returns the identical failing call three times produces `errorClass "looped"` on the third.
10. Negative control: with a run in `awaiting_confirm`, `tickRun` returns `advanced:false` and `fakeExec.calls.length` does not change.

`engine-resume.test.js`: run two of four steps with `maxTicks: 2`; build a **new** `deps` object and a new owner (simulating a restart); `driveRun` again; the run ends `done`, each tool was called exactly once across both drives, and the mock model was not asked again for the finished steps.

**2B check.** CKPT-21 and CKPT-22 are the end-to-end checks for this ticket.
**Rollback.** `CONCORD_COCKPIT_RUNS=0` stops the pump; no surface starts runs before CKPT-16.
**Risks.** Event loop: one step per tick, `setImmediate` between ticks, each tool call named in the job tracker. Two workers on one run: the lease, pinned by test 8. Runaway loops: budgets, the loop guard, and `MAX_STEP_ATTEMPTS`.
**Done when.** CI green.

---

## CKPT-10: Planner

**Goal.** Turn a request into steps: from a template when one fits, from a constrained model call otherwise.
**Why.** Research: workflows beat free agents where the task is known. Concord already has tested recipes and deterministic solvers.
**Probe failure it addresses.** October #3 (design asks stop at numbers) and the sweep's 63 `not_found` rows, which are missing prerequisite steps.
**Depends on.** CKPT-02, CKPT-08. **Flag.** none (library; called from CKPT-16).
**Reuse.** `validateDag` (`lib/macro-dag.js`), the allow-list idea of `parseLLMPlan`, `listRecipes`, `isLongTaskAsk`, `wants3dModel`. **Do not** let a model name a tool that is not in the candidate list.

### Files

- Create `server/lib/cockpit/plan-templates.js`
- Create `server/lib/cockpit/planner.js`
- Create `server/tests/cockpit/planner.test.js`

### Interfaces

```js
// planner.js
/**
 * @param {{ db: object, userId: string, goal: string, lensContext?: string|null, profile: string,
 *           lensActions?: Map, deps?: { brainChat?: Function, mock?: object } }} a
 * @returns {Promise<{ ok: boolean, source: "template"|"model"|"single", steps: PlanStep[], reason?: string }>}
 */
export async function planRun(a) {}
/** Validate and normalize a list of plan steps. */
export function normalizePlan(rawSteps, { candidateIds, maxSteps = 60 }) {}
/**
 * @typedef {{ key: string, goal: string, tool: string|null, args: object|null, expects: Expect[],
 *             dependsOn: string[], required: boolean }} PlanStep   // dependsOn holds keys here, ids after insert
 */
```

```js
// plan-templates.js
/** @type {Array<{ id: string, match: (goal:string)=>boolean, build: (goal:string)=>PlanStep[] }>} */
export const PLAN_TEMPLATES = [ /* the four below */ ];
```

Templates (write exactly these four):

1. `research_report`. Match: `/\b(research|investigate|look into|find out)\b/i` and `/\b(report|summary|write[- ]?up|document|brief)\b/i`. Steps: `s1` web_search `{ query: goal }` expects `[ok, nonempty path "results"]`; `s2` tool null, goal "Search again with a more specific query based on the first results", depends `s1`, not required; `s3` tool null, goal "Open the most relevant source and read it", depends `s1`, not required; `s4` create_document with `args: null`, goal "Write the report from the sources found", depends `s1`, required, expects `[ok]`.
2. `size_and_model`. Match: `/\b(beam|cantilever|bracket|shaft|column|truss)\b/i` and `wants3dModel(goal)`. Steps: `s1` conkay_design `{ text: goal }` expects `[ok]`; `s2` generate_3d `{ prompt: goal }`, depends `s1`, not required.
3. `recipe_calc`. Match: `listRecipes(goal).length > 0` and `/\b(size|check|calculate|compute|compare|convert)\b/i`. Steps: `s1` list_recipes `{ query: goal }`; `s2` run_recipe with `args: null`, goal "Run the matching tested calculation with the user's numbers", depends `s1`, expects `[ok, receipt]`.
4. `find_and_act`. Match: `/\b(add|create|log|schedule|book|record|save|track)\b/i`. Steps: `s1` find_lens_actions `{ query: goal }` expects `[ok, nonempty path "actions"]`; `s2` tool null, goal "Run the action that does what was asked, with the user's details", depends `s1`, required, expects `[ok]`.

Before writing template 1 and 3, read the return shape of `web_search` and `listRecipes` in the code and set the `nonempty` path to a field that really exists in a successful result. If the field name differs from `results`/`actions`, use the real one.

`planRun` algorithm:
1. `goal` empty: `{ ok:false, reason:"empty_goal" }`.
2. First template whose `match(goal)` is true: `normalizePlan(build(goal))`, source `template`.
3. Otherwise ask a model once. Candidate ids: `buildToolMenu({ goal, profile:"local-30b", lensContext, lensActions })` ids (at most 8). Call `brainChat` on the profile's slot with `temperature: 0`, `maxTokens: 900`, and `format`:
   ```json
   { "type":"object", "additionalProperties":false, "required":["steps"],
     "properties": { "steps": { "type":"array", "items": {
       "type":"object", "additionalProperties":false, "required":["goal","tool"],
       "properties": { "goal": {"type":"string"}, "tool": {"type":"string","enum":["<candidate ids>","auto"]},
                       "after": {"type":"array","items":{"type":"integer"}} } } } } }
   ```
   System text: `Break the task into the fewest steps that finish it. Each step uses one tool. Use "auto" when unsure which tool. "after" lists earlier step numbers (starting at 1) this step needs. Reply with JSON only.` User text: `Task: <goal>\nTools:\n- <id>: <description>`.
   Map each to a `PlanStep`: `key: "s" + (i+1)`, `tool: tool === "auto" ? null : tool`, `args: null`, `expects: [{ kind:"ok" }]`, `dependsOn: after.map(n => "s" + n)`, `required: true`.
4. Model failed, or `normalizePlan` rejected everything: return a one-step plan `{ key:"s1", goal, tool:null, args:null, expects:[{kind:"ok"}], dependsOn:[], required:true }`, source `single`. A plan always exists.

`normalizePlan`: drop steps whose `tool` is not null and not in `candidateIds` and has no `getToolSpec` (templates pass their own tools as candidates); cut `goal` to 200 characters; remove `dependsOn` keys that do not exist or point forward; reject the plan (return `{ ok:false, reason:"cycle" }`) when `validateDag` reports a cycle (adapt the input to the shape `validateDag` expects; read its doc comment first); cut to `maxSteps`. Return `{ ok:true, steps }`.

Inserting a plan (used by CKPT-16): `insertSteps` assigns ids; then rewrite each `dependsOn` from keys to ids. Put that in `planner.js` as `export function materializePlan(db, runId, planVersion, planSteps)`.

### Tests

`planner.test.js`: "research heat pumps and write me a report" gives template `research_report` with 4 steps and `s4.dependsOn` containing `s1`; "size a steel cantilever beam and make a 3d model" gives `size_and_model`; "add a task to buy milk" gives `find_and_act`; a goal matching nothing with a `brainChat` fake returning two steps gives source `model`, and a step naming a tool outside the candidates is dropped; a fake returning `"nonsense"` gives source `single` with one step; a plan with `s1` after `s2` and `s2` after `s1` is rejected by `normalizePlan`; `materializePlan` stores `dependsOn` as real step ids. Negative control: the model fake returns 100 steps; the plan has at most 60.

**2B check.** CKPT-22 records which source each desk run used.
**Rollback.** Revert; no caller before CKPT-16.
**Risks.** A weak planner on a 2B: templates cover the common shapes, the model plan is constrained to an enum, and the fallback is a single step, which is today's behaviour. Prompt injection: the planner sees only the user's goal and tool descriptions.
**Done when.** CI green.

---

## CKPT-11: Verifier

**Goal.** Check each step's result in code before it counts as done.
**Why.** tau-bench and the quantization paper: many failures raise no error. Sweep: 2 fake-success actions. Harness: 3 untraced numbers, 1 invented citation.
**Probe failure it addresses.** F0 reported `allowed_and_verified` for a call whose result was `ok:false, scope_denied` (audit section 3f).
**Depends on.** CKPT-02, CKPT-08. **Flag.** none; the engine uses it as soon as it is passed in `deps.verify`.
**Reuse.** `validateAgainstSchema`, `guardNumericTrace`, `verifyAttestation`, `verifyReceipt` (`lib/conkay/iterate/receipt.js`), `verifyClaim`, `classifyExecutionResult` (`lib/runtime/critic.js`). **Do not** call a judge model unless the step lists `judge`.

### Files

- Create `server/lib/cockpit/verifier.js`
- Modify `server/lib/cockpit/pump.js` and the `server.js` `makeDeps` from CKPT-09 to pass `verify: verifyStep`
- Create `server/tests/cockpit/verifier.test.js`

### Interface

```js
/**
 * @param {{ db: object, run: Run, step: Step, call: {tool:string,args:object}, result: StepResult,
 *           deps?: { verifyClaim?: Function } }} a
 * @returns {Promise<{ pass: boolean, checks: Array<Expect & { pass: boolean, detail?: string }>, errorClass?: "verify_failed"|"fake_success" }>}
 */
export async function verifyStep(a) {}
export const STUB_RE = /\b(mock(ed)?|placeholder|not implemented|coming soon|lorem ipsum|stub(bed)?|todo|sample data|fake)\b/i;
export function pathGet(obj, path) {}   // dotted path, array indexes allowed, never throws
```

Checks run in this order. Always-on checks first, then the step's own `expects`.

1. `ok` (always): `a.result.ok === true`.
2. `not_stub` (always): fail when `STUB_RE` matches `JSON.stringify(a.result.result).slice(0, 4000)` **and** the spec's risk is `write` or `high` or the match is inside a field named `note`, `message` or `status`. Also fail when the spec's risk is `write` or `high` and the result has no field matching `/(^|[a-z])id$|Id$|^key$|^url$/` at depth at most 3 (a write that returns no identifier). A failure here sets `errorClass:"fake_success"`.
3. `schema`: `validateAgainstSchema(expect.schema || spec.outputSchema, a.result.result)`; skipped (pass) when there is no schema.
4. `nonempty`: value at `path` is not `null`, `undefined`, `""`, `[]`, or `{}`.
5. `range`: value at `path` is a finite number with `min <= v <= max` (each bound optional).
6. `numeric_trace`: when the result has a `text`, `answer` or `summary` string, run `guardNumericTrace` on it with the step's own result as the trace source. Read that function's signature in `lib/chat/numeric-trace.js` and pass what it expects; pass when it reports no untraced numbers.
7. `receipt`: find `a.result.result.receipt` (or `.result.receipt`); pass when `verifyAttestation(receipt).valid === true`, or, when the receipt has no `signature` block, when it has a `digest` or `hash` field. A receipt whose `signature.signature === null` with a `reason` passes with `detail: "unsigned: <reason>"`; do not fail runs on a box with no signing key.
8. `judge`: `(a.deps?.verifyClaim || verifyClaim)(a.db, { claim: expect.claim, citationIds: <DTU ids found in the result>, requesterId: a.run.userId, useCouncil: false, useProof: false })`; pass when the verdict resolves every citation. Read `verifyClaim`'s return shape first.

`pass` is true when every check passes. Unknown `kind`: pass with `detail:"unknown check"`. The function never throws; a check that throws fails with the message as `detail`.

### Tests

`verifier.test.js`: an ok read result passes; `{ ok:true, result:{ message:"mock data, not implemented" } }` from a tool with risk `write` fails with `fake_success`; a `create_dtu` result with no id fails `fake_success`; the same with `dtuId` passes; `nonempty` on `results` with `[]` fails and with one item passes; `range` 0..10 on value 11 fails; a recipe result with a tampered attested receipt fails `receipt` (make one with `attestReceipt`, change a field); an unsigned receipt passes with detail; `judge` with a fake `verifyClaim` returning one unresolved citation fails. Negative control: a read tool whose result text contains the word "sample" in a field named `title` passes (stub wording outside `note|message|status` on a read is not a failure).

**2B check.** CKPT-21 includes a step whose tool returns stub wording; it must be retried.
**Rollback.** Remove `verify` from `makeDeps`; the engine's default passes everything.
**Risks.** False failures blocking good steps: the retry table gives `verify_failed` a re-ask and then a fallback, and a non-required step is skipped. Tune `STUB_RE` from telemetry, not by guess.
**Done when.** CI green.

---

## CKPT-12: Idempotency and crash recovery for writes

**Goal.** A retry, a resume, or a restart never writes twice.
**Why.** Audit finding 5: the F0 idempotency gate is in memory, 60 seconds, observe-only, and the bridge ignores `idempotency_key`.
**Probe failure it addresses.** `runLensActionMcp` returns `idempotency_key: clean.idempotency_key || null` and does nothing else with it.
**Depends on.** CKPT-08, CKPT-09. **Flag.** none; always on for runs.
**Reuse.** `canonicalJson`, `sha256Hex`, `recordToolDispatch`, `recordToolOutcome`. **Do not** change `gates/idempotency.js`.

### Files

- Create `server/lib/cockpit/idempotency.js`
- Modify `server/lib/cockpit/executor.js` (at the `// CKPT-12` marker)
- Modify `server/lib/cockpit/engine.js` (step 8, the resume branch)
- Create `server/tests/cockpit/idempotency.test.js`, `server/tests/cockpit/crash-resume.test.js`

### Interfaces

```js
export function effectKey(runId, stepId, tool, args) {}   // sha256Hex(`${runId}|${stepId}|${tool}|${canonicalJson(args)}`)
/** @returns {{ state: "claimed"|"replay"|"in_flight", key: string, result?: object }} */
export function claimEffect(db, { runId, stepId, tool, args }) {}
export function completeEffect(db, key, result) {}
export function failEffect(db, key) {}                     // deletes the row: a failed call wrote nothing and may be retried
export function markEffectUnknown(db, key) {}
export function getEffect(db, key) {}
```

`claimEffect`: `INSERT INTO cockpit_effects (idempotency_key, run_id, step_id, tool, args_hash, status) VALUES (…,'claimed')`. On a primary-key conflict read the row: `completed` returns `{ state:"replay", result }`; `claimed` or `unknown` returns `{ state:"in_flight" }`.

`executor.runTool`, at the marker, only when `spec.risk !== "read"`:

```js
const claim = claimEffect(a.db, { runId: a.run.id, stepId: a.step.id, tool: a.call.tool, args: a.call.args });
if (claim.state === "replay") return { ...claim.result, replayed: true };
if (claim.state === "in_flight") return { ok: false, tool: a.call.tool, result: null, errorClass: "in_flight", error: "This step may already be running.", retryHint: null, artifacts: [], latencyMs: 0, provider: null, model: null };
const logId = recordToolDispatch(a.db, a.run.id, a.step.seq, a.call.tool, a.call.args);
```

Pass the key to lens actions: in `toAgentCall`, accept a second argument `key` and set `params.idempotency_key = key` for `run_lens_action`. After the call: on success `completeEffect(db, key, stepResult)` and `recordToolOutcome(db, logId, "completed", summary)`; on failure `failEffect(db, key)` and `recordToolOutcome(db, logId, "failed", error)`. A **timeout** is neither: call `markEffectUnknown` and leave the dispatch row as `dispatched`, because the write may have landed.

Also `updateStep(idempotencyKey: key)`.

Engine step 8, the resume branch (the step was `running` when loaded, meaning a previous process died or timed out):

1. Compute nothing new. Read `step.idempotencyKey`. If null: no write was dispatched; continue as a fresh attempt.
2. `getEffect(key)`:
   - `completed`: use the stored result; go to verify.
   - missing: continue as a fresh attempt.
   - `claimed` or `unknown`: if `spec.idempotent === true`, delete the effect row and run again. Otherwise `updateStep(status:"awaiting_confirm", errorClass:"in_flight", errorText:"This step may already have happened.")`, `updateRun(status:"awaiting_confirm", statusReason:"maybe_done")`, emit `cockpit:confirm` with `kind:"maybe_done"`. The user's choices (CKPT-13) are "it happened, continue" (mark the step `done` with `resultSummary {values:{confirmedByUser:true}}`) or "run it again" (delete the effect row, set the step `ready`).

Add `errorClass "in_flight"` to `nextAction` in `retry-policy.js`: always `{ kind: "ask_user" }`.

### Tests

`idempotency.test.js`: same inputs give the same key; different args give a different key; key order in args does not matter; claim then claim again is `in_flight`; claim, complete, claim again is `replay` with the result; claim, fail, claim again is `claimed`.

`crash-resume.test.js`:
1. A `create_dtu` step whose exec increments a counter. Run it to `done`. Call `runTool` again with the same step and args: the counter is still 1 and the result has `replayed: true`.
2. Simulated crash: exec for `create_dtu` returns a promise that never resolves; race the drive against 200 ms and abandon it. The step is `running` with an effect `claimed`. Drive again with a new owner (after the lease TTL, by passing `now`): the run is `awaiting_confirm` with `statusReason "maybe_done"`, and the exec counter is still 1.
3. Same as 2 with `run_compute` (idempotent): the second drive calls exec again and the run finishes.
4. Negative control: a `web_search` step (risk `read`) creates no row in `cockpit_effects`.

**2B check.** CKPT-21 forces a restart mid-write and asserts zero duplicates.
**Rollback.** Revert the commit; the table stays empty.
**Risks.** A user told "this may have happened" too often: only non-idempotent writes interrupted mid-call reach that card. Key reuse across plan versions: a replan creates new step ids, so new keys.
**Done when.** CI green.

---

## CKPT-13: Confirmation gate; remove model self-approval

**Goal.** Write and high-risk steps pause for the person; approval can only come from the person.
**Why.** Audit finding 4: `approval: call.params.approval === true` forwards the model's own claim of approval to the bridge. MCP spec: a human in the loop SHOULD be able to deny tool invocations.
**Probe failure it addresses.** `chat-agent.js`, `run_lens_action` case: `approval: call.params.approval === true, approval_token: call.params.approval_token || call.params.approvalToken || null,`.
**Depends on.** CKPT-09, CKPT-12. **Flags.** `CONCORD_COCKPIT_STRIP_APPROVAL`, default **on** (security fix for the old loops). Confirmation inside runs is always on.
**Reuse.** `classifyLensActionRisk`, `resolveLensRisk`, `scrubUserFacingToolNames`, `isBareAffirmation`. **Do not** add a second approval-token scheme; the bridge's `approval: true` stays the only signal, and only the executor sets it.

### Files

- Create `server/lib/cockpit/confirm.js`
- Modify `server/lib/cockpit/executor.js` (at the `// CKPT-13` marker), `server/lib/cockpit/engine.js`
- Modify `server/lib/chat-agent.js` (`run_lens_action` case)
- Create `server/tests/cockpit/confirm.test.js`, `server/tests/cockpit/self-approval.test.js`

### Old-loop fix

In `executeToolCall`, `case "run_lens_action"`, replace the two lines quoted above with:

```js
            approval: cockpitFlag("STRIP_APPROVAL") ? ctx?.cockpitApproved === true : call.params.approval === true,
            approval_token: cockpitFlag("STRIP_APPROVAL") ? null : (call.params.approval_token || call.params.approvalToken || null),
```

`ctx.cockpitApproved` is set only by the cockpit executor. With the flag on, a high-risk lens action called from the old agent loop or plain chat returns the bridge's `approval_required`, which `classifyFailure` maps to `hard_stop` (it matches "authorization"). Add this row to `classifyFailure` above rule 4: `result.reason === "approval_required"` gives class `needs_confirm`, `hard:false`, `retryable:false`; add `needs_confirm` to `FAILURE_CLASSES`; in `nextAction`, `needs_confirm` is always `{ kind:"ask_user" }`. Update the CKPT-01 and CKPT-05 tests for the new class.

### Interfaces

```js
// confirm.js
/** @returns {"none"|"once"|"always"} */
export function confirmPolicy(risk) { return risk === "high" ? "always" : risk === "write" ? "once" : "none"; }
/**
 * @param {{ run: Run, step: Step, call: {tool:string,args:object}, spec: object, approvals: Approval[] }} a
 * @returns {{ needed: boolean, reason?: "write"|"high" }}
 * @typedef {{ stepId: string|null, tool: string, argsHash: string|null, scope: "step"|"run_tool", userId: string, at: number }} Approval
 */
export function needsConfirm(a) {}
/** Plain-language card. */
export function buildConfirmCard({ step, call, spec }) {}
/** Record the person's answer. */
export function applyDecision(db, { run, step, userId, decision, editedArgs = null, dontAskAgain = false }) {}
```

Approvals are stored in the run's `usage_json` under `approvals` (array). Add `export function getApprovals(run)` and `addApproval(db, runId, approval)` to `run-store.js`.

`needsConfirm`: policy `none` gives `needed:false`. `always`: needed unless an approval exists with `stepId === step.id` and `argsHash === sha256Hex(canonicalJson(call.args))`. `once`: needed unless such a step approval exists, or an approval with `scope:"run_tool"` and the same `tool` exists.

`buildConfirmCard` returns `{ kind: "confirm", stepId, label: spec.title, goal: step.goal, risk: spec.risk, changes: [<one sentence>], args: [{ name, value }] }`. `changes`: for `high`, `"This cannot be undone or spends money."`; for `write`, `"This saves or changes something in your account."`. `args`: each top-level key of `call.args` (for lens tools, of `call.args` itself) as `{ name: humanize(key), value: String(value).slice(0, 200) }`, at most 12, skipping keys matching `/token|secret|password/i`. `humanize("due_date")` is `"Due date"`. Every string passes through `scrubUserFacingToolNames`.

`applyDecision`:
- the run must belong to `userId` and the step must be `awaiting_confirm`; otherwise `{ ok:false, reason:"not_waiting" }`.
- `approve`: if `editedArgs` is an object, validate it with `validateAndRepair` against the step's tool; invalid returns `{ ok:false, reason:"invalid_edit", errors }`; valid sets `step.args = editedArgs`. `addApproval({ stepId, tool, argsHash, scope:"step", userId, at })`, plus a second `{ scope:"run_tool", stepId:null, argsHash:null }` when `dontAskAgain` and the risk is `write` (never for `high`). `updateStep(status:"ready")`, `updateRun(status:"running", statusReason:null)`, `addUsage({ humanInterventions: 1 })`.
- `reject`: `updateStep(status: step.required ? "failed" : "skipped", errorClass:"rejected_by_user")`; `updateRun(status: step.required ? "failed" : "running", statusReason: step.required ? "rejected_by_user" : null)`.
- `answer` (for `kind:"question"` and `kind:"help"`): store the text in `step.args.__userAnswer` cut to 1,000 characters, `updateStep(status:"ready", attempts: 0)`, run back to `running`. `buildContextPacket` adds `User said: <answer>` as the first constraint when that field is present; add that line there.
- `mark_done` and `run_again` (for `kind:"maybe_done"`): as described in CKPT-12.

Engine: after the call is built and validated (step 9) and before the loop guard, call `needsConfirm`. When needed: `updateStep(status:"awaiting_confirm", args: call.args, tool: call.tool)`, `updateRun(status:"awaiting_confirm", statusReason:"confirm")`, emit `{ type:"cockpit:confirm", runId, ...buildConfirmCard(…) }`, return. On the next tick after approval the step has its tool and args stored, so the call is rebuilt with no model call and `needsConfirm` is false.

Executor, at the marker: `const approved = !needsConfirm({ …, approvals: getApprovals(a.run) }).needed;` If the spec's risk is `write` or `high` and not approved, return `{ ok:false, errorClass:"needs_confirm", error:"This step needs your approval." }` without calling the tool (defence in depth). When approved and the risk is `high`, call `a.deps.exec(agentCall, { approved: true })`; `makeExec` passes that through by building the call's ctx as `{ ...ctx, cockpitApproved: true }` for that one call.

### Tests

`confirm.test.js`: a `web_search` step never pauses; a `create_dtu` step pauses, and after `applyDecision approve` the run finishes with the tool called once; a second `create_dtu` step in the same run pauses again unless `dontAskAgain` was set; a `lens:billing.pay-invoice` step (register a fake in `lensActions`) pauses every time even with `dontAskAgain`; `approve` with edited args runs with the edited values; `approve` with invalid edited args is refused; `reject` on a non-required step skips it and the run continues; `applyDecision` by another user returns `not_waiting`; an approval for args A does not approve args B on a high-risk step. The card contains no tool id and no key named `token`.

`self-approval.test.js`: with `CONCORD_COCKPIT_STRIP_APPROVAL` unset, `executeToolCall` on `{ tool:"run_lens_action", params:{ domain:"billing", action:"pay-invoice", approval:true, params:{} } }` with a registered fake handler that sets a flag: the flag is **not** set and the result is not ok. Use an actor with no `scopes` array, as the agent loop does. Negative control: with the flag `"0"` the handler runs (this documents the old behaviour and proves the test can tell the difference).

**2B check.** CKPT-21 has exactly two confirm cards; CKPT-22 allows at most three interventions.
**Rollback.** `CONCORD_COCKPIT_STRIP_APPROVAL=0` restores the old loop behaviour. Run confirmation has no off switch by design.
**Risks.** Existing flows that relied on the model passing `approval:true` stop working with the flag on. Search for `approval: true` and `"approval":true` under `server/` and `concord-frontend/`; list every hit in the DONE note. Any hit that is a prompt telling the model to pass approval must be removed in this ticket.
**Done when.** CI green and the DONE note lists the `approval` search results.

---

## CKPT-14: Budgets, account rate limits, event-loop safety

**Goal.** A run stays inside its budgets and the account's GB-1498 caps, pauses instead of failing when it reaches one, and never stalls the server.
**Why.** GB-1498: 100 calls/hour and 20 heavy calls/hour per account. October audit: the breaker tripped on `event_loop_pressure`.
**Probe failure it addresses.** Live: a member's bridge calls return `scope_denied` (FIX-crisis-ops-001); plain chat hits the same check through `_toolCtx = { ...ctx }`.
**Depends on.** CKPT-09. **Needs GB-1498 merged** on the branch you build on. Check: `grep -n "sessionBridgeScopes\|MCP_BRIDGE_RATE_LIMIT_PER_HOUR" server/lib/*.js`. If neither is found, stop and post on the bridge; do not write a scope mapping or a limiter of your own.
**Flag.** none beyond `RUNS`.
**Reuse.** GB-1498's scope helper and limiter, `getPressureStrikes`, `withJob`. **Do not** add a limiter.

### Files

- Create `server/lib/cockpit/budget.js`
- Modify `server/lib/cockpit/engine.js` (step 4), `server/lib/cockpit/executor.js` (`makeExec` actor), `server/lib/cockpit/pump.js`
- Create `server/tests/cockpit/budget.test.js`, `server/tests/cockpit/bridge-scope-regression.test.js`

### Interfaces

```js
// budget.js
/** @returns {{ ok: true } | { ok: false, reason: "steps"|"tool_calls"|"model_calls"|"tokens"|"wall", resumable: boolean }} */
export function checkBudget(run, steps, nowMs) {}
export function budgetFromEnv(env = process.env) {}    // reads CONCORD_COCKPIT_MAX_STEPS, _MAX_TOOL_CALLS, _MAX_MODEL_CALLS, _STEP_WALL_MS, _RUN_WALL_MS
export function maxActiveRuns(env = process.env) {}    // CONCORD_COCKPIT_MAX_ACTIVE, default 2, clamp 1..10
/** Seconds to wait from a rate-limit failure result. */
export function retryAfterSec(result) {}               // result.retryAfter || result.retry_after || 600, clamp 30..3600
```

`checkBudget`: `steps` done `>= maxSteps` gives `steps`; `usage.toolCalls >= maxToolCalls` gives `tool_calls`; `usage.modelCalls >= maxModelCalls` gives `model_calls`; `usage.tokensIn >= maxTokensIn` gives `tokens`; `nowMs - run.createdAt * 1000 >= wallMs` gives `wall`. All are `resumable: true`.

Engine step 4: on a failed check, `updateRun(status:"paused", statusReason:`budget:${reason}`, resumeAt: null)` and emit a `cockpit:run` event. A paused run with `resumeAt` null resumes only when the user says continue (CKPT-15's `resume` route raises the exhausted budget by its default again, once per call, never above the hard caps: 200 steps, 400 tool calls).

Rate limits: the executor does not count calls itself. The bridge's GB-1498 limiter does, because every lens and ConKay call from the executor goes through `runLensActionMcp` and its siblings. When a result classifies as `rate_limited`, engine step 12's `pause` row uses `resumeAt: now + retryAfterSec(res.raw)`.

`makeExec` actor: replace `actor: { userId, id: userId, sessionId, role, internal: false }` with the same plus the session scopes GB-1498 defines. Read GB-1498's helper and call it the way its own tests do; pass `authMethod: "cockpit"` only if that helper accepts unknown methods, otherwise pass `"jwt"`.

Plain chat scope fix: in `server.js`, the `_toolCtx` used for the lens tool cases carries the request actor. After GB-1498 the same helper makes that actor pass. Do not change `_toolCtx`; add the regression test below instead.

Pump: at the start of each cycle, `if (getPressureStrikes() > 0) return;`.

Concurrency: `createRun` callers (CKPT-15, CKPT-16) refuse when `countActiveRuns(db, userId) >= maxActiveRuns()` with `{ ok:false, reason:"too_many_runs" }`.

### Tests

`budget.test.js`: each of the five reasons; a run paused on `budget:tool_calls` does not advance on `tickRun`; an exec fake returning `{ ok:false, reason:"rate_limited", retryAfter: 120 }` pauses the run with `resumeAt` about 120 seconds ahead and the step still `ready`; after moving `now` past `resumeAt`, `findDueRuns` returns it and it completes; `maxActiveRuns({ CONCORD_COCKPIT_MAX_ACTIVE: "99" })` is 10.

`bridge-scope-regression.test.js` (pins FIX-crisis-ops-001): call `listLensActionsMcp(null, { domain:"physics" }, null, { actor: { id:"u1", userId:"u1", role:"member", scopes:["read","write"], authMethod:"cookie" }, lensActions: new Map([["physics.power", () => {}]]) })`. Expected after GB-1498: `ok: true` and `total >= 1`. Second case: the same actor calling `runLensActionMcp` on `ops.anything` is refused. Third (negative control): an actor with `id:"hermes"` and no scopes still gets `hermes_scopes_required`.

**2B check.** CKPT-22 runs under the real caps and records calls used.
**Rollback.** Revert; budgets fall back to CKPT-09's two checks.
**Risks.** A 32-step run with retries can approach 100 calls/hour: the default plan budget is 120 tool calls, and a pause on the cap resumes by itself when the window opens. More than 20 writes in an hour pauses the same way. Say so in the run card text (CKPT-17).
**Done when.** CI green; FIX-crisis-ops-001 regression test passes.

---

## CKPT-15: Run routes, events, signed step receipts

**Goal.** HTTP surface for runs, live events, and a signed receipt for every finished step.
**Why.** Brief items 11 and 5 (handoff). Concord has Ed25519 receipts and uses them for recipes only.
**Probe failure it addresses.** `chat-agent-stream` sends raw `tool_call` payloads with tool ids to the browser; no agent step has a receipt.
**Depends on.** CKPT-09, CKPT-11. **Flag.** `CONCORD_COCKPIT_RUNS`: every route returns `404 { ok:false, error:"cockpit_disabled" }` when off.
**Reuse.** `attestReceipt`, `canonicalJson`, `sha256Hex`, `startSSE`, `scrubUserFacingToolNames`. **Do not** stream raw tool results.

### Files

- Create `server/lib/cockpit/receipts.js`, `server/lib/cockpit/events.js`
- Modify `server/routes/cockpit.js`, `server/lib/cockpit/engine.js` (attach the receipt in step 11), `server/server.js` (pass `runMacro`, `LENS_ACTIONS` into the mount)
- Create `server/tests/cockpit/receipts.test.js`, `server/tests/cockpit/routes.test.js`

### Interfaces

```js
// receipts.js
/** @returns {Receipt} signed (or unsigned with a reason when no key is loaded) */
export function makeStepReceipt({ run, step, call, result, checks }) {}
```

Builds the `Receipt` body from `ARCHITECTURE.md` section 3 (`kind:"cockpit.step.v1"`, hashes via `sha256Hex(canonicalJson(x))`), then returns `attestReceipt(body)`. The engine stores it with `updateStep(receipt: receipt)` (add `receipt` to `updateStep`, written to `receipt_json`) and sets `receiptId = step.id`. Receipts are made for `done` steps only.

```js
// events.js
/** In-process fan-out keyed by run id. */
export function subscribeRun(runId, fn) {}     // returns unsubscribe
export function publishRun(runId, event) {}    // never throws
export function runEvent(run, steps) {}        // { type:"cockpit:run", runId, status, statusReason, done, total }
export function stepEvent(run, step, total) {} // { type:"cockpit:step", runId, seq, total, status, label, receiptId }
```

`label` is the spec title when the step has a tool, else the step goal, passed through `scrubUserFacingToolNames`. The production `deps.emit` is `(e) => publishRun(e.runId, e)`; set it in `makeDeps`.

Routes (all require `req.user?.id`; all read runs with `getRunForUser`, so another user's run is `404`):

| Method and path | Body | Result |
|---|---|---|
| `POST /api/cockpit/runs` | `{ goal, chatSessionId?, lensContext?, surface? }` | plans with `planRun`, creates the run and steps, starts `driveRun` without awaiting it (deadline 25 s; the pump continues after), returns `201 { ok:true, run: publicRun, steps: publicSteps }`. `429 { ok:false, error:"too_many_runs" }` over the concurrency cap. `400` on an empty goal |
| `GET /api/cockpit/runs` | | `{ ok:true, runs: publicRun[] }`, newest first, at most 20 |
| `GET /api/cockpit/runs/:id` | | `{ ok:true, run, steps, progress }` |
| `GET /api/cockpit/runs/:id/events` | | SSE. First sends `runEvent` and one `stepEvent` per step, then live events until the run is `done|failed|cancelled` or the client disconnects. Unsubscribe on `req.on("close")` |
| `POST /api/cockpit/runs/:id/decision` | `{ stepId, decision: "approve"|"reject"|"answer"|"mark_done"|"run_again", editedArgs?, dontAskAgain?, answer? }` | calls `applyDecision`, then `driveRun` as above. `409 { ok:false, error:"not_waiting" }` when the step is not waiting |
| `POST /api/cockpit/runs/:id/pause` | | status `paused`, reason `user` |
| `POST /api/cockpit/runs/:id/resume` | | from `paused` only; raises an exhausted budget as in CKPT-14; drives |
| `POST /api/cockpit/runs/:id/cancel` | | status `cancelled` |
| `GET /api/cockpit/runs/:id/steps/:stepId/receipt` | | the stored receipt, or `404` |

`publicRun`: `{ id, goal, status, statusReason, surface, lensContext, chatSessionId, createdAt, updatedAt, finishedAt, usage: { toolCalls, modelCalls, humanInterventions } }`. `publicStep`: `{ id, seq, label, goal, status, required, attempts, hasReceipt, summary: resultSummary?.text || null, error: status is failed or skipped ? scrubbed errorText : null }`. Never include `args_json`, `result_json`, or tool ids in public objects.

These are cookie-authenticated POSTs: they sit under `/api/`, so the existing CSRF middleware applies. Do not add them to any CSRF exemption list.

### Tests

`receipts.test.js`: a receipt for a done step passes `verifyAttestation` when a test key is set the way `server/tests` for receipts do it (find an existing receipt test and copy its key setup); changing `argsHash` afterwards makes it fail; with no key the receipt has `signature.signature === null` and a `reason`.

`routes.test.js`: build an `express()` app, add a middleware that sets `req.user = { id: "u1", role: "member" }`, mount with `memDb()`, a mock model and `fakeExec`. Use `fetch` against `app.listen(0)`; close the server in `after`. Cases: flag off gives 404; create returns 201 and the run reaches `done` (poll `GET` up to 2 s); another user (`req.user.id = "u2"`) gets 404 on that run; a run with a `create_dtu` step reaches `awaiting_confirm`, `decision approve` finishes it; `decision` on a non-waiting step is 409; the receipt route returns a receipt whose `stepId` matches; the SSE route delivers at least one `cockpit:step` event and its text does not contain `web_search`; a third concurrent run is 429. Negative control: the JSON of `GET /runs/:id` does not contain the string `"args"`.

**2B check.** None. **Rollback.** `CONCORD_COCKPIT_RUNS=0`.
**Risks.** Information leak across users: every route goes through `getRunForUser`; tested. SSE connections held open: unsubscribe on close, and end the stream at a terminal status.
**Done when.** CI green.
