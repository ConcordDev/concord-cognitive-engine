# deities — Feature Gap vs in-game pantheon system (no consumer rival)

Category leader (2026): no direct consumer rival — this is an in-game Concordia mechanic (player-composed patron deities). Closest analog: a deity/religion system in a sim game. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `deity` domain macros via `/api/lens/run` — list, compose, pilgrimage; federated-pilgrimage support (origin_peer field).

## Has (verified in code)
- Pantheon list ranked by pilgrim count; per-deity author + birth date
- Compose a deity: name + tone vector (warmth/refusal/mystery sliders) + dialogue templates + alignment thresholds
- Pilgrimage action (records a pilgrim, bumps pilgrim_count) — federation-aware
- PantheonExplorer component

## Missing — buildable feature backlog
- [ ] `[M]` Deity detail view — show tone vector, dialogue templates, pilgrim roster
- [ ] `[M]` Live commune dialogue — actually talk to a deity using its tone vector + thresholds
- [ ] `[S]` Deity editing — revise tone/templates after composing
- [ ] `[S]` Pilgrimage history / personal devotion tracking per player
- [ ] `[M]` Deity-granted blessings/boons tied to alignment — gameplay payoff for pilgrimage
- [ ] `[S]` Pantheon search/filter by tone or popularity

## Parity
~50% of a deity-system mechanic. Compose + pilgrimage + ranked pantheon work end to end with federation, but missing the detail view, live commune dialogue, and blessing payoff that would make deities gameplay-meaningful.
