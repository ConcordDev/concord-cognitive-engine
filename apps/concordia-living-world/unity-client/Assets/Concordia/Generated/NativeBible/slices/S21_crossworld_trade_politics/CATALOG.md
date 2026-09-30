# S21 catalog — Cross

Cross is the mediation. WorldIds remain Hub, Cyber, Ruins, Fantasy, Tunya, Frontier, Crime, Superhero, Crucible, Sere. No new creature, mini-boss, boss, item, skill, or faction delta.

## Nine destinations

| Destination | Gate angle | Hub plaque (34 m) | Law lip (42 m) | Present | Hub-face post while the clock is Hub |
| --- | ---: | --- | --- | --- | --- |
| Cyber | 0 | (34.00, 0.00) | (42.00, 0.00) | (220.00, 0.00) | tariff 0.05, inspection 1, owner `Concordant Watch` |
| Ruins | π/4 | (24.04, 24.04) | (29.70, 29.70) | (155.56, 155.56) | same three lines |
| Fantasy | π/2 | (0.00, 34.00) | (0.00, 42.00) | (0.00, 220.00) | same |
| Tunya | 3π/4 | (−24.04, 24.04) | (−29.70, 29.70) | (−155.56, 155.56) | same |
| Frontier | π | (−34.00, 0.00) | (−42.00, 0.00) | (−220.00, 0.00) | same. Lore: no embassy. The plaque is the staff. |
| Crime | 5π/4 | (−24.04, −24.04) | (−29.70, −29.70) | (−155.56, −155.56) | same |
| Superhero | 3π/2 | (0.00, −34.00) | (0.00, −42.00) | (0.00, −220.00) | same |
| Crucible | 7π/4 | (24.04, −24.04) | (29.70, −29.70) | (155.56, −155.56) | same |
| Sere | 5π/4 + 0.35 rad | none | (−17.71, −38.08), no plaque | (−125.27, −269.29) | no `GatePost`. Waystone rule if one is ever ensured: tariff 0, inspection 0, owner empty. |

Far-face owner, when the clock is already that world, is `WorldBook.Factions` index 0 by name: Zero Collective, Three Archivists, Wildwood Circle, Sanguire of Sandrun, Couriers' Guild, Ghost Network, Enforcers' Movement, Witnesses. Sere's first faction is the Tessera, and the waystone branch returns before that name is written.

`ConcordiaHost.GateGuards` is 2. On a Hub clock the gate spawns two people named `a guard`, CX, outfit 1, offset ±3.4 m on the gate's right and 0.4 m forward. Their title string is the post's owner. They are not authored citizens. This facet adds none and removes none.

## Three tariff instruments

| Instrument | Rate | Where it is written |
| --- | --- | --- |
| `GatePost` on a spoke | 0.05, inspection 1 | Hub face of each of the eight. Owner string `Concordant Watch` while the clock is Hub. |
| `BorderDef` | 0.05, status `open` | Eight ring neighbors, plus `border/crime/sere`. `controllingFactionId` is `FirstFaction` of the first world in the pair, an id, not a display name. |
| Caravan arrival | `value * 0.05` | `CrossRing.Arrive` appends `tariffsCsv`. It uses `RingTariff` even if a border rate were different. |

The 0.12 disputed rate exists in `WorldGeography.AddRoute` and matches no authored cross-world pair. Every built border stays 0.05 and `open`. Hub has no `countries.json` and no route of its own. A walk from Hub into a Present records a journey stamp and does not call `RecordBorderCrossing`.

Staples the caravan may carry, from `KingdomBook.Staple`: Hub lanterns, Ruins remnants, Tunya harvest, Fantasy ward, Crime invoices, Cyber census, Frontier road, Superhero mercy, Crucible drift, Sere marks. This slice dispatches no caravan.

## Nine borders

Each ring midpoint is 84.19 m from both Presents and 203.25 m from the Hub origin, outside `ArriveM` 68, so `CountryAt` can read the route. At the exact midpoint `globalT` is 0.5 and the resolver returns world B, the second name in the id.

| Border id | Midpoint (x, z) | Controlling faction id |
| --- | --- | --- |
| `border/cyber/sovereign-ruins` | (187.78, 77.78) | `zero_collective` |
| `border/sovereign-ruins/fantasy` | (77.78, 187.78) | `ruins_archivists` |
| `border/fantasy/tunya` | (−77.78, 187.78) | `wildwood_circle` |
| `border/tunya/concord-link-frontier` | (−187.78, 77.78) | `sandrun_sanguire` |
| `border/concord-link-frontier/crime` | (−187.78, −77.78) | `frontier_couriers_guild` |
| `border/crime/superhero` | (−77.78, −187.78) | `ghost_network` |
| `border/superhero/lattice-crucible` | (77.78, −187.78) | `enforcers_movement` |
| `border/lattice-crucible/cyber` | (187.78, −77.78) | `crucible_witnesses` |
| `border/crime/sere` | (−140.41, −212.43) | `ghost_network` |

`border/crime/sere` is 58.85 m from both Presents, inside both arrive disks. `MegaworldMap.All` lists Crime before Sere, so `CountryAt` returns Crime there. The errands in this slice do not stand on that midpoint. S19 already owns the empty tariff inside Sere.

Checkpoint strings on an open border: physical checkpoint, inspection, roadside marker. Guard role strings: border guard, inspector, road watch. Legal strings: declare cargo, respect local law. No body is spawned from those strings here.

## Three blends, unplaced

| Kit | Parents | Ring-adjacent? | Named beat that already exists in the bible |
| --- | --- | --- | --- |
| `arch_ix_grid_coast` Uncounted Wharf | Cyber, Crime | no | Census drones are not supposed to count, and do. `hyb_billdrone` is allowed by the kit note. Flower Law does not apply. |
| `arch_ix_sunder_dawn` Held Crown Stair | Fantasy, Superhero | no | A Sundering ward and an Aegis may stand. `skill_steel_mercy` and `skill_steel_curse_fold` are both legal. A curse spent on a final blow fails both laws. |
| `arch_ix_crucible_foundry` Unclosed Foundry | Crucible, Crime, Frontier | Frontier–Crime is a real border; Crucible is not on that pair | `skill_craft_forge` and `skill_craft_unend` share a bay. Leaving a recipe open is the Crucible law. |

No kit has an x, z. This facet does not graybox one. `hyb_billdrone` stays S09's `enc_rotor_saddle`. Cyber cap stays 0 per S11. The foundry's creatures stay S17. The stair's creatures stay S03 and S15.

## Quests

| Id | Offer | Turn-in |
| --- | --- | --- |
| `q_s21_one_rate` | Cyber plaque (34.00, 0.00) | same plaque, after Frontier and Crucible |
| `q_s21_steel_before_the_spoke` | Frontier plaque (−34.00, 0.00) | same plaque, after (−43.50, 0.00) |
| `q_s21_open_border` | Crime plaque (−24.04, −24.04) | same plaque, after the Frontier–Crime midpoint |
| `q_s21_no_ninth_plaque` | Crucible plaque (24.04, −24.04) | same plaque, after the Sere lip (−17.71, −38.08) |

Rewards: xp only. Coin 0. Items none. Skills none. Faction deltas none. Spawn count on every board is 0.

## Combat ceiling

No boss, no mini-boss, no new mob. A player who walks a spoke's ecology while on one of these errands uses that slice's windows and does not become its finisher. Flower Law still flowers steel inside 42 m outside the Arena. Past the lip, while the clock is Hub, `Canon.SteelLive` is true. Gate guards keep the count the host already set.
