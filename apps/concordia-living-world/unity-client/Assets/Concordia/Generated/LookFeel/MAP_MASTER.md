# Concordia megaworld atlas

One plane. The Hub is the origin. Eight civilizations sit on the Canon Ring. Sere stands off that ring, across the Exodus Ocean, with a waystone and no Link.

Numbers come from `MegaworldMap` unless a line says **design-intent**.

| Constant | Value | Source |
| --- | --- | --- |
| Civilization ring | 400 km | `MegaworldMap.CivilizationRadiusKm` |
| Present scale | 0.55 m per km | `PresentMetersPerKm` |
| Present ring | 220 m | 400 × 0.55. This is why a player can walk the picture. |
| Sere center | 540 km on Crime's angle + 0.35 rad | `RingMeters * 1.35`, `FieldAngle(Crime) + 0.35` |
| Hub court / metro | 12 km / 40 km | `HubCourtKm`, `HubMetroKm` |
| Spoke disc | 110 km radius | **design-intent**, so neighboring centers 306.1 km apart leave an 86.1 km march |
| Sere disc | 80 km radius | **design-intent**. Crime–Sere water gap is about 24 km |
| Flower Law | 42 m | `Canon.HubLawRadius`. A Hub-local metre. Not a kilometre. |

Axes: +x is east, gate angle 0, the Grid. +z is north, gate angle π/2, the Sundering. Angles match `Canon.Gates`.

## Hub heart

Local metres, not kilometres.

- Inner court 16 m. Concordia at (0, −6.4), Concord at (0, 6.2), the Sovereign at (8.6, 0.3).
- Ring of Doors 34 m. All eight plaques. Inside the flower disk, so steel on a plaque is a flower.
- Flower Law 42 m. Arena at (0, 18), steel inside 8 m, is the exception on the sand.
- Wall 56 m.
- Pinewood Crossing (62, −28), about 68 m out, outside the wall. The salt road. The only lettering is that name.
- Three Refusals Tavern (−48, −58), on the Crown Road approach, outside the law.
- Spawn (11.2, −12). The Sundering lane is a streamed-present stride, not a kilometre measurement.

Beyond the 40 km metro, **design-intent** approaches run to about 80 km. Crown Roads start there and run to each ring center, 400 km, atlas walk about 4800 minutes at 5 km/h. The Link on the plaque is a two-minute step. Both exist. The road is the ground under the step.

## Canon Ring

Clockwise from east, the order of `Canon.Gates`:

1. Cyber, the Grid, east.
2. Ruins, Sovereign Ruins, northeast.
3. Fantasy, the Sundering, north.
4. Tunya, northwest.
5. Frontier, west.
6. Crime, the Iron Coast, southwest.
7. Superhero, the Permanent Dawn, south.
8. Crucible, southeast, then back to the Grid.

Each heart is a 110 km **design-intent** disc. The open ground between discs is the march, 86.1 km. Walker Paths take the two marches that touch the Frontier (Tunya–Frontier and Frontier–Iron Coast) at 3.5 km/h. The other six marches are Canon Ring roads at 5 km/h.

## Inner Veil Sea

The annulus and the marches are not all dry. Where a coast exists, the same gap is water.

- Tunya's Fluxom side to the Sundering salt coast: an Inner Veil shoal, coastal speed.
- Iron Coast to the Permanent Dawn: a river and harbor lane, barge speed.

Crown Roads are the dry spokes through that same annulus. They are not a second ocean.

## Exodus Ocean and Sere

Sere's center is (−227.76 km, −489.62 km), bearing about 245°, 540 km from the Hub. It has no `gate_hub_spoke`. `MegaworldMap.HasLinkGate` is false for Sere.

The Exodus is the basin outside the ring on the southwest-to-south arc.

- Short strait, Crime disc edge to Sere disc edge: about 24 km. This is the nearest honest crossing and the waystone's water.
- Dawn to Sere: a longer coastal leg.
- Frontier to Sere: the long ocean, hundreds of kilometres of water.

The waystone is a slab on Sere's Crime-facing coast. It does not open a door, does not add a ninth Refusal, and does not flower a blade. Ark Exodus is the historical departure in the lore, the bridge the unbound built when the ledger could not be rooted. It is not a ninth spoke on this map.

## Blends

Three glue places, not worlds. Their kilometres are unsurveyed; they sit on marches.

- Uncounted Wharf, `arch_ix_grid_coast`, Crime–Grid.
- Held Crown Stair, `arch_ix_sunder_dawn`, Sundering granite under Dawn marble.
- Unclosed Foundry, `arch_ix_crucible_foundry`, on the Crucible edge toward Coast brass and Frontier scrap.

## What this atlas will not move

`countries.json` claim circles of about 18–28 local metres overlap. They stay claims. This file does not promote them into the 110 km discs. Encounter anchors that the slices left unplaced, including the Frontier's "one mile past the frontier gate," stay unplaced.

## Bind

`WorldVisualDirector` may read `palette_ref` and `softenter_landmarks`. `WorldGeography` keeps local claims. `ContinentStream` still places Present points with `MegaworldMap.Present`. `SoftEnter` is arrival, not a new coordinate system. Gate rows in `GATE_AND_ROAD_TABLE.md` are the spoke contract.
