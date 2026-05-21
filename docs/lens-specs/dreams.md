# dreams — Feature Gap vs in-game dream-record system (no consumer rival)

Category leader (2026): no direct consumer rival — this is an in-game Concordia mechanic (deterministic dream records of substrate state, sellable on the marketplace). Closest analog: a dream journal crossed with a collectible-export feature. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `dream` domain macros via `/api/lens/run` — recent_for_player, publish (with royalty cascade). Dreams are auto-composed by the embodied-dream-cycle heartbeat (Layer 9).

## Has (verified in code)
- List recent dreams — fragment count, composer, composed-at, title
- Publish a dream to the marketplace at a CC price (royalty cascade pays the dreamer)
- Published-vs-personal scope indicator
- DreamConvergences component (cross-dream pattern surface)

## Missing — buildable feature backlog
- [ ] `[M]` Dream detail / full-text reader — read the composed prose, not just metadata
- [ ] `[S]` Custom publish price (currently hardcoded 5 CC)
- [ ] `[S]` Dream tagging + search across your dream history
- [ ] `[S]` Unpublish / reprice a published dream
- [ ] `[M]` Dream interpretation — AI reflection linking dream fragments to recent activity
- [ ] `[S]` Dream timeline / calendar view

## Parity
~50% of a dream-record mechanic. The list + publish + royalty loop works, but missing the full-text reader, custom pricing, search, and interpretation that would make dreams worth revisiting.
