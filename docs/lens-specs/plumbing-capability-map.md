# Plumbing — capability map (Wave 3, Frontend Rebuild Program)

Audited 2026-07-10. Backend: `server/domains/plumbing.js`, 29 macros
registered via `registerLensAction("plumbing", ...)`, no shadowing
re-registration in `server.js`
(`grep -n 'register.*"plumbing"' server/server.js` → no hits). Repro:
`grep -n 'registerLensAction("plumbing"' server/domains/plumbing.js | wc -l` → `29`.

## Backend surface (29 macros, all real)

**Engineering calculators (4)** — IPC/UPC-grounded, not client-side arithmetic:
- `pipeSize` — GPM/velocity → pipe diameter via the standard flow relation
  `GPM = 2.448·d²·v`, recommends the next nominal size up.
- `waterHeaterSize` — household + simultaneous-fixture demand → tank
  gallons (people×15) and tankless kW (`GPM·8.33·60·ΔT/3412`, ΔT defaults
  to the industry-standard 70°F rise).
- `drainSlope` — pipe size + run length → IPC Table 704.1 minimum slope
  and total drop.
- `fixtureCount` — fixture list → WSFU total (Water Supply Fixture Units
  per IPC/UPC) and recommended meter/supply-line size.

**Field-service substrate (25)**, per-user `STATE`-backed:
- Technicians: `techAdd`, `techList`, `techRemove`.
- Dispatch board: `dispatchAssign`, `dispatchBoard`, `dispatchUpdate`.
- Price book with markup: `priceItemAdd`, `priceBookList`,
  `priceItemUpdate`, `priceItemRemove`.
- Quote-to-invoice: `invoiceFromQuote`, `invoiceList`,
  `invoiceRecordPayment`.
- Technician mobile workflow: `workflowStart`, `workflowGet`,
  `workflowUpdate` (checklist + photos + signature).
- Maintenance plans: `planCreate`, `planList`, `planLogVisit`.
- Customer notifications: `notifySend`, `notifyLog`.
- Parts inventory: `partStock`, `partList`, `jobComplete` (deducts parts
  used, reports shortages).
- Dashboard rollup: `opsSummary`.

All 29 macros carry real behavioral tests in
`server/tests/depth/plumbing-behavior.test.js` (exact engineering values —
e.g. `pipeSize(10 GPM, 5 ft/s) → 0.9" calculated, 1" nominal` — plus CRUD
round-trips and validation-rejection assertions). Verified green before and
after this pass: `node --test server/tests/depth/plumbing-behavior.test.js`
→ 1/1 pass.

## What was already real/wired

- **`components/plumbing/FieldServiceConsole.tsx`** (870 LOC) — DESIGNED.
  A ServiceTitan/Jobber-shaped operations console: 7 bespoke sections
  (Dispatch, Price Book, Quote→Invoice, Tech Workflow, Service Plans,
  Notifications, Parts Inventory), every value read from and written to a
  real macro via `lensRun("plumbing", ...)`. No mock data, no generic
  button walls — real forms, a dispatch-lane board with a load chart, a
  line-item invoice builder, a technician checklist/photo/signature flow.
- **`components/plumbing/PlumbCalc.tsx`** (382 LOC) — DESIGNED. Four
  visually distinct calculator widgets (pipe-size wheel, tank-vs-tankless
  comparison cards, an SVG drain-slope cross-section, a live WSFU fixture
  table), each calling its named `plumbing.*` macro and offering a
  Save-as-DTU export of the real result.
- **`components/plumbing/PlumbingFeed.tsx`** (69 LOC) — DESIGNED. Live
  r/Plumbing-family Reddit feed (real fetch, no mock posts).

## The defect found + what changed

`app/lenses/plumbing/page.tsx` (792 LOC before this pass) carried a
**second, fabricated multi-tab CRUD dashboard** sitting directly beside the
three real components above — the exact "recurring defect pattern (c)"
this program's audits keep finding:

- A `MODE_TABS` array defined 10 tabs: Operations (the real
  `FieldServiceConsole`, correctly mounted), plus **Jobs, Estimates,
  Codes, Materials, CRM, Invoices, Inspections, Certs, Map** — none of
  which called a `plumbing.*` macro. They were built entirely on
  `useLensData<TradeArtifact>('plumbing', activeArtifactType, ...)` (a
  generic `/api/lens/:domain` artifact CRUD store, unrelated to the
  domain's macro system) and `useRunArtifact('plumbing')` firing an
  `'analyze'` action that has no `plumbing.analyze` macro either — it
  fell through to the AI catch-all (`LENS_ACTIONS.get('plumbing.analyze')`
  is `undefined`, so `lens.run` calls `utilityCall`).
- **Jobs and Invoices duplicated already-real, already-wired
  functionality** — the real Dispatch board (`dispatchAssign` /
  `dispatchBoard` / `dispatchUpdate` / `jobComplete`) and the real
  Quote→Invoice flow (`invoiceFromQuote` / `invoiceList` /
  `invoiceRecordPayment`) already live inside `FieldServiceConsole`. A
  "job" created via the fake Jobs tab never appeared on the real dispatch
  board and vice versa — two unsynced bookkeeping systems presented as one
  app. This is a direct honesty problem: a user acting on the Jobs tab
  would reasonably believe they were scheduling real field work.
  `<UniversalActions domain="plumbing" artifactId={items[0]?.id} compact />`
  was also mounted — CLAUDE.md names `<UniversalActions>` explicitly as a
  generic-scaffold anti-pattern component.
- Estimates / Codes / Materials / CRM / Inspections / Certs / Map had **no
  backing macro of any kind** (see the GENUINELY MISSING section below) —
  the generic artifact store persisted real rows, so this wasn't
  fabricated *data* in the `Math.random()` sense, but it was a fully
  generic, non-domain-specific CRUD form standing in for trade-specific
  workflows that don't exist server-side, which fails the "zero generic
  tendencies" invariant independent of the duplication problem above.

**Fix**: removed the entire `MODE_TABS` / `TradeArtifact` / `STATUS_CONFIG`
/ `useLensData` / `useRunArtifact` / `UniversalActions` / editor-modal /
library-list / dashboard-grid scaffold (~500 LOC) from `page.tsx`. The page
now has three tabs that map 1:1 onto the three real, bespoke components:
**Field Service** (`FieldServiceConsole`), **Trade Calculators**
(`PlumbCalc`), **Industry Feed** (`PlumbingFeed`) — no parallel data
system, no generic button wall. Kept the standard cross-lens chrome
(`LensShell`, `FirstRunTour`, `ManifestActionBar`, `DepthBadge`,
`RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel` — all
`hideWhenEmpty` where applicable) since those are the platform's shared,
non-lens-specific primitives, not this defect's pattern. Added three
number-key (`1`/`2`/`3`) tab-jump commands via `useLensCommand` in place of
the removed (and non-functional, since its target search box no longer
exists) `/`-focus-search binding — every registered command now maps to a
real, working action, per the fluidity invariant.

Files changed: `concord-frontend/app/lenses/plumbing/page.tsx` only. No
backend changes — the 29 macros were already correct (the file's own
inline comments record the `pipeSize`/`waterHeaterSize` formula fixes
landing in an earlier pass; both are re-verified above).

## Investigated and honestly deferred

The 7 removed tabs beyond Jobs/Invoices had no backing macro. Disposition
per capability, using the DATA-SOURCING / ENGINEERING / CURATION triage:

| Removed tab | Real capability today | Disposition |
|---|---|---|
| **Estimates** | `invoiceFromQuote` already models "quote → invoice" as one step (an issued invoice with `status:"issued"`, payable via `invoiceRecordPayment`). | Substantially covered — not deferred. A true pre-approval *Estimate* stage (separate from an issued invoice, with an accept/decline step) is a real but minor product gap. **ENGINEERING** — a small addition to `invoiceFromQuote`'s status machine (`draft`→`sent`→`accepted`→invoiced), not undertaken here to keep this pass surgical to the found defect. |
| **Codes** (IPC/UPC reference library) | The four calculators *cite* code sections in their output (e.g. `drainSlope`'s `ipcCode` field), but there's no standalone, searchable code-reference macro. | **GENUINELY MISSING — CURATION.** A real code library needs licensed/curated IPC/UPC text (the current calculators encode only the specific numeric thresholds they need, not the full code). Building this without a real, rights-clear source would mean either fabricating code text (a honesty violation) or scraping a source we don't have rights to reproduce — deferred pending a real source. |
| **Materials** (catalog/reference, distinct from stock) | `partStock`/`partList` already track on-hand inventory + reorder points — a real, wired parts system, just framed as *stock*, not a browsable materials *catalog* (SKUs/spec sheets independent of what's currently stocked). | **GENUINELY MISSING — CURATION.** A distinct material catalog (spec sheets, manufacturer part numbers) needs sourced reference data this domain doesn't have. The parts-inventory system already covers the operational need (what's on the truck); deferred. |
| **Clients (CRM)** | Client name is a field on `dispatchAssign`/`invoiceFromQuote`/`planCreate`, but there's no persisted Client entity (so a phone/email/address typed once doesn't autocomplete future jobs for the same client). | **GENUINELY MISSING — ENGINEERING.** A real fix is a small new `clientAdd`/`clientList` macro pair plus autocomplete wiring in `FieldServiceConsole`'s job/invoice/plan forms. Out of scope for this surgical defect-removal pass; flagged for a future ENGINEERING unit. |
| **Inspections** | The tech workflow (`workflowStart`/`workflowUpdate`) covers on-site checklist + photo + signature, but not municipal inspection scheduling or pass/fail records against a jurisdiction. | **GENUINELY MISSING — ENGINEERING.** No macro, no table. Deferred. |
| **Certs** | `techAdd`'s `skills` field is a freeform tag list (e.g. `["drain","gas"]`), not a formal certification record with issuing body + expiry date. | **GENUINELY MISSING — ENGINEERING.** Deferred. |
| **Map** (job-site locations) | Dispatch assignments carry `address` (a string) but no `lat`/`lng` — there's no geocoding step anywhere in the domain. | **GENUINELY MISSING — ENGINEERING** (needs a geocoding integration, e.g. an address→coordinates macro backed by a real geocoding API/key). Deferred — faking coordinates from an address string would be a direct honesty violation. |

None of these were faked to fill the gap. Each is either substantially
covered by an existing real macro (Estimates) or requires new backend work
this pass didn't do (the rest) — the removed page no longer implies these
capabilities exist when they don't.

## Verification

- `node --check server/domains/plumbing.js` → passes (backend untouched).
- `node --test server/tests/depth/plumbing-behavior.test.js` → 1/1 pass
  (all 29 macros, exact-value + CRUD-lifecycle + validation-rejection
  assertions, unmodified).
- `cd concord-frontend && npx eslint app/lenses/plumbing/page.tsx
  components/plumbing/*.tsx` → clean, 0 errors/warnings.
- `cd concord-frontend && npx tsc --noEmit -p .` → no errors attributable
  to `lenses/plumbing` or `components/plumbing`.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260 — plumbing reports WIRED; the two by-design
  NO-BACKEND-CALL lenses (`narrative-walk`, `ux-suite`) are unchanged.
- `node scripts/grade-ux-polish.mjs --honest` → plumbing entry:
  `tier: "polished"`, `antiPatterns: 0`, `pillarsPresent: 5`
  (`fileCount: 4`, `totalLoc: 1468`). `audit/` reverted after the run
  (`git checkout -- audit/ux-polish.json audit/ux-polish-gaps.md`).

## Left alone, with reason

- `FieldServiceConsole.tsx`, `PlumbCalc.tsx`, `PlumbingFeed.tsx` —
  untouched; already DESIGNED, already wired to real macros, no defects
  found on read-through (field shapes cross-checked against
  `server/domains/plumbing.js` and the `{artifact:{data}}` dispatch-layer
  unwrap in `server/lib/lens-input-normalize.js`, which exists precisely
  to support the wrapper shape `PlumbCalc.tsx`'s `callPlumbing()` sends).
- `LensShell`, `LensPageShell`, `ManifestActionBar`, `DepthBadge`,
  `FirstRunTour`, `RecentMineCard`, `AutoActionStrip`,
  `CrossLensRecentsPanel` — kept as-is. These are the platform's shared,
  non-lens-specific chrome primitives (used across ~250+ lenses), not an
  instance of this lens's defect pattern; removing them would be
  unrelated scope creep.
- `server/domains/plumbing.js` — no changes. All 29 macros were already
  correct and already carried real behavioral tests before this pass
  (including a prior fix to the `pipeSize`/`waterHeaterSize` formulas
  recorded in the file's own inline comments).
