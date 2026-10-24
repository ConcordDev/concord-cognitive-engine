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
