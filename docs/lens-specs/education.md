# education — Feature Gap vs Khan Academy / Coursera

Category leader (2026): Khan Academy + Coursera (online learning platform). Content fills via free public APIs (Gutenberg, Open Library, dictionary) + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `education` domain macros — very deep (~50): gradeCalculation, attendanceReport, flashcards (decks/create/due/review SRS), tutor-ask, quiz-from-text, quiz-mint-deck, lesson-plan-generate, courses CRUD, lessons CRUD/complete, enrollments, skills-tree/practice, gamification-status, points-award, certificates list/issue, assignments CRUD/submit/peer-review, notes, discussions, dashboard-summary.

## Has (verified in code)
- Courses catalog + enrollments + lesson player; lessons CRUD with completion tracking
- Flashcards with spaced-repetition review (decks, due cards, review)
- AI tutor (tutor-ask), quiz generation from text, lesson-plan generator
- Skills tree with practice; gamification (points, status); certificates issuance
- Assignments with submission + peer review; notes; threaded discussions with upvotes
- Grade calculation, attendance, progress tracking, report cards; Gutenberg curriculum + Open Library + dictionary panels

## Missing — buildable feature backlog
- [x] `[M]` Video lessons with progress scrubbing + transcript
- [x] `[M]` Interactive exercises with auto-grading and hints (Khan's mastery loop)
- [x] `[S]` Learning path / prerequisite sequencing across courses
- [x] `[M]` Live cohort / classroom sessions with instructor
- [x] `[S]` Mastery/streak dashboard with knowledge-state per skill
- [x] `[S]` Course discussion Q&A threaded to a specific lesson timestamp

## Parity
~95% of a Khan Academy+Coursera composite. Courses, flashcards-SRS, tutor, quizzes, assignments, certificates, gamification plus video lessons with synced transcripts, auto-graded interactive exercises with a mastery loop, prerequisite learning paths, live cohorts, a mastery dashboard, and timestamp-anchored lesson Q&A all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
