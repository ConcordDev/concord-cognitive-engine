# Cockpit plan: 2B-safe long-horizon tool use

Ticket GB-1500. 22 tickets, `CKPT-01` to `CKPT-22`, in dependency order.
Read `AUDIT.md` (what is broken, with evidence) and `ARCHITECTURE.md` (types, states, tables) before starting. The ticket text lives in `tickets/`.

## Implementer instructions

You are building this one ticket at a time. Follow these rules on every ticket.

1. **Where to work.** Dutch has ruled that these tickets land on branch `fix/audit-sweep-20261110` (PR #2356). Use your own worktree of that branch under `~/concord-wt/`. Never edit the live checkout `/Users/dutch/concord vs code/concord-cognitive-engine`. Muse builders push to the same branch, so run `git pull --rebase origin fix/audit-sweep-20261110` before every push, and stage only the files your ticket names (`git add <paths>`, never `-A`).
2. **One ticket, one commit series.** Prefix every commit subject with the ticket id, for example `CKPT-03: validate and repair tool calls`. Do not start ticket N+1 until ticket N's CI run is green.
3. **Order.** Build in number order. A ticket's "Depends on" line is a hard requirement.
4. **Tests run in GitHub CI only.** Never run `npm test`, `node --test`, a build, or a dev server on the Mac. Write the test files the ticket lists, push, and read the CI result with `gh run list` and `gh run view`. Test files go under `server/tests/cockpit/` and are picked up by the existing glob `tests/**/*.test.js`.
5. **Bridge protocol.** Before a ticket: `~/.zuko/quality/bin/bridge-append -a "<your seat>" -t "CLAIM" < body.md`, naming the ticket id. After CI is green: the same with `-t "DONE"`, the commit hash and the CI run link.
6. **Do not touch Muse's fixes.** The ids listed under "Muse-held" in section 4 are fixed on this branch already. Read that code, build on it, and leave it as it is. If a ticket here seems to need a change inside one of those fixes, stop and post a question on the bridge.
7. **Never print secrets.** No tokens, cookies, `csk_` keys, `FOUNDER_SECRET`, or file contents from `~/.zuko/secrets/` in code, logs, commits, PR text, or the bridge. Tests use injected fakes, never real credentials.
8. **No live writes while building.** Do not write to `server/data/*.db`, restart services, merge, or deploy.
9. **Do not split `server/server.js`.** Add new modules under `server/lib/cockpit/` and wire them in with the small edits each ticket shows.
10. **Line numbers are for `origin/main` @ `dae9e10a6`.** The fix branch has moved. Find every anchor by searching for the quoted text, not by number. If the quoted text is not there, stop and report it on the bridge; do not guess a new location.
11. **Flags.** Every behaviour change is behind an env flag that defaults to off. Read flags only through `cockpitFlag()` from CKPT-01.
12. **Boot order.** `app` and `LENS_ACTIONS` are declared late in `server.js`. Anything that uses them at module top level must sit after `function registerLensAction` or inside a function. Each ticket says where its edit goes.
13. **Honest failure.** A function that cannot do the real thing returns `{ ok: false, reason: "<code>" }`. Never return a made-up success, a placeholder result, or a simulated step.
14. **Heartbeats and timers must not throw.** Wrap the pump body in `try/catch`.
15. **When a security-shaped task is refused by your model**, write what was refused on the bridge as a ticket for another seat and continue with the rest.

## 1. What already exists and must be reused, not rebuilt

| Need | Use this | Do not |
|---|---|---|
| Run any tool | `executeToolCall(ctx, runMacro, lensActions, call)` in `server/lib/chat-agent.js` | write a second dispatcher |
| Run or list a lens action | `runLensActionMcp`, `listLensActionsMcp` in `server/lib/mcp-execution-bridge.js` (already called by `executeToolCall`) | call lens handlers directly |
| Scopes, risk class, approval | `authorizeBridgeCall`, `classifyLensActionRisk` in `server/lib/mcp-hermes-identity.js`, plus GB-1498's session scope helper and rate limiter when merged | add another gate or another limiter |
| Find a lens action by words | `findLensActions(query, lensActions, {limit})` in `server/lib/chat-agent.js` | build a new search index |
| Keyword tool scoring | `compileToolUniverse(task, opts)` in `server/lib/runtime/tool-universe-compiler.js` | write another scorer |
| Embedding tool pick | `pickTools` in `server/lib/inference/tool-picker.js`, after CKPT-06 repairs its imports | leave it dead or copy it |
| Alias and key normalization | `normalizeToolCall`, `normalizeLensActionParams`, `normalizeCallParams` in `server/lib/chat/tool-call-normalize.js` | re-implement aliasing |
| Closest names | `closestNames(wanted, names, limit)` in `server/lib/chat-agent.js` | add a new distance function |
| Input hints | `MACRO_INPUT_HINTS` in `server/lib/macro-input-hints.js` (generated; do not hand-edit) | invent defaults |
| Param validation for lens actions | `validateParamSchema`, `validateLensActionInput` in `server/lib/macro-param-schema.js` | add a JSON-schema library |
| Dispatch write-ahead log | `recordToolDispatch`, `recordToolOutcome`, `findStuckDispatches` in `server/lib/marathon-tick-durability.js` (table `agent_marathon_tool_log`) | create a new dispatch table |
| Action memory and failure counts | `recordAction`, `getRecentActions` in `server/lib/agent-action-log.js` (table `agent_action_log`) | create a telemetry table |
| Prior-step summaries | `recordLedgerEvent`, `compactLedgerForContext`, `failureSignature` in `server/lib/runtime/execution-ledger.js` | write another ledger |
| Dependency graph check | `validateDag(plan)` in `server/lib/macro-dag.js` | write a cycle detector |
| Plan parsing against an allow-list | the pattern in `parseLLMPlan` in `server/lib/mission-planner.js` | trust a model's tool names |
| Tested multi-step calculations | `listRecipes`, `runRecipe` in `server/lib/chat/tool-recipes/index.js` | re-derive the formulas |
| DHTP preset selection and compression | `selectPreset`, `applyDHTP` in `server/lib/dhtp.js` | call `compileExecutiveCognition` (it reads Dila's `hermes_dtus`, not the user's) |
| User-scoped recall | `globalThis.__concordRecallMemory` and the `chat.harvest` macro, as used in `runAgentLoop` | query `dtus` directly |
| Receipts | `attestReceipt`, `verifyAttestation`, `canonicalJson`, `sha256Hex` in `server/lib/receipts/attest.js` | sign anything yourself |
| Claim judge | `verifyClaim` in `server/lib/reason-verify.js` | write a judge prompt |
| Numeric trace | `guardNumericTrace` in `server/lib/chat/numeric-trace.js` | re-implement |
| Model call | `brainChat` in `server/lib/byo-router.js`, `ollamaChat` in `server/lib/inference/ollama-client.js` (already forwards `format` and `tools`) | call Ollama with `fetch` |
| gpt-oss reasoning quirk | `usesReasoningLevels`, `reasoningLevelFor` in `server/lib/ollama-request-guard.js` | special-case model names again |
| Progress events | `chatProgress(ctx, event)` in `server/lib/chat/progress.js` | use timers or fake progress |
| Hiding tool names from people | `scrubUserFacingToolNames` in `server/lib/chat/tool-turn-reply.js` | show tool ids in the UI |
| Hard-stop classes | `HARD_ERROR_RE`, `RECOVERABLE_ERROR_RE`, `isRecoverableToolFailure` in `server/lib/chat/tool-turn-reply.js` | widen what stops a run |
| Long-task delivery into chat | `deliverLongTaskResult`, `takePendingLongTaskNotices`, `isLongTaskAsk` in `server/lib/long-task.js` | build a second notice channel |
| Affirmation detection | `isBareAffirmation`, `stripAffirmation` in `server/lib/chat/agent-route.js` | add new yes/no regexes |
| Event-loop naming and pressure | `withJob` in `server/lib/loop-job-tracker.js`, `getPressureStrikes` in `server/lib/request-admission.js` | add a new breaker |
| SSE | `startSSE` in `server/lib/sse.js` | hand-roll headers |

Leave alone: `server/lib/mission-runtime.js` and `server/lib/runtime/dhtp-compiler.js` (operator missions), `server/lib/inference/agent-loop.js` (the other loop named `runAgentLoop`), `server/lib/conkay/chat/orchestrator.js` (ConKay's design iteration; CKPT-20 calls it as a tool, it is not replaced).

## 2. Flags

All read through `cockpitFlag(name)`. Default is off unless stated.

| Flag | Default | Turns on | First ticket |
|---|---|---|---|
| `CONCORD_COCKPIT_TELEMETRY` | on | failure class on action-log rows, plain chat logging | CKPT-01 |
| `CONCORD_COCKPIT_REPAIR` | off | validate and repair inside `executeToolCall` | CKPT-03 |
| `CONCORD_COCKPIT_RETRY` | off | class-based retry in both old loops | CKPT-05 |
| `CONCORD_COCKPIT_MENU` | off | short tool menu in the old agent loop | CKPT-06 |
| `CONCORD_COCKPIT_RUNS` | off | run routes, engine, pump | CKPT-09 |
| `CONCORD_COCKPIT_CONSTRAINED` | on when RUNS is on | schema-constrained step calls | CKPT-04 |
| `CONCORD_COCKPIT_STRIP_APPROVAL` | on | removes model-written `approval` from tool calls | CKPT-13 |
| `CONCORD_COCKPIT_ROUTE` | off | chat turns may start a run | CKPT-16 |
| `CONCORD_COCKPIT_ASK_CONTEXT` | off | lens context evidence for Ask | CKPT-18 |
| `CONCORD_COCKPIT_LONG_TASK` | off | `start_long_task` creates a cockpit run | CKPT-20 |
| `CONCORD_COCKPIT_MOCK_MODEL` | unset | path to a fixture file; test only, refused when `NODE_ENV=production` | CKPT-04 |

## 3. Tickets

| # | Title | Depends on | File |
|---|---|---|---|
| 01 | Failure taxonomy and telemetry | none | `tickets/A-foundations.md` |
| 02 | Tool spec registry and model profiles | 01 | `tickets/A-foundations.md` |
| 03 | Validate and repair tool calls | 02 | `tickets/A-foundations.md` |
| 04 | Constrained step call with a mock-model seam | 02, 03 | `tickets/A-foundations.md` |
| 05 | No single failure ends a turn: class-based retry | 01, 03 | `tickets/A-foundations.md` |
| 06 | Per-step tool menu; repair `pickTools` | 02 | `tickets/A-foundations.md` |
| 07 | Step context packet | 02, 06 | `tickets/A-foundations.md` |
| 08 | Migration 501 and the run store | 01 | `tickets/B-engine.md` |
| 09 | Engine: tick, lease, pump, resume | 04, 05, 06, 07, 08 | `tickets/B-engine.md` |
| 10 | Planner | 02, 08 | `tickets/B-engine.md` |
| 11 | Verifier | 02, 08 | `tickets/B-engine.md` |
| 12 | Idempotency and crash recovery for writes | 08, 09 | `tickets/B-engine.md` |
| 13 | Confirmation gate; remove model self-approval | 09, 12 | `tickets/B-engine.md` |
| 14 | Budgets, account rate limits, event-loop safety | 09 | `tickets/B-engine.md` |
| 15 | Run routes, events, signed step receipts | 09, 11 | `tickets/B-engine.md` |
| 16 | Chat routing in: answer, one call, or run | 10, 13, 15 | `tickets/C-surfaces.md` |
| 17 | Frontend: run card, confirm card, live transcript | 15, 16 | `tickets/C-surfaces.md` |
| 18 | Lens Ask on the core | 16, 17 | `tickets/C-surfaces.md` |
| 19 | Lens agent panels and the Agents lens on the core | 16 | `tickets/C-surfaces.md` |
| 20 | ConKay, long tasks and outside MCP agents on the core | 16 | `tickets/C-surfaces.md` |
| 21 | CI scenario: 32 steps with induced failures, mock model | 09 to 15 | `tickets/D-harness.md` |
| 22 | Desk scenario on a real 2B, and the default-on plan | 21 | `tickets/D-harness.md` |

Value lands early: CKPT-01, 03, 05 and 06 each improve today's chat and agent loop on their own, before any run exists.

## 4. FIX tickets

### Owned (GB-1500)

| FIX id | Fixed by | Note |
|---|---|---|
| FIX-crisis-ops-001 | GB-1498, then CKPT-14 | The scope mapping is Muse's GB-1498. CKPT-14 adds the regression test and puts plain chat on the same actor. If GB-1498 is not merged when you reach CKPT-14, stop and say so on the bridge |
| FIX-chat-001 | CKPT-17 | |
| FIX-chat-014 | CKPT-19 | |
| FIX-agents-010 | CKPT-19 | |
| FIX-meditation-002 | CKPT-19 | |
| FIX-wellness-004 | CKPT-19 (agent part) | The publish part ("No DTU id returned") is not a cockpit problem; CKPT-19 lists it as handed back |
| FIX-reasoning-002 | CKPT-19 (agent part) | Publish rejection, the HTTP 400 and the map crash are handed back |
| FIX-quests-005, FIX-world-005 | CKPT-18 | on top of Muse's `RCA-ask-silent` fix |
| FIX-analytics-005, FIX-lattice-004, FIX-narrative-walk-006, FIX-frontier-005, FIX-concord-link-frontier-009, FIX-government-023, FIX-healthcare-005 | CKPT-18 | |
| FIX-forecast-001 | CKPT-18 | |
| FIX-goddess-001, FIX-lfg-001, FIX-tick-005, FIX-inheritance-011 | CKPT-18 | No root cause yet. CKPT-18 gives the diagnosis steps and the required end state |

### Muse-held (read, build on, do not change)

FIX-all-002, FIX-ethics-001, FIX-hvac-004, FIX-plumbing-003, FIX-ar-014, FIX-fitness-016, FIX-calendar-014, FIX-graph-007, FIX-goals-001, FIX-command-center-004, FIX-marketing-003, FIX-parenting-005, FIX-black-market-006/007/008, FIX-app-maker-008, FIX-mining-006, FIX-event-timeline-002, FIX-fishing-002, FIX-garage-003, FIX-training-room-001, FIX-staking-009, FIX-literary-005, FIX-social-009, FIX-cognitive-replay-004, FIX-custom-009, FIX-productivity-004, FIX-system-003, FIX-game-design-004, FIX-market-007, FIX-chat-002, FIX-chat-004, FIX-chat-011, FIX-dx-platform-014, FIX-agents-002.

Their Ask fix (commit 545ed1873, `RCA-ask-silent` in `audit/fix-list/FIX_PROGRESS.md`): an Ask reuses a thread filed under that lens or starts a new one, and permission and handler failures are explained without the internal tool name. CKPT-18 keeps both behaviours.

### Dependencies that are not ours

FIX-reasoning-001, FIX-council-006, FIX-marketing-008, FIX-hvac-012, FIX-masonry-012 (`/api/lens/run` 400 and 422). A run step that calls one of these actions gets `bad_args` or `tool_error` and the run continues, but the step itself cannot succeed until they are fixed. CKPT-21's scenario avoids those lenses.

## 5. Pass criteria for the whole plan

Measured by CKPT-21 in CI and CKPT-22 on the desk:

| Measure | CI, mock model | Desk, real 2B |
|---|---|---|
| Steps completed in the 32-step scenario | 32 of 32 | at least 30 of 32 |
| Induced failures recovered without a person (bad arg, unknown tool, timeout, stale DTU id) | 4 of 4 | at least 3 of 4 |
| Human interventions | exactly 2 (the two confirm cards) | at most 3 |
| Duplicate writes after a forced restart mid-write | 0 | 0 |
| Steps with a receipt that passes `verifyAttestation` | all | all |
| Largest step packet | at most 2,500 estimated tokens | at most 2,500 |
| Largest tool menu | at most 8 | at most 8 |
| Runs ended by a single tool failure | 0 | 0 |
