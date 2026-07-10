# Platform — capability map (Wave 2 batch 7, Docs/B2B SaaS archetype)

## What "platform" means here

Read the domain file first, per the rebuild loop's guidance: `server/domains/
platform.js` is explicitly a **platform-ops/infrastructure console**, not a
generic SaaS concept — its own header comment calls it "a Vercel/Heroku-style
platform console: deployment pipeline, live resource metrics, environment/
config management, domain routing, alerting, cost/usage, and an audit log"
plus four platform-engineering analysis functions (SLA, capacity planning,
incident timeline, service-dependency mapping). The lens also legitimately
absorbs several *other* real Concord subsystems under a shared "platform ops"
identity (autogen pipeline, "nerve center" beacon/strategy/hypothesis,
empirical/units engine, DTU scope promotion) — this is deliberate composition
in the same spirit as the `CONCORD_DESTINATIONS.md` pattern, not scope creep.

## Parity target

Reference apps: **Vercel dashboard** (deploys, env vars, domains, usage) +
**Datadog/PagerDuty** (SLA/error-budget, incident timeline, dependency/service
map). "The only difference should be scale of the underlying infrastructure,
nothing else."

## Backend macro surface

### Console macros (16 — `server/domains/platform.js`)
`deploy-create/list/logs/rollback`, `metrics-history`, `env-set/list/delete`,
`domain-attach/list/verify/remove`, `alert-channel-set/create/list/delete`,
`usage-summary`, `audit-list`. **ALREADY REAL, all 16 designed** —
`components/platform/PlatformConsole.tsx` (630 LOC) covers every one with
bespoke forms/lists per sub-surface (Deploy/Env/Domains/Alerts/Usage/Audit),
confirmed by grep against the macro registrations.

### Absorbed platform-ops surfaces (real, different backend endpoints, ALREADY REAL/designed)
- Pipeline tab → `PipelineMonitor.tsx` → `apiHelpers.pipeline.*` / `apiHelpers.bridge.dedupScan`
- Nerve Center tab → `NerveCenter.tsx` → `apiHelpers.bridge.*` / `apiHelpers.scope.metrics` / `apiHelpers.hypothesis.status` / `apiHelpers.metalearning.status`
- Empirical tab → `EmpiricalGatesPanel.tsx` → `apiHelpers.empirical.*` (math CAS, unit conversion, text scan)
- Scopes tab → `ScopeControls.tsx` → `apiHelpers.scope.*` / `apiHelpers.dtus.list`
- Live Events tab → `usePlatformEvents` realtime hook, filterable by event type

### Platform-engineering analysis macros (4 — the real gap)
| Macro | Shape | Disposition before | Disposition after |
|---|---|---|---|
| `slaCompute` | uptime/error-budget/MTTR/MTBF from `{incidents[], period, target}` | **BACKEND-CAPABLE-BUT-UNSURFACED via a disconnected generic artifact store** — the old "Backend Action Panel" fed these off `useLensData('platform','service')`, a *different, unrelated* generic CRUD collection with no UI to ever populate it. Every click hit "No platform service data found. Add service data first." with no path to add one. | wired: `PlatformAnalysisPanel` "Incidents & SLA" tab — a real incident log (service/severity/start/end) feeds this directly via `lensRun` |
| `capacityPlan` | linear-regression forecast + threshold-crossing days from `{metrics[]}` | same disconnected-store dead end | wired: "Capacity Plan" tab — a resource-sample editor (cpu/memory/disk/connections per day) |
| `incidentTimeline` | phase/cascade/correlation analysis from `{events[]}` | same dead end | wired: same "Incidents & SLA" tab reuses the incident log to derive `alert`/`resolution` events — one form, two real analyses |
| `dependencyMap` | SPOF/blast-radius/circular-dependency analysis from `{services[]}` | same dead end | wired: "Dependency Map" tab — a service+dependency graph editor |

## What was genuinely wrong

The four platform-engineering macros are real (Erlang-budget math, OLS
regression, topological/cascade analysis over ~400 LOC combined) but were fed
through `useLensData`/`useRunArtifact` — the generic cross-lens artifact CRUD
system — targeting an artifact **type that has no creation UI anywhere in
this lens** (`service`). Every "Compute" click was a guaranteed dead end for
every real user; the panel could never do anything but show its own empty-
state message. This is the same disconnected-generic-CRUD-store defect class
called out repeatedly this wave (mentorship's fake match badge, supplychain's
fabricated CRUD, fork's `forkHealth` fabricated-from-defaults score).

## Fix

New `components/platform/PlatformAnalysisPanel.tsx`, mounted as a new
"Analysis" tab (keyboard shortcut `g`) replacing the dead action bar. Three
small purpose-built forms (incident log, resource-sample list, service+
dependency graph) call the four macros directly via `lensRun`, matching the
established "small purpose-built input forms, not a raw JSON-paste box"
pattern from the prior batch's `metalearning`/`anon`/`fork` fixes. The generic
capability-list collapsible section was also removed as redundant.

## Verify gate

- `npx eslint`: clean.
- `npx tsc --noEmit -p .`: 0 errors in `platform`-scoped files (unrelated
  transient errors in sibling agents' concurrently in-flight
  `export/legacy/audit/schema/projects` lenses in this shared worktree,
  confirmed via `git status`).
- `node scripts/verify-lens-backends.mjs`: `platform` stays WIRED; total
  unchanged at 258 WIRED / 2 NO-BACKEND-CALL.
- `node scripts/grade-ux-polish.mjs --honest`: `platform` → `tier: "polished"`,
  `isGenericScaffold: false` (was `functional`/`true` before this pass).
- No dedicated `platform` lens vitest file exists; backend coverage lives in
  `server/tests/platform-domain-parity.test.js` and
  `server/tests/depth/platform-behavior.test.js`.
