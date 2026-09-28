# Gates and roads

Eight Hub spokes are Link gates. Sere is a waystone. Flower Law flowers steel on the Hub plaque only.

Atlas walk times use 5 km/h on Crown Roads (400 km, 4800 minutes) and 3.5 km/h on Walker Paths. Present-metre travel is the 220 m ring and is a different clock. See `MAP_MASTER.json` `authority.walk_model`.

## The eight plaques

| WorldId | Display | Angle | Bearing | Plaque on Hub, metres | Center, km | Refusal |
| --- | --- | --- | --- | --- | --- | --- |
| `Cyber` | The Grid | 0.0 rad | 0.0° | (34.0, 0.0) | (400.0, 0.0) | Refusal of Numbers |
| `Ruins` | Sovereign Ruins | 0.785398 rad | 45.0° | (24.04, 24.04) | (282.84, 282.84) | Refusal of Death |
| `Fantasy` | The Sundering | 1.570796 rad | 90.0° | (0.0, 34.0) | (0.0, 400.0) | Refusal of Hostility |
| `Tunya` | Tunya | 2.356194 rad | 135.0° | (-24.04, 24.04) | (-282.84, 282.84) | Refusal of Harvest |
| `Frontier` | The Frontier | 3.141593 rad | 180.0° | (-34.0, 0.0) | (-400.0, 0.0) | Refusal of the Dome |
| `Crime` | Iron Coast | 3.926991 rad | 225.0° | (-24.04, -24.04) | (-282.84, -282.84) | Refusal of Consequence |
| `Superhero` | Permanent Dawn | 4.712389 rad | 270.0° | (-0.0, -34.0) | (-0.0, -400.0) | Refusal of the Win |
| `Crucible` | The Crucible | 5.497787 rad | 315.0° | (24.04, -24.04) | (282.84, -282.84) | The Eighth Refusal |

Plaque radius is `Canon.RingRadius` 34 m. Every plaque is inside `HubLawRadius` 42 m. The Dawn plaque is (0, −34), which matches the culture slices. Steel on that stone is a flower. Steel on the Dawn continent is live.

## Crown Roads

One radial road per spoke, from the Hub approaches to the civilization heart. Kind `road` in `MAP_MASTER.json`. The Link is a separate `gate` link on the same pair, two minutes, plaque step.

| From | To | Kind | Atlas minutes | Note |
| --- | --- | --- | --- | --- |
| Hub | Cyber | gate | 2 | Link plaque step. |
| Hub | Cyber | road | 4800 | Crown Road, design-intent center to center 400 km at 5 km/h. |
| Hub | Ruins | gate | 2 | Link plaque step. |
| Hub | Ruins | road | 4800 | Crown Road, design-intent center to center 400 km at 5 km/h. |
| Hub | Fantasy | gate | 2 | Link plaque step. |
| Hub | Fantasy | road | 4800 | Crown Road, design-intent center to center 400 km at 5 km/h. |
| Hub | Tunya | gate | 2 | Link plaque step. |
| Hub | Tunya | road | 4800 | Crown Road, design-intent center to center 400 km at 5 km/h. |
| Hub | Frontier | gate | 2 | Link plaque step. |
| Hub | Frontier | road | 4800 | Crown Road, design-intent center to center 400 km at 5 km/h. |
| Hub | Crime | gate | 2 | Link plaque step. |
| Hub | Crime | road | 4800 | Crown Road, design-intent center to center 400 km at 5 km/h. |
| Hub | Superhero | gate | 2 | Link plaque step. |
| Hub | Superhero | road | 4800 | Crown Road, design-intent center to center 400 km at 5 km/h. |
| Hub | Crucible | gate | 2 | Link plaque step. |
| Hub | Crucible | road | 4800 | Crown Road, design-intent center to center 400 km at 5 km/h. |

## Marches, walkers, sea

| From | To | Kind | Atlas minutes |
| --- | --- | --- | --- |
| Cyber | Ruins | road | 1033 |
| Ruins | Fantasy | road | 1033 |
| Fantasy | Tunya | road | 1033 |
| Tunya | Frontier | walker | 1476 |
| Frontier | Crime | walker | 1476 |
| Crime | Superhero | road | 1033 |
| Superhero | Crucible | road | 1033 |
| Crucible | Cyber | road | 1033 |
| Tunya | Fantasy | sea | 344 |
| Crime | Superhero | sea | 258 |
| Crime | Sere | sea | 96 |
| Superhero | Sere | sea | 219 |
| Frontier | Sere | sea | 1645 |
| Crime | Sere | weak | 480 |
| Crucible | Cyber | weak | 1476 |

## Sere waystone, stated plainly

Sere is on the map. Sere is not on the ring.

- No row in `Canon.Gates`.
- `MegaworldMap.HasLinkGate(Sere)` is false.
- Center is the Crime angle plus 0.35 rad, at 1.35 times the ring radius: (−227.76 km, −489.62 km).
- The short water to the Iron Coast is about 24 km after the design-intent discs. That proximity is why a traveler looks for a door. The stone is a brand-tiled slab (`env_sere_waystone`). It has no arch and no portal.
- The weak link in the map is a scramble at 3 km/h across that strait's near ground. The sea link is the boat. Neither is a Link.
- Flower Law does not travel with the traveler. A blade that was a flower on the Hub plaque is steel again on Sere, and it was already steel on the Iron Coast.
- The Eighth Refusal stays on the Crucible. Sere does not become a ninth by standing in the ocean.
- Ark Exodus is the lore of leaving. Tunya is the other end of that old umbilical. This table does not draw a gate between them.

## Hub districts and the law

| District | Ring | Flower Law |
| --- | --- | --- |
| Inner Court | plaza | yes |
| Assembly and Archive | plaza | yes |
| Market awnings | plaza | yes |
| Ring of Doors | mid | yes, including every plaque |
| Arena sand | plaza | the disk still covers it; steel is live inside 8 m of (0, 18) |
| Warden wall | outer | no, the wall sits at 56 m |
| Pinewood salt road | outer | no |
| Three Refusals approach | outer | no |
