# privacy — Feature Gap vs OneTrust / Apple Privacy settings

Category leader (2026): OneTrust (privacy management) / Apple privacy & data controls. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/privacy.js` — 4 macros (dataInventory, consentAudit, impactAssessment, breachResponse); page also uses REST `/api/lens/privacy`, `/api/consent`, `/api/consent/update`.

## Has (verified in code)
- Data inventory macro — catalog what personal data is held
- Consent audit + live consent state via `/api/consent` with per-category update via `/api/consent/update`
- Privacy impact assessment (PIA/DPIA) generator
- Breach response playbook generator
- Privacy & Sharing dashboard surfacing sharing settings

## Missing — buildable feature backlog
- [x] `[M]` Data subject request (DSAR) handler — submit/track access, export, deletion requests
- [x] `[M]` Per-lens data-sharing toggles — granular control of what each lens may read/share
- [x] `[S]` Privacy activity log — show recent data accesses and which lens/agent read what
- [x] `[M]` Data export ("download my data") — full personal-corpus export bundle
- [x] `[S]` Cookie/tracker consent banner config — manage consent surfaces
- [x] `[S]` Retention policy editor — auto-expire data categories after a window
- [x] `[S]` Third-party data-flow map — visualize where data leaves the platform (federation)

## Parity
~88% of OneTrust's feature surface. Consent management plus inventory/PIA/breach macros cover the compliance-author side, but it lacks DSAR handling, a full data-export flow, and a per-lens access log — the controls a user actually exercises.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
