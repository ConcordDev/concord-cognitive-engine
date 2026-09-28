# SLICE REPORT — S06_tunya_culture_sidequests

STATUS: COMPLETE

World: Tunya. Facet: culture_quests. Design authority JSON and Markdown only. No meshes spawned, no faction or country files rewritten, no Library wipe, no pine re-download, no Unity or Concord process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Cultures, anchors, presences, quests |
| POLITICS.json | Primary: 11 regions, 4 cultures, 14 existing factions, 8 presences, 1 empty queue, 7 side quests |
| STORIES.md | Geography essay, four cultures, seven backstories |
| AURA_BIND_NOTES.md | Spawn pairs, failure rules, withheld secrets |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S06_tunya_culture_sidequests/`.

## Counts

- Side quests: 7, each with a backstory. Givers are Chair Oren, Ice-Smith Jera, wright Corin Vasse (`the_ark_wright`), Provost Kez, Dock-Master Jano, Captain Mara, and Scholar Aldra. Registrar Kira stands in the queue and gives no quest.
- Faction rows described: 14, matching `factions.json`. New faction ids: 0. `verdant_veil` left as a role string.
- Cultures: 4. Ark memory, the Bloc, radiance and the tide writ, harbor and dye. Harvest law cited from S05 and not retold as a fifth culture with new animals.
- Regions: 11, of which 7 carry quests and 4 are cited or listed as unplaced (Nil, Vessine crash, Sangree forge, the unplaced-name region).
- Country anchors measured: the twelve claim centers plus the secondary pins those countries already ship. Radii left as claims. Three doubled names kept as two points each.
- Presences: 8 uniques, count 1 each, outside the labor budget of 6 and the merchant budget of 3.
- Political encounter: 1, `enc_registrar_line`, no health table, queue empty.
- Bosses added: 0. Mini-bosses added: 0. Creatures added: 0.

## Law placement

Fruit, not the tree, stays the world law and is not re-tuned. Steel stays live on Tunya-local ground. Flower Law stays a Hub disk of 42 m. The Hub ring gate at 3π/4 stays S02's plaque. Pinewood Crossing stays (62, −28) on the Hub. Fluxom Gate (62, 18) is recorded as a different world and a different z. A completed circuit still refuses. Solar on a panel stays the ark's existing wake, and the player does not add a circuit or a DTU.

## Honesty gaps

- Claim radii of 18–28 m overlap (Dinye–Nil 26.9 m against a 46 m sum, Aekon–Sahm 23.5 m against 46, Asbir–ruins 31.9 m against 46, Sahm–Bahiij 32.8 m against 44, Fluxom–cactem 37.9 m against 44, plus Dinye–Akeia, Dinye–Sahm, Fluxom–Akeia, Nil–Akeia). They are recorded as claims. They are not navmesh.
- Bahiij Crossing, Akeia Capital, and Cactem Breeder Camp each exist twice, 16.1 m, 16.1 m, and a separate breeder offset. Quests name the id they mean.
- Masond, Corre, Dormas, Vrellan, and Sandrun have no `country_id`. The Hold, the twelfth lip, the sky temple, the quiet quarter, the tide temple, the old harbor, and the ancestor caves stay unplaced. No coordinate was invented to finish an errand.
- Schedule rooms were paired onto anchors only where the bind notes say so. Mara's avenue-to-marker pair and Aldra's excavation-to-entrance pair and Kez's chancellery-to-academy pair and Jano's pier-to-harbor pair are declared because the room string has no point. Rema was not given that treatment. Her marketplace stays empty and she does not appear.
- `extends_world` values that name other worlds were left as labels. No cross-world walk was authored.
- Hidden truths in `unresolved_on_purpose` are withheld from objectives and from the quest dialogue. STORIES.md names them only as withheld.
- Vessine "ice as memory," Aekon's ice-bloodline country phrase, and Jera's ice-blade backstory disagree with the healing-only species correction. No ice spell was bound and none of the phrases were deleted.
- Asbir's musket-staff archetype was not built. Firearm verb coverage is not this slice.
- `lore_fluxom_founding` still describes an orca-scale horned sealie. S05 already chose the bible body. This slice does not spawn either animal at the gate.
- Aldra's `faction_id` is `nil` while her `faction` field is `ancient_tunyan_ruins`. She is stood at the ruins entrance and is not given Nil Threshold.
- The young city-drawing walker is a faction npc id without a sheet. He was not cast.
- Health, loot, and reputation numbers were not invented. Faction deltas are empty. Volume weights and S05 caps were not edited.
- Meshes stay stubs. A missing unique spawns nothing and is not replaced by terrace labor.

## Sources read

`Canon.cs` WorldId order, Tunya WorldDef, gate angle 3π/4, steel live, Capoeira. Tunya `lore.json`, `factions.json` (14 ids), `countries.json` anchors and radii, `npcs.json` schedules for the eight uniques plus Rema, Vesh, Yon, Corin, and the withheld secrets. Canon quest headers in `arks-of-memory`, `bloc-secret`, `nil-protection`, `vessine-origin`. Native bible art direction, taxonomy Tunya line, `arch_kit_tunya_veil` named sets, volume density budgets, volume Tunya quest ids. `WorldGeography.CountryCenter`. Art style guide solarpunk row. Prior slices S04 (shape) and S05 (ecology, so this facet would not retune caps, floors, or the twelfth). Anchor distances were computed from the country points. No other world was authored.
