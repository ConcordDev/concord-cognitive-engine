# film-studios — Feature Completeness Spec

Rival app(s): StudioBinder, DaVinci Resolve, Frame.io
Sources:
- https://www.studiobinder.com/script-breakdown-software/
- https://www.studiobinder.com/film-scheduling-software/
- https://www.studiobinder.com/callsheet/
- https://www.studiobinder.com/writing-software/

## Features

### Projects & production setup (DONE — existing)
- [x] Projects with format + logline; create/list/get/update/delete
- [x] Cast & crew CRUD
- [x] Locations database — create/list/update/delete; scenes link to a location

### Screenplay (DONE — this slice)
- [x] Per-scene script body — formatted elements (heading/action/character/dialogue/parenthetical/transition)
- [x] Assembled screenplay export with page-eighths-based page count

### Scenes & script breakdown (DONE — existing + this slice)
- [x] Scenes with slugline, INT/EXT, time of day, page eighths, cast
- [x] Script breakdown tagging in 16 industry element categories
- [x] Breakdown summary; detailed element-list report

### Shots & storyboard (DONE — existing + this slice)
- [x] Per-scene shot lists — size, angle, movement, lens, equipment
- [x] Storyboard frames — image + frame notes per shot; storyboard board view

### Scheduling (DONE — existing + this slice)
- [x] Shooting days; stripboard with scene strips; strip assignment
- [x] Call sheets generated from a shoot day (cast, crew, scenes, pages)
- [x] Day Out of Days (DOOD) report — per-cast Start/Work/Hold/Finish matrix
- [x] Production calendar — shoot days + tasks + milestones by month

### Budget (DONE — existing)
- [x] Budget lines by department; variance vs actual

### Edit timeline (DONE — existing + this slice)
- [x] Sequences with fps; clips on V/A tracks; running-timecode cut list
- [x] Timeline markers — add/list/delete at a timecode

### Review (Frame.io shape) (DONE — existing + this slice)
- [x] Cut versions with stage; timecoded review notes; note resolve
- [x] Version approval status — in_review / approved / needs_changes

### Production management (DONE — this slice)
- [x] Production tasks — department, assignee, due date, status
- [x] Dashboard rollup

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Real video playback / scrubbing / rendering | media transcode pipeline | timecode-based clip list + markers + review notes |
| Colour grading / Fusion compositing | GPU pipeline | edit metadata; post-production timeline estimate |
| Live Camera-to-Cloud upload | device + storage infra | attachments / storyboard image URLs |
| PDF call-sheet generation & email | PDF renderer + mail | structured call-sheet data rendered on screen |

## Verification log
- 2026-05: backend `node --test tests/filmstudios-domain-parity.test.js` → 22/22 green (65 macros).
- 2026-05: frontend — new Screenplay + Production tabs/panels; storyboard frames in Shots,
  DOOD in Production, markers in Edit, version approval in Review. `npx tsc --noEmit` exit 0.
- 2026-05: `npm run score-lenses` → film-studios 7/7 PASS.
- Every spec feature implemented. Boundary register holds only the 4 genuine media/PDF
  infrastructure items. Zero unchecked non-boundary lines.
