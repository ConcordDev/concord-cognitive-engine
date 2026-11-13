# Desk runbook: the 32-step scenario on a real 2B (CKPT-22)

This is run by Dutch, or a seat Dutch names on the bridge. It is the one place in GB-1500 that runs a server on the Mac. Read section 1 first.

## 1. Before you start

- Nothing else heavy is running. Unity is closed. Check free memory (`vm_stat`, Activity Monitor) and free disk (`df -h /`).
- If the live stack is up (the normal case), use a pod, or stop here and ask Dutch. A second server beside the live stack has swapped the 16 GB Mac before.
- Do not start `next dev`. The scenario needs only the backend.

## 2. Start a separate backend

Its own port and its own database file. Never `server/data/concord.db`.

```
cd server
DB_PATH=$(mktemp -t cockpit-desk).db PORT=5055 \
CONCORD_COCKPIT_RUNS=1 CONCORD_COCKPIT_REPAIR=1 CONCORD_COCKPIT_RETRY=1 CONCORD_COCKPIT_MENU=1 \
CONCORD_COCKPIT_DESK_FIXTURE=1 CONCORD_COCKPIT_DESK_SLOW_TOOL=web_search \
node server.js
```

Point it at the local 2B (see `backend_brain_routing` in the memory index: the local Ollama is on :11480 and is 2B only). `CONCORD_COCKPIT_DESK_SLOW_TOOL=web_search` is what induces the timeout.

## 3. Which model

`defaultProfile()` must be `local-2b`. Record the exact model tag from `GET /api/admin/brain-endpoints`.

## 4. Sign in

Use the `claude_design` test account in a browser against the scenario server (never a real person's account). Copy the session cookie into `COCKPIT_DESK_COOKIE` for that shell only:

```
export COCKPIT_DESK_COOKIE='<name>=<value>'
```

## 5. Run

```
node server/scripts/cockpit-desk-scenario.mjs --base http://127.0.0.1:5055 --dry-run
node server/scripts/cockpit-desk-scenario.mjs --base http://127.0.0.1:5055 --plan-fixture
```

`--plan-fixture` keeps the 32-step plan fixed so the measure is execution. A second run without it is recorded separately as "planner on". `--induce none` runs the clean plan.

## 6. At each prompt

- A confirm prompt shows the step label. Type `y` to approve, `n` to reject. Approving is a real decision; the script never approves for you. Each prompt is one human intervention.
- After you approve the second confirm (step 30, the final save) the script prints `RESTART NOW`. Stop and start only the scenario server (same command as section 2, same `DB_PATH`), then press Enter. Never restart the live stack.
- The script then polls every 5 seconds for up to 45 minutes in total.

## 7. Afterwards

Stop the scenario server. Delete the temp database file. `unset COCKPIT_DESK_COOKIE`. Commit `docs/cockpit/DESK_RESULTS.md` with the measured numbers. A failing measure becomes a new bridge ticket naming the step and the failure class; it is not edited into a pass.

## 8. If the Mac starts to swap

Stop the scenario server first, then ask why.
