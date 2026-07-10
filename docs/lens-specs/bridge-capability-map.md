# Bridge Lens — Capability Map (Frontend Rebuild Program, Wave 3)

Reproduce the macro list:
`grep -c 'registerLensAction("bridge"' server/domains/bridge.js` → 22

## Reference app

A Mastodon-style federation admin console / mesh-network dashboard —
confirmed by scope: peers, sync topology graph, flow retry/replay, field-
mapping transforms, per-peer schedules, threshold alerting, throughput
history (`FederationConsole.tsx` docstring, lines 4-14).

## `scenebridge.js` — confirmed decoy, unrelated

`server/domains/scenebridge.js` registers macros under the **`scenebridge`**
domain (not `bridge`): `scenebridge.export`/`scenebridge.stats`, serializing
`world_buildings` geometry into a glTF-flavored scene graph for external 3D
engines. Zero relation to federation/peers/walkers.

## Audit finding: real backend + one broken generic wrapper (fixed) + one redundant one (removed)

All 22 `bridge` macros are real: 4 legacy artifact-analysis macros
(`connectionHealth`, `dataMapping`, `syncStatus`, `throughputAnalysis`) plus
18 ops-console federation macros (`peer*`, `syncTopology`, `recordFlow`/
`flowList`/`flowReplay`, `mappingUpsert`/`mappingList`/`mappingRemove`/
`mappingPreview` — with a real `TRANSFORMS` dict actually executed,
`scheduleSet`/`scheduleList`, `alertRuleUpsert`/`alertRuleRemove`/
`alertEvaluate`/`alertRuleList`, `throughputHistory`), all persisted, all
`try/catch`-wrapped.

The page itself covers **two genuinely real, independent systems**: DTU-swarm
"Knowledge Organisms" (`/api/bridge/organisms|log|debates|births|emergents`,
real `STATE._bridge.*`/`STATE.swarms`) and, under its "federation" tab,
`FederationConsole.tsx` (921 LOC), which calls every one of the 22 macros
above by name with no fabricated data. `ConcordLinkWalkers.tsx` hits a third
real system (`/api/concord-link/walkers`, DB-backed hire/journey/intercept
logic) — also genuine, not decorative.

**Confirmed broken (fixed):** `page.tsx` mounted `<ManifestActionBar />`
(line 171, pre-fix), which renders one button per verb in the lens
manifest's `actions: ['analyze', 'generate', 'validate', 'export',
'summarize']` (`lib/lenses/manifest.ts:2507`) and calls
`runDomain('bridge', <verb>)`. **None of those five verbs are registered as
`bridge` macros** — only the 22 real ones listed above exist. Every one of
those five buttons would 404/error on click. This is the Wave-2 batch-5/6
defect pattern in its purest form: a real, fully-designed `FederationConsole`
sitting next to a broken generic action wall with zero working buttons.

**Confirmed redundant (removed):** `<AutoActionStrip domain="bridge" />`
(line 588, pre-fix) auto-discovers the same 22 real macros `FederationConsole`
already exposes through purpose-built panels, rendering them a second time
as a raw-JSON generic button wall. Not broken, but pure duplication with
zero net capability — the CLAUDE.md "zero generic tendencies" invariant
treats a generic wall standing next to a fully-designed real surface as a
process failure even when the underlying macro is real.

Also found: a misleading dev comment ("Sprint 17 production-grade polish
sentinels — accessibility-only, never visually displayed") wrapped only an
`sr-only` sentinel div, while the very-much-visible
`RecentMineCard`/`AutoActionStrip`/`CrossLensRecentsPanel` were unwrapped
siblings rendering in full.

`node scripts/lens-unsurfaced.mjs --lens bridge`:
```
bridge: 0/22 macros never referenced in the frontend
```
Zero genuinely unsurfaced backend capability — everything is wired to real
UI (18 macros via `FederationConsole`, 4 legacy macros via the page's
existing "Bridge Actions" inline panel, which is real/functional and was
left untouched).

## What this rebuild changed

`app/lenses/bridge/page.tsx`:
- Removed `<ManifestActionBar />` and its import — broken action set (no
  matching macros exist for any of its 5 verbs).
- Removed `<AutoActionStrip domain="bridge" />` and its import — fully
  redundant with `FederationConsole`'s designed panels.
- Kept `RecentMineCard`/`CrossLensRecentsPanel` (harmless, `hideWhenEmpty`,
  legitimate cross-lens continuity) and `LensFeaturePanel` (supplementary
  capability-spec reference, not a broken action surface); cleaned up the
  now-inaccurate "accessibility-only" comment.

## Verification

- `npx eslint app/lenses/bridge/page.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — `bridge` stays `WIRED`.
- `node scripts/grade-ux-polish.mjs --honest` — `bridge`: `tier: "polished"`, `isGenericScaffold: false`.
