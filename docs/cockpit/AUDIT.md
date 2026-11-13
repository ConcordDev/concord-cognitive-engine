# Cockpit audit: what exists, what works, what breaks

Ticket GB-1500. Read at `origin/main` @ `dae9e10a6` on 2026-11-12. Line numbers are for that commit.
Live evidence is from read-only calls to `http://127.0.0.1:5050` with the test member account on the same day.
Nothing was written to the live database, no chat turn was sent, and no test was run on the Mac.

Status words: **working** (code path runs and evidence shows it), **partial**, **broken**, **dead** (no caller, or cannot run).
A claim marked *guess* has no evidence yet.

## 1. Headline findings

1. **There are seven tool loops, not one.** Each has its own caps, failure policy and context handling (section 2).
2. **The plain chat path still ends on one failed tool.** `server/server.js:31072` calls `shouldSkipToolFollowup(_toolResults)` with no retry allowance, and that path runs one tool round only. The agent loop got two recovery turns after the October audit; plain chat did not.
3. **A member's chat cannot list or run lens actions.** Live: `POST /mcp/call list_lens_actions` returns `scope_denied`, `required_scope: "mcp:lens:read"`, `actor_scopes: ["read","write"]`. The same check fails inside plain chat because `_toolCtx = { ...ctx }` (`server.js:30418`) carries the user row's scopes into `authorizeBridgeCall`. The agent loop passes because it builds an actor with no scopes (`chat-agent.js:2562`). This is FIX-crisis-ops-001 and GB-1498.
4. **The model can approve its own high-risk action.** `chat-agent.js:1160` forwards `call.params.approval === true` from the model's own tool call into `runLensActionMcp`, and `authorizeBridgeCall` accepts it (`mcp-hermes-identity.js:169`).
5. **F0 observes, it does not enforce, for people.** Live responses carry `auth_gate_mode: "observe"`. The idempotency gate is an in-memory map with a 60-second window (`auth-gate/gates/idempotency.js:15-17`), and the in-process chat path does not go through `dispatchMCP` at all.
6. **Tool retrieval is dead.** `lib/inference/tool-picker.js` imports `../embeddings.js` (no such file; the real one is `server/embeddings.js`) and `getLensTools` from `lens-economy-wiring.js` (no such export anywhere). `getToolsInScope` always returns `[]`, so `pickTools` always returns `[]`.
7. **Every agent turn sends the whole tool list and the whole conversation.** 34 tools in one prompt block, plus each tool result up to 12,000 characters appended to the message list (`chat-agent.js:93`, `:2893`). Nothing is constrained: `ollama-client.js:74` accepts `format`, and no tool loop passes it.
8. **Only 176 of 31,404 lens actions have input hints** (0.56%), and none has an output schema. By name, 28,840 actions fall into the default `compute` risk class because their names match neither the write nor the high regex.
9. **"Agent returned empty" is a field-name mismatch.** Panels read `result.reply ?? result.summary ?? result.output` (`SessionPlayerPanel.tsx:414`); `runAgentLoop` returns `answer` (`chat-agent.js:2965`).
10. **No read route exists for `agent_action_log` or `agent_marathon_tool_log`**, and plain chat does not write to the action log. Failure counts today need direct database access.

## 2. The seven tool loops

| # | Loop | Where | Used by | Rounds | On failure | Persisted |
|---|---|---|---|---|---|---|
| 1 | Agent loop | `lib/chat-agent.js:2276` `runAgentLoop` | `chat_agent.do` (`domains/chat-agent.js:56`), ConKay and Agent stream (`routes/chat-agent-stream.js:165`), marathon tick (`lib/agent-marathon.js:954`) | 8 turns (16 on pod), 6 calls per turn, 24 calls total | 2 recovery turns (`CONCORD_AGENT_TOOL_RETRIES`, max 4), then stop | action log only |
| 2 | Plain chat tools | `server.js:30413-31140` inside `chat.respond` | `/api/chat`, `/api/chat/stream`, socket chat | 1 round, 5 calls | stops; one arithmetic rescue | chat rows |
| 3 | Inference loop | `lib/inference/agent-loop.js:77` (also named `runAgentLoop`) | `lib/inference/index.js:108`, `lib/reasoning/continuation.js:159` | `maxSteps`, native `tools` | not audited in depth | `agent_threads` checkpoints |
| 4 | Agents lens runtime | `domains/agents.js` `runTool` (`:224`) | Agents lens "Run Loop" | per agent plan | step marked error | lens state |
| 5 | Marathon and long task | `lib/agent-marathon.js`, `lib/long-task.js` | `start_long_task`, MarathonPanel | 200 turns, 5 per tick | replan checkpoint | `agent_marathon_*` |
| 6 | Mission runtime | `lib/mission-runtime.js:422` `tickMission` | Dila and Hermes autonomous missions | 50 steps, one per tick | `runtime/recovery.js` | `mission_tasks`, `mission_step_log` |
| 7 | ConKay orchestrator | `lib/conkay/chat/orchestrator.js:46` | ConKay design chat | 12 iterations, 4 h | repair rules | session |

Plus direct calls: `lib/chat/agent-route.js:605,635,671` run `executeToolCall` without a loop.

All of loops 1, 2 and 4 end in `executeToolCall(ctx, runMacro, lensActions, call)` (`chat-agent.js:892`), and its `run_lens_action` and `list_lens_actions` cases already call the MCP bridge handlers in-process (`:1150`, `:1574`). That function is the one place every surface already shares. The plan builds on it.

## 3. Inventory

### 3a. Tool registry and schemas

| Piece | Path | What it does | Callers | Status | Evidence |
|---|---|---|---|---|---|
| `TOOL_SCHEMA_BLOCK` | `lib/chat-agent.js:306` | Prose list of agent tools with one example each | `runAgentLoop:2488` | working, but prose only | 34 tools reported under `paths.agent` by `GET /api/chat/tools` |
| `TOOL_REQUIRED_PARAMS`, `_validateToolCall` | `lib/chat-agent.js:106`, `:150` | Required-key check, returns an example marker | `executeToolCall:902` | partial: presence only, no types | code |
| `parseToolCalls` | `lib/chat-agent.js:449` | Finds `[TOOL_CALL: {...}]` spans | loops 1 and 2 | working | code |
| `normalizeToolCall`, `normalizeLensActionParams` | `lib/chat/tool-call-normalize.js:105`, `:52` | Maps aliased shapes onto the schema | `executeToolCall:896`, `parseToolCalls:458` | working | code |
| `unknownToolResult` | `lib/chat-agent.js:435` | Clean error naming the real tools | loop 1 | working | code |
| `toolSchemaBlockFor` | `lib/chat-agent.js:418` | Drops `run_python` for callers who cannot run it | `runAgentLoop:2546` | working | code |
| `chat-tool-surface` | `lib/chat-tool-surface.js:288` | Builds the `/api/chat/tools` report | `routes/chat.js:497` | working, oversized | Live: 2,399,589 bytes, 17 chat tools, 34 agent tools, 29 compute keys, 31,404 lens actions |
| `/mcp/tools` | `server.js:42284` | Lists MCP tools | outside agents | working | Live: 128 tools; 100 need real auth, 25 anonymous, 3 local; 79 have input properties, 43 declare required keys, 0 set `additionalProperties: false`, 0 have `outputSchema`, 0 have annotations |
| `registerLensAction` | `server.js:51327` | Registers a handler and remembers its spec | all domains | working | code |
| `lens-action-dispatch` | `lib/lens-action-dispatch.js:69` | Runs a handler with opt-in spec validation | bridge `:263` | working where a spec exists | code |
| `macro-param-schema` | `lib/macro-param-schema.js:173`, `:260` | Declarative param validation | lens dispatch | working where a spec exists | code |
| `macro-input-hints` | `lib/macro-input-hints.js` | Generated field hints | bridge `:160` | partial: 176 keys over 30 domains | counted by importing the module |

### 3b. Lens actions

Live `GET /api/chat/tools`: **31,404** actions in **267** domains. Largest: code 3,105; healthcare 2,166; music 2,090; art 1,711; legal 1,488; finance 1,417.

Risk, by the same name regexes the bridge uses when the capability registry has no entry (`mcp-hermes-identity.js:40`, `HIGH_ACTION_RE`): high 889, write 1,675, default compute 28,840. The default bucket is not a claim that those actions are read-only. A handler named `log-meal` or `book` writes and lands there. Input-hint coverage is 0.56%.

Sweep evidence (`~/.zuko/harness/results/baseline-tools-20261026.log`, 195 actions reached before the memory guard stopped it): 27 works, 65 needs-args, 101 broken, 2 fake-success. Top causes: `project_not_found` 30, `artifact id required` 25, `handler_error` 24, `artwork not found` 20, admin-only 403 on a member account 21. Most "broken" rows are a missing prerequisite record, which a plan step that creates or finds the record first would satisfy.

### 3c. ConKay tools

`conkay_design`, `conkay_solve`, `conkay_solver_list`, `conkay_ir_schema`, `conkay_compile_brief` are cases in `executeToolCall` (`:1259-1545`) and bridge functions (`mcp-execution-bridge.js:305-564`). Live as a member over `/mcp/call`: all four bridge tools return `scope_denied` (`mcp:conkay:read`). In-process from the agent loop they run. `lib/conkay/iterate/receipt.js:24` makes hash receipts; `lib/conkay/chat/orchestrator.js` has its own budget (12 iterations, 4 hours).

### 3d. Tool retrieval

| Piece | Status | Evidence |
|---|---|---|
| `lib/inference/tool-picker.js#pickTools` | **dead** | both imports fail (finding 6); only caller is `lib/inference/index.js:100` |
| `lib/runtime/tool-universe-compiler.js#compileToolUniverse` | working | keyword scoring over hand tools plus reflected macros; callers `mcp-tools.js:2349`, `runtime/context-assembler.js:78` |
| `findLensActions` | working | `lib/chat-agent.js:568`; one search over every lens action; `agent_action_log` on 2026-10-18 showed 6 calls, 0 errors |

### 3e. Retrieval and memory

| Piece | Path | Status | Note |
|---|---|---|---|
| Chat harvest | `chat.harvest` macro, called at `chat-agent.js:2423` | working | up to 8 DTUs, 200-char snippets |
| User recall | `globalThis.__concordRecallMemory`, `chat-agent.js:2448` | working | user-scoped, capped at 4,000 chars |
| Action recall | `lib/agent-action-log.js:89` | working for loop 1 | plain chat never records |
| Session memory | `lib/chat/session-memory.js` | working | remember and recall of stated values |
| Working context | `lib/chat/working-context.js:23` | working | windowed history for plain chat |
| `substrate-retrieval`, `context-pool` | `lib/chat/` | working | used by plain chat |
| `compileExecutiveCognition` | `lib/runtime/dhtp-compiler.js:61` | working for missions | recalls from `hermes_dtus` via `dila-recall.js:49`. **Not user-scoped. Must not be used for a member's run.** |
| `applyDHTP`, `selectPreset` | `lib/dhtp.js:288`, `:72` | working | pure functions, safe to reuse |

### 3f. F0 gates

`lib/auth-gate/evaluate.js` runs sovereignty, capability, refusal, provenance, expiration, preconditions, idempotency, resource, rollback, in that order. Live `gates_run` shows all nine.

- Mode: `lib/auth-gate/policy.js:25` defaults to `observe`. It enforces only when `CONCORD_AUTH_GATE_MODE=enforce`, or for autonomous roles and sources when that flag is on. Live: `observe`.
- In observe mode a deny becomes `OBSERVE` and the tool still runs (`dispatch.js:278-294`).
- Live oddity: the F0 envelope says `decision: "ALLOW", reason_code: "allowed_and_verified"` while the tool result inside is `ok: false, reason: "scope_denied"`. The verification gate returned `no_verification_required`. "Verified" here does not mean the tool worked.
- Idempotency gate: in-memory, 60 s, keyed on a hash of tool, args and scope plus the trace id. It has no caller-supplied key and does not survive a restart. `runLensActionMcp` echoes `idempotency_key` and does nothing with it (`mcp-execution-bridge.js:251`).

### 3g. Receipts and verification

| Piece | Path | Status |
|---|---|---|
| `attestReceipt`, `verifyAttestation` | `lib/receipts/attest.js:214`, `:268` | working; Ed25519 over `sorted-json-v1`; returns an unsigned block with a reason when no key is loaded |
| Public keys | `routes/receipts.js` | working |
| Recipe verify | `lib/chat/tool-recipes/verify.js:120`, `:129` | working; independent recompute and reference match |
| `verifyClaim` | `lib/reason-verify.js:59` | working; citation resolution is deterministic and owner-scoped, then council and proof |
| Numeric trace | `lib/chat/numeric-trace.js:68` | working; flags numbers with units that no tool produced |
| Stub detection | `lib/detectors/macro-stub-detector.js:210` `classifyHandlerBody` | working as a static detector; nothing checks results at run time |

### 3h. Planners and workflows

| Piece | Path | What it is | Reuse verdict |
|---|---|---|---|
| Marathon | `lib/agent-marathon.js` | Long session; ticks loop 1 for 5 turns | keep; later starts a cockpit run |
| Tick durability | `lib/marathon-tick-durability.js:79,120,145` | Write-ahead row per tool dispatch, `findStuckDispatches` | **reuse as is** for the dispatch log |
| Long task | `lib/long-task.js` | Start, pump, status, deliver result into chat | **reuse** delivery and status wording |
| Replanner | `lib/marathon-replanner.js:113` | Replan on a marker or interval | reuse the trigger idea, not the marker |
| Long-horizon planner | `lib/long-horizon-planner.js` | Milestones and contingencies in tables | not needed for v1 |
| Mission planner | `lib/mission-planner.js:26,65` | Deterministic template plan; parses an LLM plan against an allowed-tool list | **reuse `parseLLMPlan` pattern** |
| Mission runtime | `lib/mission-runtime.js` | Durable operator missions through `dispatchMCP` | leave alone; operator-scoped |
| Execution ledger | `lib/runtime/execution-ledger.js:59,68,81` | observed / modified / attempted / verified per step; `compactLedgerForContext`; `failureSignature` | **reuse** for the typed prior-results summary |
| Recovery | `lib/runtime/recovery.js:77` `diagnoseFailure` | Classifies mission failures | read for classes; mission-shaped |
| Critic | `lib/runtime/critic.js:9` `classifyExecutionResult` | ok / partial / failed | reuse in the verifier |
| Macro DAG | `lib/macro-dag.js:24,112` | Validates and runs a dependency graph of macros | **reuse `validateDag`** for `depends_on` |
| Recipes | `lib/chat/tool-recipes/` | Six tested multi-step calculations | reuse as plan templates and fallbacks |
| Agent runtime | `lib/agent-runtime.js` | Contract for emergent agents | not on the user path |

### 3i. Models and routing

- `brainChat` (`lib/byo-router.js:115`) picks: private mode to local Ollama; BYO key; platform provider unless the slot is pinned local; free cloud; local Ollama.
- `ollamaChat` (`lib/inference/ollama-client.js:31`) passes `tools`, `format`, `think`, `num_ctx`.
- `lib/ollama-request-guard.js:47` handles the gpt-oss family, which ignores `think: false`.
- `lib/runtime/model-router.js:86` routes by task class for missions.
- Loop 1 uses slot `conscious` unless the caller passes one (`chat-agent.js:2602`).
- Local Ollama on the Mac (`/api/tags`): `qwen3.5:2b`, `concord-utility-2b:latest`, `concord-conscious-9b:latest`, `concord-conscious:latest`, and five cloud tags including `gpt-oss:20b-cloud` and `gpt-oss:120b-cloud`. `concord-core-v6` was **not** in the list on port 11434 or 11480, although `~/.zuko/CONCORD_2B.md` names it as the keeper. The desk must load it before the live 2B run.
- Which model each surface used live was not measured, because that needs a chat turn, which writes rows. The plan's telemetry ticket records provider and model per step.

### 3j. Streaming

- `lib/chat/progress.js:32,39`: real progress events for `/api/chat/stream` (`routes/chat.js:286`). No timers.
- `routes/chat-agent-stream.js:165-176`: SSE `status`, `tool_call`, `artifact`, `token`, `done`. `tool_call` carries the raw tool result, raw tool names included.
- `lib/chat/tool-result-events.js:56`: socket `chat:tool_result` payloads.
- `TOOL_NAME_SCRUB` (`lib/chat/tool-turn-reply.js:42`) removes six tool identifiers from saved replies.

### 3k. Limits

| Limit | Path | Scope |
|---|---|---|
| Agent turns, calls, tokens | `lib/chat-reply-policy.js:105-133` | per agent invocation |
| MCP concurrency | `lib/mcp-call-guard.js:49` | process-wide, 503 `busy_retry` |
| Admission | `lib/request-admission.js` | sheds on sustained event-loop lag |
| Macro quota | `lib/macro-quota.js:65` | per user per macro |
| BYO key rate | `lib/byo-rate-limit.js:170` | per user per slot |
| Socket | `lib/socket-rate-limit.js:27` | per user |
| Job tracker | `lib/loop-job-tracker.js:50` | names what is on the loop |
| GB-1498 | not built | 100 calls/hour and 20 heavy/hour per account |

## 4. October 19 audit, item by item

| # | Finding then | Now | Evidence |
|---|---|---|---|
| 1 | Loop ends after one non-retryable failure | **partial** | Loop 1 has 2 recovery turns (`chat-agent.js:2504`, `:2872`). Loop 2 still stops (`server.js:31072`). After the recoveries are spent, loop 1 stops too |
| 2 | "Yes run it" fell to the CSL gate | **fixed in code, not checked live** | `agent-route.js:174-266`. The match is a regex over the previous reply's text (`OFFER_RE`), with no stored pending action. A live check needs a chat turn |
| 3 | No 3D or CAD continuation | **partial** | `generate_3d` case at `chat-agent.js:1784`, `WANTS_3D_RE` at `:865`. Part lexicon size not re-measured |
| 4 | `run_compute` failed on invented keys with no key list | **fixed** | `chat-agent.js:984-1004`: falls back to `symbolic.evaluate`, else returns `validKeys` and `closestKeys` |
| 5 | `run_python` advertised while disabled | **fixed** | `chat-agent.js:409-425`, applied at `:2546` |
| 6 | Stale DTU hit made `dtu.get` fail | **partial** | `lib/chat/dtu-get-fallthrough.js` exists; "not found" is now a recoverable class. The stale index itself was not re-checked |
| 7 | "use websearch" missed the router; model claimed a tool it never ran | **fixed for routing, partial for claims** | `agent-route.js:52`. `guardPlaybackClaim` covers audio claims only |
| 8 | Embeddings boot probe used the wrong model | **fixed** | `server.js:20370-20375` |

## 5. Owned FIX tickets: root cause

Rows are from `audit/fix-list/fix_tickets.jsonl` at `origin/fix/audit-sweep-20261110`, folded per id.

| Ticket | Symptom | Root cause | Confidence |
|---|---|---|---|
| FIX-crisis-ops-001 | Ask fails: scope `mcp:lens:read` required | Finding 3 | confirmed live and in code |
| FIX-meditation-002, FIX-wellness-004 (agent part), FIX-reasoning-002 (agent part) | "Agent returned empty." | Finding 9 | confirmed in code |
| FIX-agents-010 | Run Loop ignores the goal; tool-less agent still uses tools | Loop 4 builds steps from its own catalogue, not the goal | read in part; *guess* on the exact line |
| FIX-chat-001 | Reply not rendered live in the open transcript | Frontend transcript state; server completes the reply | not root-caused; Muse's note says "append the completed reply onto the open thread" |
| FIX-chat-014 | Thread Summarize shows nothing | not root-caused | *guess*: result field not rendered |
| FIX-quests-005, FIX-world-005 | Ask reuses another lens's thread or drops the question | Thread identity. Muse's `RCA-ask-silent` fix (545ed1873) changes this | depends on Muse |
| FIX-analytics-005, FIX-lattice-004, FIX-narrative-walk-006, FIX-frontier-005, FIX-concord-link-frontier-009, FIX-government-023, FIX-healthcare-005 | Ask answers about the wrong thing or cannot see lens state | `?context=<lens>` passes a name only. No lens description or live lens data reaches the model | confirmed by reading `LensToolbar.tsx:90` and `ChatWorkspacePanel.tsx:555`; server side read in part |
| FIX-forecast-001 | Whole question parsed as a place name | A deterministic route takes the weather slot from the raw sentence | *guess* at the file: `lib/chat/weather-location.js` |
| FIX-goddess-001 | No answer in 90 s | not root-caused | unknown |
| FIX-lfg-001 | Tab crashes | not root-caused. The 2.4 MB tools payload is not it: nothing in the frontend fetches `/api/chat/tools` | unknown |
| FIX-tick-005, FIX-inheritance-011 | First Ask aborts or crashes, retry works | not root-caused; client timeout is 120 s (`lib/api/client.ts:66`) | unknown |

Four tickets have no root cause. The plan gives each a fixed diagnosis procedure and a defined end state, so the builder does not have to guess.

**Adjacent, not owned, but in the way:** FIX-reasoning-001, FIX-council-006, FIX-marketing-008, FIX-hvac-012, FIX-masonry-012 (`/api/lens/run` 400 and 422). A step that calls one of those actions will fail the same way. The plan's failure taxonomy counts them as `bad_args` or `tool_error` and the run continues, but they are real dependencies for any scenario that uses those lenses.

## 6. Failure taxonomy

Sources: `agent_action_log` for 24 hours on 2026-10-18/19 (268 tool calls, from the October audit), the full chat-harness run of 2026-10-29 (249 cases), the tool sweep of 2026-10-26 (195 actions), and the live probes above. Fresh action-log counts were not available (finding 10).

| Class | Count and source | Root cause | Layer that removes it |
|---|---|---|---|
| `bad_args` (missing or invented argument, wrong key) | 11 of 268 in the action log (10 `run_compute`, 1 `web_search`); 65 of 195 needs-args in the sweep | Model writes free-form arguments against a prose schema | constrained call, validation and repair, hint defaults |
| `unsupported_input` (part or id the tool does not handle) | 5 of 7 `conkay_design` calls | Tool lexicon smaller than the request | alternate tool or recipe, then ask the user |
| `not_found` (stale id, missing prerequisite record) | 1 in the action log; 63 of 195 in the sweep (`project_not_found`, `artwork not found`, and others) | A step used an id that no earlier step produced | plan dependencies, typed prior results, probe-before-act |
| `external` (HTTP 403/404, upstream down) | 6 of 20 `browse_url` | Invented or dead URL | retry with backoff, then alternate source |
| `disabled_tool` | 3 of 6 `run_python` | Tool offered but switched off | tool menu built from what the caller can run |
| `tool_error` (handler threw) | 14 of 249 harness cases; 24 of 195 in the sweep | Handler bug | retry once, alternate tool, record for the repair cortex |
| `scope_denied` | 4 of 4 bridge probes as a member | Session scopes read as API-key scopes | GB-1498 scope mapping on the one executor |
| `wrong_tool` | 1 of 249 | Too many tools to choose from | per-step menu |
| `untraced_number` | 3 of 289 across two harness runs | Model states a number no tool produced | verifier |
| `hallucinated_citation` | 1 of 249 | Model cites a DTU it never retrieved | verifier |
| `claimed_not_called` | 2 turns in the October session | Model says it ran a tool and did not | server-owned plan: a step is done only when the executor says so |
| `fake_success` | 2 of 195 in the sweep | Stub handler returns ok | verifier stub check |
| `timeout` | 3 of 195 in the sweep | Slow handler or model | per-step wall time, retry, slot change |
| `looped` | 0 observed | n/a | repeat detection in the run engine |
| `hard_stop` (governance, auth, money, consent) | not counted | policy | stops the run and says why |

Two gaps in this data, stated plainly: it has no 2B runs, and it has no task longer than one chat turn. The plan's last tickets produce both.
