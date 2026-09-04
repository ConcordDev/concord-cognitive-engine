# CONTENT_PIPELINE

**Status:** PARTIAL  
**Authority:** Canon JSON + Unity import  

LIVE: `content/world/` and `Resources/Concordia/Canon/` triplets (npcs, factions, lore, quests, creatures). Kenney/KayKit/Rocketbox/Poly Haven under `Models/`. `WorldBook` refuses invented lines.

TARGET: visual IDs on NPCs and buildings (mesh, sockets, license). Import postprocessors assign URP materials (see `RocketboxDress.cs`). No magenta meshes ship.

Gap: Kenney GLBs still Standard/error on URP.
