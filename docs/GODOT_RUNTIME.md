# Godot Runtime — making the engine a native part of Concord

**Status (2026-07-25): the engine is real here now.** `world-lens-godot/` was
previously validated by `gdtoolkit` (`gdparse` + `gdlint`) only — nothing in it had
ever run in a Godot editor or runtime, and every claim in
`world-lens-godot/VISUAL_QA.md` was unverified by construction.

A verified **Godot 4.4.stable.official.4c311cbee** binary was acquired and run
against the project. Results, in one line each:

| Check | Result |
|---|---|
| Project imports (`--headless --import`) | **PASS**, exit 0, zero project-attributable errors |
| All 64 `.gd` files parse/compile | **1 REAL DEFECT FOUND** (now fixed), then 64/64 clean |
| `boot.tscn` main scene runs (`--quit-after 60`) | **PASS**, exit 0, no runtime errors |
| Every `res://` reference resolves | **PASS** (1 apparent miss is a runtime format string, not a path) |
| **GDScript test suite actually executed** | **26 suites / 567 checks — 22 pass, 4 FAIL** (real logic defects) |
| Renderer / visual / perf claims | **STILL UNVERIFIED** — headless has no rasterizer. See §6. |

The 4 test failures and 1 runtime type error are **genuine findings, not noise**.
They were invisible to `gdlint` and are exactly what has never been checkable
before. They are reported faithfully in §3 and deliberately **not fixed** here
(they are gameplay/logic decisions, out of scope for a runtime-acquisition pass).

---

## 1. Which version, and why

`world-lens-godot/project.godot` declares:

```ini
config/features=PackedStringArray("4.4", "Forward Plus")
```

So the target is **4.4**, i.e. release tag `4.4-stable`. `scripts/fetch-godot.mjs`
*derives* this from `project.godot` rather than hardcoding it, so the engine cannot
silently drift away from the project it is meant to validate.

Note 4.4 is the **first** release where headless-without-a-GPU is reliably
non-crashing: [PR #98247](https://github.com/godotengine/godot/pull/98247) (milestone
4.4) stopped headless builds from creating a rendering device and from initialising
the GPU texture compressor. Pinning older than 4.4 would be a downgrade in exactly
the capability this document is about.

---

## 2. Acquisition — the exact commands that worked

### 2.1 The reproducible path

```bash
node scripts/fetch-godot.mjs          # fetch + verify into .godot-runtime/bin/godot
node scripts/fetch-godot.mjs --check  # verify an existing binary, fetch nothing
```

Real output from this repo:

```json
{
  "ok": true,
  "action": "fetched",
  "path": "/home/user/concord-cognitive-engine/.godot-runtime/bin/godot",
  "version": "4.4-stable",
  "source": "official",
  "verifiedBy": "SHA512-SUMS.txt",
  "sha256": "de53241695d40c42031a6ae5030f91150592668f257ff8bcf51fa51637f3d72a",
  "bytes": 126615056,
  "versionString": "4.4.stable.official.4c311cbee",
  "pinned": true
}
```

The binary is written to `.godot-runtime/bin/godot`, which is **gitignored**. No
binary is ever committed.

### 2.2 Provenance and integrity — verified two independent ways

**Route A — official vendor release (the primary path, and it works):**

```bash
curl -sSL -o Godot_v4.4-stable_linux.x86_64.zip \
  "https://github.com/godotengine/godot-builds/releases/download/4.4-stable/Godot_v4.4-stable_linux.x86_64.zip"
# http=200, 60,551,263 bytes, final_url=https://release-assets.githubusercontent.com/...

curl -sSL -o SHA512-SUMS.txt \
  "https://github.com/godotengine/godot-builds/releases/download/4.4-stable/SHA512-SUMS.txt"
# http=200, 4,523 bytes
```

Vendor-published line vs. locally computed — **exact match**:

```
3d56a7698bdf7027e41e5e0a930b6b93f89a204eb95b9cd0b8ae25180231994029e211984863a5ebb59759b3e602ae1d042e745ab1b7cbbfeda62652c3936f60  Godot_v4.4-stable_linux.x86_64.zip
```

**Route B — OCI registry fallback (independently corroborates Route A):**

Some locked-down environments allow a container registry but block release-asset
hosts, so `fetch-godot.mjs` also implements an OCI path against
`barichello/godot-ci:4.4` (whose own Dockerfile downloads *that same* official zip).
Registry blobs are content-addressed, so the manifest layer digest **is** the
checksum:

```
layer sha256:23c95a327f2b891ef6d7a0e2d41ea74b5ed031752ff4a0d9ce96dba99ed5be39  (1,283,403,050 B)
downloaded blob sha256 == manifest digest  ->  verified
```

The binary extracted from that layer is **byte-identical** (`cmp` clean) to the one
from the officially SHA512-verified zip:

```
de53241695d40c42031a6ae5030f91150592668f257ff8bcf51fa51637f3d72a  (OCI route)
de53241695d40c42031a6ae5030f91150592668f257ff8bcf51fa51637f3d72a  (official zip route)
```

Two independent acquisition paths converging on identical bytes, one of them checked
against the vendor's own published SHA512, is as strong as this gets without
code-signing.

**Measured artefact sizes (4.4-stable, linux x86_64):**

| Artefact | Download | On disk |
|---|---:|---:|
| `Godot_v4.4-stable_linux.x86_64.zip` (editor) | 57.7 MiB | **120.8 MiB** (single binary) |
| `Godot_v4.4-stable_export_templates.tpz` (all platforms) | 1.12 GiB | 1.84 GiB |
| ↳ `templates/linux_release.x86_64` alone | 24.6 MiB | 66.4 MiB |

Export templates were **not** installed for this pass: the project has no
`export_presets.cfg`, so there is nothing to export. They are obtainable by the same
routes when export verification is wanted.

### 2.3 Egress notes (honest record of what was blocked)

In the container where this work was done, the agent proxy's behaviour was **not**
uniform across GitHub:

| Host | Result |
|---|---|
| `github.com/.../releases/download/...` → `release-assets.githubusercontent.com` | **200 — works** |
| `raw.githubusercontent.com` | 200 |
| `api.github.com` (repo endpoints) | 403 — session-scoped repo allowlist; needs an approval step |
| `github.com/godotengine/godot/releases` (HTML page) | 403 |
| `godotengine.org`, `downloads.tuxfamily.org` | 403 CONNECT tunnel refused |
| `docs.godotengine.org`, `godot.foundation` | 403 |
| `mirror.gcr.io` (registry API **and** blobs) | 200 — works |
| `registry-1.docker.io` API | 200; its blob CDN `production.cloudfront.docker.com` | **403** |

Practical consequence: **the release-asset download endpoint is reachable even when
`api.github.com` and the vendor site are not.** `fetch-godot.mjs` therefore
constructs known asset filenames rather than enumerating them through the API.

---

## 3. Validation results — the real output

All commands below were run with
`GD=.godot-runtime/bin/godot` and a scratch `HOME`.

### 3.1 Project import

```console
$ $GD --headless --path world-lens-godot --import
Godot Engine v4.4.stable.official.4c311cbee - https://godotengine.org
ERROR: Do not use progress dialog (task) while flushing the message queue or using call_deferred()!
   at: add_task (editor/progress_dialog.cpp:183)
ERROR: Condition "!tasks.has(p_task)" is true. Returning: canceled
   at: task_step (editor/progress_dialog.cpp:217)
   ... (6 more identical lines)
=== EXIT: 0 ===
```

**Those `progress_dialog.cpp` errors are engine-side headless noise, not a project
defect.** Proven by control experiment — a project containing *zero* files emits the
identical block:

```console
$ mkdir empty && printf 'config_version=5\n\n[application]\n\nconfig/name="empty"\n' > empty/project.godot
$ $GD --headless --path empty --import
Godot Engine v4.4.stable.official.4c311cbee - https://godotengine.org
ERROR: Do not use progress dialog (task) ...        # ← identical output
=== EXIT: 0 (control: a project with ZERO files) ===
```

The strongest project-level check, a full headless editor open, is also clean:

```console
$ $GD --headless --path world-lens-godot -e --quit
Godot Engine v4.4.stable.official.4c311cbee - https://godotengine.org
=== EXIT: 0 ===     (progress_dialog noise filtered)
```

### 3.2 Script compilation — 1 real defect found

The **first ever** engine run of this project surfaced a genuine bug that `gdlint`
structurally cannot catch (it does not resolve cross-file call signatures):

```console
SCRIPT ERROR: Parse Error: Too few arguments for "check_eq()" call. Expected at least 3 but received 2.
          at: GDScript::reload (res://tests/test_conkay_presence_state.gd:78)
          at: GDScript::reload (res://tests/test_conkay_presence_state.gd:79)
          at: GDScript::reload (res://tests/test_conkay_presence_state.gd:80)
SCRIPT ERROR: Compile Error: Failed to compile depended scripts.
          at: GDScript::reload (res://tests/run_all.gd:0)
ERROR: Failed to load script "res://tests/run_all.gd" with error "Parse error".
```

`tests/test_utils.gd:23` declares `func check_eq(actual, expected, label: String)` —
three required parameters. Three call sites passed two. **The entire GDScript test
suite could not compile, and therefore had never run.**

**The old toolchain reports this file as perfect.** Run against the exact
pre-fix file that the real engine rejects with a hard parse error
(`gdtoolkit` 4.5.0, the linter this project was validated with):

```console
$ gdparse broken.gd
gdparse exit=0
$ gdlint broken.gd
Success: no problems found
gdlint exit=0
```

That is the whole argument for making the engine native, in five lines: `gdlint`
does single-file syntax and style, it does not resolve cross-file call signatures,
so a green lint run said nothing about whether this code could load.

A per-file sweep over all 64 `.gd` files
(`$GD --headless --check-only --script res://<file>`) found **exactly these two
files failing** (the second only as a dependency cascade); the other 62 compiled
clean.

**This was fixed** — it is unambiguous mechanical breakage (a required argument was
missing; every other call site in the file supplies one), and fixing it is what
unlocked actually *running* the suite. The fix adds the missing descriptive labels
in the file's existing style; no assertion semantics were changed. After the fix:
**64/64 files compile clean.**

### 3.3 Scene load and main-scene run

```console
$ $GD --headless --path world-lens-godot --quit-after 60
Godot Engine v4.4.stable.official.4c311cbee - https://godotengine.org
[boot] disconnected: close_-1_
=== EXIT: 0 ===
```

`boot.tscn` loads, `boot.gd::_ready` runs, and the only output is the client's own
honest log line reporting that no gateway is listening — correct behaviour, not an
error.

Every `res://` literal in every `.gd`/`.tscn` was checked against the filesystem:
**0 missing**. (One apparent miss, `res://world/chunks/chunk_`, is the prefix of the
runtime format string `"res://world/chunks/chunk_%d_%d.tscn"` at
`world/chunk_manager.gd:32` — a template, not a static path. Those chunk scenes are
generated at runtime and do not exist in-repo.)

### 3.4 The test suite, actually executed — 4 real failures

```console
$ $GD --headless --path world-lens-godot --script res://tests/run_all.gd
Godot Engine v4.4.stable.official.4c311cbee - https://godotengine.org

SCRIPT ERROR: Trying to assign value of type 'String' to a variable of type 'Array'.
          at: placement_to_transform (res://world/dtu_prop_renderer.gd:187)
[PASS] ChunkManager (16 checks)
[PASS] LodPolicy (23 checks)
[PASS] PropInstancer (8 checks)
[PASS] CharacterController (32 checks)
[PASS] DtuPropRenderer (16 checks)
[PASS] DtuPropInteraction (11 checks)
[PASS] AnimationStateMachine (43 checks)
[PASS] GaitSolver (74 checks)
[FAIL] FlightController (1/18 checks failed):
    - level flight bleeds airspeed at AIRSPEED_BLEED per second (expected ~9.6, got 9.9)
[PASS] GroundVehicleController (16 checks)
[PASS] MountController (10 checks)
[FAIL] AerialMountController (1/17 checks failed):
    - under-cap velocity is returned with its original magnitude (expected ~5.0, got 5.02493762969971)
[PASS] DesignCommandClient (8 checks)
[PASS] DesignPlaytestClient (8 checks)
[PASS] LandAirTransitionController (37 checks)
[PASS] SceneBootstrap (22 checks)
[PASS] AerialTrafficController (10 checks)
[FAIL] AirLegibility (1/30 checks failed):
    - a district with no real palette data is flagged, not silently faked (expected false, got true)
[PASS] FeaSceneBuilder (22 checks)
[PASS] ConKayPresenceState (22 checks)
[PASS] ConKayPointing (20 checks)
[PASS] SessionManager (21 checks)
[PASS] CameraRig (17 checks)
[PASS] DistrictStreamingPolicy (18 checks)
[PASS] RooftopAccessController (14 checks)
[FAIL] WayfindingMarkers (1/34 checks failed):
    - yaw matches ConKayPointing.yaw_pitch_to's own convention (expected ~3.14159265358979, got -3.14159265358979)
=== EXIT: 1 ===
```

**26 suites, 567 checks: 22 suites pass, 4 fail.** Triage, for whoever picks these up:

| # | Finding | Notes |
|---|---|---|
| 1 | **Runtime type error**, `world/dtu_prop_renderer.gd:187` | `var pos: Array = placement.get("position", [0,0,0])`. The statically-typed `Array` assignment throws *before* the `if typeof(pos) == TYPE_ARRAY` guard on the next line can run — so the function's documented "missing/malformed position defaults to the origin, never a fabricated offset" defence is **dead code** on the malformed-input path it exists for. Note the suite still reports `[PASS] DtuPropRenderer` — the error is non-fatal at runtime, so this defect is invisible unless you read the engine log. |
| 2 | `FlightController` — airspeed bleed | expected ~9.6, got 9.9. Off-by-one-tick or a rate/`delta` mismatch. |
| 3 | `AerialMountController` — under-cap velocity | expected ~5.0, got 5.02493762969971. Float tolerance vs. a genuine clamp bug — needs a human call. |
| 4 | `AirLegibility` — **honesty invariant** | *"a district with no real palette data is flagged, not silently faked (expected false, got true)"*. This is the one to look at first: it asserts a zero-demo-content guarantee and it is currently failing. |
| 5 | `WayfindingMarkers` — yaw sign | expected `+π`, got `−π`. A convention mismatch against `ConKayPointing.yaw_pitch_to`; harmless at ±π but a real sign inconsistency elsewhere in the range. |

None of these were fixed here — they are logic/design decisions, not mechanical
breakage.

### 3.5 Reproduce everything

```bash
node scripts/fetch-godot.mjs
GD=$PWD/.godot-runtime/bin/godot

# 1. import (ALWAYS a separate pass — see the --quit-after landmine below)
$GD --headless --path world-lens-godot --import

# 2. every script parses/compiles
cd world-lens-godot
for f in $(find . -name '*.gd' | sed 's|^\./|res://|'); do
  $GD --headless --check-only --script "$f" 2>&1 | grep -E "SCRIPT ERROR|Parse Error|Compile Error" && echo "^^ $f"
done; cd ..

# 3. main scene runs
$GD --headless --path world-lens-godot --quit-after 60

# 4. the test suite
$GD --headless --path world-lens-godot --script res://tests/run_all.gd
```

> **Landmine:** never fold the import into the run with `--quit` / `--quit-after 1`.
> [godotengine/godot#77508](https://github.com/godotengine/godot/issues/77508):
> import needs more than one iteration to finish writing `.godot/imported/`, and
> quitting after one frame leaves half-imported state that makes every downstream
> load fail. Always do a separate `--import` pass first.

---

## 4. Licensing — what shipping the binary actually obliges

**Godot Engine is MIT/Expat.** The operative clause in
[`LICENSE.txt`](https://raw.githubusercontent.com/godotengine/godot/master/LICENSE.txt)
is one sentence:

> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.

Copyright holders to name: `Copyright (c) 2014-present Godot Engine contributors
(see AUTHORS.md).` and `Copyright (c) 2007-2014 Juan Linietsky, Ariel Manzur.`

There is **no** reciprocity, no source-provision duty, and no advertising clause.
Godot's own
[Complying with licenses](https://raw.githubusercontent.com/godotengine/godot-docs/master/about/complying_with_licenses.rst)
doc states:

> In the case of the MIT license, the only requirement is to include the license
> text somewhere in your game or derivative project.
>
> The license text must be made available to the user.

Accepted delivery mechanisms per that doc: a credits screen, a "Third-party
Licenses" settings menu, printing to the output log, **an accompanying file
installed alongside the software**, or a documentation link — the docs explicitly
accept *"a link to `godotengine.org/license` in your game documentation or
credits"*.

**Game-vs-engine distinction (the practical answer is: nearly the same).** An
exported game *embeds an export template*, which *is* the engine binary, so MIT
attaches either way. Redistributing the editor/headless binary itself is the
unambiguous case — you are distributing "copies of the Software" — and the cleanest
compliance is the accompanying-file route.

**Concrete obligation for Concord:** ship two files next to whatever engine binary
is distributed:

| File | Source | Size | Why |
|---|---|---|---|
| `LICENSE.txt` | `godotengine/godot` root | ~1 KB | The MIT copyright + permission notice. **Required.** |
| `GODOT_COPYRIGHT.txt` | `COPYRIGHT.txt` from the repo root, renamed | ~93 KB | Third-party components bundled *inside* Godot (107 `License:` stanzas, Debian machine-readable format). Godot's docs explicitly recommend this rename to avoid confusion with your own copyright. |

There is no `THIRDPARTY_NOTICES` file — `COPYRIGHT.txt` is the canonical artefact. A
per-library human index lives at `thirdparty/README.md`.

A more robust alternative to vendoring stale text is to source it at runtime:
`Engine.get_license_text()`, `Engine.get_license_info()`,
`Engine.get_copyright_info()` — these can't drift across an engine bump.

**Two things MIT does *not* give you:**

- **The logo is not MIT.** `misc/logo/LICENSE.txt`: *"Godot Engine Logo — Copyright
  (c) 2017 Andrea Calabró … licensed under CC BY 4.0 International."* Attribution
  required, separate regime.
- **The trademark is not MIT.** "GODOT" / "GODOT ENGINE" word marks and the logo are
  registered to the Godot Foundation. Using them in credits or a splash screen is
  reportedly fine; naming or branding a product after them requires written
  authorisation. ⚠️ `godot.foundation` was blocked from the research container, so
  the trademark-policy specifics are **secondhand and should be re-verified**
  against <https://godot.foundation/policies-and-procedures/trademark-policy>
  before any branding decision. The logo's CC BY 4.0 license, by contrast, was
  fetched primary from the repo.

Practical read for Concord: attribution is cheap and unambiguous — ship the two
files, add a "Powered by Godot Engine" credit line. Do not put a Godot logo or the
Godot name in Concord's own product branding without checking the trademark policy.

---

## 5. How it becomes native — the recommendation

### 5.1 Options and real tradeoffs

| Option | Repo/installer cost | Verdict |
|---|---|---|
| **(a) Commit the binary in-repo** | 120.8 MB per version, **forever** in git history | ✗ **No.** GitHub's hard limit is 100 MB/file, so the raw binary cannot even be pushed without LFS; the 57.7 MB zip trips the 50 MB warning. Two engine bumps ≈ 250 MB of permanently-unclonable history. |
| **(b) Download-on-setup + pinned checksum** | ~0 in repo; 57.7 MB once at setup | ✓ **Recommended baseline.** Matches Concord's one-touch self-host story exactly. Needs network at setup time and a cache/concurrency guard. **This is what `scripts/fetch-godot.mjs` implements.** |
| **(c) Tauri sidecar (`externalBin`)** | +~58 MB compressed in **every** installer, **per platform** | ✓ **Additive, when shipping a desktop installer.** `concord-shell/` already exists (Tauri v2, `src-tauri/tauri.conf.json`) — but note `bundle.active` is currently `false` and `targets` is empty, so no installer is produced today. Sidecars need a `-$TARGET_TRIPLE`-suffixed copy per arch and an explicit `shell:allow-execute` capability. ⚠️ Security: granting `"args": true` on a binary that runs arbitrary GDScript is effectively arbitrary code execution — scope the args allowlist. |
| **(d) npm package wrapper** | ~0 in repo | ✗ Not worth it. No well-adopted package exists that vendors the Godot binary, so this reduces to (b) plus npm lifecycle plumbing — and `postinstall` scripts are disabled by default in hardened environments (`npm ci --ignore-scripts`, pnpm allowlists), so it silently installs broken. The modern alternative (per-platform `optionalDependencies`) means republishing ~58 MB per platform per engine version. |
| **(e) System package / user install** | 0 | ✗ Not as a dependency. Version skew is severe and Godot pins matter — a project imported by 4.7 will not open in 4.4. Flathub currently builds **4.7.1**; snaps (`godot4`, `godot-4`) are unofficial and years stale. Fine as a *developer convenience* override, never as the contract. |

### 5.2 Recommended path

**(b) as the contract, (c) as an additive packaging step, with an escape hatch.**

1. **`scripts/fetch-godot.mjs` is the single source of truth.** Version derived from
   `project.godot`; every route checksum-gated; honest `{ok:false, reason}` + non-zero
   exit on failure. Already implemented and tested (both routes, plus both failure
   modes).
2. **Wire it into `setup.sh`** as an *optional, non-fatal* step, consistent with the
   existing one-touch self-host flow. The Godot client is not required to run the
   Concord server, so a failed engine fetch must warn, not abort. Suggested shape:
   ```bash
   if [ "${CONCORD_FETCH_GODOT:-1}" = "1" ]; then
     node scripts/fetch-godot.mjs || echo "[warn] Godot engine not fetched; world-lens-godot validation unavailable"
   fi
   ```
   *(Not applied in this pass — `setup.sh` was outside the permitted edit scope.)*
3. **Honour an existing install.** If `GODOT_BIN` is set or `godot` is on `PATH` at a
   matching version, use it and skip the download — this is where (e) belongs.
4. **CI/`--check`.** `node scripts/fetch-godot.mjs --check` is a cheap gate that
   fails loudly if the engine is missing or has the wrong checksum, so a validation
   job can never silently degrade back to lint-only.
5. **Tauri sidecar, later and only if `concord-shell/` starts producing installers.**
   It is the right shape for a shipped desktop product, but it is packaging work with
   a real per-platform size cost, and it is premature while `bundle.active` is `false`.
6. **Licensing files travel with the binary** in whichever option is live (§4).

Deliberately *not* recommended: committing the binary, or depending on a
system-installed Godot.

---

## 6. What headless CAN and CANNOT verify

`--headless` is precisely two driver substitutions —
`--display-driver headless --audio-driver Dummy`. Confirmed in engine source
([`servers/display_server_headless.h`](https://raw.githubusercontent.com/godotengine/godot/4.4-stable/servers/display_server_headless.h)):
it installs `RasterizerDummy`, offers only the `"dummy"` rendering driver, and
`has_feature()` returns `false` for everything. **There is no rendering at all — not
"software rendering."** Everything else (SceneTree, physics, scripting VM,
networking, file I/O, resource import) runs normally.

### 6.1 CAN / CANNOT

| Capability | Headless? | Notes |
|---|---|---|
| Project imports without errors | ✅ **CAN** | `--import`. Verified — exit 0. |
| GDScript parse/compile across all files | ✅ **CAN** | `--check-only --script`. Found a real defect. |
| Cross-file call-signature errors | ✅ **CAN** | The exact class `gdlint` cannot see. |
| `.tscn` scene load, missing `ext_resource`, broken UIDs | ✅ **CAN** | Verified on `boot.tscn`. |
| Main scene `_ready` runs without runtime errors | ✅ **CAN** | `--quit-after N`. Verified. |
| Runtime type errors in exercised code paths | ✅ **CAN** | Found one (`dtu_prop_renderer.gd:187`). |
| Unit-test suite execution + pass/fail | ✅ **CAN** | Verified — found 4 failures. |
| Resource import correctness (bad PNG/glTF/font) | ✅ **CAN** | Importers run CPU-side and write `.import` + `res://.godot/imported/`. **Moot for this project**: it currently contains **zero** importable binary assets — only `.gd` files and one `.tscn`. |
| Physics, signals, networking, game logic | ✅ **CAN** | Full SceneTree lifecycle. |
| Export packaging / PCK contents | ⚠️ **CAN, not done** | Needs export templates **and** an `export_presets.cfg`, which this project does not have. |
| **Anything rendered — geometry on screen, position/rotation/scale parity vs. the Three.js client** | ❌ **CANNOT** | `RasterizerDummy` draws nothing. |
| **Shader compilation** | ❌ **CANNOT** | `.gdshader` never reaches a GPU compiler; custom `.glsl` *hard-fails* to import headless. Moot today — the project has **no** shader files. |
| **Framerate, draw calls, VRAM budget** | ❌ **CANNOT** | No GPU work happens at all. |
| **Control/viewport layout depending on screen metrics** | ❌ **CANNOT** | `screen_get_count()` → `0`, `screen_get_size()` → `Size2i()`, `has_feature()` → `false`. Code branching on those takes a different path than on a real display. |
| **Visual smoothness / interpolation feel at real latency** | ❌ **CANNOT** | Buffer *math* is unit-testable; perceived smoothness is not. |
| **Texture upload to GPU** | ❌ **CANNOT** | Compressed file is produced; nothing is uploaded. |

### 6.2 The middle ground, and its honest limits

For screenshot-level checks, do **not** use `--headless` — use a virtual display:
`xvfb-run` + `--rendering-method gl_compatibility` (Mesa **llvmpipe** software
OpenGL), optionally with `--write-movie out.png --fixed-fps --quit-after N` for
frame-exact capture.

Prefer OpenGL compatibility over Vulkan/lavapipe:
[godotengine/godot#82435](https://github.com/godotengine/godot/issues/82435)
(software-Vulkan crashes) is **still open**, and
[#92653](https://github.com/godotengine/godot/issues/92653) shows lavapipe output is
not pixel-faithful anyway.

**This is a smoke gate, not a rendering oracle.** It catches gross regressions
(black screen, missing node, wrong layout). It does **not** verify GPU-correct
output — llvmpipe differs from real drivers in precision, extensions, and shader
behaviour, so a shader that compiles there may still fail on a real GPU. Items
marked ❌ above stay ❌ until a human looks at a real display.

---

## 7. Repository hygiene

- `.godot-runtime/` — gitignored. The engine binary lives here; **never committed**.
- `world-lens-godot/.godot/` — gitignored. Per-project import cache, regenerated by
  `--import`; upstream Godot docs say to ignore it.
- `world-lens-godot/**/*.gd.uid` — **64 files generated by the import pass, left
  untracked and deliberately NOT gitignored.** Upstream Godot 4.4 guidance is to
  *commit* `.uid` files so resource references stay stable. That is a real decision
  with repo-wide consequences, so it is flagged here for a human rather than made
  silently in a runtime-acquisition pass.

## 8. Related documents

- `world-lens-godot/VISUAL_QA.md` — the human-eyes queue. Items newly covered by
  machine verification have been moved out of it and are marked with the command
  that proves them; genuinely visual items remain.
- `world-lens-godot/HOW_TO_RUN.md`, `docs/GODOT_INTEGRATION.md`,
  `docs/GODOT_PROTOCOL.md` — client/protocol design.
- `scripts/fetch-godot.mjs` — the acquisition script described in §2.
