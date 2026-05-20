# srs — Feature Completeness Spec

Rival app(s): Anki, RemNote (2026)
Sources:
- https://apps.ankiweb.net/ (decks, cards, SM-2 / FSRS scheduling, study sessions, review heatmap, ease/interval)
- https://www.remnote.com/ (spaced-repetition over notes)

The srs lens has two complementary surfaces: a **DTU-based review**
(turn knowledge DTUs into flashcards — Express routes `/api/srs/*`)
and a **custom deck builder** (this spec — `server/domains/srs.js`
deck/card/study macros), mirroring Anki's "your notes" vs "custom
decks" split.

## Features

### Decks & cards
- [x] Create / list / delete decks, per-deck new + due counts (macro: srs.deck-create / deck-list / deck-delete)
- [x] Add / list / update / delete cards — front / back / tags (macro: srs.card-add / card-list / card-update / card-delete)

### Study session (modern SM-2)
- [x] Study-next — due review cards first, then ≤20 new/day (macro: srs.study-next)
- [x] Study-answer — Again / Hard / Good / Easy ratings drive ease, interval, lapses (macro: srs.study-answer)
- [x] Card states — new → learning → review at the 21-day maturity line
- [x] Review log with per-rating breakdown

### Analytics
- [x] Study stats — accuracy + 14-day review heatmap (macro: srs.study-stats)
- [x] SRS dashboard — decks / cards / new / due / mature / reviews (macro: srs.srs-dashboard)
- [x] SM-2 schedule projection (macro: srs.spacedRepetitionSchedule)
- [x] Retention curve modelling (macro: srs.retentionCurve)
- [x] Card difficulty classification (macro: srs.cardDifficulty)
- [x] Deck statistics — mastery rate, health score (macro: srs.deckStats)

### DTU-based review (existing)
- [x] Add a DTU as an SRS card, fetch due cards, review (routes: `/api/srs/due`, `/api/srs/:dtuId/add`, `/api/srs/:dtuId/review`)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| FSRS (the newer Anki scheduler) | a trained difficulty/stability model | modern SM-2 with per-rating ease deltas + Hard/Easy interval modifiers |
| Media (audio/image) cards | a blob store + media references | text front/back with tags; artifact DTUs cover rich media separately |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/srs.js` clean. 12 macros
  (4 analytics + 8 deck/card/study substrate).
- 2026-05-20: Tests — `tests/srs-domain-parity.test.js` 12/12 green
  (deck CRUD + per-user scope / card CRUD + validation / study-next + answer
  scheduling / again-lapse / easy-vs-good interval / stats heatmap /
  dashboard / analytics intact).
- 2026-05-20: Frontend — new `SrsDeckBuilder` Anki-shape workbench (deck
  list, card editor, study mode with 4-rating reveal, 14-day heatmap)
  mounted in the srs lens page alongside the DTU review. `npx tsc --noEmit`
  exit 0.
