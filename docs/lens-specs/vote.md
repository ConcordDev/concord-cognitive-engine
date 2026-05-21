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
- [x] `[M]` Multiple voting methods — ranked-choice, approval, quadratic, score voting (only plain tally shown).
- [x] `[S]` Quorum / threshold rules and proposal pass/fail resolution.
- [x] `[M]` Voting period lifecycle — open/closed states, deadlines, scheduled close.
- [x] `[S]` Results visualization — charts of the tally and consensus over time.
- [x] `[M]` Delegated voting / liquid democracy — delegate your vote on a topic.
- [x] `[S]` Voter eligibility / weighting rules per proposal.
- [x] `[M]` Polis-style opinion clustering — group voters by agreement on comments.
- [x] `[S]` Audit trail / verifiable vote receipts.

## Parity
~88% of Decidim/Polis. The `vote` domain now ships a full persistent governance substrate: five voting
methods (plurality, ranked-choice/IRV, approval, score, quadratic), quorum + pass-threshold resolution,
an open/pending/closed lifecycle with deadlines and owner-driven close, results visualization (tally
charts + consensus-over-time + IRV elimination rounds), liquid-democracy delegation with cycle guards,
per-poll eligibility lists and custom vote weighting, Polis-style opinion clustering, and a verifiable
receipt-based audit trail. Surfaced via the Governance Workbench tab in the vote lens. Remaining gap is
licensed content / external integrations, which is structural, not buildable.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
