# Concordia Native Universe Bible

Design authority for Concordia-native creatures, people, weapons, kits, props, and skills. GTA wear and Palworld silhouettes, bound to the Unity client and the Concord world laws. This folder is text. It does not ship meshes.

## Who it is for

- **Aura / art generation:** paste batches from `aura/AURA_GENERATION_BATCHES.md`. Every prompt lives in `aura/PROMPTS_INDEX.json`, keyed by stable id.
- **Unity:** bind rows through `unity/BIND_SCHEMA.md` into `CreatureCompiler`, `SkillLattice`, `CxDress` / `CharacterGear`, `EvoCatalog` / `EvoSpawner`, `FactionStandingBook`, `WorldEventLog`, and GameplayCore stations.
- **Design:** read `00_ART_DIRECTION.md` before changing a silhouette, and `01_TAXONOMY.md` before adding an id.

## Id prefixes

| Prefix | Family | File |
| --- | --- | --- |
| `faun_` | Wildlife | `creatures/ANIMALS.json` |
| `mon_` | Combat monsters and bosses | `creatures/MONSTERS.json` |
| `hyb_` | Crossbreeds | `creatures/HYBRIDS.json` |
| `npc_role_` | Visual roles | `npcs/ROLES.json` |
| `wpn_` | Weapons | `weapons/WEAPONS.json` |
| `arch_kit_` / `arch_ix_` | Architecture | `architecture/KITS.json` |
| `prop_` | Props | `props/PROPS.json` |
| `skill_` | Abilities | `skills/SKILLS.json` |

Hub guests are not new ids. They stay `Canon.HubGuests` and `Canon.Pillars`. Visual notes are `npcs/HUB_GUESTS_REDESIGN.md`.

## Laws that override art

- One megaworld. `WorldId` values are continents: Hub, Fantasy (the Sundering), Tunya, Ruins, Crime, Cyber, Frontier, Superhero, Crucible, Sere.
- Flower Law is the Hub plaza only, `Canon.HubLawRadius` = 42m. The Arena always allows steel.
- Pinewood Crossing is the salt road outside the walls. Do not letter a place Vinewood.
- Humanoids use the CX body and the Concordia face. Quaternius and Kenney meshes are not a replacement body. Clips may retarget.
- Fauna does not borrow a wrong animal (no wolf presented as a fox, no sealie presented as a flamingo). If the native mesh is missing, spawn nothing rather than a lie.
- Do not invent stats at runtime from this bible. `stats_hooks` are table names until a designer binds numbers.

## Suggested read order

1. `00_ART_DIRECTION.md`
2. `01_TAXONOMY.md`
3. The catalog markdown next to the JSON you are binding
4. `skills/VERB_MAP.md` before any new ability
5. `unity/BIND_SCHEMA.md` when the row becomes a prefab
6. `aura/AURA_GENERATION_BATCHES.md` when the row needs a picture

## Mirror

The same tree is copied under the Unity project at `Assets/Concordia/Generated/NativeBible/` so Aura and the Editor can read it as text assets. Edit the `~/.zuko/native-bible/` copy first, then mirror. Do not let Unity rewrite the JSON.
