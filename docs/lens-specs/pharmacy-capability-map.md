# Pharmacy Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/pharmacy.js` (1,396 LOC, real OpenFDA/RxNav/CMS-NADAC
> integrations) and `server/domains/pharmacy-live.js` (a second real
> registration file under the same `"pharmacy"` domain name) in full, then
> cross-checked against every `.tsx` file in `concord-frontend/components/
> pharmacy/` and `concord-frontend/app/lenses/pharmacy/page.tsx`.
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("pharmacy"' server/domains/pharmacy.js server/domains/pharmacy-live.js`
> — 51 macros in `pharmacy.js` + 3 in `pharmacy-live.js` = 54 total under
> the `pharmacy` domain.

## The headline finding

This lens's suspicious profile (690-line `page.tsx`, longest of the batch,
yet graded generic scaffold) had a different shape than the typical Wave 2
defect. There was no single fabricated CRUD subsystem masquerading as the
whole app (contrast: supplychain's 7-artifact-type fake ledger). Instead:

1. **A real, comprehensive GoodRx+Medisafe-parity component suite already
   existed** — `PharmacyRxSection.tsx` + 7 real sub-panels
   (`RxMedicationsPanel`, `RxRemindersPanel`, `RxRefillsPanel`,
   `RxPricePanel`, `RxPriceLookupPanel`, `RxAdherencePanel`,
   `RxHealthLogPanel`) covering 30 of the 51 `pharmacy.js` macros, plus a
   polished `FdaDrugReference.tsx` (label/adverse/interactions deep-dive)
   and `FdaLivePanel.tsx` (multi-result browse + recalls). These are real:
   every panel calls `lensRun('pharmacy', '<macro>', ...)` and renders the
   literal response shape, with honest loading/empty/error handling.
2. **But it was buried.** `page.tsx` mounted `<PharmacyRxSection />` in a
   single `<div className="px-4 mt-3">` near the top, then continued for
   another ~500 lines of unrelated content.
3. **That remaining ~500 lines were exactly the flagged defect class**: a
   **fake medication/interaction CRUD system** (`useLensData('pharmacy',
   'medication', ...)` and `useLensData('pharmacy', 'interaction', ...)`)
   — a generic DTU-artifact store with invented fields (`rxcui`, `route`,
   `refillsLeft`, `status: 'active'|'pending'|'discontinued'`) that has
   **zero relationship to any of the 51 real macros**. A user could type a
   fake drug name into this system's "Add Medication" form and see it
   rendered with fabricated "Ready"/"Processing" Rx-status badges, a fake
   inventory bar chart, and fake "Drug Interaction Warning" pills — while
   the REAL medication tracker (`PharmacyRxSection`) sat one scroll away,
   tracking a completely different, disconnected list. This is the exact
   "fabricated success state presented as real data" pattern CLAUDE.md's
   honest-by-construction rule prohibits.
4. **On top of that, a ~220-line duplicate "Pharmacy Analysis Engine"
   panel** re-implemented `drugInteractionCheck`/`dosageCalculator` via a
   third dispatch path (`useRunArtifact` keyed to the fake medication
   list's first id) — a third, redundant UI surface for macros
   `PharmacyActionPanel.tsx` and `FdaDrugReference.tsx` already covered,
   plus the page's **only** callers of `inventoryAlert` and
   `formularySearch` (two real macros with no other UI home).
5. **The generic-scaffold trio was also present** (`ManifestActionBar`,
   `AutoActionStrip`, `RecentMineCard`, `CrossLensRecentsPanel`,
   `LensFeaturePanel`) plus a permanently-dark realtime strip
   (`useRealtimeLens`/`LiveIndicator`/`RealtimeDataPanel` — pharmacy has no
   entry in `hooks/useRealtimeLens.ts`'s `DOMAIN_EVENTS`, so `isLive` was
   always `false`) and a `DTUExportButton` called with `data={{}}` — a
   literal always-empty export payload.

So: **real backend depth (54 macros, 3 real external integrations:
OpenFDA, RxNav/NLM, CMS NADAC) + real, well-built frontend depth (10
components covering 30 macros) — sitting disconnected beside a fabricated
duplicate surface and generic scaffold that together accounted for most of
the file's line count and its "scaffold" grade.** This rebuild's job was
almost entirely *subtraction and consolidation*, not net-new construction,
with five small additions to close genuinely unsurfaced macros.

## Backend surface — 54 macros across 2 files, real integrations, no stubs

**External data sources, verified in code**: OpenFDA (drug labels, FAERS
adverse events, SPL cross-mention interaction signal, NDC/pill-imprint
search, drug recalls — free, `api.fda.gov`), RxNav/NLM (RxNorm name
normalization + a graded ONCHigh/DrugBank interaction API —
`rxnav.nlm.nih.gov`), CMS NADAC (National Average Drug Acquisition Cost,
`data.medicaid.gov`). All three are genuinely free, keyless, public
federal/NLM APIs — not fabricated network calls.

| Macro | Real result shape (key fields) | Classification (before this rebuild) |
|---|---|---|
| `drugInteractionCheck` | OpenFDA SPL cross-mention signal between 2+ drugs' label text | **DESIGNED** (`FdaDrugReference`, `PharmacyActionPanel`) — ALSO reachable via the fake duplicate panel (redundant, not fake) |
| `drug-label` | Full FDA label (indications/warnings/contraindications/dosing/mechanism/pregnancy) | **DESIGNED** (`FdaDrugReference`, `PharmacyActionPanel`) |
| `adverse-events` | FAERS report count + top reactions | **DESIGNED** (`FdaDrugReference` bar chart, `PharmacyActionPanel`) |
| `dosageCalculator` | mg/kg dose calc, fail-closed on non-finite input, capped at max daily | **DESIGNED** (`PharmacyActionPanel`) — ALSO reachable via the fake duplicate panel |
| `inventoryAlert` | low-stock/expired/near-expiry scan over a caller-supplied inventory list | **GENERIC-STRIP-ONLY** → wired this session (`RxFormularyToolsPanel`, new) |
| `formularySearch` | tier/coverage/prior-auth lookup over a caller-supplied formulary list | **GENERIC-STRIP-ONLY** → wired this session (`RxFormularyToolsPanel`, new) |
| `med-add`/`med-list`/`med-archive` | medication CRUD (name/strength/form/quantity/refills) | **DESIGNED** (`RxMedicationsPanel`) |
| `med-detail` | single medication + schedule + 30d adherence + days-of-supply | **UNSURFACED** → wired this session (`RxMedicationsPanel` details expand) |
| `med-update` | edit strength/condition/prescriber/quantity/refills | **UNSURFACED** → wired this session (`RxMedicationsPanel` inline edit) |
| `schedule-set` | dose-time schedule per medication | **DESIGNED** (`RxMedicationsPanel`) |
| `dose-log` | log taken/skipped/missed, decrements quantity on taken | **DESIGNED** (`RxMedicationsPanel` Today's doses) |
| `dose-history` | per-medication dose log, newest first | **UNSURFACED** → wired this session (`RxMedicationsPanel` details expand) |
| `today-doses` | today's scheduled doses with taken/pending status | **DESIGNED** (`RxMedicationsPanel`) |
| `adherence-report` | 30-day adherence % overall + per-medication | **DESIGNED** (`RxMedicationsPanel` header stat) |
| `adherence-calendar` | day-by-day scheduled/taken grid for heatmap | **DESIGNED** (`RxAdherencePanel`) |
| `adherence-streak` | current/best streak + earned badges | **DESIGNED** (`RxAdherencePanel`) |
| `refill-request`/`refill-list`/`refill-update` | refill lifecycle (requested→processing→ready→picked_up) | **DESIGNED** (`RxRefillsPanel`) |
| `refills-due` | medications with ≤7 days of supply | **DESIGNED** (`RxRefillsPanel`) |
| `pharmacy-add`/`pharmacy-list` | user's saved pharmacies | **DESIGNED** (`RxRefillsPanel`) |
| `price-record`/`price-list` | self-recorded cash/coupon prices per pharmacy | **DESIGNED** (`RxPricePanel`) |
| `price-compare` | ranks self-recorded prices, computes savings | **DESIGNED** (`RxPricePanel`) |
| `coupon-list` | saved coupons | **DESIGNED** (`RxPricePanel`, list-only) |
| `coupon-save` | save a coupon (drug/pharmacy/discounted price/code) | **UNSURFACED** → wired this session (`RxPricePanel` "Save coupon" form) |
| `price-lookup` | live CMS NADAC acquisition-cost reference via RxNorm | **DESIGNED** (`RxPriceLookupPanel`) |
| `pill-identify` | OpenFDA SPL imprint/color/shape signal match | **DESIGNED** (`RxPriceLookupPanel`) |
| `measurement-log`/`measurement-history` | BP/weight/glucose/heart-rate/temp/oxygen tracking + trend | **DESIGNED** (`RxHealthLogPanel`) |
| `journal-add`/`journal-list` | symptom/mood journal | **DESIGNED** (`RxHealthLogPanel`) |
| `pharmacy-dashboard` | medications/today-doses/adherence30d/refillsDue/openRequests | **DESIGNED** (was `PharmacyRxSection` header; now ALSO the new `PharmacyOverview` landing dashboard) |
| `reminder-set`/`reminder-list`/`reminder-toggle`/`reminder-delete` | per-medication dose reminders + real browser Notification API | **DESIGNED** (`RxRemindersPanel`) |
| `reminder-due` | which reminders fire in a time window, cross-referenced against today's log | **DESIGNED** (`RxRemindersPanel`, polled every 60s for real notifications) |
| `caregiver-add`/`caregiver-list`/`caregiver-remove` | Medfriend-style caregiver contacts | **DESIGNED** (`RxRemindersPanel`) |
| `caregiver-alerts` | which caregivers should be notified now (missed doses / low refills) | **DESIGNED** (`RxRemindersPanel`) |
| `autoreorder-set`/`autoreorder-list`/`autoreorder-remove`/`autoreorder-run` | per-medication refill auto-reorder threshold + manual run | **DESIGNED** (`RxAdherencePanel`) |
| `interaction-grade` | RxNav ONCHigh/DrugBank graded clinical interaction data | **DESIGNED** (`RxAdherencePanel`) |
| `feed` | ingests real FDA drug-recall enforcement reports as DTUs | **GENERIC-STRIP-ONLY** (`LensFeedButton`, kept — relocated to `PharmacyOverview`) |

*(51 rows above cover all of `pharmacy.js`'s registered macros; the 3
`pharmacy-live.js` macros — `live_label_lookup`, `live_adverse_events`,
`live_recalls` — are consumed by `FdaLivePanel.tsx`, kept as-is, and
classified **DESIGNED**.)*

**Net macro disposition change from this rebuild**: 5 macros moved from
UNSURFACED/GENERIC-STRIP-ONLY to DESIGNED (`inventoryAlert`,
`formularySearch`, `med-detail`, `med-update`, `dose-history`,
`coupon-save` — six, not five; corrected count). Zero macros were newly
built on the backend — every fix here is frontend wiring onto existing,
already-real handlers.

## 1.5 Reference-parity checklist

**Reference apps**: [Medisafe](https://medisafeapp.com/features/)
(medication reminders, adherence tracking, Medfriend caregiver alerts,
health measurement logging — the code's own header comment says
"GoodRx + MyTherapy 2026 parity", and MyTherapy's feature set converged
with Medisafe's over recent years, so Medisafe is used as the current
canonical reference) and [GoodRx](https://www.goodrx.com/) (price
comparison, coupons, pill identifier). Both researched via web search,
2026-07-09 (Apple/Google store listings + goodrx.com/how-goodrx-works).

**Parity statement**: the only difference should be that GoodRx's live,
crowd-sourced multi-pharmacy price index (70,000+ real participating
pharmacies) is replaced here by (a) a self-recorded price ledger the user
fills in themselves and (b) a live CMS wholesale-acquisition-cost
reference — a genuinely different, honestly-labeled data source, not a
degraded copy of GoodRx's live retail feed. Everything else (reminders,
adherence, interaction checking, pill ID, coupons, caregiver alerts,
refill tracking) should be a designed, real-data feature here exactly as
in the reference apps.

| # | Checklist item | Disposition | Justification |
|---|---|---|---|
| 1 | Pill reminders/alarms with complex schedules + as-needed meds | **ALREADY REAL** | `reminder-set`/`schedule-set` — arbitrary HH:MM times, lead-minutes, real browser `Notification` API firing (`RxRemindersPanel`) |
| 2 | Snooze / reschedule / mark taken-missed | **ALREADY REAL** (snooze partial) | `dose-log` supports taken/skipped/missed; `reminder-set`'s `snoozeMinutes` field exists server-side but has no dedicated snooze-button UI — **minor, deferred**: low-value polish, not a functional gap (dismiss-and-re-set already covers the same outcome) |
| 3 | Daily/weekly/monthly adherence + shareable report | **ALREADY REAL** | `adherence-report`/`adherence-calendar`/`adherence-streak` (`RxMedicationsPanel`, `RxAdherencePanel`) |
| 4 | Drug-drug interaction checker | **ALREADY REAL** | `drugInteractionCheck` (SPL cross-mention signal) + `interaction-grade` (RxNav ONCHigh/DrugBank clinical grading) — both real, correctly disclaimed as signal-not-clinical-truth |
| 5 | Family/caregiver support (Medfriend) | **ALREADY REAL** | `caregiver-add`/`list`/`remove`/`alerts` (`RxRemindersPanel`) |
| 6 | Refill reminders + auto-reorder | **ALREADY REAL** | `refill-request`/`refills-due`/`autoreorder-*` (`RxRefillsPanel`, `RxAdherencePanel`) |
| 7 | Doctor-appointment manager / calendar | ~~**GENUINELY MISSING — DEFERRED-SCOPED-BUILD**~~ **CLOSED (2026-07-16, `6290da47`)** | New `appointment-add`/`list`/`update`/`delete` + `appointments-due` macros, modeled on `refill-request`/`list`/`update`/`refills-due`. Real status state machine (`scheduled` → `completed`/`cancelled`/`missed`, each terminal — status and rescheduling both lock once terminal, but notes stay editable afterward). `relatedMedId` is optional and validated via the existing `findMed` lookup — a bogus id is honestly rejected, no medication link is a completely normal case. New `RxAppointmentsPanel.tsx` with a real medication picker (populated from `med-list`, not free text), mounted as a new "Appointments" tab. |
| 8 | Health measurement tracking (BP/glucose/weight/etc for chronic conditions) | **ALREADY REAL** | `measurement-log`/`measurement-history` across 6 kinds (`RxHealthLogPanel`) |
| 9 | Weekend mode / per-day schedule / auto timezone | **PARTIALLY REAL** | `schedule-set`'s `daysOfWeek` array covers per-day scheduling (used by `today-doses`); there is no dedicated "weekend mode" toggle or client timezone auto-detect UI — **minor, deferred**, low value relative to effort |
| 10 | AI-powered adherence prediction (Medisafe's 2025 feature) | **GENUINELY MISSING — DEFERRED-SCOPED-BUILD** | No backend macro; would need a new predictive model, clearly out of scope for a frontend rebuild |
| 11 | Cash/coupon price comparison across pharmacies | **ALREADY REAL, HONEST RELABEL** | `price-compare` ranks prices the **user has recorded** (`RxPricePanel`), not a live crowd-sourced index across thousands of pharmacies — this was already correctly labeled ("Record a price" / "Compare prices") in the existing component, not a fabricated "live GoodRx feed" claim. No change needed; noted here so the gap is explicit rather than silently assumed away |
| 12 | Live wholesale/reference pricing | **ALREADY REAL** | `price-lookup` — CMS NADAC acquisition-cost reference via RxNorm normalization (`RxPriceLookupPanel`), correctly disclaimed as "not a retail price quote" |
| 13 | Coupons, saved and usable | **PARTIALLY REAL → WIRED THIS SESSION** | `coupon-list` existed with no way to add one; `coupon-save` was completely unsurfaced. Added a "Save coupon" structured form to `RxPricePanel` this session |
| 14 | Pill identifier | **ALREADY REAL** | `pill-identify` — OpenFDA SPL imprint/color/shape signal match (`RxPriceLookupPanel`), correctly disclaimed as signal-only |
| 15 | Save medication list / drug guide / medicine tracker | **ALREADY REAL, extended this session** | `med-add`/`list`/`archive` were wired; `med-detail` (schedule + adherence + days-of-supply) and `med-update` (edit strength/condition/prescriber/quantity/refills) were completely unsurfaced — wired this session as a per-medication "Details" expand + inline "Edit" form in `RxMedicationsPanel` |
| 16 | Dose history / audit trail | **UNSURFACED → WIRED THIS SESSION** | `dose-history` had no caller; folded into the same "Details" expand added above |
| 17 | Find a doctor / virtual care | **OUT OF SCOPE BY DOMAIN BOUNDARY** | This is telehealth's job (`healthcare.telehealth-create`, a real WebRTC video client per CLAUDE.md), a separate lens — not a pharmacy gap |
| 18 | Physical pharmacy locator (70,000+ locations, geolocation) | **GENUINELY MISSING — DEFERRED-SCOPED-BUILD** | `pharmacy-add`/`pharmacy-list` are user-entered contacts, not a live geocoded pharmacy directory API; would need a new integration (e.g. NPI registry or a commercial pharmacy-locator API), out of scope |

**Coverage summary**: 12 of 18 checklist items already real before this
session; 3 items (coupons/med-detail+update/dose-history) newly wired this
session onto already-real backend handlers; 1 item resolved as an honest
non-issue (price comparison was already correctly labeled, not a
fabricated live feed); 2 items explicitly deferred as scoped future
backend builds (appointment manager, live pharmacy locator); 1 item
(AI adherence prediction) explicitly deferred as out of scope for a
frontend-only rebuild; 1 item (out-of-scope domain boundary) correctly
belongs to a different lens. **No silent gaps.**

## 2. What this rebuild changed

**Killed the fake medication/interaction CRUD system** — the page's
`useLensData('pharmacy', 'medication', {seed:[]})` and
`useLensData('pharmacy', 'interaction', {seed:[]})` generic DTU-artifact
lists, the "Medications" / "Interactions" / "Refills" tabs built on top of
them (with invented `rxcui`/`route`/`refillsLeft`/`status` fields and fake
"Rx Status: Ready/Processing/Refill Needed" badges + a fake inventory bar
chart), and the search box that filtered this fake list. This was a
**disconnected parallel universe of fake medications** sitting beside the
real `PharmacyRxSection` medication tracker — a textbook instance of the
"fabricated success state presented as real data" pattern this program's
prior waves have repeatedly found and killed.

**Killed the duplicate ~220-line "Pharmacy Analysis Engine" panel** — a
third UI surface for `drugInteractionCheck`/`dosageCalculator` (already
covered by `PharmacyActionPanel` and `FdaDrugReference`) dispatched via
`useRunArtifact` keyed to the fake medication list's first id (a
meaningless id once the fake list is gone). Its two macros with no other
caller (`inventoryAlert`, `formularySearch`) were preserved by giving them
a real, structured home — see below.

**Retired the generic-scaffold dependency** (`isGenericScaffold` signature
per the program's honest grader): removed `ManifestActionBar`,
`AutoActionStrip`, `RecentMineCard`, `CrossLensRecentsPanel`,
`LensFeaturePanel`. Also removed the permanently-dark realtime strip
(`useRealtimeLens`/`LiveIndicator`/`RealtimeDataPanel` — confirmed via
`grep pharmacy hooks/useRealtimeLens.ts`: no `DOMAIN_EVENTS` entry exists
for this domain, so `isLive` was always `false`) and `DTUExportButton`
(was called with a literal `data={{}}` — an always-empty export payload,
its own honesty smell).

**New `PharmacyOverview.tsx`** — the landing destination. Real
`pharmacy-dashboard` fetch via `useMacroDispatchFeedback` (dispatched/
running/done/error lifecycle, not a hand-rolled boolean) rendered as a
`StatTileGrid` (5 real KPIs), with honest loading (`role="status"`,
`Skeleton` blocks), error (`role="alert"`, `ErrorState` with working
retry), and empty (`EmptyState` with a real "Go to My Meds" nav CTA, not a
seeded demo) states. Hosts the page-level `DensityToggle` and the real
`feed` macro's `LensFeedButton` (FDA recall → DTU ingestion).

**New `RxFormularyToolsPanel.tsx`** — structured homes for the two
stateless compute macros (`formularySearch`, `inventoryAlert`) that only
the now-deleted fake panel called. Both take caller-supplied structured
row data (not JSON-paste): a formulary-row editor (generic/brand/tier/
covered/prior-auth) + query box for `formularySearch`, and an inventory-row
editor (name/quantity/reorder point/expiry date) for `inventoryAlert`.
Uses `useMacroDispatchFeedback` for both — the mandated real dispatch-
feedback hook, exercised for the first time in this lens's component set
(the existing Rx*Panel components predate the hook and use raw `lensRun` +
hand-rolled loading state, which was left as-is on unmodified files per
the disjoint-edit discipline).

**`RxMedicationsPanel.tsx` extended** — added a per-medication "Details"
expand (wires `med-detail` + `dose-history`: condition/prescriber, days-
of-supply, 30d adherence, last 8 dose-log entries) and an inline "Edit"
form (wires `med-update`: strength/condition/prescriber/quantity/refills),
plus a client-side filter search box over the real medication list once
more than 3 medications are tracked (keeps the page's earlier
Search-medications capability, now operating on real data instead of the
retired fake list).

**`RxPricePanel.tsx` extended** — added a "Save coupon" structured form
(wires `coupon-save`), closing the read-without-write gap where coupons
could be listed but never added.

**New page shell** — 4 bespoke destinations (Overview / My Meds / Drug
Reference & Safety / Rx Bench) replacing the old single-scroll page. "Drug
Reference & Safety" nests 3 sub-tabs: Deep Dive (`FdaDrugReference`,
single-drug full-label + interaction check + FAERS chart), Browse &
Recalls (`FdaLivePanel`, multi-result search + 30-day recall feed — kept
as a legitimately distinct browse/list view, not a duplicate of the
deep-dive), and Formulary & Inventory Tools (new). "Rx Bench" hosts the
unmodified `PharmacyActionPanel` (mint-as-DTU / DM / publish / agent
patient-counseling — real, distinct actions no other surface provides)
plus a `DraftedTextarea` auto-saved notes field (kept from the old page,
relocated to a coherent context). The safety disclaimer stays outside the
destination tabs, always visible. `o`/`m`/`d`/`b` keyboard shortcuts.

**Accepted, explicit redundancy (not silently ignored)**: `PharmacyActionPanel`
still has its own Label/Interactions/Adverse/Dose quick-check buttons,
which overlap with `FdaDrugReference`'s richer deep-dive UI for the same 3
macros. This is a **real UI redundancy, not fake data** — both surfaces
call the same genuine macros — kept as-is because `PharmacyActionPanel`'s
unique value (mint-as-DTU / DM / publish / agent counsel) is built on
those same result values, and disentangling that dependency was judged
higher-risk than the redundancy is costly, within this rebuild's scope.
Flagged here as a legitimate follow-up, not a defect this rebuild missed.

## Files touched

- `concord-frontend/app/lenses/pharmacy/page.tsx` — rewritten (4-destination shell, fake CRUD + duplicate analysis panel + generic scaffold removed)
- `concord-frontend/components/pharmacy/PharmacyOverview.tsx` — new (dashboard landing view)
- `concord-frontend/components/pharmacy/RxFormularyToolsPanel.tsx` — new (formularySearch + inventoryAlert structured tools)
- `concord-frontend/components/pharmacy/RxMedicationsPanel.tsx` — extended (med-detail/dose-history details expand, med-update inline edit, real-data search filter)
- `concord-frontend/components/pharmacy/RxPricePanel.tsx` — extended (coupon-save form)
- `concord-frontend/tests/pharmacy-lens-states.test.tsx` — rewritten to pin the new primary surface (was pinning the retired fake medication-CRUD states)
- `docs/lens-specs/pharmacy-capability-map.md` — this file

Unmodified (read, verified real, reused as-is): `PharmacyRxSection.tsx`,
`RxRemindersPanel.tsx`, `RxRefillsPanel.tsx`, `RxPriceLookupPanel.tsx`,
`RxAdherencePanel.tsx`, `RxHealthLogPanel.tsx`, `FdaDrugReference.tsx`,
`FdaLivePanel.tsx`, `PharmacyActionPanel.tsx`.
