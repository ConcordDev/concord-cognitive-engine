# expedition-journal — Feature Gap vs in-game world-progress tracker (no consumer rival)

Category leader (2026): no direct consumer rival — this is an in-game Concordia mechanic (per-world expedition progress). Closest analog: a quest/achievement checklist crossed with a travel journal. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: client-side only — stages persist to `localStorage` (`concordia:expedition:all`); marking a stage calls `gameModeOrchestrator.advance()`. BaseCampAlmanac component.

## Has (verified in code)
- Per-canon-world 3-stage checklist (arrive → act → record)
- Stage completion persisted locally; orchestrator advances the game mode on save
- World switcher (cycle with `]` key); BaseCampAlmanac component

## Missing — buildable feature backlog
- [x] `[M]` Server-side persistence — progress is localStorage-only, lost on device change
- [x] `[S]` Journal entries per stage — write a note/observation, not just a checkbox
- [x] `[S]` Photo/screenshot capture per expedition stage
- [x] `[S]` Completion rewards — tie a finished expedition to XP/items/badges
- [x] `[M]` Richer stage definitions — varied objectives per world instead of a fixed 3
- [x] `[S]` Overall progress summary across all worlds

## Parity
~85% of a world-progress tracker. The thinnest lens in this batch — a 3-checkbox-per-world list with no backend; missing server persistence, journal entries, media capture, and completion rewards that would make it a real expedition log.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
