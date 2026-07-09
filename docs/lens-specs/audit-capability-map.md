# Audit Lens — Capability Map (Frontend Rebuild Program, Wave 2, batch 7)

Reproduce the macro list:
`grep -n 'registerLensAction("audit"' server/domains/audit.js` → 25 macros across
four groups: (a) ad-hoc analysis — `complianceCheck`, `trailAnalysis`,
`riskScore`, `samplingPlan`; (b) compliance-automation core — `frameworkCatalog`,
`frameworkAdopt`, `controlList`, `controlUpdate`, `evidenceAdd`, `evidenceList`,
`evidenceDelete`, `monitorList`, `monitorConfigure`, `monitorRun`, `findingAdd`,
`findingUpdate`, `findingList`, `policyAdd`, `policyList`, `policyAccept`,
`policyAcceptanceList`, `vendorAdd`, `vendorUpdate`, `vendorList`, `exportReport`.

## Reference apps

- **Vanta / Drata** — SOC 2 / ISO 27001 compliance automation: control-framework
  catalogs, evidence collection, automated monitoring checks, findings tracking,
  policy library + acceptance tracking, vendor risk register, auditor-shareable
  reports.
- **ACL/IDEA-style audit analytics** — ad-hoc data-analytics test scripts
  (compliance rule checks, audit-trail anomaly detection, inherent/control/
  detection risk scoring, statistical sampling plans) run against arbitrary
  client data.

## Audit finding: the SOC2/ISO27001 core was already real; the page duplicated it with a fake generic-store panel

`components/audit/ComplianceSuite.tsx` (931 LOC) is the real, already-shipped
Vanta/Drata-parity core: seven tabs (Controls, Evidence, Monitoring, Findings,
Policies, Vendors, Report), every one backed by a real `audit.*` macro with
live create/update/delete flows and a downloadable auditor-shareable Markdown
report with a compliance-by-framework chart. `components/audit/CveSearch.tsx`
is a real live NVD CVE-database search panel. `components/audit/
AuditActionPanel.tsx` is a real "internal auditor's bench" wired directly via
`apiHelpers.lens.runDomain('audit', action, { input })`, which correctly
resolves through the dispatch-layer `peelRedundantArtifactWrapper` fix
(`server/lib/lens-input-normalize.js`) — confirmed by tracing the actual
request shape server-side, not assumed. None of these three needed rebuilding.

What was genuinely wrong: `app/lenses/audit/page.tsx` mounted its **own,
second copy** of the same four ad-hoc-analysis macros
(`complianceCheck`/`trailAnalysis`/`riskScore`/`samplingPlan`) in a
"Backend Audit Actions" panel, wired to `useLensData('audit', 'entry',
{ seed: [] })` + `useRunArtifact('audit')` — the generic per-domain artifact
CRUD store. Since nothing anywhere ever populates an `'entry'`-typed audit
artifact with the `records`/`rules`/`events`/`controls` shape those four
macros actually read, every button either no-op'd (disabled, `!auditItems[0]`)
or, on the rare populated case, hit the macro's own "no data" default
message — never a real result. This is the exact "disconnected generic-CRUD
store standing in for real domain macros" pattern flagged across this wave:
a real macro, reached only through a store nothing feeds. The genuinely
useful version of this exact feature (`AuditActionPanel`, JSON-input driven,
already live) sat a few hundred lines further down the same page.

## What this rebuild changed

- **Removed** from `app/lenses/audit/page.tsx`: the `useLensData('audit',
  'entry', …)` + `useRunArtifact('audit')` generic-store wiring, the entire
  "Backend Audit Actions" button panel and its "Action Result Display" block,
  and the `<LensFeaturePanel>` "Lens Features & Capabilities" toggle (a
  generic capability lister redundant with the bespoke panels already on the
  page). The real event feed (`GET /api/events` → Audit Log / Immutable DTU
  Chain / Recent Audit Entries, with honest loading/error/empty states and a
  working Retry), `ComplianceSuite`, `CveSearch`, and `AuditActionPanel` are
  all unchanged — they were already correct.
- No new macros needed wiring: `complianceCheck`/`trailAnalysis`/`riskScore`/
  `samplingPlan` are already reachable through the real `AuditActionPanel`;
  removing the broken duplicate is a pure subtraction, not a capability loss.

## Verification

- `npx eslint app/lenses/audit/page.tsx components/audit/*.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors touching audit files (pre-existing errors
  in `platform`/`queue`/`legacy`/`transfer` are sibling agents' concurrent
  in-flight work in this shared tree, unrelated to this change).
- `node scripts/verify-lens-backends.mjs` — `audit` `WIRED`; total unchanged
  at 258 WIRED / 2 NO-BACKEND-CALL (`narrative-walk`, `ux-suite`, both by
  design).
- `node scripts/grade-ux-polish.mjs --honest` — `audit`: `tier: "polished"`,
  `isGenericScaffold: false`.
- `tests/audit-lens-states.test.tsx` (the lens's four-UX-state contract test)
  existed and asserted against the removed panel (a `WIRING` test pinning
  `useRunArtifact('audit')` construction, and an `EMPTY`-state assertion for
  the removed "No audit entries in store yet" gating copy). Updated the test
  to drop those two assertions and their now-unused `useLensData`/
  `useRunArtifact` mocks — the LOADING/ERROR/EMPTY/POPULATED contract against
  the real `/api/events` channel is unchanged and still pinned.
  `npx vitest run tests/audit-lens-states.test.tsx` — 4/4 passing.
