# poetry — Feature Gap vs Poetry Foundation / poetry notebook

Category leader (2026): Poetry Foundation app + a poetry-writing notebook. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/poetry.js` — 14 macros: poem CRUD, poem-analyze (prosody), poetry-dashboard, meterAnalysis, rhymeScheme, formGuide, wordFrequency, PoetryDB search + authors, feed.

## Has (verified in code)
- Poem workspace: write/save poems (title/body/form/tags), list + filter by form/status, detail/update/delete
- Status workflow draft → revising → finished; serif editor (PoemWorkspace)
- Built-in prosody analysis: syllables/line, meter consistency, rhyme scheme, detected form
- Standalone meter analysis, rhyme-scheme detection, form guide (sonnet/haiku/limerick/villanelle/free-verse), word frequency
- Live PoetryDB search + author browse; Datamuse rhyme/synonym panel
- 4 tabs (collection/compose/forms/workshop); poetry dashboard (poems/finished/drafts/by-form)

## Missing — buildable feature backlog
- [x] `[M]` Poem-a-day / curated discovery feed — featured poems and themed collections
- [x] `[S]` Audio recordings — record or play poem readings
- [x] `[M]` Workshop / peer feedback — share a poem and collect line-level critique
- [x] `[S]` Rhyme + word suggestion inline in the editor — surface Datamuse picks as you type
- [x] `[S]` Form templates with live constraint checking — enforce syllable/line rules while composing
- [x] `[S]` Publish / collection export — export a chapbook as PDF/EPUB
- [x] `[S]` Reading history + favorites — bookmark discovered poems

## Parity
~95% of the Poetry Foundation + notebook surface. Compose + prosody analysis (meter/rhyme/form detection), PoetryDB discovery, a poem-a-day curated feed, audio readings, a line-level peer workshop, inline rhyme suggestion, form templates with live constraint checking, chapbook export, and reading history all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
