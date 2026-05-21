# healthcare — Feature Gap vs Epic MyChart / Epic EHR

Category leader (2026): Epic MyChart (patient) + Epic EHR (clinician). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `healthcare` domain — very deep (~60 macros): symptom triage, medications + dose logging, providers + slots, appointments + copay charge, patients CRUD, problems/allergies/vitals/labs/immunizations, encounters + SOAP + sign, smartphrases, AI scribe, AI chart search, secure messages, refills, orders, drug-interaction check, care team, care gaps, visit summary, LLaVA vision.

## Has (verified in code)
- Clinician EHR: patient charts, problem list, allergies, vitals, labs, immunizations, encounters with SOAP notes + e-sign
- Smartphrases, AI scribe, AI chart search, order entry, refill management, care-team assignment, care-gap detection
- Patient side: symptom checker/triage, medication tracker with dose logging, appointment scheduler, Rx price compare, provider directory, secure messaging
- Drug-interaction checking, copay charging, visit summaries, dashboard

## Missing — buildable feature backlog
- [ ] `[M]` Patient portal results release with provider commentary + abnormal flagging
- [ ] `[M]` Telehealth video visit integration
- [ ] `[S]` Wearable / device data ingestion (HR, glucose, BP from home)
- [ ] `[M]` Insurance eligibility + claims/billing workflow
- [ ] `[S]` Clinical decision support alerts at order entry (beyond drug interactions)
- [ ] `[M]` Immunization / health-record sharing (FHIR export to other systems)
- [ ] `[S]` Family / proxy access to another patient's chart

## Parity
~70% of the combined MyChart+EHR surface. The clinical depth (SOAP, e-sign, orders, care gaps, AI scribe) and patient tools (triage, meds, appointments, messaging) are genuinely substantial; main gaps are telehealth video, insurance/billing, and device-data ingestion.
