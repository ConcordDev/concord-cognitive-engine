# Concordia Nonstop — Progress Log

Append-only. One line per task: `<ISO time> | <ID> | PASS/BLOCKED | <one line> | <hash> | <evidence path>`

## Baseline — B-01 (2026-10-23 session open)

- **Unity project:** `/Users/dutch/concord/aura-wt/apps/concordia-living-world/unity-client` ✅ inside `~/concord/aura-wt`
- **Worktree:** `/Users/dutch/concord/aura-wt`
- **Branch:** `aura/gameplay` ✅ (never switched, never created)
- **Free disk** (`df -h /System/Volumes/Data`): **11 GiB** available (184 Gi used, 95%) — above the 10 GB floor, but tight. Avoid mass imports, bakes and full reimports this session.
- **Live tree** `/Users/dutch/concord vs code/concord-cognitive-engine`: NOT touched.

### Dirty-at-open snapshot (`git -C ~/concord/aura-wt status --porcelain`)

Pre-existing, **off-limits** — never staged by Aura:

```
 M apps/concordia-living-world/unity-client/Assets/UniversalRenderPipelineGlobalSettings.asset
?? apps/concordia-living-world/unity-client/Assets/Concordia/Animations.meta
?? apps/concordia-living-world/unity-client/Assets/Concordia/Animations/
?? apps/concordia-living-world/unity-client/Assets/StreamingAssets/HubKit/meshy.meta
?? apps/concordia-living-world/unity-client/Assets/StreamingAssets/HubKit/organic.meta
?? apps/concordia-living-world/unity-client/Assets/StreamingAssets/HubKit/tripo.meta
?? apps/concordia-living-world/unity-client/ProjectSettings/ProjectAuditorSettings.asset
```

Aura-owned at open (committed as part of B-01):

```
?? apps/concordia-living-world/unity-client/.Aura/ROADMAP.md
?? apps/concordia-living-world/unity-client/.Aura/Skills/concordia-nonstop/
```

## Log

2026-10-23 | B-01 | PASS | worktree + branch verified (`aura/gameplay`), disk 11 GiB, baseline dirty snapshot recorded, roadmap + skill committed | pending | — (log only)
2026-10-24T09:00-04:00 | B-03 | PASS | baseline Play (fresh boot, `phase=crowd` settled): fps 4.1 · transforms 11235 · WorldBuilder children 4 · hero=True heroMeshes=1 · errors 0 · warnings 0 · lean=True · pos (11.2, 0.1, -12.0) · shot 2560×1410 | b0306cf32 | ~/.zuko/aura-shots/B-03.png

2026-10-24T09:28-04:00 | B-04 | PASS | `AuraVerify` (`Pass`/`Fail`/`Snapshot`) + F10 dev driver: live line `world=Hub pos=(11.2,0.1,-12.0) hp=100 stamina=100 poise=15 client=connected(unknown) quests=0 gear=none items=0`; driver alive (`drivers=1`, `simKeysObjects=1`); F10 action proven via `KeyDriver.Trigger()` (OS key injection cannot reach Unity, so the literal `Input.GetKeyDown` read is unverified by machine) | d28c7f5e6 | Unity console `[AuraVerify] SNAPSHOT …` (no PNG)

2026-10-24T09:45-04:00 | B-05 | PASS | `ConcordiaSettings` (PlayerPrefs) + SETTINGS tab on the I-menu: two-session persistence proven — session 1 `reducedMotion=False` → set True (`storedReducedMotion=1`) → session 2 `reducedMotion=True`, then restored to False | f0638d885 | ~/.zuko/aura-shots/B-05.png

2026-10-24T10:45-04:00 | B-06 | PASS | `ConcordiaControls.inputactions` (21 actions / 42 bindings) + `ConcordiaInput` wrapper routed through `ConcordiaPlayer.KeyDown/KeyHeld/MouseDown/MoveAxes`; 20/20 actions fire from queued Keyboard/Mouse device events | 9009ffd51 | ~/.zuko/aura-shots/B-06.png

2026-10-24T11:02-04:00 | B-07 | PASS | Rebindable controls + CONTROLS tab: `PerformInteractiveRebinding` moved dodge X→V, override persisted, next Play session read `V=True X=False`, then reset to shipped binds | 8bb0e9631 | ~/.zuko/aura-shots/B-07.png

2026-10-24T11:10-04:00 | B-08 | PASS | `.Aura/LIVE_PATH.md` — boot phase order, install/skip table, 56 live component types with owner scripts, combat grammar, baseline numbers | eadddf9aa | .Aura/LIVE_PATH.md

2026-10-24T11:28-04:00 | B-09 | BLOCKED | Staged Concord connect cannot be verified: `DressHeroAfterHub` never reaches its tail in LeanPlay (no `complete` log after 9 min), and `ConcordClient.Start` already handshakes itself after Hub staged | e2b85edb3 | .Aura/ROADMAP.md
2026-10-24T15:47-04:00 | F-01 | PASS | `[AuraVerify] F-01 PASS hero=m002_hipoly_81_bones_opacity human=True avatarValid=True controller=ConcordiaLocomotion clipsFit=True animatorEnabled=True prefab=none findings=none verbs:clean`, captured on the hero the production boot dressed (no forced bind). Unblocked by fixing the boot: boot coroutines now start from `Update` (`KickBootCoroutines`) and `Update` re-kicks them after a play-mode domain reload (`s_domainAlive` watchdog) — `DressHeroAfterHub complete` now fires, 208 s after kick at ~1 fps. Mid-play reload cause (`[ScriptCompilation] … Define symbols changed` → `Domain Reload Profiling: 22324ms`) identified and survived, not isolated | 3e53936cc | Unity console `[AuraVerify] F-01 PASS …` (no PNG)

2026-10-24T16:18-04:00 | B-09 | PASS(functional) | Staged Concord connect in LeanPlay: `ConcordClient.LeanAutoConnect` (static, default **false**) + early return in its `Update` retry loop hold the socket shut for the whole boot window; `ConcordiaGame.StagedConnect` waits 30 s idle after `DressHeroAfterHub complete`, flips the gate, `EnsureConnected` bounded to 10 s. Live-server evidence: `account-done t=125.7 connected=False` → `complete` → `staged connect (t=219.7)` → `WS full handshake` → `[AuraVerify] B-09 connected=True timedOut=False status={"ok":true,"reason":"lean_connected"}`, real `kingdom:data` (`world="The Unburned Court"`, `staple=lanterns`). No `WS full handshake` anywhere before the staged-connect line. **Frame gate NOT met** (`maxMs=949.9 over100ms=24/25`) — unreachable at the B-03 baseline of 4.1 fps; P-* owns it. 784f1e905

2026-10-25T14:20-04:00 | QA-0 | PASS | Baseline regression vs B-03 on a fresh production boot (LeanPlay, live server): `DressHeroAfterHub complete` → `staged connect (t=118.1)` → `WS full handshake` → `[AuraVerify] B-09 connected=True`. Errors **0** (baseline 0; the once-per-entry `ContentBindVolumeCatalog.cs:402` exception did not fire). Hero dressed at `(11.20, 0.12, -12.00)` = documented `(11.2, 0.1, -12.0)`, 1 enabled SkinnedMeshRenderer. SHOT 01 graded numerically vs `B-03.png`: near-black pixels 56.3% → 3.8%, mean luminance 25.6 → 33.3, highlight clipping 0.0% → 0.1%, hero in frame on the real `ChaseCam` (fov 46, euler X +4.6°, viewport 0.49/0.40, 6.1 m). Frame budget improved but still outside the B-09 gate (boot `maxMs=12502.7 over100ms=176/231`; after connect `maxMs=399.7 over100ms=27/27`) — P-* owns it | — (log only) | ~/.zuko/aura-shots/QA-0-shot01.png

2026-10-25T14:28-04:00 | F-02 | PASS | Hero runs `ConcordiaLocomotion` on UAL1 clips instead of the procedural sine gait — already implemented, verified live, no code change. Hero `Person/AuthoredPerson` `_clipsFit=True _authored=True`, Animator layer weight **1.00**, `Idle_Loop` at rest; drove real W via `InputSystem.QueueStateEvent`+`Update`, hero walked z −12.00 → +14.03, `Speed=4.226` **`Jog_Fwd_Loop`**, `Bip01 R UpperArm` euler `(345.7,64.1,20.3) → (325.3,85.3,343.8)` — clip-posed, no T-pose. Sine fallback intact for non-human rigs | — (log only) | ~/.zuko/aura-shots/F-02.png

2026-10-25T14:49-04:00 | F-03 | PASS | `ConcordiaLocomotion` rebuilt into one 1D BlendTree on `Speed` (`Idle_Loop 0.00 / Walk_Loop 5.20 / Jog_Fwd_Loop 6.65 / Sprint_Loop 8.10`, jog = 5.2–8.1 midpoint); the four discrete states (thresholds 0.35/3.2/6.2) are gone and all five return transitions kept. Sweep logged 0.00→Idle 1.000 · 2.60→Idle .500/Walk .500 · 5.20→Walk 1.000 · 5.92→Walk .503/Jog .497 · 6.65→Jog 1.000 · 7.37→Jog .503/Sprint .497 · 8.10→Sprint 1.000. Live walk `vel 5.611` → `Walk_Loop .717 / Jog_Fwd_Loop .283`; live sprint `vel 8.630` → `Sprint_Loop 1.000`, `inTransition=False`, grounded=True. `errors=0`, `[AuraVerify] F-03 PASS` in console | `Assets/Concordia/Resources/Concordia/ConcordiaLocomotion.controller` | ~/.zuko/aura-shots/F-03.png

2026-10-25T15:10-04:00 | F-04 | PASS | No turn clips exist in any pack, so the turn read is procedural: new `Scripts/Aura/LocomotionPolish.cs` (`[DefaultExecutionOrder(200)]`) applies an upper-body yaw lag above the Animator's pose — `clamp(-rootYawVelocity * 0.055 s, ±38°)` exp-smoothed over 0.09 s, split 0.4 `Bip01 Spine` / 0.6 `Bip01 Spine2`. Feet cannot pop because the overlay sits above the pelvis. Live 180° pivot via `ConcordiaPlayer.WalkBearing` at `timeScale` 0.005: `_lag` **0.00 off vs 23.45° on** (predicted 22.7°), back to 0.00 after the turn. Decel: `Speed 3.020` → `Idle .419/Walk .581` mid-ramp → `Speed 0.000`, `Idle_Loop 1.000`, `Walk_Loop 0.000` — no snap, no latch. `errors=0` | `Assets/Concordia/Scripts/Aura/LocomotionPolish.cs`, `Assets/Concordia/Resources/Concordia/ConcordiaLocomotion.controller` (unchanged) | `~/.zuko/aura-shots/F-04-before.png` (`turnLag` off, yaw 202.4) · `F-04-after.png` (`turnLag` on, yaw 237.0, lag 23.45), both 2560×1504

### F-02 notes

- **The roadmap controller path is wrong.** `ModularPerson.LoadLocomotion()` does `Resources.Load("Concordia/ConcordiaLocomotion")` first, and `AssetDatabase.GetAssetPath` on the live hero `Animator` returns `Assets/Concordia/Resources/Concordia/ConcordiaLocomotion.controller`. The `Anim/ConcordiaLocomotion.controller` copy has drifted (433 diff lines, different AnyState transitions), so editing `Anim/` alone changes nothing at runtime. Edit the Resources copy; the `Anim/` duplicate is a candidate for deletion.
- **`m_DefaultWeight: 0` is a decoy.** Every `.controller` in the project reports `m_DefaultWeight: 0` — including the third-party KinematicCharacterController Ethan controller that visibly animates — while the live `Animator.GetLayerWeight(0)` is `1.00`. Do not use it to diagnose a muted layer.
- **Driving the hero without a helper script:** `InputSystem.QueueStateEvent` is generic with signature `(InputDevice device, TState state, Double time)` — 3 params, not 2. From `execute_code` (no compile-time Input System reference) resolve `UnityEngine.InputSystem.InputSystem, Unity.InputSystem` by reflection, build a `KeyboardState` with `Activator.CreateInstance(ksType, new object[]{ keyArray })`, invoke the generic via `MakeGenericMethod(ksType)`, then `InputSystem.Update()`. The queued key **stays held** across frames, so a second `execute_code` call a few seconds later sees the walk (hero travelled 26 m). Release by queueing an empty `Key[]`.
- **Loose end for F-05:** `Animator.GetBool("Grounded")` read `False` while the hero stood still on the plaza floor. `ConcordiaPlayer` feeds `cc.isGrounded`, so the probe may be sampling before the `CharacterController` settles. Harmless now (no `Grounded` conditions in the controller) but it must be right before Jump/Fall/Land.
- **Gateway was down this session:** B-09's staged connect logged `connected=False timedOut=True status={"ok":false,"reason":"no_gateway"}` — the honest offline path — and boot still reached `DressHeroAfterHub complete` at t≈93.2 s with no exceptions.

### F-03 notes

- **Ground speed is hunger-scaled, and that is what broke the first threshold pass.** `LocomotionCharacterMotor` targets `tuning.walkSpeed|sprintSpeed * surface.SpeedMultiplier * max(0.05, style.speedMul * LivingBody.MoveMul)`, and `LivingBody.MoveMul = Lerp(1f, 0.55f, Hunger*0.55f + Fatigue*0.7f)` (`LivingBody.cs:18`). The probe hero had reached `Hunger=1.000 Fatigue=1.000` → `MoveMul 0.5500`, so sprint was really 3.6 m/s and a sweep that assumed 6.58 looked "unreachable". Reset `Hunger`/`Fatigue` to 0 before measuring speed, and record `MoveMul` next to every speed you log.
- **The hero really is fast when fresh.** With `MoveMul=1`: walk **5.611 m/s**, sprint **8.630 m/s** (`vel` and `Animator.GetFloat("Speed")` agree to three decimals). That is why the blend thresholds sit at the kernel numbers rather than at measured-and-halved guesses.
- **`HumanBodyBones`-free sprint driving for evidence:** `ConcordiaPlayer.WalkBearing(Vector3 dir, float seconds)` sets `_forceWalk`/`_forceWalkT` and forces `sprint = true` with `speed = 8.1f * style.speedMul` on the same `cc.Move` path as WASD — no input injection needed. Held Input System keys are reset between `execute_code` calls (`Keyboard.current.wKey.isPressed` reads False on the next call), so key injection cannot hold a sprint across a tool-call boundary; it only ever moved the hero because the state survived while the editor stayed unfocused for a while.
- **Ungrounded means silent Idle.** `ModularPerson.SetGait` writes `_anim.SetFloat("Speed", grounded ? speed : 0f, 0.12f, Time.deltaTime)`. Teleporting the hero to y=0.30 at `Time.timeScale = 0.08` left it airborne for the whole gap and produced `Idle_Loop` with `CharacterController.velocity = 7.71`. Place the hero at y≈0.12 and keep `Time.timeScale` ≥ 0.2 so `cc.isGrounded` settles.
- **Low `Time.timeScale` also starves the parameter smoothing.** The `SetFloat` damping is driven by scaled `Time.deltaTime`, so 0.08–0.1 makes the blend crawl; at 0.2 it tracked velocity 1:1.
- **Controller edits are live during Play** — rewriting the blend-tree thresholds with `UnityEditor.Animations.BlendTree` + `EditorUtility.SetDirty` + `AssetDatabase.SaveAssets()` took effect on the running Animator with no re-Play and no boot cost.

### F-04 notes

- **The decel half of F-04 already shipped.** `ModularPerson.SetGait` pushes `Speed` through `Animator.SetFloat(name, value, 0.12f, dt)`, so stopping already eases the blend tree down over ~0.12 s. F-04 added only the turn half; the decel was measured (`3.020 → 0.000`, `Idle_Loop 1.000`) and recorded instead of being duplicated in the new component.
- **Urgent low `timeScale` is how you sample a fast turn.** A 180° pivot at 7.2 rad/s finishes in 0.44 s, which is shorter than one `execute_code` round-trip. `Time.timeScale = 0.005` plus `ConcordiaPlayer.WalkBearing(Vector3.back, 8f)` spreads the same turn over minutes of wall clock, so `_lag`, root yaw and the clip weights can be read from separate calls without the turn completing between them. Restore `Time.timeScale = 1f` and `_forceWalkT = 0f` by reflection when done.
- **Runtime-installed components do not survive the reload you just caused.** `LocomotionPolish` is reached by `[RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]`, which does **not** re-run after a mid-Play domain reload. Editing the script during Play leaves zero instances and the feature silently absent; restart Play. Check with `Object.FindObjectsByType` (76 live this session) before trusting any measurement.
- **`LocomotionPolish` deliberately mirrors, not reaches into, `ModularPerson`.** Bones are resolved by the same alias tables (`Bip01` / `mixamorig:` / Quaternius `UpperArm.L`, plus `Chest`/`Torso`) searched under `AuthoredPerson`, and `OnBodyRebuilt` re-binds after a recast or Travel rebuild — `ModularPerson`'s private `_spine`/`_chest` fields stay private.
- **Grounding is still lying, and F-05 depends on it.** At rest with `cc.velocity` 0.000 the probe read `cc.isGrounded=False` and `Animator.GetBool("Grounded")=False` while the hero stood on the plaza floor. `SetGait` zeroes `Speed` whenever `grounded` is false, so this must be fixed before Jump/Fall/Land are wired to it.

### QA-0 notes

- **`Assets/Concordia/Shots/*.png` are not SHOT 01.** `ConcordiaShot.Grab()` is started from `KickBootCoroutines` (`ConcordiaGame.cs:185`) at frame 1, waits 50 frames, then *disables* `ChaseCamera` and poses the camera — `(0,16,-30)` looking at `(0,6,0)` for `concordia-play-plaza.png`, and `PosePerson(cam)` for `person-now.png` (the same frame is copied into `person-now.png`, `game-view-now.png` and `/tmp/concordia-play.png`, which is why those three are byte-identical). At ~1 fps this lands ~50 s into boot, long before `DressHeroAfterHub complete` at t≈118 s, so the files show an undressed, mid-staging world. Grade SHOT 01 from the real chase camera after boot settles.
- **The earlier "camera pitched into the canopy, hero out of frame" reading was a capture-path artifact, not a regression.** Measured on the settled frame: `ChaseCam` enabled, euler X `+4.6°` (tilted slightly *down*), fov 46, hero at viewport `(0.49, 0.40)`, 6.1 m away. `ChaseCamera.pitch` is clamped to `[-0.45, 0.62]` rad, default `0.22`; nothing was driving it up.
- **Grading a shot with no image viewer:** load both PNGs with `Texture2D.LoadImage`, then compare mean luminance, the fraction of near-black (`lum<8`) and near-white (`lum>235`) pixels, and render an 88×30 ASCII luminance ramp to read composition. This is decision-grade for "unchanged or better": the B-03 frame was **56.3% pure black** (mean 25.6) and the current one is 3.8% (mean 33.3), so the verdict needs no appeal to taste. Baseline ASCII is sparse speckle over black; the current one has a readable horizon, ground plane and lit structures.
- **Prefer `ScreenCapture.CaptureScreenshotAsTexture()`** for evidence capture from `execute_code`: it returns a `Texture2D` synchronously. `AuraShots.Capture()` uses the async `ScreenCapture.CaptureScreenshot(path)`, which only lands at end-of-frame and so is awkward to drive from a single-shot script.
- **This session had no mid-play domain reload** — `Entering Playmode with Reload Domain disabled` — so the `s_domainAlive` watchdog never had to re-kick and boot reached its tail uninterrupted (30 s staged wait measured from t=118.1).
- **`ContentBindVolumeCatalog.cs:402` did not throw at all this Play.** The once-per-entry `ArgumentOutOfRangeException` seen in every earlier session is not deterministic.
- **Log hygiene:** `Logs/Editor.log` was rotated during the 12:55–13:14 package reimport burst — the previous session lives in `Logs/Editor-prev.log` (105 MB). Anchor greps on the line number of `kicking boot coroutines`; never assume the current `Editor.log` still holds earlier sessions.
- **Do not count errors by grepping `Exception`** — UIElements stack frames literally contain the text `System.Exception&`, which inflated an earlier count to 54. Match `^[A-Za-z.]+Exception:` or `error CS` instead.

### B-09 notes (unblocked — this is how it actually behaves)
- **`DressHeroAfterHub` does complete — it was never a tail problem, it was two boot bugs.** The earlier 9-minute "never completes" reading was taken before F-01's fix. Root causes: (a) coroutines started from `Start()`'s first-frame continuation were lost, now all four boot coroutines start from the first `Update` via `KickBootCoroutines()`; (b) a **play-mode script reload** destroyed every running coroutine while leaving the object and its fields intact (`Define symbols changed` → `Reloading assemblies after forced synchronous recompile` → `Begin MonoManager ReloadAssembly` → `Domain Reload Profiling: 22324ms`, ~30 s into Play). `s_domainAlive` in `ConcordiaGame.Update` now detects the reload and re-kicks. Wall clock at this frame rate: kick → `complete` ≈ 190 s, + 30 s idle → connect ≈ 220 s.
- Evidence from the same session: boot reached `staged full HubPlaza begin` at 11:11:16 and was still churning `StreamNpcPresence` park logs at 11:15:31 with `sim=78 live=0`. `ExpandSystemsStaged()` is the most likely thing holding the coroutine open.
- **The roadmap's premise is partly stale.** The socket is *not* dead in LeanPlay: `ConcordClient` logs `LeanPlay: defer ConcordClient websocket until Hub staged` (11:10:50) and then `LeanPlay: WS full handshake (ApplyScene staged; AgentBody later)` (11:10:54) on its own. Only the account/agent connect (`EnsureConnected` → `AgentBody`) is skipped.
- **The gated connect is now shipped and verified** (`784f1e905`), not reverted. Two invariants are load-bearing and must not be "simplified" away: `ConcordClient.LeanAutoConnect` must keep its `= false` initialiser — a play-mode domain reload resets statics to their initialiser, and an earlier `= true` build silently re-dialled mid-boot; and `ConcordiaGame.Update`'s watchdog must keep its `StagedConnect` re-kick branch, or a reload during the 30 s idle strands the connection forever. `Scripts/Aura/FrameWatch.cs` landed separately and is what produced the frame numbers.
- **Frame gate is unmeetable here, and that is not a B-09 defect.** `[AuraVerify] B-09 FrameWatch after connect frames=25 maxMs=949.9 over100ms=24`, boot window `maxMs=57095.0 over100ms=142/149`. The B-03 baseline is already 4.1 fps ≈ 244 ms/frame, so "no frame > 100 ms" cannot be satisfied by any connect-timing change. The P-* perf tasks own the frame-time finding; B-09's functional bar (connect late, receive `kingdom:data`, hold) passed. Open follow-ups that belong to other tasks: the mid-play recompile trigger is still not isolated (REQ-6, suspects `ForceRecompile_ZukoPlay.cs` and `KenneyPersonSetup.cs`), a stale `realmfill_done` in `Generated/runtime-stage.txt` still shortcuts the staging wait on a cold session with no freshness guard in code, and `ContentBindVolumeCatalog.LoadEditorFallback:402` still throws `ArgumentOutOfRangeException` on boot. Server-down path (`no_gateway`, 120 s hold) was not re-tested this run.

### B-08 notes
- Live dump: **946 MonoBehaviours / 56 types** at `plaza`. Top counts: `CharacterVisualProfile` 89, `ModularPerson` 89, `PersonLabel` 89, `StreamNpcPresence` 89, `NpcLife` 84, `GuestNpc` 81, `LoreStone` 74, `QuestBoard` 41, `BuildingPlace` 36.
- Boot phases, in order: `guests` (15 named, ~1 s each) → `guests_done` → `lore` → `city_ring` → `forest` (those three in one frame) → `realmfill` → `crowd` → `realmfill_done` → `plaza` (settled). First guest → `crowd` ≈ 68 s; `plaza` ≈ 2 min.
- `ConcordiaGame.cs:320–335` logs both skips: persistence `Restore/ReceiveHere`, and `EnsureConnected/RestoreAgentSoul`. LeanPlay is offline **by design** — `no_gateway` is the correct honest answer for server reads.
- Correction to the roadmap's phrasing: `ActionRunner` does not call `HitResolver`. The real path is `ConcordiaPlayer.TryAttack` → `Core.AttackContext` → `Core.HitResolver.Resolve(attack, _body, _action)` (L801–813), where `_action` is the `ActionRunner` carrying guard/i-frame state (`_action.IsInvulnerable` → passed as `null` when already invulnerable).
- `Generated/runtime-stage.txt` holds only the **latest** stage string (overwritten, not appended) — use console `phase=` lines for history.

### B-07 notes
- `InputActionRebindingExtensions.PerformInteractiveRebinding` **throws** if the action is enabled ("Cannot rebind action … while it is enabled"). `ConcordiaInput.StartRebind` disables the action, listens, then re-enables in `OnComplete`/`OnCancel`.
- An editor-driven rebind needs the key press to arrive on a **later** input update: queue the state, return, then read on the next call. A press queued *and* `InputSystem.Update()`-flushed in the same call is consumed before the operation attaches (first attempt reported `listening=True` and no completion, though it completed asynchronously afterwards — which is how the override landed in PlayerPrefs).
- Gameplay call sites in `ConcordiaPlayer` now pass **action names** (`ConcordiaInput.Down(ConcordiaInput.Dodge)`) instead of `KeyCode.X`, otherwise a remap would be negative-only (X stops working, V does nothing, because the call site still asked about X).
- Overrides are stored as the Input System's own JSON in PlayerPrefs under `concordia.input.overrides`; `HasOverrides` is derived from `SaveBindingOverridesAsJson() != "{}"` because `InputActionAsset.hasBindingOverrides()` does not exist in this Input System version.
- The CONTROLS tab is compiled and renders (`tab=2`, `errors=0`) but has not been eyeballed pixel-by-pixel; the 3 Play warnings seen in that session are pre-existing CS0618s in `ContinentStream.cs` and `ConcordiaPersistenceService.cs`.

### B-06 notes
- Verification had to go through the Input System, not the OS: `InputSystem.QueueStateEvent(device, state)` + `InputSystem.Update()` drives the real device, and `InputProbe.PressAll()` reads each action's `WasPressedThisFrame`. First run was 17/20 — `slot1/2/3` missed because `<Keyboard>/digit1` does not resolve; the canonical paths are `<Keyboard>/1|2|3`. Re-bound and it went to 20/20.
- The asset must live under `Resources/` to be loadable at runtime, so it sits at `Assets/Concordia/Resources/Concordia/ConcordiaControls.inputactions` (a local, **untracked** copy was left at `Assets/Concordia/Input/` from the first attempt — delete it when convenient; the tracked one is authoritative).
- Dormant bug found and fixed while centralising the key table: the old `ToKey` in `ConcordiaPlayer` had no mapping for `S` or `LeftCtrl`, so `KeyHeld(KeyCode.S)` (brake) and `KeyHeld(KeyCode.LeftControl)` (descend) always returned false under the Input System. `ConcordiaInput.ToKey` is now a superset (WASD, S, LeftCtrl included).
- Play health after the input refactor: `errors=0 warnings=0 hero=True heroMeshes=1 transforms=11241 pos=(11.2,0.1,-12.0)` — no regression against the B-03 baseline.

### B-05 notes
- Settings defaults: reducedMotion **off**, cameraShake **1.00**, damageNumbers **on**, subtitleScale **1.00**, `ConnectInLeanPlay` **on in editor / off in a player**, mouseSensitivity **1.00**.
- The Settings panel is a second tab inside the existing `KitMenu` (tab strip rides the title row so inventory columns keep their coordinates); `K` still opens the lattice, `I` still closes the menu.
- Play health during B-05: `errors=0`. The `warnings=2` counted in Play come from **pre-existing** `Assets/Concordia/Editor/LookCapture.cs` CS0618 compile warnings surfacing during a Play-time recompile — not from Aura files.

### B-04 gotchas worth remembering
- `execute_script` compiles its target file in a way that gives **fresh statics** for types defined in that file — reading `AuraVerify.KeysInstalled`/`KeyDriver.Instance` there reported stale defaults while the real component existed. Detect the driver object via `Resources.FindObjectsOfTypeAll<MonoBehaviour>()`, not statics or `FindObjectsByType` (it is `HideFlags.DontSave`).
- **Editing any script during Play keeps Play running but reloads the domain**, so `RuntimeInitializeOnLoadMethod` installers do NOT re-run and their objects are destroyed. A/B facts gathered after a mid-Play edit are meaningless — always start a fresh Play after touching scripts.
- Pre-existing (not Aura's) editor warnings remain in `Assets/Concordia/Editor/LookCapture.cs` (CS0618 `FindObjectsSortMode`). Aura's own files compile warning-free.

### B-03 baseline numbers (SHOT 01 — Court, LeanPlay boot settled)

- **fps** (idle, editor Play, focused): **4.1** — flagging as a real perf signal for the P-* perf tasks.
- **transforms in scene** (`FindObjectsByType<Transform>`, active): **11235**
- **WorldBuilder children**: **4** (bible's `World` ~1143 no longer describes this build; content sits under `Megaworld` + `CourtLookRig`)
- **hero**: `ModularPerson` present, 1 enabled SkinnedMeshRenderer (dressed) — guest dress completed (15 guests staged)
- **console during Play**: errors **0**, warnings **0**
- **LeanPlay**: on · hero pos `(11.2, 0.1, -12.0)`
- **evidence**: `~/.zuko/aura-shots/B-03.png` (2560×1410, 2.5 MB)
- **discrepancy**: roadmap named `Editor/AuraPlayHoldGuard.cs` + `Editor/AuraGameViewStill.cs` (absent); used and committed `Editor/Aura/AuraShots.cs` instead.
