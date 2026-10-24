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
