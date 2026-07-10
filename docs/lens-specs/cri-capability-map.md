# Cri Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Backend surface enumerated by reading
> `server/domains/cri.js` (863 LOC) in full —
> `grep -n 'registerLensAction("cri"' server/domains/cri.js` lists all 11
> macros, no inline registrations exist elsewhere. Frontend audited by
> reading `app/lenses/cri/page.tsx` (~775 LOC) and all three
> `components/cri/*.tsx` files (`CrisisActionPanel`, `QualityDistribution`,
> `QualityLoopPanel`, ~2200 LOC combined) in full.

## Backend surface — 11 macros, all real

`severityAssessment` / `responseTimeline` / `stakeholderImpact` — a
business-crisis-response planning toolkit (multi-factor severity scoring,
phased response timeline, stakeholder impact mapping) operating on
caller-supplied crisis descriptions. `scoreRules-get/set`, `trend-snapshot`,
`trend-history`, `rootCause`, `compare`, `bulkRemediate`, `alerts` — a
DTU data-quality loop over the platform's own CRETI (Coherence/Relevance/
Evidence/Timeliness/Integration) scoring substrate. Both halves are real
and distinct — the lens legitimately combines a crisis-planning workbench
with a data-quality scorecard tool, sharing only the "crisis" vocabulary,
not the same domain concept as the sibling `crisis-ops` lens (which is the
in-game world-incident console backed by the separate `crisis` domain).

## Reference app

No direct consumer rival — closest analog is a data-quality scorecard tool
(Monte Carlo / Great Expectations) blended with incident-severity triage.
Clinical/precise identity: sortable scorecards, distribution charts,
threshold-driven color coding — matches a data-ops tool, not a generic
dashboard.

## Audit result: no real defects found

Full read of the page and all three components found the "full backlog
implemented" claim in the pre-existing `docs/lens-specs/cri.md` to be
accurate. Every one of the 11 macros is reached from designed UI, not a
generic action array:

- `severityAssessment`/`responseTimeline`/`stakeholderImpact` → real
  structured-form workbench in `CrisisActionPanel.tsx` (crisis
  name/type/scope/affected-count/duration/stakeholders inputs, not a
  JSON-paste box).
- `scoreRules-get/set`, `trend-snapshot/history`, `bulkRemediate`,
  `alerts`, `rootCause`, `compare` → six-tab `QualityLoopPanel.tsx`
  (Trend / Rules / Remediate / Alerts / Root-cause / Compare), each tab
  calling its own named macro against the live DTU corpus, not
  caller-fabricated data.
- The main scorecard (`page.tsx` + `QualityDistribution.tsx`) reads real
  DTU `creti` fields from `/api/dtus`, computes real mean/median/min/max
  per dimension, and supports sortable/threshold-filterable drill-in.

No `Math.random()`, no hardcoded numeric stats, no dead/duplicate UI, no
fake success-on-failure pattern found in any of the three component files
or the page. `grep -rn "Math.random\|TODO\|FIXME\|hardcoded" app/lenses/cri/
components/cri/` returns no matches.

## 1.5 Reference-parity checklist

| # | Item | Disposition |
|---|---|---|
| 1 | Multi-dimension quality scorecard, sortable | ALREADY REAL |
| 2 | Quality distribution chart | ALREADY REAL |
| 3 | Quality trend over time | ALREADY REAL — `trend-snapshot`/`trend-history` |
| 4 | Configurable scoring rules/weights | ALREADY REAL — `scoreRules-get/set` |
| 5 | Bulk remediation workflow | ALREADY REAL — `bulkRemediate` (list/flag/clear) |
| 6 | Quality-regression alerting | ALREADY REAL — `alerts` (list/ack/clear) |
| 7 | Root-cause analysis per low score | ALREADY REAL — `rootCause` |
| 8 | Side-by-side comparison | ALREADY REAL — `compare` |
| 9 | Crisis-response planning (severity/timeline/impact) | ALREADY REAL — `CrisisActionPanel` |

**Coverage summary:** 9 of 9 checklist items already real, wired to
designed (not generic) UI. No changes made this session — the audit found
the lens genuinely complete, and this document exists to record that
finding with evidence rather than skip the lens.

## Files touched

None — audit only, no defects found.
