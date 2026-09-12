# Concordia system matrix

**This is an audit, not a rebuild.** Concordia already has a world/kingdom/region/settlement/activity/actor hierarchy, a server MMO substrate, and a Unity kitchen kernel. AAA quality here means those layers **agree**, not that we stand up a second civilization engine.

Locked:

- Do **not** throw a generic “Concordia 2.0” sim on PR #954. #954 is the playable Unity floor (walk, swing, HUD, talk, enter).
- Simulation scale must never equal rendering scale. The server may hold a universe; a client renders a bubble.
- Game-economy execution and any real-money AutoTrader are **different trust boundaries**. They do not share an execution path.
- Sere is not a ninth Refusal gate. Frontier embassy is a road, not a seat. Do not invent outsider romance or put it in anyone's mouth.
- Recipes, resources, and gear **extend** `RESOURCE_CATALOG` / `craft-resolve` / `item-affixes`. Do not hand-author fifty thousand finished swords.

Related maps (do not duplicate; this file is the stack index):

- `docs/MMO_RPG_COMPLETENESS_AUDIT.md` — 21-pillar *playable MMO* scorecard (web + server).
- `docs/concordia-specs/crafting-economy-housing-capability-map.md`
- `docs/concordia-specs/factions-politics-capability-map.md`
- `docs/concordia-specs/quests-dialogue-capability-map.md`
- `docs/concordia-specs/combat-feel-residuals-capability-map.md`
- `docs/NOVELTY_INVENTORY.md` — look here before building anything.

Unity hierarchy pin — **on PR #954** (`cursor/sr2-playable-floor-1b18`), not on `main` until that PR merges:

```
WORLD → KINGDOM → REGION → SETTLEMENT → ACTIVITY → ACTOR
```

in `apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/WorldBook.cs` (`KingdomBook.Audit`). Server export of the same graph (also on that PR): `server/lib/concordia-kingdom-snapshot.js` (`kingdom:request`). Stock / need / caravans stay **empty on the server snapshot** until persist-sync — that emptiness is honest, not a hole to fill with fake floats.

On `main` today the living-world index is `content/world/` + server heartbeats + the web world lens. The Unity kitchen is the presentation + local kernel landing in #954. This matrix describes the **combined** stack those two must agree on.

---

## Destination — persistent universe platform

Implementing the spec **on top of this stack** does not make “a bigger game.” It changes the category:

```
Concordia = autonomous persistent universe
          + simulation engine
          + game clients (Unity / web / Godot)
          + cognitive interface (Concord / 2B)
```

The fundamental object is a **universe that can generate, simulate, remember, and present its own history.** The player is one participant inside an already-running system. If nobody logs in for a month, kingdoms still trade, people still work, caravans still move, and `WorldMemory.Advance` / server heartbeats still accumulate. “What happened while I was gone?” is `event_timeline_log` + Unity `LastEvent`, not an LLM story.

Concord sits **above** the sim (observe / reason / remember). It does not puppet every NPC. `AskTwoB` reads world state; an empty box returns `no_gateway`, never a fabricated voice.

That destination is **composition of owners already in the matrix**, not a second civilization engine. #954 stays the presentation floor.

| Spec claim | Already true | Gap (do not rebuild) |
|---|---|---|
| City is not waiting for you | Unity `NpcLife` jobs + `WorldClock.Tick`; server `npc-routines` | Jobs are clock-driven; not yet one causal dossier per actor |
| Interfere and the sim reacts | Flower-law, combat ack, stall `act=open`, `Hostile` | Unity stall is not a ledger transaction until KitBag = `player_inventory` |
| Quest → scripted event is the wrong shape | Lattice-born quests + Unity `plotsCsv` already spawn from drift/state | Drought→revolt is **not** one closed loop yet (row 18) |
| Edric as a persistent person | Server: routines, marriage, `npc-legacy` (inherit grudges/recipes/wealth), inventory, skills, pain, death | **Not one row.** Unity has job + appearance. House/debt/axe-instance still pieces |
| If Edric dies, the world remembers | `onNpcDeath` → heirs, legacy, corpse | Unity `MarkDead` CSV must hit that path |
| Equip changes more than an icon | Server affixes/durability/sets; Unity `CharacterGear` hand socket | Unity mesh must follow `CanEquip`; no `origin_world` on the row yet |
| Gate is infrastructure | `CrossRing.Walk` carries kit; tariff 0.05; caravan `loading/traveling/at_gate` | Server `kingdom:request` caravans stay **honestly empty** until persist-sync |
| Economy is a machine | `npc-economy` + `world-economy` + Ring cargo | “Why is grain expensive?” = 2B over that state after P0, not invented prose |
| Nine worlds are societies | `Canon` + `DressVocab` + refusal laws | Unique **verbs** still thinner than unique **copy** |
| Assets are the skin | `DressVocab` / `FreePacks` / Store packs | Dresser maps semantic kit → stems. Not “pop 4200 → generate a city” yet |
| Simulate globally, render locally | Unity `SimLod` Real `<28m` / Bulk `<70m` / Virtual; server shards | Browser WebGPU reuses this contract; it does not change `npc_id` |

**Policy lock (do not “fix” by crossing it):** diseases **never cross worlds** (`disease-engine` is per-`world_id`; contagion uses the patient’s current world). A Gate that moves goods and people does **not** move plague unless governance explicitly reverses that invariant. Creatures, kit, and travelers may cross; infection does not.

**Causal drought chain** — target composition, not new modules:

`seasons` / ecology → crop-season yield → `npc-economy` stock → `world-economy` price → `CrossRing` caravan → `Hostile` / combat → shortage (stock) → `faction-strategy` / reputation → decree / war.

Each arrow already has an owner. Wiring them into **one** observable chain is P0+ (persist-sync first). Do not author a drought quest.

---

## Three surfaces, one canon

| Surface | Role | Authority |
|---|---|---|
| **Server kernel** | Persistent MMO: inventory, combat anti-cheat, NPC economy, seasons, factions, quests, corpses, shards | SQLite + heartbeats + sockets |
| **Web world lens** | Three.js / Godot presentation of the server | Server |
| **Unity kitchen** | Local living-world kernel (`WorldClock`, `WorldMemory`, `NpcLife`, `CrossRing`) + thin `/unity-ws` bridge | Local JSON `concordia-living-v1.json` until persist-sync; combat/dialogue **when connected** |

They share `content/world/` + `Canon`. They do **not** yet share live stock, caravans, KitBag, or Unity vitals. Wiring that seam is P0. Replacing either kernel is out of scope.

Status key:

| Mark | Meaning |
|---|---|
| G | Production on that surface — real data model, real loop, real persist or honest empty |
| Y | Partial — real but thin, local-only, or presentation without the matching persist |
| R | Missing on that surface |
| B | Exists elsewhere in Concord (platform DTU / marketplace / royalty) and must be **wired**, not rebuilt |

---

## Stack

```
Universe → World → Kingdom → Region → Settlement → Location → Actor → Character
  → Stats → Skills → Inventory → Equipment → Actions → Simulation → Persistence → Presentation
```

That is the same stack `KingdomBook` already audits, plus the character/item/action layers the server already runs for the web client.

---

## Matrix

Columns: **S**erver · **U**nity kitchen · **W**eb lens. Owner is the authoritative code, not the UI.

| # | System | S | U | W | Data model / owner | Runtime | Persist | Events | Honest gap |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Entity identity | G | Y | G | Server TEXT PKs (`world_npcs.id`, `player_inventory.id`, `dtus.id`). Unity authored `Person.id` / `GuestDef.id`; combat dummy ack still uses **name** | Server IDs forever; Unity crowd walkers are session names | Server yes · Unity authored yes, dummies no | Kernel combat uses `targetId` | Immutable IDs on **runtime** Unity actors; stop index-14 NPCs |
| 1 | Tags / semantics | B | R | Y | DTU `tags[]`; NPC `archetype` + `faction_id` in `content/world/*/npcs.json`. No `npc_tags` / item-tag ontology | Query by faction/archetype, not tag algebra | Authored JSON | — | Tag layer on actors/items/locations **or** keep using faction+archetype and stop pretending we have a tag bus |
| 2 | Character identity | G | Y | G | Authored NPCs: name, faction, archetype, appearance, schedule. Server: `npc-asymmetry`, `npc-routines`. Unity: `AppearanceStore` (hero), `NpcLife` job from spawn | Hero appearance is real; NPC jobs are clock-driven, not full authored dossier | Hero local file · NPC authored · Unity job session | `QuestLog.NoteTalk` | Full “Edric: house, wife, axe instance, debt” is **not** one row yet — pieces exist (legacy, inventory, marriage) on the **server** |
| 3 | Stats pipeline | G | Y | G | Server `character-level`, `pain.js`, resource bars. Unity `hp/stamina/poise` floats | Web: modifier-ish via gear affixes + pain. Unity: local bars; kernel ack overwrites damage when connected | Server yes · Unity no | `combat:attack:ack` | Unity vitals → kernel; equipment as **effects** already exists server-side (`item-affixes`, `gear-durability`) |
| 4 | Skills / mastery | G | Y | G | `skill-engine`, `skill-mastery` (novice→grandmaster), `skill-evolution`. Unity `SkillLedger` local tries/hits | Use / combat / craft on server | Server yes · Unity no | `skill:evolved` (web) | Do not invent a second tree. Sync Unity `SkillLedger` or delete it in favor of the server |
| 5 | Inventory | G | Y | G | `player_inventory` (row `id` + `item_id` + qty + quality). Unity `KitBag` static list | Stacks, not a full provenance graph | Server yes · Unity no | gather macros | `KitBag` must become a view of `player_inventory`, not a parallel bag |
| 6 | Equipment | G | Y | G | Server durability/enchant/affix/sets. Unity `CharacterGear.Attach` mesh + hand socket | Equip mutates server gear; Unity swaps a stem | Server yes · Unity visual | — | Unity equip → server `CanEquip` + stance/anim profile. Right-hand socket is real in Unity; IK/masks still thin |
| 7 | Combat | G | Y | G | Server impact/poise/frames/anti-cheat. Unity slash + Flower-law + `Hostile` | Hub Flower-law: **cut is visible**, damage refused outside Arena | Web yes · Unity local unless gateway | `combat:impact`, `combat:attack:ack` | Combos / block / weapon families are the residual (`combat-feel-residuals-capability-map.md`) |
| 8 | Creatures / ecology | G | Y | G | Server `fauna-spawner`, `disease-engine`. Unity `FaunaLife` wander/graze/flee/hunt | Wolf→deer→price is **not** one closed loop yet; hunt + ecology float exist | Server fauna/disease · Unity `deadCsv` | entity death (web) | Close ecology → scarcity → `world-economy` (already a price engine) instead of a new sim |
| 9 | World contract | G | G | G | `Canon`, `WorldBook`, `content/world/`, kingdom snapshot | Law / refusal / weather / fauna / steelLive per world | Authored | travel | Unique **verbs** per world still thinner than unique **copy** |
| 10 | Universe / Ring | G | G | Y | Unity `CrossRing` (plots, travelers, tariff 0.05, caravans CSV). Server Concord Link + snapshot | Gate walk carries kit; AwayTick advances slices | Unity JSON · server anchors | `CrossRing.Walk` | Persist-sync caravans/tariffs into `kingdom:request` (today honestly empty) |
| 11 | Kingdom / faction | G | Y | G | Server `faction-strategy`, realms, reputation cache. Unity `KingdomBook` staple/stock/need + `FactionHeat` | Strategy heartbeat is server | Server yes · Unity slice | `faction:strategy-move` (web) | Unity heat is a float; server strategy is the owner |
| 12 | Settlement | G | G | G | `CityAtlas`, `CityTown`, `RealmFill`, `land-claims`, `world_buildings` | Dresser from authored cities + DressVocab kit | Server buildings/claims · Unity geometry local | — | Building **function** (shop/forge) is Unity `BuildingPlace` + server land-claims — not one occupancy table |
| 13 | Economy | G | Y | G | Server `npc-economy`, `world-economy`, auctions, royalty **platform**. Unity `Prices` / stock / need | Supply/demand is server; Unity pulse is a slice | Ledger yes · Unity slice | market / caravan (Unity CSV) | Royalty is Concord platform, **not** Concordia grain. Do not merge |
| 14 | Caravans | Y | G | R | Unity `RingCaravan` states loading/traveling/at_gate. Server snapshot `caravans: []` | Unity dispatches; server does not replay them | Unity `caravansCsv` | — | **The** persist-sync poster child |
| 15 | Trading | G | Y | G | Server NPC shop + marketplace macros. Unity stall `act=open` | In-world Unity buy/sell is not a transaction | Marketplace yes | — | Wire stall → `npc-marketplace` / `player-trade`. Keep AutoTrader out |
| 16 | Loot | G | Y | G | Server loot-generator, corpse, `npc_inventory`. Unity `Gatherable` → KitBag | Dead merchant’s **actual** bag is server `npc_inventory` | Server yes · Unity session | corpse drop | Unity loot must mint a `player_inventory` row |
| 17 | Quests | G | Y | G | Authored `content/quests/`, quest-engine, lattice-born. Unity `QuestLog` in-memory | World-reactive plots exist as Unity `plotsCsv` + server lattice | Server progress yes · Unity no | quest complete (web) | Persist Unity QuestLog or drive it from server |
| 18 | Ambient life | G | G | G | Server routines/conversations. Unity `NpcLife` jobs + AmbientWalkers | Schedules are real; “tiny stories” are event rolls + jobs, not a storylet engine | Server routines · Unity session | `npc:conversation-bid` | Enough to pass a 60-minute “do nothing” **observation**; not yet causal drought→revolt |
| 19 | Audio identity | Y | Y | G | Web `SoundscapeEngine`. Unity `Footsteps` | Per-world Unity bus is thin (audit residual) | — | sonic pulse (web) | One ambience bus per `WorldId` in Unity, sourced from Canon weather + settlement |
| 20 | Weather / seasons | G | Y | G | Server `seasons`, embodied signals. Unity `WorldClock.Weather` + VFX | Weather→caravan delay is **not** wired | Server yes · Unity string | `world:season-transition` | Subscribe caravans/crops to season (server already has crop-season gates) |
| 21 | Traversal | G | Y | G | Server climb/swim/dive/mounts. Unity walk/sprint/jump/dodge | Per-world extra verb is mostly **web** | Server yes | — | Unity: one extra verb per gated world, not a parkour engine |
| 22 | Sim LOD | Y | G | Y | Unity `SimLod` Real <28m / Bulk <70m / Virtual. Server `interest-management.js` + `city-presence` chunks + world shards | Same actor, cheaper brain — Unity does this | Runtime | — | Browser WebGPU reuses this contract (see §Streaming). Do not invent a parallel LOD enum |
| 23 | Memory / history | G | Y | G | Server dreams, grudges, event_timeline. Unity `LastEvent` + deadCsv | “Why does this guard hate me?” is **server grudges/hooks**, not Unity | Server yes | — | Surface memory in Unity talk / 2B context |
| 24 | Relationships | G | Y | G | Nemesis, opinions, hooks, courtship, marriage | Graph is server | Server yes · Unity rumor lines | spouse-react | Don’t build a second graph |
| 25 | Politics | G | Y | G | Faction strategy, decrees, war campaigns | Unity rolls `scheme`/`treaty` strings | Server yes | strategy-move | Unity should **display** server moves, not re-roll them |
| 26 | Crafting | G | R | G | `craft-resolve`, `tool-tree`, `glyph-spells`, `craft-chains`, `RESOURCE_CATALOG` | One math kernel, several call sites | Server yes | — | Unity has CookStation only. 9-world taxonomy = **catalog rows + world filters**, not a new engine (see §Crafting) |
| 27 | Building change | G | R | G | `applyStructuralStress`, housing | Unity shells are static | Server HP | `world:building-state` | Entered interiors (#954) ≠ destructible occupancy |
| 28 | Death / corpses | G | Y | G | `player-corpse`, `npc-legacy` | Unity `MarkDead` CSV | Server yes | death | Unity death must hit server corpse/legacy |
| 29 | Chronicle | G | Y | G | `event_timeline_log` | Unity last-event string | Server yes | — | “What happened while I was gone?” → `WorldMemory.Advance` + server timeline, not an LLM story |
| 30 | Visual dresser | — | G | Y | `DressVocab`, `FreePacks`, `HubPlaza`, Store packs | Semantic kit per `WorldId` | Bundled assets | — | Registry is **stems + culture kit**, not a GUID database. Grow the vocab; don’t invent a second asset CMS |
| 31 | Persistence | G | Y | G | Server migrations. Unity `concordia-living-v1.json` | Away-hours advance is real in Unity | Split | Leave/Enter | Persist-sync is P0 |
| 32 | Event bus | G | Y | G | Server sockets. Unity `ConcordClient.OnEvent` + clock rolls | Web `EmergentEventFeed` is the wide bus | — | many | Subscribe Unity to the same names the web already consumes |
| 33 | Observability | G | Y | G | Ops telemetry lens, NPCTraitInspector | Unity HUD clock / nearby act / kit | — | — | NPC inspector: goal, job, carry, memory — **web has the dossier**; Unity HUD does not |
| 34 | Concord / 2B | Y | Y | G | `concordia-two-b.js`, `unity-bridge.js`, `ConcordClient.AskTwoB` | Observe ≠ puppet. Empty reply is `no_gateway`, never a fake voice | When connected | `dialogue:request` | 2B reasons over **world state**, not a second NPC brain |
| 35 | UI | G | Y | G | Web character sheet / inventory / quests. Unity #954: I-kit, typed talk, enter prompt | Unity kit is usable; not a paper-doll compare | — | — | Character/equipment screens on Unity come **after** KitBag is a server view |
| 36 | Living-world acceptance | Y | Y | Y | `WorldClock.Tick`, `AwayTick`, NPC jobs, caravans, prices | 60 minutes of jobs/weather/shops is **observable in Unity now**. Causal drought→revolt is not | Partial | LastEvent | Codify as a test that **measures** Advance() deltas, don’t wait for a theme-park script |

---

## Crafting taxonomy (queued, not a second catalog)

The stack `resource → material → component → recipe → item → variant → unique` is the right **shape**. There is already a craft kernel. Do **not** stand up `ItemGenerator` as a parallel engine. Do **not** author a 20-school spell list beside glyph algebra. Do **not** hand-author fifty thousand finished swords.

Authored content is the **vocabulary**. `craft-resolve` + affixes + world filters + the Ring are the **combinations**. Persistent `player_inventory` is the **history**. The player is the **interference**.

| Spec layer | Status | Owner — extend this, don’t fork |
|---|---|---|
| 1. Resource families + properties | G / Y | `RESOURCE_CATALOG` already has organic/stone/metal/mineral/creature/botanical/arcane/energy-ish fuel (`wood`…`dragonbone`, `iron_ore`→`steel_ingot`, `hide`→`leather`, `mana_crystal`, `aether_dust`, soul gems). Live fields: potency, affinity, stability, volume, weight, rarity_tier, source_type, magical_sub. Hardness / conductivity / toxicity / biome / compatible_recipes are **columns to add**, not a new resource object. |
| 2. Materials (ore → ingot → steel) | G | Same catalog + `craft-chains.js` (gather/process/cure/assemble/finish, season gates). `iron_ore` → `iron_ingot` → `steel_ingot` is already the smelt chain in data. |
| 3. Components (blade, pommel, plate, focus) | R | No component table yet. Add a data table `craft-resolve` consumes. One component in many recipes. Not a second resolver. |
| 4–5. Weapon / firearm families | Y | Archetypes live in `DressVocab.Weapon` + KitBag stems + affix slots. A gun existing in Cyber does **not** let Tunya manufacture it — that is a **world filter + knowledge**, not a shared tech tree. Do not paste a 40-gun list. |
| 6. Spell construction | G | `glyph-spells.js` `composeSpell` folds `glyphAdd` (fire/water/ice/lightning/bio/energy/psychic/refusal). Fire+projectile vs fire+area is **glyph chain + params**, not a named spell spreadsheet. Extra “schools” are labels over glyphs. |
| 7. Identity-bound uniques | Y | DTU recipes + UGC + faction recognition residuals. Not yet “this instance commands royal guards.” Stealing a unique must hit ownership + rumor (`npc-legacy` / timeline), not a special-case quest. |
| 8. Unique generation | G / Y | `craft-resolve` (inputs + skill + station + affinity conflict → quality/backfire) + `item-affixes` rarity rolls. Two swords already differ by mats/skill/station. Emergent names are presentation over that roll, not a name database. |
| 9. Recipes as knowledge | Y | Chain JSON: inputs, station implicit, duration, season_gate, output. Skill weight is in `craft-resolve`. Unlock-button recipes are the wrong shape — keep chains as data. |
| 10. Discovery / tech spread | Y | `npc-skill-author` already biases the next NPC revision from witnessed demonstrations (lineage). Alloy-experiment → civilization-learns-it is **not** built; extend demonstration/knowledge, don’t add a research tree UI. |
| 11. Per-world ecology | R | Catalog is global today. Filters (extract / refine / forbid) are P0 #6, keyed by **existing** Canon worlds + staples — not a new World-1…World-5 set. |
| 12. Cross-world craft | Y | `CrossRing` already moves kit and cargo. Missing: `origin_world` (and optional `origin_settlement`) on the inventory row so a blade forged in one world and gripped in another is one object. |
| 13. Starting scale | — | Targets (hundreds of primitives, thousands of variants) are **catalog growth + combinatorics**, not a content sprint to 100k finished items. |
| 14. Player creator | Y | Evaluate through `craft-resolve` + station + skill + knowledge + scarcity. Unity CookStation is the only kitchen craft surface. Do not confuse this with Forge (polyglot app generator). |
| 15. Permanent item identity | Y | `player_inventory.id` is a row id. Provenance (`archetype_id`, `material_ids`, `recipe_id`, `creator_id`, `origin_world`, history) is the next columns. Ownership already moves; history does not yet. |
| Mounts / vehicles | G | `mount-gear.js`, `world-vehicles.js` — gear/vehicles are this same inventory, not a side catalog. |
| World scale | — | Oblivion/Fallout **extent** per gated world is `SimLod` + `DressVocab` + `RealmFill` towns/holds, not a second map generator. |

**World filters (intent, from Canon staples — not invented profiles):**

| World | Staple | Extract / tradition | Cannot make without import |
|---|---|---|---|
| Hub | lanterns | Court; Flower-law, not a factory | Live steel (except Arena) |
| Tunya | harvest | Wood, fiber, hide, herb, food | Advanced metals, crystals |
| Fantasy | ward | Glyph/magic mats, medieval archetypes | Industrial firearms |
| Cyber | census | Tech affinity, refined metals, energy | Grove/harvest abundance |
| Crime | invoices | Urban refined, creature/black-market | Open-grove extract |
| Ruins | remnants | `ancient_tech_core`, remnant salvage | Living harvest |
| Frontier | road | Movement; no embassy seat | A domestic industrial base |
| Superhero | mercy | Energy / “dawn” kits | Harvest-as-Tunya |
| Crucible | drift | Chaos/`element_shard` | Closed, restful production |
| Sere | marks | Economic/Mark layer — **not a ninth Gate** | — |

A Tunya bow and a Cyber tool can both be “weapons” and still be different objects because the **filter + mats + knowledge** differ. That is the 9-world craft spec. The Ring (ore here, smith there, crystal there, bone there) is `CrossRing` + `origin_world`, not a new trade sim.

---

## Simulate globally, render locally (queued)

**Simulation scale must never equal rendering scale.** The server may hold nine worlds, kingdoms, settlements, and millions of abstract actors. A client renders one player, one local region, ~50–200 relevant actors, and the immediate environment. That is already the architecture — Unity `SimLod`, server shards, spatial chunks, combat anti-cheat. A WebGPU browser client reuses this contract. It does not change `npc_id`.

Do **not** stand up a parallel LOD enum, a `PerformanceManager` server, or a second interest bus. Extend the owners below.

### Stream the player's reality, not the kingdom

The server can know an entire kingdom (people, settlements, livestock, buildings, caravans, armies). The browser never receives that list.

| Slice | What the client may get | What it must not get |
|---|---|---|
| Immediate bubble | 50–150 visible actors, nearby buildings/props/wildlife, active quests, nearby market, relevant sounds, weather | The other 83,850 people in the capital |
| Nearby region | Simplified actors, simplified traffic, distant shells, statistical activity | Full skeletal + combat AI |
| Far world | Essentially nothing visual | GPU involvement of any kind |

Locked rule: **the browser never receives the kingdom.** Interest management is stream the player's reality. Network AoI is already `server/lib/movement/interest-management.js` (speed-scaled radius, predictive chunk preload, departing-vector) wired into `city-presence.js` (100 m spatial chunks, `MAX_VISIBLE_AVATARS` per chunk). Unity visual LOD is a **tighter** bubble than that network radius — that split is correct.

### Three simulation / rendering levels — existing `SimLod`, not a new enum

Industry analog (Warhorse / KCD II AI-LOD at thousands of NPCs) maps onto names we already have. Do **not** invent a parallel LOD enum.

| Spec name | Concordia name | Distance (Unity `LodAt`) | What actually runs |
|---|---|---|---|
| LOD 0 — Full | `SimLod.Real` | `<28 m` | Skeletal body, animation, IK, combat, physics, particles, detailed AI, audio, interaction |
| LOD 1 — Regional | `SimLod.Bulk` | `<70 m` | Cheap gait / snap-to-destination, impostors, simplified meshes, aggregated crowds, simplified AI |
| LOD 2 — World | `SimLod.Virtual` | beyond | No rendering. `population +=`, `production +=`, `consumption -=`, `caravan_position =`, political_state, weather_state. `WorldClock` + `WorldMemory.Advance` + server heartbeats. **No GPU.** |

Server shards (`server/lib/world-shard-protocol.js` `PER_WORLD_WRITE_TABLES`) are the statistical / per-world-write home of Virtual, not a new service. Same actor, cheaper brain — Unity already does this on #954.

### WebGPU instancing is client work

Do not draw Tree × N as N objects. GPU-instance one mesh (position, rotation, scale, variation). Same for grass, rocks, barrels, houses, racked weapons, repeated NPC archetypes, foliage, particles.

Owner: **client renderer** (browser WebGPU / Unity / Godot). Stems come from `DressVocab` / `FreePacks`, not a new server mesh catalog. Instancing does not change simulation.

### Browser-aware assets = dresser, not the Unity library dump

```
semantic object → visual archetype → client-compatible asset → LOD selection → GPU representation
```

Example: settlement = wealthy medieval capital → World Dresser (`DressVocab` kit: stone houses, stalls, banners, warehouses, gardens, guards, carts) → distance system → `SimLod.Real` / `Bulk` / `Virtual`.

The **server does not care** which `.glb` is a wealthy house. The client does. Grow the vocab (row 30). Do not invent a second asset CMS. Do not ship “the entire Unity asset library” to the browser.

### Stream assets asynchronously (client / CDN)

Login → player spawn → terrain → nearest buildings → player/NPC meshes → nearby props → audio → distant scenery. Compressed meshes, GPU-friendly textures, manifests, chunk streaming, cache of visited places. The player moves while the rest arrives.

This is **client** work on top of `city-presence` chunk preload. It is not a #954 kitchen task and not a new simulation.

### Server stays authoritative

The browser must not decide “I killed that guy.”

```
PLAYER_ATTACK  target=NPC_1842  weapon=ITEM_9381  timestamp=…
        ↓
server: validate → combat calculation → apply damage → NPC state → broadcast
        ↓
browser: sword animation, hit effect, health bar
```

Owners already: `_validateCombatReach` and `_validateDamageCap` in `server/routes/worlds.js` (HTTP NPC path); socket `combat:attack` → `cityPresence.applyAttack` → `combat:attack:ack` + `combat:impact`. Client plays feel from the ack. Godot uses the same ack. Unity slash is local until the gateway; Hub Flower-law still refuses damage outside the Arena. Never reintroduce a trust-the-client-damage path.

### Do not send state every frame

60 FPS × thousands of entities would murder the pipe. Server tick → state changes → interest filter → **only relevant deltas** → client interpolates locally.

Web already lerps: `concord-frontend/lib/world-lens/creature-renderer.ts` (`pos.lerp(entry.target, …)` toward the server position; the boid flock moves them server-side). Departing-vector in `interest-management.js` is the off-screen half of the same idea. Do not add a second 60 Hz entity dump.

### Interest management is already a subsystem — two radii, one filter

```
PLAYER
  ├─ INTERACTION radius  → detailed (combat, talk, enter, stalls)
  └─ VISUAL radius       → simplified (Bulk / impostor)
            ↓
      STREAM FILTER (network AoI)
```

| Situation | Priority |
|---|---|
| Fighting someone | Extreme — Real LOD + combat events |
| Merchant ~30 m | High — nearby bubble |
| Farmer ~400 m | Low — Bulk or statistical |
| Kingdom three worlds away | Zero visual. Virtual sim only. Diseases still never cross worlds. |

Owners: `interest-management.js` (network AoI, default base 500 m when speed-AoI is on) + Unity `LodAt` 28 / 70 (presentation) + combat reach cap (interaction). Interaction radius ≠ visual radius ≠ network AoI — keep them distinct. Do not collapse them into one magic number.

### Physics gets the same LOD

Do not run physics for 10,000 NPCs.

| Distance | Physics |
|---|---|
| Near player | Full collision — web `physics-world.ts` (Rapier kinematic capsules); Unity character controller |
| Nearby | Simplified collision |
| Far | None. The server knows `cart A`, `road B`, `speed 12`, `destination C`. No wheel collider while nobody is looking. |

Far carts are `CrossRing` / `world-vehicles` state, not Rapier.

### Audio is a field, not 10,000 emitters

Player position → audio field (forest / market / forge / birds / wind / distant combat / nearby talk) → priority mixer. Only nearby sounds become real sources.

Owners: web `SoundscapeEngine` (already ducks on `world:sonic-pulse`); Unity `Footsteps`. Per-world Unity bus is still thin (row 19). One ambience bus per `WorldId` from Canon weather + settlement — not a second Wwise project.

### GPU budget and quality tiers change presentation only

A client-side budget (GPU / CPU / memory / textures / draw-calls / visible actors / particles / shadows) may drop foliage, shadows, NPC animation, view distance as FPS falls. Named quality tiers (cinematic / high / balanced / performance / potato) are the same knob with a preset.

**Quality tiers change presentation only.** The world simulation does not change. A laptop and a desktop are in the same universe. `SimLod` is distance + interest; quality is how expensive that bubble is allowed to look. Do not put a `PerformanceManager` on the server. Do not let a quality slider skip combat validation or shrink the kingdom snapshot.

### Three clients, one authority

```
CONCORDIA AUTHORITY
        World Snapshot
   ┌────────┼────────┐
Browser   Godot     Unity
WebGPU    native    native
```

Same: player, world, inventory, equipment, NPC, quest, economy, physics **authority**, history.

Different: renderer, asset representation, performance budget, platform input, presentation fidelity.

An iPhone and a desktop are not two games. They enter the same world through different clients. P0 persist-sync is what makes that sentence true for Unity; the web lens already lives on the snapshot.

---

## What “the player is not the source of activity” already means

When you stand still in Unity, `WorldClock.Tick` still advances hour, weather, prices, ecology, and authored events. `Enter` calls `WorldMemory.Advance` for hours away. `NpcLife` keeps jobs. `FaunaLife` hunts. `CrossRing` can dispatch a caravan.

That is **already** a running kernel. It is **not** yet one causal machine with the server ledger. The gap is agreement, not absence. Morning shops / night taverns / weather / war are `WorldClock` hour + `NpcLife` jobs + server routines + `faction-strategy` — city **behavior**, not a second ambient director.

---

## P0 — wire, don’t rebuild

Order is dependency, not a greenfield roadmap.

1. **Persist-sync** — Unity `WorldMemory` stock/need/caravans/tariffs/deadCsv ↔ server (fills the honest-empty `kingdom:request` arrays).
2. **Identity** — Unity runtime actors carry the authored/server id; combat `targetId` is that id.
3. **KitBag = player_inventory** — gather/loot/equip are kernel writes; Unity mesh follows.
4. **Events** — Unity subscribes to the names the web `EmergentEventFeed` already consumes.
5. **2B context** — pass kingdom slice + nearby acts + grudges; keep `no_gateway` honest.
6. **World filter on `RESOURCE_CATALOG`** — each gated world lists what it can extract/refine; imports are Ring cargo.

P1–P7 in the punch list (character paper-doll, living settlement dresser, ecology→price, AI LOD at thousands, WebGPU bubble) **attach to this seam**. They are invalid as a parallel engine.

---

## Ruleset, not a content explosion

This is a **simulation platform with a game on top**. The systems multiply; they do not stack as a backlog of finished objects.

```
9 worlds → resources → materials → equipment → characters → factions
        → settlements → produce/consume → caravans → gates → history
        → NPC memory → Concord reasons → the player walks in
```

| Arrow | Owner already | Honest residual |
|---|---|---|
| 9 worlds | `Canon` + `content/world/` | Sere is not a ninth Gate |
| resources → materials | `RESOURCE_CATALOG` + `craft-chains` | World **filters** still R |
| materials → equipment | `craft-resolve` + affixes | Component table still R |
| equipment → characters | `player_inventory` + affixes + pain | Unity KitBag not that row |
| characters → factions | authored `faction_id` + reputation | Unity heat is a float |
| factions → settlements | `land-claims`, `world_buildings`, `CityAtlas` | Occupancy not one table |
| produce / consume | `npc-economy`, crop-season | Unity stock is a slice |
| caravans → gates | Unity `CrossRing` | Server caravans honestly empty |
| history | `event_timeline_log`, `npc-legacy` | Unity LastEvent is a string |
| NPCs remember | grudges, hooks, spouse-react | Not Unity talk context yet |
| Concord reasons | `AskTwoB` over world state | `no_gateway` when disconnected |

**Vocabulary / combinations / history / interference** — that is the growth rule:

- Author hundreds of primitives (resources, archetypes, modifiers, world constraints), not 50,000 swords.
- Author species / culture / profession / trait / skill / need / faction **templates**, not 100,000 NPCs. Population already comes from authored `content/world/*/npcs.json` plus `persistGeneratedNpc` (`npc-generator.js`). Grow the generator’s vocabulary; don’t type a census.
- Worlds grow the same way: Canon + dresser kit + filters, not nine hand-built Oblivion maps.

**“That’s a world” provenance** — one inventory row should be able to carry: mined here → caravan across a Gate → forged by this NPC → enchanted from a discovered technique → looted from a corpse → sold → inherited. Pieces exist (gather, `CrossRing`, `craft-resolve`, affixes, corpse loot, marketplace, `npc-legacy`). **It is not one object yet.** That chain becomes real when `origin_world` + persist-sync + `creator_id` land. Concord explaining *why* is 2B over that row, not an LLM memoir.

Do not claim that story in a HUD until the row can prove it.

---

## 60-minute acceptance (when we claim living world)

Measurable, not cinematic:

1. Idle in a capital 60 real minutes → job changes, shops open/close, weather string changes, at least one `LastEvent`, prices not identical to t=0 (`WorldClock`).
2. Logout / `Leave` / `Enter` after Advance(away) → slice **causally** different (hour, ecology, stock), not rerolled names.
3. Walk a gate with a kit stem → destination `CrossRing.LivingLines` / travelersCsv knows a weapon crossed.
4. (After P0) Server snapshot lists the same caravan id Unity dispatched.
5. (After `origin_world`) 2B can name the mine world and the forge NPC for a kit stem **from the row**, or return `no_gateway` / `no_provenance` honestly.

#954 already lets you walk, cut, open kit, type to an NPC, and enter a building. That is the presentation floor. This matrix is what the floor stands on.
