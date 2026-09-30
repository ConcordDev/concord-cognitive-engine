# SLICE REPORT — S09_crime_mobs_raids

STATUS: COMPLETE

World: Crime (display Iron Coast). Facet: mobs_raids. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity or Concord process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Floors, caps, windows, raid, quests, unspawned |
| MOBS.json | Primary: 7 archetypes, 4 windows, 1 raid, 3 side quests |
| STORIES.md | Law, the two floors, each archetype, the raid, three backstories |
| AURA_BIND_NOTES.md | Bind order, caps, missing-mesh rule |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S09_crime_mobs_raids/`.

## Counts

- Archetypes: 7. Two CX roles (`npc_role_coast_labor`, `npc_role_coast_bandit`), three animals (`faun_dock_hound`, `faun_sodium_rat`, `faun_rain_gull`), one monster (`mon_coast_billhound`), one hybrid (`hyb_billdrone`).
- Labor cap: 3 on the placed warehouse anchor, plus 2 if the wharf set is placed, 1 reserved, sum 6. That is the volume budget.
- Bandit cap: 3 on the unclaimed street. Morgue stays 0.
- Hound cap: 3 spaced solos on the warehouse, 0 while the raid fields its own 2, plus 1 on a placed wharf. They do not join `enc_outstanding`.
- Rat cap: 6 night / 2 day on the gap. Sere added cap 0.
- Gull cap: 8 day / 2 night only after the wharf set is placed.
- Mini-bosses: 4. `enc_outstanding` keeps the volume clock and gains drop conditions. `enc_stair_switch`, `enc_hook_shift`, and `enc_rotor_saddle` are new windows on existing bodies.
- Raid: 1. `raid_unpaid_shift`, hours 22–24 when `day_index % 4 == 3`, skipped if the invoice evening is active. Roster of 5. One telegraph. Four phases.
- Side quests: 3. Givers are Old Lou (unique, not cloned), one hail laborer inside the budget of 6, and one hail bandit inside the budget of 3. No skill grant. No new item id.
- Volume weights and `enc_outstanding`: cited, not edited.
- Prior Crime quests left in place: the eight `q_crime_*` rows in `QUESTS_BY_WORLD.json` and the canon chains those rows extend.

## Law placement

The bill arrives. Witnesses remember. A hood, a rainstorm, and a crate are ways the coast tries to delay a sum. Delay is not cancellation. The stamp drops only after acknowledgment, from the bill hound, on the volume evening. The unpaid shift can keep a slip on the wood and cannot mint the stamp. Flower Law stays a Hub disk of 42 m. Pinewood Crossing stays (62, −28). Coast steel stays live. People stay Wing Chun on CX. The drone alias on this continent is one rotor on an existing hybrid, inside one dawn window.

## Honesty gaps

- Canon `creatures.json` still lists `rage_junkie`, `scrap_golem`, `night_crawler`, `chrome_enforcer`, and `ash_hound`. None of those ids exist in the native bible. `ash_hound` is written as fire. This slice spawns the bible bodies or nothing. It does not delete the Canon sentences.
- `enc_outstanding` and the gull line name wharf pilings. Named set `wharf` has no Canon point. Until it is placed, the bill hound and the gulls spawn nothing. The warehouse anchor is not a substitute.
- Named sets `tenement`, `armored_warehouse`, and `foundry_steam` have kit names and no Canon point. The derived alley and the placed `dockside_warehouses` anchor are the floors. A fire escape, a loading-dock module, or a foundry brass run appears only when that set is placed. The foundry gets no mobs from this facet.
- The 37.58 m figure is the Ghost rim to the North Market rim along those two capitals. The Ghost-rim endpoint is also inside Iron Rose (27.24 m from (−6.41, 40.5), radius 28). Clear ground starts 0.81 m south of that endpoint and runs 36.78 m. The floor stays (8.09, −2.55), which is outside every circle. S10 already seats Bell on that point and quotes the pair-gap. This note does not move either.
- `hyb_billdrone` is `hostile: false` and its spawn line says roofs at high witness heat. No heat meter is defined in the catalogs this slice read. The dawn window is the instance. The catalog was not edited. Cyber cap added here is 0.
- `faun_dock_hound` is `hostile: true`. Rats and gulls are not. Instance rules are in this slice.
- Role faction string `delgado_syndicate` and volume faction string `ghost_contracts` are not the canon ids `iron_rose_syndicate` and `ghost_network`. Quest deltas name the canon ids and tell the binder to write once into the existing book. No third book is created. The faction files were not edited.
- `barkeep_old_lou` has a secret about a back room. The collar quest uses the public anchor disaster only. The secret stays unrendered. If Lou has no transform, the quest does not start.
- Hidden truths in `lore_unit_betrayal`, `lore_voss_envoy`, and `lore_drone_swarm_aftermath` stay unrendered. The drone strike is not a spawn.
- Health for the two roles is absent from `ROLES.json`. No hit points were invented. Creature health stays the table names already on the rows.
- `day_index` is the volume day counter, the same convention S07 used. This slice does not define a new clock service.
- Meshes are stubs. Until Aura binds a native mesh, each row spawns nothing rather than a lookalike.
- Politics, vendors, the 14th, Hexshore, the federal case, Halloran, Dom's block, and the Thorpe chain past the volume extensions are left for S10.

## Sources read

`Canon.cs` WorldId order, Crime WorldDef (law, Ghost Contracts, Wing Chun, fauna aliases hound and drone, steel live), gate angle 5π/4, Flower Law 42 m. Crime `lore.json`, `countries.json` capitals and radii, `factions.json` ids, `creatures.json` seeds, `npcs-extra.json` Old Lou. Native bible art direction, taxonomy Crime row, Crime animal and monster and hybrid rows, `npc_role_coast_labor`, `npc_role_coast_bandit`, `arch_kit_crime_coast` named sets, volume density, `enc_outstanding`, volume Crime quests, `item_invoice_slip`, `item_rem_invoice_stamp`, `skill_steel_invoice`, `skill_presence_witness`. Art style guide WorldId map. Prior slices S01 through S08, read so this facet would not retune their caps, their clocks, their quests, or Pinewood Crossing.
