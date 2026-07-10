# classroom — capability map (Frontend Rebuild Program, Wave 3)

Reference apps: **Google Classroom** (stream, classwork/assignments,
gradebook, materials, to-do, announcements) for the cohort-teaching side,
and **Open Library / Goodreads / LibraryThing** for the book-discovery side
this lens also carries. Parity target: the only difference should be
catalog size and cosmetic polish, not missing workflow.

## Backend macro surface

Two registration sites:
- `server/domains/classroom.js` — 22 macros via `registerLensAction`: the
  Open Library reader (`ol-search`/`ol-work`/`ol-subject`/`ol-isbn`) and the
  Google-Classroom-shaped workspace (`assignment-create/list/delete`,
  `submission-create/list`, `grade-submission`, `gradebook`, `announce`,
  `stream-list`, `material-add/list/delete`, `todo`, `quiz-create/list/get/
  submit/attempts`).
- `server/server.js` (inline, `register("classroom", ...)`) — 4 legacy
  cohort macros: `create_cohort`, `enrol`, `submit_homework`, `list_cohorts`.

`node scripts/lens-unsurfaced.mjs --lens classroom` → **0/22 unsurfaced**
(both before and after this rebuild — the workspace macros were already
fully wired).

## Audit finding: real, comprehensive backend depth — but two duplicate Open-Library UIs

`ClassroomWorkspace.tsx` (38KB) already covered all 18 non-OpenLibrary
workspace macros with a proper Google-Classroom-shaped tabbed UI (stream /
assignments / gradebook / materials / to-do / quizzes) — genuine, no gaps.
`OpenLibrarySearch.tsx` covered the 4 `ol-*` macros with a real cover-art
grid + detail card + `SaveAsDtuButton` (mint private OR public with a real
visibility toggle).

The genuine defect: a **second**, separate component —
`ClassroomActionPanel.tsx` — duplicated the exact same 4 `ol-*` macros
behind a plainer flat card-grid UI (search/subject/work/isbn inputs, all
re-implementing what the cover grid already did better), and was mounted
directly below `OpenLibrarySearch` on the same page. Two search UIs for the
same 4 macros is a real "generic-strip-only" pattern layered next to a
genuinely designed one — confusing (two places to search for a book, two
sets of results, no shared state) even though nothing was fabricated.

Of `ClassroomActionPanel`'s 8 actions, 4 were pure duplicates
(search/subj/work/isbn) and 2 more were themselves redundant with
`SaveAsDtuButton`'s existing private/public toggle (`mint` = private DTU,
`publish` = public DTU — `SaveAsDtuButton` already does both from one
control). Only 2 were genuinely distinct: **DM this book to another user**
and **ask the agent for a one-week reading plan**.

## What this rebuild changed

- Folded the 2 genuinely distinct actions (DM, agent week-plan) into
  `OpenLibrarySearch.tsx`'s book-detail view, next to `SaveAsDtuButton` —
  same recall-window DM pattern (`useRecallableAction`, 60s undo), same
  agent-plan flow (`chat_agent.do`), now scoped to whichever book is
  currently focused instead of a separate query/subject/work/isbn form
  the user had to re-populate by hand.
- Retired `ClassroomActionPanel.tsx` (deleted) and its mount in
  `app/lenses/classroom/page.tsx` (along with the now-unused
  `PipingProvider` wrapper it needed). Removed the corresponding
  `vi.mock('@/components/classroom/ClassroomActionPanel', ...)` from
  `tests/classroom-lens-states.test.tsx` since the component is no longer
  imported anywhere.
- Net effect: one real book-discovery surface instead of two overlapping
  ones, with 100% of the prior real capability preserved (DM + agent plan)
  and 0% of the duplicate capability kept.
- Left `ClassroomWorkspace.tsx`, the legacy cohort forms in `page.tsx`
  (create/enrol/submit — real, hand-built, not generic), and
  `OpenLibrarySearch.tsx`'s core browse/detail flow untouched — all already
  real.

## Disposition ledger (step 1.5)

- **ALREADY REAL**: cohort create/enrol/submit-homework (page.tsx, legacy
  macros); the entire Google-Classroom-shaped workspace (stream, classwork,
  gradebook, materials, to-do, quizzes) via `ClassroomWorkspace.tsx`; Open
  Library search/subject/work/isbn browse + Save-as-DTU via
  `OpenLibrarySearch.tsx`.
- **BACKEND-CAPABLE-BUT-UNSURFACED → now wired**: none remained after
  merging DM + agent-plan into the real browse UI (they existed in the
  retired duplicate panel, now live in the real one).
- **GENUINELY MISSING**: none found. The Google Classroom parity checklist
  (stream/classwork/gradebook/materials/to-do/quizzes/announcements) is
  fully closed; Open Library parity (search/subject/ISBN/cover art/detail/
  save) is fully closed.

## Verification

- `npx eslint app/lenses/classroom/page.tsx components/classroom/OpenLibrarySearch.tsx tests/classroom-lens-states.test.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — `classroom` still `WIRED`.
- `node scripts/grade-ux-polish.mjs --honest` — `classroom`: `tier: "polished"`, `isGenericScaffold: false`.
- `node scripts/lens-unsurfaced.mjs --lens classroom` — 0/22 unsurfaced (unchanged).
- `npx vitest run tests/classroom-lens-states.test.tsx` — 9/9 passing.
