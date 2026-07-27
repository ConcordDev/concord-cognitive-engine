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
| **GDScript test suite actually executed** | originally **26 suites / 567 checks — 22 pass, 4 FAIL** (real logic defects); **re-measured 2026-07-25: 26/26 pass**, defects since fixed |
| **Export packaging (`--export-release`)** | **PASS** (2026-07-25) — Linux/X11 **and** Web both export clean; exported binary boots and re-runs the suite 26/26. See §3.6. |
| Renderer / visual / perf claims | **STILL UNVERIFIED** — headless has no rasterizer. See §6. |

The 4 test failures and 1 runtime type error were **genuine findings, not noise**.
They were invisible to `gdlint` and are exactly what had never been checkable
before. They are reported faithfully in §3.4 as originally found, and were
deliberately left unfixed by the runtime-acquisition pass itself (they are
gameplay/logic decisions).

> **Status update (2026-07-25):** all 5 have since been fixed. A re-run measured
> **26/26 suites green, exit 0**, with no runtime type error in the engine log.
> §3.4 is kept as the original as-found record rather than rewritten, because the
> point of that section is *what the first real engine run surfaced*. The same
> suite also now passes when run from inside an **exported** build (§3.6).

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

**Update 2026-07-25 — templates are now installed and export is verified.** The
earlier note here ("not installed for this pass: the project has no
`export_presets.cfg`, so there is nothing to export") is **superseded**. The
project now has a real `export_presets.cfg`, and the templates were fetched by the
same release-asset route as the engine and verified against the same published
`SHA512-SUMS.txt`:

```
ce5801d2868f8217eb200b402918494184486dab0ea7be97f9ffab73b9283241b6e8c2e3b4ae58218b09b56743449f1d55240f9db50a045efe6186aea0fd8c2c  Godot_v4.4-stable_export_templates.tpz
```

vendor-published line vs. locally computed — **exact match**, 1,205,251,984 bytes.

```bash
# opt-in, separate from the engine fetch (it is ~20x larger)
node scripts/fetch-godot.mjs --export-templates
node scripts/fetch-godot.mjs --export-templates --templates-subset linux,web  # 626 MB instead of 1.97 GB
node scripts/fetch-godot.mjs --export-templates --check                       # verify, fetch nothing
```

Real output from this repo (full, all-platform run):

```json
{
  "ok": true,
  "action": "fetched",
  "kind": "export-templates",
  "version": "4.4.stable",
  "dir": "<templates-root>/4.4.stable",
  "subset": "all",
  "templateCount": 34,
  "bytesOnDisk": 1970909877,
  "verifiedBy": "SHA512-SUMS.txt"
}
```

Two details worth knowing before you reimplement this by hand:

- **The release tag is not the directory name.** Godot looks for `4.4.stable`, not
  `4.4-stable`. The authoritative value is `templates/version.txt` *inside* the
  archive; `fetch-godot.mjs` reads it from there rather than transforming the tag,
  so an upstream naming change cannot silently misplace the templates.
- **Templates live in the editor data dir, not the project.** On Linux that is
  `${XDG_DATA_HOME:-~/.local/share}/godot/export_templates/4.4.stable/`. Override
  with `GODOT_TEMPLATE_DIR` or `--templates-dest`.
- The 1.12 GiB `.tpz` is **deleted after extraction** by the script. It is also
  gitignored, as is every artefact discussed here (§7).
- **`--templates-subset` saves less than you might assume.** Measured: `linux,web`
  is **626 MB / 16 files**, not ~160 MB — `linux_*` matches all four architectures
  (x86_64, x86_32, arm64, arm32) × debug+release, and `web_*` matches all eight
  threading/dlink variants. Only `templates/linux_release.x86_64` (66.4 MB) is
  needed for the Linux export verified in §3.6. Full set: **1.97 GB / 34 files**.
- The script shells out to `unzip`/`tar` via **`execFileSync` argv form, never a
  shell string**. This is load-bearing, not style: the paths and glob patterns are
  network- and caller-derived, and quoting is not a fix — `JSON.stringify` emits
  double quotes, inside which a shell still performs `$(...)` command
  substitution. Argv form removes the shell entirely, and additionally lets the
  glob patterns reach `unzip` unexpanded so `unzip` does its own matching.

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

### 3.6 Export verification — first time this has ever been checkable

Export had never been verified because the project had no `export_presets.cfg`.
One now exists (`world-lens-godot/export_presets.cfg`, Linux/X11 + Web).

**How the preset was written, since "do not guess at fields" matters here.** Every
key in it was checked against the engine binary's own registered option names
(`strings .godot-runtime/bin/godot | grep -E "^(binary_format/|texture_format/|html/|variant/|…)"`)
rather than copied from a tutorial. Options the engine defines but that are left at
their defaults are **omitted on purpose**: a preset that omits an option gets the
engine's `get_export_options()` default, whereas a key the engine does not register
is silently ignored — absent is safer than invented. One thing that genuinely
cannot be guessed and had to be resolved empirically: the platform identifier is
`platform="Linux"`, **not** `"Linux/X11"` (both strings exist in the 4.4 binary;
only the former is the registered platform name — `"Linux/X11"` survives as the
human-facing preset *name*).

**Linux/X11 release export — real output, abridged only where a 102-step
file-by-file packing log repeats:**

```console
$ GD=.godot-runtime/bin/godot
$ $GD --headless --path world-lens-godot --import          # separate pass, always
=== IMPORT EXIT: 0 ===

$ $GD --headless --path world-lens-godot \
      --export-release "Linux/X11" /tmp/out/world-lens.x86_64
Godot Engine v4.4.stable.official.4c311cbee - https://godotengine.org
first_scan_filesystem: begin: Project initialization steps: 5
first_scan_filesystem: end
savepack: begin: Packing steps: 102
	savepack: step 2: Storing File: res://assets/asset_resolver.gdc
	... (64 .gdc scripts + 64 .gd.remap + boot.scn + project.binary)
savepack: end
=== EXPORT EXIT: 0 ===

$ ls -l /tmp/out/
-rw-r--r--    238048  world-lens.pck
-rwxr-xr-x  69659512  world-lens.x86_64
```

**No errors, no warnings, exit 0.** Note the pack contains `.gdc` (compiled
bytecode) plus `.gd.remap` files — that is `script_export_mode=2` working as
intended, not a defect.

**Then the exported artefact was actually run**, which is the part that turns
"a file was produced" into "the package works":

```console
$ ./world-lens.x86_64 --headless --version
4.4.stable.official.4c311cbee

$ ./world-lens.x86_64 --headless --quit-after 60
Godot Engine v4.4.stable.official.4c311cbee
[boot] disconnected: close_-1_          # the client's own honest "no gateway" log
=== RUN EXIT: 0 ===

$ ./world-lens.x86_64 --headless --script res://tests/run_all.gd
[PASS] ChunkManager (16 checks)
... 26 suites ...
[PASS] WayfindingMarkers (35 checks)
=== TESTS EXIT: 0 ===        # 26/26 green, from inside the exported PCK
```

Running the suite *from the PCK* is a distinct claim from running it from source:
it additionally proves nothing in the project depends on loose source files being
present at runtime, and that the `.gdc`/`.remap` compiled-script path resolves.

**Web export also succeeds:**

```console
$ $GD --headless --path world-lens-godot --export-release "Web" /tmp/web/index.html
=== WEB EXPORT EXIT: 0 ===

$ ls -l /tmp/web/
     5406  index.html          370560  index.js
   238064  index.pck         41833007  index.wasm
     7298  index.audio.worklet.js   +  icons
```

⚠️ **Limits of the Web result, stated plainly.** The bundle *builds*; it has never
been *served or opened* by a real browser in this environment (this sandbox's
egress is policy-locked to godotengine.org, so an end-to-end serve-and-load
check cannot be run here — see `scripts/export-godot-web.mjs`, which
reproduces this export into `concord-frontend/public/godot-client/`, a
location the frontend already serves with no new infra required).

**Update (audit 2026-07-27):** `export_presets.cfg`'s Web preset now sets
`variant/thread_support=false` (was `true`) — the fastest path to an
actually-loadable browser build. `thread_support=true` requires the server to
send `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy:
require-corp` on every response serving the bundle (SharedArrayBuffer's
browser requirement) or the build refuses to start in *any* browser; nothing
in this repo emitted those headers, so `true` was a real, load-bearing
blocker, not a theoretical one. `false` costs single-threaded WASM
performance but has zero server-header dependency. Flip back to `true`
together with adding COOP/COEP headers wherever the bundle is served
(`infra/cloudflare/` + `nginx/conf.d/`), not before.

**What export verification does and does not prove.** It proves the project packs,
links against real export templates, and that the packed game boots and executes
its own logic. It proves **nothing about appearance** — the exported binary was
itself run `--headless`, so no pixel has been rendered on any path in this
document. Every ❌ row in §6.1 stays ❌.


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

### 4.1 Three separate regimes — do not conflate them

The single most common licensing error with Godot is treating "it's MIT" as
covering everything. It does not. There are **three** independent regimes:

| Regime | Covers | Instrument | Sourced firsthand? |
|---|---|---|---|
| **Copyright — code** | the engine source and binaries | MIT/Expat, `LICENSE.txt` | ✅ yes |
| **Copyright — logo** | the Godot logo artwork | CC BY 4.0, `LOGO_LICENSE.txt` | ✅ yes |
| **Trademark** | the *GODOT* / *GODOT ENGINE* word marks and the logo **as marks** | Godot Foundation trademark policy | ❌ **NO — see §4.3** |

MIT grants copyright permissions only. It is **not** a trademark licence, and it
contains no trademark clause of any kind — verified by grep over the retrieved
`LICENSE.txt`. So "the code is MIT" tells you nothing about whether you may use the
*name*.

### 4.2 The logo — CC BY 4.0 (firsthand)

Retrieved verbatim from
`https://raw.githubusercontent.com/godotengine/godot/4.4-stable/LOGO_LICENSE.txt`
(HTTP 200):

```
Godot Engine Logo
Copyright (c) 2017 Andrea Calabró

This work is licensed under the Creative Commons Attribution 4.0 International
license (CC BY 4.0 International): https://creativecommons.org/licenses/by/4.0/
```

> **Path correction.** An earlier revision of this document cited
> `misc/logo/LICENSE.txt`. That path returns **404**. The file is `LOGO_LICENSE.txt`
> at the repo root **on the `4.4-stable` tag**; note it also 404s on `master`, so
> pin the tag when citing it.

Note the CC BY copyright licence and the trademark are *both* live on the logo
simultaneously: CC BY lets you copy the artwork with attribution; it does not let
you use it as a brand identifier for your own product.

### 4.3 The trademark — ⚠️ NOT SOURCED FIRSTHAND. NEEDS HUMAN CONFIRMATION.

**This is the honest state of it: the policy's actual terms could not be
retrieved, and nothing below should be relied on for a branding decision.**

**What IS established firsthand:**

1. **The marks are Foundation-owned, and ownership is separate from copyright.**
   From `godot-website/pages/governance.html` (HTTP 200), verbatim:

   > While the Godot Foundation holds assets on behalf of Godot including
   > trademarks, contracts, and the bank account, the copyright to Godot's source
   > is held collectively by every contributor.

2. **Chain of title.** From `godot-website`'s Dec 2024 foundation update
   (HTTP 200), verbatim:

   > We registered the Godot trademark and the Godot logo trademark while still a
   > member project of the SFC. Last year, the SFC granted the Godot Foundation
   > ownership over the trademarks. Now we need to have a public policy that says
   > how and when others can use the trademarks to protect them.
   >
   > We are working with our lawyers to craft a policy that is fair to existing
   > users, as permissive as possible, and still able to protect our trademark.

3. **There is no trademark document in any Godot Git repository.**
   `TRADEMARK.md` and `TRADEMARKS.md` → **404** on both `4.4-stable` and `master`.
   `LICENSE.txt`, `README.md`, `CONTRIBUTING.md` contain **zero** occurrences of
   "trademark". An exhaustive GitHub code search across `org:godotengine` found no
   policy text, only the website article quoted above.

4. **The official compliance doc is silent on trademarks.** `grep -c trademark` over
   the full text of
   `godot-docs/master/about/complying_with_licenses.rst` (HTTP 200) returns **0**.
   This is a load-bearing negative finding: Godot's own *"how do I comply when I
   ship Godot"* document covers the copyright regime **only**. It cannot be cited
   as trademark permission, and reading it as blanket clearance is exactly the
   conflation error §4.1 warns about.

**Why it could not be sourced.** The policy is **web-only and not in Git**, so no
`raw.githubusercontent.com` route can reach it even in principle. Every host that
serves it is blocked by this container's egress proxy:

| Host | Result |
|---|---|
| `godot.foundation` (incl. `/policies-and-procedures/trademark-policy`) | `curl (56) CONNECT tunnel failed, 403` |
| `docs.godotengine.org`, `godotengine.org`, `forum.godotengine.org` | 403 |
| `web.archive.org` | 403 — proxy said `Host not in allowlist` |
| `archive.ph`, `timetravel.mementoweb.org`, `r.jina.ai`, `trademarks.justia.com` | 403 |

The `WebFetch` tool routes through the same proxy and returned 403 on all of them —
no advantage over `curl`.

**Secondhand only — search-index summaries, wording NEVER verified. Do not quote
these as the policy.** A search index indicates a page titled *"GODOT TRADEMARK
POLICY AND LICENSE"* exists at that URL (so the policy promised in Dec 2024 did
ship), and *reportedly*: use in a game's splash screen or credits is not a
violation; using the marks as the name of a commercial game engine (including a
commercial fork) requires a separate licence; the marks may not be used "in
isolation"; a non-affiliation disclaimer is recommended but not mandatory.
**Every clause in that sentence is unverified paraphrase.**

**The specific question this document exists to answer — may Concord redistribute
an unmodified Godot binary inside its product, and what may it call it — is NOT
answered by anything retrieved.** The nearest signal (splash/credits permitted,
engine-naming restricted) is secondhand and does not address bundling a binary.

**To close this, a human must** open
<https://godot.foundation/policies-and-procedures/trademark-policy> from an
unrestricted network and read the *"When can you use the trademarks?"* section, or
get `godot.foundation` added to the proxy allowlist.

### 4.4 Practical read for Concord

Attribution under the two **copyright** regimes is cheap, unambiguous, and fully
sourced: ship `LICENSE.txt` + `GODOT_COPYRIGHT.txt` next to the binary, and add a
credit line. That much is safe today.

**Trademark use is a separate decision and is NOT cleared.** Until §4.3 is closed by
a human: do not put the Godot name or logo in Concord's own product branding,
installer name, marketing, or anything that could imply endorsement or affiliation.
A factual credit ("built with the Godot Engine") in credits/about is the
conservative posture — but note that even that rests on a secondhand reading, so
treat it as low-risk-pending-confirmation rather than verified-permitted.

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
| Export packaging / PCK contents | ✅ **CAN — DONE** | Both blockers are gone: `export_presets.cfg` exists and templates are SHA512-verified-fetchable. Linux/X11 **and** Web export exit 0; the exported Linux binary boots (`--quit-after`, exit 0) and re-runs the whole suite 26/26 from inside the PCK. §3.6. |
| Exported build *launches with a window and draws a frame* | ❌ **CANNOT** | The exported binary was itself run `--headless`. Packaging ≠ appearance — do not read the row above as a rendering claim. |
| Web export *loads in a browser* | ❌ **CANNOT** | The bundle builds (41.8 MB `index.wasm`), but was never served or opened. It ships `variant/thread_support=true`, so it additionally needs `COOP`/`COEP` cross-origin-isolation headers from the server or it will not start. |
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
- **Export templates are never committed either.** They install to the *editor data
  dir* (outside the repo), and the 1.12 GiB `.tpz` is deleted after extraction.
  `.gitignore` additionally carries `*.tpz`, `export_templates/`,
  `world-lens-godot/build/`, `world-lens-godot/*.pck` and
  `world-lens-godot/*.x86_64` as belt-and-braces against a stray
  `--templates-dest` or an export written into the tree.
- `world-lens-godot/export_presets.cfg` — **tracked source, deliberately NOT
  ignored.** Export cannot run without it; it contains no secrets and no output
  path (`export_path=""` — the CLI supplies the destination).
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
