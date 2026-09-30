# S22 — Companions, cast, banter, backstories

Cross is not a `WorldId`. It is the fact that twelve people already have homes on the spokes and stands on the Court, and that a player can walk with one of them. This folder is who they are, what they will say, and how far they will go. It does not open a party roster, a romance, or a tenth continent.

Design authority is these files. `volume/COMPANIONS.json` keeps its twelve ids and its one-line stubs. This slice replaces those stubs at bind time with per-person flags. GuestDef coordinates, npc sheets, lore, density, bosses, and slices S01 through S21 stay where they are.

## Read

| File | What it is |
| --- | --- |
| `CAST.json` | Primary. Twelve companions, four side quests, the one-walker rule. |
| `CATALOG.md` | Homes, radii, verbs, flags, and the quests at a glance. |
| `STORIES.md` | Backstories and the four errands, with the secrets left unsaid. |
| `AURA_BIND_NOTES.md` | What to bind, and which bodies must not spawn. |
| `SLICE_REPORT.md` | Status and gaps. |

## Pins

Flower Law is the Hub disk of 42 m. The Arena disk at (0, 18), radius 8 m, is the only place Gale's steel is steel. Pinewood Crossing stays Hub (62, −28), lettered only that way. Humanoids stay CX. A Quaternius body is not a person. An elf skeleton is not Thorne. Firearm verb coverage is zero, so Jax does not bring the sheet's marksmanship and Nyx does not bring an EMP.

Brackish is eleven. She scouts and gossips. She does not fight and she is not a romance. The pillars are not companions. Tunya and the Crucible do not gain a companion row.

## Party

One walker through a gate. The other stands stay occupied. Naming none is allowed. Brackish and Old Seam may share the salt road, because that road is not a gate. Vesper never leaves the stall. Esha is never instanced on the Court. Jax and Vesper are never the same party.

## Quests

Six errands. One name at the portal plaza. One walk to the milepost so the child can say the name and come back. One page that records two guests and not a pair, and refuses the reason. One framed riddle that already has all its words. One minute logged at Penanus and not reported. One braid counted, with no bead taken.

## Scale

Gate centers stay `34 * (cos θ, sin θ)`. This slice adds no present, no lip, and no border. The only coordinates it walks are GuestDef stands already in `Canon.cs`, Pinewood Crossing, and the rooms the sheets already name. `hub_portal_plaza` and `fantasy_bog_clearing` still have no metre. None is invented here.
