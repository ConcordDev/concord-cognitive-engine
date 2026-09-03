# P0 — Hub + Sovereign Ruins vertical slice

Do this before Move Forge, 2B combat, or ecology evolution.

Pass when a fresh walker can:

1. Create a person (creator readable, **not magenta**).
2. Enter the Unburned Court and see the plaza.
3. Talk to the Lamplighter (line already LIVE) and get an objective check.
4. Walk the Ring; three gate names readable.
5. Train on arena sand: light attack **drops dummy HP**; off-sand flower-law.
6. Cross the Ruins gate; hold is ash/crypt, not the Court; return via THE HUB.
7. Exactly one `World` root.
8. Gateway: connected **or** honest `{ ok:false, reason:'no_gateway' }` — no fake combat success.

Playtest: same route twice, once documented as current (2026-09-01, failed presentation + miss + no socket), once after slice.

Authority: dummy HP and travel should start moving to Concord in this slice or the next — not stay Unity-invented forever.

## Playtest 2026-09-01 (after slice, not green)

Code landed this pass: HubObjectives HUD, honest `ConcordClient.StatusJson`, wider dummy hit + collider, `PurgeWorldRoots`, TextMesh unlit, Soldier.glb + `SoldierLocomotion` blend (Idle/Walk/Run clips present), adult-rig load (no Kenney `Soldier` stem), panoramic HDR preference.

Runtime this session (fresh `AppearanceStore.Clear()`, play, creator open):

| Beat | Result |
|---|---|
| World roots | **1** (`World`) |
| Gateway | `{ok:false, reason:'no_gateway'}` honest |
| Dummy | exists, hp 80 |
| Animator | `SoldierLocomotion` bound |
| Creator UI | readable |
| 3D preview | **still magenta** |
| Lamp / arena hit / Ruins | **not walked** — Editor hung after a live `UniversalRenderPipelineAsset.Create()` |

Root cause of magenta (measured, not guessed): `GraphicsSettings.currentRenderPipeline == null`. `ProjectSettings/GraphicsSettings.asset` has `m_CustomRenderPipeline: {fileID: 0}`. URP package 17.3 is installed; no pipeline **asset** is assigned, so URP Lit draws error-pink. `badMats=0` (shader *names* were Lit) was a false all-clear.

Fix in tree, not yet applied in a healthy Editor: `Assets/Concordia/Editor/ConcordiaUrpEnsure.cs` + `HubLook.EnsurePipeline()` loading `Assets/Settings/URP-Pipeline.asset`. **Restart the Unity Editor** (it is hung), let the Ensure script assign the pipeline, then re-run this walk.

Do not mark P0 done until a screenshot of the Court is not magenta and dummy HP drops.
