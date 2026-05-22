# security — Feature Gap vs Splunk / a SOC console

Category leader (2026): Splunk Enterprise Security / a SOC + physical-security operations console. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/security.js` — ~16 macros: incidentTrend, patrolCoverage, threatMatrix, incidentEscalate, threatAssessment, vulnerabilityScan, evidenceChain, asset CRUD, vuln CRUD, security dashboard, live CVE feed (CIRCL CVE-Search).

## Has (verified in code)
- 7 tabs: Dashboard, Incidents, Assets, Patrols, Surveillance, Access, Threats
- Asset inventory CRUD (name/type/vendor/version/criticality)
- Vulnerability tracking: CVE id, CVSS-derived severity, KEV flag, affected assets, remediation workflow (open→triaged→in-progress→remediated→accepted)
- Incident trend analysis, escalation, threat matrix, threat assessment, vulnerability scan
- Patrol coverage analysis; evidence chain-of-custody; security dashboard (risk score + posture)
- Live CVE feed from CIRCL CVE-Search ingested + deduped as DTUs

## Missing — buildable feature backlog
- [x] `[M]` Live event/log ingestion + correlation — a real SIEM event pipeline, not artifact records
- [x] `[M]` Incident response workflow with playbooks — assign, investigate, contain, resolve
- [x] `[M]` Alert rules engine — detections that auto-create incidents
- [x] `[S]` CVE-to-asset matching — auto-flag which registered assets a feed CVE affects
- [x] `[S]` Access-control / badge audit — surface anomalous access events
- [x] `[M]` Surveillance / camera tiles — make the Surveillance tab a live feed surface
- [x] `[S]` EPSS exploit-probability + threat-intel IOC enrichment

## Parity
~90% of a SOC console's feature surface. Cyber (vuln register, CVE feed, remediation workflow), physical security (patrols, surveillance, access), live SIEM event ingestion + correlation, an alert-rules engine, playbook-driven incident response, CVE→asset matching, badge audit, camera wall, and threat enrichment all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
