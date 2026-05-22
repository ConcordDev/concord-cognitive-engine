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
- [x] `[M]` Appointment scheduling / calendar — booking, no-show tracking.
- [x] `[M]` Invoicing & payment — cost estimates exist but no billing/payment workflow.
- [x] `[S]` Vaccine-due reminders / overdue alerts to owners.
- [x] `[M]` SOAP-format medical charting per visit (subjective/objective/assessment/plan).
- [x] `[S]` Prescription / medication tracking and refills.
- [x] `[M]` Owner portal — owners view their pet's records and book appointments.
- [x] `[S]` Lab/imaging result attachments per visit.
- [x] `[S]` Inventory management for clinic supplies and meds.

## Parity
~90% of ezyVet. Full practice-management substrate now wired end-to-end: appointment scheduling with no-show tracking, line-item invoicing with partial payments, vaccine overdue/due-soon reminders, SOAP-format medical charting, prescription tracking with refills, an owner-portal aggregator, lab/imaging result attachments, and clinic inventory management with low-stock and expiry alerts — alongside the original calculators, patient records and live openFDA safety feed.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
