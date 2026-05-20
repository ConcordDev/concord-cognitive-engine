# healthcare — Feature Completeness Spec

Rival app(s): Epic (Hyperspace / EpicCare), Oracle Health (Cerner)
Sources:
- https://www.epic.com/software/ (EpicCare ambulatory, orders, charting)
- https://www.epic.com/ (problem list, MyChart, Best Practice Advisories)
- https://www.healthit.gov/topic/health-it-and-health-information-exchange-basics/what-electronic-health-record-ehr

## Features

### Patient chart
- [x] Patients — create / list / search / detail / update (macro: healthcare.patients-*)
- [x] Problem list with ICD-10 (macro: healthcare.problems-*)
- [x] Allergies — add / list / delete (macro: healthcare.allergies-*)
- [x] Vitals / flowsheet — record + trend (macro: healthcare.vitals-*)
- [x] Lab results — record / list / known tests (macro: healthcare.labs-*)
- [x] Immunizations — add / list (macro: healthcare.immunizations-*)
- [x] Care team — assign / list / remove providers (macro: healthcare.care-team-*)
- [x] Care gaps / health maintenance — overdue screenings & vaccines (macro: healthcare.care-gaps)

### Orders (CPOE)
- [x] Computerized order entry — medication / lab / imaging / referral / procedure (macro: healthcare.order-create)
- [x] Order list per patient with kind + status filters (macro: healthcare.order-list)
- [x] Order status lifecycle — placed → in-progress → completed (macro: healthcare.order-update-status)
- [x] Cancel / discontinue an order (macro: healthcare.order-cancel)
- [x] Medication orders double as the chart medication list (macro: healthcare.order-list kind=medication)
- [x] Drug–drug + drug–allergy interaction check (macro: healthcare.drug-interaction-check)

### Documentation
- [x] Encounters — create / list (macro: healthcare.encounters-*)
- [x] SOAP note — save / sign with Assessment+Plan gate (macro: healthcare.encounters-save-soap / encounters-sign)
- [x] AI scribe — drafts a SOAP note from a transcript (macro: healthcare.ai-scribe)
- [x] SmartPhrases / dot-phrases — create / list / expand / delete (macro: healthcare.smartphrases-*)
- [x] After-visit summary — generated from a signed encounter (macro: healthcare.visit-summary)
- [x] ICD-10 code search (macro: healthcare.icd10-search)

### Scheduling & access
- [x] Appointments — book / list / charge copay (macro: healthcare.appointment-*)
- [x] Provider directory — search + open slots (macro: healthcare.providers-search / provider-slots)
- [x] Patient portal messaging — inbox / send / mark-read (macro: healthcare.messages-*)
- [x] Prescription refills — request / list / respond (macro: healthcare.refills-*)

### Decision support
- [x] Symptom triage — AI triage decision support (macro: healthcare.symptom-triage)
- [x] AI chart search across the record (macro: healthcare.ai-chart-search)
- [x] Care-gap Best Practice Advisories (macro: healthcare.care-gaps)
- [x] Medical-imaging vision read (macro: healthcare.vision)

### Personal health
- [x] Personal medication tracker + dose log (macro: healthcare.medications-*)
- [x] Personal health record (macro: healthcare.record-get)
- [x] Dashboard rollup (macro: healthcare.dashboard-summary)

### Pharmacy
- [⚠] Live Rx cash/insurance price comparison (macro: healthcare.rx-price-compare) —
  BOUNDARY: needs a PBM/GoodRx API key; substitute: returns an explicit
  configuration error rather than fabricated prices
- [⚠] e-Prescribe to a real pharmacy (Surescripts) — BOUNDARY: needs the
  Surescripts network; substitute: medication orders + refill workflow +
  preferred-pharmacy on file

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Live Rx price comparison | PBM / GoodRx API key | explicit config-required error, no fabricated pricing |
| e-Prescribe (Surescripts) | Surescripts network credentials | medication orders + refill request/respond workflow + preferred pharmacy |

## Verification log
- 2026-05-20: Backend — 59 macros; `node --check` clean.
- 2026-05-20: Tests — `tests/healthcare-domain-parity.test.js` 35/35 green (CPOE
  order lifecycle, drug-drug + drug-allergy interaction check, care-team CRUD,
  care-gap computation from age/sex/problems/immunizations/labs, after-visit
  summary generation).
- 2026-05-20: Frontend — Orders tab (CPOE + interaction checker), Care tab (health
  maintenance gaps + care team), and an After-visit summary modal on signed
  encounters; `npx tsc --noEmit` exit 0.
- 2026-05-20: `npm run score-lenses` → healthcare 7/7 PASS.
