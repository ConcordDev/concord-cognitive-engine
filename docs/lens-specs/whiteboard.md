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
- [ ] `[M]` Live CRDT/OT multiplayer — currently snapshot broadcast; concurrent edits can clobber.
- [ ] `[M]` Raster export — PNG/SVG/PDF of a board (only JSON envelope today).
- [ ] `[S]` Frames / sections to organize large boards.
- [ ] `[S]` Connector lines / arrows between shapes with auto-routing.
- [ ] `[M]` Embeds — images, links, documents, video on the canvas.
- [ ] `[S]` Presentation mode — step through frames as slides.
- [ ] `[S]` Reactions / live cursors with name labels during collaboration.

## Parity
~65% of Miro/FigJam. Canvas, boards, templates, voting, comments, meeting timer, and a strong AI suite are all real; the remaining gaps are true conflict-free multiplayer, raster export, frames, and connectors.
