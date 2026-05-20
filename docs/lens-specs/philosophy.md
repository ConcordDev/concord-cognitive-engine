# philosophy — Feature Completeness Spec

Rival app(s): Are.na, Internet Encyclopedia of Philosophy (2026)
Sources:
- https://www.are.na/ (channels of blocks; a block connectable to many channels)
- https://iep.utm.edu/ (philosophy reference)

Previously the philosophy domain was analysis-only (argument map,
thought experiment, dialectic, ethics). This spec covers the new
Are.na-shape idea-curation substrate.

## Features

### Channels & blocks
- [x] Create / list / delete channels (macro: philosophy.channel-create / channel-list / channel-delete)
- [x] Channel detail with its blocks (macro: philosophy.channel-detail)
- [x] Add typed blocks — text / link / quote, optional source (macro: philosophy.block-add)
- [x] Connect / disconnect a block to additional channels — multi-channel membership (macro: philosophy.block-connect)
- [x] Delete a block (macro: philosophy.block-delete)
- [x] Channel-delete detaches blocks and drops orphaned ones

### Search & overview
- [x] Search across channel titles + block content (macro: philosophy.philosophy-search)
- [x] Dashboard — channels, blocks, cross-connected blocks, by-kind breakdown (macro: philosophy.philosophy-dashboard)

### Reasoning tools (retained)
- [x] Argument map — premises → conclusion validity/soundness (macro: philosophy.argumentMap)
- [x] Thought experiment permutations (macro: philosophy.thoughtExperiment)
- [x] Hegelian dialectic synthesis (macro: philosophy.dialecticSynthesis)
- [x] Ethical framework comparison (macro: philosophy.ethicalFramework)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| The IEP encyclopedia corpus | a licensed reference dataset | the reasoning tools (argument map, dialectic, ethics) cover structured philosophy work; channels curate sources |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/philosophy.js` clean. 12
  macros (4 reasoning tools + 8 curation substrate).
- 2026-05-20: Tests — `tests/philosophy-domain-parity.test.js` 10/10 green
  (channel CRUD + per-user scope + orphan-drop on delete / typed blocks +
  unknown-kind fallback / cross-channel connect+disconnect / block delete /
  search / dashboard cross-connected count / reasoning tools intact).
- 2026-05-20: Frontend — new `PhilosophyChannels` (channel list, typed-block
  grid, multi-channel membership) mounted in the philosophy lens page.
  `npx tsc --noEmit` exit 0.
