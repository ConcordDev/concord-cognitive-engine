# Volume — Aura-bindable content

This folder sits beside the native bible. It does not replace `creatures/`, `npcs/`, `weapons/`, `props/`, or `skills/`. Those catalogs stay the ids. Volume is the playable layer Aura drops into Canon and Resources: quests, raids, companions, vendor stock, density, and ride rows.

No meshes. No pack downloads. No concept sheets.

## What shipped

| File | Bind target |
| --- | --- |
| `QUESTS_BY_WORLD.json` | Canon quest lists + QuestLog. 81 complete loops, at least 8 per WorldId. |
| `QUESTS_CATALOG.md` | Human index of those loops. |
| `BOSSES_AND_RAIDS.json` | WorldBoss / delve roster. Telegraph before the circle arms. |
| `COMPANIONS.json` | Companion follow + banter flags (intro / mid / postboss). |
| `VENDORS_AND_ITEMS.json` | Item table extension + vendor slates. Standing changes price. |
| `DENSITY_TABLES.json` | Ambient fauna, CX crowds, prop budgets, 100m silhouette rule. |
| `MOUNT_AND_VEHICLE.json` | Tack, wagon, mounts, carts. Anim gaps are stated. |
| `AURA_BIND_ORDER.md` | Phase 7 paste order after art batches B0–B11. |

WorldIds match `Canon.cs`: Hub, Ruins, Tunya, Fantasy, Crime, Cyber, Frontier, Superhero, Crucible, Sere. Fantasy is the Sundering. Hub is the Unburned Court. Flower Law is 42m, Arena excepted. Pinewood Crossing keeps its name. Humanoids are CX. Quaternius is not a body.

## How Aura binds

1. Read `AURA_BIND_ORDER.md` before Phase 7 of `AURA_EVERYTHING_NO_DEFERRAL.txt`.
2. Prefer a row whose `canon_source` is set. That Canon JSON stays authoritative for voice lines. Volume adds `faction_delta`, `world_hooks`, and the accept → do → turn-in loop.
3. New quests use `q_<world>_<slug>`. Do not mint a second id for a Canon quest that already has one.
4. One fact, three surfaces: the quest's `world_hooks.board_line`, a prop or door named in `prop_or_door`, and `gossip_on_complete`. Fire them on turn-in, not on accept.
5. Raid rows arm only after board, scout, and sound have all played. Remembrance items drop only if the phase law was kept (refused the curse, did not wear the mask, did not fill the number).
6. `skill_*` ids point at `skills/SKILLS.json`. SkillLattice is still a lookup until a rank changes an ActionRunner window.
7. Missing creature mesh: spawn nothing. Do not satisfy `faun_nil_sealie` with a flamingo, or a wolf with a fox, or a person with a Quaternius body.
8. Mount and wagon rows may hitch and lead. They must not fake a seated camera.

Mirror of this folder: `Assets/Concordia/Generated/NativeBible/volume/`.
