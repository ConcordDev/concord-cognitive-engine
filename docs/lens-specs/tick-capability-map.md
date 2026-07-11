# Tick Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("tick"' server/domains/tick.js` → 12

## What this lens is

`/lenses/tick` is the frontend surface for the governor heartbeat/tick
substrate CLAUDE.md's "Heartbeat tick (every 15s)" section describes:
`governorTick()` → `tickAllRegistered()` (`server/emergent/heartbeat-registry.js`)
dispatching 127+ registered heartbeat modules. The lens is a Datadog /
Better Uptime -style monitor for that substrate, not a per-user simulation
view — a heartbeat module is a single server-wide singleton.

## Backend surface (`server/domains/tick.js`)

12 macros in two groups:

**Pure-compute (pre-existing, general-purpose signal-processing library, not
tick-substrate-specific):** `healthPulse` (heartbeat regularity/jitter/dead-
component detection over caller-supplied tick data), `loadPredict`
(EMA/Holt's-method forecasting + capacity planning), `rhythmAnalysis` (DFT
periodogram, dominant-frequency + phase-drift detection). These operate on
data the *caller* supplies (`artifact.data.ticks` / `.loadHistory` /
`.timeSeries`) — they're generic time-series tools the page also exposes as
a manual "Tick Actions" panel (Health Pulse / Load Predict / Rhythm
Analysis buttons) over the lens's own `useLensData`/`useRunArtifact` items.

**Heartbeat-monitor substrate (Datadog/Better-Uptime parity, this wave's
focus):** `recordSample`, `heartbeatList`, `skipReport`, `alerts`,
`stream`, `latencyHistogram`, `heartbeatControl`, `uptimeSLA`,
`heartbeatRegistry`. These compute over real, persisted per-user tick-
sample history (`STATE.tickLens`) fed by the frontend polling
`/api/heartbeat/history` + `/api/perf/metrics` and the live
`listHeartbeatModules()` registry — no synthetic data.

## Macro classification

| Macro | Class | Notes |
|---|---|---|
| `healthPulse` | DESIGNED | Tick Actions panel, real formula (regularity/jitter/dead-detection), pinned by `tick-domain-parity.test.js`. |
| `loadPredict` | DESIGNED | Tick Actions panel, Holt's-method EMA forecast + capacity projection. |
| `rhythmAnalysis` | DESIGNED | Tick Actions panel, real DFT periodogram. |
| `recordSample` | DESIGNED (internal) | Driven by `MonitorPanel`'s effect loop off real `/api/heartbeat/history` deltas — not user-facing directly. |
| `heartbeatRegistry` | DESIGNED | `MonitorPanel` Heartbeats tab — the live registered-module list. |
| `heartbeatList` | DESIGNED | `MonitorPanel` Heartbeats tab — per-module derived status (healthy/stale/erroring/paused). |
| `skipReport` | DESIGNED | `MonitorPanel` Overview tab — skip/overrun bar chart. |
| `alerts` | DESIGNED | `MonitorPanel` Alerts tab — list/ack/clear/config. |
| `stream` | DESIGNED | `MonitorPanel` Overview tab — tick-rate/latency line chart, time-range selector. |
| `latencyHistogram` | DESIGNED | `MonitorPanel` Latency tab — governorTick duration histogram + percentiles. |
| `uptimeSLA` | DESIGNED | `MonitorPanel` SLA tab — 1h/6h/24h uptime windows vs. 99.9% target. |
| `heartbeatControl` | DESIGNED (fixed this wave) | `MonitorPanel` Heartbeats tab pause/resume/trigger buttons — see defect below. |

No GENERIC-STRIP-ONLY or UNSURFACED macros. `ManifestActionBar` +
`RecentMineCard` + `AutoActionStrip` + `LensFeaturePanel` are present
(codemod-mounted floor), but the page has two large bespoke components
(`MonitorPanel` 745 LOC, `TickRate` 46 LOC) plus bespoke canvases
(`HeartbeatLineCanvas`, `EventTimelineCanvas`, `HeartbeatPulse`) —
`bespokeComponentLoc` 836 of 2,014 total — so the generic floor doesn't
read as the page's substance. Grader confirms `isGenericScaffold: false`.

## Defect found and fixed: `heartbeatControl` was fabricated success

`tick.heartbeatControl` (pause/resume/trigger, backing `MonitorPanel`'s
Heartbeats-tab control buttons) recorded operator intent into the tick
lens's own per-user bookkeeping (`STATE.tickLens.controls`) and returned
`ok:true`, but **never touched the real dispatcher**. The actual governor
loop (`tickAllRegistered` in `server/emergent/heartbeat-registry.js`) skips
a module only when its id is in `STATE.settings.disabledHeartbeats` — a
completely different array `heartbeatControl` never wrote to. Clicking
"Pause" showed the module as paused in the monitor UI while the real
heartbeat kept firing every governor tick; "trigger" incremented a
`triggerRequests` counter nobody ever read, so a manual trigger request did
nothing. This is exactly the "honest by construction" failure mode CLAUDE.md
calls out — a control that visibly claims a real effect while doing
nothing.

Two more issues surfaced auditing the fix: (1) a heartbeat module is a
single server-wide singleton, not per-user state — once wired to real
effect, pause/resume/trigger are **global, high-privilege actions**
reachable by any authenticated caller through the undifferentiated
`/api/lens/run` path, with zero role check; (2) there was no validation
that `moduleId` was even a real registered module, so a typo would still
return a fabricated success.

**Fix (`server/domains/tick.js`, `server/emergent/heartbeat-registry.js`):**
- `heartbeatControl` is now admin-only, gated in-handler off
  `ctx.actor.role` (`admin`/`owner`/`founder`) — the same in-handler
  pattern `announcements.post` uses, so the macro path carries the same
  authority a dedicated admin route would.
- `moduleId` is validated against the live `listHeartbeatModules()`
  registry (`unknown_heartbeat_module` if absent); a `neverDisable` module
  refuses `pause` (`module_never_disable`) — matching the dispatcher's own
  refusal to honour a disable for those modules.
- `pause`/`resume` now mutate `STATE.settings.disabledHeartbeats` — the
  exact set `tickAllRegistered` reads — so it is a real, immediate kill
  switch on the next governor tick, not cosmetic state.
- `trigger` now calls a new export, `runHeartbeatModuleNow(id, {state, db,
  reason})` (`server/emergent/heartbeat-registry.js`), which looks up the
  registered entry and reuses the existing `_runOne` (same timeout /
  try-catch / metrics machinery a normal tick dispatch gets) to actually
  run the module immediately, out-of-band from the tick clock.
- Frontend (`MonitorPanel.tsx`): reads `useAuth().role`; non-admin viewers
  get a read-only heartbeats table (dimmed controls + an explicit "admin-
  only" notice) instead of buttons that would silently no-op on the
  backend's `admin_only` rejection. A failed control action now surfaces
  an honest inline reason (`admin_only`, `module_never_disable`,
  `unknown_heartbeat_module`, `trigger_failed`) instead of just staying
  silent.

## Verification

- `node --check server/domains/tick.js server/emergent/heartbeat-registry.js` — clean.
- `cd server && node --test tests/tick-domain-parity.test.js tests/heartbeat-manual-trigger.test.js` — 51/51 pass (36 in the updated parity file incl. 8 rewritten/new `heartbeatControl` cases pinning admin-gating + real dispatcher-effect; 4 new in the added `heartbeat-manual-trigger.test.js` for `runHeartbeatModuleNow`).
- `cd server && node --test tests/invariants/heartbeat-tick-side-effects.test.js tests/governor-tick-isolation.test.js` — 10/10 pass (untouched dispatcher-level invariants still hold).
- `npx eslint concord-frontend/components/tick/MonitorPanel.tsx` — clean.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (unchanged).
- `node scripts/grade-ux-polish.mjs --honest` — `tick`: `tier: "polished"`, `isGenericScaffold: false`.
