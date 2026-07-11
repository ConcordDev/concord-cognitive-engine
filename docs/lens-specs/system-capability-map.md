# system — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("system"' server/domains/system.js` → 14
> (plus the disjoint cognitive-OS introspection set registered inline in
> `server/server.js`: `analogize`, `autogen`, `cartograph`, `continuity`,
> `dream`, `evolution`, `status`, `synthesize`, `promotionTick`, `gapScan` —
> not part of this lens's live-observability surface, name-collision-free by
> design per `server/domains/system.js`'s own header comment).

## Reference app + parity target

**Grafana + Datadog** — the System Lens is explicitly the "Datadog /
Grafana of the platform itself" (per `server/domains/system.js`'s header
comment): live process time-series, Prometheus alert evaluation, a log
search UI, per-heartbeat health, distributed-trace/latency percentiles, a
customizable dashboard grid, and a coverage/drift trend timeline — on top
of a cartographer-driven "software universe" inventory (tables/routes/
macros/heartbeats/lenses/coverage/drift) that has no real external analogue
(closest cousin: a monorepo's own internal architecture dashboard).

## `node scripts/lens-unsurfaced.mjs --lens system`

```
system: 0/14 macros never referenced in the frontend
```

All 14 telemetry macros (`sample`, `metrics`, `alerts`, `alert-ack`, `logs`,
`heartbeat-health`, `trace-record`, `traces`, `dashboard-load`,
`dashboard-save`, `dashboard-reset`, `history-snapshot`, `history`,
`live-status`) are DESIGNED — each has a dedicated bespoke panel
(`MetricsPanel`, `AlertsPanel`, `LogViewer`, `HeartbeatHealthPanel`,
`TracesPanel`, `CustomDashboard`, `TrendPanel`) or drives the shared
`useLiveStatus` poll loop that stamps the header strip + tab badges. None
are reached through a generic macro-button wall.

## Findings

This wave's prompt specifically flagged `/api/system/health` as a repeat
offender — two other lenses (`resonance`, `meta`) this session independently
found the same envelope-shape bug against this exact route. `system` reads
that route too (`SystemHealthPanel`, mounted at the foot of the page), and
it had the same defect class, plus a second, unrelated field-shape bug in a
component shared with two other lenses.

### `SystemHealthPanel.tsx` — FIELD-SHAPE MISMATCH (fixed)

The real handler (`server.js` `app.get("/api/system/health", ...)`) returns:

```js
{ ok: true, health: { status, uptime, dtuCount, sessionCount, brains, memory: { rss, heap }, postgres, redis, saveFailures, growth: {...} } }
```

The component read a flat, un-nested `Health` interface —
`status`/`uptimeSec`/`memoryMB`/`dtuCount`/`activeUsers`/`heartbeatsOk` —
directly off `r.data`. Every one of those names is either (a) nested one
level too deep (`status`, `uptime`, `memory`, `dtuCount` all live under
`.health`, not at the top level) or (b) doesn't exist on the wire at all
(`uptimeSec` — the real field is `uptime`; `memoryMB` — the real field is
`memory.rss` in bytes; `activeUsers` — the real field is `sessionCount`;
`heartbeatsOk` — never returned by this endpoint at all). Net effect: every
stat in the "Concord system status" card silently rendered `—` forever,
with no error (the fetch succeeds, `r.data.status` etc. are just always
`undefined`) — the "looks like nothing's wrong, but shows nothing real"
defect class.

**Fix:** unwrap `r.data.health`; rename fields to match the real handler
(`uptime`, `memory.rss` → computed `memoryMB`, `sessionCount`); relabel
"Active users" → "Sessions" (honest to what the endpoint actually measures
— session count, not a distinct active-user metric); replace the
always-`undefined` "Heartbeats" stat (which duplicated data the dedicated
Heartbeat Health tab already gets correctly from `system.heartbeat-health`)
with "Storage" derived from the real `postgres.connected`/`redis.connected`
fields. `status === 'operational'` (the real value the handler returns) now
also renders green, not amber.

### `DomainProbeCard.tsx` — FIELD-SHAPE MISMATCH (fixed, shared component)

`DomainProbeCard` (mounted by this lens's "Substrate" tab via
`probesByGroup('substrate')`, and also by `productivity`, `dtus`, and
`settings`) drives a generic `runDomain(domain, macro, input)` probe against
~24 previously-headless backend domains and renders a one-line summary via
`probe.summarise(response)`.

`apiHelpers.lens.runDomain` resolves to the **raw axios response** (a
`{data, status, statusText, headers, config}` object) — every other caller
in the codebase (`lensRun`, the page's own `cartograph` query) explicitly
unwraps `.data` before reading the macro's own `{ok, result}` envelope.
`DomainProbeCard`'s `queryFn` returned the axios response directly, so
`probe.summarise` was handed the axios wrapper, not the macro payload.
Concretely: `summariseStatus()` checks `o.ok` (boolean), `o.status`
(string), `o.state` (string) in order — on an axios response, `.ok` doesn't
exist, `.status` exists but is a **number** (the HTTP status code, e.g.
`200`), so the `typeof === 'string'` check fails, `.state` doesn't exist —
every check falls through to `Object.keys(o).length` fields, which is a
near-constant 5–6 (the fixed axios response shape) **regardless of what the
macro actually returned**. Same failure mode in `summariseList()`. Net
effect: all ~24 probe cards in the Substrate tab (and the same cards on
`productivity`/`dtus`/`settings`) showed a fixed, meaningless "N fields"
instead of the real health verdict or entry count — and a genuinely
unregistered macro (`unknown_macro`, `ok:false`) rendered as a normal-
looking summary instead of the honest failure it should show.

**Fix:** `queryFn` now returns `r.data` (the `{ok, result, error?, reason?}`
envelope); `probe.summarise` is called with `data?.result` (the macro's own
payload); an `envelopeFailed` check (`data.ok === false`) now surfaces
`unknown_macro`/other envelope errors as the card's `error` status tone
instead of a false "ok".

## Left alone (already real)

The `system.cartograph` macro (backs the Overview/Heartbeats/Gaps/
Coverage/Drift tabs) was checked field-by-field against the live
`audit/cartograph/SYSTEMS.json` shape (`coverage`, `crossRef`, `drift`,
`runtime`, `static`, `stats` top-level keys; `stats.{tableCount,
routeCount, macroCount, macroDomainCount, heartbeatCount, lensCount,
moduleCount, deadTableCount, orphanModuleCount, dormantModuleCount,
coverageInScope, coveragePresent}`; `crossRef.{deadTables, dormantModules,
headlessBackends, orphanLenses, ...}`) — matches exactly, no bug.
`useLiveStatus` (`system.live-status`) and every other telemetry macro
(`metrics`, `alerts`/`alert-ack`, `logs`, `heartbeat-health`, `traces`/
`trace-record`, `dashboard-load`/`-save`/`-reset`, `history`/
`history-snapshot`) were each checked against their real
`server/domains/system.js` handler and their consuming panel
(`MetricsPanel`, `AlertsPanel`, `LogViewer`, `HeartbeatHealthPanel`,
`TracesPanel`, `CustomDashboard`, `TrendPanel`) — every field name matches
exactly; these panels are genuinely wired, not scaffold. The Analytics and
Plugins tabs (absorbed `AnalyticsDashboard`/`LensPluginSystem` components)
correctly source from `/api/analytics` and `/api/plugins` respectively with
defensive empty-array fallbacks — no fabrication found.

## Genuinely missing (deferred)

None found this pass. The lens's own Coverage/Gaps/Drift tabs are
themselves the platform's live "what's missing" surface — recursively
honest about the rest of the codebase, which is the lens's actual job.

## Verification

- `node --check server/domains/system.js` — no backend file touched, N/A.
- `npx eslint components/system/SystemHealthPanel.tsx components/system/DomainProbeCard.tsx` — clean, 0 errors/warnings.
- `npx vitest run tests/system-lens-states.test.tsx` — 4/4 passing.
- `node --test tests/system-cartograph-macro.test.js tests/system-domain-macros.test.js tests/system-domain-parity.test.js tests/system-routes-health-dedup.test.js` (server/) — 46/46 passing, 0 fail.
- `node scripts/lens-unsurfaced.mjs --lens system` — `0/14` (unchanged; no macro surfacing changed, this was a correctness fix).
- `node scripts/verify-lens-backends.mjs` — system stays WIRED; total unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — system: `tier: "polished"`, `isGenericScaffold: false` (unchanged).
