# Debug Lens — Capability Map (Frontend Rebuild Program, Wave 3 — confirming, no changes)

> **Re-verification (HANDOFF-3 batch L9b, 2026-10-28, against main e9791d4d):**
> The confirming audit below is kept as history. Current truth:
>
> - **21/21 macros still named in the frontend** (fresh scan, zero
>   unsurfaced) — issues/traces/metrics/alerts/releases plus the four
>   AI-analysis macros all remain wired to real surfaces.
> - The page has since been refactored from the 1,524-line page this
>   audit read into a 15-line shell over `components/debug/DebugWorkspace`
>   (same 13-tool structure: overview/status/issues/traces/metrics/
>   releases/events/logs/inspector/context/monitoring/compute/
>   templates/cve/test), so the surface this audit verified now lives
>   in the workspace component.
> - **Shipped in this batch:** the concept's serif headline — "What
>   broke, {username}" — as the workspace header
>   (`data-testid="debug-greeting"`, `tests/debug-greeting.test.tsx`).
> - Server suites run locally this pass: debug-domain-parity passes
>   (in the combined 89-pass L9b run).


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

---

## Addendum — Q1 Sentry-compatible ingest (2026-10-29)

Review 2's F2 found the ingest gap this addendum records as closed:
**nothing could report errors into Debug from outside** (item 9; flows
C2/A2 failed; §5e A8 not runnable — no endpoint existed to send a
malformed event to). The §8 Q1 ruling (Ramaj, 2026-10-29) decided:
build the Sentry-compatible endpoint — the pings-only and neither
options were declined, and the cron check-in shape with them.

**New macros (domain now registers 28):** `ingest-key-create`,
`ingest-key-list`, `ingest-key-revoke` in `server/domains/debug.js`.
**New public endpoint:** `POST /api/debug/ingest/:projectId/envelope/`
(`server/routes/debug-ingest.js`, mounted in `server.js`).

- **Keys:** one per project, `cdi_`-prefixed, submit-only — a key can
  post events to its project and read nothing. Only the SHA-256 hash is
  stored (the `lib/api-keys.js` discipline); the raw key is returned
  once by `ingest-key-create` and never logged or listed afterwards.
  Revocation is immediate. Deleting a project cascade-deletes its keys
  (the S10 counts and delete confirm include them) — no orphaned
  credentials.
- **Endpoint:** accepts Sentry envelope bodies (raw, 1 MB cap,
  gzip-aware), authenticated by the key in the `X-Sentry-Auth` header —
  never in a URL or a log. Only `event` items are ingested; other item
  types are acknowledged with the ignored count named. Status taxonomy:
  200 ingested · 400 malformed (the defect is named — §5e A8) or
  key/project scope mismatch · 401 one body for missing, unknown, and
  revoked keys · 404 the key's project is gone · 413 oversized · 429
  per-key cap (600/min, abuse control — deliberately not a meter;
  Sentry's quota economics stay un-copied per the review's §3b) · 503
  domain not registered yet. Gate wiring follows the INC-72 discipline:
  one exact-route regex (`DEBUG_INGEST_RE` in
  `server/middleware/csrf.js`) exempts the route at the auth,
  write-auth, CSRF, and bot gates — never a prefix.
- **Mapping:** envelope parsing and event→issue mapping are pure
  (`server/lib/sentry-envelope.js`); the endpoint and the manual
  `issue-ingest` macro share one grouping implementation
  (`ingestIssueCore`), so an error groups identically however it
  arrives. Sentry specifics: exception wins over message, culprit is
  the last in_app frame, stack renders newest-first, level `debug`
  maps to info, occurrence times are clamped to a sane window.
- **Frontend:** `IngestPanel` in the Issues surface — key list/create/
  revoke for the selected project, the one-time reveal (key, DSN, a
  dependency-free reporting snippet), and **Send test event**, which
  posts a real envelope from the browser through the public endpoint
  (§5e A2's external leg, runnable in-lens).

Verified by `server/tests/debug-ingest.test.js` (envelope parse +
malformed taxonomy, mapping, key lifecycle and hygiene, handler status
taxonomy, grouping across both arrival paths, the exact-route regex
pin) alongside `debug-projects` and `debug-domain-parity`. NOT RUN:
the express route end-to-end and FE type-check (no `node_modules` in
the build sandbox — standing NEEDS-MAC). Live acceptance is Review 2's
re-pass of A2 + A8 on deploy.
