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
- [ ] `[M]` Poem-a-day / curated discovery feed — featured poems and themed collections
- [ ] `[S]` Audio recordings — record or play poem readings
- [ ] `[M]` Workshop / peer feedback — share a poem and collect line-level critique
- [ ] `[S]` Rhyme + word suggestion inline in the editor — surface Datamuse picks as you type
- [ ] `[S]` Form templates with live constraint checking — enforce syllable/line rules while composing
- [ ] `[S]` Publish / collection export — export a chapbook as PDF/EPUB
- [ ] `[S]` Reading history + favorites — bookmark discovered poems

## Parity
~55% of the Poetry Foundation + notebook surface. The compose + prosody-analysis side is genuinely strong (real meter/rhyme/form detection) and PoetryDB discovery is real, but it lacks curated discovery, audio, and peer-workshop features.
