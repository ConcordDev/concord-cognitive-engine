# all — Feature Completeness Spec

Role: Cross-domain search & aggregation over the whole DTU substrate. Infrastructure / world lens — feed-exempt.

## Features

### Domain logic
- [x] Pre-existing analysis macros (calculators / aggregation specific to all)

### Records substrate (THIN-tier depth pass)
- [x] Track saved searchs — add / list / update / delete (macros: all.record-add / record-list / record-update / record-delete)
- [x] saved search dashboard — totals by status + kind, kind/status whitelists (macro: all.record-dashboard)
- [x] Frontend — `LensSubstratePanel` mounted in the lens page (dashboard strip + add form + managed list with status cycling)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Real-time external feed | a free public data source | **Feed-exempt.** all is an infrastructure/world lens — it has no real-world rival consumer app and no public data source to ingest. Per the Boundary-register convention, infra/world lenses are feed-exempt; depth is delivered through the persistent records substrate instead. |

## Verification log
- 2026-05-20: Depth pass — shared records substrate wired via `registerLensSubstrate` (server/lib/lens-substrate.js). `node --check` clean.
- 2026-05-20: Tests — `tests/lens-substrate-depth.test.js` green (substrate round-trip + per-user scope).
- 2026-05-20: Frontend — `LensSubstratePanel domain="all"` mounted; `tsc --noEmit` exit 0.
