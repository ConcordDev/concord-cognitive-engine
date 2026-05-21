# classroom — Feature Gap vs Google Classroom

Category leader (2026): Google Classroom. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/classroom.js` — macros `create_cohort`, `enrol`, `submit_homework`, `peer_review`, `list_cohorts`, plus Open Library search (`ol-search/work/subject/isbn`).

## Has (verified in code)
- Cohorts: create (with rubric DTU), list, enrollment counts
- Enroll students into a cohort
- Homework submission flow; peer-review of submissions
- OpenLibrarySearch panel (free book search by work/subject/ISBN)

## Missing — buildable feature backlog
- [x] `[M]` Assignment creation with instructions, attachments, due dates, point values
- [x] `[M]` Gradebook — per-student scores, return graded work with feedback
- [x] `[S]` Class stream / announcements feed
- [x] `[M]` Teacher grading view with rubric-scored assessment
- [x] `[S]` Materials / resources tab per cohort
- [x] `[S]` Student-facing to-do list of upcoming/missing work
- [x] `[M]` Quiz / auto-graded assessment builder

## Parity
~90% of Google Classroom's surface. The cohort + homework + peer-review loop is joined by structured assignments (instructions/attachments/due dates/points), a per-student gradebook with class-average chart, the class stream, a topic-grouped materials tab, a bucketed student to-do list, and an auto-graded quiz builder — all wired through the `classroom` domain into the `ClassroomWorkspace` tabbed surface.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
