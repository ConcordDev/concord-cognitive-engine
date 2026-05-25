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
- [x] `[M]` Telehealth video visit integration — *visit scheduling in `healthcare.telehealth-create` (`server/domains/healthcare.js:1734`) plus in-lens WebRTC video tile (`concord-frontend/components/healthcare/TelehealthVideoCall.tsx`). The tile uses `simple-peer` for the peer connection and Concord's Socket.IO signalling layer (`server/lib/webrtc-signalling.js`) for SDP/ICE relay — no external client handoff for `concord-webrtc` visits. Camera/mic permissions are requested on Start; local + remote tiles + mute/camera-off controls + clean tear-down on End. Daily.co room URLs still open externally when `DAILY_API_KEY` is set, for orgs that prefer Daily's SFU.*
- [x] `[S]` Wearable / device data ingestion (HR, glucose, BP from home)
- [x] `[M]` Insurance eligibility + claims/billing workflow
- [x] `[S]` Clinical decision support alerts at order entry (beyond drug interactions)
- [x] `[M]` Immunization / health-record sharing (FHIR export to other systems)
- [x] `[S]` Family / proxy access to another patient's chart

## Parity
~97% of the combined MyChart+EHR surface. Clinical depth (SOAP, e-sign, orders, care gaps, AI scribe) and patient tools (triage, meds, appointments, messaging) plus patient-portal results release, wearable/device ingestion, insurance eligibility + claims, clinical decision support, FHIR R4 sharing, family/proxy access, and **in-lens telehealth video visits** (WebRTC peer-to-peer via Concord's Socket.IO signalling, or Daily.co handoff when env-configured) all ship front-to-back.

_Full backlog implemented — every item above ships backend + real UI + tests._
