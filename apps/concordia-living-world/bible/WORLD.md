# WORLD

**Status:** LIVE (ids, refusals, travel, kingdom identity) · PARTIAL (cross-world)  
**Authority:** Concord (state) / Unity (mesh)  
**Source:** `Canon.cs`, `WorldBuilder.cs`, `WorldKit.cs`, `src/game/worlds.ts`

## LIVE

Ten `WorldId`: Hub, Ruins, Tunya, Fantasy, Crime, Cyber, Frontier, Superhero, Crucible, Sere (Court waystone — not a ninth Refusal gate).

Hub = Unburned Court. Eight gates with refusal + theNo + color + angle.

`SteelLive`: Hub false except arena; other worlds true.

Travel: `ConcordiaGame.Travel` rebuilds `World`. Must `DestroyImmediate` previous root.

Cities: `CityAtlas` + `CityTown` + `CityGate`. Each town has a PBR plaza pad (brick/asphalt/moss/earth — Court stays unpaved), a street cross, ten `DressVocab` slots (imported My Assets first, Kenney fallback), edge flora plus extra grass patches, and outskirts hostiles from authored fauna. Fantasy and Ruins also get a fort rim. Interiors: four playable rooms on the hero city only; cities 1–3 get `FakeWindows` glow; the rest stay facade-only (Tunya hitch). Steel worlds get a hold with mouth / hall / vault rooms (`DungeonGate`). HUD: circular minimap + vitals rings (SR2 camera language) plus a world-life clock. Visual dump: `/tmp/concordia-visual.txt`. See `VISUAL.md`.

`WorldClock` / `WorldMemory` port `kernel.ts` + `persist.ts`: hour, day, weather, ecology, prices. Leaving a world writes a slice; returning advances the away hours so the kingdom did not freeze. LOD is REAL / BULK / VIRTUAL. `TickEvents` ports `events.ts` (authored title / refusal / fauna / city / lore beat only). City plazas now have sidewalk slabs. Ecology below 0.28 skips outskirts packs; below 0.4 halves them.

`KingdomBook` treats each `WorldId` as a kingdom: staple from the refusal, settlements from `CityAtlas`, factions/people/lore from `WorldBook`. Hub: the Court is the city. Sere: Court waystone, not a ninth Refusal gate. Audit dump: `/tmp/concordia-kingdom.txt` (WORLD → KINGDOM → REGION → SETTLEMENT → ACTIVITY → ACTOR).

`CrossRing` ports `cross.ts`: walking a gate or an away pulse that has surplus **dispatches a Caravan** (`loading → traveling → at_gate → arrived`). Stock leaves the origin when the caravan is created; the destination only receives cargo after a 5% Ring tariff is recorded on `tariffsCsv`. A nearby traveling/at_gate caravan can dress a cart; far ones stay a HUD line. A carried kit is still noticed in the destination (heat + rumor). Authored CROSS_PLOT + traveler CSV unchanged.

`GatePost` binds every `WorldGate`: Hub Ring doors belong to Concordant Watch; other worlds use that world's first authored faction; Sere is a waystone (no guards, not a ninth Refusal gate). Guards are unlabeled ambient ("They keep their own hours. Not an authored citizen.").

`/unity-ws` now mounts (`mountUnityGateway`) and answers `kingdom:request` with `buildKingdomSnapshot` — authored graph only. Offline Editor play stays `{ok:false, reason:'no_gateway'}`. Connected HUD reads `ConcordClient.HudLine` from the snapshot.

## TARGET

Each world is a civilization with WorldLaw (statement + sim/game/visual/audio/npc/econ/quest effects). World Dresser still Kenney-first until Store packs land.

## Gap

Stock is still a slice float underneath the caravan qty. No persist-sync of caravans back onto the server snapshot (those arrays stay empty on `/unity-ws` until then). Kenney/graybox presentation. No invented settlements.
