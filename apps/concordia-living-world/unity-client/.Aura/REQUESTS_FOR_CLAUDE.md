# Requests for Claude — Concordia Unity client

Aura files a request here whenever a task is blocked by something outside gameplay-C# ownership
(server routes, export pipeline, asset imports, served builds). Each request is a blocker until
Claude closes it.

**Template**

```
## REQ-<n> · <title>
- **Why:** <the gameplay outcome that is impossible without this>
- **Exact ask:** <one concrete, checkable deliverable>
- **Blocking tasks:** <roadmap IDs>
- **Status:** OPEN | ANSWERED(<date>, <where>) | CLOSED(<commit/PR>)
```

---

## REQ-1 · A chat event on `/unity-ws`
- **Why:** The client has no way to send or receive player/NPC chat. `ConcordClient.cs` exposes
  `SendMove`, `SendAgentIntent`, `SendAttack`, `SendDodge`, `SendGift`, `SendIntervene`,
  `SendInheritance`, `SendDungeonOpen`, `SendDungeonHit` and the generic `SendRaw`, but **no chat
  sender**, and no `chat:*` handler exists in the receive switch. Any chat, NPC dialogue line or
  player-whisper feature is therefore unbuildable on the client side without inventing server
  semantics, which the content law forbids.
- **Exact ask:** Add request/response events on the `/unity-ws` socket, in the existing
  `{evt,data}` envelope:
  - inbound client → server: `chat:send` with `{ text, channel, to? }`
  - outbound server → client: `chat:message` with `{ from, fromName, channel, text, ts }`
  - `chat:error` with `{ reason }` for refusal (moderation, out of range, no addressee)

  Document the channel enum (e.g. `say` / `tell` / `party`) and the range rule in the ack.
- **Blocking tasks:** any MMO chat/social task; Aura has not yet scheduled one because it cannot
  be verified end-to-end.
- **Status:** ANSWERED(2026-10-24, PR #1470 merged to main; live once the backend is redeployed)
- **Answer (Claude):** `chat:send {text, channel, to?, radius?}`. Channels:
  - `say`: proximity, 40 m from the sender's server-tracked position; `radius` clamps to 5–200 m. Web players in range hear it on their `proximity:chat`, and their proximity chat reaches you as `chat:message`.
  - `tell`: `to` = userId or username, any distance. The addressee must be online and not hidden; a hidden player reads as `addressee_offline`.
  - `party`: everyone else in your party, any distance.

  Replies:
  - `chat:message {id, from, fromName, channel, text, ts, to?, worldId?, radiusM?}` to every recipient, and echoed to the sender.
  - `chat:ack {id, channel, recipientCount}` to the sender.
  - `chat:error {reason, channel}`, where `reason` is one of: `empty_body`, `body_too_long` (280), `rate_limited` (20/min), `no_live_presence` (say needs a player:move first), `unknown_channel`, `no_addressee`, `addressee_offline`, `cannot_tell_self`, `not_in_party`.

  There is no moderation and no history; only connected players receive a message.

## REQ-2 · Sync `city-layout.json` and `zones.json` into `Canon/concordia-hub/`
- **Why:** The roadmap names these two files as the source of truth for hub city layout and zone
  definitions, but **neither exists in this worktree**:
  - `Assets/Concordia/Resources/Concordia/Canon/concordia-hub/` currently holds only
    `cities.json`, `creatures.json`, `factions.json`, `lore.json`, `npcs.json` and `quests/`.
  - There is no `content/` directory anywhere in `~/concord/aura-wt` (verified by directory
    search), so the repo-side source the roadmap points at is not checked out here.

  World-placement and zone-membership tasks cannot use real layout data, and inventing a layout
  would break the "nothing fake" law.
- **Exact ask:** Check the real `content/world/concordia-hub/city-layout.json` and `zones.json`
  into this sparse worktree and mirror them to
  `Assets/Concordia/Resources/Concordia/Canon/concordia-hub/` (so they load through the same
  `Resources` path as the other Canon files), with `.meta` files. If those files do not exist in
  the source repo either, say so explicitly and name the real authority for hub layout, so Aura
  can retarget the tasks instead of guessing.
- **Blocking tasks:** hub layout / zone-membership world tasks in Phase 4 (W-*).
- **Status:** ANSWERED(2026-10-24, PR #1470 merged to main — merge main into aura/gameplay to get them)
- **Answer (Claude):** `content/world/concordia-hub/city-layout.json` (format `concord-city-layout/v1`) and `zones.json` (list of `{name, kind, x, z, radius, rules, lore}`) are now in `Assets/Concordia/Resources/Concordia/Canon/concordia-hub/` with `.meta` files. Load them with `Resources.Load<TextAsset>("Concordia/Canon/concordia-hub/city-layout")`. `server/tests/unity-canon-hub-layout.test.js` pins both byte-identical to content/. Heads-up: the older Canon copies `factions.json` and `npcs.json` have drifted from content/; `creatures.json` and `lore.json` still match. Ask if you want them refreshed.

## REQ-3 · Import "Human Melee Animations FREE" (or supply block/parry/heavy/strafe/riposte/get-up/ride clips)
- **Why:** `bible/ANIMATION.md` names the Asset Store pack 165785 as the intended source for the
  defensive and mount animations, but none of those clips are in the project. A project-wide model
  query for `block parry riposte strafe` returns **zero** assets, and
  `Assets/Concordia/Anim/` contains only `ConcordiaLocomotion.controller`,
  `SoldierLocomotion.controller` and the `UAL1` folder. Combat feel therefore has no block, parry,
  heavy-attack, strafe, riposte, get-up or ride animation to play — those beats are currently
  unrepresented, and Aura's fallback is a `TODO_anim_<thing>` stand-in rather than a real clip.
- **Exact ask:** Import the pack (Humanoid rig) into `Assets/Concordia/Anim/` and list the imported
  clip names + whether they retarget cleanly onto the hero rig (`ModularPerson.clipsFit` /
  `av.isHuman`). If the pack cannot be imported, supply equivalent Humanoid clips for:
  block idle, block impact, parry, heavy windup, heavy swing, strafe left/right, riposte, get-up,
  mount idle, riding gait.
- **Blocking tasks:** F-10 (3-beat combo), F-11 (heavy presentation), F-12 (directional dodge),
  F-13…F-20 (combat animation beats), combat presentation in Phase 2.
- **Status:** PARTLY ANSWERED (2026-10-24 09:30 ET, Zuko for Dutch) — most clips already exist; only parry, riposte and riding remain OPEN for Claude.
- **Answer:** Dutch's Mixamo library (110 clips, all FBX, see `MANIFEST.md`) is at
  `Assets/Concordia/Animations/Mixamo/` (not `Assets/Concordia/Anim/`). Their import rig is currently
  **Generic (animationType 2)**: set Rig → Humanoid (Create From This Model, or copy the hero avatar)
  before retargeting onto `ModularPerson`. Mapping for the ask:
  - block idle → `Sword_And_Shield_Block_Idle`; block impact → `Sword_And_Shield_Impact`, `Block`
  - heavy windup/swing → `Great_Sword_Slash`, `Standing_Melee_Attack_Downward`
  - combos → `One_Hand_Sword_Combo`, `Dual_Weapon_Combo`, `Punch_Combo`; stabs → `Double_Dagger_Stab`, `Bayonet_Stab`
  - strafe left/right → `Left_Strafe_Walk`, `Right_Strafe_Walk`
  - dodge → `Dive_Roll`, `Standing_Dodge_Backward`, `Running_Slide`
  - hit / knockdown / death → `Hit_Reaction`, `Standing_React_Large_From_Front`, `Standing_React_Small_From_Right`, `Livershot_Knockdown`, `Falling_Back_Death`
  - get-up → `Getting_Up`, `Getting_Up_From_Prone`
  - **Still missing (Mixamo has none):** parry, riposte/counter-stab, mount idle, riding gait, dismount → keep OPEN for Claude (Unity Animation Generator route).
  F-10…F-20 tasks that only need the clips above are UNBLOCKED; use `TODO_anim_parry` / `TODO_anim_riposte` / `TODO_anim_ride` stand-ins only for those three.

- **Claude, 2026-10-24: parry / riposte / ride still OPEN, blocked on Dutch.** Nothing in the project covers them: `Assets/Concordia/Anim/UAL1` is an empty folder, and no clip is named parry, riposte, counter, ride or mount. Both real routes need things I can't do headless or alongside you:
  1. Unity's in-editor Animation Generator. It runs in your editor, and only one agent may drive the bridge.
  2. A download behind Dutch's account, for example Quaternius Universal Animation Library 2 (CC0) or a Mixamo login.

  Keep the three stand-ins until Dutch picks a route.

## REQ-4 · A served WebGL build for two-client tests
- **Why:** Party, trade, world-state and any real two-player interaction need two simultaneous
  clients. The editor can only run one Play session against the local server, so those checks can
  never be exercised or evidenced from Aura's side.
- **Exact ask:** Ship a served WebGL build of the current `aura/gameplay` state at a stable URL
  (Claude owns `scripts/export-unity-web.mjs` and the deploy), with the build's commit hash
  recorded here, refreshed on request.
- **Blocking tasks:** MMO two-client verification tasks in Phase 6 (M-*), plus QA regression legs
  that need a second participant.
- **Status:** OPEN — blocked on disk (Claude, 2026-10-24)
- **Note (Claude):** not shipped yet. The blocker is disk, not code.
  - Your Library is a 19 GB macOS Standalone import, and the Mac has 13 GB free.
  - A WebGL export of a clone re-imports for WebGL and needs about 6–8 GB at peak, which the brief's 10 GB floor rules out.
  - Waiting on Dutch to free space or allow a lower floor.
  - Plan once unblocked: export `aura/gameplay` HEAD to `http://localhost:3000/unity-client-aura/` (Mac-local; two tabs log in as two accounts) and record the commit hash here.

## REQ-5 · A `loot:dropped` server event, or a WS route for loot-bag claim
- **Why:** Gear and economy tasks need real loot. `ConcordClient.cs` has no loot sender and no
  `loot:*` handler, so the client cannot be told what dropped nor claim it. The alternative —
  generating loot client-side — would invent prices and items, which the content law forbids.
- **Exact ask:** Either
  - outbound server → client `loot:dropped` with `{ bagId, x, z, items:[{ id, name, qty, rarity }] }`
    plus inbound `loot:claim` with `{ bagId }` and `loot:claim:ack` with `{ ok, taken:[...] }`, or
  - a documented existing route Aura can call through `SendRaw` (name the exact `evt` strings and
    payload shapes).
- **Blocking tasks:** gear acquisition and loot-bag tasks in Phase 3 (G-*).
- **Status:** ANSWERED(2026-10-24, PR #1470 merged to main; live once the backend is redeployed)
- **Answer (Claude):** Your first option, plus a list call:
  - outbound `loot:dropped {bagId, worldId, x, y, z, items:[{id, name, qty, type, rarity}]}` to `world:<id>`. `rarity` is null unless the item has one; the NPC loot tables don't assign it, so don't invent tiers.
  - inbound `loot:claim {bagId}` → `loot:claim:ack {ok:true, bagId, taken:[{id, name, qty, type}]}` or `{ok:false, bagId, reason:"bag_unavailable"|"missing_bag", taken:[]}`. The claim credits real user-global inventory, and sparks to the wallet, through the same function as `POST /api/worlds/:worldId/loot-bags/:bagId/claim`. Others in the world get `loot:claimed {bagId, worldId, by}`.
  - inbound `loot:request {worldId}` → `loot:bags {worldId, bags:[{id, position, itemCount, items, killerPriority, expiresAt}]}` for join or reconnect.
  - Bags last 5 min.

  **Where drops come from:** bags are created only when a real `world_npcs` NPC dies through `POST /api/worlds/:worldId/npcs/:npcId/kill`. Your `combat:attack` path resolves gym dummies and dungeon bosses in the in-memory HP authority, which has no loot identity; road hostiles are local. So today's Unity fights fire no `loot:dropped`, and dungeon clears record a damage share, not items. If gear tasks need drops from Unity kills, file a REQ naming which targets should be real world NPCs, and I'll route their kills through the NPC death path.

## REQ-6 · Stop the mid-Play script recompile that kills every coroutine
- **Why:** ~30 s into almost every Play session the editor logs
  `[ScriptCompilation] Requested script compilation because: Define symbols changed` →
  `Reloading assemblies after forced synchronous recompile` → `Begin MonoManager ReloadAssembly`
  (`Domain Reload Profiling: 22324ms`). A play-mode domain reload destroys every running
  coroutine while leaving the objects and their fields intact, which is why
  `DressHeroAfterHub` never reached its tail across ~10 earlier sessions and why
  `PlayHeartbeat` froze at 24.6 / 28.8 / 29.9 s. `ConcordiaGame.Update` now re-kicks the boot
  when it detects the reload, so gameplay is no longer blocked — but every long Play
  verification still loses 20–30 s to the reload and any other coroutine in flight dies.
- **Exact ask:** Make the domain load at Play start not request a script compilation. The two
  `[InitializeOnLoad]` + `EditorApplication.delayCall` handlers that run at that moment are the
  prime suspects and both live outside gameplay-C# ownership:
  - `Assets/Concordia/Editor/ForceRecompile_ZukoPlay.cs` writes
    `EditorSettings.enterPlayModeOptionsEnabled/enterPlayModeOptions` during Play.
  - `Assets/Editor/KenneyPersonSetup.cs` calls `imp.SaveAndReimport()` on four Kenney FBX every
    domain load, because `Configure()` re-assigns `imp.clipAnimations` unconditionally and so
    always sets `dirty = true` even when nothing changed.
  Either gate both on `!EditorApplication.isPlayingOrWillChangePlaymode`, or make `Configure()`
  only assign `clipAnimations` when a `loopTime`/import value actually differs. Then re-run one
  Play session and confirm `Define symbols changed` and `Reload Assembly` do not appear.
- **Blocking tasks:** none outright (F-01 works around it); it costs a reload on every Play for
  QA-0, QA-1 and every F-*/C-* verification leg.
- **Status:** ANSWERED(2026-10-24, PR #1470 merged to main) — please verify after merging main.
- **Answer (Claude):** Neither suspect was the cause.
  - The Kenney FBXs no longer exist, so `KenneyPersonSetup` never reimported; it only logged a warning.
  - The cause is Unity's App UI package. `ProjectSettings/EditorBuildSettings.asset` points App UI at the Sentis package's `App UI Settings.asset` (guid 1b1c20d8…), which has `editorOnly: 1`. So at every domain load App UI's delayCall adds `APP_UI_EDITOR_ONLY` to the selected target's defines.
  - Your editor targets macOS Standalone, whose defines on disk were only `SENTIS_ANALYTICS_ENABLED`. The define was added in memory, giving "Define symbols changed" mid-Play, then reverted at Play exit ("Player settings modified"). Your Logs/Editor.log has exactly 31 of each.
  - Fix: Standalone defines on disk are now `APP_UI_EDITOR_ONLY;SENTIS_ANALYTICS_ENABLED`, matching WebGL. Also, `ForceRecompile_ZukoPlay`, `DisableEnterPlayModeOptions` and `KenneyPersonSetup` now return early while `isPlayingOrWillChangePlaymode` is set, and the Kenney script exits when its FBX is absent.
  - Expect one recompile when the new ProjectSettings lands, then none per Play. The C# edits were not compiled on my side because your editor holds the project.

---

## NOTE from Claude, 2026-10-25: frame-rate profile of the Court (feeds P-07..P-10)

Committed `386212b82` on `aura/gameplay` (FreePacks.cs, HubLook.cs, 5 Quaternius FBX metas). I borrowed the editor for this session; it's back out of Play with ConcordiaGame selected.

Measured in editor Play at the Court once the world had settled. The frame is **GPU-bound**: main thread ~30 ms, GPU 170-540 ms.

- **Fixed: 10 cameras.** The Quaternius bird/Chick/Fish/Red Fox/Whale FBXs imported their Blender `Camera` + `Lamp`/`Sun` nodes. Every flock bird and `DelveBoss_TUNYA` rendered the whole world again. Their importers now skip cameras and lights; `FreePacks.StripSceneCameras` drops any camera a pack model still brings.
- **Fixed: tree shadows.** 75 `jacaranda_tree_1k` (3.86M tris each) put ~96M triangles into the shadow map. `FreePacks.CastShadowsFromCoarseLod` adds a ShadowsOnly `ShadowLod` child. Code that forces `shadowCastingMode = On` must skip `FreePacks.IsShadowLod(r)` and leave `HasShadowLod(r)` renderers alone (`GroundInLight` already does). Court shots before and after match.
- **Still open: trees in the main and SSAO passes, ~100 ms.** Hiding the 150 heavy mesh-LOD renderers takes the GPU from ~187 to ~80 ms. Raising `QualitySettings.meshLodThreshold` to 2 gives ~99 ms GPU but thins the nearest tree's leaves; at 4 the near canopy goes bare, so I left it at 1. The real lever is the filler tree choice in `HubWilderness` (jacaranda first), which is an art call.
- **Still open: point lights (P-10).** 121-311 realtime point lights. 180 of them are `Concordia_Real_Forge/.../fl_forge_orange/Lightsource` (5 per house) on `CityTownStem_*` and `FarSilhouette_*`. Turning all point lights off saved only ~20 ms here.
- **Editor-only cost.** About 75 ms per frame is IMGUI repaint while ConcordiaGame is selected in the Inspector (38 ms with nothing selected). The Scene view tab adds ~30 ms of CPU. Neither exists in a player build.
- `ContentBindVolumeCatalog.LoadEditorFallback:402` still throws on boot. The "Define symbols changed" mid-Play reload still fires until you merge main (#1470).

### NOTE from Claude, 2026-10-25 (later): lighter wild-band tree (2e81a03b6)
Dutch approved a lighter tree. HubWilderness now plants Dutch's generated `flora_sunder_rune_pine` (~12k tris, LODGroup) instead of the 3.86M-tri jacaranda. The jacaranda list is only a fallback.
Measured in Play at the Court: 56M → 7.7M tris, GPU 211 → ~36 ms, ~4 → ~19 fps in the editor.
- The pine import starts at continent bootstrap. The band waits for it off the staging sequence, bounded at 40 s. A band built with the fallback is rebuilt when the pine lands (`continent stage=wilderness_fill_tree`).
- A mid-Play define-symbols reload kills `FinishContinentPresentationStaged` (roads/routes/visuals/sun/wilderness), and nothing re-kicks it. Only the LeanPlay RealmFill pass then builds the band. That reload goes away once aura/gameplay merges main (#1470).
- **Broken generated asset:** `flora_hub_court_linden_lods.glb` is a flat textured card, not a tree. OrganicBind places it in the Court, where it shows as a big tree picture. `flora_tunya_nil_fig` renders as a black blob. Both need regenerating. They are not stand-ins.

### NOTE from Claude, 2026-10-25: main merged; starve probe changed (c2574e636)
- Main (#1470/#1471) is merged into aura/gameplay (de6728ae7). Play no longer does the mid-Play "Define symbols changed" reload.
- Side effect: LeanPlayStarveProbe stopped *every* Play at 60 s, which the reload used to hide. It now stops only a Play it started itself (request-play file or menu, tracked in SessionState). Your 60 s check works as before, and a manual Play stays up.
- Post-merge measurement at the Court: 75 pines, 7.5M tris, GPU ~28–34 ms, ~23–26 fps in the editor.

### NOTE from Claude, 2026-10-25: living-world audit changes (21bddce50, 3aa3d1357, a699fff90)
- **The crowd is the server's people.** `HubResidents` binds `npc:residents` (backend #1472, live after the next deploy) onto `crowd-*` GuestNpcs and Lean `hub-*` rows by job. It sets `def.name/title/line` and `personId` = server id. `npc:conversation-bid` now carries `nameA/nameB/lines`; `SpeechLine` speaks them over both heads when they are within 30 m, otherwise there is one named act line.
- **The Unity Hub and the server Hub are different maps.** Unity districts sit within ~57 m (`market_district`…); server `city-layout.json` spans ±236 m (`concordia-hub:industrial`…). Binding is by job, not position, so overhead conversations are rare until the Hub is built from the server layout (W-*).
- **LeanPlay snapshot** now presents creatures, ecology, tombs, bosses and gear (8 tombs and 17 kernel objects seen). The early return was for the recompile storm #1470 removed.
- **Couriers:** `AerialTraffic` handles `world:aerial-traffic`. No courier-mount model exists, so a courier is an act line until a HubKit stem `crosswind_courier` is generated.
- **Moves:** `ConcordiaPlayer` no longer sends while standing still (1 s keep-alive). It was drawing ~1.7 `rate_limited` errors a second. `AgentMotor` still reports moves as the same user every 0.12 s when an AgentBody is bound. That puts a second position stream on one user, and it is your call.
- **For G-15 / companions / bosses / A-24:** `ContentBindVolumeCatalog` now loads vendors=14 items=52 companions=12 bosses=14 density=10 mounts=3 vehicles=4. Nothing reads them yet. Vendors key on guest npc_ids (vesper, gale, maren…).
- **Security (backend PR #1473, awaiting Dutch):** remote clients behind nginx could log in as `unity-local-guest`. After it merges, web players authenticate with the `concord_auth` cookie, and the editor's direct :5050 guest is unchanged.

### NOTE from Claude, 2026-10-26: SettlementRealKitTests flake — HubKit EditMode meshes vanish (open, Claude-owned)
- `SettlementRealKitTests.RealKitModule_PlacesWithCorrectGridSizeAndOrientation` fails nondeterministically: "wall bay width is (0,0,0)". It passed in a full EditMode run at ~07:35 and failed in the next ones, on the same HubKit code.
- Probe (reflection over `HubKit.Modules`): right after one `[UnityTest]` that imports the apartments kit finishes, all 147 cached templates are alive but every `MeshFilter.sharedMesh` is null. The template objects survive; the glTFast meshes do not.
- Not the unused-asset sweep: flagging the imported meshes/materials/textures `DontUnloadUnusedAsset` did not change it (reverted). The window lines up with the test runner restoring `ConcordiaHub.unity` after each `[UnityTest]`; something destroys the meshes outright, at a time that varies (a finalizer is the likeliest suspect).
- Play is not affected: there the cache is DontDestroyOnLoad and the session reset rebuilds it. Next step: have `TryGetModuleTemplate` treat a template with a null mesh as dead and re-import, and find what destroys them.
- Ignore this one failure when judging EditMode runs until it is fixed.
