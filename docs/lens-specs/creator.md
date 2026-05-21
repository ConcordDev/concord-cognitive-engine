# creator — Feature Gap vs YouTube Studio / Patreon

Category leader (2026): YouTube Studio + Patreon (creator monetization dashboards). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: REST routes `/api/creator/{dashboard,leaderboard,trending-citations,influence-drift,listings,withdrawal-status,cascade/:id}`, `/api/economy/withdraw`, `/api/marketplace/listings/:id`, `/api/social/profile`.

## Has (verified in code)
- Overview dashboard: earnings, top-cited DTUs, influence metrics
- Creator leaderboard + trending citations + influence-drift analytics
- Listings management: edit price, withdraw, relist, tier pricing (usage/remix)
- Withdrawal flow with 48h hold status; royalty cascade visualization
- Social profile editing, followers/following; broadcast posting; KnowledgeEntrepreneur badge

## Missing — buildable feature backlog
- [ ] `[M]` Time-series revenue charts — earnings over days/weeks/months, not just totals
- [ ] `[M]` Audience analytics — who buys/cites, geographic and demographic breakdown
- [ ] `[M]` Content performance per artifact — views, conversion, citation rate per DTU
- [ ] `[S]` Payout history ledger — itemized list of past withdrawals
- [ ] `[M]` Membership tiers / subscriptions — recurring supporter tiers like Patreon
- [ ] `[S]` Goal tracking — earnings/follower milestones with progress
- [ ] `[S]` Scheduled publishing / drafts pipeline — queue artifacts for release

## Parity
~55% of YouTube Studio's feature surface. Genuinely strong monetization and royalty-cascade depth, but lacks time-series charts, per-artifact performance breakdowns, and recurring-membership monetization.
