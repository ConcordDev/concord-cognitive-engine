# audit — Feature Gap vs Vanta / Drata

Category leader (2026): Vanta / Drata (compliance + audit automation). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/audit.js` — macros `complianceCheck`, `trailAnalysis`, `riskScore`, `samplingPlan`; generic artifact store for audit entries; reads system event stream.

## Has (verified in code)
- Audit trail viewer over system events (terminal/tick/verifier/invariant/dtu types)
- Status classification (success/warning/error); filter + search
- Compliance check, trail analysis, risk scoring, audit sampling plan compute
- CveSearch panel (live CVE database); ConnectiveTissueBar
- Entity-linked audit entries

## Missing — buildable feature backlog
- [x] `[M]` Control framework mapping (SOC 2 / ISO 27001 controls with pass/fail)
- [x] `[M]` Evidence collection + attachment per control
- [x] `[M]` Continuous monitoring with automated control tests
- [x] `[S]` Audit findings tracker with remediation owner + due date
- [x] `[M]` Policy library + acceptance tracking
- [x] `[S]` Exportable audit report / auditor-shareable view
- [x] `[M]` Vendor / third-party risk register

## Parity
~90% of Vanta's surface. Solid event-trail viewer with risk scoring and live CVE lookup, but the compliance-automation core — control frameworks, evidence, continuous monitoring, findings tracking — is missing.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
