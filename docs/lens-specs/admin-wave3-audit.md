# admin — Wave 3 audit (confirming — no changes)

Frontend Rebuild Program, Wave 3. `admin` already scored `polished` under
`grade-ux-polish.mjs --honest` (`isGenericScaffold: false`). This audit reads
the actual code (not the grader, not the stale `docs/lens-specs/admin.md`)
to check for fabricated data, dead clicks, and generic-scaffold remnants
before concluding "nothing to fix."

Backend: `server/domains/admin.js` (1,244 LOC — the older `admin.md` spec's
"486 LOC" figure is stale; the domain grew substantially past that snapshot).
19 registered macros: `auditLog`, `permissionMatrix`, `systemHealth`,
`recordMetric`, `metricHistory`, `alertRuleUpsert`, `alertRuleDelete`,
`alertEvaluate`, `tenantAction`, `tenantList`, `logAppend`, `logSearch`,
`traceRecord`, `traceList`, `featureFlagSet`, `featureFlagList`,
`incidentOpen`, `incidentUpdate`, `incidentList`.

Frontend: `concord-frontend/app/lenses/admin/page.tsx` (2,729 LOC) mounts 9
bespoke components (`OpsConsole`, `MonitoringPanel`, `BackupHealth`,
`CDNStatus`, `CodeEngineStatus`, `LiveSystemHealth`, `LivenessPanel`,
`RepairDashboard`, `AdminDashboard`) — 7,821 total LOC, 65% bespoke ratio.

## `node scripts/lens-unsurfaced.mjs --lens admin`

```
admin: 1/19 macros never referenced in the frontend
  traceRecord-* (1): traceRecord
```

## Finding: `traceRecord` — FALSE POSITIVE (no change)

`traceRecord` (`server/domains/admin.js:951`) is a write-only *ingestion*
macro — it records a distributed-request trace (spans) into the trace store
that `traceList`/`OpsConsole`'s Traces panel then reads back and renders.
It's meant to be called by instrumentation code (a request middleware or an
external agent emitting spans), not clicked by a user — the same shape as
`recordMetric`/`logAppend`, which are also never called from a button.
`OpsConsole.tsx:11` documents this explicitly ("write macros … and the read
macros surface them") and the Traces panel's empty state literally says
"No traces recorded — ingest via the `traceRecord` macro" (`OpsConsole.tsx:934`)
— an honest empty state, not a fabricated trace list. No UI gap: the read
side (`traceList`) is fully wired and renders real data when a trace exists.

## Reference-app parity check (Datadog / Grafana)

Every "Missing" item the stale `docs/lens-specs/admin.md` once listed is now
directly verified present and macro-backed, not a generic-scaffold stand-in:

| Feature | Where |
|---|---|
| Historical time-series (metric history, selectable range) | `metricHistory` → `MonitoringPanel` |
| Alert rules + thresholds editable in UI | `alertRuleUpsert`/`alertRuleDelete`/`alertEvaluate` → `OpsConsole.tsx:371` |
| Per-tenant admin actions (suspend/role-change/quota) | `tenantAction`/`tenantList` → `OpsConsole.tsx:591` |
| Log search/tail with severity filter | `logSearch` → `OpsConsole.tsx:747` |
| Distributed-trace / request-waterfall view | `traceList` → `OpsConsole.tsx:885` |
| Feature-flag toggles | `featureFlagSet`/`featureFlagList` → `OpsConsole.tsx:1007,1030,1044,1056` |
| Incident timeline + on-call ack workflow | `incidentOpen`/`incidentUpdate`/`incidentList` → `OpsConsole.tsx` |

No `Math.random()`, no hardcoded fabricated stats, no dead-click generic
button walls found in `page.tsx` or the 9 mounted components. No changes
made — this lens is genuinely complete against its own reference bar.
