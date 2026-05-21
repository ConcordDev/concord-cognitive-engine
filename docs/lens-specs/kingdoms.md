# kingdoms — Feature Gap vs Crusader Kings III

Category leader (2026): Crusader Kings III (grand-strategy realm management). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/kingdoms.js` macros (list, get, kingdom_status, my_realm, decrees_for_region, propose_decree, revoke_decree, recompute_loyalty, takeover_conquest, takeover_inheritance, takeover_election, depose_ruler) over `server/lib/kingdoms.js`, `kingdom-decrees.js`, `kingdom-takeover.js`, `kingdom-rebellion.js`.

## Has (verified in code)
- Realm listing per world, kingdom detail with citizen loyalty summary + active rebellions
- Decree system — propose / issue / revoke region-scoped decrees; loyalty recomputation
- Three takeover paths — conquest, inheritance, election — plus ruler deposition
- Rebellion-risk evaluation and per-kingdom rebellion tracking
- RulerHUD + DecreeComposer frontend surfaces

## Missing — buildable feature backlog
- [ ] `[L]` Character/dynasty system — heirs, marriages, bloodline succession laws (partially exists in migrations, not surfaced here)
- [ ] `[M]` Council / vassal management — appointable positions with their own agendas
- [ ] `[M]` Diplomacy actions — alliances, treaties, tributes, fabricated claims between realms
- [ ] `[M]` War / casus belli system with troop levies and battle resolution
- [ ] `[S]` Realm economy view — taxes, treasury, building construction
- [ ] `[M]` Intrigue / schemes — plots, secrets, assassination (npc_schemes exists, not wired to this lens)
- [ ] `[S]` Law / succession-type editor (gavelkind, primogeniture, elective)

## Parity
~50% of CK3's realm-management surface. Decrees, loyalty, rebellion, and three takeover paths are real and working, but missing the dynasty/succession depth, diplomacy, war, and intrigue layers — much of which exists elsewhere in the substrate but is not surfaced in this lens.
