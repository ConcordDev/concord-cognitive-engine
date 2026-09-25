# Aura bind notes — S10 Iron Coast politics

Bind this facet after S09 and after the Crime block of `volume/DENSITY_TABLES.json`. Do not retune weights, creature caps, `enc_outstanding`, `enc_stair_switch`, `enc_hook_shift`, `enc_rotor_saddle`, or `raid_unpaid_shift`. Do not edit Canon lore, factions, countries, npc sheets, or `vend_crime_bell`. Do not download packs. Do not wipe `Library`. Do not re-download pines.

Art direction is the Crime row: stained brick, rust corrugate, asphalt, sodium, palette `#3a342c` `#8a6a48` `#c8a060` plus the kit's `#5c3038` in the brick course. Stylized realism PBR. One emissive per figure, on a gold knuckle, a badge edge, a pen clip, or a wet hood catching the lamp. Foundation is `arch_kit_crime_coast`. A faction cloth color may sit on an upper storey and must leave the tenement silhouette. 100 m read is a coat, a house door, a walkup, a block jacket, a glass desk, a hood on a crate. Humanoids are CX with the Concordia face. Plates and cloth use `CX_Head`, `CX_Chest`, `CX_Shoulder_*`, `CX_Hip`, `CX_Grip_*`, `CX_Back`. Fight style Wing Chun stays on people, empty-handed here. Quaternius is not a body. A firearm is not a mesh.

## Spawn pairs

A schedule room spawns a unique only when this list pairs it to an anchor. Any other room spawns nothing. The sheets carry two clocks in one array, hour-bands and named phases. Bind the window in this table once. A second row that names the same person spawns no clone. Volume aliases `mama` and `bell` are these same bodies, not a second transform. Missing CX mesh: that person is absent. No laborer and no bandit speaks their lines. Budgets 6 and 3 stay spent by S09. These uniques do not spend them.

| Unique | Window | Sheet room | Anchor |
| --- | --- | --- | --- |
| `mama_delgado` | Clock 8–12 | `iron_rose_estate` | hash pin (−7.66, 28.57) |
| `captain_marquez_14th` | Clock 8–12 | `14th_precinct_house_captains_office` | `14th_precinct_house` (15.44, −56.78). The office name has no separate hash. The house pin is the floor. |
| `pi_lead_halloran` | Clock 8–12 | `halloran_greer_office` | (23.44, −61.88) |
| `gang_lead_dom_north_market` | Clock 9–13 | `north_market_main_block` | (21.39, −44.96) |
| `accountant_iris_hexshore` | Clock 7–12 | `hexshore_holdings_office` | (−45.29, −9.93) |
| `agent_navarro_federal` | Clock 7–12 | `federal_field_office_secure_floor` | (36.07, 35.58) |
| `informant_silas_bell` | Clock 10–16, `day_index % 2 == 0` | `crime_alley_corner` | S09 gap midpoint (8.09, −2.55). The corner has no coordinate. He is absent the whole odd day. |

Outside those windows the unique is absent even if the anchor is loaded. Jax, Cipher, Tomás, Renny, Lou, Maddox, Dahlia, Ada, Iniko, Pia, Thorpe, Pidgeon, and the generated names are not in the pair list. They spawn nothing in this facet.

Hash pins come from `DeterministicOffset("settlement/crime/{faction_id}:{district}", 8+2i)`. Do not replace them with the fixed (+8, −6) step. Do not move S09's warehouse off (10.72, 32.9). Do not stand Mama on (1.59, 34.5), Navarro on (46.81, 37.1), or Dom on (21.45, −49.99). Those three numbers are S09's labels for ground this facet leaves empty.

## Encounters

`enc_s10_estate_audience` is Mama alone, 8–12. No health table. No shotgun. No lieutenant. At 12 she is gone.

`enc_s10_south_morning` is three pins. Marquez and Halloran through 12, Dom from 9 to 13. Distances 9.49 m, 13.23 m, 17.04 m. No one paths. No health table. Killing any of them fails the quest open on that pin.

`enc_s10_two_desks` is Iris and Navarro, 7–12, 93.22 m apart. The safe house and both warrens stay empty. They do not meet, and a meeting would collapse the public word unknown.

`enc_s10_corner_sit` is Bell on even days, 10–16, on the gap. Odd days the midpoint belongs to `enc_stair_switch` from 10–13 and to no sitter after. He is not one of the three bandits. The crate is the existing `prop_dock_crate`.

## Quests

Register the eight objects in `POLITICS.json` beside the volume Crime list. Do not edit the canon chains, the eight `q_crime_*` volume rows, or the three `q_crime_*` rows from S09.

Turn-in matches the JSON. Board lines fire after turn-in. No quest grants a skill, a coin amount, an item, a faction delta, a memory shard, or a DTU.

Failure rules in the JSON are the bind. In particular: no transcript and no Vesper at the estate; no named lieutenant and no collected skim; no godson and no opened locker; no daughter, no named man, no residence scene; no Iris-as-source and no walk from Navarro to Hexshore as an accusation; no decision forced on the ledger; no nephew's name and no retaliation; no second tip and no memorial hung on the warehouse.

## Do not bind

- A fauna floor on any politics pin. S09 already refused the capitals as paddocks. This slice still refuses that.
- A retune of `faun_dock_hound`, `faun_sodium_rat`, `faun_rain_gull`, `mon_coast_billhound`, or `hyb_billdrone`.
- `rage_junkie`, `scrap_golem`, `night_crawler`, `chrome_enforcer`, or `ash_hound` as a spawn.
- Mama's shotgun, The Rose, or any pistol, baton, or rifle in ambient hands.
- Tomás on the estate pin. A second chair would make the heir decision visible.
- Bell on the hash dockside (2.30, 46.89) or on the subway pin 6.65 m from the warehouse. Those are not his corner.
- A child mesh for Pidgeon, or any child on Dom's block to illustrate the age rule.
- A drink item for Lou, or a second stall for Maddox.
- The generated faction Iron Racket, and any generated `gen_crime_*` body.
- Pinewood lettering on a coast door. (62, −28) is the Hub.
- Flower Law as a Crime-local rule. Apply it only if a fight is dragged inside the Hub 42 m disk and outside the Arena.
- The named sets `wharf`, `tenement`, `armored_warehouse`, and `foundry_steam` as political interiors. They remain unplaced. The foundry's brass is not a faction color.
- A walk through the 5π/4 gate into the Hub, along the Crime–Sere route, or into Luminary's back-channel pin.
- Hidden truths listed in `unresolved_on_purpose`. They are not dialogue.

## Suggested check

With no unique meshes bound, every giver is absent and none of the eight errands can be turned in by a laborer or a bandit. Bind Mama: at 8–12 the estate pin shows one CX coat and a gold knuckle; the Rose capital 12 m away shows no lieutenants; the S09 warehouse 18.88 m away still shows only S09's labor and hounds; after 12 she is gone and the shotgun was never in the scene. Bind Marquez and Halloran: two doors 9.49 m apart, neither man crosses, the locker and the residence stay empty. Bind Dom from 9: he does not walk to either door; the alley-network pin stays empty. Bind Iris and Navarro in the same hour and confirm they are 93.22 m apart with no path between them. Bind Bell on an even day at 10–16 on the gap only: the bandit cap is still 3 without him; on an odd day he is absent while the stair window runs. Swing a blade at the estate and the steel stays steel. Swing it after dragging the fight onto the Hub plaza, outside the Arena, and the blade is a flower.
