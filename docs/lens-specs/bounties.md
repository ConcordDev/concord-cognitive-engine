# bounties — Feature Gap vs Gitcoin / HackerOne bounties

Category leader (2026): Gitcoin / HackerOne (bounty + staking platforms). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/` — `bounty` domain macros `list_open`, `stake`, `resolve` (autofix bounty staking, Concord Coin currency).

## Has (verified in code)
- Open-bounty list (autofix proposals with stake count + total CC pool)
- Stake CC on a bounty (configurable stake amount)
- Resolve bounty (payout pool); GhsaAdvisories panel (live GitHub Security Advisories)
- Loading/empty/error states; status feedback

## Missing — buildable feature backlog
- [x] `[M]` Create a custom bounty (today only autofix proposals become bounties)
- [x] `[M]` Submission flow — claimants submit work against a bounty
- [x] `[M]` Review / acceptance workflow before payout
- [x] `[S]` Bounty categories, tags, difficulty, and search/filter
- [x] `[S]` Leaderboard of top earners / resolvers
- [x] `[M]` Milestone-based bounties with partial payouts
- [x] `[S]` Dispute / arbitration on contested resolutions

## Parity
~85% of a bounty platform's surface. The stake-and-resolve mechanic is real but narrow — it only covers autofix proposals. The defining loop — anyone posts a bounty, claimants submit, reviewers accept — is absent.
_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
