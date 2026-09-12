# Concordia: Persistent Megaworld

**Status:** locked architecture (owner, 2026-09-12). Spine of the laws is pinned by `server/tests/concordia-megaworld.test.js`.
**Not a map generator.** The goal is: generate a giant world, let people inhabit it, and make every inhabited place become part of the world’s permanent history.

This doc is the live Concordia arc. It does **not** replace `docs/LIVING_SOCIETY_PLAN.md` (labor → pay → grievance → chronicle) or `docs/CONCORDIA_UNITY_BUILD_PLAN.md` (AAA client + A/B/C). It unifies them under one topology: **one continuous physical universe**, with the existing engines as regions, settlements, memories, and a consequence→presentation pipeline.

Do not rebuild `settlements`, `world_chronicle`, `world_consequences`, `npc_memories`, `world_buildings`, `procgen-settlements`, or faction strategy. Compose them.

---

## 0. The product

Wherever the player walks, something can happen — and if people stay, the place acquires a past.

Unity **reveals** kernel state. It does not invent towns, mourners, species, or founding myths. Empty stays empty. Abandoned stays in the row.

---

## 1. Architectural laws

1. **One megaworld.** The named “worlds” (Hub, Ruins, Tunya, Fantasy, …) are **regions / civilizations** inside one universe, not disconnected game maps.
2. **The Concord Link is infrastructure.** Physical travel is the default. Ordinary regions do not teleport. Core-civilization Link gates are the only fast travel. Crossing a gate is entering another civilization, not loading an unrelated game.
3. **Flower Law is Hub-only.** Outside the Unburned Court: free will, local law, local culture, local politics. Live steel is allowed. Pinned: `flowerLawGoverns` in `server/lib/concordia-megaworld.js`.
4. **Geography is persistent.** A `world_seed` produces terrain/water/roads/sites once. Regenerating the same town differently on each visit is a bug.
5. **A settlement is a historical object**, not `spawnTown(x,y)`. Founding writes a row. Abandonment sets `status`, never `DELETE`.
6. **Places remember.** NPC memory (`npc_memories`) is necessary and not sufficient. The location itself keeps a chronicle.
7. **Every important act writes the consequence graph** already in `world_consequences` (`server/lib/world-consequence.js`, mig 416). Kill does not end at `hp = 0`.
8. **Inhabitation is simulated.** Land → water → food → roads → opportunity → migration → housing → families. Do not decide “here is a town, insert 30 NPCs” as the live path.
9. **Settlements grow, decline, split, or die — and remain.** Village → city, or village → abandoned. The original id stays queryable.
10. **Abandoned places stay physical.** Buildings, roads, graves, ownership history, stories. Wildlife or bandits may move in. A later faction may rebuild.
11. **Simulation must hit presentation.** Population/economy/war change what Unity shows. The renderer is not a second world.
12. **Kingdoms emerge from places.** Borders come from settlement ownership, force, geography, diplomacy, inheritance, conquest, migration, rebellion, resources, trade — not a menu that paints a map color.
13. **Dynasties attach people to places.** Who founded it, who ruled, who was murdered there, who saved it.
14. **The world is queryable.** “Why is this town here?” / “Why is this ruin abandoned?” traces real rows, or returns honest emptiness.
15. **LOD never erases history.** L0 vicinity full sim, L1 nearby detailed, L2 regional aggregate, L3 distant statistical. A distant village summarized as `population: 817` still has its chronicle when the player arrives.
16. **Cold-start and 100-hour tests are acceptance**, not slogans. They are named below. They are **not yet run** as live certification.

---

## 2. Honest substrate map (LIVE vs GAP)

Audited 2026-09-12 against source. If this table disagrees with the tree, the tree wins — fix this doc in the same commit.

| Law | Already real | Honest gap |
|---|---|---|
| 1 Topology | Inventory is **user-global** across worlds (CLAUDE.md). Concord Link messages/items exist (`routes/concord-link.js`). CrossRing walks cargo/rumor between Unity `WorldId`s. | Unity `ConcordiaGame.Travel` **rebuilds the region** (`_world.Build(next)`). That is a door-load, not overland. Continuous terrain between civilizations is not presented. |
| 2 Link vs walk | Gates + CrossRing. `WorldBook.Folder` maps Hub→`concordia-hub`, Frontier→`concord-link-frontier`, etc. | No overland path that keeps the same scene streaming. Fast travel is currently *all* travel. |
| 3 Flower Law | Hub `steelLive = false`; every other `Canon` world `steelLive = true`. Sere law text: Flower-law is the Court only. | Law lives in Unity Canon + HUD copy. Server `flowerLawGoverns` is the kernel pin. |
| 4 Persistent geography | `world_terrain_deformations` + `world_water_cells` (mig 281) are delta-over-seed. `procgen_regions` persist. | No single `world_seed` → continent → settlement-site pipeline that stamps identity. Two settlement systems: Living Society `settlements` (mig 287) vs `procgen_settlement_npcs` (region NPC packs). |
| 5 Settlement entity | `settlements` (`id, world_id, name, center_x/z, radius_m, faction_id, realm_id, created_at`) + vacancies + `world_npcs.settlement_id`. `createSettlement` in `lib/settlements.js`. | Row is a **cluster**, not a historical object. No status, former names, founders, food/water/security, destroyed_at. |
| 6 Place memory | `world_chronicle` (mig 286) + composers. `npc_memories` (mig 417). | Chronicle is **world-scoped**, not settlement-scoped. No mill-built / charter / plague-rebuild chain on a place id. |
| 7 Consequence graph | **Shipped.** `world_consequences` (mig 416) + `recordConsequence` / `recordLeaderDeath` + `consequence-apply.js` → schedules + memories + relation axes. | Not every kill/trade/founding writes it. `location` is a string, not a settlement FK. Unity does not show “this shop has been closed since…”. Plan A8 in `CONCORDIA_UNITY_BUILD_PLAN.md` that still says “missing unifier” is **stale**. |
| 8 Inhabitation | Civilian roster, labor→`world_buildings.construction_progress_pct`, crops, scarcity, employment edges, migration mig 168, `population-migration-cycle`. | `procgen-settlements.spawnSettlementForRegion` still drops 3–5 archetypes in a disc. That is the anti-pattern in law 8. |
| 9 Growth / death | Vacancies on NPC death. Movements / uprisings. Realm health symptoms. | No Village→Town→City ladder, no split/successor states as settlement rows, no ghost-town status. |
| 10 Abandon ≠ delete | `decaySettlementForRegion` **tombstones** `procgen_settlement_npcs.decayed_at` (does not DELETE). Buildings collapse via `applyStructuralStress` (standing→damaged→collapsed). | Living Society `settlements` had no abandon path. Spine now: `abandonSettlement` sets `status='abandoned'`. Buildings/roads of an abandoned town are not yet a Unity ruin pass. |
| 11 Presentation | Unity presents kernel tombs, gossip, banners, fauna genomes, LOD Real/Bulk/Virtual (`WorldClock.LodAt`). | Settlement growth does not add houses. Abandoned status does not swap meshes. Crowds/markets/graves are not derived from the settlement row. |
| 12 Kingdoms | Realms, vassalage, faction strategy, `concordia-kingdom-snapshot.js`. | Borders are not an emergent mesh of settlement ownership. |
| 13 Dynasties | Aging/dynasty mig 181, inheritance, Voss authored lore. | Dynasty↔place history is lore, not `founders_json` on the settlement. |
| 14 Query | Chronicle macros, realm health, consequence list. | No `whyPlace(settlementId)` until this spine. Must not invent a spring/road story when beats are empty. |
| 15 LOD | Unity `SimLod { Real, Bulk, Virtual }` at 28m / 70m. World shards + `PER_WORLD_WRITE_TABLES`. | No L2/L3 **historical** aggregate. Distant Virtual NPCs rewind to home; they do not keep a summarized village ledger. |
| 16 Tests | Heartbeats exist; world continues in `WorldMemory` slices (“The world continued while you were away”). | 7-day / 1-year / 50-year cold-start **not run**. 100-hour return test **not run**. Do not claim them. |

---

## 3. Hierarchy (persist at each level)

```
Megaworld (one universe, one seed)
  → continents / landmasses
    → regions (today’s WorldId / content folder)
      → kingdoms / republics / tribes
        → provinces
          → settlements          ← historical object
            → neighborhoods
              → buildings / interiors
                → inhabitants
```

Once generated, **identity is the row**. The generator may propose a site; after `foundSettlement` the coordinates and name are facts.

---

## 4. Settlement identity (target shape)

Mig 287 remains the cluster. Mig 446 adds identity columns. Do not create a second `towns` table.

```
Settlement {
  id, world_id, region_id,
  location (center_x, center_z, radius_m),
  founding_date (created_at / founded_at),
  status: active | abandoned | conquered | ghost,
  population,          -- counted, never invented
  culture, government, faction_id, realm_id,
  former_names_json, founders_json,
  abandoned_at, destroyed_at,
  buildings, households, …   -- existing world_buildings / world_npcs joins
  history                  -- settlement_chronicle
}
```

`destroyed_at` means collapsed / razed **presentation**, not missing from the database.

---

## 5. Place chronicle + consequence graph

Two stores, one story:

1. **`settlement_chronicle`** — beats that happened *here* (founded, mill, raid, charter, plague, annex, abandoned). Composers in `lib/chronicle/compose.js` may only use payload fields.
2. **`world_consequences`** — actor/action/target/location/time/witnesses/immediate/long-term. Already the cross-domain bus. New actions on the spine: `settle`, `abandon` (plus existing `kill`, `build`, `destroy`, `war`, `succession`, …).

Example (must be earned, not scripted):

```
player kills merchant
  → recordConsequence(action: "kill", location: settlementId, witnesses: […])
  → applyConsequence → npc_memories + schedule rewrite
  → settlement_chronicle beat only if the payload has the death
  → Unity shows a closed stall iff that beat exists
```

Years later, `whyPlace` can return “this stall has been closed since the killing of …” **only if those rows exist**.

---

## 6. Presentation pipeline

```
WORLD SIMULATION  →  WORLD STATE  →  CONSEQUENCE GRAPH
        →  PRESENTATION STATE  →  UNITY
```

`presentationForSettlement` reads identity + chronicle + live NPC count. It does not spawn a town because the function was called. Unity dresses **that** payload: buildings, damage, banners, graves, crowds, abandoned structures, construction, wildlife.

Current Unity `Travel` is a **region rebuild**. The destination is streaming continuous geography with Link gates as the only teleport. Until then, every `Travel` call is labeled `currentTravelMode = region_rebuild` so we cannot accidentally claim overland.

---

## 7. LOD

| Level | Meaning | Today |
|---|---|---|
| L0 | Player vicinity, full bodies | Unity `SimLod.Real` (< 28m) |
| L1 | Nearby settlement, detailed | `Bulk` (< 70m) — motion throttled, not a town ledger |
| L2 | Regional aggregate | **Missing** (shard ticks the full world, not a summary row) |
| L3 | Distant statistical | **Missing** |

Aggregation must store `population / food / wealth / stability / war_risk` **and** keep chronicle ids. Expanding L3 back to L0 reconstitutes from rows, it does not reroll the town.

---

## 8. Execution order (unify, don’t greenfield)

| Wave | Exit | Status |
|---|---|---|
| **W0** | Laws in code. Settlement status + abandon-not-delete. Place chronicle. `whyPlace`. `settle`/`abandon` consequences. Unity Travel labeled region-rebuild. Tests. This doc. | **This PR** |
| **W1** | `spawnSettlementForRegion` founds or joins a `settlements` row (no second identity). Population counted from NPCs. | open |
| **W2** | Unity presents `status` (active vs abandoned ruins remain). No despawn of the settlement id. | open |
| **W3** | Continuous topology: walking the region does not call `_world.Build`. Link gates remain the only fast travel. | open |
| **W4** | L2/L3 aggregates that retain chronicle ids. | open |
| **W5** | Cold-start: new seed, run sim 7 days (then 1 month / 1 year as capacity allows). Inspect settlements, deaths, abandonments **without authored history**. Walk it. | not run |
| **W6** | **Come back 100 hours later.** Help a farmer, leave, return. The place continued. Memories and buildings match the ledger. | not run |

Do not claim W5/W6. Do not claim CK3 borders or 20 million NPCs.

---

## 9. Anti-patterns

- Regenerating a town on visit.
- `DELETE FROM settlements` on decline.
- Fabricating a founding myth in `whyPlace` when chronicle is empty.
- Unity spawning houses the kernel does not have.
- Treating `Travel(WorldId)` as overland.
- A second consequence table next to `world_consequences`.
- Dropping 30 NPCs as “a town” (`procgen-settlements` current spawn is the known offender — wrap it in W1, do not enlarge it).
- Flower Law outside the Hub.
- Claiming the 100-hour test passed because WorldMemory has a JSON slice.

---

## 10. Pins

- Topology + Flower Law + abandon-not-delete + whyPlace emptiness: `server/tests/concordia-megaworld.test.js`
- Consequence graph (existing): `server/tests/world-consequence.test.js`
- Settlement composition / vacancy (existing): `server/tests/settlements.test.js`
- Procgen NPC tombstone (existing decay path): same megaworld test file
- Unity Travel still rebuilds (honest current mode): `server/tests/concordia-world-life.test.js` + comment on `ConcordiaGame.Travel`
