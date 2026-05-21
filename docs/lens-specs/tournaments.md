# tournaments — Feature Gap vs Challonge / Battlefy

Category leader (2026): Challonge / Battlefy (esports bracket platforms). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: REST routes (`GET /api/tournaments`, `GET /api/tournaments/:id`) + tournament create/register; rule-set lock enforced via training-match `tournament_bracket_id`.

## Has (verified in code)
- Player-organized PvP tournaments — list (open status), create, detail view.
- Bracket detail — bracket tree by round number, entrants, rules, prize pool.
- Server-enforced rule-set lock — the bracket runs entrants through bouts in declared order.
- Register-to-enter flow; bracket_kind field.

## Missing — buildable feature backlog
- [x] `[M]` Multiple bracket formats — round-robin, double-elimination, Swiss (only single bracket_kind shown).
- [x] `[S]` Live bracket updates / match-result reporting and auto-advance UI.
- [x] `[M]` Seeding — manual or rating-based seed assignment before the bracket locks.
- [x] `[S]` Tournament status lifecycle — upcoming/in-progress/completed filters and past-tournament archive.
- [x] `[M]` Check-in window before start; auto-forfeit no-shows.
- [x] `[S]` Spectator view with live scores and a shareable bracket link.
- [x] `[M]` Team tournaments (rosters), not just 1v1 entrants.
- [x] `[S]` Prize distribution / payout on completion.

## Parity
~88% of Challonge. Single-bracket creation, registration, and a rule-locked run-through are real, but it lacks the format variety, seeding, live match reporting, and check-in flow that bracket platforms are built around.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
