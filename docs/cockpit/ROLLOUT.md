# Default-on plan for the cockpit flags

Flags go on one at a time, each only after the one before has run for the stated time with the stated measure. Dutch turns each one on; no ticket changes a default.

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

`CONCORD_COCKPIT_CONSTRAINED` and `CONCORD_COCKPIT_STRIP_APPROVAL` are on by default and stay on.

## Never set in production

| Variable | Refused in production by |
|---|---|
| `CONCORD_COCKPIT_MOCK_MODEL` | `server/tests/cockpit/step-llm.test.js` ("mock model refused in production") |
| `CONCORD_COCKPIT_DESK_FIXTURE` | `server/tests/cockpit/desk-script.test.js` (the fixture seam and the POST /runs `steps` body are ignored when `NODE_ENV=production`) |
| `CONCORD_COCKPIT_DESK_SLOW_TOOL` | `server/tests/cockpit/desk-script.test.js` (the slow-tool seam does nothing in production) |

## What "done" means for GB-1500

Steps 1 to 8 on, the desk table passing (`DESK_RESULTS.md`), and each FIX id in `PLAN.md` section 4 "Owned" marked fixed or handed back in `audit/fix-list/FIX_PROGRESS.md`.
