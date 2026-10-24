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
