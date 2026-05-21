# classroom — Feature Gap vs Google Classroom

Category leader (2026): Google Classroom. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/classroom.js` — macros `create_cohort`, `enrol`, `submit_homework`, `peer_review`, `list_cohorts`, plus Open Library search (`ol-search/work/subject/isbn`).

## Has (verified in code)
- Cohorts: create (with rubric DTU), list, enrollment counts
- Enroll students into a cohort
- Homework submission flow; peer-review of submissions
- OpenLibrarySearch panel (free book search by work/subject/ISBN)

## Missing — buildable feature backlog
- [ ] `[M]` Assignment creation with instructions, attachments, due dates, point values
- [ ] `[M]` Gradebook — per-student scores, return graded work with feedback
- [ ] `[S]` Class stream / announcements feed
- [ ] `[M]` Teacher grading view with rubric-scored assessment
- [ ] `[S]` Materials / resources tab per cohort
- [ ] `[S]` Student-facing to-do list of upcoming/missing work
- [ ] `[M]` Quiz / auto-graded assessment builder

## Parity
~38% of Google Classroom's surface. The cohort + homework + peer-review loop is real and unusual, but the staples — structured assignments, a gradebook, the class stream, and quizzes — are missing.
