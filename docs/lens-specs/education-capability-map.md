# education — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("education"' server/domains/education.js` → 68
> `node scripts/lens-unsurfaced.mjs --lens education` → `0/68 macros never referenced in the frontend`
> `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260
> `node scripts/grade-ux-polish.mjs --honest` → `education: tier "polished", isGenericScaffold:false`

## Reference app + parity target

**Khan Academy + Coursera**, explicitly — the backend file header says so
("Full-app parity: Khan Academy + Coursera 2026") and the 68-macro surface
backs it: course/lesson CRUD, enrollments, a Khan-style skill tree with
5-level mastery, streaks/energy points, certificates, Coursera-style
assignments + peer review, lesson notes, course discussions, a real
Socratic tutor (LLM-constrained to never give the answer), quiz-from-text
generation, lesson-plan generation, video-progress + synced transcripts,
interactive auto-graded exercises with 3-tier hints, prerequisite-sequenced
learning paths, live cohort/classroom sessions, a mastery/streak dashboard,
and timestamp-anchored lesson Q&A. This is one of the largest pages in the
repo (4,758 lines) with 25 bespoke components (9,637 total LOC, `tier:
"polished"` per the grader). The backend is genuinely built to match — this
was NOT a rebuild-from-scratch unit; it needed a defect audit.

There is also a second, load-bearing, separate substrate behind the same
lens: `server/routes/learning.js` (a "knowledge genome" personalized
learning system — DTU-based domain gaps/frontier/paths, on-chain-style
credentials, tutor/socratic endpoints, cohort matching, assessments). The
page's earlier sections (before the "Khan/Coursera-parity workbench") are
built on THIS system via `api.post('/api/learning/...')`, not the
`education` macro domain. Both are real; they are simply two different
backends composed into one lens. Don't conflate them when auditing macro
coverage — `lensRun('education', ...)` calls only cover the second half of
the page.

## Findings

### Field-shape bug: `gradeCalculation` / `progressTrack` always returned empty (FIXED, confirmed by boot-and-call)

`EducationActionPanel.tsx` (`actGrade`/`actProg`) called:

```ts
callMacro<GradeResult>('gradeCalculation', { artifact: { data: parsed } })
```

`gradeCalculation`/`progressTrack` (`server/domains/education.js:20`,`:220`)
read `artifact.data.students` / `artifact.data.weightScheme` /
`artifact.data.requirements` / `artifact.data.completions`. The
`/api/lens/run` dispatcher (`server.js:39595`) builds
`virtualArtifact.data = rest` — `rest` being the raw POST `input` field,
verbatim, with NO further unwrapping. So the frontend's `{ artifact: {
data: parsed } }` payload landed at
`virtualArtifact.data.artifact.data.students` — one level deeper than the
handler reads. `artifact.data.students` on the real virtual artifact was
always `undefined`, so `gradeCalculation` silently returned
`studentsGraded: 0` / all-zero `classStats` for every input, and
`progressTrack` silently returned `overallCompletionPct: 0` for every
input — no error, no throw, just a wrong empty answer. This is the
single-most-common defect class this program has found repo-wide (field-
shape mismatch through the lens-run envelope), and it hits a genuinely
teacher-facing "Classroom bench" panel with a designed grade-report UI
behind it.

**Verified empirically** (not just by static reading — booted the real
server in-process via `server/tests/depth/_harness.js#lensRun` and called
`gradeCalculation` both ways):

```
Correct-shape (input: parsed)        -> studentsGraded: 1  {"average":90,...}
Buggy-shape (current frontend today) -> studentsGraded: 0  {"average":0,...}
```

**Fix:** `actGrade`/`actProg` now call `callMacro('gradeCalculation',
parsed)` / `callMacro('progressTrack', parsed)` directly — `parsed` (the
user's pasted JSON, already shaped `{students, weightScheme}` /
`{requirements, completions}` per the handler's own doc comment) becomes
the POST `input` with no extra wrapper. Also added placeholder text to the
two raw-JSON textareas showing the exact expected shape (previously blank,
which was its own small discoverability gap on top of the field-shape bug).

### Real-but-unreachable macros: `notes-save` / `video-progress-save` / `lesson-qa-ask` had no way to obtain a `lessonId` (FIXED)

Three components — `LessonNotes`, `LessonQA`, `VideoLessonPlayer` — are all
correctly wired to real macros (`notes-*`, `video-progress-*`,
`video-transcript-*`, `lesson-qa-*`) and all key off a `lessonId`. But:

- `LessonQA` and `VideoLessonPlayer` required the user to type/paste a raw
  internal lesson id string (`less_...`) into a bare text input, with zero
  UI anywhere in the lens that ever displayed that id. `CoursesCatalog`'s
  expanded lesson list shows `{order}. {title}` and duration/kind — never
  the id.
- `LessonNotes` is mounted at the "Notes" tab
  (`KhanCourseraWorkbenchSection`, `app/lenses/education/page.tsx:4751`)
  with **no `lessonId` prop at all** — `<LessonNotes />`. Its own code only
  renders the "add a note" form `{lessonId && (...)}` when a lessonId is
  present, so the Notes tab was permanently stuck showing "Pick a lesson to
  add notes." with literally no picker to do that pick — a dead end. The
  sibling "Player" tab (`LessonPlayer.tsx`) tracks an `activeLesson` but
  never shared it with the Notes tab.

This is the same defect class as the field-shape bug above but at the UI
layer instead of the wire layer: a real macro with a correctly-built
component sitting behind an unreachable entry point.

**Fix:** added `components/education/useLessonOptions.ts` — a small hook
that calls `education.courses-list` (which embeds each course's `lessons[]`
directly, no extra round-trip) and flattens it into a pickable
`{id, label}` list. Wired a `<select>` lesson-picker into all three
components (`VideoLessonPlayer`, `LessonQA` default to the picker with a
"Paste ID instead" toggle for power users / deep links; `LessonNotes` gets
an inline picker in its header when no `lessonId` prop is supplied, so the
standalone Notes tab is self-sufficient). No macro or backend shape
changed — this is purely closing the "can't discover the id" wiring gap.

### Everything else audited: real, correctly wired

Read all 25 components against the 68 macros' actual param destructuring
(`ctx, artifact, params` for `registerLensAction` handlers; note `params`
and `artifact.data` are usually the SAME object for the non-artifact-shaped
macros — `virtualArtifact.data = rest` — which is exactly what made the
grade/progress bug above land where it did). Confirmed correct:
`CoursesCatalog`, `EnrollmentsPanel`, `LessonPlayer`, `SkillTree`,
`CertificatesPanel`, `AssignmentsBoard`, `CourseDiscussions`,
`FlashcardDeck`, `SocraticTutor`, `QuizGenerator`, `LessonPlanBuilder`,
`InteractiveExercises`, `LearningPaths`, `LiveCohorts`, `MasteryDashboard`,
`StreakDashboard`, `GenomeGraph`/`PathStepCard` (learning.js-backed genome
UI). Field names, param shapes, and optimistic-refresh patterns all match
their handlers exactly — no other field-shape mismatches found.

`education.feed` (`server/domains/education.js:1881`) is a real,
already-wired DATA-SOURCING integration: it ingests live quiz questions
from the free, keyless Open Trivia Database (opentdb.com) as visible DTUs,
deduped by question text. Surfaced via `<LensFeedButton domain="education"
label="Live quiz feed" />` at the bottom of the workbench.

~~The `courses-*` / `discussions-*` / `cohorts-*` buckets are scoped
per-`userId` (in-memory `Map<userId, T[]>`, persisted via
`_concordSaveStateDebounced`) rather than being a shared global catalog —
so "Course catalog" / course discussions / cohorts are honestly a
*personal* authoring + tracking surface (you create courses, you enroll
yourself, you discuss your own courses), not a multi-tenant Coursera
marketplace where other users' courses appear.~~ **CLOSED (2026-07-12,
pending commit).** Built the genuine multi-tenant catalog: migration 363
(`edu_courses` / `edu_discussions` / `edu_cohorts`) adds an `author_id`
column to each and switches all three from per-user `Map<userId, T[]>`
keying to one shared row per item, reached through a `courseStore(ctx,
s)` / `discussionStore(ctx, s)` / `cohortStore(ctx, s)` db-or-memory
facade — the same pattern `domains/tournaments.js` (migration 360)
established this session. **Both cross-user visibility AND cross-restart
durability are solved**, not just visibility: when `ctx.db` is reachable
(the always-true case for the running server) every read/write goes
through real SQL, so the catalog survives a restart; the in-memory
fallback (bare unit-test/minimal builds) keeps the same Maps but re-keyed
as `Map<id, item>` (global, not per-user), so cross-user visibility holds
in both modes.

- **Courses** (`courses-list` / `courses-search`) now return every
  `status: "published"` course from every author, plus the caller's own
  drafts — `params.mine: true` narrows to "courses I authored" (any
  status), the view an instructor needs for their own catalog including
  unpublished drafts. `courses-create` defaults `status: "published"`
  (backward-compatible: create → immediately catalog-visible, matching
  every pre-existing test's assumption); pass `status: "draft"` to stage a
  course privately first. A draft is invisible to `courses-get`/
  `courses-list`/`courses-search` for anyone but its author — the
  draft/publish split this doc's prior text flagged as unresolved.
- **Mutation is ownership-gated.** New `courses-update` macro (title/
  description/category/level/durationHours/instructor/institution/kind/
  rating/status, whitelisted) and the existing `courses-delete` both
  reject any caller whose `userId !== course.authorId` with
  `{ok:false, error:"not authorized: ..."}` — the same shape of boundary
  `domains/studio.js`'s collaborator-aware fix (`508399c7`, this session)
  established for a different domain. `lessons-create` is gated the same
  way (only the course author can add lessons to it); `enrollments-enroll`
  now looks the course up in the shared catalog so a learner can enroll in
  *anyone's* published course, not just their own.
- **Discussions and cohorts are genuinely shared, open-participation
  surfaces** — a course discussion thread now shows every user's posts
  (previously each user saw only their own posts as a private list, which
  made a "forum" that never had more than one participant); cohorts are
  listable/joinable/leavable by anyone, with `cohorts-set-status`
  (the scheduled → live → ended transition) gated to the scheduling
  author only, so a roster member can't hijack another instructor's
  session state.
- `dashboard-summary`'s `totalCourses` now means "courses I authored"
  (computed by filtering the shared catalog by `authorId === caller`)
  rather than "the length of my private course bucket" — same number for
  the common case, but now honestly reflects "mine" now that the
  underlying store is global.
- Frontend: `components/education/CoursesCatalog.tsx` gained a "Mine"
  toggle (`courses-list` with `mine: true`), an author-badge (`Yours`) +
  draft-lock badge, a live enrollment-count display, a
  draft/publish checkbox on course creation, and ownership-gated
  delete/add-lesson affordances (a non-author sees "Only {instructor} can
  add lessons" instead of the mutation UI, matching the backend's real
  rejection rather than showing a button that would silently 403).
- Regression coverage: `server/tests/education-domain-parity.test.js`
  gained a `multi-tenant catalog: cross-user visibility + ownership-gated
  mutation` describe block (cross-visibility, ownership-gated update/
  delete/lessons-create, draft-privacy round-trip); new
  `server/tests/education-catalog-persistence.test.js` (6 cases) proves
  the DB path specifically — real rows in `edu_courses`/`edu_discussions`/
  `edu_cohorts` (checked via raw SQL against a second, independent
  `better-sqlite3` handle to the same file — restart-equivalence), cross-
  user visibility through the DB store, and ownership-gated mutation with
  the row provably unchanged on disk after a rejected non-author attempt;
  new `concord-frontend/components/education/CoursesCatalog.test.tsx` (3
  cases) pins the frontend ownership-gating UI.

## Verification performed

- `node --test server/tests/depth/education-behavior.test.js
  server/tests/education-domain-parity.test.js
  server/tests/education-lens-macros.test.js` → **80/80 pass, 0 fail**
  (unchanged by this fix — these tests hit the macros directly, not through
  the buggy frontend wrapper). **Update (2026-07-12, multi-tenant catalog
  close-out):** the same three files, re-run against a fresh isolated
  `DB_PATH`, are now **140/140 pass, 0 fail** (up from 107 — the delta is
  the new multi-tenant-catalog describe blocks in
  `education-domain-parity.test.js` and the `cohorts-list`/`courses-list`
  assertion updates, not a regression); adding the new
  `education-catalog-persistence.test.js` (6 DB-path-specific cases)
  brings the four-file total to **146/146 pass, 0 fail**.
- Booted the real server in-process (`server/tests/depth/_harness.js`) and
  called `gradeCalculation` with both the old buggy shape and the fixed
  shape — confirmed `studentsGraded: 0` (all-zero stats) vs `studentsGraded:
  1` (real computed average) respectively.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260 (unchanged — education was already WIRED).
- `node scripts/grade-ux-polish.mjs --honest` → `education` still `tier:
  "polished"`, `isGenericScaffold:false` (unchanged; `audit/` reverted via
  `git checkout -- audit/` after the run).
- `node scripts/lens-unsurfaced.mjs --lens education` → `0/68 macros never
  referenced in the frontend` (unchanged — the bugs found were field-shape
  and lesson-discoverability, not missing surfacing).
- eslint/`tsc --noEmit` could **not** be run — `concord-frontend/`
  `node_modules` was not installed, and the worktree's host disk had only
  ~1.3GB free after installing `server/` deps for the harness verification
  above (a full frontend `npm install` risked exhausting it). Did a manual
  read-through of every touched file instead (brace/paren balance checked
  programmatically; types and JSX structure checked by eye against the
  existing patterns in sibling components). Documented here explicitly per
  the task's own instruction to not claim "clean" without running the
  linter.
