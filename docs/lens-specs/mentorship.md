# mentorship — Feature Gap vs MentorcliQ / ADPList

Category leader (2026): MentorcliQ (mentoring platform) / ADPList (mentor marketplace). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/mentorship.js` — 4 macros: matchScore, progressTrack, feedbackSummary, developmentPlan + generic `/api/lens` artifact store for mentorship records.

## Has (verified in code)
- Mentorship records — mentor/mentee, topic, status (seeking/matched/active/completed/paused), goals, frequency, sessions, skills, rating
- Match scoring — skill-overlap + availability + experience → compatibility grade
- Progress tracking — goal completion rate, sessions, hours, momentum
- Feedback summary — avg rating, top themes from session tags, satisfaction level
- Development plan — phased 26-week milestone roadmap from skill gaps
- MentorshipFeed, action panel, search

## Missing — buildable feature backlog
- [x] `[M]` Mentor directory / discovery — browse mentors by skill, availability, rating
- [x] `[M]` Request → accept matching flow — mentee sends request, mentor accepts/declines
- [x] `[M]` Session scheduling — book sessions with calendar, reminders, video-link
- [x] `[S]` Session notes & action items per meeting
- [x] `[M]` Goal tracking workspace — shared goals with check-ins and progress updates
- [x] `[S]` Mentor reviews & ratings surfaced on profiles
- [x] `[M]` Program admin view — cohort tracking, match-quality reporting (MentorcliQ core)
- [x] `[S]` Messaging between mentor and mentee

## Parity
~90%+ of a mentoring platform. Shipped full-stack: mentor directory/discovery with skill+rating filters and self-registration, request→accept matching flow, session scheduling with reminders/video-links, per-meeting notes & action items, a shared goal workspace with progress check-ins, mentor reviews surfaced on profiles, a MentorcliQ-style program/cohort report, and mentor↔mentee messaging — all backed by 21 `mentorship` domain macros and a purpose-built six-tab UI. The remaining gap is content volume (real mentor population fills via user signups by design).

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
