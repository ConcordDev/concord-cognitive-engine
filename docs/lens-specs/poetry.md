# poetry — Feature Completeness Spec

Rival app(s): Poetry Foundation, Poets.org, poetry-writing notebooks (2026)
Sources:
- https://poetrydb.org/ (open poetry database — live search)
- https://www.poetryfoundation.org/ (poem discovery, forms reference)

## Features

### Poem workspace
- [x] Write + save poems — title, body, form, tags (macro: poetry.poem-create)
- [x] List + filter poems by form / status (macro: poetry.poem-list)
- [x] Poem detail / update / delete; status draft → revising → finished (macro: poetry.poem-detail / poem-update / poem-delete)
- [x] Built-in prosody analysis on a saved poem — syllables/line, meter consistency, rhyme scheme, detected form (macro: poetry.poem-analyze)
- [x] Poetry dashboard — poems, finished/drafts, total lines, by-form (macro: poetry.poetry-dashboard)

### Prosody tools (retained)
- [x] Meter analysis (macro: poetry.meterAnalysis)
- [x] Rhyme scheme detection (macro: poetry.rhymeScheme)
- [x] Form guide — sonnet / haiku / limerick / villanelle / free-verse (macro: poetry.formGuide)
- [x] Word frequency + key images (macro: poetry.wordFrequency)

### Discovery (live)
- [x] PoetryDB search + author browse (macro: poetry.poetrydb-search / poetrydb-authors)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Authoritative syllable/scansion dictionary | a pronunciation corpus (e.g. CMUdict) | vowel-group syllable heuristic — consistent and good enough for meter feedback |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/poetry.js` clean. 13 macros
  (4 prosody tools + 2 PoetryDB + 7 poem-workspace substrate).
- 2026-05-20: Tests — `tests/poetry-domain-parity.test.js` 8/8 green
  (poem CRUD + per-user scope + form filter / poem-analyze meter+rhyme +
  unknown-id reject / dashboard by-form / prosody macros intact).
- 2026-05-20: Frontend — new `PoemWorkspace` (poem list, serif editor with
  form + status, inline prosody analysis) mounted in the poetry lens page.
  `npx tsc --noEmit` exit 0.
