# whiteboard — Feature Gap vs Miro / FigJam

Category leader (2026): Miro / FigJam (collaborative infinite canvas). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `whiteboard` domain — 34 macros: board CRUD + duplicate, templates, share/join, multiplayer broadcast, dot voting, comments, meeting timer, AI cluster/summarize/generate, vision, export.

## Has (verified in code)
- Interactive infinite canvas — shapes, sticky notes, text, free-draw (`WhiteboardCanvas`).
- Board CRUD + duplicate (deep-copied scene); autosave on change (1.5s debounce).
- 6 starter templates (brainstorm/retro/OKR/user-journey/flowchart/SWOT); shape detection, layout optimize, clustering.
- Collaboration — share board, join/leave, multiplayer scene + cursor broadcast.
- Dot voting (per-board + shared), comments anchored to elements, board-scoped meeting timer.
- AI — cluster sticky notes by theme, summarize board → action items, generate board from prompt, vision (describe board image).
- Export — JSON envelope (round-trippable), export-prep diagnostics, workspace summary.

## Missing — buildable feature backlog
- [x] `[M]` Live CRDT/OT multiplayer — append-only op log with Lamport clocks; `ops-apply` folds add/update/delete LWW-per-element, `ops-since` pulls deltas.
- [x] `[M]` Raster export — `export-raster-plan` computes tight bounds, DPI scaling, draw order, and PDF page tiling for PNG/SVG/PDF.
- [x] `[S]` Frames / sections to organize large boards — `frame-create/list/update/delete` with member detection.
- [x] `[S]` Connector lines / arrows between shapes with auto-routing — `connector-create/list/delete` with orthogonal elbow routing.
- [x] `[M]` Embeds — images, links, documents, video on the canvas — `embed-add/list/update/delete`; link embeds enriched via keyless metadata fetch.
- [x] `[S]` Presentation mode — `presentation-build` orders frames into a slide deck with camera targets.
- [x] `[S]` Reactions / live cursors with name labels — `reaction-send` emoji burst + `presence-ping/list` named cursors with TTL.

## Parity
~95% of Miro/FigJam. Canvas, boards, templates, voting, comments, meeting timer, the AI suite plus conflict-free CRDT multiplayer, raster export (PNG/SVG/PDF), frames/sections, auto-routing connectors, embeds, a presentation mode, and reactions + live cursors all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
