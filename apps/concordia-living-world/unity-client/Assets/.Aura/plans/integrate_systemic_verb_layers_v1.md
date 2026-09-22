# Integrate systemic verb layers

## Goal
Integrate gunsmithing plus any existing spellcrafting/container implementations into the canonical Concordia runtime without creating parallel authorities.

## Steps
1. Inspect the existing GameplayCore bridge, persistence services/models, ConcordiaPlayer/Game interaction seams, ConKay adapters, WorldField/Fabrication/combat/economy/vehicle/player inventory authorities, and the provided gunsmithing files.
2. Locate any spellcrafting/container files currently present despite the failed generation and identify canonical seams and stable IDs.
3. Make minimal edits or add adapters/contracts only where required to bind resolution, persistence, containers, provenance, and world-transition preservation.
4. Refresh/compile the Unity project and fix any compile errors caused by the integration.
5. Re-inspect changed files and report changed paths, compile result, and explicitly unverified runtime paths.
