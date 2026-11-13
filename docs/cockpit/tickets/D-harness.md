# Tickets CKPT-21 and CKPT-22: harness

Read `../PLAN.md` "Implementer instructions" first. These two tickets measure the plan against the table in `PLAN.md` section 5. They add no product behaviour.
Server test files start with the two imports shown in `A-foundations.md`. `memDb`, `fakeExec` and the mock model come from `server/tests/cockpit/_helpers.js` (CKPT-08) and `server/lib/cockpit/mock-model.js` (CKPT-04).

---

## CKPT-21: CI scenario: 32 steps with induced failures, mock model

**Goal.** One CI test that drives a 32-step run from start to finish through four induced failures, two confirm cards and a forced restart in the middle of a write, and checks every number in the "CI, mock model" column.
**Why.** Brief pass criteria. Each earlier ticket tests its own part; nothing yet proves the parts hold together for 32 steps.
**Probe failure it addresses.** Oct 19 #1, #4, #6, #7 in one run: a single failure ending the turn, an invented key, a stale id, and a step claimed but never run.
**Depends on.** CKPT-09 to CKPT-15. **Flag.** The test sets `CONCORD_COCKPIT_RUNS`, `_REPAIR`, `_RETRY`, `_MENU`, `_CONSTRAINED` on through an `env` object or `process.env` restored in `after`. No production flag changes.
**Reuse.** `planRun` is **not** used: the plan is a fixture, so the test is deterministic. `createRun`, `insertSteps`, `tickRun`, `driveRun`, `pumpOnce`, `applyDecision`, `verifyAttestation` (`lib/receipts/attest.js`), `estimateTokens`, `createMockModel`, `fakeExec`. **Do not** call a real model, the network, or the real `executeToolCall`.

### Files

- Create `server/tests/cockpit/scenario-32.fixture.js`
- Create `server/tests/cockpit/scenario-32.test.js`
- Create `server/tests/cockpit/scenario-report.js`
- Modify `server/tests/cockpit/_helpers.js` (two additions, below)

### Interfaces

```js
// scenario-32.fixture.js
/** 32 PlanStep objects, keys "s01".."s32". */
export const SCENARIO_STEPS = [ /* below */ ];
/** Mock-model script: what the model returns for each step that has tool: null or needs a re-ask. */
export const SCENARIO_MODEL_SCRIPT = { /* stepKey -> array of responses, used in order */ };
/** Tool behaviour table for fakeExec, including the induced failures. */
export const SCENARIO_EXEC_TABLE = { /* tool id -> handler(params, callCount) */ };
export const INDUCED = Object.freeze({ badArg: "s05", unknownTool: "s11", timeout: "s17", staleId: "s23" });
export const CONFIRM_STEPS = Object.freeze(["s14", "s30"]);
export const RESTART_AT = "s30";
```

The plan, a beam-design job in the engineering and DTU tools that `PLAN.md` section 4 says are safe to use (no `reasoning`, `council`, `marketing`, `hvac`, `masonry` actions). Use only tool ids that exist in `AGENT_TOOL_SPECS` (CKPT-02) or as real lens actions; check each with `getToolSpec` in a setup assertion and fail the test with the missing id if one is absent.

| Steps | What | Tool known in the plan? | Risk |
|---|---|---|---|
| s01 to s04 | recall the person's notes, read two DTUs, search for a span table | yes | read |
| s05 | unit conversion, feet to metres | no, model picks | compute |
| s06 to s10 | five compute steps, each using `$ref` to an earlier value | yes | compute |
| s11 | load combination | no, model picks | compute |
| s12, s13 | two recipe runs through `runRecipe` | yes | compute |
| s14 | save an interim note as a DTU | yes | write |
| s15, s16 | read the note back, check a value | yes | read |
| s17 | external lookup | yes | read |
| s18 to s22 | five compute steps | mixed: s19 and s21 are model-picked | compute |
| s23 | read a DTU by an id taken from the model | no, model picks | read |
| s24 to s29 | six compute and read steps, one `required:false` | yes | compute, read |
| s30 | save the final design | yes | high |
| s31 | read the saved design back | yes | read |
| s32 | write the summary (`done`) | no | none |

Induced failures and the recovery each must take:

| Step | What the fixture does | Expected path | Counts as recovered when |
|---|---|---|---|
| s05 bad arg | the mock model's first response uses the key `physics.length.convert`, which the tool rejects with `validKeys` | `bad_args`, then repair (`fuzzy_name` or `reask`) per CKPT-03 and CKPT-05 | the step is `done` with `attempts >= 2` and a `RepairAttempt` is recorded |
| s11 unknown tool | the mock model's first response names `load_combo_calc`, which is not on the menu | `unknown_tool`, then `closestNames` or a re-ask | the step is `done` and the executed tool is a menu id |
| s17 timeout | `SCENARIO_EXEC_TABLE` makes the first call return `{ ok:false, reason:"timeout" }`, the second succeed | `timeout`, retry per CKPT-05 | the step is `done` with `attempts === 2` |
| s23 stale id | the mock model's first response gives a DTU id that does not exist; the right id is in a prior step's values | `not_found`, then a re-ask with the prior values in the packet (CKPT-07) | the step is `done` and its args contain the id from step s14's result |

None of the four may pause the run or need a person.

`_helpers.js` additions:

```js
/** A deps object whose exec, stepCall and emit record everything. */
export function scenarioDeps({ execTable, modelScript, events = [] }) {}
/** Simulate a process restart: drop the in-memory deps, clear the lease the dead owner held as CKPT-09's crash path would see it. */
export function simulateRestart(db, runId) {}
```

`simulateRestart` must not write anything a real crash would not leave behind. It makes the old owner's lease expired (set its expiry to the past through `run-store.js`; if `run-store.js` has no function for that, add `expireLeaseForTest(db, runId)` there, exported and named for tests) and returns a fresh `deps`.

```js
// scenario-report.js
/**
 * @param {{ run: Run, steps: Step[], events: object[], packets: ContextPacket[], execCalls: object[] }} a
 * @returns {{ stepsDone: number, total: number, recovered: Record<string, boolean>, humanInterventions: number,
 *             duplicateWrites: number, receiptsValid: number, receiptsTotal: number,
 *             maxPacketTokens: number, maxMenu: number, runsEndedBySingleFailure: number }}
 */
export function scenarioReport(a) {}
/** Markdown table of the report against PLAN.md section 5; printed by the test and reused by CKPT-22. */
export function reportMarkdown(report, column /* "ci" | "desk" */) {}
```

`duplicateWrites`: count of `execCalls` for a write or high tool that share the same `(tool, canonicalJson(params))` and both returned `ok:true`, minus one per group. `receiptsValid`: steps whose stored receipt passes `verifyAttestation`. `maxPacketTokens`: largest `packet.estTokens`. `maxMenu`: largest `packet.menu.length`. `runsEndedBySingleFailure`: 1 if the run is `failed` and exactly one step has a non-null `errorClass`, otherwise 0.

To collect packets, `scenarioDeps.stepCall` records the packet it was given before delegating to the mock model. If `tickRun` builds the packet internally and passes only messages to `stepCall`, capture it through whatever hook CKPT-09 provided; if there is none, add an optional `deps.onPacket?.(packet)` call in `engine.js` directly after `buildContextPacket`, in this ticket, and cover it with one assertion.

### Steps

1. Write the fixture. Keep every step goal under 200 characters and every expected value computed by the fixture's own exec table, not typed by hand.
2. Write `scenarioDeps`, `simulateRestart`, `scenarioReport`.
3. Write the test, in this order:
   1. `memDb()`, set a receipt test key the way `receipts.test.js` (CKPT-15) does, `createRun`, `insertSteps`.
   2. `driveRun` until the run is `awaiting_confirm` at s14. Assert s01 to s13 are `done`, s05 and s11 were recovered.
   3. `applyDecision(approve)` for s14, then `driveRun` to the next stop. Assert it is `awaiting_confirm` at s30, and s17 and s23 were recovered.
   4. `applyDecision(approve)` for s30. Then tick with a `SCENARIO_EXEC_TABLE` handler for the save tool that performs its write (increments a counter in the fixture) and then **throws a sentinel** before returning, so the engine never sees the result. Catch the sentinel in the test. This is the crash in the middle of a write.
   5. `simulateRestart`, then `pumpOnce` with the fresh deps until the run is terminal or 20 cycles pass.
   6. Whatever CKPT-12 does with an effect in the unknown state (a `maybe_done` card, or a read-back check), follow it the way a person would **only if** CKPT-12 says a person is needed. If it does need a person here, that is a third intervention and the test fails: the scenario's save tool must be one CKPT-12 can check by reading back (s31's read tool), so recovery needs no one.
   7. Build the report and assert the table below.
4. Print `reportMarkdown(report, "ci")` with `console.log` so the numbers are in the CI log.

### Tests (CI only)

Assertions in `scenario-32.test.js`:

| Measure | Assertion |
|---|---|
| steps completed | `report.stepsDone === 32` and `run.status === "done"` |
| induced failures recovered | all four entries of `report.recovered` are `true` |
| human interventions | `run.usage.humanInterventions === 2` |
| duplicate writes | `report.duplicateWrites === 0`, and the fixture's save counter is exactly 1 for s14 and 1 for s30 |
| receipts | `report.receiptsValid === report.receiptsTotal`, and `receiptsTotal` equals the number of `done` steps |
| packet size | `report.maxPacketTokens <= 2500` |
| menu size | `report.maxMenu <= 8` |
| single-failure endings | `report.runsEndedBySingleFailure === 0` |
| honesty | no event `label` or step `error` contains a tool id from the fixture; every step with status `done` has an `execCalls` entry or is s32 (`done`), so no step was claimed without running |
| time | the whole test finishes in under 60 s (the mock model and fake exec return at once; `deps.sleep` is a no-op) |

Negative controls, as separate tests in the same file:

1. With `CONCORD_COCKPIT_RETRY` off, the same fixture does **not** reach 32 of 32. This proves the scenario really depends on the recovery code.
2. With the s30 save tool marked `idempotent: false` and not readable back, the restart leaves the run waiting for a person, not `done` with two writes. This proves the duplicate-write check can fail.
3. Tampering with one stored receipt's `argsHash` makes `receiptsValid` one less than `receiptsTotal`.

**2B check.** None; this is the mock-model half. **Rollback.** Test only; delete the files.
**Risks.** A fixture so tidy that it proves nothing: the three negative controls. A flaky test from timing: no real sleeps, no real timers, `deps.now` injected and advanced by the test. The scenario drifting from real tools: the setup assertion that every tool id resolves through `getToolSpec`.
**Done when.** CI green, and the printed table shows every "CI, mock model" number from `PLAN.md` section 5.

---

## CKPT-22: Desk scenario on a real 2B, and the default-on plan

**Goal.** Run the same 32-step job against the real local 2B model on Dutch's desk, record the numbers in the "Desk, real 2B" column, and write down the order in which the flags are turned on.
**Why.** The mock model proves the machinery; only a real 2B proves the packets, menus and schemas are small and clear enough for it. Everything before this ticket is CI only.
**Probe failure it addresses.** All of Oct 19 #1 to #7, on the model they happened on.
**Depends on.** CKPT-21. **Flag.** None added. The desk run turns the flags on for one process through its environment; it does not edit any env file.
**Reuse.** `SCENARIO_STEPS`, `INDUCED`, `scenarioReport`, `reportMarkdown` (CKPT-21), the routes from CKPT-15, `defaultProfile` (CKPT-02), `GET /api/cockpit/failures` (CKPT-01). **Do not** write a second scenario, and do not point this at production data.

**This ticket is the one exception to "no running on the Mac", and it is Dutch's to run, not the implementer's.** The implementer writes the script and the runbook and pushes them. Dutch, or a seat Dutch names on the bridge, runs it at the desk. Read the limits in the runbook section first: the live Mac has 16 GB, and a second server beside the live stack has swapped it before.

### Files

- Create `server/scripts/cockpit-desk-scenario.mjs`
- Create `docs/cockpit/DESK_RUNBOOK.md`
- Create `docs/cockpit/DESK_RESULTS.md` (template; filled in after the run)
- Create `docs/cockpit/ROLLOUT.md`
- Create `server/tests/cockpit/desk-script.test.js`

### Interfaces

```
node server/scripts/cockpit-desk-scenario.mjs --base <url> [--out <file>] [--dry-run] [--induce all|none]
```

| Option | Meaning |
|---|---|
| `--base` | base URL of a server with the cockpit flags on. Required. The script refuses a host that is not `localhost` or `127.0.0.1` unless `--allow-remote` is also given |
| `--out` | where to write the result markdown; default `docs/cockpit/DESK_RESULTS.md` |
| `--dry-run` | print the 32 step goals and the four induced failures, call nothing |
| `--induce` | `all` (default) sends the goal text that leads to the four failures; `none` runs the clean plan |

Credentials: the script reads a session cookie from the environment variable `COCKPIT_DESK_COOKIE`. It never reads a file under `~/.zuko/secrets/`, never prints the cookie, and exits with `"COCKPIT_DESK_COOKIE is not set"` when it is missing. The runbook says to use the `claude_design` test account, never a real person's.

What the script does:

1. `GET <base>/api/cockpit/failures?hours=1`. A 404 with `cockpit_disabled`, or any non-200, ends the script with the status and the reminder to set the flags.
2. `POST /api/cockpit/runs` with the scenario goal. On a real model the plan comes from `planRun`, so the script also accepts `--plan-fixture`, which posts the CKPT-21 step list through a body field `steps`. That field is honoured by the route **only** when `NODE_ENV !== "production"` and `CONCORD_COCKPIT_DESK_FIXTURE=1`; add that guarded branch to `POST /api/cockpit/runs` in this ticket, with a test that it is refused in production.
3. Follow `GET /api/cockpit/runs/:id/events` and print one line per step event.
4. On a `cockpit:confirm` event, print the label and the changes, then wait for the operator to type `y` or `n` at the terminal, and `POST …/decision`. The script never approves by itself. Each prompt counts as one human intervention.
5. Induced failures on a real model cannot be scripted the way the mock does. They are induced by the environment:

| Failure | How it is induced at the desk |
|---|---|
| bad arg | the goal text asks for a conversion by a wrong key name ("use physics.length.convert") |
| unknown tool | the goal text names a tool that does not exist ("with the load_combo_calc tool") |
| timeout | the server is started with `CONCORD_COCKPIT_DESK_SLOW_TOOL=<tool id>`, which makes that tool's first call in a run wait past `stepWallMs`. Add this in `executor.js`, honoured only when `NODE_ENV !== "production"`, with a test |
| stale DTU id | the goal text gives a DTU id that does not exist |

6. Restart mid-write: when step s30's confirm is approved, the script prints `RESTART NOW: stop and start the scenario server, then press Enter`. The operator restarts only the scenario server (never the live stack). The script then polls `GET /api/cockpit/runs/:id` every 5 s for up to 10 minutes.
7. At a terminal status, or after 45 minutes, the script fetches the run, the steps and each receipt, builds the report with `scenarioReport` (duplicate writes are counted by listing the saved designs through the read tool and counting those created by this run), and writes `reportMarkdown(report, "desk")` plus the model name, the profile, wall time and the `failures` counts to `--out`.

`DESK_RUNBOOK.md` contents, in this order:

1. Before you start: nothing else heavy running; Unity closed; check free memory and disk. If the live stack is up, use a pod or stop here and ask Dutch. Do not start `next dev`.
2. Start a **separate** backend for the scenario on its own port with its own database file: `DB_PATH=<a new temp file> PORT=5055 CONCORD_COCKPIT_RUNS=1 CONCORD_COCKPIT_REPAIR=1 CONCORD_COCKPIT_RETRY=1 CONCORD_COCKPIT_MENU=1 CONCORD_COCKPIT_DESK_FIXTURE=1 node server.js`, pointed at the local 2B. Never `server/data/concord.db`.
3. Which model: the output of `defaultProfile()` must be `local-2b`. Record the exact model tag from `/api/admin/brain-endpoints`.
4. Sign in as the test account in a browser, copy the session cookie into `COCKPIT_DESK_COOKIE` for that shell only.
5. Run `--dry-run`, then the real run.
6. What to do at each prompt, and the restart step.
7. Afterwards: stop the scenario server, delete the temp database, unset the cookie variable.
8. If the Mac starts to swap: stop the scenario server first.

`DESK_RESULTS.md` template: the `PLAN.md` section 5 table with an empty "Measured" column, then "Model", "Date", "Wall time", "Failure counts by class", "What the person had to do", "Steps that failed and why", and "Verdict: pass or fail". A fail is written as a fail.

`ROLLOUT.md`, the default-on plan. Flags go on one at a time, each only after the one before has run for the stated time with the stated measure. Dutch turns each one on; no ticket changes a default.

| Order | Flag | Turn on when | Watch | Turn off if |
|---|---|---|---|---|
| 1 | `CONCORD_COCKPIT_TELEMETRY` | already on | `GET /api/cockpit/failures` returns counts | n/a |
| 2 | `CONCORD_COCKPIT_REPAIR` | CKPT-03 CI green | `bad_args` and `unknown_tool` counts over 48 h | either count rises against the 48 h before |
| 3 | `CONCORD_COCKPIT_RETRY` | 48 h of step 2 | share of agent turns that end on a tool failure | a turn runs longer than the chat deadline because of retries |
| 4 | `CONCORD_COCKPIT_MENU` | 48 h of step 3 | `unknown_tool` count; replies that say a tool is unavailable | a tool people use stops being offered |
| 5 | `CONCORD_COCKPIT_RUNS` | CKPT-21 green and the desk run passes | pump errors in the log; event-loop pressure strikes | any duplicate write, or pressure strikes that begin with the pump |
| 6 | `CONCORD_COCKPIT_ROUTE` | 72 h of step 5 with runs started by hand through the routes | runs per day, share `done`, human interventions per run | share `done` under 80 percent over 24 h |
| 7 | `CONCORD_COCKPIT_ASK_CONTEXT` | 48 h of step 6 | Ask replies about the wrong lens, reported or sampled | any Ask that hangs past the deadline |
| 8 | `CONCORD_COCKPIT_LONG_TASK` | 72 h of step 6 | long tasks delivered into the thread | a result delivered twice or not at all |

`CONCORD_COCKPIT_CONSTRAINED` and `CONCORD_COCKPIT_STRIP_APPROVAL` are on by default and stay on. `CONCORD_COCKPIT_MOCK_MODEL` and the two `CONCORD_COCKPIT_DESK_*` variables are never set in production; `ROLLOUT.md` says so, and names the test that proves each is refused there.

`ROLLOUT.md` ends with what "done" means for GB-1500: steps 1 to 8 on, the desk table passing, and the FIX ids in `PLAN.md` section 4 "Owned" each marked fixed or handed back in `audit/fix-list/FIX_PROGRESS.md`.

### Steps

1. Write the script. It uses only Node built-ins and `fetch`.
2. Add the two guarded desk branches (`steps` on the create route, the slow-tool variable in the executor) with their tests.
3. Write `DESK_RUNBOOK.md`, the `DESK_RESULTS.md` template and `ROLLOUT.md`.
4. Push, wait for CI, and post `DONE` on the bridge with a note that the desk run is waiting for Dutch.
5. After the desk run, whoever ran it commits the filled-in `DESK_RESULTS.md`. A failing measure becomes a new bridge ticket naming the step and the failure class; it is not edited into a pass.

### Tests (CI only)

`desk-script.test.js`:

- `--dry-run` prints 32 goals and four induced failures and makes no network call (stub `globalThis.fetch` and assert zero calls).
- Without `COCKPIT_DESK_COOKIE` the script exits non-zero with the stated message.
- `--base https://concord-os.org` without `--allow-remote` is refused.
- The script source does not contain `.zuko/secrets` and does not `console.log` the cookie variable (source check).
- `POST /api/cockpit/runs` with a `steps` body is ignored when `NODE_ENV === "production"` even with `CONCORD_COCKPIT_DESK_FIXTURE=1`, and honoured in test with it set.
- `CONCORD_COCKPIT_DESK_SLOW_TOOL` has no effect when `NODE_ENV === "production"`.
- Against an in-process app from `routes.test.js`'s setup with a mock model, the script (imported as a function, `runScenario({ base, cookie, answer: async () => "y", onRestart: async () => {} })`) completes and writes a results file whose table has a row for every measure. Export `runScenario` from the script for this.

**2B check.** This ticket is the 2B check. Pass means every number in the "Desk, real 2B" column of `PLAN.md` section 5: at least 30 of 32 steps, at least 3 of 4 failures recovered, at most 3 interventions, 0 duplicate writes, every step receipt valid, packets at most 2,500 estimated tokens, menus at most 8, and 0 runs ended by a single failure.
**Rollback.** The script and docs change nothing at runtime. The two desk variables are off unless set, and refused in production.
**Risks.** Running beside the live stack and swapping the Mac: the runbook's separate port, separate database and stop-first rule; prefer a pod. A test-only seam reaching production: both seams check `NODE_ENV` and have tests. Reading a pass into a partial run: the results file records the measured numbers and a plain verdict. The real model planning a different 32 steps than the fixture: `--plan-fixture` keeps the plan fixed so the measure is execution, and a second run without it is recorded separately as "planner on".
**Done when.** CI green for the script and seams; `DESK_RESULTS.md` is committed with measured numbers from a real 2B run and a verdict; `ROLLOUT.md` is committed. If the desk run has not happened, the ticket is reported as "built, desk run pending", not done.
