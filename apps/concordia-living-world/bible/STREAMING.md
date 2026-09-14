# STREAMING

**Status:** LIVE (continent stream, 2026-09-12)  
**Authority:** Unity presentation · Concord interest set  

W3: civilizations sit on one megaworld plane (`MegaworldMap` / `ContinentStream`). Walking does **not** rebuild the scene. Link gates remain the only teleport (`LastTravelKind = link_gate`). Walking through a Ring `WorldGate` trigger is that teleport. Overland is walking *between* gates. Far chunks unload past `StreamOutM`. Hub Court stays authored at the origin. Hub chunk itself unloads past `HubKeepM`, not `StreamOutM`.

Playable scale: 400 km civilization radius × 0.55 m/km ≈ 220 m on foot. Kernel field still speaks kilometres via `PresentToKm`. `StreamOutM` is wider than the ring so impostors are visible from the Court. Walking SoftEnters `MegaworldMap.RegionAt` (inside `ArriveM` of a Present). Mid-ring stays Hub-overland — `Toward` is bearing for signs, not the world underfoot. `SoftEnter` calls `SyncActor` **before** the `WorldClock` already-there return — clock matching is not enough (`Canon.SteelLive` reads `ConcordiaPlayer.world`). A walk SoftEnter also `NoteWorld`s → `ConcordClient.JoinWorld` (EnsureConnected + `scene:request`). Kernel `notePlayerWorld` stamps `player_world_state`. Kitchen retries every 8s if Start missed :5050. `Travel` always `Bind`s then `Teleport`s to `MegaworldMap.Present` (~220m). It never `_world.Build`s (that Purge + SteelSpawn wipe emptied chunks and left one WorldGate). Hub chunk stays loaded so the Ring of 8 persists. `LastTravelKind` is `walk` on SoftEnter unless Teleport passes `link_gate`. Real region change stamps `WorldClock.LastEvent` (left / crossed / came home) so talk still hangs yesterday in the air.

Render LOD: L0 unload past `StreamOutM`, L1 impostor (named skyline, no NPCs) between StreamIn and StreamOut, L2 HubKit `BuildChunk` inside StreamIn, L3 same chunk near `L3NearM`. Corridor rocks/hills/marks sit on the roads. A missing pack is not a town.

TARGET (not this pass): ECS/DOTS, heightmap continents, vehicles for the uncompressed 400 km.
