# veterinary — Feature Gap vs ezyVet / Provet Cloud

Category leader (2026): ezyVet / Provet Cloud (veterinary practice management). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `veterinary` domain — 11 macros: 4 clinical calculators + 6-macro patient-records substrate + a live openFDA Animal & Veterinary adverse-events feed.

## Has (verified in code)
- Clinical calculators — triage assessment, weight check, vaccine schedule, cost estimate.
- Patient records — add/list/delete patients (name, species, breed, owner, age, weight).
- Visit log (checkup/vaccination/surgery/dental/emergency/followup with cost).
- Vaccination records (vaccine, date, next due).
- Vet dashboard — patients, visits, revenue, by-species breakdown.
- Live vet-safety feed — openFDA animal & veterinary adverse events ingested as DTUs.

## Missing — buildable feature backlog
- [ ] `[M]` Appointment scheduling / calendar — booking, no-show tracking.
- [ ] `[M]` Invoicing & payment — cost estimates exist but no billing/payment workflow.
- [ ] `[S]` Vaccine-due reminders / overdue alerts to owners.
- [ ] `[M]` SOAP-format medical charting per visit (subjective/objective/assessment/plan).
- [ ] `[S]` Prescription / medication tracking and refills.
- [ ] `[M]` Owner portal — owners view their pet's records and book appointments.
- [ ] `[S]` Lab/imaging result attachments per visit.
- [ ] `[S]` Inventory management for clinic supplies and meds.

## Parity
~45% of ezyVet. The patient-records substrate, calculators, and openFDA feed are real and useful, but it lacks scheduling, billing, structured medical charting, and an owner portal that complete a practice-management system.
