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
- [ ] `[M]` Mentor directory / discovery — browse mentors by skill, availability, rating
- [ ] `[M]` Request → accept matching flow — mentee sends request, mentor accepts/declines
- [ ] `[M]` Session scheduling — book sessions with calendar, reminders, video-link
- [ ] `[S]` Session notes & action items per meeting
- [ ] `[M]` Goal tracking workspace — shared goals with check-ins and progress updates
- [ ] `[S]` Mentor reviews & ratings surfaced on profiles
- [ ] `[M]` Program admin view — cohort tracking, match-quality reporting (MentorcliQ core)
- [ ] `[S]` Messaging between mentor and mentee

## Parity
~40% of a mentoring platform. The analytics (match score, progress, feedback, development plan) are real, but missing mentor discovery, the request/accept matching flow, scheduling, and shared goal workspaces that make mentorship actionable rather than recorded.
