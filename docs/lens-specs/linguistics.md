# linguistics — Feature Gap vs Vocabulary.com / Datamuse

Category leader (2026): Vocabulary.com (word learning) + Datamuse (word query). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/linguistics.js` — 13 macros: textAnalysis, morphologyBreakdown, frequencyAnalysis, sentimentAnalysis, live dictionary-lookup, live datamuse-words, vocab CRUD, vocab-review-due, vocab-review (Leitner), vocab-dashboard.

## Has (verified in code)
- Text analysis — readability metrics, frequency analysis, morphology breakdown, sentiment analysis
- Live word data — dictionary-lookup (dictionaryapi.dev), datamuse related-words
- Vocabulary builder — add/list/update/delete words, tags, case-insensitive dedupe
- Spaced review — Leitner-box 6-level intervals, due-now queue, flashcard review with grade
- Vocabulary dashboard — mastered/learning/fresh/due-now buckets
- Linguistics artifacts — analyses, lexicon, grammars, corpora, translations; IPA, glosses, morphemes, syntax tree fields

## Missing — buildable feature backlog
- [ ] `[M]` Adaptive quiz engine — multiple-choice/typing questions that adapt to mastery (Vocabulary.com core)
- [ ] `[S]` Auto-fetch definition on vocab-add — chain dictionary-lookup so the user doesn't paste
- [ ] `[M]` Pronunciation audio — TTS playback of words and IPA
- [ ] `[M]` Word-in-context examples — pull real usage sentences from a corpus API
- [ ] `[S]` Progress streaks & gamification — daily goals, points, mastery badges
- [ ] `[M]` Curated word lists / decks — themed packs (SAT, GRE, domain vocab) importable
- [ ] `[S]` Etymology / word-history view

## Parity
~55% of the Vocabulary.com+Datamuse surface. Strong analysis macros, live dictionary/Datamuse, and a real Leitner spaced-review loop, but missing the adaptive quiz engine, audio pronunciation, and contextual-example richness that make word-learning sticky.
