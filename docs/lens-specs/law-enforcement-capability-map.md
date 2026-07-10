# Law Enforcement Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("law-enforcement"' server/domains/lawenforcement.js
```
→ **29** macros in `server/domains/lawenforcement.js` (955 lines), registered
via `registerLawEnforcementActions(register)`. The filename is `lawenforcement.js`
(no hyphen) but the domain string used in every registration — and the one the
frontend must call — is `"law-enforcement"` (hyphenated). No domain-string
collisions with `crime.js`/`crime-engine.js` or `law.js` (the `law` lens is a
separate, unrelated legal-practice domain — statute lookup / billing / deadline
tracking for attorneys, not policing).

Real surfaces: 4 pure-compute legacy analytics macros (`caseAnalysis`,
`patrolOptimize`, `incidentReport`, `crimeStats` — no persistence, deterministic
scoring off caller-supplied data), plus a full in-process RMS/CAD substrate
(per-user `Map`s under `globalThis._concordSTATE._lawEnforcement`, no DB
migration): CAD call queue + unit board + nearest-unit dispatch routing
(`cadCreateCall/cadCallQueue/cadRegisterUnit/cadUnitBoard/cadDispatchUnit/
cadUpdateStatus`), evidence chain-of-custody (`evidenceIntake/evidenceTransfer/
evidenceList/evidenceChain`), officer roster + shift scheduling with rolling
7-day overtime detection (`rosterAddOfficer/scheduleShift/rosterBoard`),
geospatial crime mapping with grid-bucket hotspot detection
(`mapAddIncident/crimeMap`), warrant lifecycle
(`warrantIssue/warrantServiceAttempt/warrantReturn/warrantList`), report
writing with statute auto-population + supervisor approval
(`reportDraft/reportSubmit/reportApprove/reportList`), and field-interview /
arrest booking (`bookingCreate/bookingList`).

## Frontend surface

`concord-frontend/app/lenses/law-enforcement/page.tsx` +
`concord-frontend/components/law-enforcement/{RmsCadConsole,
LawEnforcementActionPanel, LawEnforcementOverviewPanel (new this pass),
PoliceFeed}.tsx`.

All 29 macros already had a real caller before this pass — `RmsCadConsole`
(1,127 LOC) is a genuinely excellent, purpose-built RMS/CAD console covering
all 25 CAD/evidence/roster/map/warrant/report/booking macros across 7 tabs,
and `LawEnforcementActionPanel` called the remaining 4 pure-compute analytics
macros. So there was **no UNSURFACED macro** — the defects were elsewhere.

## The defects found

### 1. A fabricated 7-tab (`Dashboard/Cases/Incidents/Officers/Evidence/
Patrols/Warrants`) parallel CRUD system as the page's primary surface,
sitting directly above the already-real, already-wired `RmsCadConsole`

`app/lenses/law-enforcement/page.tsx` ran `useLensData<ArtifactDataUnion>
('law-enforcement', currentType, …)` with `currentType ∈ {Case, Incident,
Officer, Evidence, Patrol, Warrant}` — **none of these six type strings is a
registered macro action.** `useLensData` hits the generic
`GET /api/lens/law-enforcement?type=…` artifact store, not
`domains/lawenforcement.js`. Verified by direct read of the full file plus
cross-referencing every `ArtifactType` against the 29-macro grep list:

- Fake `CaseData`/`IncidentData`/`OfficerData` field shapes
  (`caseNumber`/`detective`/`jurisdiction`/`statute`,
  `incidentNumber`/`respondingOfficers`/`callerInfo`,
  `badgeNumber`/`unit`/`certifications`/`fitnessStatus`) share **zero**
  field names with any real macro's persisted shape — e.g. the real CAD
  call record is `{callType, location, priority, callerName, status,
  assignedUnit}` (`cadCreateCall`), not `IncidentData`'s invented
  `incidentNumber`/`respondingOfficers`.
- The "New {type}" button created an artifact via `create({ title: 'New
  Case', data: {} })` — an **empty stub** with no form, no validation, no
  backend logic behind it — the textbook GENERIC-STRIP-ONLY shape.
- The Quick Stats row (`Active Cases`, `Officers Assigned`, `Active
  Incidents`, `High Priority`) was computed entirely from these fake
  arrays (`cases`/`incidents`/`officers` from three parallel `useLensData`
  calls) — always `0` on a fresh install, and never reconcilable with the
  real CAD/roster/evidence/warrant counts one section down in the
  already-mounted `RmsCadConsole`.
- `<UniversalActions domain="law-enforcement" artifactId={items[0]?.id}>`
  ran the generic analyze/generate/suggest utility-brain actions against
  a fake artifact — permanently pointless once the fake CRUD is gone
  (there is no real "select one law-enforcement artifact" concept in this
  domain; operational state is 7 independent collections, not a single
  document type), so it was dropped along with the fake store rather than
  rewired to nothing.
- `RmsCadConsole` (all 25 CAD/evidence/roster/map/warrant/report/booking
  macros) and `LawEnforcementActionPanel` (the 4 analytics macros) were
  **already mounted** further down the same page, fully disconnected from
  the fabricated system above them — the exact "real backend/UI sitting
  beside a fabricated parallel system" shape `CLAUDE.md` describes.

### 2. `LawEnforcementActionPanel` gated 3 of its 4 real macros behind raw
JSON-paste textareas — the named "structured form" invariant violation

`caseAnalysis`, `patrolOptimize`, and `crimeStats` were only reachable by
typing/pasting hand-written JSON into a `<textarea>` (`Paste case JSON
first.` / `Paste zones JSON first.` / `Paste crime log JSON first.`) —
matching the explicitly-named anti-pattern "a raw JSON-paste textarea
standing in for a real form." The macros themselves are real and correctly
wired (field shapes matched `artifact.data.evidence/witnesses/suspects`,
`artifact.data.zones`, `artifact.data.incidents`); the defect was purely
that no bespoke input UI existed for a domain (records/case management)
where a raw-JSON textarea reads especially wrong.

### 3. `incidentReport`'s one already-structured call sent a hardcoded
fabricated officer identity instead of real caller-supplied data

`actReport()` called `incidentReport` with `officer: 'badge-1138'` —
a literal, invented badge number sent on **every** call regardless of who
was actually using the console, dressed up as if it were a real field value.
The macro's own contract (`data.officer || ctx?.userId || "system"`) already
has an honest fallback to the authenticated caller — the hardcode was
unnecessary fabrication, not a missing-field workaround.

## What changed

### 1. `app/lenses/law-enforcement/page.tsx` — rewritten (411 → 118 lines)

Removed: `CaseData`/`IncidentData`/`OfficerData`/`ArtifactDataUnion` types,
`MODE_TABS`/`getTypeForTab`/`STATUS_COLORS`, three `useLensData(...)` calls,
`useRunArtifact`, `handleAction`, the fake Quick Stats `useMemo`, the
create/search/delete UI for the fake artifacts, the generic item-card
renderer, and `<UniversalActions>`.

Replaced with 4 tabs, all macro-backed, non-overlapping, composing the
already-real components (none needed to be built from scratch — they needed
to be reachable without a fabricated system in front of them): **Overview**
(new `LawEnforcementOverviewPanel`), **RMS / CAD Console**
(`RmsCadConsole`, unchanged mount), **Quick Analysis**
(`LawEnforcementActionPanel`, rewritten — see below), **Field Notes**
(`PoliceFeed`, unchanged mount — real-world r/ProtectAndServe /
r/AskLE / r/policeuk / r/Cops pulse via the Reddit JSON API). Kept the
footer (`RecentMineCard`/`AutoActionStrip`/`CrossLensRecentsPanel`),
`FirstRunTour`, `ManifestActionBar`, `DepthBadge`. Added keyboard shortcuts
`1`-`4` (`useLensCommand`) to switch tabs, matching the fluidity invariant.

### 2. `components/law-enforcement/LawEnforcementOverviewPanel.tsx` (new)
— real dashboard replacing the fabricated Quick Stats row

Fetches `cadCallQueue`, `cadUnitBoard`, `rosterBoard`, `evidenceList`,
`warrantList`, `reportList`, `bookingList` in parallel on mount and renders
an 8-tile `StatTile`/`StatTileGrid` strip (active/pending calls, units
available, officers + overtime, evidence in custody, active/expiring
warrants, reports pending approval, arrests, field interviews). Honest
`role="alert"` error surface on fetch failure, `role="status"` loading
state. No fabricated field ever rendered.

### 3. `components/law-enforcement/LawEnforcementActionPanel.tsx` —
rewritten to replace JSON-paste with structured forms + fix the hardcoded
officer identity

- **`caseAnalysis`** — repeatable-row builders for Evidence (description),
  Witnesses (name), and Suspects (name + a number-of-linked-evidence-items
  field, mapped honestly to `evidenceLinks: Array(n).fill(true)` — the
  macro only ever reads the array's `.length`, so a user-supplied count is
  the truthful minimal shape) + a Case ID field. Replaces the "Paste case
  JSON" textarea.
- **`patrolOptimize`** — repeatable zone rows (name / crime rate /
  population / current patrols). Replaces the "Paste zones JSON" textarea.
- **`crimeStats`** — repeatable incident-log rows (type + a resolved
  checkbox). Replaces the "Paste crime log JSON" textarea.
- **`incidentReport`** — added a real, optional "Filing officer" text
  input; the hardcoded `officer: 'badge-1138'` literal is gone. An empty
  field now omits `officer` entirely so the macro's own
  `data.officer || ctx?.userId || "system"` fallback resolves it honestly
  from the authenticated caller, instead of a fabricated constant.
- Kept mint/DM/publish/agent unchanged (field names were already correct).

All payload shapes were re-verified against the dispatch-layer peel logic
(`server/lib/lens-input-normalize.js#peelRedundantArtifactWrapper`): each
call sends the sole-key `{ artifact: { data: {...} } }` shape, which the
dispatcher peels to exactly the handler's `artifact.data`/`params` — this
was already correct pre-pass and is unchanged.

## Macro → UI classification (all 29 macros)

**DESIGNED** (real, bespoke UI, no fabrication) — 29/29 after this pass (was
also 29/29 reachable before this pass — the defect was never a coverage gap,
it was a fabricated system sitting in front of real coverage, plus a
structured-form gap on 3 macros):

| Macro group | Count | Where |
|---|---:|---|
| `caseAnalysis`, `patrolOptimize`, `crimeStats` | 3 | `LawEnforcementActionPanel.tsx` (**JSON-paste → structured form this pass**) |
| `incidentReport` | 1 | `LawEnforcementActionPanel.tsx` (**hardcoded officer fabrication fixed this pass**) |
| `cadCreateCall/cadCallQueue/cadRegisterUnit/cadUnitBoard/cadDispatchUnit/cadUpdateStatus` | 6 | `RmsCadConsole.tsx` CAD tab (pre-existing, real) |
| `evidenceIntake/evidenceTransfer/evidenceList/evidenceChain` | 4 | `RmsCadConsole.tsx` Evidence tab (pre-existing, real) |
| `rosterAddOfficer/scheduleShift/rosterBoard` | 3 | `RmsCadConsole.tsx` Roster tab (pre-existing, real) |
| `mapAddIncident/crimeMap` | 2 | `RmsCadConsole.tsx` Crime Map tab (pre-existing, real) |
| `warrantIssue/warrantServiceAttempt/warrantReturn/warrantList` | 4 | `RmsCadConsole.tsx` Warrants tab (pre-existing, real) |
| `reportDraft/reportSubmit/reportApprove/reportList` | 4 | `RmsCadConsole.tsx` Reports tab (pre-existing, real) |
| `bookingCreate/bookingList` | 2 | `RmsCadConsole.tsx` Booking tab (pre-existing, real) |

Also new this pass: `cadCallQueue`/`cadUnitBoard`/`rosterBoard`/
`evidenceList`/`warrantList`/`reportList`/`bookingList` are each called a
**second** time (read-only, summary form) by `LawEnforcementOverviewPanel`
for the dashboard tile strip — additive, does not change their DESIGNED
classification above.

## Investigated and honestly deferred

- **No persisted "Case" record type exists server-side.** `caseAnalysis` is
  a pure-compute case-strength calculator over caller-supplied evidence/
  witness/suspect counts — it has never written to a store. The closest
  real persisted case-adjacent records are `reportDraft`/`reportList`
  (narrative reports with a `caseNumber` field) and `bookingCreate`
  (arrest/field-interview records with `charges[]`). Building a genuine
  persisted case-management entity (case status lifecycle, assigned
  detective, linked reports/evidence/warrants by `caseNumber`) is real,
  scoped **ENGINEERING** work — a new macro group, not a frontend fix —
  and is out of scope for this pass, which fixes existing wiring rather
  than growing the backend. Left as an honest gap: the "Case ID" field in
  the rebuilt Quick Analysis form is caller-supplied free text, not a
  foreign key into anything.
- **`PoliceFeed`'s Reddit integration is unauthenticated client-side
  `fetch` to `reddit.com/r/.../top.json`.** This is a pre-existing,
  intentional pattern (same shape used by several other rebuilt lenses in
  this program for "real-world pulse" panels) — not a fabrication, since
  every post rendered is a real, live Reddit post with a working permalink.
  Left unchanged; out of scope.

## Verification

```
node --check server/domains/lawenforcement.js                     # OK — backend untouched, syntax-valid
cd server && node --test tests/law-enforcement-lens-macros.test.js \
  tests/law-enforcement-domain-parity.test.js tests/crime-engine.test.js \
  tests/depth/crime-behavior.test.js
# → 68/68 pass, 0 fail (unmodified — backend was not touched this pass)

cd concord-frontend && npx eslint app/lenses/law-enforcement/page.tsx \
  components/law-enforcement/*.tsx
# → clean, 0 errors/warnings

node scripts/verify-lens-backends.mjs
# → law-enforcement: WIRED (258 WIRED / 2 NO-BACKEND-CALL by design / 0 broken, total 260)

node scripts/grade-ux-polish.mjs --honest
# → audit/ux-polish-honest.json["law-enforcement"]: tier "polished",
#   isGenericScaffold: false, bespokeRatio 0.935, pillarsPresent 5/5,
#   antiPatterns 0
# (audit/ reverted with `git checkout -- audit/` after grading — shared tree)
```
