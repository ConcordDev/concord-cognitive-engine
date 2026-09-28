# S14 — Frontier perimeter, cultures, and the Link's notice

Frontier only. Timber, salvage plate, canvas, open sky. Six people on hash pins, eight errands that stop on a public sentence, and one weekly notice on the Couriers' post. The road S13 already measured stays where it is. No second frontier. No creature pass. No second copy of the drift, the cut, or the hitch.

This folder is design authority for how the post, the camp, the cove, the ridge, the temple, and the council minutes sit on `countries.json` and on `WorldGeography.BuildPlaces`. Faction rows stay in `factions.json`. Country anchors stay in `countries.json`. Volume quests and the S13 caps stay where they are.

## Read

| File | What it is |
| --- | --- |
| `POLITICS.json` | Primary. Hash pins, four cultures, six presences, eight side quests, one Link telegraph, the ecology left at S13. |
| `CATALOG.md` | Claims, pins, quests, and the combat ceiling at a glance. |
| `STORIES.md` | Geography essay, cultures, presence backstories, the notice, quest backstories. |
| `AURA_BIND_NOTES.md` | What to bind, and what must spawn as nothing. |
| `SLICE_REPORT.md` | Status and gaps. |

## Pins

WorldId `Frontier`. Canon title The Frontier. Steel is live on country ground. The Refusal of the Dome is the line the road keeps: the road is our door. The correction in the same breath is the world's own no: no dome means no shelter. Drop the dome; wind will do the rest. Flower Law is the Hub disk of 42 m and contains the Hub-ring gate stone at (−34, 0). It does not govern a country disc. The Frontier gate sits at angle π. Pinewood Crossing stays (62, −28) on the Hub, lettered only that way.

Humanoids who have a pin in this slice stay CX. Concordia face. Plates and cloth on `CX_Head`, `CX_Chest`, `CX_Shoulder_*`, `CX_Hip`, `CX_Grip_*`, `CX_Back`. Fight style for people is Muay Thai, empty-handed on these uniques. A firearm mesh is not spawned. Zara Morn's rifle stays on her sheet. She has no pin.

Palette is open road: `#c8b070` `#efe6d4` `#4a3828`. Kit is `arch_kit_frontier_road`. Named sets `wagon_yard`, `wind_camp`, and `broken_dome_rib` stay unplaced. The drift, the pale flat, the cut, and the hitch stay S13's floors.

## Quests

Eight errands. Each one stops where the public sentence stops: seven days and a Guild that has not commented, a record that needs both signatures and a side unchosen, two log lines and no third, a constitution with no line for Lin, a seal with two captains and one name missing, a grandson sentence that is not asked in the room, a sermon page that stays on the desk, a vote postponed a third time with the family still unnamed. Mara's letter, Zara's token, Kel's sound, the hitch, the dust, the pale flag, the gate line, the rivet scout, and S13's three road quests stay the rows they already are.

## The notice

`raid_link_offschedule` is a board at the post hash, hours 21–24, one night in seven. The roster is empty. The western perimeter has no coordinate. The portal's sound stays Kel's quest.

## Scale

`countries.json` gives six claim centers. Every radius is 23 m. The circles overlap. They are claims, not borders you can walk as walls. District pins for the uniques are the runtime hash in `WorldGeography.BuildPlaces`, radius 8 m plus 2 m times the district index, on the key `settlement/concord-link-frontier/{faction_id}:{district}`. S13's floors use the placed trade-zone anchors. Those floors are not moved. Schedule rooms that are not paired to an anchor in this slice spawn nobody.
