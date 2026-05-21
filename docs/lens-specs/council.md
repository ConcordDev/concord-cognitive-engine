# council — Feature Gap vs Loomio / Convene

Category leader (2026): Loomio (collaborative governance) + Convene (board management). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: domain macros (`council.deliberate/voteCount/generateMinutes/conflictResolution`); generic `/api/lens` artifact store across 6 types; GovernanceVotingPanel + CouncilTheaterPanel.

## Has (verified in code)
- 6 artifact types: proposals, budgets, stakeholders, committees, audits, debates
- Proposal CRUD with status filter; budget scenario modeling
- AI council: multi-persona deliberation, vote counting, auto-generated minutes, conflict resolution
- GovernanceVotingPanel (real proposal voting) + CouncilTheater (LLM persona debate) + CouncilVoices
- Audit log with category filter; committee + stakeholder tracking

## Missing — buildable feature backlog
- [ ] `[M]` Threaded discussion per proposal — comment threads with reactions before a vote
- [ ] `[M]` Multiple voting methods — ranked-choice, dot-voting, consensus/consent, quorum rules
- [ ] `[M]` Meeting agenda builder + scheduling — timed agenda items, attendance, RSVP
- [ ] `[S]` Motion lifecycle — formal move/second/amend/table parliamentary states
- [ ] `[M]` Action-item tracking from minutes — assign owners and due dates, carry forward
- [ ] `[S]` Document packet / board book — bundle attachments per meeting
- [ ] `[S]` Decision history + outcome audit — searchable archive of past resolutions

## Parity
~55% of Loomio's feature surface. The AI deliberation theater is a genuine differentiator and real voting works, but lacks threaded discussion, agenda/meeting scheduling, and action-item follow-through.
