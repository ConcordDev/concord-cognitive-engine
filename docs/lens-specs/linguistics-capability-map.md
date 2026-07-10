# Linguistics Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("linguistics"' server/domains/linguistics.js
```
→ **25** macros in `server/domains/linguistics.js` (692 lines), registered
via `registerLinguisticsActions(registerLensAction)`. No domain-string
collisions with any other lens (`linguistics.live_dictionary` and
`linguistics.live_datamuse` are two additional, separately-registered
macros in `server/domains/scholarly-apis.js` — a second, distinct Free
Dictionary/Datamuse integration shared with `education`/`creative-writing`/
`poetry`; both surfaces are real and both are already wired, see below).

Real surfaces: 4 pure-compute text analyzers (`textAnalysis`, `analyze`,
`morphologyBreakdown`, `frequencyAnalysis`, `sentimentAnalysis` — 5, not 4;
all deterministic, no LLM), 2 real Free Dictionary API + Datamuse API
integrations (`dictionary-lookup`, `datamuse-words` — free, no key), a
STATE-backed personal vocabulary builder with Leitner-box spaced review
(`vocab-add/list/update/delete/review-due/review/dashboard` — 7), a
gamification/progress substrate (`progress-stats`, `progress-set-goal`),
an adaptive quiz engine that draws real distractor definitions from the
user's own vocabulary (`quiz-generate`, `quiz-grade`), three more Free
Dictionary-backed word tools (`pronounce`, `word-context`, `etymology`),
and a themed word-deck substrate (`deck-create/list/delete/import` — 4).

## Frontend surface

`concord-frontend/app/lenses/linguistics/page.tsx` (854 LOC) +
`concord-frontend/components/linguistics/{DatamusePanel, DictionaryPanel,
LinguisticsActionPanel, ProgressDashboard, QuizEngine, VocabularyBuilder,
WordDecks, WordLookup, WordTools}.tsx` (9 files, ~1,900 LOC combined).

## What's real and already-wired (found before touching anything)

Unlike several earlier Wave rebuilds, this lens's word-learning suite was
**already genuinely well-built** — no fabricated data, no invented
artifact types, correct field shapes throughout:

- `VocabularyBuilder.tsx` — add/list/delete/review-due/review, all wired
  correctly, auto-fetches a definition from the dictionary when the user
  leaves it blank (`vocab-add`'s `autoFetch` param).
- `QuizEngine.tsx` — `quiz-generate`/`quiz-grade`, adaptive weighting,
  real multiple-choice distractors from the user's own words.
- `ProgressDashboard.tsx` — `progress-stats`/`progress-set-goal`, real
  streak/points/badge math (server-computed, not client-invented).
- `WordDecks.tsx` — `deck-create/list/delete/import`, bulk import with
  auto-fetched definitions.
- `WordLookup.tsx` + `LinguisticsActionPanel.tsx` — `dictionary-lookup` +
  `datamuse-words` (syn/ant/rhyme), `textAnalysis`, `sentimentAnalysis`,
  correctly using the dispatch layer's `{ artifact: { data: {...} } }`
  single-key peel (`server/lib/lens-input-normalize.js`) so the flat
  `{ text }` the handlers expect actually arrives.
- `DictionaryPanel.tsx` + `DatamusePanel.tsx` — a second, independent
  Free Dictionary/Datamuse integration (`linguistics.live_dictionary` /
  `linguistics.live_datamuse` from `scholarly-apis.js`), correctly wired,
  shared with other lenses. Redundant in purpose with `WordLookup`/
  `LinguisticsActionPanel` but not fake — both paths are real API calls;
  left alone (two legitimate integration surfaces, not a defect).
- `WordTools.tsx` — `pronounce`/`word-context`/`etymology`, all real Free
  Dictionary data, honest empty-states ("No recorded etymology for this
  word" rather than fabricating one).

## The defects found

### 1. The "Zap — Run AI analysis" button in the generic CRUD notebook
was a silent dead button (field-shape mismatch, no result display)

`page.tsx` additionally runs a persisted-artifact notebook (`Analyses` /
`Lexicon` / `Grammars` / `Corpora` / `Translations` tabs) via
`useLensData`/`useRunArtifact` against the generic `/api/lens/linguistics`
REST CRUD store. Unlike the fabricated-type pattern found in other
Wave-3 lenses (e.g. `nonprofit`'s invented `Grant`/`ImpactMetric`/`Fund`
types with zero backend macro), **this notebook is not fake** — `title`,
`data.description`, `data.subfield`, `data.language`, etc. are real,
persisted, user-authored records with no client-side fabrication. But its
one "real macro" affordance was broken:

- `handleAction(artifactId)` called `runArtifact.mutate({ id, action:
  'analyze' })` with no `params`. Server-side, `register("lens","run")`
  looks up `LENS_ACTIONS.get('linguistics.analyze')` and calls the
  handler with the **persisted artifact** as `artifact` — whose `.data`
  only ever has `{artifactType, subfield, language, description,
  sourceText, targetText, glosses, morphemes, syntaxTree, ipa, examples}`.
  `linguistics.js`'s `analyze` handler reads `params?.text ||
  artifact?.data?.text || artifact?.data?.content` — **none of those
  three ever exist** on a notebook artifact, so every click returned
  `{ ok:false, error:"text required" }`.
- Worse: the result was **never rendered anywhere**. `handleAction` fired
  the mutation and discarded the response — no toast, no panel update, no
  error surface. A user clicking the lightning-bolt icon saw nothing
  happen, success or failure, ever.

### 2. The notebook's create form never captured 5 of the 10 fields its
own detail panel renders — permanently-dead detail sections

The detail panel (lines ~597–650, pre-fix) conditionally renders IPA,
Morphemes, Syntax Tree, Glosses, and Examples sections — but the create
form (`showCreate` block) only ever collected `title`/`subfield`/
`language`/`description`/`sourceText`/`targetText`. A `LexiconEntry` could
never carry an IPA transcription; a `Grammar` entry could never carry a
morpheme breakdown, syntax tree, or gloss line. Those five detail-panel
sections were unreachable UI — not fabricated, but permanently empty by
construction, which reads the same as fake to a user who discovers a
"Syntax Tree" heading that can never show anything.

### 3. Two real macros had zero frontend caller (`node
scripts/lens-unsurfaced.mjs --lens linguistics`, cross-checked)

The static scanner reported `morphologyBreakdown` and `vocab-update` as
2/25 unsurfaced. Manual cross-reference (the scanner does a whole-frontend
token grep, not lens-scoped, so it under-reports) found a **third**:
`frequencyAnalysis` (linguistics) also had zero caller — the only hit for
that token string anywhere in the frontend was `NeuroActionPanel.tsx`'s
unrelated `neuro.frequencyAnalysis` (FFT band power), which made the
scanner mark the linguistics token "surfaced" by false positive.

- **`morphologyBreakdown`** (`{word}` → `{prefix, root, suffix,
  morphemeCount, wordClass}`) — zero UI. A natural fit alongside
  `WordTools.tsx`'s existing pronounce/context/etymology trio.
- **`frequencyAnalysis`** (`{text}` → `{totalWords, uniqueWords,
  topContentWords, hapaxLegomena, zipfCompliance}`) — zero UI, despite
  `textAnalysis` and `sentimentAnalysis` already having designed action
  buttons in `LinguisticsActionPanel.tsx` sharing the same text-corpus
  input.
- **`vocab-update`** (`{id, definition?, example?, partOfSpeech?,
  tags?}`) — zero UI. `VocabularyBuilder.tsx` could add, delete, and
  review words but never correct a definition/example/part-of-speech
  after the fact (e.g. after an auto-fetch pulled a marginal sense).

## What changed

### 1. `app/lenses/linguistics/page.tsx`

- Fixed `handleAction`: now looks up the artifact's own `sourceText` (or
  `description` as fallback) and sends it as `params.text` explicitly —
  the exact shape `analyze` reads — and shows an honest error
  ("Add a description or source text before running analysis") when
  neither field has content instead of firing a call that can only fail.
- Added `actionResult`/`actionError` state (keyed by artifact id so a
  stale result never displays under the wrong selected item) and rendered
  the real macro output (or the real error) directly in the detail panel,
  with a dismiss control. The Zap button now shows a spinner while
  `runArtifact.isPending` — closes the "dead click" defect.
- Added the 5 missing create-form fields, conditionally per artifact type
  (IPA + examples for `LexiconEntry`; morphemes + syntax tree + glosses
  for `Grammar`), so the detail panel's IPA/Morphemes/Syntax
  Tree/Glosses/Examples sections can now actually be populated by a real
  user action instead of being permanently dead space.

### 2. `components/linguistics/WordTools.tsx` — closes `morphologyBreakdown`

Added a 4th parallel lookup (alongside pronounce/context/etymology) that
calls `linguistics.morphologyBreakdown` and renders the prefix/root/suffix
breakdown as three colour-coded morpheme chips plus the inferred word
class — matching the existing honest-empty-state pattern (no fabricated
morphology when the macro finds none: `prefix: "none"` / `suffix: "none"`
are filtered from the chip row).

### 3. `components/linguistics/LinguisticsActionPanel.tsx` — closes
`frequencyAnalysis`

Added a "Frequency" action button (5th button, alongside Define/
Rhyme-Synonym-Antonym/Text-stats/Sentiment) reusing the panel's existing
text-corpus textarea. Renders unique/total word counts, hapax legomena
count, the top content words as frequency chips, and the macro's own
Zipf-compliance note — no client-side frequency computation, the server
macro is the only source of the numbers.

### 4. `components/linguistics/VocabularyBuilder.tsx` — closes
`vocab-update`

Added inline edit: a pencil icon per word row (matching the existing
hover-reveal delete icon) opens an inline form (definition/example/part
of speech) and a Save button that calls `linguistics.vocab-update` with
only the changed fields, then refreshes the list.

## Macro → UI classification (all 25 macros)

**DESIGNED** — 25/25 after this pass (22/25 were already designed before
this pass; `morphologyBreakdown`, `frequencyAnalysis`, `vocab-update` were
UNSURFACED and are now designed):

| Macro group | Count | Where |
|---|---:|---|
| `textAnalysis`, `analyze` | 2 | `LinguisticsActionPanel.tsx` action button + `page.tsx` Quick Analysis panel (pre-existing, real) |
| `morphologyBreakdown` | 1 | `WordTools.tsx` (**newly wired this pass**) |
| `frequencyAnalysis` | 1 | `LinguisticsActionPanel.tsx` (**newly wired this pass**) |
| `sentimentAnalysis` | 1 | `LinguisticsActionPanel.tsx` (pre-existing, real) |
| `dictionary-lookup`, `datamuse-words` | 2 | `WordLookup.tsx` + `LinguisticsActionPanel.tsx` (pre-existing, real) |
| `vocab-add/list/delete/review-due/review/dashboard` | 6 | `VocabularyBuilder.tsx` (pre-existing, real) |
| `vocab-update` | 1 | `VocabularyBuilder.tsx` inline edit (**newly wired this pass**) |
| `progress-stats`, `progress-set-goal` | 2 | `ProgressDashboard.tsx` (pre-existing, real) |
| `quiz-generate`, `quiz-grade` | 2 | `QuizEngine.tsx` (pre-existing, real) |
| `pronounce`, `word-context`, `etymology` | 3 | `WordTools.tsx` (pre-existing, real) |
| `deck-create/list/delete/import` | 4 | `WordDecks.tsx` (pre-existing, real) |

Total: 2+1+1+1+2+6+1+2+2+3+4 = **25**. Matches
`grep -c 'registerLensAction("linguistics"' server/domains/linguistics.js`.

**GENERIC-STRIP-ONLY**: none. The notebook's `<ManifestActionBar>` and
`<LensFeaturePanel>` remain mounted (as a capability directory, per the
pattern used across the rebuild program) but every macro-backed action a
user actually needs is reachable through a bespoke component — the
notebook's own Zap button (fixed this pass) is a real, single-purpose
action, not a generic multi-macro button wall.

**UNSURFACED**: none remaining. `node scripts/lens-unsurfaced.mjs --lens
linguistics` reports 0/25 (was 2/25 by the scanner's own count, 3/25 by
manual cross-check accounting for the `frequencyAnalysis` cross-lens false
positive — see defect 3).

## Confirmed real and left alone, with reason

`grep -n "Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded"
components/linguistics/*.tsx app/lenses/linguistics/page.tsx` → no
fabrication signatures found (only legitimate uses: `Math.random()` inside
`server/domains/linguistics.js`'s `quiz-generate` for shuffling distractor
order and weighted-pick selection — server-side randomness for a genuine
quiz-variety feature, not client-side fake data).

- **The generic CRUD notebook (`Analyses`/`Lexicon`/`Grammars`/
  `Corpora`/`Translations` tabs)** — kept, not gutted. Unlike the
  `nonprofit`/other Wave-3 precedents where the parallel CRUD system's
  artifact types had **zero** backing macro and fabricated field data,
  this notebook persists real user-authored records through the generic
  but genuinely-real `lens.create/list/update/delete` macros, with
  domain-specific structured fields (subfield taxonomy, language tracking,
  IPA/morphemes/syntax-tree/glosses/examples) that a corpus-linguistics
  researcher would plausibly want to keep as personal notes distinct from
  the word-learning suite below it. It was under-built (2 defects fixed
  above), not fake — kept and repaired rather than replaced.
- **`DictionaryPanel.tsx`/`DatamusePanel.tsx` vs. `WordLookup.tsx`/
  `LinguisticsActionPanel.tsx`** — two independent, both-real API
  integration paths (`live_dictionary`/`live_datamuse` in
  `scholarly-apis.js` vs. `dictionary-lookup`/`datamuse-words` in
  `linguistics.js`). Redundant in purpose but not a defect — both are
  real, both work, left alone.

## Genuinely missing, deferred

None identified requiring new backend work. The lens's implied surface
(morphosyntactic analysis, lexicon/dictionary lookup, vocabulary
acquisition with spaced review, quiz-based recall testing, themed decks,
pronunciation/etymology/context, frequency/sentiment/readability text
stats) is fully covered by the existing 25-macro backend; every gap found
was a frontend wiring/field-shape/missing-form-field defect (DATA-SOURCING/
ENGINEERING/CURATION triage: none apply — no external data source is
missing, no computation engine is missing, no content curation is
missing).

## Verification

- `node --check server/domains/linguistics.js` — clean (file untouched
  this pass; verified anyway per the assignment brief).
- `node --test tests/depth/linguistics-analyze-behavior.test.js
  tests/depth/linguistics-behavior.test.js
  tests/linguistics-vocab-domain-parity.test.js
  tests/linguistics-domain-parity.test.js
  tests/linguistics-lens-macros.test.js` (from `server/`) — **56/56
  pass**, unmodified.
- `npx eslint app/lenses/linguistics/page.tsx components/linguistics/*.tsx`
  (from `concord-frontend/`) — clean, exit 0.
- `node scripts/verify-lens-backends.mjs` (from repo root) —
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (linguistics was already
  WIRED and stays WIRED).
- `node scripts/grade-ux-polish.mjs --honest` (from repo root) —
  linguistics entry: `"tier": "polished"`, `"isGenericScaffold": false`,
  `"pillarsPresent": 5`, `"antiPatterns": 0`. `audit/` reverted via
  `git checkout -- audit/` immediately after (shared working tree).
- `node scripts/lens-unsurfaced.mjs --lens linguistics` (from repo root)
  — **0/25 unsurfaced** (was 2/25 by the scanner, 3/25 by manual
  cross-check, before this pass).
