# suffering — Feature Completeness Spec

Role: Existential / embodied lens — tracks and contextualizes episodes
of suffering (physical, emotional, existential, witnessed). Part of the
embodied substrate family. Infrastructure / world lens — feed-exempt.

## Features

### Domain logic
- [x] Pre-existing analysis macros (suffering classification + reflection)

### Records substrate (THIN-tier depth pass)
- [x] Track episodes — add / list / update / delete (macros: suffering.record-add / record-list / record-update / record-delete)
- [x] Episode dashboard — totals by status (acute / processing / integrated) + kind (macro: suffering.record-dashboard)
- [x] Frontend — `LensSubstratePanel` mounted in the lens page

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Real-time external feed | a free public data source | **Feed-exempt.** suffering is an existential/embodied lens — there is no real-world rival app or public data source. Depth is delivered through the persistent episode-tracking substrate. |

## Verification log
- 2026-05-20: Depth pass — records substrate wired via `registerLensSubstrate`. `node --check` clean.
- 2026-05-20: Tests — `tests/lens-substrate-depth.test.js` green (suffering included in the wired-domains loop).
- 2026-05-20: Frontend — `LensSubstratePanel domain="suffering"` mounted; `tsc --noEmit` exit 0.
