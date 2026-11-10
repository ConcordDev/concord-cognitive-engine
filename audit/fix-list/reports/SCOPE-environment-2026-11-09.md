# Environment scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/environment.js` (+ `concord-frontend/app/lenses/environment/page.tsx`, `components/environment/*`). Tip assumed same mega deploy as prior SCOPE reports (`dae9e10a6`). **No files/DB/services modified.** Code-only; not live-proven.

Requested as READ-ONLY code scope check for the Concord live lens audit (Environment lens).

## Model — two coexisting data planes

| Layer | UI | API path | Storage |
|-------|-----|----------|---------|
| **Field Ops desk** (generic lens artifacts) | `FieldOpsPanel.tsx` under Sites / Species / Sampling / Trails / Waste / Permits / Emissions log / Resources / Goals / Map (+ Overview dashboard) | `useLensData('environment', type)` → `POST/PUT/DELETE /api/lens/environment` | `STATE.lensArtifacts` domain=`environment`; types `Site`, `Species`, `EnvironmentalSample`, `TrailAsset`, `WasteStream`, `ComplianceRecord`, `CarbonEntry`, `ResourceMetric`, `SustainabilityGoal` (`FieldOpsPanel.tsx:265–273`; `lens-artifact-types.js:36`) |
| **GHG desk** (domain macros) | `CarbonWorkbenchPanel` tabs: Activities / Suppliers / Targets / Projects / RECs / Offsets / Bulk import / EJScreen / … | `POST /api/lens/run { domain:'environment', action }` → `LENS_ACTIONS` + **virtualArtifact** | `STATE.environmentLens` Maps keyed by **userId** via `envActor` (`environment.js:175–190`) — buckets `activities`, `suppliers`, `targets`, `projects`, `recs`, `offsets` |

Also on the shell (not always record creates, but side-effect surfaces):

- **Watch** (`WatchPanel`) — Open-Meteo AQI, EPA Superfund, USGS Water, NOAA CDO, GBIF, `LensFeedPanel`, `AirQualityActionStack` (mint / publish / agent)
- **Permits / Diversion worksheets** (`ComplianceDiversionPanel`) — client-only `useState`; compute macros only
- **Trends** (`FieldMonitoringPanel`) — client-only survey/trail worksheets; compute macros only
- NorthStar **Live environment feed** / `LensFeedButton` → `environment.feed` (NWS severe alerts → **public** DTUs)

### Shared runtime facts

- Domain wrapped with `guardAnonWrites` (`environment.js:7,14`) — anon can read, not write.
- Actor key: `envActor(ctx) = ctx?.actor?.userId || ctx?.userId || "anon"` (`:175`).
- `environment` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server.js:49775` — forum/feed/marketplace/collab/thread/vote/alliance/global/news/questmarket only).
- Generic Field Ops creates go through `lens.create` (`server.js:50014–50086`): stamps `ownerId = ctx.actor.userId || "anon"`, defaults `meta.visibility` to `"private"`, then **`_lensEmitDTU`** → WS `dtu:created` / `lens:dtu_generated` with title/tags and **no userId** (**FIX-xl-ws-001**, `:49871–49946`, emit at `:50085`).
- Generic list/get filter by owner for non-social domains (`:49975–49988`). Caveat: artifacts with **no ownerId** or `ownerId === "anon"` are **visible to everyone**.
- Domain macros via `/api/lens/run` dual-registry path use a **virtualArtifact** and only `_recordLensActivity` — they do **not** call `_lensEmitDTU` (same as agriculture/security SOC).
- Boot merges `EXTENDED_DOMAIN_RULES` then **`reconcileArtifactTypes(DOMAIN_RULES)`** (`server.js:2952–2956`) so Field Ops PascalCase types are accepted even though the raw environment rule lists lowercase legacy types (`domain-logic-extended.js:1151–1165`). Status vocabulary was already aligned to the form (`environment-site-manager-status.test.js`). Simulated boot: `Site`/`active` and `Species`/`monitoring` → `ok:true`.
- Seeds in `FieldOpsPanel` are empty arrays (`:382–390`) — no auto-bulk seed writes.
- LIVE / Watch chrome = outbound government reads + socket health; not a data-sharing signal for Field Ops records.

## Hotkeys (RCA-form-hotkey-steal)

From `app/lenses/environment/page.tsx:61–77,97–106` via `useLensCommand`:

| Key | View |
|-----|------|
| `w` | Watch |
| `d` | Overview |
| `s` | Sites |
| `p` | Species |
| `a` | Sampling |
| `t` | Trails |
| `u` | Waste |
| `c` | Permits |
| `v` | Diversion |
| `f` | Trends |
| `n` | Emissions log |
| `g` | GHG desk |
| `r` | Resources |
| `o` | Goals |
| `m` | Map |

From `FieldOpsPanel.tsx:433–437`: `/` focuses search.

**RC1: YES — bare-letter tab shortcuts** across nearly the whole alphabet used by the shell. Typing in Field Ops / GHG forms can steal focus and switch tabs (same class as Agriculture/Household). Digits are not used here.

**RC2: YES on Field Ops editor + cards.**

- `FieldOpsPanel.tsx:2369` — list cards `role="button"` + Enter/Space → expand/edit
- `FieldOpsPanel.tsx:2822,2841` — detail / action rows `role="button"` + Enter/Space → `.click()`
- `FieldOpsPanel.tsx:3440–3442` — modal backdrop + panel `role="button"` + Enter/Space → close / noop-click (closes unsaved form when backdrop fires)

No `window.confirm` on Delete (`handleDelete` `:540–543` and editor Delete `:3487–3495` call `remove` immediately). GHG activity Trash likewise has no confirm (`EmissionsActivitiesPanel.tsx:66–70,133`).

`useLensCommand` skips form fields unless `global` (`hooks/useLensCommand.ts:43–49,147–154`) — still leaks for the bare-letter map when the guard fails (RCA-form-hotkey-steal RC1).

## Verdict table — Field Ops desk (generic lens artifacts)

All nine types share one path: `useLensData('environment', currentType)` → create/update/remove (`FieldOpsPanel.tsx:450–451,524–543`). Delete UI: card **Delete** (`:2845–2846`) and editor **Delete** when editing (`:3487–3495`) — **not** hover-only; **no** confirm dialog.

Validation after boot reconcile: statuses `active|monitoring|critical|remediation|closed|seasonal` match `DOMAIN_RULES` (`domain-logic-extended.js:1153`); types added by `reconcileArtifactTypes` from `FRONTEND_ARTIFACT_TYPES.environment` (`lens-artifact-types.js:36`). Required fields for these PascalCase types are empty / warnings-only (`requiredFields: { assessment: ["title"] }` — warnings, not 422 errors; `domain-logic.js:983–988`).

| Record type | Scope | Delete server | Delete UI | Side effects | Verdict |
|-------------|-------|---------------|-----------|--------------|---------|
| **Site** | **SAFE_PRIVATE** (ownerId + default private; not social) | **Yes** `lens.delete` owner/admin | **Yes** card + editor Delete (`:2845–2846,3487–3495`) | Local site metadata / lat-lon. Create fires **FIX-xl-ws-001**. | **SAFE_PRIVATE_DELETABLE** |
| **Species** | same | **Yes** | **Yes** | Local survey record — not GBIF write. | **SAFE_PRIVATE_DELETABLE** |
| **EnvironmentalSample** | same | **Yes** | **Yes** | Local sampling metadata. | **SAFE_PRIVATE_DELETABLE** |
| **TrailAsset** | same | **Yes** | **Yes** | Local trail asset. | **SAFE_PRIVATE_DELETABLE** |
| **WasteStream** | same | **Yes** | **Yes** | Local waste stream. | **SAFE_PRIVATE_DELETABLE** |
| **ComplianceRecord** | same | **Yes** | **Yes** | Local permit/compliance metadata — not EPA submit. | **SAFE_PRIVATE_DELETABLE** |
| **CarbonEntry** (Emissions log tab) | same | **Yes** | **Yes** | Separate from GHG desk `activities` Map. | **SAFE_PRIVATE_DELETABLE** |
| **ResourceMetric** | same | **Yes** | **Yes** | Local water/energy metrics. | **SAFE_PRIVATE_DELETABLE** |
| **SustainabilityGoal** | same | **Yes** | **Yes** | Separate from GHG desk `targets` Map. | **SAFE_PRIVATE_DELETABLE** |

QA write title pattern: `QA LT3 environment 2026-11-09 <thing>`. Delete after. Accept FIX-xl-ws-001 title/tags WS leak.

Map tab reuses **Site** artifacts (no separate create type). Overview is dashboard-only over the same stores.

## Verdict table — GHG desk (`STATE.environmentLens`)

All buckets are **`Map<userId, …>`** via `envActor` / `ensureEnvBucket`. **No `_shared` bucket.** Macros do **not** call `_lensEmitDTU`.

| Record type | Scope | Delete server | Delete UI | Side effects | Verdict |
|-------------|-------|---------------|-----------|--------------|---------|
| **activity** (`activities-log`) | **SAFE_PRIVATE** | **Yes** `activities-delete` (`:297–306`) | **Yes** hover Trash (`EmissionsActivitiesPanel.tsx:133` — `opacity-0 group-hover`) | Local EPA-factor multiply; **no** outbound. **No** `_lensEmitDTU`. | **SAFE_PRIVATE_DELETABLE** |
| **supplier** (`suppliers-add`) | **SAFE_PRIVATE** | **No** | **No** | Stores name/email locally. `suppliers-invite` only flips `invitationStatus` — **explicitly does not email** (`:345–350`; UI copy confirms). | **KEEP_BLOCKED** (no delete) |
| **target** (`targets-create`) | **SAFE_PRIVATE** | **No** | **No** (create + progress only) | Local SBTi-style target. | **KEEP_BLOCKED** (no delete) |
| **project** (`projects-create`) | **SAFE_PRIVATE** | **No** hard delete | **No** (status update only `projects-update-status`) | Local backlog row. | **KEEP_BLOCKED** (no delete) |
| **REC** (`recs-purchase`) | **SAFE_PRIVATE** | **No** hard delete | **No** (retire only `recs-retire`) | Local ledger — **not** a real market purchase / payment. | **KEEP_BLOCKED** (no delete) |
| **offset** (`offsets-purchase`) | **SAFE_PRIVATE** | **No** hard delete | **No** (retire only) | Local ledger — **not** a real purchase / payment. | **KEEP_BLOCKED** (no delete) |
| **activities-import** (bulk) | private store | per-row `activities-delete` only | hover Trash per row | Can leave many residuals; easy to miss hover deletes. | **KEEP_BLOCKED** (bulk residual risk) |

## Side-effect / outbound inventory

| Action | Outbound / platform effect? | QA rule |
|--------|----------------------------|---------|
| Field Ops create/update/delete | FIX-xl-ws-001 title/tags WS broadcast (no body) | Prefer QA titles; optional skip if leak unacceptable |
| GHG activities / suppliers / targets / projects / recs / offsets macros | No `_lensEmitDTU`; activity log only | OK where deletable |
| `populationTrend` / `complianceCheck` / `trailCondition` / `diversionRate` / footprint / scenario / inventory-report / audit-trail | Pure compute over owned / worksheet data | OK to run |
| `airnow-current` / `live_air_quality` | **EXTERNAL** Open-Meteo CAMS (+ optional EPA AirNow secondary) | Read OK; no QA write |
| `epa-superfund-search` | **EXTERNAL** `data.epa.gov` Envirofacts | Read OK |
| `usgs-water-realtime` | **EXTERNAL** USGS Water Services | Read OK |
| `noaa-climate-stations` | **EXTERNAL** NOAA CDO (needs `NOAA_CDO_TOKEN`) | Prefer skip if token present / BLOCKED for outbound writes (read-only anyway) |
| `epa-ejscreen` | **EXTERNAL** `ejscreen.epa.gov` REST | Prefer skip / BLOCKED for outbound |
| `live_gbif` | **EXTERNAL** GBIF occurrence search | Read OK; no QA write |
| `environment.feed` / Live Feed / `LensFeedButton` | **EXTERNAL** NWS alerts + `dtu.create` **`visibility:"public"`** (`:1072–1100`) | **BLOCKED** |
| `AirQualityActionStack` Mint snapshot | Private `dtu.create` — still FIX-xl-ws-001 | Prefer skip |
| `AirQualityActionStack` Publish community report | `dtu.create` **public** + `/api/dtus/:id/publish` (`AirQualityActionStack.tsx:184–217`) | **BLOCKED** |
| `AirQualityActionStack` agent | `chat_agent.do` | **BLOCKED** |
| `suppliers-invite` | **No email** — status flag only (`:345–350`) | Still **no delete** on supplier → keep add blocked |
| `recs-purchase` / `offsets-purchase` | Local ledger only (names say purchase; **no** payment processor) | Still no hard delete → blocked |
| LensShell Publish/share, emails, SMS, payments, agent deploy, paid Ask | Standing rules | **BLOCKED** |

## Private AND deletable (qualify for a single QA write)

| Qualify | Notes |
|---------|-------|
| Field Ops: Site, Species, EnvironmentalSample, TrailAsset, WasteStream, ComplianceRecord, CarbonEntry, ResourceMetric, SustainabilityGoal | All nine. Sites tab (or matching tab) → New / card Delete. QA titles. Delete after. Accept FIX-xl-ws-001. |
| GHG: **activity** only | GHG desk → Activities → Log one factor+amount → hover Trash delete. Prefer this path if avoiding WS title leak. |

## Keep BLOCKED / do not write

1. **suppliers, targets, projects, RECs, offsets** — private but **no hard delete** (server and/or UI); retire/status-only where present.
2. **activities-import** bulk — residual risk even though per-row delete exists.
3. **Live Feed / `environment.feed`**, **Publish community report**, **agent**, paid Ask / Vision / Lever.
4. **EJScreen**, prefer skip other Watch outbound if the test is a write probe (reads alone are fine for inspection).
5. **LensShell Publish/share**, invites, real emails/SMS, real facility GPS of private sites if privacy-sensitive, real EPA permit IDs / producer PII.
6. Do **not** enter real supplier emails of third parties, real employee names, or real GHG inventory of a live company.

## Gaps / notes

- Field Ops **CarbonEntry** / **SustainabilityGoal** ≠ GHG desk **activities** / **targets** — different stores; deleting one does not remove the other.
- CTA **Log a site** only `setActiveView('sites')` (`page.tsx:127`) — does not open `openNew()`; same class of misleading CTA as Security "Open a case".
- Environment status vocabulary was fixed (F2 test); Security Cases status vocabulary was **not** — see appendix.
- Hover-only Trash on GHG activities is easy to miss on touch / narrow viewports.
- Missing deletes on suppliers/targets/projects/recs/offsets leave residuals until process/STATE recycle.
- Live not proven: production `environmentLens` / `lensArtifacts` for the shared QA account; whether older anon-owned environment artifacts exist; whether hover-delete is reachable on the tester's viewport.

## Summary for tester

**OK for one QA write + delete** (title `QA LT3 environment 2026-11-09 …`): all nine Field Ops types; GHG **activities** only.

**KEEP_BLOCKED:** suppliers / targets / projects / RECs / offsets / bulk import; NWS public feed; Publish / agent / paid Ask; prefer skip EJScreen outbound.

**RC1 bare-letter hotkeys are active** on this lens — expect form typing to switch tabs. **RC2** on Field Ops modal backdrop/panel. Deletes have **no confirm**.

Code-only verdict; not live-proven.

---

## Security Cases 422 root cause

**Question:** Why does `POST /api/lens/security` create return `422 validation_failed` for Cases (Incident / Asset / AccessControl)?

### Path

1. `SecurityOpsPanel` → `useLensData('security', currentType).create(payload)` with  
   `payload = { title, data: formData, meta: { status: formStatus } }` (`SecurityOpsPanel.tsx:294`).
2. Generic `register("lens","create")` (`server.js:50014–50086`) calls  
   `validateArtifact(domain, type, data, meta)` (`:50057`) from `lib/domain-logic.js:962–991`.
3. On failure: `{ ok:false, error:"validation_failed", errors, warnings }` (`server.js:50064`) → HTTP 422 on the lens route.

### What the form sends

| Cases tab | `type` (`MODE_TABS`, `:154–159`) | Default `formStatus` via `openNew` → `getStatusesForTab(mode)[0]` (`:277–280,211–220`) |
|-----------|----------------------------------|----------------------------------------------------------------------------------------|
| Incidents | `Incident` | `detected` (`INCIDENT_STATUSES[0]`, `:163`) |
| Assets | `Asset` | `active` |
| Patrols | `Patrol` | `active` |
| Surveillance | `Surveillance` | `online` |
| Access | `AccessControl` | `active` |
| Threats | `ThreatIntel` | `active` |

### What the validator allows (after boot merge + `reconcileArtifactTypes`)

Raw rule (`domain-logic-extended.js:1442–1448`):

- `types`: `vulnerability | incident | policy | audit | scan` (lowercase macro-era)
- `validStatuses`: `draft | identified | triaging | mitigated | resolved | archived`

Boot (`server.js:2952–2956`) then `reconcileArtifactTypes` **adds** frontend types from `FRONTEND_ARTIFACT_TYPES.security` (`lens-artifact-types.js:59`):  
`Asset`, `Incident`, `Patrol`, `Surveillance`, `ThreatIntel` (+ platform `capture`).  
**`AccessControl` is missing from that list** — never reconciled.

Simulated boot validation (this audit):

| Create | Result |
|--------|--------|
| `Incident` + `status:"detected"` | **fail** — `Invalid status "detected" … Valid statuses: draft, identified, triaging, mitigated, resolved, archived` |
| `Asset` + `status:"active"` | **fail** — same status error |
| `AccessControl` + `status:"active"` | **fail** — **both** `Invalid type "AccessControl"` **and** invalid status |
| Patrol / Surveillance / ThreatIntel with their form defaults | **fail** — status only |

`requiredFields` for these PascalCase types are empty; missing recommended fields are **warnings only** (`domain-logic.js:983–988`) and do **not** cause 422. Scope check is unrelated once `await`ed (`server.js:50046–50054`).

### Likely mismatch (file:line)

1. **Primary (all Cases tabs):** stale **`validStatuses`** on `EXTENDED_DOMAIN_RULES.set("security", …)` at **`server/lib/domain-logic-extended.js:1444`** vs form statuses from **`SecurityOpsPanel.tsx:211–220`** / payload **`:294`**. Same stale-vocabulary genus already fixed for environment (`domain-logic-extended.js:1145–1160` + `environment-site-manager-status.test.js`) and documented for services/security audit #240 — **security status list was never updated**.
2. **Additional for Access only:** `AccessControl` absent from **`FRONTEND_ARTIFACT_TYPES.security`** at **`server/lib/lens-artifact-types.js:59`** (list ends at `ThreatIntel`), so type check also fails at **`domain-logic.js:974–975`**.

### Fix direction (not applied — read-only)

Union `validStatuses` with every value `getStatusesForTab` can emit (and Incident data statuses if those are ever sent as `meta.status`), and add `"AccessControl"` to `FRONTEND_ARTIFACT_TYPES.security` (or to the rule `types` array). Pin with a security analog of `environment-site-manager-status.test.js`.

### Could not determine

- Whether live deploy process somehow skips `reconcileArtifactTypes` (unlikely — same boot path; even with reconcile, statuses still 422).
- Exact 422 `errors[]` body the tester saw live (code predicts the status / type strings above).
- Whether any Cases create with a hand-picked status that happens to be in the rule list (e.g. typing `mitigated` for Threats) would pass — Threats form includes `mitigated`/`resolved`, which **are** in the rule; if the tester left the default `active`, it still 422s.
