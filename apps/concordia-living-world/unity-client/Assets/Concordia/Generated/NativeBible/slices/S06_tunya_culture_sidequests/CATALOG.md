# Catalog — S06 Tunya culture

WorldId `Tunya`. Primary file `POLITICS.json`. Counts below are this facet only.

## Cultures

| Id | Name | Ground it is allowed to use |
| --- | --- | --- |
| culture_ark_memory | Arks of memory | Asbir ark and threshold, ruins entrance and sealed door |
| culture_bloc | The Bloc | Dinye gate and council, Aekon gate and forge, Asbir points |
| culture_radiance_tide | Radiance and the tide writ | Sahm academy and emporium, Bahiij crossing pins and empty corral, Akeia harbor and the two capital pins |
| culture_harbor_dye | Harbor and the dye strip | Fluxom gate, dye strip, two breeder-camp pins, last raid marker |

Veil harvest, the shoal, and the terrace animals stay S05. Nil, the Vessine crash, and the Sangree forge are cited regions with no new quest.

## Factions

Fourteen existing ids, zero added: `sandrun_sanguire`, `vrellan_nationalists`, `vessine`, `corre`, `aekon`, `asbir`, `sahm`, `dinye`, `bahiij`, `masond`, `dormas`, `fluxom`, `nil`, `akeia_of_kahlay`.

`verdant_veil` stays a role string. It is not given a row.

## Placed anchors used

| Anchor | Point | Role in this slice |
| --- | --- | --- |
| dinye_gate | (0, 12) | Treaty door. Walk, do not build. |
| dinye_court | (9, 18) | Oren and Kira, Stratus. Empty registrar line. |
| aekon_gate | (−15, 68) | Glacier door. Not the twelfth lip. |
| aekon_forge | (−10.5, 60.5) | Jera, Stratus and Quartus. Fuel tally. |
| asbir_gate | (−72, −28) | Dune door on the solar errand. |
| asbir_ark | (−90, −58) | Corin, Stratus 5–9. Anomaly stays dark. |
| sahm academy capital | (−20, 45) | Kez, Stratus and Freeus. |
| sahm_emporium | (−5, 54) | Paper stop. |
| bahiij claim / bahiij_capital | (−48, 28) and (−34, 36) | Two pins, one name. Not merged. |
| bahiij_elephant_corral | (−40.5, 35.5) | Empty. No creature id. |
| akeia claim / akeia_capital | (25, 35) and (39, 43) | Two pins, one name. Not a bedchamber. |
| akeia_harbor | (32.5, 23) | Jano, Stratus and Freeus. |
| fluxom_gate | (62, 18) | Placed door. Not Pinewood. No new crowd. |
| fluxom_dye_strip | (74, 33) | Plants, counted. |
| cactem claim / breeder anchor | (70, 55) and (80, 43) | Two pins, one name. |
| strip_last_raid | (61, 59.5) | Mara, Stratus and Freeus. |
| ruins entrance / sealed | (−55, −55) and (−77.5, −70) | Aldra at the entrance. Door stays shut. |
| nil_threshold | (18, −8) | Cited. Not crossed. |
| vessine crash / stillrooms | (48, −42) and (58, −54) | Cited. No new quest. |
| sangree_forge | (−4.43, −65.85) | Cited. No new quest. |

## Presences

Eight uniques, each count 1, each absent if the CX mesh is missing. Labor budget 6 and merchant budget 3 are untouched.

| Presence | Npc | Gives |
| --- | --- | --- |
| presence_oren_council | dinye_chair_oren | q_s06_ochre_not_a_city |
| presence_kira_anteroom | dinye_registrar_kira | the empty line beside him |
| presence_jera_forge | aekon_smith_jera | q_s06_forge_ration |
| presence_corin_terminal | the_ark_wright | q_s06_threshold_unmet |
| presence_kez_academy | sahm_provost_kez | q_s06_contract_without_a_beast |
| presence_jano_harbor | akeia_dock_jano | q_s06_tide_writ_unsigned |
| presence_mara_marker | strip_captain_mara | q_s06_marker_not_a_war |
| presence_aldra_entrance | ruins_scholar_aldra | q_s06_marks_untranslated |

## Encounter

| Id | Kind | Health |
| --- | --- | --- |
| enc_registrar_line | Two existing people, empty queue, Stratus, Dinye Council | none |

## Quests

| Id | Giver | Walk |
| --- | --- | --- |
| q_s06_ochre_not_a_city | dinye_chair_oren | Council to gate, sheet returned unbuilt |
| q_s06_forge_ration | aekon_smith_jera | Forge to glacier gate, tally unspent |
| q_s06_threshold_unmet | the_ark_wright | Ark to threshold, anomaly door left dark |
| q_s06_contract_without_a_beast | sahm_provost_kez | Academy, empty corral, emporium, back |
| q_s06_tide_writ_unsigned | akeia_dock_jano | Harbor to claim center, writ unsigned |
| q_s06_marker_not_a_war | strip_captain_mara | Marker to dye strip, plants counted |
| q_s06_marks_untranslated | ruins_scholar_aldra | Entrance to sealed door, three marks unread |

Rewards are xp only. No coin, no items, no skills, no faction deltas, no DTU.

## Combat ceiling

No boss. No mini-boss. S05 keeps `enc_twelfth_reap`, `enc_pollen_sleep`, `enc_graft_charge`, and the eight creature rows. Steel is live on Tunya. Flower Law stays the Hub disk of 42 m.

## Unspawned

Masond, Corre, Dormas, Vrellan, Sandrun, Hold of First Arrival, twelfth lip, sky temple, quiet quarter, tide temple, `fluxom_harbor_old`, ancestor caves, Rema, Vesh, Thal, Iyatte, Yenna, Xochi, elephants, dye-bugs, orca-scale sealies, a registrar crowd, a musket-staff.
