# STREAMING

**Status:** LIVE (continent stream, 2026-09-12)  
**Authority:** Unity presentation · Concord interest set  

W3: civilizations sit on one megaworld plane (`MegaworldMap` / `ContinentStream`). Walking does **not** rebuild the scene. Link gates remain the only teleport (`LastTravelKind = link_gate`). Walking through a Ring `WorldGate` trigger is that teleport. Overland is walking *between* gates. Far chunks unload past `StreamOutM`. Hub Court stays authored at the origin. Hub chunk itself unloads past `HubKeepM`, not `StreamOutM`.

Playable scale: 400 km civilization radius × 0.55 m/km ≈ 220 m on foot. Kernel field still speaks kilometres via `PresentToKm`. `StreamOutM` is wider than the ring so impostors are visible from the Court. `SoftEnter` writes `ConcordiaPlayer.world` so Flower Law cannot follow the player out of `Canon.HubLawRadius`.

Render LOD: L0 unload past `StreamOutM`, L1 impostor (named skyline, no NPCs) between StreamIn and StreamOut, L2 HubKit `BuildChunk` inside StreamIn, L3 same chunk near `L3NearM`. Corridor rocks/hills/marks sit on the roads. A missing pack is not a town.

TARGET (not this pass): ECS/DOTS, heightmap continents, vehicles for the uncompressed 400 km.
