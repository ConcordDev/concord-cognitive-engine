# S10 — Iron Coast politics, culture, side quests, vendors

Crime only. Rain, sodium light, the bill. Seven crews on the circles `countries.json` already measured, eight errands that stop at a public fact, one stall the volume already stocked. No second coast. No creature pass. No second copy of the warehouse shift.

This folder is design authority for how the estate, the precinct house, the walkup, the block, the two separated desks, and the gap sit on those points. Faction rows stay in `factions.json`. Country anchors stay in `countries.json`. Volume quests and the S09 caps stay where they are.

## Read

| File | What it is |
| --- | --- |
| `POLITICS.json` | Primary. Hash pins, four cultures, three vendor readings, seven presences, eight side quests, the street ecology left at S09. |
| `CATALOG.md` | Claims, pins, quests, and the combat ceiling at a glance. |
| `STORIES.md` | Geography essay, cultures, vendor backstories, quest backstories. |
| `AURA_BIND_NOTES.md` | What to bind, and what must spawn as nothing. |
| `SLICE_REPORT.md` | Status and gaps. |

## Pins

WorldId `Crime`. Canon title Crime World. Display name Iron Coast. Steel is live. The Refusal of Consequence is the lie the coast tells: what we do will not catch up to us. The correction is the same breath: delay is not cancellation. The bill always arrives. Witnesses remember. Flower Law is the Hub disk of 42 m and does not govern this coast. The Crime gate sits at 5π/4. Pinewood Crossing stays (62, −28) on the Hub, lettered only that way.

Humanoids stay CX. Concordia face. Plates and cloth on `CX_Head`, `CX_Chest`, `CX_Shoulder_*`, `CX_Hip`, `CX_Grip_*`, `CX_Back`. Fight style for people is Wing Chun, empty-handed on these uniques. A hook and a folded switchknife stay S09's tools. A firearm mesh is not spawned. Mama's shotgun stays on her sheet.

Palette is coast grit: `#3a342c` `#8a6a48` `#c8a060` `#5c3038`. Kit is `arch_kit_crime_coast`. Named sets `tenement`, `armored_warehouse`, `foundry_steam`, and `wharf` stay unplaced.

## Quests

Eight errands. Each one stops where the public sentence stops: seven minutes and no transcript, a skim counted as three with no names, a precinct motto without a flipped lieutenant, two doors 9.49 m apart, a tip source that stays the word unknown, a ledger Iris has not decided, a pitch a nephew already refused, a gap between the placed docks and the south block with the slate still at one. The Thorpe chain, Dahlia's folder, Ada's cause, the rose-pin errand, and S09's three mob quests stay the rows they already are.

## Scale

`countries.json` gives seven claim centers. Radii are 23 m except Iron Rose at 28 m and Hexshore at 25.5 m. The circles overlap. They are claims, not city blocks you can walk as borders. District pins in this file are the runtime hash in `WorldGeography.BuildPlaces`, radius 8 m plus 2 m times the district index. S09's warehouse at (10.72, 32.9) and the gap midpoint at (8.09, −2.55) used a fixed 10 m step. Those floors are not moved. Schedule rooms that are not paired to an anchor in this slice spawn nobody.
