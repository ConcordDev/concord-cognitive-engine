# Healthcare Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.
>
> Per the assignment brief: this is a large, important lens with a
> previously-verified real WebRTC telehealth client
> (`TelehealthVideoCall.tsx` + `simple-peer` + `server/lib/webrtc-signalling.js`,
> see CLAUDE.md) and real FHIR export — **neither was touched or rebuilt**
> this pass; both were re-confirmed present and left alone.

## Backend surface

```
grep -c 'registerLensAction("healthcare"' server/domains/healthcare.js
```
→ **83** macros in `server/domains/healthcare.js` (2,495 lines). No inline
`register("healthcare", ...)` in `server.js`
(`grep -c 'register("healthcare"' server/server.js` → 0).

`node scripts/lens-unsurfaced.mjs --lens healthcare` → started at **5/83**
(`allergies-list`, `labs-known-tests`, `patients-update`, `problems-list`,
`vitals-list`), now **3/83** after this pass. A direct cross-reference of
every `action:` string used across all 29 components against the full macro
list found **2 more** the script's grouping missed: `appointment-list` and
a legacy-generation cluster of 6 (`vision`, `checkInteractions`,
`protocolMatch`, `exportEncounter`, `soapAutoFill`, `generateSummary`, all
registered at the very top of the file, lines 7-306 — the same "early
creative-tools-era macro batch" pattern found in `goals.js`/`government.js`
this wave).

## Real, deep, and already correctly wired (no changes)

Read all 29 components + the 4,016-line `page.tsx` in full; `grep -n
"Math.random\|MOCK\|mock\|fake\|Lorem\|lorem" components/healthcare/*.tsx
app/lenses/healthcare/page.tsx` → empty (no fabrication signatures). This is
a genuinely deep EHR/patient-portal suite:
- **`PatientChartPanel.tsx`** — a real Epic-style combined chart
  (`patients-detail` returns problems/allergies/vitals/labs/immunizations/
  encounters together) with live ICD-10 search (NLM API) for problem entry.
- **`EncountersPanel.tsx`** — SOAP note editor with SmartPhrase (.dotphrase)
  expansion, sign workflow, and AVS (after-visit summary) generation.
- **`AIScribePanel.tsx`** — real LLM-backed `ai-scribe` (raw text → SOAP)
  distinct from the legacy deterministic `soapAutoFill`.
- **`CdsOrderCheckPanel.tsx`** — `cds-order-check`, real clinical decision
  support order-checking.
- **`OrdersPanel.tsx`** — real `drug-interaction-check` (the parity-sprint
  successor to the legacy `checkInteractions`, see below).
- **`InboxPanel.tsx`**, **`RefillsPanel.tsx`**, **`CareManagementPanel.tsx`**,
  **`CodeLookup.tsx`**, **`ImmunizationsPanel.tsx`**, **`SymptomChecker.tsx`**,
  **`RxPriceCompare.tsx`**, **`EpicAskBar.tsx`** — all real, all wired to
  dedicated macros, no defect found.
- **`EpicShell.tsx`** — the healthcare rival-shape shell (Epic Hyperspace
  nav chrome), same pattern as `CityGovShell.tsx` in the government lens.
- **`HealthcareActionPanel.tsx`** — a real "healthcare bench" (triage/
  find-MD/meds/Rx-price + mint-DTU/DM/publish/agent), correctly wired
  throughout — a good template for what a designed action panel looks like
  (contrast with the dead artifact-gated panels found in goals/graph this
  wave).

## What changed

1. **`labs-known-tests` — real catalog, hardcoded client duplicate.**
   `PatientChartPanel.tsx`'s lab-entry dropdown hardcoded
   `KNOWN_TESTS = ['glucose', 'a1c', ...]` as a bare string array with no
   reference ranges shown to the ordering clinician, duplicating (and able
   to silently drift from) the real server-side `LAB_RANGES` catalog with
   actual clinical reference ranges (`labs-known-tests` returns
   `{tests: [{test, unit, low, high}]}`). **Fixed:** fetches the real
   catalog on chart load and shows the reference range inline when a test
   is selected; falls back to the hardcoded list only if the fetch fails.
2. **`patients-update` — a real macro with zero editor anywhere.**
   Patients could be created (`patients-create`) and listed, but never
   corrected — no UI existed to fix a phone number, add an emergency
   contact, or update insurance. **Fixed:** added an "Edit patient" toggle
   to the chart banner in `PatientChartPanel.tsx` with a form for every
   field the macro accepts (phone/email/address/insurance plan+member ID/
   emergency contact/preferred pharmacy).
3. **`appointment-list` — real macro (status + copay-status filters), no
   view anywhere.** `AppointmentScheduler.tsx` could search providers and
   book a slot, but a booked appointment vanished from the UI on the next
   visit — no "my appointments" view. **Fixed:** added a "My Appointments"
   toggle showing the real list (status, kind, co-pay status) with a
   "Pay co-pay" action wired to the existing `appointment-charge-copay` +
   Stripe flow (reused, not duplicated).
4. **`exportEncounter` — real macro (structured patient/encounter/vitals/
   diagnosis/plan export), no caller.** `EncountersPanel.tsx` could sign a
   note and generate a patient-facing after-visit summary, but never a
   structured export. **Fixed:** added an "Export" action (visible once
   signed, alongside AVS) that maps the real `Encounter` fields into the
   macro's expected shape and renders + offers a `.json` download of the
   result.
5. **`allergies-list` / `problems-list` / `vitals-list` — investigated,
   confirmed NOT a defect.** `patients-detail` already returns
   `problems`/`allergies`/`vitals` filtered by patient id in one combined
   call — the data is fully reachable through the chart panel; these
   standalone list macros are redundant granular-access endpoints (fine for
   future API/MCP callers), not a missing UI capability. Left alone.

## Investigated and honestly deferred (not faked)

- **`checkInteractions`, `soapAutoFill`, `generateSummary` — superseded
  legacy macros.** All three are part of the early creative-tools-era
  batch at the top of the file; each has a real, dedicated, better-designed
  successor that's already wired: `drug-interaction-check` (used by
  `OrdersPanel.tsx`) supersedes `checkInteractions` (which additionally
  needs RxCUI-coded prescriptions the medication tracker doesn't capture —
  a genuine, not just stylistic, downgrade); `ai-scribe` (LLM-backed,
  `AIScribePanel.tsx`) supersedes the deterministic-template
  `soapAutoFill`; `visit-summary` (`EncountersPanel.tsx`'s AVS button)
  supersedes `generateSummary`. No UI built for the legacy versions —
  wiring a worse, superseded implementation alongside a better one already
  in production would be a regression, not a fix.
- **`protocolMatch` — GENUINELY MISSING, deferred.** Matches patient
  conditions against a care-protocol library
  (`artifact.data.protocols` / `params.protocols`, each
  `{id, name, triggerConditions: [icd10...], steps}`) — real algorithm, but
  **no protocol library exists anywhere in the codebase** for it to match
  against (confirmed: no `content/` or seed data resembling clinical
  protocols). Building this honestly needs either a real curated protocol
  library (e.g. sepsis bundle, diabetic-foot-exam protocol) or a real
  external guideline-API integration — out of scope for a frontend-only
  wiring pass. Flagged as a scoped future build, not faked with an invented
  protocol set.
- **`vision` — GENUINELY MISSING, deferred.** Routes an uploaded image
  (rash/wound/medication-label photo) through the real vision brain
  (`callVision`/`callVisionUrl`, LLaVA-successor Qwen2.5-VL per
  CLAUDE.md's five-brain table) — the backend call is real, but no
  component anywhere has an image-upload/capture UI to feed it (confirmed:
  `grep -rln "imageB64\|imageUrl" components/healthcare/` found nothing
  real). A genuine, moderate-scope new feature (upload control + result
  display), not a quick wire — flagged as a scoped future build rather than
  rushed.

## Verification

- `server/tests/healthcare-domain-parity.test.js`,
  `server/tests/healthcare-honest-telehealth.test.js` — 81/81 pass
  unmodified (no backend macro changed; every fix this pass was frontend
  wiring against already-correct backend macros).
- `npx eslint` clean on all 3 touched files
  (`PatientChartPanel.tsx`, `AppointmentScheduler.tsx`,
  `EncountersPanel.tsx`).

## Left alone, with reason

- **Real WebRTC telehealth (`TelehealthVideoCall.tsx`) and FHIR export** —
  per the assignment brief, previously verified real; re-confirmed present,
  not touched.
- **All 26 other components** — read for fabrication signatures and
  macro-call correctness; no defect found beyond the 4 fixed above.
