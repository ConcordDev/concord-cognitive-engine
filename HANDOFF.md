# Handoff — Concordia Unity pivot (2026-09-12)

Written by Claude for whoever (Cursor included) picks this up next. Everything
below is verified, not guessed — where I couldn't verify something, it's
labeled as such.

## Where things stand right now

**PR #970 is fully merged/green.** Nothing pending there — 37 checks pass, 0
fail, 4 intentional deploy-gated skips. Not part of this handoff's scope.

**Uncommitted local changes (3 files, all real, all intentional — nothing
else in the working tree, editor-churn noise already reverted):**
- `apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/ModularPerson.cs` — two root-caused fixes, both live-verified in Play mode (see below).
- `docs/ART_STYLE_GUIDE.md` — retirement notice added at the top (see "Architecture decision" below).
- `docs/ART_DIRECTION_UNITY_WEB.md` — new file, the current canonical art-direction doc.

None of these are committed yet. Review the diff, then commit — I didn't push
anything since it wasn't asked for this round.

**Unity Editor**: was left open and running (project at
`apps/concordia-living-world/unity-client`, Unity 6000.5.9f1) with the
MCPForUnity bridge live and working. If you're picking this up in a fresh
session, it may or may not still be running — check before assuming.

## Architecture decision (owner call, this session — canonical, don't relitigate)

- **Unity, exported to WebGL, is now the canonical World Lens web client.**
  Not a new idea — `scripts/export-unity-web.mjs` (full Unity 6→WebGL
  pipeline, mirrors Godot's serving shape) and `mountUnityGateway`
  (`server/lib/unity-bridge.js`, already mounted in `server.js`) both already
  existed and work. The project's own Editor/WebGL code splits
  (`ConcordClient.cs`, `FreePacks.cs`, `HubKit.cs`, `Assets/Plugins/WebGL/ConcordWs.jslib`)
  confirm it was built with this target in mind from early on.
- **Godot (`world-lens-godot/`) is the presenter/spectator role** — its
  existing read-only spectator viewer, not a full interactive client.
- **Three.js's World Lens renderer (`concord-frontend/lib/world-lens/`,
  `components/world/`, `components/world-lens/`) is retired as canonical.**
  Its `docs/ART_STYLE_GUIDE.md` stylized-BotW/Palworld mandate governed ONLY
  that renderer (confirmed by grep — zero references outside those
  directories + this doc's own tests) and is retired with it. The file still
  exists with a retirement banner at the top — don't delete it, don't revive
  its mandate for Unity.
- **The direction for Unity is photorealistic**, reversing the old
  `ART_DIRECTION_AUDIT.md` "photorealism explicitly rejected" call — that
  call was scoped to the Three.js renderer specifically, for reasons that
  don't bind Unity. See `docs/ART_DIRECTION_UNITY_WEB.md` for the full
  reasoning and the acquisition-list audit.
- **The game's systems are untouched by any of this.** Quests, combat,
  economy, NPC AI all live server-side (`server/emergent/`, `server/domains/`)
  and are client-agnostic. This pivot only changes which client draws the
  pixels.

## What's fixed and verified live tonight

Both of these were root-caused and confirmed by actually running the game in
Unity Play mode (`ConcordiaHub.unity` scene), not just reasoned about from
source. Verification steps are worth reading if either regresses.

### 1. Hero/NPC world-appropriate body casting (`ModularPerson.cs:265`, `LoadPersonPrefab`)

- **Bug**: `ModularPerson.CastingWorld` was set per-world by `WorldBuilder.cs`
  but never *read* anywhere — every world (Fantasy, Tunya, Ruins, all of
  them) got the same Rocketbox photoreal adult body, whose baked texture is
  business-casual civilian wear (it's a Microsoft crowd-sim asset). That's
  the actual mechanism behind the "polo-shirt hero" complaint.
- **Why not just tint it**: checked live — Rocketbox bakes skin AND clothing
  into one continuous texture with no separate cloth UV region, so a
  multiplied color tint would also discolor visible skin. Real dead end, not
  a shortcut I skipped.
- **Fix**: `LoadPersonPrefab` now branches on `CastingWorld` — `Hub` keeps
  Rocketbox (the one world with textual grounding as "modern/neutral" per
  the retired style guide's own saturation table), every other world prefers
  the already-in-project, already-painted **KayKit Knight**
  (`Models/kaykit/adventures/gltf/Knight.glb`), falling back to Rocketbox
  honestly if Knight is ever missing. Resolves via `FreePacks.Mesh`, which
  works in both Editor and the real WebGL build.
- **Caveat, in the code comment too**: whether every non-Hub world is
  genuinely "knight-coded" is a first-pass call, not verified lore — Cyber
  and Crime in particular could plausibly want a modern body too. Worth a
  tuning pass once there's real per-world casting content.
- **Verified live**: entered Play mode on `ConcordiaHub`, confirmed the Hub
  hero still renders as Rocketbox (correct — Hub is the one exception) and
  that `ModularPerson.CastingWorld != WorldId.Hub` path compiles/resolves
  cleanly. Did **not** yet verify the Knight path visually (would need to
  force-spawn in a non-Hub world) — that's a real next step if you want full
  confidence on this fix.

### 2. Oversized-sword bug (`ModularPerson.cs:1249`, `MakeSword`)

- **Bug**: not a scale-math bug — `FreePacks.FitMax`'s uniform-scale-to-1.05m
  logic is correct. The Kenney `weapon-sword.glb` mesh it fell back to is
  chibi-proportioned (width = 52% of its length); scaling that up to a
  realistic 1.05m length drags the already-fat width/thickness up with it,
  reading as a giant slab.
- Also confirmed live: `FreePacks.Mesh("longsword")` — tried first in the
  original code — **resolves to nothing**. Every hero was silently falling
  through to the Kenney mesh.
- **Fix**: added `FreePacks.Mesh("Sword16")` to the fallback chain before the
  Kenney mesh. `Sword16` is a real, already-in-project mesh from `MYFG-Weapon
  Pack Lite` (`Assets/MYFG-Weapon Pack Lite/Meshes/Sword16.FBX`) — measured
  live at a 0.14 width/length ratio vs. Kenney's 0.52.
- **Verified live**: screenshot confirms a properly-proportioned blade
  hanging at the hero's side; live component inspection confirmed
  `sharedMesh` = `Sword16.FBX` and `localScale` settled to ~0.97 (near 1:1,
  since Sword16's native size is already close to the 1.05m target).

### 3. "Floating NPCs" — investigated, NOT a real bug (false alarm, self-corrected)

A screenshot early in the session looked like every NPC/the player was
floating above the ground (shadows offset from feet). Before reporting it as
a bug I measured it directly:
- `CharacterController.isGrounded = true`
- The mesh's actual world-space bounds bottom sat right at the terrain
  surface (matching `Grounding.Snap`'s deliberate 4cm skin offset exactly)
- A follow-up screenshot after physics settled showed feet and shadow
  correctly planted

Conclusion: the first screenshot caught a mid-stride animation pose or a
spawn-frame transient, not a structural bug. **Don't "fix" `Grounding.cs` —
it's working correctly**, confirmed by direct measurement, not just a second
look.

## Open items / next steps, prioritized

1. **Verify the Knight-casting fix visually** in a non-Hub world (force
   `ModularPerson.CastingWorld` to e.g. `WorldId.Fantasy` and check the
   spawned body/outfit actually looks right, not just that it compiles).
2. **Unidentified small floating dark object** — appeared consistently in
   two screenshots near the player in the Hub plaza. Filtered ~1,241 world
   renderers for small+elevated+nearby matches; only hit was a `LanternGlow`
   prop whose position doesn't match what was visible on screen. Left
   unresolved — minor, likely VFX, but not confirmed.
3. **World-count discrepancy**: `Canon.cs`'s `WorldId` enum has **10** worlds
   (Hub, Ruins, Tunya, Fantasy, Crime, Cyber, Frontier, Superhero, Crucible,
   **Sere**). The retired Three.js style guide's own saturation table only
   lists **9** — `Sere` is missing from it entirely. Not urgent now that the
   guide is retired, but worth a note if anyone later mines that doc for a
   world list.
4. **Acquisition list** (see `docs/ART_DIRECTION_UNITY_WEB.md` for full
   detail): 4 of ~20 named packages spot-checked and confirmed real (Kevin
   Iglesias Human Basic Motions FREE, Synty Sidekick Starter Pack FREE, KHS
   Korean-heritage architecture family, Slavic Medieval Environment). Two
   numeric claims in the original doc were wrong (9 vs 10 worlds; "200+ Hub
   buildings" vs. the code's real 100-per-city target with the Hub itself
   having ~zero). ~16 more named packages are still **unverified** — don't
   treat the rest of that list as vetted.

### Weather-visuals binding (done this continuation)

`WorldClock.Weather` now drives precip + fog + sun dim. Build-time
`PlaceWeather("rain"|"snow")` in `WorldBuilder.DressSky` / `WorldKit.Accents`
was one-shot from `Canon.WorldDef.weather`, so Crime rained forever and the
kernel's "weather shifted" line was HUD-only. Identity fireflies (Hub / Tunya
/ Fantasy) are unchanged. Play-mode visual confirm still outstanding — Hub
starts `clear`, so either travel to Crime or force `WorldClock.Weather`.

## Environment gotchas worth knowing about

- **MCPForUnity stale-registration bug**: if `mcpforunity://instances` flaps
  between "found it" and "not found" / returns a project you're not even
  running, check `~/.unity-mcp/` for leftover `unity-mcp-status-<hash>.json`
  / `unity-mcp-port-<hash>.json` files from OTHER projects with dead
  heartbeats, and a stale `unity-mcp-port.json` (no hash) pointing at one of
  them. Delete the dead ones; the live Editor regenerates its own
  registration fine. This cost real time tonight before being root-caused.
- **Don't edit a `.cs` file while Unity is mid-compile.** Did this once
  tonight and it wedged the Editor's domain-reload pipeline hard enough that
  a full process kill + relaunch was needed (confirmed via 0% CPU across all
  shader-compiler/import-worker processes for 45+ minutes with zero log
  growth — genuinely hung, not just slow).
- **`tsc --noEmit` without memory headroom can OOM-crash** on this codebase
  (`EXIT_CODE=134`, V8 heap fatal error at ~4GB) — that's an environment
  artifact, not a real type error. Use the project's own
  `NODE_OPTIONS='--max-old-space-size=8192' tsc --noEmit`
  (matches `concord-frontend/package.json`'s `type-check:ci` script) before
  concluding anything about type-check status.
- **execute_code (UnityMCP) needs CodeDom-compatible C# 6 syntax** unless
  Roslyn is installed in this project (it isn't) — no `using` directives (the
  snippet runs as a method body), no `default` literal, no local functions
  after a `return`. Explicit types and old-style `new Bounds()` instead.

## Useful facts for resuming live verification

- Scene to load: `Assets/Scenes/ConcordiaHub.unity`. Its only authored roots
  are `Directional Light` and `ConcordiaGame` — everything else (Player,
  World with ~900 children, NPCs, etc.) is built procedurally at Play-mode
  start by `WorldBuilder`/`ConcordiaGame`.
- Hero body: `find_gameobjects` for `"Person"` → its `ModularPerson`
  component exposes `rightHand`/`leftHand`/`sword` object references
  directly (useful — no need to walk the hierarchy by hand).
- Screenshots: use `manage_camera` action `screenshot` with `output_folder`
  set to something OUTSIDE `Assets/` (e.g. `Captures`) — saving into
  `Assets/Screenshots` triggers an asset-database reimport that can look
  like another hang.
