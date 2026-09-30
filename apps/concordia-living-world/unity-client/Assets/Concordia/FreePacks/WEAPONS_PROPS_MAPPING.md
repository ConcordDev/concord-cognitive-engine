# Weapons + Props donor mapping (2026-09-23)

`pull_gaps.sh`'s own manifest never covered weapons or props (its
`content_gaps_covered` list has no such key). `pull_weapons_props.sh` fills
that gap with 3 CC0 Quaternius packs, mirrored on OpenGameArt (same
direct-file pattern `pull_gaps.sh` already uses — no itch.io claim-flow
needed). Attribution added to `../Models/ATTRIBUTION.md`.

**These are generic donor meshes, not bespoke Concordia silhouettes.** They
are the same tier of asset as the existing Kenney/KayKit packs already used
elsewhere in this project (reskin/rename/retexture candidates) — NOT a
replacement for a native-bible bespoke asset where one exists or gets Meshy'd
later. Use these to unblock B8/B10 now; swap to a bespoke Meshy generation if
budget allows and the silhouette matters (e.g. `wpn_1h_court_flower` is
canon-important — Court vs Steel is a core identity split per `CxDress.md` —
consider a real Meshy pass on that one specifically before shipping).

## B8 weapons (31 bespoke ids) → `FreePacks/Weapons/Quaternius_Medieval_Weapons/`

| bespoke id | verb tag | donor .obj | note |
|---|---|---|---|
| wpn_1h_court_flower | 1h_slash | `Sword_Golden.obj` | Flower/steel two-state — re-skin, don't reuse mesh as-is |
| wpn_1h_sunder_wardblade | 1h_slash | `Sword.obj` or `Sword_2.obj` | |
| wpn_1h_coast_switchknife | 1h_slash | `Dagger_2.obj` | |
| wpn_1h_grid_pulseblade | 1h_slash | `Sword_2.obj` | needs emissive edge material for "pulse" read |
| wpn_1h_frontier_skinner | 1h_slash | `Dagger.obj` | |
| wpn_2h_warden_estoc | 2h_heavy | `Claymore.obj` or `Sword_Big.obj` | |
| wpn_2h_ruins_unburial | 2h_heavy | `Sword_Big.obj` | relic/ash finish |
| wpn_2h_dawn_shockmaul | 2h_heavy | `Hammer_Double.obj` | |
| wpn_2h_frontier_wagoniron | 2h_heavy | `Hammer_Small.obj` | salvage/improvised finish |
| wpn_pole_tunya_reed | polearm_thrust | `Spear.obj` | wood finish |
| wpn_pole_sunder_glaive | polearm_sweep | `Scythe.obj` | closest sweep-shape donor |
| wpn_pole_grid_countpike | polearm_thrust | `Spear.obj` | pulse finish |
| wpn_pole_sere_fork | polearm_thrust | `Spear.obj` | iron/fork finish |
| wpn_bow_pinewood | bow_release | `Bow_Wooden.obj` | |
| wpn_bow_frontier_wind | bow_release | `Bow_Wooden2.obj` | |
| wpn_bow_veil_pollen | bow_release | `Bow_Golden.obj` | |
| wpn_bow_grid_rail | bow_release | `Bow_Evil.obj` | needs a straighter/tech-panel reskin |
| wpn_throw_court_lantern | thrown | — | GAP: no direct donor, use a Props MegaKit lantern as the thrown object |
| wpn_throw_coast_invoice | thrown | — | GAP: needs a bespoke small weighted-tag prop |
| wpn_throw_crucible_shard | thrown | — | GAP: candidate from Modular Sci-Fi crystal/shard prop if one exists, else Meshy |
| wpn_throw_sere_marktile | thrown | — | GAP: use a Props MegaKit tile/brick if available, else Meshy |
| wpn_focus_lyra_staff | cast_release | — | **GAP: no staff/wand/orb donor landed in any of the 3 packs** — highest-priority remaining Meshy target |
| wpn_focus_sunder_cursefold | cast_release | — | same gap |
| wpn_focus_crucible_unend | cast_loop | — | same gap |
| wpn_focus_dawn_mercy | cast_release | — | same gap |
| wpn_focus_ruins_stylus | cast_release | — | same gap (closest thing: a `Scroll`/`Book` prop from Props MegaKit as a stand-in, not a real match) |
| wpn_imp_forge_hammer | improvised_swing | `Hammer_Small.obj` | |
| wpn_imp_dock_hook | improvised_swing | — | GAP: check Props MegaKit for a hook/gaff shape |
| wpn_imp_grove_knife | improvised_swing | `Dagger.obj` | |
| wpn_imp_grid_cable | improvised_swing | `Props/.../Prop_Cable_1.fbx` (sci-fi kit) | reskin as a whip |
| wpn_imp_frontier_spade | improvised_swing | — | GAP: no spade/shovel donor landed |

**Coverage: ~20 of 31 have a reasonable donor. 5 `wpn_focus_*` (staff/wand/orb
family) are a clean gap — none of the 3 packs include a magic focus item.**
That's the single highest-value target for the next Meshy credit top-up
(5 assets, same "focus" archetype, could share one base rig).

## B10 props (40 bespoke ids) → `FreePacks/Props/Quaternius_Fantasy_Props_MegaKit_Standard/`

Strong direct or near-direct matches:

| bespoke id | donor .fbx |
|---|---|
| prop_court_lantern_post | `Lantern_Wall.fbx` (re-mount as a post, not wall-hung) |
| prop_flower_law_urn | `Vase_2.fbx` / `Vase_4.fbx` |
| prop_archive_lectern | `BookStand.fbx` |
| prop_arena_rack | `WeaponStand.fbx` / `Peg_Rack.fbx` |
| prop_market_crate | `Crate_Wooden.fbx` |
| prop_notebook | `Book_Simplified_Single.fbx` |
| prop_satchel | `Bag.fbx` / `Pouch_Large.fbx` |
| prop_wagon | `Stall_Cart_Empty.fbx` |
| prop_canteen | `Bottle_1.fbx` / `SmallBottle.fbx` |
| prop_dock_crate | `Crate_Metal.fbx` |
| prop_basket | check pack for a basket; else `FarmCrate_*` as stand-in |
| prop_bread | not in this pack — GAP, check Kenney Food pack (already in project per ATTRIBUTION.md) |
| prop_bench_forge | `Workbench.fbx` / `Workbench_Drawers.fbx` |
| prop_gunsmith_vise | `Anvil.fbx` (closest — no literal vise) |
| prop_furnace_bellows | not in this pack — GAP |
| prop_flower_wreath | not in this pack — GAP |
| prop_scale_pan / prop_scale_wood | not in this pack — GAP, check Kenney Furniture/Market |

Grid-world props → `FreePacks/Props/Quaternius_Modular_SciFi_MegaKit_Standard/`:

| bespoke id | donor .fbx |
|---|---|
| prop_cable_coil | `Props/Prop_Cable_1.fbx`, `Props/Prop_Cable_3.fbx` |
| prop_junction_box | `Props/Prop_Clamp.fbx` (closest) or a `Walls/TopCables_*` junction piece |
| prop_solar_tile | check `Floors/` subfolder for a flat panel tile |

Everything else in B10 not listed above either needs a look through the
remaining ~94 Fantasy Props filenames (not all enumerated here — browse
`Props/Quaternius_Fantasy_Props_MegaKit_Standard/.../Exports/FBX/`) or is a
real content gap worth a Meshy pass later (bellows, wreath, scales, bread —
bread should just come from the Kenney Food pack already in this project).

## Also landed, not yet mapped

The Modular Sci-Fi kit has 378 pieces total (walls, floors, doors, lights,
consoles) — far more than the handful of B10 grid props need. Useful beyond
this list for dressing `arch_kit_cyber_grid` (B9, out of Meshy scope, in
scope for this kit) if/when that architecture pass happens.

## Not attempted

KayKit has its own "Fantasy Weapons Bits" pack (CC0, 25+ models, itch.io) in
the same hand-painted style as the KayKit packs already in this project
(`FreePacks/Kaykit/` or `Models/Kaykit/` — check both). No OpenGameArt mirror
was found for it, and itch.io's claim-flow isn't reliably curl-able without a
signed-in session (same reason the existing `ATTRIBUTION.md` already flags
Unity Asset Store packs as "cannot be scraped"). If the Quaternius weapon
style clashes visually with the existing KayKit-flavored kit pieces, this is
the next thing to grab by hand: https://kaylousberg.itch.io/fantasy-weapons-bits
