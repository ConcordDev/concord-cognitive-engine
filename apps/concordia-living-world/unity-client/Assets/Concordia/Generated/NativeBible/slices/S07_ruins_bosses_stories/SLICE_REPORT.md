# SLICE REPORT — S07_ruins_bosses_stories

STATUS: COMPLETE

World: Ruins (Sovereign Ruins, canon world id `sovereign-ruins`). Facet: bosses_stories. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity or Concord process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Caps, four mini-bosses, boss, tokens, quests, unspawned |
| BOSSES.json | Primary: basins, 6 creature rows with caps, 3 zero-cap cites, 4 mini-bosses, 1 boss, 2 tokens, 4 side quests |
| STORIES.md | Law essay, basin arithmetic, encounter stories, quest backstories, withheld lines |
| AURA_BIND_NOTES.md | Bind order, seam rules, missing-mesh rule |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S07_ruins_bosses_stories/`.

## Counts

- Creature rows with a Ruins cap: 6 (`faun_ash_wolf`, `faun_catalogue_crow`, `faun_rib_lizard`, `mon_ruins_wraith`, `mon_ruins_crawler`, `hyb_ribwolf`).
- Caps: wolves 4 in the open, dusk–night, day 0; crows 8 day in the yard; lizards 3 day; wraiths ambient 2; crawler ambient 1; ribwolves ambient 2. Event windows zero the matching ambient slot.
- Zero caps: `hyb_ashfang` (S03), `hyb_mercywraith` (cross, not ring-adjacent), `mon_sunder_griffin` (milepost).
- Mini-bosses: 4. `enc_catalogue_walks` (existing clock, placement and drop tightened, no new mesh). `enc_rib_basket` (new window, existing `hyb_ribwolf`, count 2). `enc_returned_kill` (new window, existing `faun_ash_wolf`, count 4). `enc_late_breath` (new window, existing `mon_ruins_wraith`, count 1).
- Boss: `enc_unfinished` / `mon_boss_unfinished`. Volume phases, volume hours, bible boss rule. Floor is the unplaced `unburial_court` set.
- Remembrance: the two existing Ruins ids only. No third token.
- Side quests: 4, one keeper role inside budget 4. Thren speaks once. No skill grant. No DTU. Hidden truths withheld.
- Volume weights and both Ruins encounter clocks: cited, not edited.
- Prior Ruins quests left in place, including the eight volume rows and the Calla, Thanis, and Silv canon chains.

## Law placement

Death is unstable. Catalogue, do not conquer. The wolf pack practices that by returning to a kill. The ribwolf practices it by wearing a basket that must be left when it falls. The wraith practices it by remaining after the bangles break. The crawler practices it by writing a line the player names and does not own. The Unfinished practices it by offering a mask that ends the Refusal if worn, and by standing back up once if the page is only damaged. Flower Law stays a Hub disk of 42 m. Pinewood Crossing stays (62, −28). The ashfang pair stays on the Fantasy shoulder.

## Geography

`basin_open_carry` is derived, not invented as a new capital. Scavenger center (−31.7, −27.55) r 25.5 and archivist center (39.83, −33.42) r 25.5 are 71.8 m apart, leaving 20.8 m of open. Midpoint (4.1, −30.5). Denier overlap with the archive is about 16 m and is a dispute, cap 0. Spirits, pilgrims, and the envoy form one north shelf, cap 0. `bone_yard`, `unburial_court`, and `catalogue_hall` remain unplaced kit sets.

## Honesty gaps

- Named sets have no Canon.cs transform. Until they are placed, yard fauna and the boss spawn nothing. Capitals are not substitute floors.
- The open depends on CountryCenter still reading those two capitals. If that resolver changes, the wolf floor unplaces with it.
- `faun_ash_wolf` is `hostile: true` in `ANIMALS.json`. Wraith, crawler, and ribwolf are `hostile: false`. Instance aggro is in this slice. The catalogs were not edited.
- Volume quest faction deltas say `glyph_keepers`, the style name. This slice's deltas use `ruins_archivists` and `ruins_scavenger_crews`. The volume file was not corrected.
- Canon `creatures.json` seeds `ruin_rat_king`, `ash_revenant`, and `gloom_stalker` have no bible ids. They stay unspawned. They were not aliased onto the crawler, the wraith, or the wolf.
- `hyb_mercywraith` is a real cross-list. Staging it would author Superhero-adjacent content on a non-adjacent ring. Cap 0 on both worlds from this slice.
- Health, damage, and loot stay table names and item ids already on the bible or vendor rows. No live numbers were invented.
- `mon_boss_unfinished` is tagged humanoid for gait. The bind note forbids a CX mesh. The monster file was not edited.
- Meshes are stubs. Until Aura binds a native mesh, each row spawns nothing rather than a lookalike.

## Sources read

`Canon.cs` WorldId.Ruins WorldDef (title, refusal, steel live, law, fauna aliases wraith/wolf/griffin, gate angle π/4). `HubLawRadius` 42. Sovereign Ruins `lore.json`, `countries.json` capitals and radii, `factions.json` ids, `creatures.json` seeds, quest files for Calla, Thanis, and Silv. Native bible art direction Ruins row, taxonomy biome line, Ruins animal and monster and hybrid rows, `arch_kit_ruins_ash` named sets, volume density, `enc_unfinished`, `enc_catalogue_walks`, vendor notes for both tokens, `skill_steel_unburial`, `skill_presence_lament`, `skill_craft_catalogue`. `WorldGeography.CountryCenter` and the non-Hub wilds ring. Art style guide world map. Prior slices S01 through S06, read so this facet would not retune their caps, move Pinewood, restage ashfang, or redo their quests.
