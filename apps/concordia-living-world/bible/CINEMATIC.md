# CINEMATIC

**Status:** PARTIAL — look stack is live; cinematic completion is not  
**Authority:** Unity presentation · Concord owns combat/world facts  
**Source:** `HubLook.cs`, `ChaseCamera.cs`, `CombatFeel.cs`, `WorldVisualDirector.cs`, `ModularPerson.cs`, `CxDress.cs`, `Core/ActionRunner.cs`, `Core/HitResolver.cs`  
**Aura contract:** this file. Binding a pack is not finishing a shot.

## The bar

The reference image is a **visual-fidelity target**, not mood-board inspiration.

Do not optimize for “acceptable game graphics.” Optimize Concordia for the maximum fidelity the **active profile** can hold, using the Poly Haven library that is actually on disk and the Grok CX / Rocketbox cast that is actually bound.

A model is incomplete until materials, scale, lighting, animation, interaction, grounding, camera, and environmental integration are correct **in a running Play session**. Do not accept asset presence as visual completion. `Unity build succeeded` is not a visual checkpoint.

The goal is not to imitate the screenshot. The goal is Concordia’s own world reading as a finished high-fidelity game: high-detail environment + cinematic lighting + atmospheric depth + physically convincing materials + polished character presentation + animation/camera/VFX as one shot.

## Profiles (do not mix)

| Profile | When | Ceiling |
|---|---|---|
| **LeanPlay** | ≤16GB Mac Editor (`ConcordiaHost.LeanPlay`) | 2k PBR, thinned crowd/impostors, exponential fog. Density is cut on purpose so Play ticks. |
| **Desktop** | Full-RAM Editor / player | Same 2k library, full crowd/impostor budgets, richer volume, more dressing. |
| **WebGL** | `ConcordiaWebExport` Hub scene | HubKit StreamingAssets + glTFast. No AssetDatabase. Do not assume Poly Haven 13GB is in the browser. |

Imported Poly Haven maps are **`_2k.jpg`**. That is the physical vocabulary. 4K/8K is a later import if disk and the profile can hold it — never upsample a 2k set and call it 8K. LeanPlay and WebGL stay on 2k.

## LIVE (code, not a screenshot)

| Pillar | What actually runs |
|---|---|
| Environment | `HubLook.Pbr` resolves Poly Haven `_diffuse_2k` / `_nor_gl_2k` / `_arm_2k` via semantic aliases. Displacement files exist; they are not a live tessellation path. DressVocab / FreePacks / WorldVisualDirector dress chunks. Kenney is last fallback (`VISUAL.md`). |
| Lighting | URP + ACES + Bloom + ColorAdjustments + Vignette + WhiteBalance + FilmGrain. Trilight ambient. One reflection probe. `ApplyHour` drives sun intensity (night is moonlight, not noon-minus-UI). SSAO attempted in Editor. ExponentialSquared fog in `WorldBuilder.DressSky`. |
| Atmosphere | Fog density/color per world + weather mul in `WorldBook`. Not volumetric fog, not atmospheric scattering. |
| Character | Rocketbox Biped walk (`ModularPerson`). CX Humanoid prefabs + `CX_Grip_R/L`. CX plates are **albedo/HUD/civic**, not photogrammetry skins (`CX_MANIFEST.md`). |
| Animation | Authored gait + `CombatMotion.Pulse`. Strikes now phase through `ActionRunner` (`JustBecameActive` = Delay). Humanoid melee clips do not fit Bip01 (`ANIMATION.md`). |
| Camera | `ChaseCamera` Cinemachine orbital: shoulder offset, sprint FOV+, combat FOV−, pose damping. No deoccluder (plaza discs). `CombatFeel` shake + FOV punch after pose. |
| VFX | `CombatFeel.Burst` via `SkillLattice.VfxPath` + FreePacks prefab. Weather FX component on continent. SUIMONO imported, **not** the live water path. |
| Motion | WorldClock hour, weather string, NPC schedules, Hostile hunt, foliage only if the packed shader moves it. Standing still for ten seconds can still look frozen. |
| Physics presentation | CharacterController + dummy `Hit` knock. No foliage/door/debris reaction as a general system. |
| UI | Court parchment vs Steel HUD is the identity split (`CxDress` `CX_HUD_Court_` / `CX_HUD_Steel_`). |

`GameplayCore.CombatDefenseEvaluator` is **not** the live combat grammar. Incoming hits resolve through `HitResolver`. Cinematic animation and camera must read `ActionRunner` phases, not a second clip telegraph.

## TARGET (Aura — one integrated visual system)

Audit and raise, in Play, not in the Project window:

1. **Environment fidelity** — albedo/normal/roughness/metallic/AO as bound URP Lit; roughness variation; wet/puddle/mud/moss/dirt as **materials that exist in the library**, not decal spam; trim/detail; terrain blend; rocks/roots/debris/foliage seated in the ground; no repeated-texture wallpaper; no floating/intersecting kit; no procedural asset soup.
2. **Lighting** — sunlight + sky + indirect that actually shade normals; probes where interiors exist; shadow distance/cascades/contact; exposure; weather-dependent sun; interior/exterior transitions; emissives that bloom in the volume. Lighting does the visual work the reference depends on.
3. **Atmospheric depth** — player → foreground detail → midground architecture → mist/foliage/light → distant structure → sky. Height/depth haze, LOD that keeps silhouette, shadow distance that matches the shot. Volumetric fog only if the profile can pay for it; thicker exponential fog is not “volumetric.”
4. **Character fidelity** — the cast belongs in the light. Skin/hair/cloth/armor/weapon materials respond to the same sun. Grounding + foot/hand IK + grip sockets. Dirt/damage as state, not a second mesh. **No mannequin effect.** A CX plate on a quad next to a Biped is not “the character is in the shot.”
5. **Animation as cinema** — locomotion accel/turn/start/stop; slope/stair; weapon stance; attack anticipation/active/recovery from `ActionRunner`; parry/block/dodge/hit/stagger/knockdown/get-up; climb/vault/mount/swim/fall/land/interact. Transitions are contextual. The sword is impressive because body + camera + light + armor + environment are one shot.
6. **Cinematic camera** — shoulder, collision that does not yank off 40m plaza discs, movement/sprint/combat FOV, lock-on/target framing, lag, punch on parry/dodge/heavy from `HitResolver` outcomes. The player controls a cinematic-looking camera. Do not turn walk into a cutscene.
7. **VFX** — trails/sparks/impacts/dust/elemental/parry flash keyed to **real** hit/block/parry/kill, not canned loops. Environment: leaves, rain, mist, smoke, water, wind, vegetation. Magic: charge/cast/impact/linger from gameplay state.
8. **World motion** — after ten seconds idle the Court still breathes (foliage, cloth, weather, NPC work, distant activity, creatures). Frozen Hub is a fail.
9. **Physical response** — impact → combat result → visual reaction → event → persistent consequence (`TrainingDummy` death already stays dead on the road; foliage/doors/debris should join that grammar where the substrate exists). `SwordHitAnimation` alone is incomplete.
10. **UI** — Court parchment / Steel metal as the actual HUD material language. Contextual, uncluttered, typed, matching the world.

## Shot QA (the only visual gate)

Aura may not close a visual pass on compile. Capture or stand in Play and report these. Foot truth still beats Editor-step.

| Shot | Must show |
|---|---|
| **SHOT 01 — Court** | Player standing in the plaza. Pack architecture, Poly Haven ground, sun/ambient actually shading, Court HUD. |
| **SHOT 02 — Character** | Full-body traveler with gripped weapon. Feet on the floor. Materials in the same light as the plaza. |
| **SHOT 03 — Combat** | Parry or dodge → `HitResolver` outcome → body reaction → camera punch → VFX. One coherent beat. |
| **SHOT 04 — Sprint** | Authored run gait, camera FOV/distance, environment motion. Not the walk sine sped up. |
| **SHOT 05 — Road** | Sundering dressing, NPCs, a threat, atmosphere. Not a grey strip with a dummy. |
| **SHOT 06 — Weather** | Same place, different `WorldClock` hour or `WorldBook` weather. Lighting and fog change. |
| **SHOT 07 — Interior** | Enter a playable `BuildingInterior` room. Lighting transitions. Fake-window LOD is not this shot. |
| **SHOT 08 — NPC** | Named guest or Present person doing a daily activity, not a T-pose kit. |
| **SHOT 09 — Mount** | Seat socket, ride, turn, accel, stop, dismount — or an honest “not wired” if `CX_Seat` is bake-only. |
| **SHOT 10 — Consequence** | A kill or hail that the world keeps (dead body stays down, pack, NoticeKill, or a dressed interior that remembers). |

LeanPlay may thin SHOT 05 crowd and SHOT 08 extras. It may not replace a shot with a Project-window screenshot of an unbound prefab.

## Do not

- Start a second look stack beside `HubLook`.
- Treat GameplayCore presentation/defense as the cinematic runtime.
- Claim Poly Haven is in WebGL because it is in the Editor project.
- Paper missing volumetric with a fog-density bump named “god rays.”
- Replace Rocketbox with a primitive or a Quaternius bind that was already reverted.
- Hijack dirty `server/lib/runtime/event-bus.js` to fake world motion.
- Run a Ring tour to fill SHOT 05 while `you`/`clock` are still Hub.

Menu: **Concordia → Visual Fidelity → Dump Shot Gate** (`VisualFidelity.Dump`).
