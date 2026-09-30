# Catalog — S02 Hub politics

Ten side quests. Two civic presences. One witness press. One intrusion that flowers and leaves. One shoulder scuffle. Zero court bosses.

## Compact seats

These five rows already exist in `concordia-hub/factions.json`. Embassy politics are guests, not extra rows.

| id | Name | Leader | Guest face in the plaza |
| --- | --- | --- | --- |
| `concordant_assembly` | Concordant Assembly | Mira Lattice | None. She is not a HubGuest. Her silence on the southern arc stays unresolved. |
| `concordant_curators` | Concordant Curators | Asbir Thelane (`asbir`) | Maren files what she sees. |
| `concordant_watch` | Concordant Watch | Ren Solare | Gale (`warden`) is the sand, not the captain. |
| `bazaar_consortium` | Bazaar Consortium | Velka Ironhand | Vesper feeds and debts. She is not the Consortium master. |
| `refusal_keep` | Refusal Keep | Nesha Keep | Lyra keeps the second hour and does not teach a ninth. |

Lore tags with no Hub faction row: the three pillars, Crimson Court, Grid authority, Delgado Syndicate, Anti-Sovereign, Luminary, frontier freenodes, shadow network, Verdant Veil. They bind to guests, plaques, or the pillars. No new id is minted.

## Rings

| id | Meters | Law |
| --- | --- | --- |
| Unpaved court | 0–16 | Flower. Pillars and the Founding Day reading. |
| Embassy approaches | 16–34 | Flower, except the Arena disk. |
| Ring of Doors | 34 | Eight gate centers, still inside the law. |
| Law lip | 34–42 | Flower. Mama stops at 42 on the Crime spoke. |
| Arena | 8 around (0, 0, 18) | Steel. Gale. No new duel. |
| Wall shoulder | 42–56 | Live steel. Watch patrol. |

Pinewood Crossing (62, −28), Broken Spire (8, 78), Upper Grove (−70, 36), and Three Refusals Tavern (−48, −58) stay Hub approaches from `cities.json`.

## Gates (ring radius 34)

| Short | World | xz | Law lip at 42 m |
| --- | --- | --- | --- |
| CYBER | Grid | (34, 0) | (42, 0) |
| RUINS | Sovereign Ruins | (24.04, 24.04) | (29.7, 29.7) |
| SUNDERING | The Sundering | (0, 34) | (0, 42) |
| TUNYA | Tunya | (−24.04, 24.04) | (−29.7, 29.7) |
| FRONTIER | The Frontier | (−34, 0) | (−42, 0) |
| CRIME | Crime World | (−24.04, −24.04) | (−29.7, −29.7) |
| DAWN | Permanent Dawn | (0, −34) | (0, −42) |
| CRUCIBLE | The Crucible | (24.04, −24.04) | (29.7, −29.7) |

## Side quests

| id | Giver | Turn-in | Stays beside |
| --- | --- | --- | --- |
| `q_hub_two_streets` | Elias Voss | Elias | Sealed genealogy, Seraphine's fan |
| `q_hub_fan_closed` | Lady Seraphine Voss | Seraphine | Elias's walk, the vault |
| `q_hub_eight_cords` | Jax Rivera | Jax | Pinewood milepost |
| `q_hub_law_lip_rose` | Mama Iron Rose | Mama | Gale's urn quest |
| `q_hub_slate_at_grid_gate` | Nyx Torres | Nyx | Moth count, Jax's circuit |
| `q_hub_three_distances` | Concord | Concord | Founding Day reading |
| `q_hub_two_books` | Vesper Kane | Vesper | Brackish's loaf |
| `q_hub_held_inward` | Thorne Blackroot | Thorne | Seraphine's fan, Upper Grove unstocked |
| `q_hub_no_ninth_line` | Lyra Silentchant | Lyra | Lamp round, Nesha's gap |
| `q_hub_blank_count` | Kael Nakamura | Zero | Nyx's slate. Handing him the slate fails both. |

## Presences

| id | Role | Cap | Where |
| --- | --- | --- | --- |
| `presence_watch_shoulder` | `npc_role_iron_warden` | 6 | 42–56 m. Flower if they step inside the disk, off the sand. |
| `presence_court_stall` | `npc_role_court_merchant` | 4 | Inside 42 m, off the sand, off the pillar triangle. |
| `enc_hub_count_fails` | `npc_role_grid_officer` | 1, only during Nyx's quest | One step from the Grid plaque. Pulseblade becomes a flower. No health bar. |
| `mob_hub_courtesy_press` | 3 merchants, 2 laborers | 5, only during Seraphine's objection | Witnesses. No health, no loot. They disperse when the fan stays shut. |
| `mb_hub_unsigned_courier` | `npc_role_shadow_courier` | 1, Frontier shoulder at (−46, 0) | Hail first. A scuffle only if attacked outside 42 m. Inside the disk the throw becomes a flower and they walk back. |

## Uncounted Wharf

Kit `arch_ix_grid_coast`. Worlds Cyber and Crime. No Hub xz. Flower Law does not apply there. This slice does not spawn `hyb_billdrone` or a wharf crew. Nyx names the place once.

## Bosses

No court boss. The Year 38 tide stays the ground. The Unsigned Cord is a shoulder scuffle at 46 m on the Frontier spoke, where steel is already legal, and it prefers to be refused.
