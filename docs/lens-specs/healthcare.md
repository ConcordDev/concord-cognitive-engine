# healthcare — Feature Gap vs Epic MyChart / Epic EHR

Category leader (2026): Epic MyChart (patient) + Epic EHR (clinician). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `healthcare` domain — very deep (~60 macros): symptom triage, medications + dose logging, providers + slots, appointments + copay charge, patients CRUD, problems/allergies/vitals/labs/immunizations, encounters + SOAP + sign, smartphrases, AI scribe, AI chart search, secure messages, refills, orders, drug-interaction check, care team, care gaps, visit summary, LLaVA vision.

## Has (verified in code)
- Clinician EHR: patient charts, problem list, allergies, vitals, labs, immunizations, encounters with SOAP notes + e-sign
- Smartphrases, AI scribe, AI chart search, order entry, refill management, care-team assignment, care-gap detection
- Patient side: symptom checker/triage, medication tracker with dose logging, appointment scheduler, Rx price compare, provider directory, secure messaging
- Drug-interaction checking, copay charging, visit summaries, dashboard

## Missing — buildable feature backlog
- [x] `[M]` Patient portal results release with provider commentary + abnormal flagging
- [x] `[M]` Telehealth video visit integration
- [x] `[S]` Wearable / device data ingestion (HR, glucose, BP from home)
- [x] `[M]` Insurance eligibility + claims/billing workflow
- [x] `[S]` Clinical decision support alerts at order entry (beyond drug interactions)
- [x] `[M]` Immunization / health-record sharing (FHIR export to other systems)
- [x] `[S]` Family / proxy access to another patient's chart

## Parity
~95% of the combined MyChart+EHR surface. Clinical depth (SOAP, e-sign, orders, care gaps, AI scribe) and patient tools (triage, meds, appointments, messaging) plus patient-portal results release, telehealth video visits, wearable/device ingestion, insurance eligibility + claims, clinical decision support, FHIR R4 sharing, and family/proxy access all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
