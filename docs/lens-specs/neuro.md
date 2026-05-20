# neuro — Feature Completeness Spec

Role: Neuroscience study & signal tracking. Infrastructure / world lens — feed-exempt.

## Features

### Domain logic
- [x] Pre-existing analysis macros (calculators / aggregation specific to neuro)

### Records substrate (THIN-tier depth pass)
- [x] Track studys — add / list / update / delete (macros: neuro.record-add / record-list / record-update / record-delete)
- [x] study dashboard — totals by status + kind, kind/status whitelists (macro: neuro.record-dashboard)
- [x] Frontend — `LensSubstratePanel` mounted in the lens page (dashboard strip + add form + managed list with status cycling)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Real-time external feed | a free public data source | **Feed-exempt.** neuro is an infrastructure/world lens — it has no real-world rival consumer app and no public data source to ingest. Per the Boundary-register convention, infra/world lenses are feed-exempt; depth is delivered through the persistent records substrate instead. |

## Verification log
- 2026-05-20: Depth pass — shared records substrate wired via `registerLensSubstrate` (server/lib/lens-substrate.js). `node --check` clean.
- 2026-05-20: Tests — `tests/lens-substrate-depth.test.js` green (substrate round-trip + per-user scope).
- 2026-05-20: Frontend — `LensSubstratePanel domain="neuro"` mounted; `tsc --noEmit` exit 0.
