# SLICE REPORT — S04_fantasy_geo_politics_sidequests

STATUS: COMPLETE

World: Fantasy (The Sundering). Facet: geo_politics_quests. Design authority JSON and Markdown only. No meshes spawned, no faction or country files rewritten, no Library wipe, no pine re-download, no Unity or Concord process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Anchors, cultures, presences, quests |
| POLITICS.json | Primary: regions, grove and ash, eight existing factions, one toll, six side quests |
| STORIES.md | Geography essay, cultures, six backstories |
| AURA_BIND_NOTES.md | Bind order, lane rule, withheld secrets |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S04_fantasy_geo_politics_sidequests/`.

## Counts

- Side quests: 6, each with a backstory. Givers are the pinewood ward (two errands, one body), Maeris, Kaelan, Corin, and Aria.
- Faction rows described: 8, matching `factions.json`. New faction ids: 0.
- Houses named without rows: Vaelmoor, Thornvale, Sereth, Ablon. Moonleaf Vigil and `thornwood_keep` stay names. Corin's sheet tag is not promoted to a faction.
- Cultures: 2, grove and ash, on one granite-moss palette.
- Country anchors measured: 16 points plus Pinewood and the toll. Territory radii are not built.
- Presences: 3 guards inside the existing budget of 5, 2 guards unspawned until `ward_barrack`, 2 mystics inside the budget of 2 with one unspawned.
- Political encounter: 1, `enc_salt_toll`, no health table.
- Bosses added: 0. Mini-bosses added: 0. The Held Curse and the three S03 mini-bosses are explained and not restaged.
- Fauna rows added: 0. Density weights untouched.

## Law placement

Flower Law stays a Hub disk of 42 m. Glade, Lit Veil gate, pantheon gate, and the thieves' anchors sit inside it, so steel there is a flower. The pantheon temple anchor is 0.4 m clear of the blocked Sundering strip and is spawn-forbidden. Pinewood Crossing stays (62, −28), 68 m out, lettered only that way. The league gate is 120 m from that post and does not claim it. The toll stands at (62, −20), outside the wall and off the lane.

## Honesty gaps

- `countries.json` radii of 25.5 m overlap the Court and each other. They are recorded as claims. They are not navmesh.
- The bog, Quiet Grove, Thornwood keep, the Verge, camp south, the monastery, the estate, the aerie, and the crypt have lore names and no usable point. Quests that need them wait or refuse the trip. Greenmire is not given a coordinate to make its quest easier.
- King Aldous and Queen Morwen both remain. The scaleless heir stays the Crown sheet's tension and is not a quest objective.
- Hidden truths listed in `unresolved_on_purpose` are withheld from objectives and from `STORIES.md`.
- `meta.json` sets gun affinity to 1.0 while describing a world without firearms. This slice arms no one with a gun.
- `knight_corin_hale` carries `faction_id` `thornwood_keep`, which is not a row. The quest uses the glade anchor and does not create the row.
- Volume faction deltas that say `sunder_guard` were not copied. This slice writes no reputation changes.
- Meshes stay stubs. A missing unique spawns nothing and is not replaced by a guard.
- S01 owns the stag cap. S02 owns Hub plaque politics, including the Sundering gate at (0, 34). S03 owns creature caps and the fold. Those files were not rewritten.

## Sources read

`Canon.cs` lane, wall, Fantasy world def, gate angle. Fantasy `lore.json`, `factions.json`, `meta.json`, `npcs.json`, `npcs-extra.json`, Canon `countries.json`, and the Maeris and Seraphine quest headers. Native bible art direction, taxonomy roles, fantasy kit and its named sets, volume density, volume Fantasy quest list. Art style guide mythical row. Prior slices S01, S02, and S03, read so this facet would not retune their caps, seats, or quests. Anchor distances were computed from the country points and the Pinewood city point. No other world was authored.
