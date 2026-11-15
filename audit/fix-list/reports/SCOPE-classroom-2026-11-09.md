# Classroom scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/classroom.js` (+ `server/server.js` Phase 9.6 `classroom.*` macros ~94575–94804, `server/migrations/165_classroom_research.js`, `concord-frontend/app/lenses/classroom/page.tsx`, `components/classroom/ClassroomWorkspace.tsx`, `components/classroom/OpenLibrarySearch.tsx`, `components/classroom/quiz-attempt.ts`). Tip assumed same mega deploy as prior SCOPE reports (`dae9e10a6`). **No files/DB/services modified.** Code-only; not live-proven.

Requested as READ-ONLY code scope check for Lens Tester 3 after claiming `classroom` (criteria/classroom.md). Creates held until this answer — especially which records are private to the QA account, invites/enrolment paths that could reach another user, grades/PHI-like data, `_lensEmitDTU` (FIX-xl-ws-001), and delete paths.

**Slug confirmed:** `classroom` (route `/lenses/classroom`; domain macros `classroom.*`). Adjacent but separate: `education` (FRONTEND_ARTIFACT_TYPES has `education: ["artifact"]`, not `classroom`).

## Model — dual plane: SQLite cohorts + per-user workspace Maps

| Layer | UI | API path | Storage |
|-------|-----|----------|---------|
| **Cohorts (Teaching / Studying)** | `page.tsx` Cohorts view — Create / Enrol / Archive / Leave | `macro('classroom', 'create_cohort'\|'enrol'\|'list_cohorts'\|'archive_cohort'\|'leave_cohort')` → `server.js:94657–94804` | SQLite `classroom_cohorts` + `classroom_enrolments` (+ unused-by-UI `homework_submissions` / `peer_reviews`) — migration `165_classroom_research.js:17–61` |
| **Workspace (Stream / Classwork / Gradebook / To-do / Quizzes / Materials)** | `ClassroomWorkspace.tsx` (view `2`) | `lensRun('classroom', 'assignment-*'\|'submission-*'\|'grade-*'\|'announce'\|'stream-list'\|'material-*'\|'todo'\|'quiz-*')` → `domains/classroom.js` | Per-user Maps on `globalThis._concordSTATE.classroomLens` (`assignments`, `submissions`, `grades`, `stream`, `materials`, `quizzes`, `quizAttempts`) — key `classroomLens` is in `LENS_STATE_KEYS` (`lens-state-persistence.js:192`) so snapshot survives restart |
| **Library (Open Library)** | `OpenLibrarySearch.tsx` (view `3`) | `ol-search` / `ol-work` / `ol-subject` / `ol-isbn` | External public Open Library / Internet Archive reads (no API key). Optional `SaveAsDtuButton` mints a DTU |
| **Export chrome** | Header `DTUExportButton domain="classroom" data={{}}` (`page.tsx:252`) | May POST empty then fall back to `GET /api/lens/classroom/export` | File download; separate from workspace Maps |

### Shared runtime facts

- Domain registers Open Library + workspace macros in `classroom.js` (loaded through domains index). Actor gate: `uid(ctx) = ctx?.actor?.userId || ctx?.userId || "anon"` (`:194`); writes wrapped with `guardAnonWrites` (`:14`).
- Workspace Maps are **owner-scoped** — every list/get/filter uses `state.*.get(userId)`. Strangers cannot load another teacher's assignments/grades via these macros.
- SQLite cohorts: `create_cohort` sets `teacher_user_id = caller` (`server.js:94665–94667`). `list_cohorts` returns only cohorts the caller teaches or is enrolled in (`:94747–94765`). Studying rows **omit** `teacher_user_id` and expose only a public display name/handle (`classroomWithTeacherNames` `:94638–94654`).
- `classroom` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server.js:49775`).
- `classroom` is **NOT** in `FRONTEND_ARTIFACT_TYPES` (`lens-artifact-types.js:21–63`) — workspace CRUD does **not** go through generic `lens.create` / `_lensEmitDTU`.
- **FIX-xl-ws-001 / `_lensEmitDTU`:** domain macros do **not** call `_lensEmitDTU` or `realtimeEmit`. **Exceptions:** Library `SaveAsDtuButton` and header `DTUExportButton` / LensShell Mint-Publish are separate DTU paths — prefer skip.
- Phase 9.6 `submit_homework` / `peer_review` exist in `server.js` but the Cohorts UI explicitly does **not** take a homework DTU (`page.tsx:315`). No UI wiring found under `components/classroom/`.
- **No attendance table / roster entity.** "Students" appear as (a) `classroom_enrolments.student_user_id` counts on Teaching cards, or (b) free-text `studentId` strings on workspace submissions/grades/todo (default = caller's `userId`).
- Caps (workspace): instructions 4000; attachments ≤20×300 chars; points 0–1000; topic 80; submission content 8000; announce/feedback 4000; material notes 2000 / url 500; quiz ≤100 questions, prompt 1000, options ≤12×300, points 1–100; stream list limit 1–200.

## Hotkeys (RCA-form-hotkey-steal)

From `app/lenses/classroom/page.tsx:91–123` via `useLensCommand`:

| Key | Action |
|-----|--------|
| `1` | Cohorts view |
| `2` | Workspace view |
| `3` | Library view |
| `n` | **Create a cohort** (focus `#classroom-cohort-name`) |

**RC1: YES — bare-letter `n` + digits `1`/`2`/`3`.** Same RCA class as Foundry / Environment. `useLensCommand` skips INPUT / TEXTAREA / SELECT / `contentEditable` unless `global` (`hooks/useLensCommand.ts:43–49,147–154`). Classroom commands do **not** set `global`, so the guard *should* hold when focus is in a form field — still ticket as RCA-class if live typing of letters/digits jumps tabs (as seen on Services / Environment Field Ops).

**RC2: NO** in classroom components — `rg role="button"` over `app/lenses/classroom/` + `components/classroom/` is empty. No modal backdrop Enter/Space close pattern in this file set.

**Delete confirm: NONE.** Assignment trash and material trash call `assignment-delete` / `material-delete` immediately (`ClassroomWorkspace.tsx:252–256,511`). Archive / Leave on cohort rows also one-click (`page.tsx:193–206`). No `window.confirm`.

## Answers to the policy questions

### Which records are scoped to the creating account vs shared?

| Record | Scope | Shared with other users? |
|--------|-------|---------------------------|
| **Cohort** (`classroom_cohorts`) | Teacher = creator (`teacher_user_id`) | Row is global SQLite; visible to teacher via Teaching list and to **enrolled** students via Studying list (name + teacher display label only). Cohort **id is sequential** — knowing/guessing an id enables self-enrol (`enrol` blank student → join that cohort). |
| **Enrolment** (`classroom_enrolments`) | `(cohort_id, student_user_id)` | Cross-user by design: teacher may enrol another `studentUserId`; anyone may self-enrol into an **active** cohort by id. |
| **Assignments / materials / stream / quizzes / quizAttempts / submissions / grades** (`classroomLens` Maps) | **Per creating account (`userId` key)** | **Not shared.** Other accounts cannot read these Maps. `studentId` on submissions/grades is a **label string**, not a join to another account's data. |
| **Homework submissions / peer reviews** (SQLite) | Tied to real `student_user_id` / `reviewer_user_id` | Cross-user if used; **no classroom UI** currently wires them. |
| **Attendance / roster** | — | **No such entities** in domain or UI. |

### Can a fictional student be created without inviting / emailing? Join code / invite / notification?

1. **Workspace free-text `studentId`** (submission / quiz-submit / todo "View as student id") — **Yes, fictional labels work** without inviting anyone. Default is the caller's own `userId`. Prefer labels like `QA-student-alpha` — **never** paste a real Concord user id.
2. **SQLite `enrol` with blank studentUserId** — self-enrol only (joins **caller** to the cohort). No email, SMS, push, or join-code generator in this code.
3. **SQLite `enrol` with a non-blank `studentUserId`** — teacher-only path that inserts **another real user id** into `classroom_enrolments` (`server.js:94678–94689`). UI placeholder: "Student id (optional, self if blank)" (`page.tsx:309–311`). **This is an invite/enrol-of-another-user path → BLOCKED-by-policy.** No notification fan-out found, but the enrolment row still attaches another account to the cohort.
4. **No join-code, invite email, or notification macros** in `classroom.js` or the Phase 9.6 classroom block.

### Do grade / student records touch other users' data or PHI/FERPA-like content?

- Workspace grades/submissions live only under the **teacher account's Maps**. They do **not** read another user's private lens state. Using fictional `studentId` labels keeps QA data owner-private.
- Putting a **real** other-user id into `studentId` / enrol / peer_review would create educational-record-shaped rows tied to that person → treat as FERPA-like risk → **BLOCKED**.
- No clinical/PHI fields in this domain (no DOB, SSN, health). Still: grades are sensitive educational records — fictional QA names only; no real student/patient data (standing rules).

### Is `_lensEmitDTU` (FIX-xl-ws-001) or any global broadcast fired?

**No** on domain workspace macros or Phase 9.6 cohort macros. **Prefer skip** Library `SaveAsDtuButton` and header `DTUExportButton` / LensShell Mint-Publish (generic DTU mint → FIX-xl-ws-001 risk). `announce` writes only to the owner's `stream` Map — not a WS broadcast.

### Paid / GPU / generation?

**None** on classroom macros. Open Library is free public HTTP. No billing, credit, Workers AI, Ollama, LLM, agent-deploy, or code-exec in `classroom.js`. Stop if any cost UI appears on adjacent LensShell Ask.

## Delete paths (creates KEEP_BLOCKED?)

| Type | Delete / reverse | Verdict |
|------|------------------|---------|
| **Cohort** | `archive_cohort` soft-sets `status='archived'` (teacher only). **No hard DELETE** of the row. Enrolments / homework rows are **not** cascaded. | Creates **allowed** if archived at end (list hides archived). Residual archived row remains — note leftover; not KEEP_BLOCKED for cleanup of Teaching list. |
| **Own enrolment** | `leave_cohort` deletes caller's enrolment row | OK cleanup after self-enrol |
| **Other-user enrolment** | No teacher "unenrol student" macro | Do not enrol others |
| **Assignment** | `assignment-delete` — splices owner list only; **does not** cascade submissions/grades | Create+delete OK if **no** submissions attached |
| **Material** | `material-delete` | Create+delete OK |
| **Quiz** | **No `quiz-delete`** | **KEEP_BLOCKED** |
| **Submission** | **No delete** | **KEEP_BLOCKED** (or residual if created) |
| **Grade** | No delete; re-grade overwrites same `submissionId` | Prefer skip standalone; only against an allowed submission if any |
| **Stream / announce** | **No delete** | Prefer skip / residual |
| **Quiz attempt** | **No delete** | KEEP_BLOCKED with quiz-submit |
| **Homework / peer_review** | No delete macros; no UI | BLOCKED |

## Misleading / adjacent CTAs

- **Enrol + Student id** → looks like adding a fake roster name; non-blank values enrol a **real user id** when teacher — **BLOCKED**.
- **Self-enrol into a cohort id you do not teach** → joins someone else's class — **BLOCKED**.
- **Announce "Share something with the class…"** → owner-private stream only (wording oversells); still undeletable → prefer skip.
- **Library Save as DTU** / header Export / LensShell Publish-share / Ask / Mint — standing rules; prefer skip DTU mints.
- **Submit work + Student id** on an assignment → free-text label into owner Map (not SQLite enrol). Fictional OK in principle, but **no submission-delete** → KEEP_BLOCKED / prefer skip.
- **Take quiz** → `quiz-submit` persists undeletable attempt → KEEP_BLOCKED with quiz-create.

## Verdict table — classroom actions (user-visible)

| Action | Bucket | Delete / reverse | Side effects | Verdict |
|--------|--------|------------------|--------------|---------|
| **list_cohorts / ol-search / ol-work / ol-subject / ol-isbn / assignment-list / submission-list / gradebook / stream-list / material-list / todo / quiz-list / quiz-get / quiz-attempts** | read | n/a | Owner-scoped or public OL catalog | **SAFE_READ** |
| **create_cohort** (name `QA LT3 classroom 2026-11-09 …`) | **(a) SAFE private** (teacher=self) | **Archive** (soft) | SQLite row; sequential id | **SAFE_PRIVATE** (archive at end) |
| **enrol blank studentUserId into OWN active QA cohort** | **(a)** self | **leave_cohort** | Enrolment row for QA account only | **SAFE_PRIVATE** |
| **enrol non-blank studentUserId (other user)** | **(d) cross-user enrol** | no teacher unenrol | Attaches another account | **BLOCKED-by-policy** |
| **enrol into non-owned cohort id** | **(d)** | leave | Joins another's class | **BLOCKED-by-policy** |
| **archive_cohort / leave_cohort** (own) | **(e)** own cleanup | n/a | Soft archive / delete own enrolment | **OK as cleanup** |
| **assignment-create → assignment-delete** | **(a)** | Yes (no confirm) | Owner Map; status always `published` (label only — not a social publish) | **SAFE_PRIVATE_DELETABLE** |
| **material-add → material-delete** | **(a)** | Yes (no confirm) | Owner Map | **SAFE_PRIVATE_DELETABLE** |
| **announce** | **(a)** residual | **No delete** | Owner stream only | **Prefer skip** |
| **submission-create / grade-submission / quiz-create / quiz-submit** | **(a)** but undeletable | **No delete** | Owner Maps; fictional studentId only | **KEEP_BLOCKED** |
| **submit_homework / peer_review** | **(d)** | none | Real user ids; no UI | **BLOCKED** (if found) |
| **SaveAsDtu / DTUExport / LensShell Mint-Publish** | DTU / export | library delete if available | FIX-xl-ws-001 risk | **Prefer skip** |

### Paid / GPU / credits

**None found** on classroom macros or ClassroomWorkspace. Open Library = free public API. Stop if cost UI appears on Ask.

## Private AND deletable (qualify for a single QA write)

| Qualify | Notes |
|---------|-------|
| **create_cohort → archive** | Name `QA LT3 classroom 2026-11-09 <thing>` → Create → select as active → optional workspace reads → **Archive**. Preferred cohort fixture. |
| **Self-enrol into that own cohort → leave** | Leave blank student id; cohort id = own Teaching id only. Then Leave before/after archive. |
| **assignment-create → (no submissions) → assignment-delete** | Against active own cohort id. Reload persistence check. |
| **material-add → material-delete** | Against same cohort. |
| **Open Library search / work / subject / isbn** | Read-only OK. Do not SaveAsDtu. |
| **gradebook / todo / stream-list / quiz-list reads** | Read-only OK (empty or after allowed creates). |

## Keep BLOCKED / do not write

1. **Enrol with a non-blank Student id** — enrols another real user (`server.js:94678–94689`; UI `page.tsx:309–311`).
2. **Enrol into any cohort you do not teach** — cross-user class join.
3. **quiz-create / quiz-submit / Take quiz** — no `quiz-delete` / attempt-delete → **KEEP_BLOCKED**.
4. **submission-create / Submit work** (even with fictional studentId) — no submission-delete → **KEEP_BLOCKED**.
5. **announce** — no stream delete → prefer skip.
6. **submit_homework / peer_review** — cross-user educational records; no UI but macros exist → BLOCKED.
7. **SaveAsDtu** (Library) / header Export / LensShell Publish-share / emails / SMS / payments / agent deploy / paid Ask — standing rules.
8. Do **not** type real student names, emails, or other users' Concord ids into any student/enrol field.
9. Do **not** rely on archive to erase enrolments of others if anyone already enrolled them — only self leave + own archive.

## Validation / form test hints

- **create_cohort:** name required (`missing_name`); **no max length / min length** server-side beyond truthy — try blank (UI disables Create when `!createForm.name`), whitespace-only, very long name, optional `rubricDtuId` garbage.
- **enrol:** cohortId required; missing/inactive cohort → `cohort_not_found` / `cohort_inactive`; non-teacher enrolling other → `not_teacher` (do not live-test the success path with a real other id).
- **assignment-create:** title required; cohortId must be finite; blank title rejected server-side; points clamped 0–1000 (`NaN` → 100); instructions sliced 4000; UI requires `cohortId != null` locally.
- **material-add:** title + finite cohortId; kind enum `link|book|dtu|file|note` else `link`.
- **grade-submission:** score clamped 0..maxPoints; missing submissionId / unknown sub → error.
- **quiz-create:** ≥1 question; MC needs ≥2 options; empty prompt rejected; answers stripped on list/get.
- **ol-isbn:** must be 10 or 13 digits after strip; **ol-work:** `/^OL\d+W$/`.
- **RC1:** type cohort name / assignment title / announce text — watch bare **`n`** stealing to focus create; digits **`1`/`2`/`3`** jumping views (points fields, cohort id).
- **RC2:** not present.
- **Escape / focus:** no dialogs with role=dialog in this file set; Archive/Leave/Delete are immediate — ticket missing confirm + missing Escape patterns on any future modals.
- Persistence: create cohort → hard reload → still in Teaching; archive → gone from Teaching list. assignment-create → reload → list; delete → gone.
- Mobile 390×844: three view pills + floating "Create a cohort" FAB (`page.tsx:357–361`) + workspace tab strip — expect FAB/nav crowding and clipped tabs (same class as Foundry).

## Gaps / notes

- Dual plane is easy to confuse: SQLite cohort "students" ≠ workspace free-text `studentId` labels.
- `assignment.status = "published"` is a **local status string**, not a social/LENS_SOCIAL publish and not `_lensEmitDTU`.
- `assignment-delete` orphans any submissions/grades left behind — another reason submissions are KEEP_BLOCKED.
- Sequential cohort ids + open self-enrol = enumeration risk (product issue for builders; for QA: only use ids from your Teaching list).
- No attendance / roster / invite-code / email paths to test (criteria exclusion matches absence).
- `submit_homework` / `peer_review` are dead UI surface for this lens today — still BLOCKED if a future chrome exposes them.
- Live not proven: whether QA account already has archived cohorts; whether `classroomLens` snapshot is present in production for this user.

## Summary for tester

**OK for one QA call + cleanup** (title `QA LT3 classroom 2026-11-09 …`):
- **Create cohort** → select it → **assignment-create** (no submissions) → reload → **assignment-delete** → **material-add** → **material-delete** → optional **self-enrol** (blank student id) → **Leave** → **Archive** cohort.
- Reads: list_cohorts, gradebook/todo/stream empty or post-create, Open Library search (no SaveAsDtu).

**BLOCKED-by-policy / KEEP_BLOCKED:** enrol other users; enrol into non-owned cohorts; quiz-create / quiz-submit; submission-create / Submit work; announce (prefer); submit_homework / peer_review; SaveAsDtu / Export mint (prefer).

**No paid/GPU/credit actions** on this lens. **RC1: bare `n` + digits `1`/`2`/`3`.** **RC2 not present.** **Delete path exists for cohorts (archive), assignments, materials, own enrolment** → those creates allowed. **Quizzes / submissions / stream / attempts have no delete** → KEEP_BLOCKED.

**FERPA-shaped caution:** grades are educational records; keep all student labels fictional and owner-scoped; never enrol or grade a real other user.

Code-only verdict; not live-proven.
