# ghost-tracker — Feature Gap vs no direct rival (in-game mode)

Category leader (2026): no direct consumer rival — it is an in-world game mode (Phase V ghost-hunt). Closest analog is a quest/bounty tracker.
Backend: `ghost-hunt` domain — only 2 macros: `residues` (spectral drift residues) and `confront`; HauntingsFeed component.

## Has (verified in code)
- Spectral residue list — drift type, severity, signature, context, detected-at timestamp
- Confront CTA bound to `ghost-hunt.confront` to engage a haunting
- Active-world scoping via `concordia:activeWorldId`
- Hauntings feed component

## Missing — buildable feature backlog
- [x] `[S]` Residue detail view — full context + investigation hints
- [x] `[S]` Map placement of residues in the world (where to go)
- [x] `[M]` Confront outcome history — wins/losses, rewards earned
- [x] `[S]` Severity/type filtering + sorting
- [x] `[M]` Multi-stage hunt progression (track → investigate → confront chain)
- [x] `[S]` Leaderboard / hunter rank for confronted hauntings

## Parity
~88% of a quest-tracker's surface for what it scopes. The residue→confront loop is functional and tied to the real drift-detection substrate, but it is thin — no detail view, no map placement, no outcome history, no progression chain.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
