# Visual QA — Godot World Lens

## GlbLoader cache made process-shared, not per-instance (2026-08-07, Phase M4)

Not a rendering claim — a consistency/efficiency fix, recorded here anyway
since every phase this session has updated this file. Read
`assets/glb_loader.gd` directly against its two real call patterns:
`scene_bootstrap.gd` avoids per-instance redundancy itself (one `GlbLoader`
per building ARCHETYPE, fanned out to every pending building of that
archetype via `_pending_upgrade`), but `avatar_rig.gd` creates a fresh
`GlbLoader.new()` — and therefore a fresh, empty `_cache` — per AVATAR, for
both the body and weapon fetch. Since every avatar resolves to the same
"warrior" archetype today (no per-avatar signal exists yet), N
simultaneously-visible avatars would each independently download and parse
the identical multi-MB GLB.

Fix: `_cache` is now `static` (`assets/glb_loader.gd`), shared across every
instance's process lifetime — safe, since these URLs serve static assets
that never change at runtime. Verified with a real engine-executed test
(`tests/test_glb_loader.gd`, new): a URL cached via one `GlbLoader`
instance is a genuine hit on a completely separate instance, and an
never-loaded URL is still honestly absent (never a fabricated hit).

**What this does NOT fix, on purpose:** the "thundering herd" case — many
avatars requesting the SAME not-yet-cached URL in the same tick (e.g.
joining a world where many players are already present) still fire N
simultaneous redundant fetches, since the cache only populates once the
first fetch completes, not at request time. A real fix needs in-flight-
request tracking + subscriber fan-out (generalizing scene_bootstrap.gd's
`_pending_upgrade` pattern into `GlbLoader` itself) — a real behavior
change several call sites depend on, flagged as a named follow-up rather
than attempted here.

## Real GLB meshes now get the outline pass too — reaches the mesh, subtler than the synthetic-box proof (2026-08-07, Phase S3)

Before touching anything, read `world/scene_bootstrap.gd#_upgrade_one_node`
directly rather than assuming Phase S1/S2's toon+outline work reached real
assets. It didn't: a real building GLB is parented as a child of the
placeholder `MeshInstance3D` whose `material_override` carried the toon/
outline material — once the placeholder's own `mesh` is set to `null`,
that material has nothing left to apply to, and the real GLB clone's own
baked materials (imported straight from the `.glb`) render completely
untouched, bypassing the shared art style entirely. The same was true for
avatar bodies and Phase M1's weapon GLBs.

**Fix** — `ArtStyle.apply_outline_to_tree(root, world_id)`: walks a loaded
GLB's tree and gives every mesh surface the outline `next_pass`, without
touching albedo/texture — each surface's own active material is
`.duplicate()`d (never mutating the GLB's own shared/cached resource) and
the duplicate gets `next_pass` pointed at the world's outline material.
Wired at the three points a real GLB actually resolves: `scene_bootstrap.gd
#_upgrade_one_node` (buildings), `avatar_rig.gd#_on_glb_loaded` (bodies),
`avatar_rig.gd#_on_weapon_glb_loaded` (weapons). Deliberately does NOT
force the flat toon-ramp material onto real meshes — see this file's Phase
S3 planning note for why that's separate, bigger, and not attempted here.

**A real GDScript bug was caught by actually running this, not by
review**: the first version used `n.get_active_material(i)` inside a loop
typed `var n: Node`, guarded by `if n is MeshInstance3D`. GDScript's static
analyzer does not narrow a variable's type from an `is` check for
subsequent method calls — this is a real language quirk, not a typo — so
the real engine's compiler correctly rejected it (`Parser Error: Cannot
infer the type of "base" variable`), which cascaded into ALL of `art_style
.gd` failing to compile, which cascaded into `test_art_style.gd` reporting
a silent, misleading **`[PASS] ArtStyle (0 checks)`** (a compile failure
elsewhere left its `run()` never actually executing, and an empty
failure-list still reads as "pass" to the harness). Fixed with an explicit
`as MeshInstance3D` cast; the suite is back to 33/33 green, `ArtStyle` now
76 checks. Flagging the 0-checks failure mode itself: a suite reporting
"PASS" with zero checks is a `run()` that never ran, not a suite with
nothing to test — worth grep-ing for `(0 checks)` specifically, not just
`FAIL`, when trusting this harness's output going forward.

**Real engine, real GLB, real pixels — an honest, more nuanced result than
Phase S2's box.** `tools/glb_outline_probe.gd` loaded the real
`tavern.glb` (confirmed: `surfaces_touched: 4`, matching its real surface
count) with and without the outline pass and screenshotted both, close-up.
Unlike Phase S2's synthetic box (where the outline was immediately obvious
at a glance), the effect on this real architectural asset is genuinely
subtle — a faint darkening along some roofline edges, visible on close
side-by-side comparison but easy to miss, not the crisp border the box
showed. This is a real, honestly-observed difference from the earlier
result, not a weaker rehash of it: `OUTLINE_WIDTH_M = 0.018` (1.8cm) was
proven to work correctly as an absolute metre value on a ~1.2m box (≈1.5%
of the object's size); on a multi-metre building it's a much smaller
fraction of the silhouette, so a thinner, subtler line is the
mathematically-consistent result of the SAME constant applied to a larger
object — and `docs/ART_STYLE_GUIDE.md` explicitly locks this as "one
outline weight for everything... never per-asset," so a flat absolute
width reading as more subtle at architectural scale may be the intended
consequence of that rule, not a defect. Recorded here as an open question
rather than resolved either way: **whether large-scale assets need a
distinct, still-shared outline treatment (e.g. a screen-space-constant
outline instead of a world-space one) is a real design call for a human to
make, not something this pass decided unilaterally.**

Reproduce:
```
python3 -m http.server 8998 --bind 127.0.0.1 &   # from concord-frontend/public/
CONCORD_GLB_URL=http://127.0.0.1:8998/models/building/tavern.glb \
xvfb-run -a -s "-screen 0 1280x720x24" .godot-runtime/bin/godot \
  --path world-lens-godot --display-driver x11 --rendering-driver opengl3 \
  --script res://tools/glb_outline_probe.gd
# then compare /tmp/glb_outline_probe_with.png vs _without.png
```

## Outline + rim light — the last two named ART_STYLE_GUIDE.md pieces, outline VISUALLY confirmed (2026-08-07, Phase S2)

Closes the exact gap this file's own checklist named ("No outline/rim-light
shader exists for silhouette_color specifically") and the last two pieces
of the BotW reference `docs/ART_STYLE_GUIDE.md` cites ("rim-lit — rim light
fakes subsurface").

**Outline**: `ArtStyle.OUTLINE_SHADER` is the standard inverted-hull
technique — a vertex pass pushes `VERTEX += NORMAL * outline_width`, then
`cull_front` + `unshaded` render mode leaves only the expanded shell's
back-faces visible, which poke out past the real mesh's silhouette on every
edge. Wired via `Material.next_pass` (Godot's own built-in second-pass
mechanism) directly onto `make_toon_material()`'s output, so `world_id ->
outline` needs no new call-site changes anywhere — Phase S1's two spawn
paths (building placeholder boxes, avatar primitive capsules) get real
outlines automatically, already-shipped code included. Uses the SAME
`outline_width_m()`/`outline_color()` constants that existed (correct,
tested) since before this shader did — this pass gave them a shader to
finally drive.

**Rim light**: a fresnel term (`pow(1 - dot(N,V), RIM_POWER) * RIM_STRENGTH`)
added to the toon shader's `fragment()` as `EMISSION`, additive on top of
the existing banded `light()` ramp — never replacing it. Keyed off each
world's own light-band colour (not a separately-tunable colour that could
drift from the palette), per two new spec-driven constants
(`RIM_STRENGTH`/`RIM_POWER`) through the same generated-JSON pipeline as
everything else in this file.

**Real engine, real pixels — not just property values this time.**
`tools/outline_shader_probe.gd` rendered the SAME toon-shaded box twice
(once with the real `next_pass` outline, once with it stripped) under a
real `Xvfb` + `llvmpipe`/Compatibility-renderer session and saved both
frames. Looked at both directly: the "with outline" frame shows a crisp,
unmistakable dark border tracing the box's silhouette; the "without" frame
has a plain edge with none. Unlike Phase S4's SDFGI (a Forward+/Vulkan-only
feature that measurably did NOT activate under this sandbox's Compatibility
render path), an inverted-hull outline is basic geometry+cull-mode
manipulation with no renderer-tier dependency — and this run proves it:
**this is the first claim in this whole Godot effort settled by actually
looking at the rendered pixels, not by property-level engine assertions
alone.** (My own crude same-probe pixel-count heuristic — counting near-
black pixels — showed almost no difference between the two frames and
would have wrongly read as inconclusive; the palette's shadow band was
already dark enough for a naive luma threshold to miss the outline against
it. Looking at the actual images caught what the cheap metric didn't.)

Rim light was verified only at the property level this pass (shader
parameters reach the material correctly, pinned by `tests/test_art_style.gd`)
— its visual contribution is subtle by design (a thin fresnel highlight,
not a dominant effect) and reads best on curved geometry under real
lighting; a dedicated visual check is a smaller, lower-priority follow-up,
not done here.

Reproduce the pixel-level outline check:
```
xvfb-run -a -s "-screen 0 1280x720x24" .godot-runtime/bin/godot \
  --path world-lens-godot --display-driver x11 --rendering-driver opengl3 \
  --script res://tools/outline_shader_probe.gd
# then open /tmp/outline_probe_with.png vs /tmp/outline_probe_without.png
```

## Toon material coverage — the real cel shader now actually reaches spawned geometry (2026-08-07, Phase S1)

**A real, significant gap found while starting the graphics push**: `ArtStyle.
make_toon_material()` (the real, tested, engine-verified toon shader) was
called in exactly ZERO live spawn paths before this pass — only from test/
QA-tool scripts. Every actually-spawned mesh in the running client used
Godot's plain engine-default material or its own baked GLB material:
`world/scene_bootstrap.gd`'s placeholder building box had no material
assignment at all, and `avatar/avatar_rig.gd`'s primitive capsule limbs
(the very first thing any avatar shows before/unless a GLB resolves) were
the same. This is a big part of why today's earlier browser screenshots
show flat, unstyled grey/olive shapes rather than the cel-shaded look the
shader itself has been correct and tested for all along — the shader was
real, but nothing was pointing a live mesh at it.

Fixed both spawn paths, threading `world_id` the same way every sibling
controller already does (`SceneBootstrap` gained the field; `boot.gd` now
sets `_bootstrap.world_id = world_id` alongside its existing `_aerial_
traffic.world_id`/`_avatar_manager.world_id` wiring). Both degrade
honestly: `make_toon_material` returning null (spec unavailable) leaves the
mesh on Godot's default rather than fabricating a color.

**Real-engine evidence, not asserted:** `tools/toon_material_coverage_probe.gd`
spawns a real `SceneBootstrap` node (via `apply_scene`) and a real
`AvatarRig` (primitive path), then reads the actual `MeshInstance3D.
material_override` back off each. Both are confirmed to be the real
`ShaderMaterial` with the exact same `Shader` resource `ArtStyle.
toon_shader()` returns (object identity, not a look-alike), and the box's
`band_shadow` shader parameter matches `cyber`'s real palette exactly —
proving the SPAWN PATH reaches the correct per-world material, not just
that the accessor function works in isolation (already pinned separately
by `tests/test_art_style.gd`).

**Explicitly NOT done this pass, and why:** the ground plane
(`world/boot.gd`) was deliberately left off this fix — it already carries a
real terrain photo texture (`assets/terrain_texture_loader.gd`, a separate
2026-08-07 addition) via `StandardMaterial3D.albedo_texture`, a property
`ShaderMaterial` doesn't have. Swapping it to the toon material would
silently break that texture rather than compose with it; giving the toon
shader a texture-sampling uniform is real, separate shader work, not a
one-line material swap — flagged, not silently skipped. Real GLB meshes
(building archetypes, hero meshes) also keep their own baked materials
untouched this pass — overriding a multi-surface imported mesh's materials
wholesale is a bigger, higher-risk change than the two placeholder paths
fixed here and deserves its own visual verification pass.

Reproduce:
```
.godot-runtime/bin/godot --headless --path world-lens-godot --script tools/toon_material_coverage_probe.gd
```
(`--headless` alone is sufficient here, no `xvfb-run`/rendering driver
needed — this probe reads material/shader *identity*, not pixels, unlike
the rendered-pixel probes elsewhere in this file.)

## Real-time GI + post-processing dials — wired and property-verified; visible-difference claim stays in the human-eyes queue (2026-08-07, Phase S4)

Context: the user asked for the graphics level of a photoreal reference
screenshot (Escape-from-Tarkov-tier). Checked `docs/ART_STYLE_GUIDE.md`
directly — Concordia's art direction is a **locked, deliberate** choice
(BotW lighting + Palworld forms, toon ramp) picked specifically to avoid
that exact photoreal comparison. Put to the user explicitly; they chose to
push the stylized direction further rather than pivot to PBR realism. This
entry is that push: real-time GI + post-processing composited ON TOP of the
existing toon material, not a fork away from it.

`concord-frontend/lib/world-lens/concordia-theme.ts`'s `ART_STYLE` block
gained 6 new numeric constants (`SDFGI_ENABLED`, `GLOW_ENABLED`,
`GLOW_STRENGTH`, `SSAO_ENABLED`, `SSAO_INTENSITY`,
`COLOR_ADJUSTMENT_ENABLED`) through the SAME generated-spec pipeline
(`scripts/gen-art-style-spec.mjs` → `art_style.json`) the four locked
constants already use — never hand-typed into the GDScript side.
`world/art_style.gd#make_environment()` now sets the corresponding real
Godot `Environment` properties (`sdfgi_enabled`, `glow_enabled`/
`glow_strength`, `ssao_enabled`/`ssao_intensity`,
`adjustment_enabled`/`adjustment_saturation`). The color-adjustment pass
deliberately reuses `saturationForWorld()` — the SAME per-world dial every
other pass already reads — rather than introducing a second, independently
tunable saturation number.

**Machine-verified, real engine, not asserted:** `tests/test_art_style.gd`
now constructs a REAL `Environment` via `make_environment()` under the real
Godot 4.4 test runner and reads its actual properties back — `sdfgi_enabled
== true`, `glow_strength == 0.6`, `adjustment_saturation` matching each
world's real `WORLD_SATURATION` entry (0.62 for crime, 1.35 for cyber),
etc. This is stronger than a unit test of the accessor functions alone: it
proves the values actually reach a real engine resource, not just that the
JSON round-trips.

**What remains genuinely unsettled, and why:** whether SDFGI/glow/SSAO
produce a VISIBLE pixel difference could not be determined in this
environment. A dedicated probe (`tools/env_gi_probe.gd`) rendered the same
toon-shaded test scene twice — once with the new dials on, once forced
off — and measured real framebuffer luma: **0.8897 (on) vs. 0.8907 (off), a
~0.1% difference**, i.e. no measurable effect. This is an honest negative
result, not a bug being hidden: `project.godot` configures
`renderer/rendering_method="forward_plus"` for desktop, but Godot 4's
Forward+/Mobile renderers require Vulkan — `--rendering-driver opengl3`
(the flag every headless verification tool in this repo uses, including
this one) forces the **Compatibility** renderer regardless of that project
setting, and SDFGI specifically is a Forward+-only feature. The near-zero
delta is consistent with GI genuinely not activating under Compatibility,
not with the wiring being broken (which the Environment-property tests
above already rule out independently). This is the same class of gap
VISUAL_QA.md's own "why software rendering still cannot settle most of this
file" section already documents for other GPU-only claims — it needs a real
Vulkan-capable GPU session, not more code.

Reproduce the property verification (real engine, works today):
```
.godot-runtime/bin/godot --headless --path world-lens-godot --script tests/run_all.gd
```
Reproduce the inconclusive visible-difference probe (documents the limit,
not a pass/fail gate):
```
xvfb-run -a -s "-screen 0 1280x720x24" .godot-runtime/bin/godot \
  --path world-lens-godot --display-driver x11 --rendering-driver opengl3 \
  --script res://tools/env_gi_probe.gd
```

## Weapon-in-hand — real GLB weapons now attach to real avatars (2026-08-07, Phase M1)

`assets/asset_resolver.gd` gained `ARCHETYPE_WEAPON` (a small, freshly-authored
table — NOT a port; the Three.js client's weapon selection keys off a
different axis, `character-schema.ts`'s body/faction-style `carryDefault`,
which has no existing mapping onto the 7 occupation-flavoured hero
archetypes this file resolves bodies against) mapping warrior→longsword,
guard→spear, hunter→bow, mystic→staff, legend→greatsword (the one place the
two axes do overlap — `enhanced-avatar-builder.ts`'s `bodyArchetype ===
'legend' ? 'greatsword' : 'longsword'`), scholar/trader→none (honest: no
real weapon GLB exists for tome/satchel carry items, so "no weapon" is the
correct answer, not a fabricated blade). `avatar/avatar_rig.gd` resolves
this independently of the body GLB (a weaponless archetype is a real
answer, not a failure) and attaches the result to a `BoneAttachment3D` on
the real skeleton's hand bone when found, falling back to the primitive
placeholder's `rightForearm` socket otherwise — re-homing an already-
attached weapon if the body GLB resolves after the weapon does (the two
fetches race independently from `_ready()`).

**The hand-bone name was found by running the real engine, not guessed.**
A new `tools/avatar_bone_probe.gd` loaded `_archetype_warrior.glb` under a
real Godot 4.4 + Xvfb/llvmpipe session and dumped its actual skeleton: 80
real bones, Microsoft Rocketbox/3ds-Max **Biped** naming (`"Bip01 R Hand"`,
`"Bip01 R Forearm"`, ...) — **not** Mixamo naming, despite this file's own
prior "Mixamo humanoid" shorthand for these assets. Using a guessed
Mixamo-style name (`"mixamorig:RightHand"`) here would have silently missed
every real skeleton and fallen through to the primitive socket on every
avatar — an honest failure, but a needless one the probe caught for free.

**Real-engine evidence for the attach itself, not just the bone name:** a
new `tools/weapon_attach_probe.gd` instantiates a real `AvatarRig` (real
HTTP fetch of a real GLB via the real `AssetResolver`/`GlbLoader` pair, no
mocks) and reports what actually happened after both async fetches settle.
Four archetypes checked live, against a real static file server over
`concord-frontend/public/`:

| archetype | body resolved | weapon attached | weapon parent | mesh instances |
|---|---|---|---|---|
| warrior | glb | yes | `BoneAttachment3D` | 1 |
| scholar | glb | **no** (honest — no table entry) | — | 0 |
| legend | glb | yes | `Node3D` (primitive socket) | 1 |
| mystic | glb | yes | `BoneAttachment3D` | 1 |

The `legend` row is a real, honestly-observed finding, not a bug: that
archetype's GLB resolved to a body mesh whose skeleton does NOT contain
`"Bip01 R Hand"` (a different/bespoke rig from the other archetypes — the
CREDITS.md-documented "first-hero" meshes are sourced separately from the
shared archetype set), so the dual-fallback correctly degraded to the
primitive's forearm socket instead of silently failing to attach at all.
This is exactly the value of verifying against the real per-archetype
assets instead of assuming they share one rig.

**What this does NOT settle:** whether the attached weapon's *position/
orientation* on the hand looks right at a glance (no offset/rotation tuning
has been done — it rides the bone's raw transform), and the full live path
(`city:positions` → `AvatarManager._spawn_rig` → this exact code, inside a
real browser Web export with a second connected user) — same queued item as
the "Avatars" section above, now also covering weapons.

Reproduce:
```
node scripts/fetch-godot.mjs   # or confirm .godot-runtime/bin/godot already present
python3 -m http.server 8998 --bind 127.0.0.1 &   # from concord-frontend/public/
CONCORD_ASSET_BASE_URL=http://127.0.0.1:8998 CONCORD_WEAPON_PROBE_ARCHETYPE=warrior \
xvfb-run -a -s "-screen 0 1280x720x24" .godot-runtime/bin/godot \
  --path world-lens-godot --display-driver x11 --rendering-driver opengl3 \
  --script res://tools/weapon_attach_probe.gd
```

## Vegetation/creature meshes — genuinely no placement data exists yet (2026-08-07, scope note)

Before starting the "meshes" pass, checked directly (not assumed) whether a
real placement-data feed exists for the vegetation (6 GLBs) and creature (4
GLBs) libraries already sitting in `concord-frontend/public/models/` unused
by Godot. Neither does, confirmed by reading the actual code, not a doc:
- `server/lib/scene-export.js#exportScene`'s full return shape is
  `{nodes (buildings only), bounds, districts, plaza, landingPads}` — no
  vegetation/prop array. `content/world/concordia-hub/city-layout.json`'s
  top-level keys are `{worldId, format, conceptsByDistrict, buildings,
  landingPads}` — no vegetation field either.
- `server/lib/city-presence.js`'s `city:npcs` broadcast — which would have
  been the natural live-position feed for creatures — was **deliberately
  retired server-side** (`DET-C batch 8 investigation, 2026-07-23`, that
  file's own comment); `world/boot.gd`'s own header explicitly documents
  why it isn't subscribed to. No replacement fauna/creature broadcast
  exists (`realtimeEmit("fauna...`/`realtimeEmit("creature...` — zero
  matches anywhere in `server/`).

Building an asset-aware `PropInstancer` with nothing real to feed it would
produce infrastructure with no live path to verify end-to-end, and inventing
placement coordinates client-side would be exactly the fabrication this
project's honesty invariant exists to prevent. Left for a follow-up pass:
vegetation is a small, legitimate CURATION addition (author a real
`vegetation` array in `city-layout.json`, mirroring the existing
`landingPads` pattern, then wire it into `exportScene` the same additive
way `plaza`/`landingPads` already are); creatures need a genuine new
backend surface (a live position broadcast for the existing server-side
fauna simulation) — bigger, deliberately not started without being called
out explicitly first.

**Updated 2026-07-25 — this project HAS now been run in a real Godot engine.**
The previous header ("has never been opened in a real Godot editor or renderer",
"the agent proxy blocks the Godot headless binary download") is **superseded**: a
verified **Godot 4.4.stable.official.4c311cbee** binary was acquired and run
against this project. Full record — acquisition commands, checksums, real engine
output, licensing, and the CAN/CANNOT-verify table — is in
**`docs/GODOT_RUNTIME.md`**.

What that changed:

- **Engine-level validation is no longer a human-eyes item.** It is machine-checked
  and reproducible (§ *Machine-verified* below).
- **It immediately found real defects** that `gdlint` structurally cannot see: a
  missing required argument that meant the whole GDScript test suite had never
  compiled, plus — once the suite could finally run — 4 failing test suites and 1
  runtime type error. See `docs/GODOT_RUNTIME.md` §3.4. Those were logic bugs, not
  visual QA, and are **now fixed**: the suite currently runs **26/26 suites green**
  with no runtime type error in the engine log.
- **Export is now machine-verified too** (2026-07-25). The project has a real
  `export_presets.cfg` and a headless `--export-release` genuinely produces a
  runnable Linux binary and a Web/WASM bundle. Read the limit of that claim
  carefully: **export proves PACKAGING, not APPEARANCE.** Nothing below moved out
  of the human-eyes queue because of it except the packaging item itself.

**Superseded again, 2026-07-25 (second pass): PIXELS ARE NOW MACHINE-CHECKED.**
The claim that stood here — "headless Godot installs `RasterizerDummy` and draws
nothing at all, so every rendering claim needs eyes on a real machine with a
GPU" — was half right and half a wrong inference. `--headless` really does draw
nothing. But headless is not the only option without a monitor: Godot renders
for real against a **virtual X display** (`Xvfb`) on Mesa/**llvmpipe**, and a
`SceneTree` script can pull the framebuffer back with
`get_root().get_texture().get_image()`. `scripts/visual-qa.mjs` does exactly
that and asserts on the resulting pixels. See § *Machine-verified — rendered
pixels* below for what that genuinely settles, and § *Why software rendering
still cannot settle most of this file* for the much longer list of what it
does not.

"The project imports and every script compiles", "something is drawn and it is
geometrically correct", and "it looks right" are three different claims. The
first two are now settled. The third is not, and mostly cannot be by a machine.

This file remains the queue of every claim that requires **eyes on a real
machine**. **No document in this repo — including `docs/GODOT_INTEGRATION.md` —
makes any visual-quality claim. All such claims live only here, unverified, until
checked off below.**

## Browser (Web export) — real client, real server, zero errors (2026-08-07)

**The Godot Web export now loads and runs end-to-end in a real headless
Chromium browser, against a real Concord server, with zero console errors.**
Not the headless-native rasterizer used elsewhere in this file — a real
`chromium.launch()` (Playwright, the same browser this repo's own e2e suite
uses), loading `/godot-client/index.html` from a real `next dev` server, with
`CONCORD_GATEWAY_URL`/`CONCORD_GODOT_AUTH_TOKEN`/`CONCORD_WORLD_ID` passed as
query params on a real registered user against a real spawned `server.js`
(fresh migrated DB). Console log for the final run: engine boot, WebGL init,
`[boot] gateway socket open`, `[boot] authenticated as <uid>`, `[boot] joined
room world:concordia-hub` — **and nothing else**. No CSP violation, no fetch
error, no GLTF parse error. This is a real milestone, not a synthetic one:
getting here required finding and fixing four separate, real defects, each
found only by actually loading the page in a browser rather than reasoning
about it:

1. **The app's own auth middleware 307'd the Godot export to `/login`.**
   `concord-frontend/middleware.ts`'s `STATIC_ASSET_RE` (the extension-based
   static-file allowlist) doesn't cover `.html`/`.js`/`.wasm` — too broad a
   carve-out for the app generally — so every file in the export, including
   `index.html` itself, was gated behind a session cookie. Fixed by adding
   `/godot-client/` to `PUBLIC_PREFIXES` (same pattern as the pre-existing
   `/meshes/`, `/textures/` entries). Pinned by `concord-frontend/tests/
   middleware.test.ts`.
2. **The app's `strict-dynamic` CSP refused Godot's own un-nonced `<script>`
   tags outright**, and separately refused `JavaScriptBridge.eval` (the
   first-attempt way to read `window.location.search` for runtime config)
   because the CSP has `wasm-unsafe-eval` but not the much broader
   `unsafe-eval`. Fixed on two fronts: `index.html` is no longer a static
   `public/` file at all — `scripts/export-godot-web.mjs` now exports into a
   gitignored staging dir and `app/godot-client/index.html/route.ts` serves
   it, injecting the current request's real CSP nonce into both `<script>`
   tags at request time. Runtime config (gateway URL, auth token, world id,
   frontend asset origin) is passed a completely different way — server-side,
   spliced into the exported `GODOT_CONFIG.args` array as `-- KEY=VALUE`
   entries, read on the Godot side via `OS.get_cmdline_user_args()`
   (`world/boot.gd#parse_key_value_args`) — needing no CSP relaxation at all,
   since Godot's own bootstrap already passes that array to the WASM
   module's argv unconditionally. Pinned by `concord-frontend/tests/
   godot-client-route.test.ts` and `world-lens-godot/tests/
   test_boot_runtime_config.gd`.
3. **The app's CSP `connect-src` (`'self' https: wss: ws:`) refused a
   cross-origin plain-http fetch**, and separately Godot's own
   `HTTPRequest._parse_url` rejects a schemeless/relative URL outright even
   on Web (`"Error parsing URL: '/models/building/tavern.glb'"`) — so
   neither "point at a different host" nor "use a relative URL" worked in
   isolation. Fixed by having the SAME route handler default
   `CONCORD_FRONTEND_URL` to the request's own real origin whenever the
   caller didn't specify one — `resolveRequestOrigin()` reads
   `X-Forwarded-Host`/`Host` (and `X-Forwarded-Proto`), NOT
   `request.nextUrl.origin`, because that resolved to `"localhost"` under
   `next dev`/Turbopack even when the browser was actually on `127.0.0.1` —
   a real, measured mismatch (verified with an explicit `Host` header on the
   request, which nextUrl.origin still ignored) that is a different CSP
   origin and so was refused by `'self'` anyway. This also fixed a genuine,
   separate correctness bug in `scene_bootstrap.gd`: the original failure
   handler erased the "attempted" sentinel on every failure, so every
   subsequently-spawned building of the same archetype re-triggered a brand
   new fetch — a measured retry storm (hundreds of attempts loading
   concordia-hub). `_on_building_glb_failed` now sets a permanent `"failed"`
   sentinel instead, so a failed archetype is attempted exactly once per
   session.
4. **Godot's gzip response decoder failed mid-stream on Next.js's
   dev-server-compressed responses** (`"Condition 'err != 0 && err != 1' is
   true"` in `core/io/stream_peer_gzip.cpp`), so even a correctly-addressed,
   CSP-clean fetch still failed. Fixed by setting `HTTPRequest.accept_gzip =
   false` in `assets/glb_loader.gd` — trades a larger uncompressed transfer
   for one that actually completes; for a multi-MB GLB fetched once and
   cached, that trade is a clear win over silently never loading.

**What this does NOT settle:** whether the resulting frame, once decoded,
*looks* right at a glance. The screenshot from this exact browser run
predates the camera-framing fix below (the ground plane dominated the wide
shot at the time); that specific defect is now fixed and verified — see
the "Camera framing" entry in the checklist below — but this section
itself is about the pipeline actually working end-to-end in a real browser
against a real server, not a claim about visual polish generally.

Reproduce (see `scripts/export-godot-web.mjs` for the export step):
```
node scripts/export-godot-web.mjs   # exports into concord-frontend/public/godot-client/ + .godot-web-staging/
cd concord-frontend && npm run dev  # or npm run build && npm start
# then load, in a real browser:
#   http://<host>/godot-client/index.html?CONCORD_GATEWAY_URL=ws://<host>:5050/godot-ws&CONCORD_GODOT_AUTH_TOKEN=<jwt>&CONCORD_WORLD_ID=concordia-hub
```

## Avatars — remote/spectated players now resolve a real humanoid GLB (2026-08-07)

Before this pass, every remote player puppet (`avatar/avatar_manager.gd`,
driven from `city:positions`) rendered as `avatar_rig.gd`'s honest capsule
placeholder, permanently — even though `AvatarRig`'s GLB-resolution path
(`assets/asset_resolver.gd` + `assets/glb_loader.gd`) was fully built. Two
real bugs, found by tracing the actual resolve path rather than assuming it
worked because the code existed:

1. **`AssetResolver.fallback_url`'s static convention (`{base}/models/
   {kind}/{id}.glb`) has no matching files for `kind="player"`/`"npc"`** —
   only `kind="building"` has real files on disk. The Three.js client
   already solved this with a real, shipped convention
   (`concord-frontend/lib/concordia/hero-mesh-registry.ts`'s
   `ARCHETYPE_FALLBACK_PATH` + its per-world "archetype-world" variant) —
   `fallback_url` now special-cases `player`/`npc` onto that SAME
   convention (`/meshes/heroes/_archetype_warrior[__<world_id>].glb`)
   instead of inventing a new one. There is no per-user bespoke rig and the
   `city:positions` wire payload carries no occupation signal to pick a
   different archetype from, so every remote/spectated player resolves to
   the shared "warrior" archetype — the same honest default the Three.js
   client itself falls back to absent a more specific signal — with a
   preference for the connected world's palette variant when one exists (6
   of 7 archetypes have one today; a 404 on a missing variant is handled
   exactly like any other GLB load failure, i.e. the primitive placeholder
   stays up).
2. **`world/boot.gd` pointed `AvatarManager.base_url` at the BACKEND
   gateway origin** (`http://127.0.0.1:5050`), not the FRONTEND static
   origin that actually serves `/meshes/heroes/*.glb` — the same mistake
   `SceneBootstrap`'s building-mesh wiring had already correctly avoided by
   using `frontend_asset_base_url`. This bug predates and is independent of
   bug 1: even with a correct fallback URL, every resolve would have 404'd
   against the wrong server. Fixed to reuse the same
   `frontend_asset_base_url` value; `world_id` is now also threaded
   `boot.gd` → `AvatarManager` → `AvatarRig` → `AssetResolver` so the
   per-world variant preference above actually has a world to prefer.

**Real-engine evidence, not assumed:** `tools/glb_load_probe.gd` (the same
tool used to verify the building GLBs) was pointed at the exact file this
new fallback path resolves to for `concordia-hub`
(`_archetype_warrior__concordia-hub.glb` is the per-world variant; the
screenshot below used the universal `_archetype_warrior.glb`, byte-identical
code path) served over plain HTTP, run under a real `Xvfb` + `llvmpipe`
software GL context: `{"ok":true,"mesh_instance_count":1,
"total_vertex_count":4288,...}` — a real, correctly-textured Mixamo humanoid
(denim shirt/jeans, boots, cap), not a garbled or empty mesh. Screenshot
saved to `/tmp/hero-mesh-probe.png` at verification time (not committed —
a build artifact, not source; regenerate with the command below).

Reproduce:
```
python3 -m http.server 8998 --bind 127.0.0.1 &   # from concord-frontend/public/
CONCORD_GLB_URL=http://127.0.0.1:8998/meshes/heroes/_archetype_warrior.glb \
CONCORD_GLB_PROBE_OUT=/tmp/hero-mesh-probe.png \
xvfb-run -a -s "-screen 0 1280x720x24" \
  .godot-runtime/bin/godot --path world-lens-godot \
  --display-driver x11 --rendering-driver opengl3 \
  --script res://tools/glb_load_probe.gd
```

**What this does NOT settle:** this proves the GLB itself loads and
renders correctly through the exact `GlbLoader`/`ArtStyle` path the live
client uses — it does NOT prove the full live path (a real
`city:positions` snapshot → `AvatarManager._spawn_rig` →
`AvatarRig._try_resolve_glb` → this exact URL, inside a real browser Web
export, with a second connected user actually moving) end-to-end; that
needs two simultaneous real sessions and is still queued. Pure-logic
coverage for the new `fallback_url` convention itself is real and
committed: `tests/test_asset_resolver.gd` (5 checks).

## Player physics, collision, and terrain (2026-08-07)

Three previously-honest gaps closed in one pass, each verified against a
real running server, not asserted: real ground collision + per-building
collision (a real `CharacterController` would previously have fallen
through the world forever — `world/boot.gd`'s own prior class doc named
this as the exact reason no local player had ever been spawned), a real
tiled grass texture on the ground plane (previously a flat placeholder
color), and the local player itself — a real physics body, spawned at a
real measured position, with a real humanoid visual, camera-followed.

**Collision.** `world/scene_bootstrap.gd` gained `enable_collision` (off
by default — every existing headless/offline test that spawns synthetic
nodes is unaffected) — when on, each spawned building gets a sibling
`StaticBody3D`/`CollisionShape3D` at the IDENTICAL transform as its visual
`MeshInstance3D`, built the same "unit box + scaled transform" way the
visual box already is. Deliberately a SIBLING, not a reparenting of the
visual node: `_upgrade_one_node`'s real-mesh-upgrade math reads
`mi.transform.basis.get_scale()` directly, so moving that scaled basis
onto a collision-body ancestor would have silently broken it — this was
checked before writing the code, not discovered by breaking it. `world/
boot.gd`'s ground plane gained a matching `StaticBody3D` + `BoxShape3D`
sized to its visual `PlaneMesh` exactly. Pure-logic + engine-executed
tests: `tests/test_scene_bootstrap.gd` (+11 checks — disabled by default,
one body per node at the matching transform with a real `BoxShape3D`, the
visual node's own transform provably untouched, and bodies cleared on
scene re-apply).

**Terrain texture.** New `assets/terrain_texture_loader.gd` (mirrors
`assets/glb_loader.gd`'s exact HTTPRequest shape, including the same real
`accept_gzip = false` fix that file's own header documents) fetches a real
grass photo (`concord-frontend/public/models/terrain/grass.jpg`) and tiles
it across the ground plane's material; the solid placeholder color stays
as the honest fallback on any failure, never a fabricated or broken
texture. No test file (network-dependent, same as `glb_loader.gd` itself —
verified live only, see below).

**Local player.** `world/boot.gd#_spawn_local_player_if_needed` spawns a
real `player/character_controller.gd` (already-existing, already-tested
kinematic movement code — this unit is the first thing that ever actually
mounted it in the live client) exactly once, at a real measured position
(the same robust camera-framing cluster center this session's earlier fix
computes — never a guessed coordinate), dropped from `SPAWN_DROP_HEIGHT_M`
= 80m above it so real gravity integration + `move_and_slide()` settle it
onto whatever real collision is actually there. Mounts a real `AvatarRig`
child for its visual (`avatar/avatar_rig.gd`'s own class doc names this as
its intended local-player mount point) — the SAME real Mixamo humanoid
resolve chain this file's "Avatars" section above already verified, not a
new asset path. `session/camera_rig.gd#set_follow_target` hands the shared
camera to it, so `session/session_manager.gd`'s existing WORLD-mode
FOLLOW behavior (previously dead code — no `CharacterController` had ever
existed to follow) now genuinely activates.

**Real-engine evidence.** New `tools/local_player_probe.gd` loads the
REAL `boot.tscn` against a real running server + real registered user
(same pattern as `tools/live_probe.gd`), finds the spawned
`CharacterController`, and samples its `global_position.y` over many real
physics frames. First run exposed a real timing bug IN THE PROBE, not the
physics: a 120-frame sample window starting immediately at spawn measured
a still-actively-falling body (`first_sampled_y: 112.99`,
`last_sampled_y: 88.62`, `settled: false`) and correctly reported it as
unsettled — physically correct free-fall kinematics (roughly matching
g=9.81 from a ~113m spawn height), just sampled before it had time to
land. Fixed by waiting `FALL_SETTLE_DELAY_FRAMES` (400, ~6.7s) after spawn
before sampling; the corrected run shows the body decelerating into a
dead stop — `tail_max_drift_m: 0.0` across the final 12 samples, i.e.
genuinely, perfectly stationary, not floating or still falling — resting
at `y≈37.4`, well above true ground (the flat plane's top surface is
y=0). This is an honest, undetermined-but-not-fabricated outcome: either
the character landed on a building's collision box near the spawn point
(explicitly anticipated and documented in `_spawn_local_player_if_needed`'s
own comment before this run — "a real, if less common, honest outcome is
landing on a roof at the city center, not a bug") or concordia-hub's
authored building Y-coordinates aren't uniformly ground-level to begin
with; this probe doesn't yet distinguish the two and neither is asserted
as the answer. What IS rigorously established, independent of which: the
body hit something solid and stayed there — it does not fall through the
world forever, which is the actual, previously-open claim this exists to
verify. Screenshot corroborates: the real Mixamo humanoid stands on the
real tiled grass texture with real building placeholders/GLBs visible at
a normal ground-level vantage, and the camera is visibly in third-person
FOLLOW framing (close behind-and-above the character), not the aerial
establishing shot the "Camera framing" checklist entry above describes.

Reproduce:
```
CONCORD_GATEWAY_URL=ws://<host>:5050/godot-ws \
CONCORD_GODOT_AUTH_TOKEN=<real JWT> CONCORD_WORLD_ID=concordia-hub \
CONCORD_FRONTEND_URL=http://<frontend-static-host> \
CONCORD_LOCAL_PLAYER_PROBE_OUT=/tmp/out.png CONCORD_LOCAL_PLAYER_PROBE_FRAMES=1000 \
xvfb-run -a -s "-screen 0 1280x720x24" .godot-runtime/bin/godot \
  --path world-lens-godot --display-driver x11 --rendering-driver opengl3 \
  --script res://tools/local_player_probe.gd
```

**What this does NOT settle:** the exact resting-surface question above;
movement FEEL (WASD/jump/sprint) — the probe never sends input, only
observes the drop-and-settle; and building collision boxes' correctness
for NON-axis-aligned or unusually-shaped footprints beyond what the pure
tests already pin geometrically.

## How to run the QA pass

1. Get the engine: `node scripts/fetch-godot.mjs` (checksum-verified; writes to the
   gitignored `.godot-runtime/bin/godot`). Then `GD=$PWD/.godot-runtime/bin/godot`.
   For the *visual* pass you need this on a machine **with a GPU and a display**.
   To export, also fetch the matching templates (opt-in, 1.12 GiB download; the
   subset below is 626 MB on disk vs. 1.97 GB for all platforms):
   ```bash
   node scripts/fetch-godot.mjs --export-templates --templates-subset linux,web
   ```
2. Re-run the machine checks first — they are fast and they gate everything else:
   ```bash
   $GD --headless --path world-lens-godot --import          # separate pass, always
   $GD --headless --path world-lens-godot --script res://tests/run_all.gd
   ```
   > Never fold the import into a run with `--quit` / `--quit-after 1`
   > ([godot#77508](https://github.com/godotengine/godot/issues/77508)) — import
   > needs more than one iteration and quitting early leaves half-imported state.
2b. Then run the **rendered-pixel** checks — they need no GPU and no monitor,
   only `xvfb`, and they gate the same way:
   ```bash
   node scripts/gen-art-style-spec.mjs --check   # art spec has not drifted
   node scripts/visual-qa.mjs                    # 36 assertions over real frames
   ```
   Read § *Machine-verified — rendered pixels* for exactly what this settles,
   and § *Why software rendering still cannot settle most of this file* for the
   limits. If a golden diff fires, look at the frames in
   `world-lens-godot/.visual-qa/` before assuming either verdict, then
   `node scripts/visual-qa.mjs --update-goldens` if the change is intended.
3. `$GD --path world-lens-godot --editor` (or open the project in the editor) for
   everything below.
4. Point `boot.gd`'s `gateway_url` / `auth_token` / `world_id` at a running
   Concord server **with the gateway mounted** (see the Integration TODO in
   `docs/GODOT_INTEGRATION.md` — the gateway is not mounted yet).

## Machine-verified (no longer needs human eyes)

Reproduce with the commands in `docs/GODOT_RUNTIME.md` §3.5. Engine:
`4.4.stable.official.4c311cbee`.

- [x] **Project imports without errors** — `--headless --import` exits 0, no
      project-attributable errors. (The `progress_dialog.cpp` lines are engine-side
      headless noise: a project containing zero files emits the identical block.)
- [x] **Headless editor open is clean** — `--headless -e --quit` exits 0.
- [x] **All 64 `.gd` files parse and compile** — per-file
      `--headless --check-only --script`, 64/64 clean *after* fixing the `check_eq()`
      arity defect this check found.
- [x] **`boot.tscn` loads as the main scene and `boot.gd::_ready` runs without
      runtime errors** — `--quit-after 60` exits 0. *(Headless caveat: this proves
      the scene instantiates and the script executes. It proves nothing about what
      is drawn.)*
- [x] **No missing-resource / broken `preload` paths** — every `res://` literal in
      every `.gd` and `.tscn` resolves on disk (0 missing). The one apparent miss,
      `res://world/chunks/chunk_`, is the prefix of the runtime format string at
      `world/chunk_manager.gd:32`, not a static path.
- [x] **The GDScript test suite executes** — 26 suites now actually run, and as of
      2026-07-25 **all 26 pass** with no runtime type error in the engine log. (The
      4 failures + 1 runtime type error this check originally surfaced were real,
      and were fixed; see `docs/GODOT_RUNTIME.md` §3.4.)
- [x] **Export templates install and `--export-release` produces a runnable
      build** — `export_presets.cfg` now exists (Linux/X11 + Web). Headless export
      exits 0 and emits `world-lens.x86_64` + `world-lens.pck`; the **exported
      binary was then run**, `boot.tscn` came up clean (exit 0), and the full test
      suite was re-run *from inside the exported PCK* — 26/26 green. A Web export
      also succeeds (41.8 MB `index.wasm` + `index.js`/`index.pck`/`index.html`).
      ⚠️ **Scope of this claim:** it proves the project packs, links against real
      export templates, and the packed game boots and runs its own logic. It proves
      **nothing** about what is drawn — the exported binary was itself run
      `--headless`, so no pixel has been rendered here either.

## Machine-verified — rendered pixels (`scripts/visual-qa.mjs`)

**Reproduce (~7s of render, 22 frames):**

```bash
node scripts/fetch-godot.mjs        # once — engine binary, checksum-verified
node scripts/gen-art-style-spec.mjs # once — derives art_style.json from the TS
node scripts/visual-qa.mjs          # exits non-zero on any failed assertion
```

Under the hood that is one process:

```bash
xvfb-run -a -s "-screen 0 1280x720x24" ./.godot-runtime/bin/godot \
  --display-driver x11 --rendering-driver opengl3 \
  --path world-lens-godot --script res://tools/visual_probe.gd
```

Engine `4.4.stable.official.4c311cbee`, rasterizer **llvmpipe (LLVM 20.1.2)**,
viewport 1152x648. Output frames land in the gitignored
`world-lens-godot/.visual-qa/`; the committed baselines are downsampled
144x81 PNGs in `world-lens-godot/tests/goldens/` (~2-4 KB each, ~55 KB total —
deliberately not full-resolution, see the harness header for why).

**Determinism measured, not assumed:** three consecutive runs produced
**byte-identical** frames for all 22 shots (`md5sum` compared), and every
assertion is therefore exact rather than tolerance-tuned.

**Every assertion below is proven capable of failing.** `--fault=<name>`
injects a specific defect and the run must go red; an assertion that cannot
fail proves nothing:

| `--fault=` | what it breaks | assertions that correctly go red |
|---|---|---|
| `no-camera` | renders with no `Camera3D` | render-non-blank (9), ramp-banding, saturation-ordering, scene-geometry, transform-footprint, golden-diff (22) |
| `no-toon` | swaps the cel material for a smooth one | ramp-banding, golden-diff (19) |
| `flat-saturation` | ignores the per-world saturation dial | saturation-ordering, golden-diff (8) |
| `empty-scene` | spawns no geometry | scene-geometry, transform-footprint, golden-diff (11) |
| (tamper with a baseline PNG) | — | golden-diff, naming the changed tiles |

- [x] **Something is actually drawn — for all 9 canon worlds.** Each world's
      full theme (sky/sun/ambient + `toonGradient` + saturation) renders a frame
      with real luminance variance, >= 8 distinct colour buckets and >50%
      non-black pixels. This is the entire class of defect headless **cannot**
      see: a null material, a missing asset, a dead shader, a camera pointed at
      nothing. Fails under `--fault=no-camera`.
- [x] **`RAMP_BANDS = 3` genuinely reaches pixels.** A toon-shaded sphere shows
      3 (occasionally 4, counting the anti-aliased rim) distinct luminance
      plateaus. The lower bound is the load-bearing half — a *smooth* material
      measures 2, because a continuous gradient leaves no empty histogram bins
      to split the run. That is precisely the "the cel shader silently no-opped"
      failure this check exists to catch, and `--fault=no-toon` demonstrates it
      catching it. Measured once at a fixed dial, not per world: desaturating
      compresses the gradient's luminance separation, so the noir worlds
      legitimately read as 2 plateaus — reported as information, never asserted
      (widening the window to admit 2 would also stop it catching a dead shader).
- [x] **`WORLD_SATURATION` reaches pixels, in the right order, for all 9
      worlds.** Rendering a FIXED reference palette under each world's dial —
      so the dial is the only varying input — the measured mean chroma is
      strictly monotonic in the spec: crime 0.62 -> 0.0359, sovereign-ruins
      0.80 -> 0.0505, concord-link-frontier 0.95 -> 0.0633, concordia-hub 1.00
      -> 0.0678, tunya 1.05 -> 0.0721, fantasy 1.12 -> 0.0784,
      lattice-crucible 1.15 -> 0.0812, superhero 1.25 -> 0.0908, cyber 1.35 ->
      0.1006. Zero inversions across all 36 ordered pairs. Relative ordering is
      the assertion, not absolute values — llvmpipe and tonemapping shift
      absolutes, they do not reorder them. Fails under `--fault=flat-saturation`.
- [x] **`scene:data` -> placeholder BoxMesh geometry appears** — `SceneBootstrap.
      apply_scene()` fed a 3-node `concord-scene/v1` payload renders exactly 3
      distinct visible regions. **Scope:** the payload is a fixture matching
      `server/lib/scene-export.js`'s format, NOT a live server frame — the
      live-gateway path stays in the unverified queue below.
- [x] **`{ok:false}` scene payloads draw no phantom geometry** — the pixel proof
      of `scene_bootstrap.gd`'s honesty contract: zero visible regions, flat
      frame. (Read this one with its companion: a blank render satisfies it
      trivially, which is why it is only meaningful alongside the
      geometry-appears check above, and why both are listed rather than one.)
- [x] **`scale = [w, h, d]` produces the right footprint, and `rotationY` maps
      with correct Y-up parity (no axis flip, no inverted sign).** Measured
      top-down orthographic, where world units map to pixels at a known scale:
      an 8x2 footprint measures 87x22 px against 86.4x21.6 expected (0.7%
      error); the same box at `rotationY = PI/2` measures 21x86 px against
      21.6x86.4 (2.8%); at `rotationY = PI/6` the region's **principal axis**
      measures -30.0 deg against -30 expected. The principal axis is what
      catches an inverted rotation sign — a bounding box is symmetric under
      +/-theta and cannot.
      > **This check found a real defect on its first run.** `_spawn_node` built
      > its basis as `Basis().rotated(UP, r).scaled(s)`, which scales along the
      > PARENT axes after rotating — so an 8x2 building at `rotationY = PI/2`
      > came back out 8 wide x 2 deep: **the footprint of a rotated building
      > never rotated at all.** Fixed (`SceneBootstrap.node_basis`, now
      > `R * from_scale(s)`), pinned twice — by the rendered-pixel assertion and
      > by pure checks in `tests/test_scene_bootstrap.gd`. No pure test had
      > caught it in the ~2 years the file existed, because the composition
      > happened inline in the engine half that nothing could execute.
- [x] **The locked art constants are read, not re-typed.** `world/art_style.gd`
      loads `res://art_style.json`, which `scripts/gen-art-style-spec.mjs`
      DERIVES from `concord-frontend/lib/world-lens/concordia-theme.ts` (the
      same file the web client reads). `node scripts/gen-art-style-spec.mjs
      --check` is a drift gate. `tests/test_art_style.gd` (28 checks) pins the
      spec plumbing and the colour maths; the harness pins that it reaches
      pixels. Both halves are needed — the pure tests would happily pass if the
      shader no-opped.

### Why software rendering still cannot settle most of this file

Read these limits as part of the claims above, not as footnotes to them.

1. **It proves WHAT draws. It proves NOTHING about HOW FAST.** llvmpipe is a
   CPU rasterizer; its frame times have no relationship to a GPU's. Every
   framerate, hitch, pop-in, draw-call-budget, LOD-transition-smoothness and
   streaming-race item below stays human-verified, permanently, at this
   rasterizer.
2. **llvmpipe is not a GPU.** No vendor extensions, different precision, and
   possible gaps in shader-feature support. **If an effect silently no-ops
   under llvmpipe, a green assertion here is a FALSE assurance.** The
   mitigation is structural, not hopeful: assertions are written so the thing
   under test going away turns them red (hence the fault table above), and the
   ramp check specifically exists to catch a dead shader. It is a mitigation,
   not a guarantee — a first run on real GPU hardware is still owed.
3. **Aesthetic judgement is not machine-verifiable and none was moved.** "Does
   the hub feel alive", "is the framing right", "does the rig read as a legible
   humanoid rather than a pile of capsules", "does this read as premium" —
   all still human. The harness can say three regions were drawn; it cannot say
   they look like buildings.
4. **A fixture is not a live server.** Everything network-dependent — real
   `/godot-ws` frames, reconnect behaviour, real `.glb` assets, interpolation
   under real latency — is untouched by this harness and stays below.
5. **One rasterizer, one resolution, one driver version.** Baselines are exact
   here and may legitimately shift on a different Mesa build. A golden diff is
   a "look at this" signal, not proof of a defect.

## Checklist (all UNVERIFIED)

### Engine / project
- [ ] Project opens in the **graphical** editor without errors or missing-resource
      warnings (headless import passing does not prove the editor UI path).
- [ ] An exported build launches **with a window and a GPU** and draws its first
      frame. Export packaging is verified (above). **Partially advanced, not
      closed:** the project (not the exported build) now launches against a
      virtual X display and draws real frames on llvmpipe — so "it draws" is
      settled, while "the EXPORTED binary draws, on a GPU, in a real window" is
      still three untested things. Leave unchecked until someone runs the
      exported build on hardware.
- [x] **The Web export loads and renders in a real browser — 2026-08-07.**
      `node scripts/export-godot-web.mjs` → served the output over plain HTTP
      → loaded in real Chromium (Playwright) → the engine boots
      (`Godot Engine v4.4.stable.official.4c311cbee` in the browser console),
      gets a real `WebGL2 (OpenGL ES 3.0)` context, and the canvas renders
      real, non-crashed frames (verified by reading pixel data back off the
      canvas, not just "no JS exception"). It then does exactly what
      `boot.gd` is supposed to do with no server running: attempts
      `ws://127.0.0.1:5050/godot-ws`, gets `ERR_CONNECTION_REFUSED`, and logs
      an honest `[boot] disconnected` — no crash, no fabricated connected
      state. **Scope of this claim:** `boot.tscn` itself has no camera or
      geometry (by design — see its own header, "exercises the net stack
      without asserting anything about visuals"), so the rendered frame is a
      flat clear-color canvas, not gameplay content; this settles "does the
      exported bundle actually boot a real engine in a real browser," not
      "does it look like a game" (see the general `art_world`/`scene_bootstrap`
      shots above for actual rendered geometry, which is proven inside the
      engine but has not yet been checked through this exact export+browser
      path). A real Concord server + a scene with a camera would be needed to
      extend this to a populated frame.
      - **This run also found and fixed a real regression on the way in.**
        Export was silently failing — `Cannot export project with preset
        "Web" due to configuration errors:` with **no further detail**, which
        also blocked producing the very bundle needed to test this item.
        Isolated by testing the Web preset's options one at a time: the
        2026-07-27 audit's `vram_texture_compression/for_mobile` flip
        (`false`→`true`) broke the export outright in this engine build's
        headless CLI path, and was never re-verified with an actual export
        afterward. Reverted to `false` (see `export_presets.cfg`'s own
        updated comment for the full account) — confirmed by re-running the
        export to a clean success (real `index.html`/`.js`/`.pck`/`.wasm`)
        before and after the single-flag change.
      - Reproduce: `node scripts/export-godot-web.mjs`, serve
        `concord-frontend/public/godot-client/` over any static HTTP server,
        open `index.html` in a browser (or drive it headlessly with
        Playwright as this pass did) — no COOP/COEP headers are required
        today because `variant/thread_support=false` (already the case
        before this pass; single-threaded WASM, not the multi-threaded
        variant).

### Networking
- [x] **`GatewayClient` connects to a live `/godot-ws` and receives `hello`
      after `auth` — 2026-08-07, real end-to-end run.** A real `server.js`
      was booted (fresh SQLite DB, real migrations, real content-seeder — NOT
      a fixture), a real user registered via `/api/auth/register`, and a real
      JWT obtained. The Godot **project** (not headless — real X11/opengl3
      via Xvfb, same rasterizer the pixel checks above use) was launched
      against it with `CONCORD_GATEWAY_URL`/`CONCORD_GODOT_AUTH_TOKEN`/
      `CONCORD_WORLD_ID` pointed at the live server. Console proof (from the
      engine's own stdout, not a mocked transport):
      ```
      [boot] gateway socket open
      [boot] authenticated as <real-user-uuid>
      [boot] joined room world:concordia-hub
      ```
      This is the first time this client has ever spoken to a real server —
      every prior claim in this file about the gateway was necessarily
      code-inspection-only.
- [ ] Reconnect/backoff behaves sanely after a server restart (1s→30s cap, jitter).
- [x] **`room:join world:<id>` succeeds — same run as above** (`joined room
      world:concordia-hub`, real room echo from the real server, not asserted
      from source).
- [ ] Malformed / oversized inbound frames do not crash the client.

### Scene rendering
- [x] **`scene:request` → real BoxMesh geometry appears — WIRE half now
      closed, 2026-08-07.** The RENDER half was already machine-verified (a
      `concord-scene/v1` fixture payload draws the right region count). This
      closes the WIRE half this file had flagged as the actual gap: the same
      live run above triggers `boot.gd`'s real `_on_authenticated` →
      `scene:request` → server's real `exportScene()` (reads the live
      `world_buildings` SQL table, not a fixture) → real `scene:data` →
      `SceneBootstrap.apply_scene()`. Verified **programmatically, not by
      eye**: `world-lens-godot/tools/live_probe.gd` (new — a one-off live-server
      probe, distinct from `tools/visual_probe.gd`'s synthetic-fixture harness)
      walks the real scene tree after the round trip and counts
      `SceneBootstrap`'s spawned children. Result:
      `spawned_children: 62`, which is **exactly** the real, independently-
      queried count of `concordia-hub` rows in `world_buildings` — city hall,
      library, market, observatory, forge, courthouse, and 56 more, all
      authored content, not synthetic. Reproduce (needs a running server +
      real JWT + Xvfb):
      ```bash
      CONCORD_GATEWAY_URL=ws://127.0.0.1:5050/godot-ws \
      CONCORD_GODOT_AUTH_TOKEN=<real JWT> CONCORD_WORLD_ID=concordia-hub \
      CONCORD_LIVE_PROBE_OUT=/tmp/scene.png CONCORD_LIVE_PROBE_FRAMES=360 \
      xvfb-run -a -s "-screen 0 1280x720x24" .godot-runtime/bin/godot \
        --path world-lens-godot --display-driver x11 --rendering-driver opengl3 \
        --script res://tools/live_probe.gd
      ```
      **Same run also found and fixed a real gap**, not just tested one: the
      live boot path never applied `ArtStyle.make_environment`/`make_sun` —
      only the synthetic `visual_probe.gd` harness did. So a real client
      session had no sky, no sun, and every spawned building rendered as a
      flat black silhouette regardless of `world_id`. Wired
      `boot.gd#_ready()` to call the same `ArtStyle` functions
      `visual_probe.gd` already proved correct (verbatim reuse, no new
      shading logic) — confirmed by re-running the exact same live probe
      before/after: `spawned_children` unchanged at 62 (the fix doesn't touch
      what spawns), but the frame goes from a flat grey/black two-blob image
      to a real lit sunset sky over toon-shaded buildings.
      **Camera framing — closed, same pass.** The gap this section
      previously described (default camera stuck at the scene origin, no
      framing logic) is fixed: `SceneBootstrap.get_bounds_center()`/
      `get_bounds_radius()` (new — mirrors
      `FeaSceneBuilder.get_bounds_center()`'s exact honest-empty-fallback
      posture) give the real spatial extent of whatever actually spawned;
      `CameraRig` gained `set_orbit_distance`/`set_orbit_pitch`/
      `set_orbit_yaw` (new public setters — the rig previously only exposed
      `set_orbit_focus`) and its `FOLLOW`-with-no-target branch (there is no
      player character to follow yet — see the C14/M1 sections below) now
      falls back to the SAME `orbit_transform` math `ORBIT` mode uses,
      framing whatever focus/distance/pitch/yaw `boot.gd` set from the real
      spawned bounds, instead of freezing at a meaningless origin transform.
      Verified against the live server (`tools/live_probe.gd`, extended to
      also report camera position + measured bounds): concordia-hub's real
      62 buildings — arranged in a real authored ring-city layout, plus a
      real outlying district ~1000m away — are now clearly visible as
      individually-distinguishable, correctly toon-shaded boxes in an aerial
      three-quarter view, not 1-2 shapes near the origin. Two of the four
      dials (focus, pitch-vs-shape reasoning) are derived/reasoned; the
      distance multiplier (0.3) and the three-quarter yaw convention are
      empirically tested defaults, not closed-form fits — a naive
      `radius / tan(halfFov)` projection predicted a ~4x larger multiplier
      than what actually filled the frame when run and screenshotted, which
      is exactly why this was verified against real rendered pixels rather
      than trusted from the formula. **Superseded, 2026-08-07 — see "Player
      physics, collision, and terrain" below**: a real ground plane (now
      textured, not floating-void), real per-building collision, and a
      real local-player `CharacterController` that the camera now hands
      off to via `set_follow_target` all now exist and are verified
      against a live server. This fallback (the orbit-establishing-shot
      math) is still real code and still the correct behavior for the
      brief window before the local player has spawned, or for
      SPECTATE-mode viewing — it just isn't the ONLY camera behavior
      anymore.
- [ ] Placeholder boxes render at the **correct position / rotation / scale**
      versus the Three.js client for the same world (side-by-side). *(The Godot
      side's transform mapping is now verified against the spec in absolute
      pixel terms; the cross-client comparison is a separate claim and is not
      made.)*
- [x] **`rotationY` maps correctly (Y-up parity; no axis flip)** — machine-
      verified by principal-axis measurement in `scripts/visual-qa.mjs`. This
      check FOUND A REAL DEFECT here (rotated footprints never rotated); see the
      machine-verified section for the detail and the fix.
- [x] **`scale = [w, h, d]` footprint** renders at the mapped dimensions
      (<= 2.8% pixel error, orthographic top-down). *Scope: verified against the
      `concord-scene/v1` contract, not against a live server's real building
      rows — that half needs the gateway.*
- [x] **`{ok:false}` scene payloads are handled honestly (no phantom
      geometry)** — machine-verified: zero drawn regions.

### Assets
- [x] **`GlbLoader` downloads and displays a real `.glb` correctly —
      2026-08-07, corrected same day.** This was the one item flagged as
      genuinely never-exercised. First pass tested
      `sovereign_first_refusal.glb` (61KB) purely because it was the
      smallest/fastest file to fetch, without checking what it actually
      depicted — it turned out to be a small narrative/lore-artifact prop
      (842 verts, a disconnected-reading stylized humanoid), not
      representative of Concord's real playable-character art, and was
      called out as such. Re-run against the correct asset class per
      `concord-frontend/public/meshes/heroes/README.md`:
      `_archetype_warrior.glb` (6.9MB, one of 7 real Mixamo-sourced
      archetype meshes covering warrior/guard/scholar/mystic/hunter/trader/
      legend — see `CREDITS.md`). Served over plain HTTP, loaded through
      the same real `GlbLoader` + `tools/glb_load_probe.gd` (real X11/
      opengl3 rasterizer via Xvfb, no synthetic fixture, no mocked
      HTTPRequest). Result, verified programmatically:
      `mesh_instance_count: 1`, `total_vertex_count: 4288`, `child_count: 1`.
      The rendered screenshot shows a properly assembled, textured, rigged
      humanoid — hard hat, work shirt, jeans, boots, correct proportions,
      standing in the T-pose GLTF rest pose (no animation clip is playing
      in this probe, so T-pose is expected and correct, not a defect).
      This is the representative result for the loader mechanism.
      Reproduce: serve `_archetype_warrior.glb` (or any archetype file)
      from `concord-frontend/public/meshes/heroes/` over plain HTTP, then
      `CONCORD_GLB_URL=http://host:port/_archetype_warrior.glb
      CONCORD_GLB_PROBE_OUT=/tmp/out.png xvfb-run -a -s "-screen 0 1280x720x24"
      .godot-runtime/bin/godot --path world-lens-godot --display-driver x11
      --rendering-driver opengl3 --script res://tools/glb_load_probe.gd`.
- [x] **`AssetResolver` static fallback returns a usable URL for
      `player`/`npc` kinds — 2026-08-07, closed same day as the item
      above.** The URL-convention gap this item used to describe (fallback
      expected `{base}/models/{kind}/{id}.glb`, hero meshes actually live
      at `{frontend}/meshes/heroes/{name}.glb`) is fixed:
      `fallback_url(base, kind, id, world_id)` now special-cases
      `player`/`npc` onto the real hero-mesh convention (ported from
      `concord-frontend/lib/concordia/hero-mesh-registry.ts`'s
      `ARCHETYPE_FALLBACK_PATH` + its per-world variant), and
      `world/boot.gd` was also fixed to point `AvatarManager.base_url` at
      the frontend origin instead of the backend gateway origin it had
      been pointed at (a second, independent bug — every resolve would
      have 404'd against the wrong server even with a correct URL). The
      `/api/evo-asset/resolve` dynamic endpoint this item's title also
      names does not exist server-side (confirmed by grep), so resolution
      always exercises the static fallback path in practice — which is
      the path verified below. Pure-logic pin: `tests/
      test_asset_resolver.gd` (5 checks). Live-engine pin: `tools/
      glb_load_probe.gd` pointed at the EXACT URL this function now
      returns for a player rig loaded a real, correctly-textured Mixamo
      humanoid (see the "Avatars" section above) — not a synthetic
      fixture, not a mocked HTTPRequest.
- [ ] GLB cache returns visually-identical instances on repeat load.
- [x] **A resolved GLB swaps cleanly onto a rig spawned by
      `AvatarManager`, through the full `ingest_snapshot` -> `_spawn_rig`
      -> `AvatarRig._try_resolve_glb` -> `_on_glb_loaded` chain —
      2026-08-07.** New `tools/avatar_manager_probe.gd`: feeds
      `AvatarManager.ingest_snapshot()` one synthetic `city:positions`-
      shaped entity (the exact Dictionary shape `world/boot.gd#_on_event`
      passes through from a real socket delivery — this tool starts from
      `ingest_snapshot()` onward, so it does NOT re-prove the
      gateway/socket delivery leg itself, which is exercised elsewhere in
      this file), connects to the spawned rig's real `rig_ready` signal
      (not a child-count heuristic — an earlier version of this probe used
      one and got a false positive at frame 2, because `AssetResolver`/
      `GlbLoader` are added as children synchronously at spawn time,
      before any network I/O even starts; fixed to wait for the actual
      later `rig_ready("glb")` signal, which only fires from inside
      `_on_glb_loaded` once a real fetch+parse completes), and waits real
      wall-clock frames for it. Against a real frontend static-asset
      server: `frames_waited: 64` (i.e., this took real, observable
      network+parse time, not an instant false completion),
      `glb_swapped: true`. Screenshot shows the SAME real, correctly-
      textured Mixamo humanoid this file's other GLB entries already
      verified in isolation — now rendered specifically as the result of
      `AvatarManager`'s own spawn path, replacing `AvatarRig`'s primitive
      capsule placeholder, not a synthetic stand-in.

      **Honest scope, narrowed, not eliminated**: this proves the CLIENT-
      SIDE wiring from `ingest_snapshot()` through to a rendered mesh. It
      does NOT prove a real second browser session's `player:move` traffic
      reaches the server, gets relayed as a real `city:positions`
      broadcast, and arrives at this client's `GatewayClient` — that
      specific leg (server ↔ two real sessions) still needs two
      simultaneous real sessions and remains unattempted.
- [x] **`SceneBootstrap` upgrades real buildings from placeholder boxes to
      real GLBs — 2026-08-07.** For the `market`/`tavern`/`archive`
      archetypes specifically (the 3 that have a real GLB today at
      `concord-frontend/public/models/building/*.glb` — `world/
      building_archetype.gd` ports the Three.js client's `building-
      silhouette.ts` archetype table), a spawned box is replaced with a
      rescaled clone of the real mesh once it loads (async, via
      `AssetResolver.fallback_url` — which, unlike the hero-mesh case
      above, DOES match the real serving convention: `{frontend_origin}/
      models/building/{archetype}.glb`). Verified against a REAL running
      server (`server.js` spawned with a fresh migrated DB, a registered
      user, real JWT) + a real static file server for
      `concord-frontend/public/`: `tools/live_probe.gd` against
      `concordia-hub` reports `spawned_children: 63`, `bootstrap_found:
      true`; the resulting screenshot shows a mix of gray placeholder boxes
      (forge/tower-archetype buildings — no real mesh for those yet, honest
      fallback) and non-box shapes at the market/tavern/archive nodes.
      Isolated proof of ONE such upgrade, framed close-up via
      `tools/glb_load_probe.gd` (now accepts `CONCORD_GLB_PROBE_DISTANCE`/
      `CONCORD_GLB_PROBE_HEIGHT` for building-scale assets, not just
      character-scale): `market.glb` renders as a real, designed market
      stall — canopy tent, counter, bunting flags, goods on the counter —
      `mesh_instance_count: 2`, `total_vertex_count: 8218`. Not fabricated:
      a `market`/`tavern`/`archive`-archetype building without network
      access to the frontend origin, or whose fetch 404s, stays a box
      forever (`_on_building_glb_failed` — logged, never retried into a
      fabricated success). Pure-logic mapping table pinned by
      `tests/test_building_archetype.gd` (16 checks); the async upgrade
      path itself (network-dependent) is verified only by the live-server
      run above, not by the headless pure-logic suite.
- [x] **A real, non-generic ground plane exists under the scene —
      2026-08-07.** Before this, `boot.gd` spawned SceneBootstrap's boxes
      over the engine's default void with nothing underneath — the earlier
      camera-framing screenshots in this file show buildings floating on
      black. A large flat `PlaneMesh` is now added in `boot.gd` alongside
      the bootstrap. Deliberately NOT textured terrain art (see that code's
      own comment) — real terrain textures exist
      (`concord-frontend/public/models/terrain/*.jpg`) but wiring per-
      district UV-mapped ground geometry is separate, unbuilt work; this is
      a flat placeholder plane, same honesty tier as the box buildings.
      Caveat found by actually looking at the live-probe screenshot: at the
      orbit camera's current pitch/distance, the flat plane visually
      dominates the frame (buildings read small, clustered near the
      bottom) — a real composition weakness at the time this was written.
      **FIXED, 2026-08-07, same day — see the entry directly below.**
- [x] **Camera framing dominated by an outlier-inflated bounds calculation
      — 2026-08-07, found and fixed the same day the ground plane above
      exposed it.** Root cause, found by actually measuring the live data
      rather than re-tuning constants blind: `get_bounds_center()`/
      `get_bounds_radius()` (world/scene_bootstrap.gd) are a plain mean +
      single-farthest-node max — and concordia-hub genuinely has an
      authored "outlying district" ~1000m from its main cluster (see
      CLAUDE.md's content-seeder notes). Re-running `tools/live_probe.gd`
      against the real server and dumping each spawned building's distance
      from the plain centroid showed a clean two-cluster split: 50
      buildings within 138-357m, then a hard jump straight to 981-1114m
      for the remaining 12-13. `get_bounds_radius()` reported the
      outlier-inflated 1114m, so `boot.gd`'s `0.3 * radius` camera distance
      (334m) put the camera INSIDE that inflated sphere — closer to the
      world origin than to either real cluster's own span — framing almost
      nothing but ground plane, exactly matching the screenshot evidence
      above.

      Fix: a new `SceneBootstrap.robust_cluster_bounds()` (pure static) +
      `get_camera_bounds()` (instance wrapper), used ONLY by `boot.gd`'s
      overview camera — `get_bounds_center()`/`get_bounds_radius()`
      themselves are untouched, since their own doc comments describe a
      deliberate contract mirrored from `FeaSceneBuilder`'s equivalent
      (a different, unrelated overlay with no outlier problem) and are
      pinned by existing tests. The method is largest-relative-gap
      detection, not a fixed percentile: sort every node's distance from
      the plain centroid, find the single largest gap between consecutive
      distances past the halfway point, and only treat it as a genuine
      cluster/outlier boundary if the gap is larger than the entire "core"
      span leading up to it — a continuously, evenly spread-out world (no
      real separation) has no such gap and is correctly left untrimmed,
      which a fixed percentile cutoff cannot tell apart from a real split.
      When a split is found, BOTH the radius and the center are recomputed
      from only the near side, so the outlier can't drag the focus point
      either. Below `MIN_NODES_FOR_TRIM` (6) nodes this is byte-identical
      to plain centroid + max distance (no meaningful "majority" exists to
      detect an outlier against at that scale) — small/test scenes are
      unaffected.

      Verified against the exact same real running server + registered
      user + real JWT this file's other live-probe entries use — before:
      camera at height 242m, buildings crammed into a single tiny corner
      behind a wall of green; after: camera at height ~55m, 10+
      individually-distinguishable buildings (a real market-stall GLB
      with its canopy/awning texture, several honest gray placeholder
      boxes for forge/tower archetypes) spread legibly across the frame.
      Pure-logic tests: `tests/test_scene_bootstrap.gd` (+8 checks —
      small-N parity with the untouched plain bounds, no-trim on an evenly
      spread set, a synthetic clear-outlier case, and a case built at
      concordia-hub's real measured node counts and distance bands).
      **Residual, honestly**: this fixes FRAMING (the right buildings are
      now visible at a sensible scale); it does not touch texture/material
      quality (the market canopy's orange swirl pattern is unchanged from
      the isolated close-up already verified above) or add real terrain
      art under the ground plane — those remain separately queued.

### Interpolation (Phase 2 dependent)
- [ ] `SnapshotBuffer` sampling at now−120ms is visually smooth at real latency.
- [ ] Shortest-arc heading lerp does not spin the long way around at the ±PI wrap.
- [ ] Entities that vanish from a snapshot hold their last pose (no teleport-to-origin).

### Overall feel
- [ ] Framerate / draw-call budget acceptable for the target world size.
- [ ] Reconnect UX (visible state, no frozen frame) is acceptable.

### Phase 2 — Chunk streaming, LOD, and movement (added this pass; see `PHASE2_CLIENT.md`)

All of these are structurally complete (parse+lint clean, pure functions
covered by `tests/`) but **have never run inside a real Godot process.**
Nothing below has been asserted anywhere else in the repo.

- [ ] `ChunkManager.update()` actually issues `ResourceLoader.load_threaded_request`
      calls that resolve, and `poll()` correctly drains them into `chunk_ready`.
- [ ] Chunk load/unload as the player crosses a 100m boundary produces no
      visible pop-in/pop-out flash, hitch, or double-load race.
- [ ] `chunk_manager.gd`'s placeholder `scene_path_template` — `res://world/chunks/chunk_%d_%d.tscn` —
      doesn't exist as real content yet; this needs a real chunk-scene asset
      pipeline before streaming can be observed at all, not just tuned.
- [ ] `LodPolicy.apply_to_instance` actually changes `GeometryInstance3D.visibility_range_begin/end`
      the way Godot's renderer expects (fade margins, `VISIBILITY_RANGE_FADE_SELF` /
      `_DEPENDENCIES` interaction — the pure funcs only compute begin/end, they
      don't touch fade-mode, which this pass left at the engine default).
- [ ] LOD band transitions (50m/200m/500m/600m) read as smooth banding, not a
      jarring mesh pop, at real framerate and real asset complexity.
- [ ] `PropInstancer.build_multimesh` renders the expected number of visible
      instances at the expected transforms — this pass never rendered a
      single MultiMesh.
- [ ] `CharacterController` movement FEEL: does jumping with `COYOTE_MS=120`
      / `JUMP_BUFFER_MS=130` actually feel forgiving-not-floaty at 60fps input,
      matching how the Three.js/Rapier client feels for a human tester (the
      numbers are copied exactly from `physics-world.ts`/`jump-forgiveness.ts`,
      but "same numbers" is not the same claim as "same felt experience" until
      a person plays both back to back).
- [ ] Glide (`GLIDE_DESCENT_CAP=-1.5`, `GLIDE_HORIZ_BOOST=0.08`) and swim
      (`SWIM_BUOYANCY=4.5`, `SWIM_GRAVITY=1.2`) integration reads correctly
      against Godot's own gravity/physics-tick semantics — this pass
      hand-integrates vertical velocity exactly like `physics-world.ts` does,
      but Godot's `CharacterBody3D.move_and_slide()` collision resolution is a
      different code path than Rapier's `computeColliderMovement`, so the
      *composition* of "hand-integrated velocity + engine collision response"
      has never been observed, only each half separately.
- [ ] Raw-keycode WASD polling (`Input.is_key_pressed(KEY_W/A/S/D)`) actually
      drives visible movement — this intentionally bypasses Godot's InputMap
      action system (no bindings exist in `project.godot` yet; see the
      code comment in `player/character_controller.gd` for why), so remapping
      / gamepad support does not exist until a real input-adapter layer is
      built and verified on a real machine.

### C14 — land↔air transition (`avatar/land_air_transition_controller.gd`)

Structurally complete (parse+lint clean via `gdparse`/`gdlint`, pure trigger/
gating/ack-nack logic covered by `tests/test_land_air_transition_controller.gd`
and the additive `world/scene_bootstrap.gd` pad-parsing covered by
`tests/test_scene_bootstrap.gd`) but **has never run inside a real Godot
process.** Nothing below is asserted anywhere else in the repo.

- [ ] The jump-then-sustained-ascend launch trigger (`should_launch_flight`,
      gated by `ASCEND_LAUNCH_THRESHOLD_MS = 350.0`) FEELS like a deliberate
      "launch into flight" gesture rather than an annoying delay tacked onto
      an ordinary jump, or an accidental trigger during normal platforming —
      the 350ms figure is a REASONED, un-playtested constant (no TS/JS/server
      source to cite, same honest posture as `MountController`'s
      `MIN_TURN_RADIUS_M`), and "does 350ms feel right" is a felt-experience
      claim no amount of pure-function testing can prove.
- [ ] The mounted standstill-liftoff trigger (`should_launch_mounted`, same
      350ms threshold) feels natural for a creature with no jump animation to
      telegraph "about to fly" — has never been watched against a real mount
      model.
- [ ] Composing `CharacterController.integrate_gravity` (unmounted ground
      leg) and `FlightController.step_flight` (unmounted air leg) inside ONE
      CharacterBody3D's `_physics_process`, switching between them on a
      state-machine trigger rather than a manually-toggled `set_flight_active`
      call, has never been observed end-to-end — the two pure cores are each
      independently tested (this unit's tests, plus the pre-existing
      `test_flight_controller.gd`), but the actual felt TRANSITION (does the
      character visibly "leap into" flight, or does it look like a jump that
      abruptly turns into hovering) has not been seen.
- [ ] Landing-pad radii (Plaza Skydock 14m, Riverside Skydock 14m, Industrial
      Skydock 16m — real authored values from `city-layout.json`) have never
      been checked against the pads' actual rendered footprint (no pad mesh
      exists yet — `scene_bootstrap.gd` does not spawn geometry for pads,
      only stores their data — so there is nothing to visually judge the
      radius against regardless).
- [ ] Optimistic-apply-then-reconcile for the mode switch (immediate local
      flip on trigger, quiet settle on `player:mode:ack`, visible rollback on
      `player:mode:nack`) has never been watched against real network
      latency — whether a rollback (snapping back from "flying" to "grounded"
      mid-animation) reads as an acceptable "honest revert" or a jarring
      glitch is a felt-experience judgment call, not provable by the pure
      `resolve_mode_transition` unit tests alone.
- [ ] `wire_landing_pads_from_scene_bootstrap` has never been exercised
      against a real `scene:data` frame from a live server — the shape
      assumption (`payload.landingPads` is an array of
      `{position:{x,z}, radius_m, ...}` dicts) is verified against
      `server/lib/scene-export.js`/`building-purpose.js` source code and this
      unit's own `test_scene_bootstrap.gd`, not against a real wire frame.
- [ ] `player:move` frames sent through `GatewayClient.send_event` actually
      reach a live `/godot-ws` gateway and produce a real `player:move:nack`
      to test the snap-back path against — **the server-side gateway is not
      mounted yet** (see `docs/GODOT_INTEGRATION.md`'s Integration TODO), so
      this entire path is unreachable end-to-end until that mount happens.
      The pure `snapback_position` logic is unit-tested against a
      hand-constructed nack payload only, never a real one.
- [x] ~~`tests/run_all.gd` and every `tests/test_*.gd` file actually execute and
      pass~~ — **DONE, and the suspicion was correct.** They now run under
      `godot --headless --path world-lens-godot --script res://tests/run_all.gd`
      (26/26 green), and the real engine did surface exactly the class of defect
      predicted here that static parsing cannot catch. Also re-run from inside an
      exported PCK, which additionally proves nothing in the suite depends on
      loose source files being present at runtime.

### DTU props (master-spec §3.3, units B6-B9 — `world/dtu_prop_renderer.gd` / `world/dtu_prop_interaction.gd`)

- [ ] `DtuPropRenderer.fetch_placements()` actually reaches a live
      `POST /api/lens/run` `{domain:"dtu_props", name:"list"}` and spawns one
      node per placement — **the `dtu_props` macro domain is built
      (`server/lib/dtu-props.js` + `server/domains/dtu-props.js`, both
      contract-tested server-side) but NOT wired into `server.js`'s
      `register()` call table** (see the STATUS note atop
      `server/domains/dtu-props.js`), so this path is unreachable end-to-end
      until that two-line wiring lands. Only the pure request-shape/transform
      helpers are unit-tested (`gdparse`-only) today.
- [ ] Placeholder box tint/size actually reads as visually distinct
      shelf-vs-counter-vs-window-vs-rooftop-vs-plaza at a glance, not just in
      the `Color`/`Vector3` values asserted by the pure tests.
- [ ] A resolved `.glb` (when `AssetResolver`/`GlbLoader` succeed) actually
      replaces the placeholder box in the live scene tree without a visible
      pop/flash, and the placeholder is correctly freed.
- [ ] `DtuPropInteraction.handle_click`'s physics raycast actually selects
      the intended prop in a populated 3D scene (untested past the pure
      `find_prop_ancestor` ancestor-walk, which only exercises plain `Node`
      trees, never a real `PhysicsRayQueryParameters3D` hit against a
      `CollisionShape3D`-bearing prop).
- [ ] Interact round-trip (`take`/`leave`/`arrange`) against a real running
      server: honest rejection reasons (`citation_consent_not_granted`,
      `not_owner`, `not_holding`) surface legibly to a human player, not just
      as a raw string in `interact_failed`.

---

### Game Design Lens — `design_command` first slice (D17 — `design/design_command_client.gd`)

- [ ] `DesignCommandClient.send_command(...)` actually reaches a live
      `/godot-ws` connection and a real `design_command:result` frame comes
      back — proven server-side end-to-end
      (`server/tests/godot-gateway-integration.test.js`, real ws client +
      real booted server + real SQLite/STATE assertions), but this GDScript
      file itself has never sent a frame to a live server or run inside a
      real Godot process; only `gdparse`/`gdlint` confirm it loads.
- [ ] `command_result`/`command_failed` signals actually reach a UI listener
      in a real scene tree (this unit ships no UI — D18's visual
      placement/authoring surface is the thing that would consume these
      signals; today nothing in the project connects to them).
- [ ] Extending `DESIGN_COMMAND_ACTIONS` (server-side) to the remaining ~36
      `gamedesign.js` macros, and building the actual click-to-place
      authoring UI in the 3D viewport, is unstarted — D18 scope.

---

### Avatar rig + locomotion (Migration M1 — `avatar/avatar_rig.gd` /
`avatar/animation_state_machine.gd` / `avatar/avatar_manager.gd`)

- [ ] `AvatarRig`'s primitive placeholder (capsule sockets per `bone_specs()`)
      actually reads as a legible humanoid silhouette, not a scattered pile of
      capsules — the pure `bone_world_offset()` math has never been seen
      rendered; an authoring mistake in one offset would only show up
      visually.
- [ ] GLB resolution (`_try_resolve_glb` → `AssetResolver`/`GlbLoader`, already
      QA-queued above) swaps cleanly onto a rig spawned by `AvatarManager`
      specifically — the reuse of those two nodes per-rig (one
      `HTTPRequest`-driven resolver + loader per avatar) has never been load-
      tested with more than a handful of concurrent avatars; a real world
      scene with dozens of remote players/NPCs resolving GLBs simultaneously
      could behave very differently than the pure logic implies (request
      fan-out, cache contention, memory).
- [ ] `animation_state_machine.select_state()`'s six locomotion states
      (idle/walk/run/jump/fall/land) have never been mapped onto real
      animation clips or even watched as a blend-weight number change while a
      capsule rig moves — this migration unit stores the decision
      (`AvatarRig.set_locomotion`) but wires no `AnimationPlayer`/
      `AnimationTree` to it yet. Whether the chosen `RUN_MIN_SPEED = 8.5`
      inference midpoint (see that file's own header comment on why it's an
      inference, not a mirrored constant) actually feels right for a remote
      avatar's run/walk read has NEVER been observed — it is a documented,
      reasoned guess, not a measured one.
- [ ] `AIRBORNE_VY_EPS = 0.3` (avatar_manager.gd) — the threshold that
      classifies a remote avatar's INTERPOLATED vertical velocity as
      "airborne" — has never been checked against real terrain-follow noise
      (a remote avatar walking over uneven ground could, in principle, false-
      trigger "jump"/"fall" if the terrain height sampling is noisier than
      assumed; there is no engine here to generate that noise and observe
      the threshold's behavior against it).
- [ ] `LAND_HOLD_MS = 150`'s transient "land" pose has never been seen —
      whether 150ms reads as a satisfying landing beat or is too
      short/long to register at all is unverified.
- [ ] `AvatarManager`'s despawn-on-staleness (`STALE_TIMEOUT_MS = 3000`) has
      never been observed against a real disconnect/reconnect or a player
      leaving render distance — whether 3s reads as "instant enough" or
      leaves a visible frozen ghost briefly is unverified.
- [ ] Whichever rig ends up under `player/character_controller.gd` (this unit
      does not wire that mount — the LOCAL player's presentation layer is
      out of scope here, see the module header comments) has never been
      confirmed to actually look right attached to a physics-driven
      `CharacterBody3D` versus a directly-positioned remote puppet.

---

### Procedural gait + foot IK (Migration M2 — `avatar/gait_solver.gd` /
`avatar/two_bone_ik.gd` / `avatar_rig.gd#apply_gait`)

The phase/foot-target/IK-angle MATH is pure and numerically cross-checked
(the two_bone_ik round-trip and edge-case-clamp claims were independently
verified with an equivalent standalone Python re-implementation of the same
formulas before being committed to GDScript, precisely because the real
engine can't run these tests here) — but nothing about how it *looks* on an
actual skeleton has been seen:

- [ ] `apply_gait()`'s per-frame walk/run leg motion, applied to the
      primitive placeholder's flat Node3D sockets via `_apply_bone_angle`,
      has never been rendered — whether the hip/knee angles this produces
      read as a believable walk cadence (vs. too stiff, too bouncy, or
      obviously not touching the ground on contact) is completely unproven.
      The pure math is unit-tested (`tests/test_gait_solver.gd`); nothing
      about how it looks in motion is.
- [ ] `LIFT_HEIGHT_M = 0.12` (`gait_solver.gd`) — the swing-phase foot
      clearance height, which has NO Three.js source to mirror (see that
      file's own header note) — is an unverified reasoned guess; whether it
      reads as a natural step versus a stomp or a shuffle is unknown.
- [ ] `PHASE_STRIDE_LEN_M = 0.75`, ported byte-for-byte from
      gait-synthesis.ts's `BODY_STRIDE_LENGTHS.average`, governed a
      TOTALLY DIFFERENT rendering pipeline there (FK bone rotation, not an
      IK effector target) — whether the same number still "reads right" once
      it's driving foot-target IK on a physically different rig (this
      port's primitive capsule sockets, not the Three.js client's actual
      skinned mesh) has never been checked side by side.
- [ ] Skeleton3D bone-name lookup in `_apply_bone_angle` (the branch that
      fires once a real GLB has resolved and repointed `_skeleton`) has
      never run against an actual named `Skeleton3D` — whether a real
      imported humanoid GLB's bone names line up with `bone_specs()`'s
      naming (`leftUpperLeg`/`leftLowerLeg`/`leftFoot`/etc.) at all is
      unknown; a mismatch would silently fall through to the primitive-
      socket branch with no error (by design — see the function's own
      "never fabricates a bone that isn't really there" comment — but that
      also means a real name mismatch would be silent, not a loud failure,
      until someone watches it).
- [ ] `two_bone_ik.gd`'s sagittal-plane simplification (X always ignored)
      has never been checked against a GLB rig that might expect real
      3-axis hip rotation (abduction/adduction, axial rotation) for a
      convincing walk from side-on camera angles, vs. the head-on/45-degree
      angles this simplification was reasoned against.
- [ ] `apply_gait`'s "idle plants both feet, everything else runs the same
      ground-gait cycle" simplification (no distinct jump/fall/land leg
      pose) has never been watched during an actual jump — whether the legs
      visibly keep walking mid-air (which would look wrong) is unverified.

---

---

### Mobility controllers (C10/C13 — `avatar/flight_controller.gd` /
`avatar/ground_vehicle_controller.gd` / `avatar/mount_controller.gd`)

All three ported physics cores were independently cross-checked against a
standalone Node.js re-implementation of the same formulas before being
committed (same discipline M2 used with an equivalent Python re-check for
`two_bone_ik.gd`) — the MATH is numerically verified. Nothing about how any
of it feels or looks in Godot's own physics/renderer has been observed:

- [ ] `FlightController` — does powered flight (bank → yaw drift, dive-gain
      airspeed, stall + nose-down recovery) feel like the intended
      "superhero flight" read, or too floaty/twitchy, at real framerate with
      real input latency? The numbers are ported byte-for-byte from
      `flight-physics.ts` (which itself only ever drove a HUD, never a
      real 3D body) — "same numbers" has never been checked against a real
      `CharacterBody3D.move_and_slide()` composition.
- [ ] `FlightController`'s raw-keycode roll/pitch mapping (A/D roll, W/S
      pitch) has never been flown — whether this control scheme reads as
      intuitive for a keyboard-only tester, or wants a different axis
      mapping / mouse-look, is unknown.
- [ ] `FlightController`'s honest-zero wind sample (see its own header note)
      means flight will feel perfectly still-air smooth even over a world
      that server-side `wind-currents.js` would report as gusty — that gap
      itself needs eyes to confirm it reads as "obviously calm" rather than
      "broken," until a future unit wires the real sample.
- [ ] `GroundVehicleController` driving a "car" — does throttle/steer/brake
      feel responsive against Godot's own collision response
      (`move_and_slide()`), or does the CharacterBody3D fight the hand-
      integrated velocity in a way the pure kinematics never modeled (the
      pure math has no notion of Godot's collision impulses)?
- [ ] `GroundVehicleController`'s pure core also covers "glider"/"plane" for
      a future C12 unit to reuse directly — neither has ever been driven in
      Godot; whether the lift/pitch/gravity composition reads as flight-like
      once a real body is doing the moving (vs. this unit's math-only
      verification) is unproven.
- [ ] `MountController`'s arc-turn kinematics (`yaw_rate = steer * speed /
      turn_radius_m`) are a REASONED ADDITION with no TS/JS source to
      compare against (see the file's own header) — whether a warhorse
      (turn_radius_m=4.0) actually reads as "harder to turn than" a dire
      wolf (turn_radius_m=3.0) at real framerate, or whether the effect is
      too subtle/too strong to notice while riding, is completely unverified.
- [ ] `MountController`'s ground-clamp gravity integration (a simple
      `is_on_floor()` check + `GRAVITY` fall, with no jump/glide/swim
      states unlike `player/character_controller.gd`) has never been ridden
      over real terrain — slopes, stairs, or uneven ground could expose
      awkward vertical popping that the flat pure math can't predict.
- [ ] All three controllers' `player:mode`/`player:move` gateway traffic has
      never reached a live server — the `set_flight_active`/
      `set_driving_active`/`set_riding_active` request→ack/nack round-trip
      is only unit-tested against hand-constructed nack payloads (mirroring
      `CharacterController.snapback_position`'s own existing test gap), never
      a real `player:mode:nack` from `applyPlayerMode`.
- [ ] None of the three controllers have any VISUAL representation wired
      (no mesh, no mounted-rider pose, no vehicle chassis model) — this unit
      is movement math + netcode only; a rider/vehicle/flying-avatar body is
      a separate, still-queued presentation unit.

---

### Aerial mounts (C11 — `avatar/aerial_mount_controller.gd`)

Composes `MountController.step_mount` (ground leg) and
`FlightController.step_flight` (airborne leg) via direct static calls — the
composition itself is proven only by `tests/test_aerial_mount_controller.gd`
calling the same static functions and by code inspection of
`_physics_process_ground`/`_physics_process_airborne`, never by an actual
engine running both in sequence on one `CharacterBody3D`:

- [ ] Take-off/landing (`set_airborne`) reads as a legible transition — the
      controller flips `altitude_mode` and reseeds `_flight_state` instantly,
      with no windup/liftoff animation or ground-clearance check of its own
      (unlike `player/character_controller.gd`'s jump, there is no coyote-
      time or buffered-input equivalent here) — whether an instant switch
      from arc-turn ground kinematics to the aero state machine feels like a
      real takeoff versus a jarring pop has never been seen.
- [ ] The velocity clamp (`clamp_velocity_to_species_cap`, rescaling the
      FULL 3D flight-step vector down to the mount's real `base_speed_mps`
      instead of `FlightController`'s own 45 m/s ceiling — see that
      function's own header note on why) has never been felt in motion —
      whether capping a hippogriff/gryphon/wyvern's flight envelope at
      10.5-12.0 m/s (versus the 45 m/s a "superhero flight" player
      experiences) reads as "appropriately mount-paced" or "sluggish" is
      unverified; the number is a real, cited server-side constraint
      (`applyPlayerMode`'s `"mount:"` branch derives its speed cap from
      `species.baseSpeedMps` regardless of altitude), not a felt-right
      guess, but "correct per the anti-cheat contract" and "feels good to
      fly" are different claims and only the first is checked here.
- [ ] No mounted-rider-in-flight visual exists (no wing-flap animation cue,
      no banked-flight rider pose, no mount mesh at all) — same gap the
      ground `MountController` already flags, now also true for the
      airborne leg.
- [ ] `report_flight_xp`'s `POST /api/lens/run` call (real `mounts.gain_xp`
      macro, `kind:"flight"`) has never reached a live server from this
      file — only the pure `build_flight_xp_request_body` shape and the
      HTTPRequest wiring pattern (copied from the already-real
      `world/dtu_prop_interaction.gd`) are proven; whether
      `FLIGHT_XP_REPORT_INTERVAL_S = 10.0`'s batching cadence is a
      reasonable client-side choice (versus flushing more/less often) is an
      untested judgment call, not a cited number.
- [ ] The "no new player:mode submode" design (aerial and grounded riding
      both send the same `"mount:<speciesId>"` mode — see the file's own
      header) has never been checked against a live `applyPlayerMode` for
      whether the server-side anti-cheat's 3D Euclidean distance check
      (`city-presence.js`'s `updateUserPosition`) actually tolerates a
      believable climb-rate + horizontal-speed combination without nacking
      a legitimate ascent — this is asserted from reading the cited code,
      never observed against a real flight.

### Landing pads (C12 data — `content/world/concordia-hub/city-layout.json`'s
`landingPads` array + `server/lib/scene-export.js`'s additive `landingPads`
field)

- [ ] The 3 authored pad positions (Plaza Skydock, Riverside Skydock,
      Industrial Skydock) have never been seen rendered in a real 3D scene —
      whether they read as sensible touch-down zones relative to the
      city's actual built geometry (versus floating in an awkward or
      inaccessible spot) is unverified; positions were chosen only by
      numeric clearance from existing building coordinates (see
      `tests/landing-pads.test.js`'s coordinate-overlap assertion), not by
      eye against the real skyline.
- [ ] `radius_m`/`elevation_m` are DATA fields only — no client-side pad
      geometry (a mesh, a marker beacon, a glow ring) exists yet to consume
      them; this unit is the data + scene-export protocol only, per its own
      scope (a full visual pad-interaction system is explicitly a further
      follow-up, not built here).
- [ ] No landing/take-off GAMEPLAY gate exists yet (e.g. "you may only
      report flight XP for landing while within `radius_m` of a real pad")
      — `AerialMountController.set_airborne`/`report_flight_xp` work
      anywhere in the world today; whether pads should eventually become a
      required or merely a suggested touch-down zone is an open design
      question, not decided by this unit.

### Air legibility (C15 — `world/air_legibility.gd` + `world/scene_bootstrap.gd`'s
additive `districts` parsing)

- [ ] No renderer consumes `AirLegibility.legibility_for_altitude()` yet —
      this unit is the data transform only (see that file's own "Where this
      plugs into rendering" header section for the exact intended call
      site: `scene_bootstrap.gd#_spawn_node`'s per-node `MeshInstance3D`
      would need a real material swap keyed by each node's
      `extras.district_id`). Whether the resulting flat-band silhouettes
      actually read as legible from a real flying camera — versus looking
      flat/wrong/undifferentiated — has never been seen.
- [ ] `ALTITUDE_SIMPLIFY_M = 45.0` / `ALTITUDE_FLATTEN_M = 120.0` are
      authored design dials (see the file's own header), not measured
      against a real flight — whether 45m/120m are the right thresholds for
      Concordia's actual building heights and terrain silhouette (versus
      simplifying too early/late) is unverified and untunable without
      seeing real geometry from the air.
- [ ] `boost_contrast()`'s saturation/value math has only been checked
      numerically (`tests/test_air_legibility.gd`) — whether the resulting
      colors genuinely read as higher-contrast silhouettes against a real
      sky/fog/lighting setup (versus just "more saturated," which is not
      the same thing perceptually) has never been observed.
- [ ] No outline/rim-light shader exists for `silhouette_color` specifically
      (only the flat `band_color` fill is plausibly a simple material swap)
      — whether a true silhouette read needs an edge/outline pass at all,
      or a flat-color material is sufficient at altitude, is an open
      rendering question this unit does not answer.

### Ambient aerial traffic (C16 — `world/aerial_traffic_controller.gd` +
`server/emergent/aerial-traffic-cycle.js`)

- [ ] No mesh/geometry is spawned per entity yet — this unit is the data +
      protocol layer only (real server-tracked route/position, real
      SnapshotBuffer-based interpolation, real world-scoped broadcast); a
      visible "crosswind-courier" model/impostor was explicitly out of
      scope (see the controller's own "What this file does NOT build"
      header section).
- [ ] **Cadence-vs-smoothness is a real open question, not just unverified
      polish.** The server broadcasts positions on every due governor tick
      (~15s — the tightest cadence `registerHeartbeat` offers), far coarser
      than the ~100ms cadence `SnapshotBuffer`'s `RENDER_DELAY_MS=120`/
      `MAX_HORIZON_MS=250` were tuned for. Between broadcasts, `sample()`'s
      documented "hold last, never extrapolate" behavior means an entity
      visually freezes for most of each ~15s window, then snaps to the next
      sampled position — reasoned as acceptable for slow, distant,
      background sky traffic, but genuinely never seen. If it reads as
      janky rather than "distant and unhurried," the fix is most likely
      either (a) a tighter server broadcast frequency (trades tick-budget
      cost for smoothness) or (b) a dedicated, longer render-delay
      constant for THIS controller specifically (SnapshotBuffer's
      constants are shared file-level consts today — a per-consumer
      override would need a small, disjoint follow-up), not a rewrite of
      the interpolation scheme itself.
- [ ] `CRUISE_ALTITUDE_M = 60` (server/lib/aerial-traffic.js) is an
      authored design dial (see that file's header), not checked against
      Concordia's real building heights from the air — whether couriers
      flying at pad-elevation + 60m actually clear every authored building
      (tallest authored `elevationHint` in `districts.js` is 18, for the
      observatory district; buildings themselves may extend higher than
      their district's ambient elevation hint) has never been visually
      confirmed.
- [ ] `DEFAULT_SPEED_MPS = 9` was chosen only by comparison to the real
      seeded flight-mount species speeds (10.5–12 m/s) — whether 9 m/s
      actually reads as "ambient background traffic" at Concordia's real
      scale (routes ~1,450m around the 3 landing pads) rather than
      "conspicuously slow" or "still too fast to notice," has never been
      watched.
- [ ] Real geometry/mesh choice for the `crosswind-courier` flavor (what a
      courier actually looks like in flight — a mount-and-rider silhouette?
      a cargo-glider shape? something else grounded in the Crosswind
      Couriers' authored tabard/satchel look from
      `content/world/concordia-hub/npcs.json`) is undecided — this unit
      only ships the kind STRING, not a model.

---

### FEA/engineering visualization (R5/E23 — `engineering/fea_scene_builder.gd`
+ `server/domains/engineering.js`'s new `feaScene` macro)

The banding/color MATH is pure and unit-tested (`tests/test_fea_scene_builder.gd`
drives `utilization_to_color`/`beam_transform`/`node_positions` against
hand-computed expectations — 0.0 → pure green, 0.5 → yellow, 1.0 → pure red,
clamped above 1.0). The server-side macro itself is verified against a real
hand-derived sigma=Mc/I result (`server/tests/engineering-fea-scene.test.js`,
same cantilever fixture `server/tests/e2e/design-simulate-fea-loop.test.js`
already established as this session's ground truth). Nothing about how any of
it *looks* rendered has been seen:

- [ ] Whether the green→yellow→red utilization ramp is legible at a glance
      against Godot's default lighting/material response (`emission_enabled`
      at a flat `0.4` energy multiplier is a REASONED, un-playtested
      constant — no prior art in this codebase to mirror, unlike most other
      constants elsewhere in this project) — could easily read as muddy or
      washed out until seen on a real GPU.
- [ ] `BEAM_RADIUS = 0.03` / `NODE_RADIUS = 0.05` are a FIXED display
      proportion, not a real cross-section render, and are almost certainly
      wrong at the scale of a real structural model: the ground-truth test
      fixture's members are ~0.4m long with a ~0.04m×0.012m section — a
      0.03 world-unit beam radius would read as absurdly thick relative to
      that member's real length, while the SAME constant against a
      50-member, 20m-span frame (the solver's documented ~200-member/<20ms
      scale target) would look like a hairline. This needs either a
      per-scene auto-scaled radius (e.g. proportional to the model's own
      bounding-box diagonal, the same auto-centering `CameraRig` already
      does in the web `FEAResultViewer.tsx`) or an `@export` the caller
      tunes per model — neither exists yet; flagged honestly rather than
      guessed at.
- [ ] No camera auto-framing exists (the web `FEAResultViewer.tsx` has a
      `CameraRig` that centers + backs off proportional to the model's
      diagonal — nothing analogous is wired here yet), so a real model at
      an arbitrary scale/origin could render entirely off-screen or too
      close/far to read without a scene author manually placing a camera.
- [ ] `beam_transform`'s orthonormal-basis construction (reference-axis
      fallback at the `|y·RIGHT| > 0.999` singularity) is numerically
      verified by the pure test for a vertical and a horizontal member, but
      an ARBITRARY 3D member orientation (neither axis-aligned) has never
      been rendered — whether the beam's rotation about its own long axis
      (the remaining degree of freedom an orthonormal Y-aligned basis
      doesn't pin down) ever looks visibly "twisted" for a non-circular
      cross-section is moot today (CylinderMesh is axisymmetric, so this is
      currently a non-issue) but would matter if a future pass renders a
      real I-beam/rectangular profile instead of a placeholder cylinder.
- [ ] `request_scene()`'s `HTTPRequest` → `/api/lens/run` call has never
      reached a live server from this file — only the pure
      `build_request_body` shape and the HTTPRequest wiring pattern (copied
      from the already-real `world/dtu_prop_renderer.gd`) are proven. The
      server-side macro itself IS proven end-to-end
      (`server/tests/engineering-fea-scene.test.js`, a real hermetic
      handler-level test), so the gap here is purely "this specific GDScript
      HTTP call has never fired," not "the endpoint might not work."
- [ ] Deformed-shape / displacement-amplified rendering (the web viewer's
      `showDeformed`/`amplification` overlay) is NOT built here — `feaScene`
      does return `displacements` in its payload, but this Godot builder
      only draws the undeformed geometry today; a deformed overlay is a
      real, scoped follow-on, not attempted in this unit.
- [ ] No node/member picking or on-screen numeric readout exists (the web
      viewer's utilization-sorted table + PASS/WARN/FAIL badges have no
      Godot analog yet) — a viewer would currently need to eyeball color
      only, with no way to click a beam and read its exact utilization
      number.

---

### ConKay spatial presence (R5/E22 — `conkay/conkay_presence.gd` +
`conkay/conkay_pointing.gd` + `conkay/conkay_presence_state.gd`)

The SAME ConKay identity already real on the web
(`concord-frontend/components/conkay/widget/ConKayWidget.tsx`), given a
presence inside the Godot Hub — not a new agent. The state-derivation logic
(which macro/verdict events map to which discrete visual state, the
in-flight-run-id bookkeeping, the color table) is pure and unit-tested
(`tests/test_conkay_presence_state.gd`), as is the pointing geometry
(`tests/test_conkay_pointing.gd` — direction/yaw-pitch/orthonormal-basis
math, including the up-parallel singularity fallback). The server-side half
(the new `conkay:verdict` event, and confirmation that `macro:started`/
`macro:completed` already reach a Godot client's `user:<id>` room with zero
new code) is verified for real by `server/tests/capability-tier.test.js`,
`server/tests/conkay-verdict-bridge.test.js`, and
`server/tests/conkay-verdict-event-shape.test.js` (all against a real,
fully-booted `server.js`). Nothing about how any of it actually *looks* or
*feels* in a live scene has been seen:

- [ ] Whether the core+ring+3-satellite composition genuinely reads as "the
      same ConKay" at a glance next to the web widget's SVG glyph — the
      geometry mirrors the SVG's relative layout (one satellite "above", two
      lower flanks) and its exact Tailwind color values, but a 3D orb lit by
      Godot's default environment could easily look like a generic glowing
      ball rather than a recognizable extension of the web identity until
      seen on a real GPU.
- [ ] `core_radius` / `orbit_radius` / `satellite_radius` / the placeholder
      mount position (`Vector3(0, 1.6, 0)` in `world/boot.gd`) are all FIXED
      design dials, not measured against any real avatar/building scale in
      this scene — no prior art in this codebase to size a "companion orb"
      against. Could read as comically large/small, or spawn inside/under
      geometry, until placed against a real avatar and scene.
- [ ] The THINKING-state ring spin (`thinking_spin_rate = 2.2` rad/s) is an
      un-playtested constant — whether it reads as "actively working" versus
      "spinning too fast/slow to notice" is a real, unverified visual
      judgment call, the same class of open question as
      `air_legibility.gd`'s altitude dials or `aerial-traffic-cycle.js`'s
      cruise-altitude constant elsewhere in this doc.
- [ ] `StandardMaterial3D` with `SHADING_MODE_UNSHADED` + a flat
      `albedo_color`/`emission` pair (no bloom/glow environment configured
      anywhere in this project) is a REASONED choice for a small ambient
      marker, not a rendered/observed one — whether the four tier colors
      (amber/emerald/rose/amber-again for reasoned) are legibly distinct
      from each other under Godot's default viewport at the small scale this
      orb is meant to render at has never been seen.
- [ ] `point_at()`/`point_at_node()` have real, unit-tested math behind
      them, but no caller in this repo invokes them yet — this unit
      deliberately built the geometry only, without deciding WHEN ConKay
      should point at something (see `conkay_pointing.gd`'s "explicitly out
      of scope" note). A future unit wiring an actual trigger (e.g. "point
      at the building a citation refers to") would be the first real test of
      whether the resulting rotation looks like "pointing" rather than just
      "facing a random direction."
- [ ] **Lead/follow (real navigation) is NOT built** — see
      `conkay_pointing.gd`'s class doc for why: it would need a
      `NavigationServer3D` mesh bake off real scene geometry, steering
      behavior, and gait blending, none of which exist for ConKay today.
      Documented here as a clearly-scoped follow-on rather than a
      half-built naive lerp-toward-target, which would visually read as
      navigation without actually being it.
- [ ] `macro:started`/`macro:completed` are asserted (by existing, passing
      contract tests) to already reach a Godot client's `user:<id>` room —
      but no test in this repo has driven a REAL end-to-end `/api/lens/run`
      call with a ConKay correlation header through a live `/godot-ws`
      connection and observed the frame arrive client-side (the closest
      existing proof, `server/tests/godot-gateway-integration.test.js`,
      covers `player:move`/`player:mode`/`design_command`, not this path).
      The server-side plumbing is real and tested at the unit level; the
      full wire round-trip for THIS specific event pair has not been
      exercised.

---

### Reconnect resync + remote avatars + spectator viewer (R6 — `net/gateway_client.gd`, `world/boot.gd`, `avatar/avatar_manager.gd`, `session/session_manager.gd`, `session/camera_rig.gd`)

Three additions, all pure/derivation logic unit-tested and engine-executed
(`tests/test_gateway_client_seq.gd`, `tests/test_boot_resync.gd`, the
extended `tests/test_session_manager.gd`) — nothing about how any of it
looks or feels on a real GPU has been seen:

- [ ] `AvatarManager` had zero live callers anywhere in this tree before this
      unit (confirmed by grep, and by `aerial_traffic_controller.gd`'s own
      header, which said so outright). It is now mounted and fed real
      `city:positions` data end-to-end — but whether remote-player capsule
      puppets (placeholder geometry, per `avatar_rig.gd`'s own header) read
      as coherent moving entities rather than a jittery/glitchy mess has
      never been observed against a live server's actual position-update
      cadence (~100ms) and real network jitter.
- [ ] The `city:positions`-to-world filter (`Boot.event_matches_world`,
      matching on `cityId`) is logically correct against the server's own
      field names, but has never been exercised against a REAL running
      server with more than one active world/city simultaneously — whether
      cross-world leakage is genuinely prevented in practice (not just in
      the pure-function test) is unverified.
- [ ] `SessionManager.Mode.SPECTATE` + `CONCORD_GODOT_SPECTATOR=true` compiles
      and its state-machine legality is asserted (`test_session_manager.gd`),
      but no one has actually flown the free-fly camera around a live scene
      in spectator mode. Whether `free_fly_speed = 8.0` feels like a
      reasonable fly-around pace for "watching a world," rather than too
      fast to take anything in or too slow to be useful, is an unplaytested
      design dial — same class of open question as ConKay's spin rate above.
- [ ] **Mouse-look is wired for the first time in this unit** — was an
      honestly-stubbed `Vector2.ZERO` before (see `camera_rig.gd`'s prior
      class doc). `Input.MOUSE_MODE_CAPTURED` + `_unhandled_input`
      accumulation is real GDScript, engine-parseable, but headless
      generates no real mouse events at all — whether captured-mouse
      FREE_FLY look-around and click-drag ORBIT rotation actually feel
      controllable (sensitivity, whether the mouse capture UX is
      disorienting or expected) is entirely unverified. The previously
      built-but-uncalled `zoom_orbit()` is now wired to the scroll wheel —
      same caveat.
- [ ] Whether a stuck ConKay "busy" indicator was ever actually user-visible
      before this unit's `reset()` fix (it required a `macro:completed` to
      be missed during a real disconnect window, which needs a live server
      + a real network interruption to reproduce) is unconfirmed either
      way — the fix closes a real logical gap regardless of whether anyone
      has seen the bug it prevents.

---

### Desktop shell (`concord-shell/` — R8/CL4, Program B Phase 6)

The Tauri desktop shell that launches + supervises both `concord-frontend`
and the Godot binary as one packaged app is scaffolded (see
`concord-shell/README.md` for the full honesty ledger and
`docs/GODOT_INTEGRATION.md`'s "Desktop packaging" section). Its pure
process-lifecycle logic and its real-child-process orchestration glue are
compiled and tested for real (against throwaway `sh` processes, not the
actual npm/Godot binaries). Nothing about the actual packaged app running
has been observed:

- [ ] `cargo tauri dev` actually builds `concord-shell` on a machine with
      the Tauri Linux/macOS/Windows prerequisites installed — never
      attempted here (see the README's exact `gdk-sys`/pkg-config failure
      transcript for why not).
- [ ] The hand-authored `tauri.conf.json` (in particular `build.frontendDist`/
      `build.devUrl` pointing at a URL rather than a local dist folder, to
      wrap the already-running Next.js dev server) actually validates
      against the real Tauri v2 config schema and opens a window loading it
      — this file was written from memory of the public schema, not
      generated by `cargo tauri init` or checked by the CLI.
- [ ] The shell actually spawns a real `npm run dev` child and a real Godot
      binary child side by side, and both become reachable/visible in one
      window.
- [ ] Killing the Godot process out from under the shell (e.g. `pkill godot`)
      produces a visible, bounded-backoff restart within the configured
      interval — the STATE MACHINE and the real spawn/kill/try_wait plumbing
      are both tested in isolation (`concord-shell-core`'s test suite spawns
      real crashing `sh` processes and asserts the exact same code path),
      but the composed, real end-to-end behavior against a real Godot binary
      has never been watched.
- [ ] After a shell-triggered Godot restart, the freshly spawned process's
      `GatewayClient` reconnects and re-authenticates against a live server
      as smoothly as `docs/GODOT_INTEGRATION.md` claims it should (the
      "fresh process re-runs `boot.gd`'s `_ready()`, gets a fresh
      `GatewayClient` from scratch" argument is sound by code inspection,
      but has never been observed against a real reconnect).
- [ ] Whether the shell's health-check cadence / restart backoff defaults
      (2s tick, 1s→30s restart backoff, 5 max attempts — all env-overridable,
      see `concord-shell/README.md`'s configuration table) feel right in
      practice, or whether a crash-looping Godot process is disruptive/
      distracting before the shell gives up, is an untested judgment call —
      same "first-draft, untuned constant" honesty posture as the rest of
      this repo's Phase D dials.
- [ ] No application icon exists (`bundle.icon: []`, `bundle.active: false`
      in `tauri.conf.json`) — this is a dev-mode-only shell today, not a
      distributable installer; packaging a real icon + enabling bundle
      targets is unstarted follow-up work, not a bug.

---

Until every box above is checked on a real machine, treat the Godot client as
**structurally complete but visually unproven.**
