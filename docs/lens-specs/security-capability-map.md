# Security lens — capability map (Wave 3 audit, 2026-07-11)

## What this lens actually is

A SOC/security-operations workspace with two coexisting layers:

1. **SOC Console + Vulnerability Manager** (`components/security/SOCConsole.tsx`,
   811 LOC; `components/security/VulnManager.tsx`, 158 LOC) — a real, bespoke
   Splunk/OpenCVE-shape console wired straight to the `security.*` domain
   (`server/domains/security.js`, 1013 LOC, 33 `registerLensAction` macros):
   SIEM event ingest + substring correlation, an alert-rules engine that
   auto-opens incidents, playbook-driven incident response (5 authored
   playbooks: malware/phishing/intrusion/DDoS/physical-breach) with a phase
   pipeline + timeline, CVE-to-asset matching, badge-access anomaly audit
   (repeated denials / after-hours / impossible-travel-in-60s), a live
   surveillance camera wall, and EPSS exploit-probability (FIRST.org) + IOC
   reputation enrichment derived from the user's own SIEM stream. Every
   button in these two components calls a real macro via `lensRun` — no
   fabricated numbers, no client-invented percentages.
2. **Generic analyst-report CRUD** (`app/lenses/security/page.tsx`, 1407 LOC)
   — the six tabbed artifact types (Incident/Asset/Patrol/Surveillance/
   AccessControl/ThreatIntel) are generic `lens.*` artifacts (`/api/lens/security`),
   a separate free-text record-keeping surface (MTTD/MTTR, root cause,
   lessons learned, patrol checkpoints, badge zones, IOC threat intel with
   mitigations/tags). The four "Domain Actions" buttons (Vulnerability Scan,
   Incident Escalate, Access Audit, Threat Assessment) run the four
   `security.*` analysis macros (`vulnerabilityScan`, `incidentEscalate`,
   `accessAudit`, `threatAssessment`) against these artifacts, plus
   `threatMatrix`/`incidentTrend`/`evidenceChain`/`patrolCoverage` reachable
   the same way.

These two layers are intentionally separate data models (operational SIEM
state vs. authored incident-report artifacts) — not a fabricated duplicate
of the same concept. Both are real; nothing here is fake/mock data.

## Reference bar

Closest real products: Splunk / Microsoft Sentinel (SIEM+correlation+rules),
OpenCVE/NVD (vuln tracking), PagerDuty (incident response+playbooks). The
SOC Console covers the core loop of all three at a genuinely usable depth for
a single-operator tool: ingest → correlate → auto-detect → triage →
playbook → close, plus CVE⇄asset linkage and EPSS scoring. This clears the
bar as a real, standalone security-ops surface, not a toy next to those
apps.

## CRITICAL finding — IDOR authz gap in the generic lens-artifact runtime (FIXED)

Per this wave's standing focus on authz gaps (the psyops/admin precedent):
auditing this lens's generic-artifact layer surfaced a **real, exploitable
IDOR**, not domain-specific to `security` but load-bearing for it because
this lens's artifacts (Incident root-cause/lessons-learned, Access-Control
badge holder/visitor name) are the most sensitive data any lens stores in
the generic artifact system.

`server.js`'s "GENERIC LENS ARTIFACT RUNTIME" (`register("lens", …)`, used
by ~200 lenses' `useLensData`/`useRunArtifact` hooks) had **inconsistent
ownership enforcement across its five operations**:

| Macro | Ownership/visibility check (before fix) |
|---|---|
| `lens.list` | ✅ enforced — private, non-social artifacts filtered to owner/admin/published |
| `lens.get` | ✅ enforced — same rule |
| `lens.delete` | ✅ enforced — owner-or-admin required |
| `lens.run` | ❌ **none** — fetched the artifact by id and dispatched the domain action with zero ownership check |
| `lens.update` | ❌ **none** — fetched the artifact by id and overwrote title/data/meta with zero ownership check |

Concretely, any authenticated user who knew (or could enumerate) another
user's private `security` artifact id could, before this fix:

- `POST /api/lens/security/<id>/run` with `action: "incidentEscalate"` (or
  any other registered action) to have the server execute that action
  against another user's private Incident/Asset/AccessControl artifact.
- `GET /api/lens/security/<id>/export?format=json` to dump the artifact's
  full `data` — an Incident's assignee, root cause, and lessons learned, or
  an Access-Control record's badge holder / visitor name / restrictions.
- `PUT /api/lens/security/<id>` to silently overwrite another user's
  artifact's title/data/meta (no confirmation, no notification).

This is the same defect *class* the wave has been finding elsewhere
(frontend-only gating, no server-side ownership check) — except here it's
in the shared generic-artifact runtime, so it affected every lens built on
`useLensData`, not just `security`.

### Fix

`server/server.js` — added a shared visibility/ownership gate next to the
existing `_lensDomainArtifacts` helpers:

- `LENS_SOCIAL_DOMAINS` — the same social-domain allowlist `lens.list`/
  `lens.get` already used (forum/feed/marketplace/collab/thread/vote/
  alliance/global/news/questmarket), centralized instead of duplicated.
- `_lensIsOwnerActor(ctx, artifact)` / `_lensIsAdminActor(ctx)` — shared
  owner/admin predicates matching `lens.delete`'s existing definition.
- `_lensArtifactVisible(ctx, artifact)` — the same read-visibility rule
  `lens.get` already enforced (owner, admin, social-domain, or explicit
  published/public), now reusable.

Applied:
- `lens.run` — returns `{ ok:false, error:"not found" }` (existence not
  revealed, matching `lens.get`'s pattern) when the caller can't see the
  artifact, before dispatching any domain action.
- `lens.export` — same check before returning `data` in any format.
- `lens.update` — added an owner-or-admin check mirroring `lens.delete`'s
  existing rule (social-domain artifacts are exempt, matching list/get, so
  no regression to legitimate collaborative-domain editing).

Admin (`role` ∈ owner/admin/founder) bypasses all three, matching
`lens.delete`'s existing behavior.

### Verification

- New test `server/tests/lens-artifact-authz.test.js` (6 subtests, all
  green): non-owner blocked on run/export/update against a private
  `security` artifact; owner still succeeds; admin bypass still works;
  social-domain (`forum`) artifacts stay open to non-owners (no
  regression).
- `server/tests/lens-auth-gate.test.js` (4/4) — the pre-existing anon-gate
  regression guard still passes; the fix sits after its
  `_lensActionForbiddenForAnon` check, not before.
- Ran all 201 `server/tests/depth/*.test.js` files (350 subtests, 0
  failures) — these are the primary consumers of `lens.run` across ~90
  domains via the `lensRun` test harness (which always creates the artifact
  under the same ctx it runs actions with), confirming zero regression for
  the standard same-user usage pattern.
- Ran the full `security` test surface (`tests/depth/security-*-behavior.test.js`,
  `tests/security-domain-parity.test.js`, `tests/security-lens-macros.test.js`,
  `tests/security-vuln-domain-parity.test.js` — 51/51 pass).
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260 (unchanged).
- `node scripts/grade-ux-polish.mjs --honest` → `security` entry:
  `tier:"polished"`, `isGenericScaffold:false` (unchanged; no frontend
  files were touched).
- `npx eslint server.js tests/lens-artifact-authz.test.js` → 0
  errors/warnings.
- `node --check server.js` → OK.

## Genuinely missing / deferred

None rising to a defining-feature gap against the SIEM/OpenCVE/PagerDuty
reference bar. One minor fluidity papercut, not fixed in this pass because
it's cosmetic rather than an honesty or authz violation:

- **ENGINEERING, small.** The four legacy "Domain Actions" buttons
  (`app/lenses/security/page.tsx`) resolve their target artifact id as
  `artifactId || editingItem?.id || filtered[0]?.id` and no-op silently if
  none exists. `accessAudit` and `security-dashboard`-style macros don't
  actually need an artifact (they read the real per-user SIEM/vuln state,
  not `artifact.data`), so on a brand-new account with zero Incident/Asset
  artifacts in the current tab, clicking "Access Audit" does nothing with
  no visible feedback. A future pass could special-case artifact-independent
  actions to call `lens.run` with the actor's own synthetic/no-op target, or
  surface a toast when no target exists. Left as a backlog item — it does
  not affect SOCConsole/VulnManager, which call the real macros directly via
  `lensRun` with no artifact-id dependency and work correctly with zero
  artifacts.
