# Concordia Performance Budget

Phase AA defines two-tier perf budgets for the Concordia world lens.
The Playwright harness in `concord-frontend/tests/e2e/perf.spec.ts`
asserts both tiers against `lib/world-lens/perf-monitor.ts`'s sampled
metrics; CI fails the build on a budget breach.

## Tiers

| Tier | Hardware                        | Quality preset | FPS floor | Frame time | Draw calls | Triangles |
|------|---------------------------------|----------------|----------:|-----------:|-----------:|----------:|
| High | NVIDIA RTX PRO 4500 Blackwell   | high / ultra   | 60        | ≤16ms      | ≤500       | ≤2,000,000 |
| Low  | Integrated GPU (Iris Xe baseline) | low          | 30        | ≤33ms      | ≤200       | ≤500,000   |

## Stress harness

`tests/e2e/perf.spec.ts` (Phase AA):
- Spawns 200 procedural NPCs via `procgen.spawn_settlement`.
- Sets weather to storm.
- Records average FPS over a 30s sample window via the
  `window.__CONCORD_PERF__.sample()` snapshot getter.
- Runs at quality=ultra (Blackwell budget) + quality=low
  (integrated budget).
- Asserts `checkBudget(tier).pass === true`.

## Sources of breach (lever map)

If the harness fails, the test report identifies which lever
breached first so a follow-up doesn't need a re-run:

| Metric        | Most likely lever                        | Where to tune                                     |
|---------------|------------------------------------------|---------------------------------------------------|
| FPS / frameMs | Fragment cost (NPC count, weather VFX)   | `AvatarSystem3D` max NPC cap; `WeatherSystem` particle count |
| drawCalls     | Building / tree / NPC instancing         | `BuildingRenderer3D` LOD distance bias; `TreeLayer` chunk count |
| triangles     | Building polygon density + tree leaves   | `procedural-buildings` polygon budget; `l-system-tree` species LOD |

## Per-preset caps (already applied)

The quality preset (`getStoredQualityPreset`) drives:
- TreeLayer: chunkCount = 16 (high/ultra) / 8 (medium) / 0 (low)
- RockLayer: rocks per chunk = 6/4/0 by quality
- Distance cull: trees at 600m, rocks at 500m
- Per-tree leaves use `instanced-mesh-pool` (Phase O)

## Snapshot accessor

```ts
import { sample, checkBudget } from '@/lib/world-lens/perf-monitor';
const sample = sample();         // { fps, frameMs, drawCalls, triangles }
const result = checkBudget('high'); // { tier, pass, breached: [...] }
```

`window.__CONCORD_PERF__.sample()` exposes the same getter to the
e2e harness without bundling test deps into the runtime.
