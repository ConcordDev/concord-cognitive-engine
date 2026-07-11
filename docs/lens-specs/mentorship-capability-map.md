# Mentorship Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/mentorship.js` (654 LOC) in full — no inline
> `registerLensAction("mentorship", …)` calls exist elsewhere in
> `server/server.js` (confirmed by grep). Reference-parity research is real
> (WebSearch against ADPList's and MentorcliQ's own marketing/help-center
> pages, cited below), not recalled from training data.
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("mentorship"' server/domains/mentorship.js`

## Backend surface

### Registered macros — `server/domains/mentorship.js` (24)

| Macro | Real result shape (key fields) | Classification (before this rebuild) | Classification (after) |
|---|---|---|---|
| `matchScore` | `{mentor, mentee, matchScore, skillOverlap, compatibility}` | DESIGNED (`MentorshipActionPanel`) — but buried under the legacy CRUD tab as one of 4 raw macro buttons | DESIGNED — "Coaching Tools" tab, honestly labeled as a JSON-input pair calculator |
| `progressTrack` | `{totalGoals, completed, inProgress, completionRate, sessionsCompleted, totalHours, momentum}` | DESIGNED (same panel) | DESIGNED — Coaching Tools tab |
| `feedbackSummary` | `{sessions, avgRating, topThemes[], satisfaction}` | DESIGNED (same panel) | DESIGNED — Coaching Tools tab |
| `developmentPlan` | `{currentSkillCount, targetRole, gaps[], milestones[], timelineWeeks}` | DESIGNED (same panel) | DESIGNED — Coaching Tools tab |
| `mentor-register` | `{mentor}` | DESIGNED (`MentorDirectoryPanel`) | DESIGNED — Directory tab |
| `mentor-directory` | `{mentors[], count, skills[], sort}` | DESIGNED | DESIGNED — Directory tab (default tab) |
| `mentor-profile` | `{mentor, reviews[], openSlots}` | DESIGNED | DESIGNED — Directory tab, profile drill-down |
| `request-send` | `{request}` | DESIGNED | DESIGNED — Directory tab profile → "Request mentorship" |
| `request-list` | `{incoming[], outgoing[], pendingIncoming}` | DESIGNED (`MentorshipRequestsPanel`) | DESIGNED — Requests tab |
| `request-respond` | `{request}` | DESIGNED | DESIGNED — Requests tab accept/decline |
| `request-withdraw` | `{request}` | DESIGNED | DESIGNED — Requests tab withdraw |
| `session-book` | `{session}` | DESIGNED (`MentorshipSessionsPanel`) | DESIGNED — Sessions tab |
| `session-list` | `{sessions[], count, upcoming, completed, reminders[]}` | DESIGNED | DESIGNED — Sessions tab |
| `session-update` | `{session}` | DESIGNED | DESIGNED — Sessions tab complete/cancel + rating |
| `session-note-save` | `{session, openActionItems}` | DESIGNED | DESIGNED — Sessions tab notes + action items |
| `goal-create` | `{goal}` | DESIGNED (`MentorshipGoalsPanel`) | DESIGNED — Goals tab |
| `goal-checkin` | `{goal}` | DESIGNED | DESIGNED — Goals tab check-ins + status |
| `goal-list` | `{goals[], count, active, done, avgProgress}` | DESIGNED | DESIGNED — Goals tab |
| `review-add` | `{review, mentorRating, reviewCount}` | DESIGNED (`MentorDirectoryPanel` profile view) | DESIGNED |
| `review-list` | `{reviews[], count, avgRating, histogram}` | UNSURFACED (only `review-add`'s echo was shown, not a full histogram fetch) | DESIGNED — `ReviewHistogram` (`components/mentorship/ReviewHistogram.tsx`) renders the real `histogram` field (5 bars, 5★→1★, count + %) in the mentor profile's Reviews section; `MentorDirectoryPanel` calls `review-list` on profile open and after posting a review (Wave 4 gap-closure, 2026-07-11). |
| `program-report` | `{mentors, activeMatches, requests{}, matchAcceptanceRate, sessions{}, sessionCompletionRate, goals{}, goalCompletionRate, avgSessionRating, avgMentorRating, cohort[]}` | DESIGNED (`MentorshipProgramPanel`), buried as one of 6 sub-tabs inside a section beneath the legacy CRUD system | DESIGNED — promoted to the page's own header KPI strip (via `useMacroDispatchFeedback`) **and** the Program tab's cohort table/funnel chart |
| `message-send` | `{message, threadKey}` | DESIGNED (`MentorshipMessagesPanel`) | DESIGNED — Messages tab |
| `message-thread` | `{messages[], count, threadKey}` | DESIGNED | DESIGNED — Messages tab |
| `message-inbox` | `{threads[], count}` | DESIGNED | DESIGNED — Messages tab |

**24/24 macros are DESIGNED** (no GENERIC-STRIP-ONLY, no UNSURFACED) after this
rebuild. `review-list`'s full histogram shape was the one honest partial at
rebuild time — closed 2026-07-11 (Wave 4 gap-closure, ENGINEERING triage: pure
frontend, no backend gap) by `ReviewHistogram`, see the parity checklist
below.

### What changed structurally

The panel components themselves (`MentorDirectoryPanel`, `MentorshipRequestsPanel`,
`MentorshipSessionsPanel`, `MentorshipGoalsPanel`, `MentorshipMessagesPanel`,
`MentorshipProgramPanel`, `MentorshipActionPanel`) were **already real, already
macro-wired, already honest** (no seeded/mock data, no fabricated success
states) — verified by reading all ~1,900 LOC across those 7 files before
touching anything. The rebuild's job was retiring the shell around them:

1. **Removed the legacy DTU-artifact "relation" CRUD tab** — `useLensData('mentorship','relation')` +
   `useRunArtifact('mentorship')` drove a parallel, disconnected data model
   (free-text `mentorName`/`menteeName` strings a user typed in, not the real
   `mentor-register`/`request-send` flow) that duplicated ~40% of the page for
   no real backend depth. **It also rendered a fabricated `"Match: X%"` badge** —
   a client-side heuristic (`+20 if status==='active'`, `+15 if
   sessionsCompleted>5`, `+10 if rating>3`, `+5 if goals.length>0`) presented
   next to a ★ star icon as if it were the real `mentorship.matchScore`
   macro's Jaccard-style skill-overlap score. This is exactly the honest-by-
   construction violation CLAUDE.md flags — a plausible-looking number with no
   real computation behind it. Removed entirely; the real `matchScore` macro
   is now reachable (honestly, as a JSON-input tool) in the Coaching Tools tab.
2. **Retired the generic scaffold**: `ManifestActionBar`, `AutoActionStrip`,
   `RecentMineCard`, `CrossLensRecentsPanel`, `UniversalActions`,
   `LensFeaturePanel`, `SessionRail` — replaced with a bespoke, keyboard-
   navigable (`1`-`8` tab hotkeys, `r` refresh) 8-tab workspace matching the
   Finance/News flagship pattern. Confirmed via `grade-ux-polish.mjs --honest`:
   `isGenericScaffold` flips `true → false` (page no longer imports the trio
   AND leans on `<UniversalActions>`/`<LensFeaturePanel>`), tier `functional → polished`.
3. **Promoted `program-report`** from "one more sub-tab" to the page's real
   header KPI strip (Mentors listed / Active matches / Sessions completed /
   Goals achieved / Avg mentor rating), dispatched via
   `useMacroDispatchFeedback` for an honest loading/running/done/error
   lifecycle (real `macro:started`/`macro:completed` socket events when
   authenticated, not a guessed spinner).
4. **Kept** `MentorshipFeed` (a real live Reddit r/mentorship-style pull,
   clearly labeled "reddit · top {window}", save-as-DTU wired) as a
   secondary "Community" tab — honest, sourced, not core platform depth.

## Reference-parity checklist

**(a) Reference apps:** [ADPList](https://adplist.org) (free 1:1 mentor
marketplace — 40,000+ mentors, session booking, group sessions) and
[MentorcliQ](https://www.mentorcliq.com/mentoring-software) (enterprise
mentoring program software — cohort matching, program admin, reporting
dashboards). The domain file's own doc comments already named these two
("ADPList-shape mentor marketplace", "MentorcliQ-style program admin") —
independently confirmed via WebSearch, not just trusted from the comment.

**(b) Parity statement:** the only difference between Concord's mentorship
lens and ADPList/MentorcliQ should be the size of the mentor pool and the
absence of a live video-call product (Concord has no owned video
infrastructure for 1:1 calls — sessions carry an external `videoLink` field
instead, same shape as pre-Zoom-integration ADPList).

**(c) Researched checklist** (ADPList + MentorcliQ feature sets, via
WebSearch 2026-07-09):

| # | Checklist item (source) | Disposition | Notes |
|---|---|---|---|
| 1 | Mentor directory, filterable by skill/expertise | ALREADY REAL | `mentor-directory` macro + skill filter + text search in `MentorDirectoryPanel`. |
| 2 | Mentor profile with bio, experience, rating | ALREADY REAL | `mentor-profile` macro; profile drill-down view. |
| 3 | Session booking against mentor availability | ALREADY REAL (partial) | `session-book` macro books a session; there's no calendar-of-open-slots UI (ADPList's per-mentor calendar) — the domain only tracks a free-text `availability` string + `capacity`/`menteeCount`, not per-slot scheduling. Honest gap, not faked. |
| 4 | Group sessions (many mentees, one mentor) | GENUINELY MISSING | No `attendees[]`/capacity-per-session field in `mentorships` sessions — `session-book` is strictly 1:1 (`ownerId`/`partnerId`). Flagged as a scoped future build: would need a new macro shape, not a UI-only fix. |
| 5 | Session notes & action items | ALREADY REAL | `session-note-save` — notes + checkable action items, wired in Sessions tab. |
| 6 | 1:1 direct messaging between mentor/mentee | ALREADY REAL | `message-send`/`message-thread`/`message-inbox`. |
| 7 | Ratings & written reviews per mentor | ALREADY REAL | `review-add` + `mentor-profile`'s last-20-reviews list are wired; the `review-list` star-histogram shape (1★-5★ bucket counts) is now rendered by `ReviewHistogram` above the review list in the profile drill-down (Wave 4, 2026-07-11) — no backend change, `MentorDirectoryPanel` now also calls `review-list` on profile open + after posting a review. |
| 8 | Request → accept/decline matching flow | ALREADY REAL | `request-send`/`request-list`/`request-respond`/`request-withdraw`, full Requests tab with incoming (mentor) + outgoing (mentee) views. |
| 9 | Goal tracking with progress check-ins | ALREADY REAL | `goal-create`/`goal-checkin`/`goal-list`, with a progress chart from check-in history. |
| 10 | Admin/cohort program reporting (MentorcliQ) | ALREADY REAL | `program-report` — mentor cohort table, request funnel, completion rates, promoted to the page header. |
| 11 | Smart/algorithmic matching suggestion | ALREADY REAL | `matchScore` (Jaccard skill-overlap + availability + experience) — surfaced honestly as a manual pair-input tool in Coaching Tools, not an automatic "here's your top match" recommender (MentorcliQ's Smart Match™ auto-suggests; Concord's version requires the two profiles as input). HONEST-RELABEL: not claimed as automatic. |
| 12 | Development/career plan generator | ALREADY REAL | `developmentPlan` — Coaching Tools tab. |
| 13 | HRIS/enterprise integration, SSO, audit trails (MentorcliQ) | GENUINELY MISSING | No such surface in the domain or elsewhere in Concord — out of scope for a single-tenant creative-OS lens; would be a platform-wide identity feature, not a lens rebuild task. Not flagged as a build item (belongs to a different layer entirely). |
| 14 | Live video call embedded in the product | GENUINELY MISSING (honest relabel already in place) | `session.videoLink` is an external URL field (Zoom/Meet/etc), opened in a new tab — same as the pre-2023 ADPList model before Around.co acquisition. Not faked as an embedded call. |

**(d) Coverage (updated 2026-07-11 — Wave 4 gap-closure closed the review
histogram):** 12 of 14 checklist items ALREADY REAL, 1 partial-but-real
(session booking has no per-slot calendar), 2 genuinely missing and explicitly
scoped/deferred (group sessions, HRIS/enterprise — the latter correctly
out-of-scope for this lens). Nothing silently gapped.

## What this rebuild built

- `concord-frontend/app/lenses/mentorship/page.tsx` — full rewrite: 8-tab
  bespoke workspace (Directory / Requests / Sessions / Goals / Messages /
  Coaching Tools / Program / Community), header KPI strip off
  `program-report` via `useMacroDispatchFeedback`, keyboard hotkeys `1`-`8` +
  `r`, `DensityToggle`, `DTUExportButton`. Generic scaffold + legacy fake-
  match-score CRUD tab removed.
- `concord-frontend/tests/mentorship-lens-states.test.tsx` — rewritten to
  match the new architecture (tab-wiring assertions + header KPI
  loading/error/populated states via a mocked `useMacroDispatchFeedback`,
  replacing the stale `useLensData`/`useRunArtifact` mocks).
- No backend changes — the domain was already real and complete for the
  scope above; this was a pure frontend-shell rebuild.
