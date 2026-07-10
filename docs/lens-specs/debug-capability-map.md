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
