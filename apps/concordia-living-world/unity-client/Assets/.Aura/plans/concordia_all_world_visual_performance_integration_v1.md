# Concordia All-World Visual and Performance Integration

## Scope
- Bind the five generated world heroes through the existing ConcordiaGame → WorldBuilder → ContinentStream → WorldVisualDirector/GoldenSliceRuntime path.
- Preserve Tunya GoldenSliceRuntime authority, HubLook as the only look stack, staged streaming, LeanPlay, impostor/L2/L3 behavior, gameplay authorities, and persistence.
- Update WorldHeroCatalog with deterministic lore anchors, material hooks, collider/inspection identity, and explicit status markers.
- Update the world registry and provenance ledger with generated assets, master-material assignments, and deferred/unverified renderer/performance status.

## Implementation steps
1. Read and validate the canonical scripts, registry, ledger, generated FBX/material assets, and benchmark assets.
2. Extend WorldHeroCatalog surgically for Crime, Cyber, Superhero, Crucible, and Sere; keep Tunya routed exclusively through GoldenSliceRuntime and preserve existing Hub/Ruins/Fantasy/Frontier bindings.
3. Add hero material resolution through existing HubLook/FreePacks hooks, collider/LOD/inspection marker setup, and staged yield behavior without introducing a renderer.
4. Add minimal WorldVisualDirector/WorldBuilder integration only where required for the hero binding and status markers.
5. Update WORLD_CONTENT_REGISTRY.json and LORE_GENERATED_ASSETS.md with exact provenance, status, lore anchors, and explicit unverified renderer/performance items.
6. Refresh Unity, verify compile errors, inspect modified source/registry, and report exact bound/deferred/untested status.

## Acceptance gates
- All ten world rows have explicit registry status.
- Five generated heroes are bound through WorldVisualDirector for staged chunk construction.
- Tunya remains GoldenSliceRuntime-only.
- No new renderer/look stack, no travel rebuild, no LeanPlay removal, no persistence changes.
- Compile errors remain clear; unsupported features remain marked unverified rather than invented.
