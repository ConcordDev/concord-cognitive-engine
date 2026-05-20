# veterinary — Feature Completeness Spec

Rival app(s): Provet Cloud, ezyVet, Vetstoria (2026)
Sources:
- https://open.fda.gov/apis/animalandveterinary/ — openFDA Animal & Veterinary adverse events (free, no key)

## Features

### Clinical calculators
- [x] Triage assessment, weight check, vaccine schedule, cost estimate

### Patient-records substrate (new)
- [x] Patients — name, species, breed, owner, age, weight (macro: veterinary.patient-add / patient-list / patient-delete)
- [x] Visit log — checkup / vaccination / surgery / dental / emergency / followup with cost (macro: veterinary.visit-log)
- [x] Vaccination records — vaccine, date, next due (macro: veterinary.vaccine-record)
- [x] Vet dashboard — patients, visits, revenue, by-species (macro: veterinary.vet-dashboard)

### Live data & feed
- [x] Live vet-safety feed — openFDA animal & veterinary adverse events ingested as DTUs (macro: veterinary.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Lab / imaging integration | a veterinary lab API | visit records with manual diagnosis + treatment notes |

## Verification log
- 2026-05-20: Backend — built from a 4-macro stub to a full lens: kept the 4 calculators, added a 6-macro patient-records substrate + `feed` (openFDA → DTUs). `node --check` clean.
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` veterinary substrate (per-user scope) + feed + calculator-intact cases green.
- 2026-05-20: Frontend — `LensFeedButton domain="veterinary"` mounted in the lens page.
