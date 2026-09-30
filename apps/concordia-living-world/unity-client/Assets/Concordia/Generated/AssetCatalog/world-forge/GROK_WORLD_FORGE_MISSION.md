# GROK MISSION — Concordia WORLD FORGE (Geo → Civ → Physical)
# Standing companion to GROK_FULL_ASSET_MISSION.md. TEXT/JSON only.
# Drive via asset-catalog queue slices W00–W11 (advance_asset_slice.sh / tmux grok-assets).

## Why
Concord simulation/civ substrate is largely REAL. Missing: geographic + civilizational PHYSICALIZER.
Read first: ~/.zuko/WORLD_FORGE_GEO_CIV_AUDIT.md and ~/.zuko/asset-catalog/world-forge/GEO_CIV_AUDIT.md

## Hard rules
- Do NOT invent a second setting. Consume native-bible + lookfeel MAP_MASTER + STYLE_* + GEO_* + Concord factions.
- Do NOT write random pretty maps disconnected from civ, or random kingdoms disconnected from geo.
- Pipeline order is sacred: Elevation→Hydrology→Climate→Biome→Resources→Mobility→Suitability→Civ→Pop→Economy→Growth→Infra→Physicalization.
- Specs must name real Concord files to extend (world-terrain.js, terrain-water.js, procgen-settlements.js, faction-strategy.js, procedural buildings, TreeLayer) as INTEGRATION targets — not replacements-by-denial.
- Flower Law 42m Hub plaza; Fantasy=Sundering; no Vinewood; CX≠Quaternius.
- Disk tight: Markdown+JSON only. No mesh/image dumps.
- Append bind-ready schemas under ~/.zuko/asset-catalog/world-forge/; mirror text to Assets/Concordia/Generated/AssetCatalog/world-forge/ when useful.
- Each slice ends with out/<id>/SLICE_REPORT.md containing STATUS COMPLETE.

## Per-slice deliverables
Every W** slice writes SPEC.md + SPEC.json under world-forge/<id>/:
- data model / algorithms / inputs from prior stage / outputs for next stage
- Concord code touchpoints
- Aura/Cursor build order notes (what NOT to build yet)
- Pilot numbers where helpful (design-intent, marked)

## Success for a slice
SPEC files exist; SLICE_REPORT STATUS COMPLETE; CATALOG_INDEX.json updated with world_forge entries; no deletion of prior asset-catalog or PROMPTS_INDEX rows.

START from the slice prompt file written by advance_asset_slice.sh.
