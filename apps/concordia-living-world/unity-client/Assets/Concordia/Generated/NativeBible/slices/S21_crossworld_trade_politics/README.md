# S21 — Cross-world trade and politics

Cross is not a `WorldId`. It is how the Hub mediates nine destinations: the eight `Canon.Gates` spokes, and Sere, which is a waystone. This folder is the tariff, the walk, and the three blend kits. It does not open a tenth continent and it does not restage a spoke's own politics.

Design authority is these files. Faction rows, country anchors, volume quests, density caps, and slices S01 through S20 stay where they are.

## Read

| File | What it is |
| --- | --- |
| `POLITICS.json` | Primary. Nine destinations, three tariff instruments, three unplaced blends, four side quests. |
| `CATALOG.md` | Gates, borders, blends, quests, and the combat ceiling at a glance. |
| `STORIES.md` | Mediation essays and the four quest backstories. |
| `AURA_BIND_NOTES.md` | What to bind, and what must spawn as nothing. |
| `SLICE_REPORT.md` | Status and gaps. |

## Pins

Flower Law is the Hub disk of 42 m. The Ring of Doors is 34 m, so every gate center sits inside the law. The wall is 56 m. Arena steel stays the disk at (0, 0, 18), radius 8 m. Pinewood Crossing stays Hub (62, −28), lettered only that way. Humanoids stay CX. A Quaternius body is not a person. Firearm verb coverage is zero, so no rifle is stood on a checkpoint.

`CrossRing.RingTariff` is 0.05. A spoke `GatePost` on the Hub clock is owned by the string `Concordant Watch`, inspection 1. A Sere destination, if a gate component is ever given one, is a waystone: tariff 0, inspection 0, owner empty. `Canon.Gates` does not list Sere, and this slice does not add the row.

The three blend kits stay unplaced: `arch_ix_grid_coast`, `arch_ix_sunder_dawn`, `arch_ix_crucible_foundry`. None of them is a `BorderDef`.

## Quests

Four errands. One rate on three Hub faces, including the Frontier plaque that has no embassy. One step past the Frontier lip, where steel is live and the clock is still Hub. One open border between Frontier and Crime, read as a border and left unbuilt as a foundry. One empty lip on the Sere bearing, where a ninth plaque is not cut.

## Scale

Present metres are `400 km × 0.55`, so a gated civilization sits at 220 m from the Hub origin. Sere sits at 1.35 times that radius, on Crime's angle plus 0.35 rad, which is the point (−125.27, −269.29). `MegaworldMap.ArriveM` is 68 m. `HasLinkGate` is false for Sere and true for the eight.
