# Aura bind notes — S14 Frontier politics

Bind this facet after S13 and after the Frontier block of `volume/DENSITY_TABLES.json`. Leave weights, creature caps, mount verbs, `enc_chevron_morning`, `enc_canvas_dive`, `enc_last_dome`, and `enc_road_followed` on their clocks. Leave Canon lore, factions, countries, and npc sheets unread by any writer. Download no packs. Wipe no `Library`. Re-download no pines. Stop no Concord, Unity, or Claude process.

Art direction is the Frontier row: timber, salvage plate, canvas. Palette `#c8b070` `#efe6d4` `#4a3828`. Stylized realism PBR. One emissive on Torven's glyph thread, dull, in the weave. Everyone else is unlit cloth and worn plate. Foundation is `arch_kit_frontier_road`. A faction cloth color may sit on a coat and must leave the open-road silhouette. 100 m read is a post hash, a camp hash, a cove, a ridge, a temple door, a council coat, and a hitch that already has two horses. Humanoids on the pair list are CX with the Concordia face. Plates and cloth use `CX_Head`, `CX_Chest`, `CX_Shoulder_*`, `CX_Hip`, `CX_Grip_*`, `CX_Back`. Fight style Muay Thai stays on people, empty-handed here. Quaternius is not a body. A firearm is not a mesh. A walker chassis is not a person. A wolf is not a courier.

## Spawn pairs

A schedule room spawns a unique only when this list pairs it to an anchor. Any other room spawns nothing. Bind the window in this table once. A second row that names the same person spawns no clone. Missing CX mesh: that person is absent. No road warden and no bandit speaks their lines. Guard budget 5, dome-bandit budget 2, and road-bandit budget 1 stay spent by S13. These uniques do not spend them.

| Unique | Window | Sheet room | Anchor |
| --- | --- | --- | --- |
| `postmaster_ria` | Clock 5–19 | `link_post_alpha` | Hash (48.72, −9.79). The placed post (56.86, −23.79) is 16.19 m away, inside the 12 m Pinewood exclusion, and stays cap 0. If the only transform on hand is that placed post, she spawns nothing. |
| `broker_temir` | Clock 6–15 | `brokers_camp` | Hash (44.74, 48.32). The placed camp (45.13, 39.85) is 8.48 m away and empty. |
| `pirate_captain_vexa` | Clock 7–11 and 19–23 | `pirate_cove_north` | Hash (−16.16, 33.18). The placed cove (−1.77, 22.37) is 18.00 m away and empty. One body across both windows. |
| `isolationist_elder_brunn` | Clock 8–12 and 15–19 | `enclave_north_ridge` | Hash (20.78, 40.87). The placed ridge (35.08, 29.94) is 18.00 m away and stays cap 0. If the only transform is that placed ridge, he spawns nothing. |
| `mesh_prophet_torven` | Clock 7–19 | `mesh_temple_central` | Hash (−19.74, −55.91). The placed temple (−4.68, −65.67) is 17.95 m away and empty. |
| `alliance_elder_marsenn` | Clock 8–12 | `alliance_council_township` | Hash (53.82, −38.28). The hitch (54.82, −48.16) is 9.93 m away and keeps two led horses and one guard. She is 13.14 m from Pinewood. |

Outside those windows the unique is absent even if the anchor is loaded. Lin, Dorvik, Iso, Kerith, Zara Morn, Hane Okra, Oren Voss, Jensa Bell, Pell Orange, Dust Rose, Mara Pin, and Silas Quinn are not in the pair list. They spawn nothing in this facet. Kestra has no sheet.

Hash pins come from `DeterministicOffset("settlement/concord-link-frontier/{faction_id}:{district}", 8+2i)`. Leave the (+8, −6) trade-zone anchors where the country file and S13 put them. Leave the drift on (42.99, 14.03), the pale flat on (17.07, −50.92), the cut on (19.55, 5.29), and the salt midpoint on (47.84, −29.98).

## Encounters

`enc_s14_post_day` is Ria alone, 5–19. No health table. The safehouse hash 3.19 m away stays empty.

`enc_s14_peer_day` is Temir alone, 6–15. No health table. The pin is inside two discs. Brunn does not path the 25.09 m. field_relays stays empty.

`enc_s14_cove_split` is Vexa on the cove hash in the two windows. No health table. The cut's two dome bandits and one road bandit stay on (19.55, 5.29). She does not path the 45.31 m.

`enc_s14_ridge_hours` is Brunn on the ridge hash. No health table. The rivermouth hash 2.00 m away stays empty. The placed ridge stays cap 0.

`enc_s14_temple_page` is Torven alone, 7–19. No health table. The meditation hash stays empty. The pronghorn stay on the pale flat.

`enc_s14_minutes` is Marsenn alone, 8–12. No health table. The hitch is S13's. `q_s13_salt_chord` stays the guard's.

`enc_s14_link_notice` is `raid_link_offschedule`. Hours 21–24 when `day_index % 7 == 0`. Bodies none. The board text is the telegraph. No creature, no role, and no unique is added for the night. It does not suppress the four S13 windows, and they do not suppress it. Their hours end by 19.

Killing Ria, Temir, Vexa, Brunn, Torven, or Marsenn fails the quest open on that pin. No rivet, nail, seal, page, or trust-mark drops.

## Quests

Register the eight objects in `POLITICS.json` beside the volume Frontier list and beside S13's three. Leave the canon chains, the eight `q_frontier_*` volume rows, and `q_s13_salt_chord`, `q_s13_sail_not_roof`, `q_s13_two_cuts` on their givers.

Turn-in matches the JSON. Board lines fire after turn-in. No quest grants a skill, a coin amount, an item, a faction delta, a memory shard, or a DTU.

`q_s14_seven_unstated` reaches Temir and must still find them inside 6–15. `q_s14_seal_at_the_cove` reaches the ambush hash and must not continue to the cut. `q_s14_postponed_third` reaches the hitch and must not move the horses or retie the salt quest. `q_s14_page_stays` must not author sermon lines. `q_s14_constitution_quiet` must not instantiate Lin. `q_s14_two_log_lines` must not instantiate Kestra or Dorvik.

## Telegraph bind

`raid_link_offschedule` binds as text on the post hash during its window. It has no creature id, no remembrance item, and no phase that spawns a rib. The western perimeter is not given a placeholder transform. The Hub gate at (−34, 0) and Frontier Present at (−220, 0) stay empty of this notice. `q_frontier_find_kel` asks for a description of the portal's sound and grants `skill_presence_witness` on its own row. This notice does not add a clip, a description, or a skill.
