# SLICE REPORT — S14_frontier_stories_sidequests

STATUS: COMPLETE

World: Frontier (display The Frontier). Facet: stories_quests. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity, Concord, or Claude process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Claims, pins, quests, telegraph, unspawned |
| POLITICS.json | Primary: twelve hash pins, four cultures, six presences, eight side quests, one Link telegraph |
| STORIES.md | Discs, six presences, the notice, eight backstories |
| AURA_BIND_NOTES.md | Bind order, pair list, missing-mesh rule |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S14_frontier_stories_sidequests/`.

## Counts

- Hash pins: 12, from `DeterministicOffset` on `settlement/concord-link-frontier/{faction_id}:{district}`. Six are staffed. Six stay empty.
- Presences: 6. Ria, Temir, Vexa, Brunn, Torven, Marsenn. One body each. CX. Empty hands. Muay Thai if struck.
- Cultures: 4. The post, the peers, the cove, the perimeter with no disc.
- Side quests: 8. Each stops on a public sentence. xp 35–50. Coin 0. Items none. Skills none. Faction deltas none.
- Raid telegraph: 1. `raid_link_offschedule`, hours 21–24 when `day_index % 7 == 0`, board at the post hash, roster 0.
- S13 floors, caps, mount verbs, and the four encounter clocks are cited and not retuned.
- Prior Frontier quests left in place: the eight `q_frontier_*` rows, the three `q_s13_*` rows, and the canon chains those rows extend.

## Law placement

The road is the door. The militia perimeter is a history without a country disc, so the weekly portal is a notice on the Couriers' hash and not a fight on an invented western mile. Flower Law stays a Hub disk of 42 m and covers the Hub-ring gate stone at (−34, 0). Country floors are CountryCenter coordinates. Frontier Present at (−220, 0) is the spoke, and this facet does not spawn onto it. People who are stood stay CX. Lin's chassis is not stood. Steel on country ground stays live. Steel on the gate stone stays a flower. No firearm mesh is bound.

## Honesty gaps

- Canon `creatures.json` still lists `dust_courser`, `rail_vulture`, and `thunder_yak`. S13 already refused them. This slice does not reopen that list.
- `frontier_militia` has no country disc. Zara's patrol, the smithy, the infirmary, the caravan camp, the western perimeter, and the council room have no x,z. Those people are not stood. The Third Incursion and the weekly portal stay sentences.
- The parcel echo, Voss, Vela's seeding, Temir's cultivation, Vexa's twelve-year silence, Brunn's durations, Torven's ungiven page, and Zara's Crucible scouts stay the hidden or secret lines. Quests use the public sentences only.
- Kestra is named in the lost-parcel lore and has no npc sheet. She is not invented.
- Dorvik, Iso, Kerith, Mara, Silas, Pell, Hane, Oren Voss, Jensa, and Dust Rose have rooms that are not district ids, or they are a child, or their district hour is not interactable. None are stood.
- Lin is `is_conscious` false. No CX is substituted.
- The Mesh Gate plaque is not the six-capital average (22.91, −1.58).
- Generated Accord Heirs and Assembly Witnesses have empty district lists. They are not extra countries.
- `raid_link_offschedule` has no creature roster because the door it names has no transform. It is a telegraph. It does not borrow `enc_last_dome` or `enc_road_followed`.
- `q_frontier_find_kel` already asks the player to describe the portal's sound. This slice authors no clip and no second description, and it does not touch that quest's `skill_presence_witness` grant.
- The council hash is 13.14 m from Pinewood, outside the 12 m exclusion, and inside the salt overlap. The hitch 9.93 m away remains S13's.
- Brunn's hash and Temir's hash both lie inside the Freenodes disc and the Isolationist disc. The placed ridge stays cap 0. The 2.00 m rivermouth hash stays empty so one elder cannot be doubled.
- Ria's sheet carries two phase families on the same district. This facet binds one body, hours 5–19, from the dispatch blocks.
- Marsenn's sheet marks 5–8 both interactable and not, in different blocks. This facet uses the council block, 8–12.
- Reputation figures 70, 55, 28, 42, 38, and 62 stay the faction sheets. These errands write no delta, so they do not stack a second book on S13's three +1 rewards.
- Health for the six uniques is absent. No hit points were invented.
- `day_index` is the volume day counter. This slice does not define a new clock service.
- Meshes are stubs. Until Aura binds a native mesh, each row spawns nothing rather than a lookalike.
- Country climate rows, the kit's culture field, and the role weapon id mismatch S13 already recorded were not edited.

## Sources read

`Canon.cs` WorldId order, Frontier WorldDef (law, Open Road, Muay Thai, fauna aliases hound and wolf, steel live), gate angle π, RingRadius 34, Flower Law 42 m. Frontier `lore.json`, `countries.json`, `factions.json`, `factions-extra.json`, `npcs.json`, `npcs-extra.json`. Native bible art direction, taxonomy Frontier row, `arch_kit_frontier_road`, volume Frontier quests, `enc_last_dome`, `enc_road_followed`. `WorldGeography.BuildPlaces` and `DeterministicOffset`. S13 floors and caps. Prior slice reports S01–S13, read so this facet would not retune their caps, their clocks, their quests, or Pinewood Crossing.
