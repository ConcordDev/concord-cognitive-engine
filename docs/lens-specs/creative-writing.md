# creative-writing — Feature Completeness Spec

Rival app(s): Scrivener, Dabble, Plottr
Sources:
- https://www.literatureandlatte.com/scrivener/overview
- https://www.dabblewriter.com/articles/dabble-vs-plottr
- https://kindlingwriter.com/plottr-vs-scrivener/

## Features

### Manuscript binder (DONE — existing, 31 macros)
- [x] Projects with genre + word target; create/list/get/update/delete
- [x] Chapters + scenes binder; reorder, move scenes between chapters
- [x] Scene prose editor with live word count; scene status
- [x] Corkboard of synopsis cards
- [x] Characters with role, description, arc
- [x] Plot threads; tag scenes to threads
- [x] Writing sessions + stats with streak

### Research & story notes (DONE — this slice)
- [x] Research/notes binder — research / worldbuilding / location / item notes
- [x] Note create / list / update / delete

### Snapshots & versioning (DONE — this slice)
- [x] Take a snapshot of a scene before edits
- [x] List snapshots; restore a scene to a snapshot

### Plot grid (DONE — this slice)
- [x] Dabble-style plot grid — chapters × threads matrix of scene coverage

### Compile / export (DONE — this slice)
- [x] Compile the full manuscript — assembled text by chapter/scene with word count

### Goals & deadlines (DONE — existing + this slice)
- [x] Word-count goal + writing sessions + streak
- [x] Project deadline; words-per-day projection vs current pace

### Annotations (DONE — this slice)
- [x] Scene comments / annotations — add, list, delete

### Character arcs & relationships (DONE — this slice)
- [x] Character relationships (Plottr-style) — relate two characters with a kind
- [x] Relationship list per character

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Compile to formatted .docx / ePub / PDF | document renderer | compile assembles plain manuscript text + structure for copy-out |
| Embedded PDF / web-page research items | file storage + embed | research notes store text + URLs |
| Real-time cross-device sync | sync infra | per-user STATE; reload reflects latest |

## Verification log
- 2026-05-20: Backend — 48 macros across project / binder / corkboard / characters /
  threads / research / progress areas; `node --check` clean.
- 2026-05-20: Tests — `tests/creativewriting-domain-parity.test.js` 20/20 green
  (CRUD round-trips, snapshot restore, plot-grid computation, compile word count,
  goal projection, scene comments, character relationships).
- 2026-05-20: Frontend — Binder (snapshots + scene comments), Corkboard, Characters
  (relationships), Plot (plot grid), Research (story-notes binder), Progress
  (goal projection + compile) all reachable; `npx tsc --noEmit` exit 0.
- 2026-05-20: `npm run score-lenses` → creative-writing 7/7 PASS.
