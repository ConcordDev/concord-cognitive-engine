# security — Feature Completeness Spec

Rival app(s): OpenCVE, NVD Dashboard, Snyk (2026)
Sources:
- https://www.opencve.io/ (CVE intelligence — track by priority/status, subscriptions)
- https://nvd.nist.gov/ (National Vulnerability Database)
- Web search 2026-05-20: vuln dashboards track CVEs by priority/status/assignee, asset inventory, risk scoring (CVSS/EPSS), KEV listing, remediation tracking

## Features

### Vulnerability management
- [x] Asset inventory — name, type, vendor, version, criticality (macro: security.asset-add / asset-list / asset-delete)
- [x] Vulnerability tracking — CVE id, CVSS-derived severity, KEV flag, affected assets (macro: security.vuln-add)
- [x] List + filter vulns by status / severity / KEV, sorted critical-first (macro: security.vuln-list)
- [x] Remediation workflow — open → triaged → in-progress → remediated → accepted (macro: security.vuln-update)
- [x] Delete vulns (macro: security.vuln-delete)
- [x] Security dashboard — open vulns by severity, KEV count, risk score + posture (macro: security.security-dashboard)
- [x] Live CVE feed — ingests recent published CVEs (CIRCL CVE-Search, free) as DTUs (macro: security.feed)

### Analysis (retained)
- [x] Incident trend (macro: security.incidentTrend)
- [x] Patrol coverage (macro: security.patrolCoverage)
- [x] Threat matrix (macro: security.threatMatrix)
- [x] Incident escalation (macro: security.incidentEscalate)
- [x] Threat assessment (macro: security.threatAssessment)
- [x] Vulnerability scan (macro: security.vulnerabilityScan)
- [x] Evidence chain (macro: security.evidenceChain)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Automated network scanning | scanner agents on real infra | manual asset + vuln entry; the live CVE feed surfaces new disclosures |
| EPSS exploit-probability scoring | the EPSS data feed | CVSS-derived severity + a KEV flag + a composite risk score |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/security.js` clean. 15 macros
  (7 analysis + 7 vuln-management substrate + 1 feed).
- 2026-05-20: Tests — `tests/security-vuln-domain-parity.test.js` 8/8 green
  (assets + per-user scope + cascade-detach / vulns severity-from-CVSS +
  critical-first sort + status filter + remediation / dashboard risk score +
  posture / CVE feed ingest + dedupe / analysis macros intact).
- 2026-05-20: Frontend — new `VulnManager` (asset inventory, CVE tracker with
  severity badges + remediation status, risk dashboard, live CVE feed button)
  mounted in the security lens page. `npx tsc --noEmit` exit 0.
