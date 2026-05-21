# vote — Feature Gap vs Polis / Decidim / Snapshot

Category leader (2026): Decidim / Polis / Snapshot (participatory governance & voting). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `vote` domain macros (`tallyVotes`, `fairnessCheck`, `consensusMeasure`) over proposal/comment artifacts.

## Has (verified in code)
- Two-tab surface: Proposals, Dashboard.
- Proposal substrate with comments; proposal creation and discussion.
- Vote tallying macro (counts votes per option).
- Fairness check macro (detects skew / manipulation patterns).
- Consensus measurement macro (degree of agreement across voters).

## Missing — buildable feature backlog
- [ ] `[M]` Multiple voting methods — ranked-choice, approval, quadratic, score voting (only plain tally shown).
- [ ] `[S]` Quorum / threshold rules and proposal pass/fail resolution.
- [ ] `[M]` Voting period lifecycle — open/closed states, deadlines, scheduled close.
- [ ] `[S]` Results visualization — charts of the tally and consensus over time.
- [ ] `[M]` Delegated voting / liquid democracy — delegate your vote on a topic.
- [ ] `[S]` Voter eligibility / weighting rules per proposal.
- [ ] `[M]` Polis-style opinion clustering — group voters by agreement on comments.
- [ ] `[S]` Audit trail / verifiable vote receipts.

## Parity
~40% of Decidim/Polis. Proposals, comments, and the three analysis macros (tally/fairness/consensus) are a real governance core, but it offers only one voting method, no quorum/lifecycle, no delegation, and no results visualization.
