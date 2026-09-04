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
| 22 | Sim LOD | Y | G | Y | Unity `SimLod` Real <28m / Bulk <70m / Virtual. Server world shards + draw budgets | Same actor, cheaper brain — Unity does this | Runtime | — | Browser WebGPU client must reuse this contract (see §Streaming) |
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

The “resource → material → component → recipe → item → unique” stack is the right **shape**. The code already has the left half:

| Layer | Exists | Owner |
|---|---|---|
| Resource properties | G | `server/lib/resources.js` `RESOURCE_CATALOG` (potency, affinity, stability, volume, weight, rarity, source, magical_sub) |
| Market ids | G | `server/lib/world-economy.js` `BASE_PRICES` (alias table in `resources.js` reconciles hyphen vs snake) |
| Resolve | G | `server/lib/craft-resolve.js` |
| Affixes / sets / durability | G | `item-affixes.js`, `item-sets.js`, `gear-durability.js` |
| Glyph / spell composition | G | `glyph-spells.js` (base-6 algebra — this **is** the systemic magic, not a flat spell list) |
| Unity items | Y | `KitBag` stems + `DressVocab.Weapon` |
| Per-world ecology filters | R | Catalog is global; worlds do not yet **forbid** producing steel without imports |
| Unique instance history | Y | `player_inventory.id` is a row id; there is no provenance/history log on that row |
| Named uniques | Y | DTU recipes + UGC; not “King’s Blade recognized by royal guards” as a first-class object |

**Do not** author 150–300 resources from scratch. Add **world filters** and missing families onto `RESOURCE_CATALOG`. Components (blade/pommel/…) are a data table that `craft-resolve` can consume — they are not a reason to fork the resolver.

Cross-world crafted objects become real when `player_inventory` (or a future instance table) carries `origin_world` and the Ring already carries kit on `CrossRing.Walk`. That field is the next row, not a new item generator.

---

## Simulate globally, render locally (queued)

Already the architecture:

| Tier | What runs | Who |
|---|---|---|
| Full | Skeletal body, combat, talk, enter | Unity `SimLod.Real` (<28 m); web nearby actors |
| Regional | Cheap gait / snap-to-destination | Unity `Bulk` (<70 m); server shard for per-world tables |
| World | Hour, ecology, prices, stock, AwayTick | `WorldClock` + `WorldMemory.Advance`; server heartbeats with **no GPU** |

Locked rule: **the browser never receives the kingdom.** Interest management is “stream the player’s reality.” WebGPU / instancing / quality tiers are **client** work on top of this contract. They do not change `npc_id`.

Server shards already split per-world writes (`server/lib/world-shard-protocol.js`). That is the LOD-4 statistical layer’s home, not a new service.

---

## What “the player is not the source of activity” already means

When you stand still in Unity, `WorldClock.Tick` still advances hour, weather, prices, ecology, and authored events. `Enter` calls `WorldMemory.Advance` for hours away. `NpcLife` keeps jobs. `FaunaLife` hunts. `CrossRing` can dispatch a caravan.

That is **already** a running kernel. It is **not** yet one causal machine with the server ledger. The gap is agreement, not absence.

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

## 60-minute acceptance (when we claim living world)

Measurable, not cinematic:

1. Idle in a capital 60 real minutes → job changes, shops open/close, weather string changes, at least one `LastEvent`, prices not identical to t=0 (`WorldClock`).
2. Logout / `Leave` / `Enter` after Advance(away) → slice **causally** different (hour, ecology, stock), not rerolled names.
3. Walk a gate with a kit stem → destination `CrossRing.LivingLines` / travelersCsv knows a weapon crossed.
4. (After P0) Server snapshot lists the same caravan id Unity dispatched.

#954 already lets you walk, cut, open kit, type to an NPC, and enter a building. That is the presentation floor. This matrix is what the floor stands on.
