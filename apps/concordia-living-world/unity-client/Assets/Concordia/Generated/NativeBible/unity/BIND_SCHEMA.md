# Unity bind schema

Field contract for turning a bible row into something the living client can mount. Paths are stubs until a mesh exists. Missing mesh: do not spawn a stand-in that lies about species. `CreatureCompiler` already returns an empty stem rather than mapping wolf to fox; keep that honesty.

YAML is the shape. JSON rows in this bible use the same keys inside `unity_bind`, plus the universal sheet on the parent object.

## CreatureCompiler / EvoCatalog / EvoSpawner

```yaml
id: faun_sunder_wolf                 # faun_ | mon_ | hyb_
display_name: Sundering Wolf
taxonomy_tags: [animal, predator]
world_ids: [Fantasy]
canon_kind_alias: wolf               # null if not in Canon.WorldDef.fauna
unity_bind:
  compiler: CreatureCompiler.Compile
  card_fields:
    speciesId: faun_sunder_wolf
    topology: quadruped              # TopologyFor vocabulary
    gaitKind: quad_lope
    canon_kind_alias: wolf
  skeleton_family: quadruped
  prefab_stub: Assets/Concordia/Generated/NativeBible/Prefabs/faun_sunder_wolf.prefab
  animator_stub: AC_faun_sunder_wolf
  evo_catalog: EvoCatalog species row
  spawner: EvoSpawner biome weight
  hostile: true                      # Hostile.cs only if the row is a fighter
  mesh_policy: native_or_nothing
  gameplay_tags: [Creature.predator, Topology.quadruped]
# hybrids only:
primary_plan: "primary_body: quadruped wolf"
secondary_trait: "ash plate pauldrons"
combat_hook: lunge_ashburst
stats_hooks:
  health: table:faun_med_predator    # table name, not a fake number
  loot: [hide_wolf]
verb_ids: [verb_fauna_lope, verb_fauna_nip]
```

Boss rows add `boss_rule`. The rule is a law (refuse the curse, close the page, leave the arena), not a second combat engine. Damage still passes `HitResolver`.

## SkillLattice / ActionRunner / HitResolver

`HubObjectives.SkillLattice.Row` today: `skillType`, `group`, `tier`, `element`, `preset`, `level`, `cameraKickPx`, `potency`, `glow`, `finisher`.

Map bible → row:

| Bible | SkillLattice / combat |
| --- | --- |
| `AbilityId` | `skillType` |
| `tree` (`steel` / `presence` / `craft`) | `group` |
| `VfxCue.element` | `element` (feeds `SkillLattice.VfxPath`) |
| `ProgressionTable.ranks[n]` | `level` and magnitude |
| `VerbId` | animator trigger via `VfxCue.trigger` |
| `Cost` | stamina, poise, or focus; not a new resource type |
| `Cooldown.seconds` | seconds after recovery |
| `RequiredTags` / `BlockedByTags` | soft gates, same idea as GAS tags |
| `EffectsToApply` | effect ids, shared across skills |
| `TargetingMode` | Self, Enemy, Ally, Projectile |
| `WeaponFilter` | `CxDress.HeldWeapon` id or verb family |
| `VfxCue.startup_ms/active_ms/recovery_ms` | `ActionRunner` windows |

```yaml
AbilityId: skill_steel_ward_cut
VerbId: verb_1h_slash
Cost: { resource: stamina, value: 11 }
Cooldown: { seconds: 0.8 }
RequiredTags: [State.Alive]
BlockedByTags: [State.Stunned, State.Dead]
EffectsToApply:
  - { id: fx_slash, profile: slash }
  - { id: fx_flower_override, only_if: FlowerLaw }
TargetingMode: Enemy
WeaponFilter: [verb_1h_slash]
ProgressionTable:
  id: prog_skill_steel_ward_cut
  ranks:
    - { rank: 1, magnitude: 1.0, unlock: "weapon:..." }
VfxCue:
  element: impact
  existing_prefab: Assets/GabrielAguiarProductions/FreeQuickEffectsVol1/Prefabs/vfx_Impact_01.prefab
  trigger: Slash
  startup_ms: 90
  active_ms: 120
  recovery_ms: 200
  fight_styles: [Sword]
```

Flower Law check: if `WorldId.Hub` and distance to plaza center ≤ `Canon.HubLawRadius` (42) and the actor is not inside the Arena, steel effects swap to flower. Do not apply damage and a flower. Apply the flower.

Presence effects that name `FactionStandingBook` or `WorldEventLog` must call those types. Do not add a parallel reputation float.

Craft effects that name Fabrication, Gunsmithing, Spellcrafting, Vehicles, or Containers must hit GameplayCore. If the station prop is missing, the skill fails with the failure string already on the row.

## CharacterGear / CxDress / PersonKit

```yaml
id: npc_role_iron_warden
unity_bind:
  body: CX_Humanoid_Male or CX_Humanoid_Female
  dress: CxDress
  sockets: [CX_Head, CX_Chest, CX_Shoulder_L, CX_Shoulder_R, CX_Hip, CX_Grip_R, CX_Back]
  wardrobe:
    head: open warden helm
    chest: CX_Gear_ChestPlate gray
    legs: fauld
  weapon_id: wpn_1h_court_flower
  fight_style: Sword          # Canon.FightStyle
  animator_profile: combatant # civilian | combatant
  person_kit: PersonKit faction preferred_weapon
```

Weapon row:

```yaml
id: wpn_1h_sunder_wardblade
unity_bind:
  dress_vocab_kind: verb_1h_slash
  sockets: [CX_Grip_R]
  character_gear: CharacterGear / CxDress.HeldWeapon
  kitbag_stem: wpn_1h_sunder_wardblade
  prefab_stub: Assets/Concordia/Generated/NativeBible/Prefabs/wpn_1h_sunder_wardblade.prefab
  trail_vfx: trail_faint_green
  existing_fallback: DressVocab.Weapon until this prefab exists
```

The fallback is a placeholder mesh. HUD and inspect text should keep the bible display name, not the Kenney stem name.

## Architecture / SettlementCompiler

```yaml
id: arch_kit_hub_court
footprint:
  module_m: "4"
  wall_thickness_m: "0.4"
  min_corridor_m: "2.4"
  door_clear_m: [1.2, 2.2]
snap_intent: 4m orthogonal, pivots on inner corner
reuse_tier: high
materials: [weathered limestone, court cobble]
traversal_anchors: [lantern bracket 2.2m, quoin ledge 0.6m]
sub_kits:
  hall: [hall_1, hall_2, hall_3, hall_4, hall_end, hall_corner]
  room: [room_small, room_large]
  stair: [stair_straight]
  door: [door_standard]
  facade: [facade_bay]
  prop_clutter: [prop_court_lantern_post]
unity_bind:
  prefab_folder: Assets/Concordia/Generated/NativeBible/Kits/arch_kit_hub_court/
  settlement_compiler: SettlementCompiler module hooks
  dress_vocab_culture: court
```

## Props

```yaml
id: prop_bench_forge
stats_hooks:
  interaction: animate         # none | loot | animate | physics
  density_budget: set          # structural | clutter | set | hero
  flags:
    gameplay_core: Fabrication
```

## Tags worth keeping stable

`State.Alive` `State.Stunned` `State.Dead` `State.Attacking` `State.IFrame` `State.Parry` `State.Aiming` `State.Casting` `State.Crafting` `State.Social` `State.InCombat` `State.Counted` `State.Uncounted` `Law.Flower` `Law.DoNotReap` `Law.NoFinalWin` `Law.Unend` `Curse.Inward`

New tags go in this list before they go on a skill.
