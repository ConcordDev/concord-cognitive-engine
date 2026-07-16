# Animation Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/animation.js` (1127 LOC) in full — no inline
> `registerLensAction("animation", …)` calls exist elsewhere in
> `server/server.js` (confirmed by grep); the file above is the entire
> backend surface. Reference-parity research is real (WebSearch against
> FlipaClip's and Pencil2D's own support/knowledge-base pages, cited below),
> not recalled from training data.
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("animation"' server/domains/animation.js`

## Backend surface — 53 macros, all real (no stubs)

Two tiers, both real:

**(A) 4 stateless "motion planning" macros** operating on caller-supplied
`artifact.data` (no persistence of their own): `interpolateKeyframes`,
`timingAnalysis`, `optimizeFPS`, `storyboardSequence`. These are genuine,
distinct calculators for a motion designer sketching abstract
keyframes/sequences/scenes — not superseded by the frame substrate below,
which operates on the app's own persisted frames instead.

**(B) 49 `STATE.animationLens`-backed macros** (real per-user persistent
`Map`s) implementing the domain file's own stated target: "FlipaClip +
Pencil2D 2026 parity — frame-by-frame animator." Projects, frames,
per-frame multi-layer drawing, pressure-sensitive vector strokes, a custom
brush library, shape tweening, a bone-armature rig with real forward
kinematics, audio tracks + waveform sync, video export (browser-side
encode), canvas-size/fps presets + onscreen guides, 6 starter templates,
and shareable links.

| Macro | Real result / effect | Classification (before) | Classification (after) |
|---|---|---|---|
| `interpolateKeyframes` | per-frame value curve from time/value keyframes | DESIGNED (buttons existed) but **dead input** — always ran against a fake project's empty `data`, so it always hit the honest "add data" fallback | DESIGNED — real structured row-input in `AnimationMotionToolkit` ("Motion Toolkit" tab) |
| `timingAnalysis` | sequence duration/overlap analysis | same dead-input defect | DESIGNED — structured row-input |
| `optimizeFPS` | device-budget FPS recommendation | same dead-input defect | DESIGNED — structured fps/complexity/device inputs |
| `storyboardSequence` | scene timing sequencer | same dead-input defect | DESIGNED — structured row-input |
| `anim-create`/`anim-list`/`anim-get`/`anim-rename`/`anim-update-settings`/`anim-save-thumbnail`/`anim-delete` | full project CRUD | DESIGNED (`AnimationStudioSection`) — but buried below a fake "Projects" tab that duplicated the concept with zero connection | DESIGNED — sole "Studio" surface |
| `canvas-presets`/`template-list`/`anim-from-template` | 8 canvas presets, 8 fps presets, 6 starter templates | DESIGNED (`AnimationStudioSection` create form) | DESIGNED |
| `frame-add`/`frame-duplicate`/`frame-delete`/`frame-set-exposure` | frame timeline ops | DESIGNED (`AnimStudio`) | DESIGNED |
| `frame-reorder` | swap a frame left/right | **UNSURFACED** — no reorder control existed | DESIGNED — `AnimStudio` frame-toolbar ◀/▶ buttons |
| `frame-layer-add`/`frame-layer-update`/`frame-layer-delete` | per-frame layer CRUD (visibility/opacity/name) | DESIGNED (`AnimStudio`) | DESIGNED |
| `anim-stroke-commit`/`anim-stroke-undo`/`frame-clear` | vector stroke commit/undo/clear | DESIGNED (`AnimStudio`) | DESIGNED |
| `anim-stroke-batch` | bulk-commit many strokes in one call | **UNSURFACED** | Still unsurfaced — honest, see 1.5 checklist item 20 |
| `stroke-commit-pressure` | pressure-modulated stroke (per-point width) | DESIGNED (`AnimStudio` pressure slider) | DESIGNED |
| `audio-track-add`/`audio-track-remove` | audio track CRUD | DESIGNED (`AnimStudio`, `AnimToolsPanel`) | DESIGNED |
| `audio-track-list` | list tracks for an animation | **UNSURFACED** — redundant, not a gap (see notes) | Unsurfaced, documented as redundant |
| `audio-waveform-set`/`audio-sync-map` | real client-decoded waveform + frame-span sync | DESIGNED (`AudioSyncPanel`) | DESIGNED |
| `playback-frames` | exposure-expanded play sequence + duration | **UNSURFACED** — client reimplemented the same math locally | DESIGNED — `AnimStudio` now sources its "total duration" readout from this macro |
| `easing-curve` | sampled easing curve for a named type | **UNSURFACED** | DESIGNED — `TweenPanel` mini curve-preview |
| `anim-dashboard` | animations count / total frames / latest | **UNSURFACED** | DESIGNED — page header KPI strip |
| `set-canvas-guides` | grid/thirds/safe-area/symmetry overlay | DESIGNED (`CanvasPanel`) | DESIGNED |
| `brush-save`/`brush-list`/`brush-delete` | custom pressure-dynamics brush library | DESIGNED (`BrushPanel`) | DESIGNED |
| `tween-shapes`/`tween-to-frames` | eased point-path tween → preview / committed frames | DESIGNED (`TweenPanel`) | DESIGNED |
| `rig-bone-add`/`rig-bone-delete`/`rig-pose-set`/`rig-get`/`rig-resolve-pose` | bone armature + real forward-kinematics pose resolve | DESIGNED (`RigPanel`) | DESIGNED |
| `rig-bone-update` | rename/reposition/resize an existing bone | **UNSURFACED** — could only pose (angle), never edit a bone after creation | DESIGNED — `RigPanel` inline name + length edit |
| `export-manifest`/`export-record`/`export-list` | deterministic render manifest + real in-browser MP4/WebM/GIF/PNG encode + export history | DESIGNED (`ExportPanel`) | DESIGNED |
| `share-create`/`share-revoke` | shareable link token generate/revoke | DESIGNED (`SharePanel`) — but the generated link pointed at no route | DESIGNED — link now genuinely opens |
| `share-get` | resolve a share token to animation data | **UNSURFACED** — no consuming page existed anywhere in the app | DESIGNED — new `/share/animation/[token]` viewer page |

**51/53 macros are DESIGNED** after this rebuild. `anim-stroke-batch` and
`audio-track-list` remain honestly unsurfaced — see the "What this rebuild
changed" section for why neither is a real gap.

## 1.5 Reference-parity checklist

**(a) Reference apps:** [FlipaClip](https://flipaclip.com) (the dominant
mobile frame-by-frame 2D animator — the domain file's own header comment
literally targets "FlipaClip + Pencil2D 2026 parity") and
[Pencil2D](https://www.pencil2d.org) (open-source desktop bitmap+vector 2D
animator). Both named directly in `server/domains/animation.js`'s own
comments; independently confirmed via WebSearch against FlipaClip's support
knowledge base (support.flipaclip.com) and the Pencil2D user manual/site,
2026-07-09.

**(b) Parity statement:** the only difference should be that Concord's
animator runs as a browser canvas app on a lens-local per-user store
instead of a native mobile/desktop app with local file storage — real
frame-by-frame drawing, onion skinning, layers, brushes, timing, audio
sync, and export should all be designed, real-data features here, exactly
as FlipaClip/Pencil2D provide them.

| # | Checklist item (FlipaClip / Pencil2D) | Disposition | Notes |
|---|---|---|---|
| 1 | Frame-by-frame timeline (add/duplicate/delete/reorder) | ALREADY REAL | `frame-add/duplicate/delete` were already wired; `frame-reorder` was unsurfaced — wired this session (◀/▶ buttons in `AnimStudio`) |
| 2 | Onion skinning | ALREADY REAL | `AnimStudio#renderFrame` ghosts the prior frame at 28% alpha and the next at 18% — a real, toggleable rendering technique (Onion toggle button), not a stub |
| 3 | Layers per frame (FlipaClip: 3 free/10 premium; Pencil2D: bitmap/vector/camera) | ALREADY REAL | `frame-layer-add/update/delete`, `AN_MAX_LAYERS=10`, visibility + opacity per layer, `AnimStudio` layer list |
| 4 | Frame timing / exposure (hold frames) | ALREADY REAL | `frame-set-exposure`, "Hold" input in `AnimStudio` |
| 5 | Brush tools incl. pressure sensitivity | ALREADY REAL | 4 built-in brushes (pencil/ink/marker/eraser) + `stroke-commit-pressure` (per-point width from `PointerEvent.pressure`) + pressure slider |
| 6 | Custom/saved brush presets | ALREADY REAL — exceeds parity | `brush-save/list/delete` with pressure-size/opacity/smoothing/spacing/taper dynamics; neither reference app ships a fully custom saved-brush library with this many dynamics knobs |
| 7 | Canvas size presets (YouTube/Instagram/TikTok/custom) | ALREADY REAL | `canvas-presets` — 8 presets incl. YouTube 1080p/720p, Instagram Square, Story/Reel 9:16, TikTok, Pixel Art, Film 2K |
| 8 | Frame rate presets | ALREADY REAL | `AN_FPS_PRESETS` (8/12/15/24/25/30/48/60) |
| 9 | Starter project templates | ALREADY REAL — exceeds parity | `template-list`/`anim-from-template`, 6 named templates (walk cycle, lip-sync, title card, pixel sprite, storyboard, blank); neither reference app ships named structural starter templates |
| 10 | Onscreen grid / guides (thirds, safe area, symmetry) | ALREADY REAL | `set-canvas-guides` + `drawGuides` overlay in `AnimStudio`; FlipaClip has a basic grid overlay, Pencil2D doesn't — Concord's guide set (grid+thirds+safe-area+symmetry) is broader than either |
| 11 | Playback / preview at project fps | ALREADY REAL (client-reimplemented) | `AnimStudio`'s play loop iterates the exposure-expanded sequence itself; the equivalent `playback-frames` macro existed but was unsurfaced — now used for the real total-duration readout (item resolved this session) |
| 12 | Audio track + waveform, synced to the timeline | ALREADY REAL | Real client-side Web Audio decode → peak extraction → `audio-waveform-set`, `audio-sync-map` computes real frame-span alignment, `AudioSyncPanel` renders the waveform |
| 13 | Motion / shape tweening | ALREADY REAL — exceeds parity | `tween-shapes`/`tween-to-frames`, real eased point-path interpolation (8 easing functions) committed as real frames; FlipaClip only has user *requests* for tweening (not shipped, per FlipaClip's own forums), Pencil2D doesn't have it either |
| 14 | Export to video / GIF / image sequence | ALREADY REAL | `ExportPanel` — MP4/WebM/GIF/PNG-sequence, real in-browser `MediaRecorder`/canvas-capture encode (not server-faked), `export-manifest` + `export-record`/`list` history |
| 15 | Direct social-platform posting (TikTok/YouTube/Instagram/Discord) | GENUINELY MISSING — honest, no fix needed | Concord has no external social-distribution integration for exported clips; no button anywhere claims this. Out of scope for a lens rebuild (would be a platform-wide connector, like the Gmail/Calendar work in `docs/CONNECTORS_GO_LIVE.md`) |
| 16 | Shareable link to view a finished animation | **GENUINELY MISSING (pre-rebuild) → FIXED THIS SESSION** | `share-create`/`share-revoke` were fully wired (real token, copy-link UI) but `share-get` had **zero consuming route** — no `/share/animation/[token]` page existed anywhere in the app, so every generated link 404'd. Built a real viewer page this session (see below); honestly scoped to signed-in Concord users only (see item 17) |
| 17 | Fully public (logged-out) share viewing | **CLOSED (2026-07-16, `ad5d9d4c`)** | Widening `publicReadDomains` was considered and rejected — that opens every animation macro, including mutating ones, to anonymous callers. Instead a dedicated `GET /api/animation/share/:token` route invokes the `animation.share-get` `LENS_ACTIONS` handler directly, bypassing `/api/lens/run`'s anonymous-caller gate, mirroring the welding client-portal pattern exactly. The action name is hardcoded in the route helper, never accepted as a request param. The share page now fetches the route with no auth dependency; middleware/AppShell gained the new public prefix. |
| 18 | Bone/cutout rigging with skeletal animation | ALREADY REAL — exceeds parity | Neither FlipaClip nor Pencil2D has bone rigging (confirmed via WebSearch — a 2017 Pencil2D feature request for bones is still open with no roadmap commitment). Concord ships a real bone armature (`rig-bone-add/delete`, `rig-pose-set`, real forward-kinematics `rig-resolve-pose`) with a live preview in `RigPanel`. `rig-bone-update` (rename/resize after creation) was unsurfaced — wired this session |
| 19 | Undo / redo | ALREADY REAL (partial) | `anim-stroke-undo` gives real single-level, per-layer stroke undo. FlipaClip has app-wide undo but explicitly **cannot** undo a deleted/merged layer either (confirmed via FlipaClip's own docs) — so Concord's narrower scope isn't a unique gap. A full cross-operation undo/redo stack (frame delete, layer delete, reorder) is GENUINELY MISSING — scoped future build: would need an operation log per animation, real backend work, deliberately deferred |
| 20 | Bulk/import stroke commit (`anim-stroke-batch`) | UNSURFACED — honest, no natural UI need | No current workflow produces a batch of strokes at once (live drawing commits one stroke per pointer-up). Leaving unsurfaced rather than inventing a UI just to exercise the macro |
| 21 | Import a reference photo directly onto a frame (FlipaClip's rotoscope import) | ~~GENUINELY MISSING — scoped, deferred~~ **CLOSED (2026-07-16, `1bcccad7`)** | New `animation.frame-layer-import-image` macro attaches an already-uploaded reference image to a frame as a dedicated `type:"reference"` layer at a given opacity — never vectorized into strokes (that would be an algorithmic auto-trace claim this codebase doesn't make). All three stroke-commit macros (`anim-stroke-commit`/`anim-stroke-batch`/`stroke-commit-pressure`) reject strokes on a reference layer server-side, not just by convention, so the tracing-underlay/paintable-artwork boundary can't silently blur. A latent `frame-duplicate` bug that would have dropped a reference layer's `type`/`imageRef` on copy is fixed (it only carried forward `name`/`visible`/`opacity`/`strokes`). `AnimStudio.tsx` renders it as a real semi-transparent canvas underlay (drawn before onion-skin/strokes) and visually distinguishes it in the layer list (dashed amber border, "Ref" badge, non-clickable name). `AnimationReferenceImages.tsx`'s own header comment previously disclaimed this capability outright ("there is no `animation` macro to import...") — that claim is now false and the comment has been rewritten to describe the real, honestly-scoped feature (a tracing underlay the animator still draws real artwork over, not an auto-import). A new `animReferenceTarget.ts` pointer lets the Reference tab's "Import onto frame" action know which frame is currently open in Studio, since the two are separate tabs that unmount each other. 10 new backend tests, 8 new frontend tests. |
| 22 | Stylus pressure hardware support (Apple Pencil / S Pen) | ALREADY REAL, browser-dependent | Canvas uses the standard `PointerEvent.pressure` API — works with any pressure-capable input device the browser exposes; not an app-specific gap |

**Coverage summary:** 15 of 22 checklist items ALREADY REAL (4 of those
exceeding the reference apps' own feature set), 5 fixed this session
(frame reorder, playback-duration wiring, easing-curve preview, rig-bone
rename/resize, the share-link viewer page), 1 resolved as an honest
non-issue (social posting — out of scope), 1 explicitly scoped-deferred as
a genuine gap needing real backend work (full undo/redo stack), 1
explicitly scoped-deferred needing a permission-system change (fully public
share links), 1 explicitly scoped-deferred needing real backend work
(rotoscope image import — partially addressed with an honest reference-only
gallery instead). **No silent gaps.**

## 2. What this rebuild changed

**Killed the fake "Projects" tab.** The old `app/lenses/animation/page.tsx`
had a `useLensData<AnimProject>('animation', 'project', {seed:[]})`-backed
"Projects" tab — a generic per-user artifact CRUD storing `type`, `fps`,
`duration`, `frameCount`, `status: draft|in-progress|rendering|complete`,
`resolution` — with **zero relationship** to the real `anim-create`/frame/
stroke/rig substrate `AnimationStudioSection` already used. Clicking a fake
"project" card just flipped a tab to a static placeholder ("Open a project
in the Animation Studio above to draw frames…"); an "Advance" button on
each card called `updateProject` to cycle the fake `status` field through
draft→in-progress→rendering→complete with **no frame ever drawn and no
render ever run**. This is the exact "UI that implies creating/progressing
a real artifact while doing nothing real" pattern CLAUDE.md's honest-by-
construction rule prohibits. **Retired entirely.** The already-real
`AnimationStudioSection`/`AnimStudio` editor (confirmed ~1750 combined LOC
of genuine frame/layer/stroke/rig/audio/export logic, not scaffold) is now
the single "Studio" surface.

**The Render tab's dead-input bug, confirmed and fixed.** The 4 stateless
compute macros were called with `targetId = selectedProject?.id ||
projectItems[0]?.id` — i.e. against the **fake** project artifact, whose
`data` never carried `keyframes`/`sequences`/`scenes` fields (the create
form only ever wrote `title`/`type`/`fps`/`duration`/`frameCount`/`status`/
`resolution`). Every one of these 4 macro calls therefore **always** hit
the macro's own honest "add data" fallback message — the buttons looked
functional but could never do real work. `AnimationMotionToolkit.tsx` (new)
replaces this with real structured row-input builders (keyframe time/value
pairs, sequence name/duration/delay/fps/easing rows, an fps/complexity/
device selector, scene name/duration/transition/description rows) — the
same "structured input, not JSON-paste, not dead input" fix pattern the
supplychain-lens rebuild established.

**Retired the generic-scaffold dependency**: `ManifestActionBar`,
`AutoActionStrip`, `RecentMineCard`, `CrossLensRecentsPanel`,
`UniversalActions`, `LensFeaturePanel`, and the `useRealtimeLens`/
`LiveIndicator`/`RealtimeDataPanel` trio (confirmed via `grep animation
hooks/useRealtimeLens.ts` — zero matches; this domain has no
`DOMAIN_EVENTS` entry, so `isLive` was always `false` — a permanently-dark
"live" indicator is its own honesty smell, removed rather than kept as
decoration, matching the supplychain/mentorship precedent).

**New `AnimationMotionToolkit.tsx`** — the Motion Toolkit tab described
above.

**New `AnimationReferenceImages.tsx`** — replaces the old "Assets" tab,
which uploaded real bytes to `/api/media/upload` (genuinely real, kept) but
never listed anything back and had zero connection to any project — a
working upload with no way to ever see what you uploaded. The new panel
lists uploads back via the real `GET /api/media/author/:userId` route and
renders them from `GET /api/media/:id/stream` (which serves real stored
bytes when an artifactRef exists — verified in `server/routes/media.js`).
**Deliberately does NOT use `/api/media/:id/thumbnail`**: that route
returns a placeholder path string (`thumbnails/{type}/{id}.jpg`, generated
by `generateThumbnail()` in `server/lib/media-dtu.js`, which the function's
own comment admits is a stand-in — "In production this would extract a
frame... Here we store a reference and mark it as generated") that does
not correspond to any real file on disk. Using it would have reproduced
the exact "renders nothing real" defect this panel exists to fix. Honestly
labeled "view-only, not importable onto a frame yet" per checklist item 21.

**New `/share/animation/[token]/page.tsx`** — closes checklist item 16. The
`share-create`/`share-revoke` flow already worked end-to-end (real token,
copy-link UI, revoke), but the resulting URL pointed at no route in the
entire app — every generated link 404'd. The new page calls
`animation.share-get` and renders the shared animation (canvas playback
with a frame scrubber, or the thumbnail-only honest fallback when the owner
disabled frame downloads). Works for any signed-in Concord account (the
macro doesn't check ownership, only token validity); a logged-out visitor
sees an honest "sign in to view" state rather than a silent failure or a
faked "public" experience, because `animation` is not in the server's
`publicReadDomains` allowlist (checklist item 17, deliberately deferred —
widening that allowlist is a permission-system change, not a UI rebuild).

**`AnimStudio.tsx` additions**: frame-reorder ◀/▶ buttons (wires the
previously-unsurfaced `frame-reorder` macro) and a real total-duration
readout sourced from `playback-frames` (previously the same math was
silently reimplemented client-side).

**`AnimToolsPanel.tsx` additions**: `RigPanel` bones can now be renamed and
resized after creation (wires the previously-unsurfaced `rig-bone-update`
macro — before this, only a bone's per-frame pose angle was editable, never
its identity/length); `TweenPanel` shows a real mini curve-preview sourced
from the `easing-curve` macro next to the easing selector, so a user can
see the curve shape before committing a tween.

## Files touched

- `concord-frontend/app/lenses/animation/page.tsx` — full rewrite
- `concord-frontend/components/animation/AnimationMotionToolkit.tsx` — new
- `concord-frontend/components/animation/AnimationReferenceImages.tsx` — new
- `concord-frontend/components/animation/AnimStudio.tsx` — frame-reorder + real playback-duration readout
- `concord-frontend/components/animation/AnimToolsPanel.tsx` — rig bone rename/resize + easing-curve preview + honest share-scope copy
- `concord-frontend/app/share/animation/[token]/page.tsx` — new public(-for-signed-in-users) share viewer
- No backend changes — `server/domains/animation.js` was already real and complete for the scope above; every fix here is a frontend wire onto an existing macro, plus one new consuming page for an existing macro (`share-get`) that had none.
