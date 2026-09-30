# CONTENT_PIPELINE

**Status:** PARTIAL  
**Authority:** Canon JSON + Unity import  

LIVE: `content/world/` and `Resources/Concordia/Canon/` triplets (npcs, factions, lore, quests, creatures). Kenney/KayKit/Rocketbox/Poly Haven under `Models/`. Imported My Assets resolve through `DressVocab` from `Assets/Store/` **or** `Assets/<Pack Name>/` (culture from WorldId). Package Manager My Assets listed ≠ imported. `WorldBook` refuses invented lines.

TARGET: visual IDs on NPCs and buildings (mesh, sockets, license). Import postprocessors assign URP materials (see `RocketboxDress.cs`). No magenta meshes ship. Store packs become raw material for the dresser, never a single-pack dependency.

Gap: Store packs are not in this tree yet (no My Assets cache on the last machine). Dressing still reads Kenney until they land. See `VISUAL.md`.
