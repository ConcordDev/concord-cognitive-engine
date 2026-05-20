# whiteboard — Feature Completeness Spec

Rival app(s): Miro, FigJam, Excalidraw (2026)
Sources:
- https://miro.com/ (infinite canvas, sticky notes, frames, templates, voting, meeting timer, comments, multiplayer cursors)
- https://www.figma.com/figjam/ (sticky notes, AI cluster/summarize, generate from prompt)
- https://excalidraw.com/ (free-draw canvas, shapes, export)

## Features

### Canvas & boards
- [x] Interactive infinite canvas — shapes, sticky notes, text, free-draw (frontend `WhiteboardCanvas`)
- [x] Board CRUD — list / save / load / delete (macro: whiteboard.board-*)
- [x] Duplicate a board — deep-copied scene, new id (macro: whiteboard.board-duplicate)
- [x] Autosave on shape change (1.5s debounce)
- [x] 6 starter templates — brainstorm / retro / OKR / user-journey / flowchart / SWOT (macro: whiteboard.templates-list / template-load)
- [x] Shape detection + layout optimization + element clustering (macro: whiteboard.shapeDetect / layoutOptimize / clusterGroup)

### Collaboration
- [x] Share a board — join / leave / list shared (macro: whiteboard.share-board / shared-list / join-shared / leave-shared)
- [x] Multiplayer — broadcast scene + cursor presence (macro: whiteboard.broadcast-scene / broadcast-cursor)
- [x] Dot voting — per-board + shared-board vote cast / tally (macro: whiteboard.vote-* / shared-vote-*)
- [x] Comments — list / add / resolve / delete, anchored to elements (macro: whiteboard.comments-*)
- [x] Meeting timer — board-scoped countdown, start / get / stop, visible to all participants (macro: whiteboard.timer-start / timer-get / timer-stop)

### AI (FigJam-shape)
- [x] Cluster sticky notes by theme (macro: whiteboard.ai-cluster-stickies)
- [x] Summarize a board → summary + action items (macro: whiteboard.ai-summarize-board)
- [x] Generate a starter board from a prompt (macro: whiteboard.ai-generate-board)
- [x] Vision — describe an uploaded board image (macro: whiteboard.vision)

### Export
- [x] Export-prep diagnostics (macro: whiteboard.exportPrep)
- [x] Portable JSON envelope — board + elements + comments, round-trippable (macro: whiteboard.board-export-json)
- [x] Workspace summary — board / sticky / shared / open-comment counts (macro: whiteboard.workspace-summary)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Live operational-transform multiplayer | a CRDT/OT sync server + websockets | broadcast-scene / broadcast-cursor snapshot sync + shared-board participant set |
| Raster image export (PNG/SVG) | a server-side canvas renderer | portable JSON envelope export (round-trippable), client-side canvas rendering |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/whiteboard.js` clean.
  34 macros (canvas/boards + collaboration + AI + export).
- 2026-05-20: Tests — `tests/whiteboard-domain-parity.test.js` 38/38 green
  (templates / boards CRUD / board-duplicate deep-copy + unknown-id reject /
  voting / sharing / multiplayer / AI cluster+summarize+generate / comments /
  export / workspace-summary / meeting-timer start-get-stop + duration clamp).
- 2026-05-20: Frontend — `MiroSection` workbench gains a board-scoped meeting
  timer (1/3/5/10/15/30-min quick-start, live countdown, red < 30s) and a
  Duplicate-board action. `npx tsc --noEmit` exit 0.
