# settings — Feature Completeness Spec

Role: Client preferences & saved settings profiles. Infrastructure / world lens — feed-exempt.

## Features

### Domain logic
- [x] Pre-existing analysis macros (calculators / aggregation specific to settings)

### Records substrate (THIN-tier depth pass)
- [x] Track profiles — add / list / update / delete (macros: settings.record-add / record-list / record-update / record-delete)
- [x] profile dashboard — totals by status + kind, kind/status whitelists (macro: settings.record-dashboard)
- [x] Frontend — `LensSubstratePanel` mounted in the lens page (dashboard strip + add form + managed list with status cycling)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Real-time external feed | a free public data source | **Feed-exempt.** settings is an infrastructure/world lens — it has no real-world rival consumer app and no public data source to ingest. Per the Boundary-register convention, infra/world lenses are feed-exempt; depth is delivered through the persistent records substrate instead. |

## Verification log
- 2026-05-20: Depth pass — shared records substrate wired via `registerLensSubstrate` (server/lib/lens-substrate.js). `node --check` clean.
- 2026-05-20: Tests — `tests/lens-substrate-depth.test.js` green (substrate round-trip + per-user scope).
- 2026-05-20: Frontend — `LensSubstratePanel domain="settings"` mounted; `tsc --noEmit` exit 0.
