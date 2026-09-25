# Catalog — S09 Iron Coast mobs

WorldId `Crime`. Display Iron Coast. Primary file `MOBS.json`.

## Floors

| Floor | Kind | Point | Holds |
| --- | --- | --- | --- |
| `floor_dockside_warehouses` | Placed anchor `dockside_warehouses` | (10.72, 32.9) | Labor cap 3, hounds cap 3, hook window, unpaid shift |
| `floor_unclaimed_street` | Gap, Ghost radius 23 to North Market radius 23 | Mid (8.09, −2.55). Pair-gap 37.58 m. Rose still covers the first 0.81 m; clear run 36.78 m | Bandits, rats, stair window, rotor window |
| Wharf pilings | Named set, no coordinate | — | Bill hound and gulls stay dark until the set is placed |
| Capitals, uptown, 14th, Halloran, Hexshore, federal floor, North Market block, morgue, foundry, Pinewood | Empty of this facet | See JSON | Cap 0 |

Ghost–Rose center distance 9.27 m. Precinct–Halloran center distance 1.03 m. Federal–Ghost overlap along centers 9.67 m. Those overlaps are not paddocks.

## Archetypes

| Id | Body | Cap | Health | Note |
| --- | --- | --- | --- | --- |
| Dock laborer | `npc_role_coast_labor` | 3 warehouse, +2 if wharf placed, 1 reserved, sum 6 | Role has no creature table | Hook is a tool. Hail stays on. |
| Ledger bandit | `npc_role_coast_bandit` | 3 total: 1 hail giver, 1 ambient, up to 2 in a window or the raid | Role has no creature table | Alleys only. Morgue 0. North Market block 0. |
| Wharf hound | `faun_dock_hound` | 3 on the warehouse, 0 during the raid, +1 if wharf placed | `table:faun_med` | Catalog hostile true. Herd 1. Collar stays. |
| Sodium rat | `faun_sodium_rat` | 6 night / 2 day on the gap; Sere +0 | `table:faun_critter` | Catalog hostile false. Lamp yellow, dark eyes. |
| Rain gull | `faun_rain_gull` | 8 day / 2 night only on a placed wharf | `table:faun_small` | Not adds. `q_crime_gull_drop` stays as written. |
| Bill hound | `mon_coast_billhound` | Ambient 0; 1 inside `enc_outstanding` | `table:mon_brute` | No flame. |
| Billdrone | `hyb_billdrone` | Ambient 0; Cyber 0; 1 inside `enc_rotor_saddle` | `table:mon_brute` | Catalog hostile false. Window sets aggro. |

## Windows

| Id | When | Body | Count |
| --- | --- | --- | --- |
| `enc_outstanding` | Volume 18–21, every second day | `mon_coast_billhound` | 1, wharf set only |
| `enc_stair_switch` | 10–13, `day_index % 2 == 1` | `npc_role_coast_bandit` | 1 at the alley midpoint |
| `enc_hook_shift` | 14–17, `day_index % 3 == 0` | `npc_role_coast_labor` | 1 at the warehouse |
| `enc_rotor_saddle` | 5–7, `day_index % 3 == 1` | `hyb_billdrone` | 1 on the gap |

The unpaid shift suppresses the three new windows for its night. It does not move the bill hound.

## Raid

`raid_unpaid_shift`. 22–24, `day_index % 4 == 3`, skipped if `enc_outstanding` is active. Roster: 1 labor foreman, 2 bandits, 2 dock hounds. Telegraph: sodium bracket ticks twice and goes dark, chalk smeared toward a crate, three hook taps and a paper slap. Gull scream is a far scout only when the wharf set exists. Phase 4 with the slip still on the wood grants `item_invoice_slip` once. `item_rem_invoice_stamp` stays on the bill hound.

## Side quests

| Id | Giver | What the player does |
| --- | --- | --- |
| `q_crime_collar_stays` | `barkeep_old_lou` | Watch one hound heel. Leave the collar. |
| `q_crime_hood_reading` | One hail laborer | Read the alley chalk from the ground. Leave the hood standing. |
| `q_crime_paper_stays_dry` | The bandit who does not join the raid | See the slip still on the wood. Report it. |

Eight volume Crime quests and the canon chains they extend stay as they are. No skill is granted again.

## Unspawned Canon seeds

`rage_junkie`, `scrap_golem`, `night_crawler`, `chrome_enforcer`, `ash_hound`. No bible mesh. `ash_hound` is fire. The coast dogs are `faun_dock_hound` and `mon_coast_billhound`.
