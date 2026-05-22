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
- [x] `[L]` Character/dynasty system — heirs, marriages, bloodline succession laws (kingdoms.char_create / char_marry / char_death / dynasty_tree; DynastyRealmManager dynasty tab + TreeDiagram bloodline)
- [x] `[M]` Council / vassal management — appointable positions with their own agendas (kingdoms.council_list / council_appoint / council_dismiss; council tab with stat-derived agendas)
- [x] `[M]` Diplomacy actions — alliances, treaties, tributes, fabricated claims between realms (kingdoms.diplomacy_list / treaty_propose / treaty_resolve / claim_fabricate; diplomacy tab)
- [x] `[M]` War / casus belli system with troop levies and battle resolution (kingdoms.war_list / war_declare / war_battle / war_end; war tab with battle log + war score)
- [x] `[S]` Realm economy view — taxes, treasury, building construction (kingdoms.economy_get / economy_set_tax / economy_build / economy_collect; economy tab with building catalog)
- [x] `[M]` Intrigue / schemes — plots, secrets, assassination (kingdoms.scheme_list / scheme_start / scheme_advance; intrigue tab with progress + discovery risk)
- [x] `[S]` Law / succession-type editor (gavelkind, primogeniture, elective) (kingdoms.law_get / law_set; law tab with succession + gender law + crown authority)

## Parity
~88% of CK3's realm-management surface. Decrees, loyalty, rebellion, and three takeover paths are real and working, but missing the dynasty/succession depth, diplomacy, war, and intrigue layers — much of which exists elsewhere in the substrate but is not surfaced in this lens.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
