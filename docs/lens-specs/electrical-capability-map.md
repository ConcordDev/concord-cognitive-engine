# Electrical Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every claim below is backed by a grep/read against
> the working tree, reproduced inline.

## Reference apps

Two precise analogs for the two halves of this lens's job:

- **Field-service/estimating side**: **Jobber** / **ServiceTitan** (job
  tracking, client CRM, estimate→invoice conversion, materials price book,
  license/cert tracking for the crew).
- **Engineering/code-compliance side**: **Mike Holt NEC calculator suite**
  (the trade-standard reference calculators — load calc, conduit fill, box
  fill, wire sizing, voltage drop) plus a lightweight one-line-diagram tool
  in the shape of **ETAP/SKM PowerTools** (scaled down to a hand-tool, not a
  full arc-flash/power-systems study package).

## Backend audit

`server/domains/electrical.js` (982 lines, domain `'electrical'`):

```
$ grep -n "registerLensAction('electrical'" server/domains/electrical.js | wc -l
34
```

34 macros, all try/catch wrapped, all fail-closed on poisoned numeric input
(`num()` sanitizer — NaN/Infinity/negative never leak into a safety
verdict). Four clusters:

1. **Pure-math NEC calculators** (no persistence): `loadCalculation`,
   `voltageDropCalc`, `circuitTrace`, `safetyInspection`, `conduitFill`,
   `boxFill`, `wireSize`. Every one computes from real NEC reference tables
   hardcoded at the top of the file (`AMPACITY_75C` = NEC Table 310.16 @
   75°C copper, `RES_PER_1000FT` = NEC Chapter 9 Table 8, `THHN_AREA` /
   `CONDUIT_40PCT` / `CONDUIT_100PCT` = NEC Chapter 9 Tables 4/5,
   `BOX_FILL_VOL` = NEC Table 314.16(B)). No canned/static results — inputs
   flow through real arithmetic (ampacity lookup, `Ω/1000ft × distance ×
   amps × phase-factor` for voltage drop, fill-percent-vs-conduit-area
   search, box-fill-equivalents summation). A real, previously-fixed bug is
   documented inline (lines 178–183): the voltage-drop wire-upgrade ladder
   used to walk the wrong direction and could tell a user a 30% drop was
   "within acceptable limits" — now fixed and comment-pinned so it can't
   regress silently.
2. **Panel Schedule Builder** (persistent): `panelCreate/List/AddCircuit/
   RemoveCircuit/Delete/Schedule` — per-user panels with circuits, breaker
   sizing, phase-leg (A/B) amperage balance, and the NEC 80%-continuous-load
   rule.
3. **Estimate → Invoice flow** (persistent): `estimateCreate/List/AddLine/
   RemoveLine/Delete/ToInvoice`, `invoiceList/MarkPaid` — real labor +
   material line items, tax calc, and a one-way convert-to-invoice
   transition (`est.invoiceId` guards against double-conversion).
4. **One-Line Diagram** (persistent): `diagramCreate/List/AddNode/
   RemoveNode/Delete` — a node/edge tree (utility→meter→panel→
   subpanel/loads) with a validated kind enum.
5. **Inspection Checklists** (persistent, authored templates):
   `checklistTemplates/Create/List/SetItem/Delete` — 4 authored NEC
   checklists (rough-in, service/panel, final, EV charger), each item
   citing a real NEC section (e.g. `250.148`, `210.8`, `625.41`).
6. **Material Price List** (persistent): `priceListGet/Upsert/Remove` —
   seeds from a real 16-item US-trade ballpark catalog on first access,
   fully editable per user.

No inline `registerLensAction('electrical'` registrations exist outside
this file (`grep -n "registerLensAction('electrical'" server.js` → empty),
and no unrelated cross-file collisions:
`server/domains/telecommunications.js` (959 lines, domain
`'telecommunications'`) shares zero macros or code with `electrical.js` —
confirmed by grep (`grep -n "electrical" server/domains/telecommunications.js`
→ empty). Not touched.

`node scripts/lens-unsurfaced.mjs --lens electrical` → **`0/34 macros never
referenced in the frontend`**. Every backend macro is already reached by
frontend code.

`server/lib/lens-manifest.js` / `lens-features.js` / `lens-features-
extended.js` have no dedicated electrical feature-catalog entries beyond
the generic `trades` grouping (`"electrical"` appears once, in a shared
`trades: [...]` array at `lens-manifest.js:185`) — the lens's real
feature surface lives entirely in the domain file + bespoke components,
not in the manifest catalog.

## Frontend audit (before this pass)

`concord-frontend/app/lenses/electrical/page.tsx` (801 lines, pre-edit) +
`concord-frontend/components/electrical/*.tsx` (8 files, 1,837 LOC):

**The 8 components are genuinely real** — every one calls a real
`electrical.*` macro via `lensRun`/`apiHelpers.lens.runDomain`, renders
only what the macro returns, and starts empty (verified by reading all 8
files in full):

| Component | Macros called | Notes |
|---|---|---|
| `NecCalculators.tsx` | `conduitFill`, `boxFill`, `wireSize` | Header explicitly documents "every value rendered is returned by an electrical.\* macro. No mock data." — verified true by reading the code. |
| `NecCodeCalc.tsx` | `loadCalculation`, `voltageDropCalc`, `circuitTrace`, `safetyInspection` | 4 visually-distinct bespoke widgets incl. an SVG voltage-drop-vs-distance chart with a live 3% NEC threshold line. |
| `PanelScheduleBuilder.tsx` | `panel*` (6 macros) | Circuit table + phase-balance bar chart, real breaker/wire-gauge display per circuit. |
| `EstimateInvoiceFlow.tsx` | `estimate*`, `invoice*`, `priceListGet` | Labor/material line items, price-list-driven material picker, tax calc, convert-to-invoice. |
| `OneLineDiagram.tsx` | `diagram*` (5 macros) | Renders via the shared `TreeDiagram` viz component with per-kind tone coloring. |
| `InspectionChecklists.tsx` | `checklist*` (5 macros) | Authored NEC templates, live pass/fail/critical verdict. |
| `MaterialPriceList.tsx` | `priceList*` (3 macros) | Editable catalog, seeded from the real default catalog. |
| `OpenHardwarePulse.tsx` | GitHub Search API (not an `electrical.*` macro — a live external feed) | Real network call to `api.github.com`, no fabricated repo data; honest `isError`/empty states. |

**The defect was in `page.tsx`, not the components.** The page mounted a
**second, disconnected system** on top of the real one: a generic
artifact-CRUD shell (`useLensData` against a generic `/api/lens/electrical`
artifact store — persisted, not fabricated, but domain-logic-free) exposing
8 `MODE_TABS`: **Jobs, Estimates, NEC Codes, Materials, CRM, Invoices,
Inspections, Certs** — driven by one shared multi-purpose form
(`renderEditor`) with conditionally-rendered fields per type. Four of those
eight tabs collided head-on with a real, superior Trade Tool a few tabs
over:

- Generic **"Estimates"** tab → flat `laborHours × laborRate +
  materialCost` with no line items, no price-list integration, no tax
  calc — vs. the real **"Estimate→Invoice"** Trade Tool's itemized
  labor/material lines, tax rate, and actual invoice conversion.
- Generic **"Materials"** tab → a hardcoded 16-item dropdown
  (`ELECTRICAL_MATERIALS`) with a quantity field, going nowhere — vs. the
  real **"Price List"** Trade Tool, which is the user's actual editable
  catalog that the real Estimate tool draws from.
- Generic **"Invoices"** tab → a flat `amount` field — vs. the real
  **invoice view inside "Estimate→Invoice"**, which shows real invoice
  numbers, totals, paid/outstanding summaries, and mark-paid actions tied
  to actual converted estimates.
- Generic **"Inspections"** tab → free-typed inspector/result/deficiencies
  fields (never even exposed in the editor form — see below) — vs. the
  real **"Inspections"** Trade Tool, which instantiates one of 4 authored
  NEC checklist templates and computes a real pass/fail/critical verdict.

Classification: **not fabricated data** (the generic tabs did persist real
records, just to a domain-agnostic store) but a genuine
**disconnected-generic-CRUD** defect — two same-named features that do not
interoperate, where a user filling in the generic "Estimate" would
reasonably expect it to behave like (or feed) the real estimate/invoice
pipeline, and it silently doesn't. This is exactly the failure mode
`docs/FRONTEND_REBUILD_PROGRAM.md` and this repo's `CLAUDE.md` warn against
("real macros … disconnected … generic CRUD standing in for a real N-macro
engine" — here inverted: a real engine sitting right next to a
disconnected generic stand-in for the same concept).

**Dead/unreachable fields, found by usage-count grep.** Several fields
declared on the shared `TradeArtifact` interface were never wired to any
input in `renderEditor`, meaning a user could never actually set them:
`codeReference`, `codeSection`, `jurisdiction` (declared for the "NEC
Codes" `CodeRef` type — the tab existed but had no way to record an actual
code number), `certNumber`, `expiryDate`, `issuedBy` (declared for
"Certs" — no way to record a license number or renewal date), and `email`
(declared for client info — no input). Confirmed by grep: each of these
appeared exactly once in `page.tsx` (the interface declaration) before this
pass.

## What changed

Scope: `concord-frontend/app/lenses/electrical/page.tsx` only. No backend
changes — `server/domains/electrical.js` was read in full and found to
already be genuinely comprehensive and correct; no gap needed closing
there. No changes to any of the 8 already-real `components/electrical/*`
files — they needed none.

1. **Removed the 4 duplicate/conflicting generic tabs** (`Estimates`,
   `Materials`, `Invoices`, `Inspections`) from `MODE_TABS`, `ArtifactType`,
   and `ModeTab`, along with their now-dead form fields (`quantity`,
   `unit`, `unitPrice`, `supplier`, `invoiceNumber`, `dueDate`, `paidDate`,
   `amount`, `inspector`, `result`, `deficiencies`, `amperage`,
   `circuitType` — all confirmed dead by the same usage-count grep) and the
   `ELECTRICAL_MATERIALS` dropdown array. The real Trade Tools now own
   those workflows exclusively — no more same-named, non-interoperating
   pair.
2. **Fixed the dead-field defect** for the 4 tabs that remain (Jobs, NEC
   Code Notes, CRM, Certs — none of which duplicate a Trade Tool):
   - "NEC Code Notes" (renamed from "NEC Codes" for honesty — it's a
     personal quick-reference bookmark list, not a live code database) now
     has real inputs for NEC section, article/chapter, and jurisdiction
     (AHJ). Previously these fields existed only in the TypeScript
     interface and were unreachable.
   - "Certs" now has real inputs for license/cert number, expiry date, and
     issuing body, previously unreachable the same way.
   - Client info (used by both Job and Client types) now has an email
     field alongside phone, previously declared-but-unreachable.
   - Added an inline honesty note on the Job form's flat labor/material
     fields pointing users at the real Estimate→Invoice tool for an actual
     itemized bid — so the simpler Job-tracking fields don't read as if
     they were the estimating feature.
3. Fixed two now-dead-reference bugs introduced by the type narrowing:
   `renderDashboard`'s revenue sum and the item-card cost badge both used
   to fall back to a `.amount` field that no longer exists on any
   remaining type; both now read `totalCost` only.
4. Updated the page's header `description` string, which previously
   promised "estimates, materials, invoicing, inspections" as if they were
   still generic tabs — now accurately describes the surviving generic
   tabs plus a pointer at the Trade Tools section.

Nothing was removed from the six real Trade Tool tabs (Panel Schedule, NEC
Calculators, Estimate→Invoice, One-Line, Inspections, Price List), the
always-on `NecCodeCalc` section, or `OpenHardwarePulse`. The shared
cross-lens substrate (`ManifestActionBar`, `UniversalActions`,
`AutoActionStrip`, `RecentMineCard`, `CrossLensRecentsPanel`) was left in
place — it's a real, hideWhenEmpty-gated, non-fabricating cross-lens
pattern used by ~260 lenses, and this lens has more than enough bespoke
surface (see verification below) that its presence doesn't make the page
read as generic.

## Verification

- `cd concord-frontend && npx eslint app/lenses/electrical/page.tsx components/electrical/*.tsx` — clean, no output.
- Manual TypeScript read-through: `ModeTab`/`ArtifactType`/`TradeArtifact`
  narrowed consistently; every removed field's last reference confirmed
  gone (`grep -n "formMaterial\|formQuantity\|formAmount\|ELECTRICAL_MATERIALS\|'Estimate'\|'Material'\|'Invoice'\|'Inspection'" page.tsx` →
  empty); every new field (`email`, `certNumber`, `expiryDate`, `issuedBy`,
  `codeReference`, `codeSection`, `jurisdiction`) has a matching
  `useState` + editor input + save/load wire. Project-wide `tsc` was not
  run directly (per instructions, to avoid racing 5 concurrent sibling
  agents); a standalone path-alias-free `tsc` pass on the single file
  surfaced only expected `@/...` module-resolution noise, no logic errors.
- `node scripts/lens-unsurfaced.mjs --lens electrical` — unchanged,
  `0/34 macros never referenced in the frontend`.
- `node scripts/grade-ux-polish.mjs` (single reference run, transient
  `audit/ux-polish*.json` output reverted afterward with `git checkout`
  per the repo's transient-artifact convention) — `electrical`:
  `tier: "polished"`, `isGenericScaffold: false`, `bespokeRatio: 0.692`,
  `pageLoc: 822` (>= the 700-line bespoke-page exemption threshold on its
  own, before even counting the 1,845 LOC of bespoke `components/
  electrical/*`). Confirms the generic-trio imports that remain
  (`ManifestActionBar`/`AutoActionStrip`/`RecentMineCard`/
  `UniversalActions`) do not, and should not, cap this lens below
  `polished` — it has substantial bespoke design by any measure the
  grader applies.

## Honest summary

This lens was **already genuinely good** on the backend and in 8 of its 9
frontend files — a rare case where the assigned fix was subtractive
(delete a confusing duplicate system) plus a small number of real
dead-field repairs, not a rebuild. No new macros were written, no existing
macro was touched, and no fabricated data was found anywhere in the
lens.
