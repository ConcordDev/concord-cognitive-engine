# Concordia World Content Integration

## Goal
Integrate the planner/producer-approved hero assets into the existing staged Concordia world pipeline without adding a second renderer, streamer, generator, or gameplay authority.

## Steps
1. Read the existing staged pipeline scripts and generated-world documentation to identify authoritative binding points and existing asset-resolution patterns.
2. Inspect the provided hero assets and relevant scene/prefab hierarchy or runtime marker components.
3. Add/update a deterministic generated world-content registry/ledger under `Assets/Concordia/Generated/WorldContent/` containing all worlds, asset/material paths, lore sources, provenance, action, binding target, and verification state; explicitly record deferred worlds.
4. Make surgical edits only to the existing staged presentation path needed to bind Ruins, Fantasy, Frontier, and Hub wrapper validation, while preserving Tunya's GoldenSliceRuntime authority and all fallback/LeanPlay behavior.
5. Refresh/compile, inspect console errors, validate the registry and relevant scene/runtime objects, and report the manifest plus every modified script.