# SLICE REPORT — S08_ruins_politics_sidequests

STATUS: COMPLETE

World: Ruins (Sovereign Ruins). Facet: politics_quests. Design authority JSON and Markdown only. No meshes spawned, no faction or country files rewritten, no Library wipe, no pine re-download, no Unity or Concord process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Cultures, regions, presences, quests, standing ecology |
| POLITICS.json | Primary: 9 regions, 6 cultures, 6 canon factions, 10 presences, 2 political encounters, 8 side quests |
| STORIES.md | Geography essay, six cultures, eight backstories |
| AURA_BIND_NOTES.md | Spawn pairs, failure rules, withheld secrets |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S08_ruins_politics_sidequests/`.

## Counts

- Side quests: 8, each with a backstory. Givers are Kestra, Oeric, Thren, Iby, Isen, Marrin, Palen, and the Long Summons. Sennit stands and gives nothing. Pell stands in the evening and carries nothing.
- Faction rows described: 6, matching `factions.json`. New faction ids: 0. Two generated rows in `factions-extra.json` left uncast. `ruined_court` and `ruin_rebellion` left as ids on people, with no country.
- Cultures: 6. Benches, night haul, still-cast, witness walk, sister watch, closed book.
- Regions: 9, of which 6 carry quests, the north shelf is the overlap those quests already stand on, the open carry is cited from S07, and the court-and-camp region is a list of unplaced room names.
- Country anchors measured: six claim centers plus the six district pins. Each district is (+8, −6), 10.0 m. Radii left as claims.
- Presences: 10 uniques, count 1 each, outside the keeper budget of 4 and the elite budget of 2.
- Political encounters: 2, `enc_morning_count` and `enc_shelf_names`. No health tables.
- Bosses added: 0. Mini-bosses added: 0. Creatures added: 0. S07 caps untouched.

## Law placement

Catalogue, do not conquer, stays the world law and is not re-tuned. Death stays unfinished. Steel stays live on Ruins-local ground. Flower Law stays a Hub disk of 42 m. The Hub ring gate at π/4 stays S02's plaque. Pinewood Crossing stays (62, −28) on the Hub. The envoy compound (63.86, −9.91) is recorded as a different world and a different z. A refusal in this slice is not minted. The strength cap of 9 and the seven-day re-record are copied onto a sheet that stays in the compound.

## Honesty gaps

- Claim radii overlap (archivists with deniers, spirits, pilgrims, and the envoy; spirits with pilgrims at 2.6 m and with the envoy at 9.4 m; pilgrims with the envoy at 11.0 m; scavengers with deniers by a 0.6 m rind). They are recorded as claims. They are not navmesh. The identical district offset is recorded as the file's generator.
- The Ruined Court, the rebellion, the memorial, the silent library, the first bench, the south camp, the unmapped quarter, the long-summons chamber, the blessing grove, the pilgrim path, the research outpost, the quarantine, and the denier quarters have no coordinates. Quests name the pin they mean. The summons is the one declared pairing, onto `the_still_casting_quarter`, and it spawns only with a native mass.
- Schedule rooms were paired onto anchors only where the bind notes say so. Named-phase duplicates were refused so one person is not stacked on two clocks.
- Vela's 20 m suppression field has no placed seat. She was not stood on the archive pin to give the field a coordinate.
- `extends_world` on these countries is `sovereign-ruins`. No cross-world walk was authored. Calla's Tunya resonance and Thanis's Hub resonance stay on their sheets.
- Hidden truths in `unresolved_on_purpose` are withheld from objectives and from the quest dialogue. STORIES.md names them only as withheld.
- Volume quests stamp `faction_id` `glyph_keepers`. Canon factions use `ruins_archivists` and the other five ids. This slice does not retarget the volume rows. Its own faction deltas are empty.
- The envoy visual lists a concealed pistol. No firearm was bound.
- The Long Summons has no CX body and no printed recipient name. A missing native mass blocks that one turn-in and does not fall back to a keeper.
- Health, loot, and reputation numbers were not invented. Volume weights and S07 caps were not edited.
- Meshes stay stubs. A missing unique spawns nothing and is not replaced by a catalogue keeper.

## Sources read

`Canon.cs` WorldId order, Ruins WorldDef, gate angle π/4, steel live, Sword. Ruins `lore.json`, `factions.json` (6 ids), `factions-extra.json` (2 generated), `countries.json` anchors and radii, `npcs.json` schedules for the ten uniques and the withheld secrets, `npcs-extra.json` for the unplaced court and camp. Canon quest headers in `calla-rebellion`, `thanis-glyph`, `silv-marn-dome`. Native bible art direction, taxonomy Ruins line, `arch_kit_ruins_ash` named sets, volume density budgets, volume Ruins quest ids. Art style guide underworld row. Prior slice S07 (basins, caps, four quests, so this facet would not retune wolves, yards, or the Unfinished). Anchor distances were computed from the country points. No other world was authored.
