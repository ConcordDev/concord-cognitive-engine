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
- (in progress) — backend macros + tests; frontend panels; feature walkthrough.
