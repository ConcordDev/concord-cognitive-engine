# council — Feature Gap vs Loomio / Convene

Category leader (2026): Loomio (collaborative governance) + Convene (board management). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `council` domain macros (deliberate, voteCount, generateMinutes, conflictResolution) + REST routes (/api/council/voices, /propose-promotion, /vote, /proposals, /debate, /theater, /deliberate) + generic `/api/lens` store; GovernanceVotingPanel + CouncilTheaterPanel.

## Has (verified in code)
- 6-tab parliamentary workspace: Proposals, Voting, Debates, Budget, Audit, Stakeholders
- Proposal lifecycle (draft→discussion→voting→decided→implemented/rejected) with type taxonomy
- 5 voting methods declared (simple majority, supermajority, ranked-choice, approval, consent) + 6-point vote scale with block
- Amendment proposing/accept/reject; threaded discussion comments per proposal
- Debate tooling with points + LLM deliberation (CouncilTheater multi-persona)
- Budget item submit/approve/reject with expense allocation; committee + vote delegation
- AI council: deliberate, vote count, auto-generated minutes, conflict resolution; audit log

## Missing — buildable feature backlog
- [ ] `[M]` Meeting agenda builder + scheduling — timed agenda items, attendance, RSVP
- [ ] `[M]` Action-item tracking from minutes — assign owners and due dates, carry forward
- [ ] `[S]` Quorum enforcement — block tally when attendance below threshold
- [ ] `[S]` Document packet / board book — bundle attachments per meeting
- [ ] `[M]` Ranked-choice actual tabulation UI (method is declared but tally is simple-count)
- [ ] `[S]` Decision search/archive — full-text search past resolutions and outcomes

## Parity
~60% of a Loomio+Convene composite. The AI deliberation theater plus real proposal voting, amendments, and budget workflow are strong; main gaps are meeting/agenda scheduling and action-item follow-through.
