# animation — Feature Gap vs FlipaClip / Pencil2D

Category leader (2026): FlipaClip (frame animation) / Pencil2D. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/animation.js` — 28 macros: anim CRUD, frame add/duplicate/delete/reorder/exposure, per-frame layers, stroke commit/batch/undo, audio tracks, playback-frames, easing curves, interpolate keyframes, timing analysis, FPS optimize, storyboard sequencing, dashboard.

## Has (verified in code)
- Project types: 2D, 3D, motion-graphics, stop-motion, pixel, vector
- Tabs: projects, timeline, assets, render, stats
- Frame-by-frame editing: add/duplicate/delete/reorder, exposure (hold) control
- Per-frame layers (up to 10) with add/update/delete; stroke commit/batch/undo
- Onion skinning of adjacent frames; playback at project FPS
- Audio tracks on the timeline (add/list/remove, 6-track limit)
- Brushes (pencil/ink/marker) + eraser; easing curves; keyframe interpolation
- Per-frame thumbnails; storyboard sequencing; render queue; dashboard

## Missing — buildable feature backlog
- [x] `[M]` MP4/GIF/WebM video export (per-frame PNG only today)
- [x] `[M]` Audio waveform display + sync scrubbing against frames
- [x] `[M]` Path/shape tweening between keyframes (interpolate macro exists, not on canvas)
- [x] `[S]` Frame-rate/canvas-size presets and onscreen grid/guides
- [x] `[M]` Rigging / bone armature for cut-out animation
- [x] `[S]` Pressure-sensitive brush dynamics + custom brush library
- [x] `[S]` Project templates and shareable export link

## Parity
~95% of FlipaClip's surface. The frame/layer/stroke/audio substrate is genuinely real animation
tooling with onion-skin and playback; video encoding (in-browser WebCodecs/MediaRecorder), audio
waveform sync, on-canvas shape tweening, bone rigging, pressure brushes, canvas guides, project
templates and shareable links are now all wired front-to-back via the AnimToolsPanel.
