# Debug Lens — Capability Map (Frontend Rebuild Program, Wave 3 — confirming, no changes)

Reproduce the macro list: `grep -c 'registerLensAction("debug"' server/domains/debug.js` → 21
Reproduce unsurfaced check: `node scripts/lens-unsurfaced.mjs --lens debug` → `debug: 0/21 macros never referenced in the frontend`

## Reference apps

- **Sentry** — issue inbox (group/triage/resolve), release tracking,
  distributed traces.
- **Datadog** — metrics/alerts dashboard, SLO tracking, log search.

Parity target: "the only difference should be event volume, nothing else."

## Audit finding: already a comprehensive observability console

`app/lenses/debug/page.tsx` (1,524 LOC) plus 8 bespoke components
(`IssueInbox`, `TraceViewer`, `MetricsAndAlerts`, `ReleaseTracker`,
`SLODashboard`, `ProvenanceDashboard`, `InferenceTranscriptViewer`,
`NvdCveFeed`) span 13 tabs: issues, traces, metrics, releases, logs,
inspector, context, monitoring, compute, templates, test, status, events.
All 21 registered macros are referenced in the frontend (confirmed by the
unsurfaced-macro detector above) and were spot-checked for real wiring:

```
lensRun('debug', 'issue-list' | 'issue-ingest' | 'issue-detail' | 'issue-update' | 'issue-delete', ...)
lensRun('debug', 'trace-list' | 'trace-detail' | 'trace-record', ...)
lensRun('debug', 'metric-record' | 'metric-series', ...)
lensRun('debug', 'alert-create' | 'alert-list' | 'alert-update' | 'alert-delete', ...)
lensRun('debug', 'release-create' | 'release-list' | 'release-delete', ...)
```

(the four AI-analysis macros — `logAnalysis`, `errorCluster`,
`performanceProfile`, `stackTraceAnalysis` — are also present, covered by
the log/logs and analysis tabs.) The Status/Events/Test/Inspector tabs pull
from real admin endpoints (`status`, `perfMetrics`, `jobs`) rendered as
live JSON, not fabricated placeholder text.

## Checklist

| Item | Disposition |
|---|---|
| Issue inbox (ingest/list/detail/update/delete) | ALREADY REAL — `IssueInbox.tsx` |
| Distributed trace viewer | ALREADY REAL — `TraceViewer.tsx` |
| Metrics + alerting | ALREADY REAL — `MetricsAndAlerts.tsx` |
| Release tracking | ALREADY REAL — `ReleaseTracker.tsx` |
| SLO dashboard | ALREADY REAL — `SLODashboard.tsx` |
| Object/DTU/artifact inspector | ALREADY REAL — `page.tsx` "inspector" tab |
| Admin test console (tick kernel, GC, DB/Redis status) | ALREADY REAL — `page.tsx` "test" tab against live admin endpoints |

No fabricated data (`Math.random()` in render paths, hardcoded arrays
presented as live), no dead generic-scaffold body, found anywhere in this
lens's 9 files. No changes made — this lens is genuinely complete against
its own reference bar.

## Verification

- `node scripts/verify-lens-backends.mjs` — `debug`: `WIRED` (unchanged).
- `node scripts/grade-ux-polish.mjs --honest` — `debug`: `tier: "polished"`,
  `isGenericScaffold: false`, bespoke ratio 0.576 (9 files, 3,600 LOC total,
  2,075 LOC bespoke-component).

---

## Addendum — S10 real projects (2026-10-29, PR #1843)

This map predates Product Review 2's freeze of the Debug lens. That review's
F3 found the gap this addendum records as closed: **there was no project
concept at either layer** (item 33; acceptance flow C1/A1 failed). The §8 Q3
ruling (Ramaj, 2026-10-29) decided projects are real entities — created,
named, switched — and S10 built them. (The PR #1804 rework is recorded in
that PR; this addendum covers only the S10 layer.)

**New macros (domain now registers 25):** `project-create`, `project-list`,
`project-update`, `project-delete` in `server/domains/debug.js`.

- Every account has a **Default project**, materialized lazily as real state
  on first project-aware contact. Records stored before projects existed
  carry no `projectId` and belong to the default project on every path.
- `project-create`: name required; an exact duplicate name in the account is
  refused. `project-list` returns per-project record counts (issues, traces,
  metric samples, alert rules, releases). `project-delete`: the default
  project cannot be deleted; a project holding records requires
  `confirm: true` and cascade-deletes exactly its records, returning the
  removed counts as the receipt.
- **Scoping:** an optional `projectId` (absent = default) is honoured by
  `issue-ingest` / `issue-list` / `issue-detail`, `trace-record` /
  `trace-list` / `trace-detail`, `metric-record` / `metric-series`,
  `alert-create` / `alert-list`, `release-create` / `release-list`. Issue
  fingerprint grouping is per-project; `issue-list`'s summary describes the
  selected project; alert evaluation runs only the recorded sample's project
  rules; a release version is unique per project, not per account. An
  unknown `projectId` is refused ("project not found") on reads and writes.
- **Frontend:** `ProjectContext` holds the selection (persisted per device,
  derived with fallback to the default project); the header
  `ProjectSwitcher` switches/creates/renames/deletes, its delete confirm
  stating the record counts. `IssueInbox`, `TraceViewer`,
  `MetricsAndAlerts`, `ReleaseTracker` pass the selected `projectId` at
  their existing single call sites — no macro gained a second caller.

Verified by `server/tests/debug-projects.test.js` (13 behaviour tests:
materialization, CRUD + refusals, cascade receipt, legacy rule, per-project
grouping/isolation, cross-account isolation) alongside the unchanged
`debug-domain-parity` suite. Live acceptance is Review 2's re-pass of C1 on
deploy.
