# Concordia Runtime Integration Plan

## Objective
Unify the completed persistence, vehicles, world-simulation, economy/construction, and presentation slices behind the existing Concordia runtime authorities without replacing current systems.

## Steps
1. Inspect the actual additive slice files and canonical runtime files, plus existing quest/NPC/creature integration points.
2. Identify the minimum authoritative boot/update/save-load/travel/input/vehicle/economy/consequence/presentation/diagnostics hooks.
3. Apply minimal edits only to existing integration files; add null-safe fallbacks and avoid duplicate authorities.
4. Refresh Unity, compile, inspect errors, and fix only errors introduced or blocking the unified path.
5. Verify reachable end-to-end paths with editor/runtime checks and report changed paths plus observed results.

## Constraints
- Preserve existing URP, HubKit, locomotion, and HitResolver architecture.
- Do not claim serialization-only or decorative-only features are integrated.
- Prefer existing services/hosts as authorities and keep adapters optional.
