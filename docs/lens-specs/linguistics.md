# linguistics — Feature Completeness Spec

Rival app(s): Datamuse, Wiktionary, vocabulary apps (Vocabulary.com, Anki-for-words) (2026)
Sources:
- https://www.datamuse.com/api/ (word query API — live)
- https://dictionaryapi.dev/ (free dictionary — live)
- vocabulary-builder apps with spaced review

## Features

### Text & word analysis (retained)
- [x] Text analysis — readability metrics (macro: linguistics.textAnalysis)
- [x] Morphology breakdown (macro: linguistics.morphologyBreakdown)
- [x] Frequency analysis (macro: linguistics.frequencyAnalysis)
- [x] Sentiment analysis (macro: linguistics.sentimentAnalysis)
- [x] Dictionary lookup (live) (macro: linguistics.dictionary-lookup)
- [x] Datamuse related-words (live) (macro: linguistics.datamuse-words)

### Vocabulary builder (spaced review)
- [x] Add a word — definition, part of speech, example, tags; case-insensitive dedupe (macro: linguistics.vocab-add)
- [x] List / filter words by tag or query (macro: linguistics.vocab-list)
- [x] Update / delete words (macro: linguistics.vocab-update / vocab-delete)
- [x] Due-for-review queue (macro: linguistics.vocab-review-due)
- [x] Review a word — Leitner-box promote on known / reset on miss, 6-level intervals (macro: linguistics.vocab-review)
- [x] Vocabulary dashboard — mastered / learning / fresh / due-now (macro: linguistics.vocab-dashboard)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Auto-fetched definitions when adding a word | inline dictionary API call on add | the dictionary-lookup macro fetches definitions; the user pastes the definition into vocab-add (or the frontend chains the two) |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/linguistics.js` clean. 13 macros
  (6 analysis/lookup + 7 vocabulary substrate).
- 2026-05-20: Tests — `tests/linguistics-vocab-domain-parity.test.js` 9/9 green
  (vocab CRUD + per-user scope + case-insensitive dedupe + tag filter /
  new-word due-now / known promotes level + pushes due / miss resets to 0 /
  dashboard mastery buckets / analysis macros intact).
- 2026-05-20: Frontend — new `VocabularyBuilder` (word list with mastery
  dots, add form, flashcard review mode with reveal + grade) mounted in the
  linguistics lens page. `npx tsc --noEmit` exit 0.
