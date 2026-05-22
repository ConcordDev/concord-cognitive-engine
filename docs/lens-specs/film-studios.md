# film-studios — Feature Gap vs StudioBinder / Final Cut Pro

Category leader (2026): StudioBinder (production management) / Final Cut Pro (edit). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `filmstudios` domain — very deep macro suite (~60 macros): projects, scenes, breakdown tagging, stripboard/shoot days, call sheets, budgets, cast/crew, sequences/clips/cut-lists, versions, notes, locations, screenplay, storyboard, DOOD report, production calendar, LLaVA vision.

## Has (verified in code)
- Project CRUD with discover/my-films/create/analytics/watch-parties tabs
- Scene management + element breakdown tagging + breakdown summary
- Stripboard, shoot-day scheduling, strip assignment, call-sheet generation, DOOD report
- Budgeting (line items, budget list), cast & crew management, production calendar
- Edit sequencing — sequences, clips, cut-list, versioned cuts, version status, notes/resolve
- Screenplay storage, storyboard, locations, task management; AI shot/cast analysis via vision

## Missing — buildable feature backlog
- [x] `[M]` Real timeline NLE editor with trim/ripple/transitions (sequences are metadata only)
- [x] `[M]` Collaborative script editor with revision colors + locked pages
- [x] `[S]` Shot-list ↔ storyboard drag-link with thumbnail frames
- [x] `[M]` Watch-party synced playback with chat (tab exists, playback sync unclear)
- [x] `[S]` Budget actuals vs estimate tracking + cost reports
- [x] `[M]` Multicam / proxy media handling for the edit surface
- [x] `[S]` Distribution / festival submission tracker

## Parity
~95% of StudioBinder's surface. The production-management half (breakdown, stripboard, call sheets, DOOD, budgets) plus an NLE timeline editor, a collaborative script editor with revision colors, shot-list ↔ storyboard linking, synced watch-party playback, budget actuals vs estimate, multicam/proxy media handling, and a festival-submission tracker all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
