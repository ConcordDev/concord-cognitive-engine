# Studio lens — capability map (Wave 3 audit, 2026-07-11)

## What this lens actually is

An Ableton Live/Logic Pro-shape DAW: transport, mixer, piano roll, drum
machine, synth panel, effects rack, automation, mastering, audio recording/
editing, and a real-time collaboration surface — `concord-frontend/app/
lenses/studio/page.tsx` (3,150+ LOC) mounting ~25 bespoke components under
`concord-frontend/components/studio/`, backed by two genuinely separate
real backends:

1. **The local-first `DAWProject`** (page.tsx state, persisted through the
   generic `lens.*` artifact CRUD via `createLensItem`/`updateLensItem`,
   provenance-stamped through `lib/daw/dtu-hooks.ts`'s `emitSessionDTU`/
   `emitTrackCreated`/etc). This is what `ArrangementView`, `PianoRoll`,
   `MixerView`, `DrumMachine`, `SynthPanel`, `EffectsPanel`, `AutomationView`,
   `MasteringPanel`, `Soundboard`, `SessionWorkspace` all read/write.
2. **`server/domains/studio.js`'s own per-user parity backend** (75
   `registerLensAction("studio", …)` macros over an in-memory `s.projects`
   Map keyed by `studioActor(ctx)` — real project/track/clip/MIDI/
   automation/marker/tempo/preset/send/scene/drum-rack/FX-rack/MIDI-map/
   groove/recording-take/collab CRUD). This is what `StudioActionPanel` and
   the 16 "Session workbench" parity panels (`ClipsTimelinePanel`,
   `ClipEditorPanel`, `MidiPianoRoll`, `QuantizePanel`, `AutomationLanesPanel`,
   `DrumRackPanel`, `FxRackPanel`, `MidiMapPanel`, `RecordingPanel`,
   `BouncePanel`, `ProjectIOPanel`, `MarkersPanel`, `TempoMap`,
   `PresetsLibraryPanel`, `SendsRouting`, `ScenesLauncher`, `CollabPanel`)
   read/write.

These two models are **intentionally distinct data** (a rich client-side
session model vs. a full CRUD parity backend for spec coverage) — not a
fabricated duplicate. Both are real. The findings below are about wiring
defects and dead capability within and across them, not about either model
being fake.

## Findings and fixes

### 1. Dead `mix`/`master`/`bounce`/`render` macros in `server.js` — REMOVED

Confirmed exactly as the prior (interrupted) audit pass suspected, then
verified fresh:

- `server/server.js` (pre-fix, lines 40102–40212) inline-registered
  `registerLensAction("studio", "mix"|"master"|"bounce"|"render", …)`
  against the generic `artifact.data` shape.
- `server/domains/studio.js:574` registers its own real `bounce` (async,
  honest pending/completed/failed status via `renders-list`, operates on
  `s.projects`). `LENS_ACTIONS` is a plain `Map` and `domainModules.forEach`
  (server.js:41742, which loads `domains/studio.js`) runs **after** the
  inline block at 40102 — so the real `bounce` always won the last-write.
  server.js's `bounce` stub was **provably unreachable dead code**.
- `mix`/`master`/`render` had **no** `domains/studio.js` counterpart, so
  they *were* reachable via `POST /api/lens/run`. A full grep of
  `concord-frontend` for `action: 'mix'|'master'|'render'` against the
  `studio` domain (both the `{domain,action}` object call form and the
  positional `lensRun('studio', …)` form) found **zero** callers —
  `StudioActionPanel`'s "Render" button calls `renderEstimate`, not
  `render`. Genuinely unsurfaced, dead-on-arrival backend capability.
- `master` additionally had a latent bug that would have fired the moment
  anyone did wire it: it read `mix.avgVolume`, but `mix`'s own return value
  never set an `avgVolume` field (it computed `combinedRms`) — the read was
  always `undefined`, so `master` always defaulted to `avgVolume = 0.7`
  regardless of actual mix state.

**Disposition: removed, not wired to a UI.** Real, better equivalents
already exist for both capabilities the dead macros gestured at: live
master-bus analysis is `MasteringPanel`'s Web-Audio `AnalyserNode` capture
(`page.tsx#handleAnalyze`, RMS/peak/8-band spectral sampled from the actual
signal over a real ~3s window, explicitly honest about what it can't
measure — see the code comment on stereo correlation), and mixdown/bounce
is the real `studio.bounce` + `studio.export-stems` pair. Building a *third*
mix/master path bound to the stale `artifact.data.tracks` shape neither
real project model populates would have been redundant scaffold, not a
"natural home" — the CLAUDE.md guidance to prefer wiring dead-but-real
capability into a UI doesn't apply when the capability is already
superseded by something more real. `server.js:40102-40212` now carries a
comment explaining the removal and pointing at the two real replacements.
Verified nothing else depends on the three names (`grep` across
`server/tests/`, `server/`, and `concord-frontend/` for
`runMacro("studio","mix"|"master"|"render"` and for `studio.mix`/
`studio.master`/`studio.render` string literals — no hits beyond the
removed registrations themselves).

### 2. `AudioEditor` was permanently dead UI — WIRED to real PCM editing

Confirmed exactly as suspected, then fixed with real DSP (not a stub):

- `page.tsx` declared `const [audioEditorBuffer, _setAudioEditorBuffer] =
  useState<DAWAudioBuffer | null>(null)` — the underscore-prefixed setter
  was never called anywhere in the file. `<AudioEditor audioBuffer=
  {audioEditorBuffer} … />` therefore always rendered its `!audioBuffer`
  empty state, permanently hiding the entire waveform-editing toolbar
  (cut/copy/paste/delete/fade in/fade out/normalize/reverse/Save-as-DTU).
- Worse: even the empty state's own "Start Recording" button (which calls
  `onStartRecording={handleRecord}`, a real working mic-capture path) fed
  `recordedBlob`/`recordedUrl` — completely separate state never connected
  to `audioEditorBuffer`. So recording audio could never populate the
  editor either way.
- Worse still: `<AudioEditor onOperation={() => {}} …/>` — even if the
  buffer had been populated, every toolbar button was wired to a no-op.
  Clicking Cut/Fade/Normalize/Reverse would have silently done nothing.

**Fix — real, not fabricated.** New `concord-frontend/lib/daw/
audio-buffer-edit.ts`:
- `decodeBlobToDAWBuffer(blob, name, ctx?)` — decodes the actual recorded
  Blob via `AudioContext.decodeAudioData`, extracting real
  `duration`/`sampleRate`/`channels` and copying the real per-channel
  `Float32Array` PCM (`AudioBuffer.channelData`, a new optional field added
  to `lib/daw/types.ts`'s `AudioBuffer` interface).
- `computeWaveformPeaks(channelData, buckets)` — real per-bucket max-abs-
  sample downsampling for the waveform display (not synthesized noise; the
  component's own fallback-to-`Math.random()` peaks path in
  `AudioEditor.tsx:39` is now unreachable in practice once a buffer exists,
  since `waveformPeaks` is always populated from real samples).
- `applyAudioEditOperation(buffer, op, selection, clipboard, playheadPos)`
  — genuine sample manipulation: `cut`/`delete` slice the selected sample
  range out of every channel and shrink `duration`; `copy` snapshots the
  selection into a clipboard; `paste` splices the clipboard in at the
  playhead; `fadeIn`/`fadeOut` apply a real linear gain ramp over the
  selection (or whole buffer); `normalize` scales true peak to -0.1 dBFS;
  `reverse` reverses the sample order over the selection (or whole
  buffer). Every no-selection/empty-clipboard/silent-buffer case returns
  the *same* buffer reference plus an honest `summary` string explaining
  why nothing happened — never a fabricated success.
- `encodeDAWBufferToWavBlob(buffer)` — 16-bit PCM WAV encoding of the real
  edited channel data (same encoding shape as
  `PublishAsAdaptiveMusicDialog.tsx`'s pre-existing `encodeWavDataUrl`,
  adapted to work off `channelData` directly).

Wired into `page.tsx`:
- The recorder's completion callback (`handleRecord`, ~line 866) now
  decodes the just-recorded Blob and calls the (renamed)
  `setAudioEditorBuffer` — a real recording now populates a real waveform.
- New `handleAudioEditOperation` (page.tsx:1004) applies the edit, and —
  so the transport's existing "Play" button always plays what the editor
  currently shows rather than diverging from it — re-encodes the result to
  a WAV Blob and swaps it into `recordedBlob`/`recordedUrl`.
- `<AudioEditor onOperation={handleAudioEditOperation} …/>` (page.tsx:2198)
  replaces the no-op.

Also fixed a small pre-existing honesty smell in the same component while
touching it: `AudioEditor.tsx:39` fell back to `Array.from({length:200},
() => Math.random() * 0.5)` — fabricated waveform noise — whenever
`waveformPeaks` was empty. Since `decodeBlobToDAWBuffer` now always
populates real peaks whenever a buffer has any samples, this path is dead
in practice; replaced the fallback with a flat zero-line (`new
Array(200).fill(0)`) so the rare edge case (an `audioBuffer` passed in with
empty `waveformPeaks`) reads as "no signal" rather than fabricated audio
activity.

New test: `concord-frontend/tests/lib/daw-audio-buffer-edit.test.ts` (18
cases) pins the peak-bucketing math, every edit operation's exact sample
output (cut/delete/copy/paste/fade/normalize/reverse verified against
hand-computed expected arrays, not pasted output), the honest-no-op paths,
and a WAV byte-level round-trip. `decodeBlobToDAWBuffer` itself (the one
function that needs a real `AudioContext.decodeAudioData`) is left
integration-only — it's a thin, injectable-`ctx` wrapper around a browser
API with no meaningful logic of its own to unit-test headlessly.

### 3. `DawWorkbenchSection`'s raw-ID-paste inputs — replaced with real pickers

A third finding beyond the two flagged leads, found while tracing why
three real macros (`clips-update`, `collab-edit`, `effect-remove`) were
never called from anywhere in the frontend (see §4 below).

`page.tsx`'s `DawWorkbenchSection` (mounted unconditionally near the top of
the page, `<ShellPreview/><DawWorkbenchSection/>`) is the real, reachable
surface for the 16 "Session workbench" parity panels — and it required the
user to **paste raw project/track/clip IDs into plain text inputs**
(`placeholder="Project ID (paste from project list)"`) to use any of them.
This is the same defect class CLAUDE.md's zero-generic-tendencies
invariant calls out for "a raw JSON-paste textarea standing in for a real
form" — not literally JSON, but the same failure: a real backend reachable
only by a user manually copying an opaque id from one screen and pasting it
into another, instead of a designed picker.

**Fix.** `DawWorkbenchSection` now fetches real data and renders cascading
`<select>` dropdowns: `studio.project-list` populates the Project picker;
selecting a project calls `studio.project-get({id})` to populate the Track
picker from that project's real tracks; selecting a track calls
`studio.clips-list({projectId, trackId})` to populate the Clip picker. A
manual refresh button (⟳) re-pulls `project-list` (the component isn't
wrapped in the same `PipingProvider` as `StudioActionPanel`, so it can't
subscribe to that panel's project-create events without a larger
provider-tree change — deferred, see below). Empty-state copy points the
user at where to create a project instead of silently showing three blank
inputs.

### 4. Three genuinely orphaned macros — wired

Cross-checked all 75 `domains/studio.js` macros against every frontend
call site (`components/studio/`, `app/lenses/studio/`, and — because a few
are legitimately called from elsewhere — the whole frontend tree for
`dashboard-summary`/`list-adaptive-music`, which turned out to already be
wired via `ShellPreview.tsx` and `AdaptiveMusicBridge.tsx` respectively,
so those two were false leads). Three were real orphans:

- **`effect-remove`** (`domains/studio.js:365`) — `StudioActionPanel`'s
  "+ Effect" button called `effect-add` but had no way to view or remove a
  track's existing effects. Fixed by §5 below (which also fixed a
  parameter-shape bug in the add path).
- **`clips-update`** (`domains/studio.js:437`, supports `name`/
  `startBeats`/`lengthBeats`/`muted`/`colour`/`warpEnabled`) —
  `ClipsTimelinePanel` only ever created clips with `muted: false` and had
  no way to toggle it. Wired a mute/unmute button (optimistic UI, rolls
  back on failure) that calls `clips-update({id, muted})`.
- **`collab-edit`** (`domains/studio.js:1549`) — `CollabPanel` already
  polled `collab-since` and rendered an "Edit log" feed, but nothing ever
  called `collab-edit` to write into it, so the log was permanently empty
  even during a live session. New `lib/daw/collab-log.ts#
  logStudioCollabEdit(projectId, op, target, detail)` — a fire-and-forget
  helper (silently no-ops when there's no active collab session for the
  project, which is the common case) — now gets called from `track-add`/
  `effect-add`/`effect-remove` in `StudioActionPanel` and `clips-create`/
  `clips-delete`/`clips-update` in `ClipsTimelinePanel`. This is a
  **partial, honest wire**, not a claim of full coverage: the other ~13
  parity panels (`MarkersPanel`, `TempoMap`, `DrumRackPanel`, etc.) still
  don't log to the collab feed. Left as a natural follow-up — the pattern
  is now established and one-line-per-mutation to extend.

### 5. Real correctness bugs found and fixed in `StudioActionPanel`

Found while wiring `effect-remove` (needed a working `effect-add` +
track-selection story first) — two parameter-shape mismatches that made
existing, already-"wired" buttons **silently non-functional**, the same
defect class as the travel/mentorship findings cited in CLAUDE.md's
zero-demo-content section (a real macro reached with the wrong field
names, so every click failed or was silently ignored):

- **`track-add` ignored the Track Type dropdown.** The macro requires
  `params.kind` from the allowlist `["audio","midi","drum","synth",
  "sample"]`; the frontend sent `params.type` (not read by the macro at
  all) with dropdown options `['audio','midi','instrument','return']` —
  two of which (`instrument`/`return`) aren't even valid `kind` values.
  Every track silently defaulted to `kind: "audio"` regardless of what the
  user picked — `ok: true`, wrong data, no visible error. Fixed: dropdown
  options now match the real backend enum exactly (`TRACK_KINDS` const
  kept in sync with `domains/studio.js`'s allowlist by comment), and the
  param key is now `kind`.
  - Verified analogous bug did **not** exist in the "Session workbench"
    `ClipsTimelinePanel`'s own kind dropdown (`midi`/`audio`/`drum`,
    correctly matches `clips-create`'s allowlist) — this was specific to
    `StudioActionPanel`.
- **`effect-add` always failed.** The macro requires `params.trackId`
  (looked up as `project.tracks.find(t => t.id === trackId)`) and
  `params.kind` from `["delay","reverb","eq3","compressor","distortion"]`.
  The frontend sent neither — no `trackId` at all, and `params.effectName`
  (an arbitrary free-text string, not read by the macro). Empirically,
  every click returned `{ok:false, error:"track not found"}` (verified by
  re-reading the macro's lookup against an empty-string `trackId` — no
  track can ever have id `""`). This button had **never worked**.

  Fixed with a real track-selection story, not just a param-name patch:
  `StudioActionPanel` now fetches the current project's real tracks (via
  `project-get`) whenever a project is created or selected, exposes a
  Track picker, replaces the free-text "Effect name" input with a `<select>`
  of the 5 real allowed kinds, and passes `{projectId, trackId, kind}`.
  The track/effect block also renders the selected track's real current
  effects chain as removable chips (wires `effect-remove`, §4).

Both bugs are the *inverse* of the fabricated-success pattern this wave has
mostly been finding elsewhere: not "returns `ok:true` while doing nothing,"
but "returns `ok:false`/wrong-data while the UI shows a generic success
toast anyway" — same root cause (frontend param shape drifted from the
backend contract with no test catching it), same fix discipline (make the
UI's enum options and param keys the source-of-truth-matching mirror of
the macro, not an independent guess).

## Real-time collaboration honestly doesn't grant real write access — documented, not silently left to look complete

Empirically verified (not inferred from reading alone — per CLAUDE.md's
compute-don't-guess methodology, driven through the real macro system via
the `server/tests/depth/_harness.js` `lensRun` harness against a live
in-memory server boot):

```
host creates project P (owned by host_user)
host starts a collab session on P
guest calls collab-join(P) -> ok:true, guest appears in session.collaborators
guest calls track-add({ projectId: P, ... }) -> {"ok":true,"result":{"ok":false,"error":"project not found"}}
host's project P still has 0 tracks after the guest's "add"
guest's own project list is still empty (no phantom project was created either)
```

Every mutating `studio.*` macro (`track-add`, `effect-add`, `clips-create`,
`markers-add`, …) scopes its lookup to `s.projects.get(studioActor(ctx))`
— the **caller's own** project map — not the collab session's host
project. `collab-join` only requires knowing the project id (no ownership
check, by design — a share-link-style model like Figma/Google Docs "anyone
with the link"), but joining grants presence + the edit-log feed only.
There is no code path by which a joined collaborator's UI actions actually
mutate the host's shared project data. `CollabPanel`'s "Real-time
collaboration" label is accurate for presence/cursor/log, not for shared
editing — the label doesn't currently say so explicitly.

~~**Disposition: ENGINEERING, deferred, not fixed this pass.** Making
`track-add`/`effect-add`/clip/marker/etc. macros collaborator-aware (check
"does an active collab session for this `projectId` include me, and if so
operate on the *host's* project map instead of my own") is a real,
bounded backend change with no external data dependency — but it touches
every one of the ~20 mutating parity macros, which is a larger unit than
this pass's budget. Recorded here as a named gap per the "closing the hard
20%" invariant rather than left implicit.~~

**CLOSED (2026-07-12, `508399c7`).** Built the collaborator-aware
resolver family in `server/domains/studio.js` (`resolveStudioProject`,
`resolveOwnerBucketItem`, `resolveTrackOwner`, `resolveClipOwner`,
`resolveNoteOwner`, `resolveLaneOwner`, plus two leniency-preserving
`…OrSelf` fallbacks) and applied it to every mutating macro and the
paired list/get reads that reference a project/track/clip/lane by id:
`project-get`/`project-delete`, `track-add`/`-update`/`-delete`,
`effect-add`/`-remove`, `clips-list`/`-create`/`-update`/`-delete`,
`midi-notes-list`/`-add`/`-delete`, `automation-list`/`-add-lane`/
`-add-point`/`-delete-lane`, `bounce`, `markers-list`/`-add`/`-delete`,
`tempo-changes`/`-add`, `sends-list`/`-set`/`-delete`, `scenes-list`/
`-create`/`-launch`, `clip-warp-set`/`-slice`/`-fade-set`, `drumrack-list`/
`-create`/`-pad-assign`/`-delete`, `midi-map-list`/`-add`/`-delete`,
`midi-quantize`/`groove-apply`, `record-config-get`/`-set`,
`takes-list`/`-add`/`-comp-select`/`-delete`, `export-stems`, and
`project-export`. A caller who holds an active `collab-join` seat for a
projectId now reads/writes the **host's** real bucket (verified via the
host's own `project-get`/`clips-list` — no separate "guest echo" copy);
a caller who never joined (nor owns the project) still gets the same
"not found" a stranger always got, in both directions — mutation AND
lookup. `presets-*`/`fx-rack-*` were correctly left untouched (no
`projectId` on those items — personal libraries, per the same rationale
`03ff59a5` used for the collab-edit logging closure below).
New regression tests: `server/tests/depth/studio-behavior.test.js`
("studio EXTEND — collaborator-aware write access") reproduces the exact
repro trace above end-to-end against a live server boot and proves the
inverse (guest's `track-add`/`clips-create`/`markers-add` land on the
host's project, the guest's own `project-list` stays empty, a stranger's
attempt fails cleanly before AND after a legitimate guest has joined, and
write access is revoked on `collab-leave`); `server/tests/
studio-domain-parity.test.js` ("studio collab-join write-scoping") pins
the same contract against the lighter in-process harness.

## Cross-check of the remaining ~21 mounted components

Walked every panel's macro calls against `domains/studio.js`'s real 75
macros (see §3/§4 for the ones that needed fixing). No fabricated data,
`Math.random()`-in-render, or hardcoded-array-as-live-data patterns found
in any of: `MidiPianoRoll`, `AutomationLanesPanel`, `MarkersPanel`,
`TempoMap`, `PresetsLibraryPanel`, `SendsRouting`, `ScenesLauncher`,
`ClipEditorPanel`, `DrumRackPanel`, `FxRackPanel`, `MidiMapPanel`,
`QuantizePanel`, `RecordingPanel`, `ProjectIOPanel`, `CollabPanel`,
`SessionWorkspace`, `TransportBar`, `ArrangementView`, `PianoRoll`,
`DrumMachine`, `SynthPanel`, `EffectsPanel`, `AutomationView`, `Soundboard`,
`StudioWorkbench`. All of them call real macros with correctly-shaped
params and render only server-returned fields. `MasteringPanel` in
particular is a strong honesty example already (see the code's own
comments on why stereo correlation is left `undefined` rather than
approximated) — matches the bar `BouncePanel` sets.

## Admin-gating check

No admin/role gate anywhere in the studio frontend (`grep` for
`AdminRequired`/`requireRole`/`role ===`/`isAdmin`/`adminOnly` across
`app/lenses/studio/` and `components/studio/` — zero hits). Correct: this
is a per-user creative tool, not an operator surface. Backend macros scope
correctly by `studioActor(ctx) = ctx?.actor?.userId || ctx?.userId ||
"anon"` — every project/track/clip read and write is owner-scoped (the one
caveat, collab-join's share-by-id join model, is documented above and is a
design choice, not a role-based authz gap of the kind this wave has been
hunting elsewhere).

## Verification (all run directly, 2026-07-11)

- `node --check server/server.js` — clean.
- `npx eslint server.js` (from `server/`) — clean, 0 errors/warnings.
- `npx eslint lib/daw/types.ts lib/daw/audio-buffer-edit.ts lib/daw/collab-log.ts app/lenses/studio/page.tsx components/studio/StudioActionPanel.tsx components/studio/ClipsTimelinePanel.tsx components/studio/AudioEditor.tsx tests/lib/daw-audio-buffer-edit.test.ts` (from `concord-frontend/`) — clean, 0 errors/warnings.
- `npx tsc --noEmit -p .` (from `concord-frontend/`) — zero errors attributable to any touched file (grepped the full project-wide run for the six touched paths; no matches).
- `node --test tests/studio-domain-parity.test.js tests/studio-bounce-honest.test.js tests/studio-publish-as-adaptive-music.test.js tests/depth/studio-behavior.test.js` (server/) — **72/72 passing**, confirming the `mix`/`master`/`bounce`/`render` removal didn't regress anything (no test referenced those three action names against the `studio` domain).
- `node --test tests/lens-manifest.test.js tests/lens-features.test.js tests/render-registry.test.js` (server/) — **335/335 passing** (these enumerate a separate, unrelated `generate-pattern`/`suggest-chords`/`auto-arrange` LLM-hint registry — confirmed unaffected by the removed block, which lived ~2,000 lines away and used a different registration mechanism).
- `npx vitest run tests/lib/daw-audio-buffer-edit.test.ts` (concord-frontend/) — **18/18 passing** (new).
- `npx vitest run tests/studio-bounce-panel-states.test.tsx tests/components/PublishAsAdaptiveMusicDialog.test.tsx` (concord-frontend/) — **9/9 passing**, unaffected.
- Empirical collab-join write-scoping probe against a live in-memory server boot via `server/tests/depth/_harness.js` — see the reproduction transcript above.
- `node scripts/verify-lens-backends.mjs` (repo root) — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, **unchanged**.
- `node scripts/grade-ux-polish.mjs --honest` (repo root) — `studio` entry: `tier:"polished"`, `isGenericScaffold:false` (both unchanged from before this pass). `audit/` reverted after (`git checkout -- audit/`).

## Genuinely missing / deferred

Triaged per the "closing the hard 20%" invariant:

- ~~**ENGINEERING, medium — collaborator write access.** See the dedicated
  section above. No external data dependency; needs every mutating
  `studio.*` macro to check active-collab-session membership and, when
  present, operate on the host's project map. Scoped out of this pass as
  larger than the unit; the finding + reproduction is recorded so it isn't
  silently left to look complete.~~ **CLOSED (2026-07-12, `508399c7`)**
  — see the dedicated section above for the full fix (resolver family +
  every mutating macro + paired reads + regression tests).
- **ENGINEERING, small — `collab-edit` logging isn't on every mutation.**
  Wired for track-add/effect-add/effect-remove/clip create/delete/update
  (§4); the other ~13 parity panels' mutations (markers, tempo, sends,
  scenes, drum rack, FX rack, MIDI map, presets, quantize, recording
  takes, project import/export) don't yet call `logStudioCollabEdit`. The
  helper and the call pattern are now established — extending it is
  mechanical, one call per mutation handler.
- ~~**ENGINEERING, small — `DawWorkbenchSection`'s project list doesn't
  auto-refresh** when a project is created in the separate
  `StudioActionPanel` below it (the two aren't in the same `PipingProvider`
  tree).~~ **CLOSED (2026-07-16, `a69f4dc7`).** The single `PipingProvider`
  now wraps both components in one tree; `DawWorkbenchSection` subscribes
  via `usePipeValue('studio.project')` and re-fetches its list whenever
  `StudioActionPanel` publishes a newly created project. The manual refresh
  button stays as the honest fallback. A dedicated test mounts both real
  components under one provider and proves the picker updates with zero
  manual interaction (sanity-checked load-bearing by reverting the fix and
  confirming the test fails).
