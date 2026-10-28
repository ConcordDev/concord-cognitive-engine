# SRS Lens — Capability Map (Frontend Rebuild Program, Wave 3)

Reproduce the macro list: `grep -c 'registerLensAction("srs"' server/domains/srs.js` → 31
(plus 4 legacy artifact-based analysis macros registered inline in
`server/server.js` — `srs.review`/`srs.schedule`/`srs.optimize_intervals`/
`srs.generate_cards_from_dtus` — and a separate, intentionally distinct
`/api/srs/due|:dtuId/add|:dtuId/review` Express-route triad backed by
`server.js`'s module-level `SRS.cards` map + `reviewSRSCard`/`getDueCards`.)

## Reference apps

- **Anki** — the category leader for authored flashcard decks: SM-2/FSRS
  scheduling, sub-decks, filtered decks, cloze deletion, image occlusion,
  media + TTS, deck import/export (`.apkg`), card browser with bulk
  suspend/bury/tag, review heatmap + streak calendar.
- **RemNote** — the "spaced repetition over your own notes" angle: instead
  of authoring flashcards from scratch, you schedule review of things
  you've already written.

Parity target: match Anki's full feature set for authored decks, *and*
uniquely surpass it by letting any DTU already in Concord's knowledge
substrate (a chat takeaway, a saved article, an engineering note) be
scheduled for spaced review with zero re-authoring — a capability no
standalone flashcard app has, because it has no "everything you've ever
saved" substrate to draw from.

## Audit finding: real Anki-parity engine existed but the page around it was broken

`server/domains/srs.js` is a genuine, deep, per-user Anki-2026-parity
substrate (`STATE.srsLens`): deck CRUD + hierarchy + filtered (dynamic
query) decks, four card types (basic/cloze/image-occlusion/templated),
media + browser TTS, FSRS-4.5-shape scheduler *and* a classic SM-2
scheduler selectable per deck, a card browser (search/filter/bulk
suspend/bury/tag/move), `.apkg.json`-shape deck import/export, and a
review heatmap + 30-day forecast. `components/srs/SrsWorkbench.tsx`
(1,289 LOC) already surfaced essentially all of it through six real,
purpose-built tabs (Decks / Add Cards / Browser / Study / Heatmap /
Import-Export) — this was never a stub.

The problem was the ~900-line legacy top half of `app/lenses/srs/page.tsx`
that sat *above* `SrsWorkbench`, predating it. It had four real, distinct
defects, found by reading the file in full rather than trusting that a
1,295-line page must be doing its job:

1. **A structural JSX bug buried a whole panel inside the wrong modal.**
   The "SRS Domain Analysis" action panel (`spacedRepetitionSchedule` /
   `retentionCurve` / `cardDifficulty` / `deckStats`) plus `RealtimeDataPanel`
   and `UniversalActions` were nested inside `<div className="flex gap-3
   pt-2">` — the two-button (Close/Delete) footer row of the **Card Detail
   modal**, itself only rendered when `editingCard` was set. The tag counts
   only balanced because of this accidental nesting; the panel was
   unreachable except by opening an unrelated modal, and even then rendered
   squeezed into a flex row meant for two small buttons.
2. **A fabricated-success "Add to SRS" call.** The Create Card modal called
   `addToSrs.mutate(newFront, ...)` — passing the card's plain question
   text as if it were a DTU id — to `POST /api/srs/:dtuId/add`. That route
   correctly returns `{ok:false, error:"DTU not found"}` (an honest
   failure) for any id that isn't a real `STATE.dtus` entry, but the
   frontend's `onSuccess` fired anyway because it only checked that the
   HTTP call resolved, never the response body's `ok` field — exactly the
   fabricated-success-envelope class of bug. The modal closed and the form
   cleared as if the DTU had been scheduled; nothing had happened server-side.
3. **Reviews silently never persisted.** The fallback card list
   (`persistedCards`, sourced from the generic lens-artifact `useLensData`
   CRUD) never set a `.dtuId` field, so `handleReview` called
   `reviewItem.mutate({dtuId: current.dtuId, quality})` with `dtuId ===
   undefined`. Server-side, `reviewSRSCard("undefined", quality)` silently
   created/updated a single phantom card keyed to the literal string
   `"undefined"` on every rating click, for every card, and that phantom
   was excluded from `getDueCards` (`STATE.dtus.get("undefined")` is
   falsy). The UI *looked* like reviews were scheduling cards forward
   (session counters incremented, the next card loaded) while nothing was
   ever actually saved — a second instance of the fabricated-success
   pattern, this time on the review path itself.
4. **A field-shape mismatch.** Cards were created with `data.easeFactor`
   but the display code read `.easiness`, so "Avg Ease" and the per-card
   Ease column always showed the hardcoded 2.5 default regardless of
   review history (which, per #3, never updated it anyway).

All four defects traced back to the same root cause: a duplicate, older,
generic-lens-artifact-backed CRUD system (Study/Decks/Browse/Stats views +
Create Card/Create Deck/Card Detail modals) sitting on top of the real
Anki-parity engine and never actually wired to it — the "fabricated
parallel generic-CRUD system" defect class, not a one-off typo.

## Two intentionally distinct SRS surfaces (not a duplicate to merge)

`server/tests/srs-wire.test.js` pins `/api/srs/due` + `/api/srs/:dtuId/add`
+ `/api/srs/:dtuId/review` as a load-bearing contract: this is a
**separate, legitimate feature** — spaced review of arbitrary DTUs already
in Concord's knowledge substrate (tied into the affect system via `ATS`),
distinct from `domains/srs.js`'s purpose-authored flashcard decks. The fix
below keeps both, corrects the wiring on the DTU-review side, and removes
only the broken, redundant generic-artifact CRUD duplicate.

## Checklist

| Item | Disposition |
|---|---|
| Deck CRUD + hierarchy + filtered (dynamic-query) decks | ALREADY REAL — `SrsWorkbench` Decks tab |
| Four card types (basic/cloze/image-occlusion/templated) + media + TTS | ALREADY REAL — `SrsWorkbench` Add Cards tab |
| FSRS + SM-2 scheduler, per-deck selectable | ALREADY REAL — `SrsWorkbench` Study tab + Deck Options panel |
| Card browser: search/filter/bulk suspend/bury/tag/move | ALREADY REAL — `SrsWorkbench` Browser tab |
| Deck import/export (`.apkg.json`) | ALREADY REAL — `SrsWorkbench` Import/Export tab |
| Review heatmap + 30-day forecast | ALREADY REAL — `SrsWorkbench` Heatmap tab |
| **Unreachable SRS Domain Analysis panel + RealtimeDataPanel + UniversalActions** (JSX nesting bug) | **FIXED THIS PASS.** Removed with the legacy top-half rewrite (see below); `RealtimeDataPanel`/`UniversalActions` restored to correct top-level placement, no longer nested inside an unrelated modal. |
| **Fabricated-success "Add to SRS" on card creation** | **FIXED THIS PASS.** The bogus `addToSrs.mutate(newFront, ...)` call (front-text-as-dtuId) is removed; "Add to spaced review" is now a dedicated action that opens a real `DTUPickerModal` and adds an actual DTU id, checking the response body's `ok` field and surfacing a genuine failure message rather than assuming success. |
| **Reviews silently not persisting** (`dtuId: undefined` phantom-card bug) | **FIXED THIS PASS.** The new "Review your knowledge" section sources due cards exclusively from `/api/srs/due` (`{dtu, card}` pairs with a real `dtu.id`), never from the generic-artifact fallback, so every review always targets a real DTU id. |
| **`easeFactor`/`easiness` field-shape mismatch** | **FIXED (removed with the legacy display code that had it).** |
| Duplicate generic-lens-artifact CRUD (Study/Decks/Browse/Stats views, Create Card/Deck modals) | **REMOVED — fabricated-parallel-system disposition.** This system duplicated `SrsWorkbench`'s real, correctly-wired functionality with a broken, non-persisting one. Card *authoring* now happens exclusively in `SrsWorkbench`'s Add Cards tab (all 4 card types, media, markup) rather than a second, inferior single-basic-card modal. |
| **`srs-dashboard`** (deck/card/due/mature/suspended counts) | **BACKEND-CAPABLE-BUT-UNSURFACED → WIRED THIS PASS.** Real macro, no caller anywhere. Added a "Collection overview" stat row to `SrsWorkbench`'s Heatmap/Stats tab. |
| **`study-stats`** (accuracy % + again/hard/good/easy rating breakdown) | **BACKEND-CAPABLE-BUT-UNSURFACED → WIRED THIS PASS.** Real macro, no caller anywhere. Added an "Accuracy" panel (breakdown bar + counts) to the same Stats tab, scoped to the active deck filter. |
| `spacedRepetitionSchedule` / `retentionCurve` / `cardDifficulty` / `deckStats` (legacy artifact-based analytics) | **HONEST RELABEL (superseded, no build needed).** These operate on a generic lens-artifact shaped `{cards:[...]}`/`{reviews:[...]}` that nothing in this lens produces (a single authored flashcard's `.data` is `{front,back,...}`, not an array container) — they were unreachable by design mismatch, not by the JSX bug alone. `SrsWorkbench`'s real deck stats (`deck-list` counts), `srs-dashboard`, and `study-stats` now cover the same ground against the actual persisted substrate. Building a synthetic artifact just to feed these four legacy macros would be a second redundant analytics path on top of the one just wired; left unbuilt by disposition. |
| `srs.review`/`srs.schedule`/`srs.optimize_intervals`/`srs.generate_cards_from_dtus` (server.js inline legacy macros) | **HONEST RELABEL (superseded, no build needed).** Same generic-artifact shape mismatch as above; predates the real deck engine and is not referenced by any current frontend code path. |
| `/api/srs/due` + `/:dtuId/add` + `/:dtuId/review` (DTU spaced-review triad) | **ALREADY REAL, NOW CORRECTLY WIRED.** Kept per the pinned `srs-wire.test.js` contract; rebuilt as a distinct "Review your knowledge" section using a real `DTUPickerModal` to pick a DTU and real ids on every review call. |

## What changed

- `concord-frontend/app/lenses/srs/page.tsx` — full rewrite (1,295 → ~340
  LOC). Removed the legacy generic-lens-artifact Study/Decks/Browse/Stats
  views and Create Card/Create Deck/Card Detail modals (the broken,
  non-persisting duplicate system) along with the client-side `_sm2()`
  reimplementation they used (the server is the source of truth for the
  scheduling math per "compute-don't-guess"). Added a "Review your
  knowledge" section that correctly wires `/api/srs/due|add|review` against
  real DTU ids via `DTUPickerModal`, checks response `.ok` before treating
  a call as successful, and surfaces genuine failures. `SrsWorkbench` +
  `SrsRepos` remain mounted as the primary deck-authoring/study surface.
  `RealtimeDataPanel`/`UniversalActions` restored to correct top-level
  placement (previously buried inside a broken modal).
- `concord-frontend/components/srs/SrsWorkbench.tsx` — Stats tab now also
  fetches `srs.srs-dashboard` and `srs.study-stats` and renders a
  "Collection overview" stat row + an "Accuracy" breakdown panel alongside
  the existing heatmap/forecast.

## Verification

- `npx eslint app/lenses/srs/page.tsx components/srs/SrsWorkbench.tsx components/srs/SrsRepos.tsx` — clean, exit 0.
- `npx tsc --noEmit` intentionally **not run** per this pass's standing
  instruction (a prior parallel batch OOM'd the container on it); did a
  careful manual type review instead (all new/changed state, props, and
  macro-result shapes are typed against `server/domains/srs.js`'s actual
  return shapes and `lib/api/generated-types.ts`'s `DTU` interface).
- `node --check server/server.js` / `node --check server/domains/srs.js` — no backend files were touched, syntax re-verified anyway; both clean.
- `node --test --test-force-exit server/tests/srs-wire.test.js server/tests/srs-domain-parity.test.js` — **34/34 passing, 0 fail** (includes the pinned frontend-contract regexes for `apiHelpers.srs.due/add/review`).
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — `srs`: `tier: "polished"`, `isGenericScaffold: false`, `antiPatterns: 0`. (Transient `audit/ux-polish-honest*` files reverted after the run via `git checkout -- audit/`.)
