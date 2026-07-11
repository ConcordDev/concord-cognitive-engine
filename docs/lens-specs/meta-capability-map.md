# Meta Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep, a full read of the file it's about, or a
> live boot-and-curl of the running server.

## What "meta" actually is

Not to be confused with `metacognition` (a separate lens, handled by a
sibling agent in parallel) or `metalearning`. This lens is Concord's
**self-referential codebase inventory + Backstage-style internal developer
portal** — a tool for browsing/searching Concord's own component graph, and
for service-catalog/dependency-graph/metrics/health/deploy/alert/macro
tooling over the platform itself. The right reference class is an internal
dev portal (Backstage, Sourcegraph code-nav) plus a codebase cartographer,
not a consumer product — "category leadership" here means: does it tell you
the truth about the codebase, fast, without crashing.

## Backend surface

Two independent real backends feed this lens:

1. **`server/lib/codebase-inventory.js`** (mounted at `/api/inventory/*` via
   `server/routes/inventory.js`, `server.js:33463`) — a live filesystem
   scanner (`walkDir` + regex export/import extraction) over
   `concord-frontend/components/`, `concord-frontend/app/lenses/`,
   `server/lib/`, `server/routes/`, 5-minute in-memory TTL cache. Six
   functions: `scanFrontendComponents`, `scanServerLibraries`,
   `scanLensPages`, `findOrphans`, `buildWiringMap`, `searchInventory`, plus
   `getInventorySummary()` rolling all of them up. This is real, computed,
   non-fabricated data — verified live (see Verification) against a running
   server: 2,659 components, 260 lenses, 933 server libs, 422 orphans.
2. **`server/domains/meta.js`** (`grep -c 'registerLensAction("meta"'
   server/domains/meta.js` → **18** macros) — `systemReflection`,
   `actionAnalytics`, `qualityMetrics` (generic artifact-analytics engines:
   percentile/error-trend/capacity-health math, session-segmented action-log
   analytics, completeness/consistency/freshness scoring with exponential
   decay), plus a genuine 2026 developer-portal cluster: `serviceRegister/
   Catalog/Update/Remove`, `dependencyGraph`, `metricRecord/
   metricsDashboard`, `healthRollup`, `deployRecord/Timeline`, `alertRaise/
   Resolve/Surface`, `macroExplorer`, `classify` (an unrelated QuickCapture
   text-router utility, not part of the dev-portal cluster).
3. **`GET /api/system/health`** (`server.js:47636`) — live process vitals:
   `{ok, health: {status, uptime, dtuCount, sessionCount, brains: {mode,
   onlineCount, brains: {name: {enabled, model, role, stats, avgResponseMs}}},
   memory: {rss, heap}, postgres: {connected, status}, redis: {connected,
   status}, saveFailures, growth: {dtusLast24h, dtusLast7d}}}`.

## Frontend surface

`concord-frontend/app/lenses/meta/page.tsx` (1,265 LOC, 8 tabs: Overview,
Dev Portal, Components, Lenses, Orphans, Wiring Map, Search, Lens
Infrastructure) + `concord-frontend/components/meta/{SystemHealth.tsx,
DevPortal.tsx}` (48 + 1,407→1,830 LOC after this pass).

## The defects found — all field-shape mismatches, several were render crashes

None of the data was fabricated. Every defect below is class (b) from the
rebuild-loop taxonomy: the backend computes real numbers, but the frontend
read them under field names that never existed in the response, because the
two sides were written independently and never checked against each other
at runtime. Found by reading `server/lib/codebase-inventory.js` and
`server/routes/inventory.js` line-by-line against every `interface` in
`page.tsx`, then confirmed by booting the server and curling every endpoint.

### 1. Overview tab — crashed on render (the *default* tab)

`OverviewTab` read `f.lines` on each `largestFiles` entry; the real field is
`lineCount`. `{f.lines.toLocaleString()}` with no optional chaining throws
`TypeError: Cannot read properties of undefined` the instant the query
resolves — and `largestFiles` is never empty on this codebase. Since
Overview is `useState<TabKey>('overview')`'s initial value, this fired on
every single page load. Also: `data.mostImported` doesn't exist (the real
key is `mostImportedComponents`, item shape `{path, usedByCount}` not
`{name, importCount}`) — the "Most-Imported Components" section was
permanently empty.

### 2. Components tab — crashed on search, crashed on row-expand, and showed "Orphan" for every single component

- `comp.name` doesn't exist (real field is only `path`) — used in the live
  search filter (`c.name.toLowerCase()`), so typing anything into the
  search box threw immediately.
- `comp.wired` doesn't exist (real field is `isOrphaned`, inverted
  semantics) — always `undefined` → falsy → `WiredBadge` rendered "Orphan"
  for **every** component regardless of truth.
- `comp.importedBy` doesn't exist (real field is `usedByLenses`) — row
  expand read `comp.importedBy.length`, throwing on any click.

### 3. Lenses tab — crashed on row-expand, showed "undefined imports"

- `lens.path` doesn't exist (the backend never computed it).
- `lens.importCount` doesn't exist (real field is the `imports` array
  itself, no precomputed count) — every row's badge literally read
  "undefined imports".
- `lens.routes` doesn't exist (real field is `serverRoutes`) — row expand
  read `lens.routes.length`, throwing on any click.

### 4. Orphans tab — every orphan bucketed under "unknown", blank names, "undefined lines", and the "Wire this" copy-to-clipboard button generated `import undefined from '...'`

`findOrphans()` deliberately stripped its return to `{path, exports}` only
(discarding `directory`/`lineCount`/`lastModified` that `scanFrontendComponents`
already computed) — so every orphan's `directory || 'unknown'` fallback
fired, every `entry.name` render was blank, and `handleWire`'s generated
import statement used `entry.name` (undefined) as the imported identifier
in the no-named-exports branch, producing a syntactically-broken snippet a
user would paste straight into their editor.

### 5. Wiring Map tab — crashed immediately on load

The real `/api/inventory/wiring` response is `{ok, lenses: {name: {...}},
components: {...}, serverLibs: {...}}` — an **object** keyed by lens name.
The frontend typed it as `WiringEntry[]` and called `(data ?? []).map(...)`
on the object directly: `data.map is not a function`, on tab open. The
per-entry `entry.domain` field it tried to color-code by also never
existed anywhere in the backend response — `buildWiringMap()` has no
concept of "domain," only components-imported + routes-detected per lens
(a `DOMAIN_COLORS` map of 9 arbitrary strings like `admin`/`chat`/`market`
was dead scaffolding with nothing behind it).

### 6. Search tab — silently, permanently non-functional

`/api/inventory/search` returns `{ok, query, count, results: [...]}`; the
frontend typed the whole envelope as `SearchResult[]` and read `data.length`
directly on it. `undefined.length > 0` and `undefined.length === 0` are
both `false`, so **neither** the results branch nor the "no results" empty
state ever rendered — typing a query silently did nothing observable, no
crash, no feedback, just a dead search box. Additionally the type badge
switch matched on `'server-lib'` (hyphenated) while the real value is
`'serverLib'` (camelCase) and never had a case for the real `'route'` type
— both would have fallen through to the generic gray badge even after the
array-unwrap fix.

### 7. `SystemHealth.tsx` — every tile showed "—", real fleet/DB/growth data unrendered

`GET /api/system/health` nests everything under a `health` key and uses
different field names than the widget read (`health.status` not `status`,
`health.uptime` (seconds) not `uptimeSec`, `health.memory.heap` (bytes) not
`memoryMB`) — and three fields the widget read (`activeUsers`, `ticksTotal`,
`heartbeatsOk`) don't exist in the response *at all*. Net effect: an honest
failure (every tile showed `—`, nothing fabricated) but a wasted panel, on
a lens whose entire purpose is telling you the truth about the running
system, next to real unrendered data: five-brain fleet status (per-brain
enabled/model/avgResponseMs), Postgres/Redis connection state, save-failure
count, and 24h/7d DTU growth.

### 8. Three real analytics macros reachable only via a raw JSON textarea

`meta.systemReflection`, `meta.actionAnalytics`, `meta.qualityMetrics` are
substantial deterministic engines (percentile/regression trend analysis,
session-segmented co-occurrence/transition mining, weighted completeness
+consistency+freshness scoring) with **zero purpose-built UI** — the only
way to invoke them was the Dev Portal's generic "Macro Explorer → Try it
now" JSON-paste box (a legitimate feature *in general*, but per the
zero-generic-tendencies invariant, a macro reachable only through it isn't
"designed" for that macro specifically).

## What changed

### `server/lib/codebase-inventory.js`
- `findOrphans()` now returns the full shape (`path, directory, exports,
  lineCount, lastModified`) instead of stripping to `{path, exports}` —
  nothing else in the codebase consumed the stripped shape (`grep -rn
  findOrphans server/` confirms the only callers are `getInventorySummary`
  (uses `.length` only, unaffected) and the `/orphans` route).

### `app/lenses/meta/page.tsx`
- Rewrote all six response-shape interfaces to the real backend contract,
  verified live against a booted server (see Verification), not just
  against source.
- `OverviewTab`: `f.lineCount` (not `.lines`), `data.mostImportedComponents`
  with `{path, usedByCount}` (not `data.mostImported`/`{name,importCount}`).
- `ComponentsTab`: search filter and display now derive a name via a shared
  `baseName(path)` helper; `WiredBadge wired={!comp.isOrphaned}`; expand
  section reads `comp.usedByLenses`.
- `LensesTab`: path derived client-side (`concord-frontend/app/lenses/
  ${name}/page.tsx`, matching how the backend's own summary computes it
  elsewhere); import count is `lens.imports.length`; routes section reads
  `lens.serverRoutes`.
- `OrphansTab`: name derived via `baseName(path)`; `handleWire`'s generated
  import statement now falls back to `baseName(path)` instead of the
  undefined `entry.name` (and the dead `defaultExport` branch — which could
  never match since the scanner never emits the literal string `"default"`
  as an export name — was removed with an explanatory comment instead of
  left as silently-dead code).
- `WiringTab`: fully rewritten against the real `{lenses: {name: {...}}}`
  object shape (`Object.entries` + sort, no fabricated "domain" concept);
  removed the dead `DOMAIN_COLORS`/`domainColor` scaffolding.
- `SearchTab`: unwraps `searchResponse.results`; type badge switch fixed to
  `'serverLib'` + added a `'route'` badge.

### `components/meta/SystemHealth.tsx` — rewritten
Reads the real nested `health` object with correct field names and units
(bytes→MB conversion for heap). Beyond the fix, surfaces real data that was
computed by the backend but never rendered by any version of this widget:
Postgres/Redis connection badges, a save-failure alert tile (turns red when
`saveFailures > 0` — an honest failure signal, not decorative), 24h/7d DTU
growth, and a five-brain fleet status grid (name / online dot / avg
response time per brain, from the same `getBrainStatus()` the admin brain-
endpoints surface already uses elsewhere).

### `components/meta/DevPortal.tsx` — new "Quality Lab" tab (8th tab)
Closes defect 8. Three sub-panels (`QualityMetricsPanel`,
`ActionAnalyticsPanel`, `SystemReflectionPanel`), each a **structured
add/remove-row editor** (typed inputs — text/number/select/checkbox/date —
never a raw JSON textarea) feeding the real macro, with the real computed
output rendered as score bars / grade badge / percentile tiles / frequency
bars / transition chips, not just dumped JSON. These three macros take a
user-supplied dataset by design (there is no live per-request telemetry
log to source real samples from — `BRAIN.stats` is aggregate-only,
`{requests, totalMs, errors}`, no per-sample history) — "bring your own
rows via a structured form" is the honest shape for this feature, matching
what a Postman-style API tester or a log-analyzer utility looks like in a
real dev portal, not a stand-in for a missing live-data integration.

## Macro → UI classification (all 18 macros)

**DESIGNED** — 18/18 after this pass (15/18 were already designed before
this pass via the 7-tab Dev Portal; `systemReflection`, `actionAnalytics`,
`qualityMetrics` were GENERIC-STRIP-ONLY and are now designed):

| Macro group | Count | Where |
|---|---:|---|
| `serviceRegister/Catalog/Update/Remove` | 4 | `ServiceCatalogPanel` (pre-existing, real) |
| `dependencyGraph` | 1 | `DependencyGraphPanel` (pre-existing, real) |
| `metricRecord`, `metricsDashboard` | 2 | `MetricsDashboardPanel` (pre-existing, real) |
| `healthRollup` | 1 | `HealthRollupPanel` (pre-existing, real) |
| `deployRecord`, `deployTimeline` | 2 | `DeployTimelinePanel` (pre-existing, real) |
| `alertRaise/Resolve/Surface` | 3 | `AlertSurfacePanel` (pre-existing, real) |
| `macroExplorer` | 1 | `MacroExplorerPanel` (pre-existing, real) — also the generic "try any macro" escape hatch for the whole platform, by design |
| `classify` | 1 | Not part of this lens's UI — consumed by QuickCapture elsewhere (`grep -rn "meta.*classify\|'classify'" concord-frontend/components/capture/`), correctly out of scope for a dev-portal surface |
| `systemReflection`, `actionAnalytics`, `qualityMetrics` | 3 | `QualityLabPanel` → `SystemReflectionPanel`/`ActionAnalyticsPanel`/`QualityMetricsPanel` (**newly wired this pass**) |

Total: 4+1+2+1+2+3+1+1+3 = **18**. Matches `grep -c
'registerLensAction("meta"' server/domains/meta.js`.

**GENERIC-STRIP-ONLY**: none remaining. `ManifestActionBar` is mounted
(capability-directory pattern, consistent with the rest of the rebuild
program) but every macro a user needs is reachable through a bespoke
panel.

**UNSURFACED**: none remaining. `node scripts/lens-unsurfaced.mjs --lens
meta` reports **0/18** (was 3/18 before this pass).

## Confirmed real and left alone, with reason

- **`lib/lenses/{manifest,lens-status,lens-merge-map,productization-roadmap,
  wiring-profiles}.ts`** (the "Lens Infrastructure" tab's data source, ~19k
  LOC combined) — large hand-authored static TS describing Concord's own
  260-lens manifest/status taxonomy/merge map/roadmap/wiring profiles. Not
  fabricated: it's real, verifiable, self-referential documentation of the
  actual codebase (263 manifest entries vs. the real 260 lens directories —
  consistent), analogous to `server/lib/lens-manifest.js` on the backend
  side. It doesn't hit an API (by design — it's compiled build-time data,
  the same pattern `docs/AUDIT_INVENTORY.md` uses), so it doesn't crash or
  drift the way the six live-API tabs did; left alone.
- **`grep -n "Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded" app/lenses/
  meta/page.tsx components/meta/*.tsx`** — no fabrication signatures found
  anywhere in this lens, before or after this pass.
- **`POST /api/inventory/refresh`** (cache-bust + rescan) exists on the
  backend with no frontend caller. Left un-wired this pass — the 5-minute
  TTL already keeps the inventory reasonably fresh for a codebase that
  doesn't change inside a single browsing session, and adding a manual
  refresh button is a real but non-critical fluidity nicety, not a defect;
  noted here rather than silently dropped.

## Genuinely missing, deferred

None identified requiring new backend work. Every gap found was a
frontend field-shape/wiring defect against a real, already-complete
backend (DATA-SOURCING/ENGINEERING/CURATION triage: none apply — no
external data source is missing, no computation engine is missing, no
content curation is missing). The one non-defect nicety noted above
(`/api/inventory/refresh` wiring) is ENGINEERING-class and small; left as
a documented opportunity rather than a required fix.

## Verification

- `node --check server/lib/codebase-inventory.js` — clean.
- `node --test tests/depth/meta-behavior.test.js
  tests/meta-domain-parity.test.js tests/a11-meta-capabilities.test.js`
  (from `server/`) — **49/49 pass, 0 fail** (all pre-existing; this domain
  file wasn't touched, only the scanner lib was — confirms no regression).
- **Live boot-and-curl verification** (not just source-reading): booted
  `node server.js` with a fresh in-memory-cache/on-disk SQLite DB, registered
  a real user, and curled every touched endpoint with a Bearer token —
  `GET /api/system/health`, `/api/inventory`, `/api/inventory/orphans`,
  `/api/inventory/wiring`, `/api/inventory/search?q=meta`,
  `/api/inventory/components`, `/api/inventory/lenses` — confirmed every
  field name this pass's TypeScript interfaces now reference exists exactly
  as typed in the real, live JSON response (e.g. `mostImportedComponents[].
  usedByCount`, `lenses.meta.serverRoutes`, `results[].type ∈ {lens,
  component, serverLib}`, `health.brains.brains.conscious.avgResponseMs`).
  Also ran the three new Quality Lab macros through the in-process
  `lensRun` test harness with representative structured input and confirmed
  the exact response shape the new panels render against.
- `npx eslint app/lenses/meta/page.tsx components/meta/DevPortal.tsx
  components/meta/SystemHealth.tsx` (from `concord-frontend/`) — clean,
  exit 0.
- `node scripts/verify-lens-backends.mjs` (from repo root) —
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (meta was already WIRED and
  stays WIRED).
- `node scripts/grade-ux-polish.mjs --honest` (from repo root) — meta
  entry: `"tier": "polished"`, `"isGenericScaffold": false`,
  `"pillarsPresent": 5`, `"antiPatterns": 0`. `audit/` reverted via
  `git checkout -- audit/` immediately after (shared working tree).
- `node scripts/lens-unsurfaced.mjs --lens meta` (from repo root) —
  **0/18 unsurfaced** (was 3/18 before this pass).
