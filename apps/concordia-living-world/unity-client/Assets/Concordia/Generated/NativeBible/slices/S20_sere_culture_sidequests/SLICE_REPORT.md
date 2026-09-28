# SLICE REPORT — S20_sere_culture_sidequests

STATUS: COMPLETE

World: Sere (canon world id `sere`, display Sere, lore name Corrupt Earth). Facet: culture_quests. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity or Concord process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Boards, eight quests, combat ceiling |
| POLITICS.json | Primary: eight cultures, eight boards, three empty districts, eight side quests, ecology cited from S19 |
| STORIES.md | Wound politics, survivor backstories, quest backstories, withheld lines |
| AURA_BIND_NOTES.md | Bind order, zero spawn, missing-body rule |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S20_sere_culture_sidequests/`.

## Counts

- Boards with a coordinate: 8. Spawn count 0 on each. Named sheets stood: 0. No schedule location on a Sere unique equals a country anchor id.
- Empty districts on purpose: Mercy (4.07 m from the slate), Aldermere, Hollowford.
- Side quests: 8. `q_s20_no_roster`, `q_s20_still_temporary`, `q_s20_above_the_realms`, `q_s20_within_a_season`, `q_s20_verdict_unshipped`, `q_s20_small_and_leaving`, `q_s20_brothers_on_the_boards`, `q_s20_calls_stopped`.
- Rewards: xp only. Coin 0. Items none. Skills none. Faction deltas none.
- New creatures, mini-bosses, bosses, tokens: 0.
- Enforcer budget: 4, unchanged. S19's two pins unchanged.
- Volume weights and `enc_compound_mark`: cited, not edited.
- Prior Sere quests left in place: the eight `q_sere_*` rows and the four `q_s19_*` rows.

## Law placement

No Refusal held, so the culture you can walk is a set of public sentences on district steps, and the people who could explain the rest keep rooms the country file never placed. The empty roster is the Tessera. The word temporary is the mint. The motto without its charter is the Spire. The season is the order book. The unshipped verdict is classification standing inside Verge's circle. The three names and the seven arks are the small table. The two mottos are the brothers. The stopped calls are the creditor. Flower Law stays a Hub disk of 42 m. The Tally capital at 29.00 m from the local origin is not that disk. Pinewood Crossing stays (62, −28). The furnace eye stays out of the Crucible bay. The waystone present stays (−125.27, −269.29) with tariff 0, inspection 0, and an empty owner.

## Geography checked

District steps are capital plus (8, −6), length 10 m. Tessera and Mercy capitals are 4.07 m apart, and their districts are 4.07 m apart, overlap 44.43 m. Curtain district (−23.69, −1.55) is 13.66 m from the Verge capital, inside radius 23, and 1.28 m outside Hollowford. Open Table district is 0.33 m outside Keshar's rim. Keshar district is 10.02 m inside the Open Table circle. Open Table far rim 88.50 m. Keshar far rim 89.50 m. Wilds begin at 90 m. Spire radius is 20.5, the only one of that size. Three anchors share the name string `the_clearing_spire`.

## Honesty gaps

- Unique NPCs are authored and alive in canon. They are unspawned here because their interactable rooms are not anchor ids. A later facet that finds a real pin may stand them. This one does not invent the pin.
- Esha's home string matches the Open Table district's name. Her interactable blocks do not. The board is not her.
- `furnace_belt`, `tessera_spire`, and `mark_tenement` have no Canon.cs transform. Quests that mention them are finished while the kits are still absent.
- The opens depend on CountryCenter still reading the capitals and radii S19 used. If that resolver changes, the cited floors move with it. This file does not remeasure them.
- Volume quests use shortened faction ids. Canon ids are `the_tessera` and `the_open_table`. The enforcer role says `tessera_hold`. None of those files was rewritten. This slice writes no delta.
- `q_s20_calls_stopped` and `q_s20_brothers_on_the_boards` share the Keshar board. They do not share a prerequisite. Completing one does not complete the other.
- Health, damage, and loot stay the tables S19 already named. No live numbers were invented for a person, because no person is stood.
- Meshes for the S19 creatures remain stubs under that slice's rule. This facet adds no mesh request.

## Sources read

`Canon.cs` WorldId.Sere. `Canon.Gates` absence. HubLawRadius 42. Sere `lore.json`, `meta.json`, `factions.json`, `countries.json`, `npcs.json`, `npcs-extra.json`. Native bible art direction Sere row, taxonomy Sere line, `arch_kit_sere_mark`. Volume Sere quests and `enc_compound_mark`. Prior slice S19 for caps, opens, clocks, enforcer pins, and the waystone. S01 through S18 were not retuned. S19's caps, hours, and four quests were not retuned.
