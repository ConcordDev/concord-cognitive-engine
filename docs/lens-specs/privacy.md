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
- [ ] `[M]` Data subject request (DSAR) handler — submit/track access, export, deletion requests
- [ ] `[M]` Per-lens data-sharing toggles — granular control of what each lens may read/share
- [ ] `[S]` Privacy activity log — show recent data accesses and which lens/agent read what
- [ ] `[M]` Data export ("download my data") — full personal-corpus export bundle
- [ ] `[S]` Cookie/tracker consent banner config — manage consent surfaces
- [ ] `[S]` Retention policy editor — auto-expire data categories after a window
- [ ] `[S]` Third-party data-flow map — visualize where data leaves the platform (federation)

## Parity
~45% of OneTrust's feature surface. Consent management plus inventory/PIA/breach macros cover the compliance-author side, but it lacks DSAR handling, a full data-export flow, and a per-lens access log — the controls a user actually exercises.
