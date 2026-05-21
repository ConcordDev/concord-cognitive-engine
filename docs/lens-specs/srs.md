# srs — Feature Gap vs Anki

Category leader (2026): Anki. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `srs` domain (15 macros): deck CRUD, card CRUD, `study-next`/`study-answer`, `study-stats`, `srs-dashboard`, plus pure-compute schedule projection, retention curve, card difficulty, deck stats.

## Has (verified in code)
- Full per-user deck + card substrate (create/list/delete decks; add/list/update/delete cards)
- Study session loop with SM-2 scheduling, quality grading (again/hard/good/easy)
- Anki-style keyboard shortcuts (space to reveal, 1-4 to grade)
- Study modes (normal / reverse), study stats, dashboard, retention-curve modeling
- 5-view UI: study, decks, browse, stats, create; deck builder component

## Missing — buildable feature backlog
- [ ] `[L]` FSRS scheduler — Anki's modern default algorithm; only SM-2 is implemented
- [ ] `[M]` Rich card types — cloze deletion, image occlusion, multi-field/templated notes
- [ ] `[M]` Media in cards — images / audio / TTS on front/back
- [ ] `[M]` Deck import/export (.apkg / shared-deck library)
- [ ] `[S]` Per-deck options — new-cards-per-day limits, review caps, learning steps
- [ ] `[M]` Card browser with search, filter, bulk edit, tags, suspend/bury
- [ ] `[S]` Review heatmap / streak calendar and forecast graph
- [ ] `[M]` Sub-decks / deck hierarchy and filtered decks
- [ ] `[S]` Card markup (HTML/markdown) and hint fields

## Parity
~55% of Anki. The study loop, deck/card CRUD, and SM-2 scheduling are solid and genuinely usable, but Anki's defining 2026 features — FSRS, cloze/image-occlusion, media, .apkg import — are all missing.
