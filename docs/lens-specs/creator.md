# creator — Feature Gap vs YouTube Studio / Patreon

Category leader (2026): YouTube Studio + Patreon (creator monetization dashboards). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `creator` domain macros (dashboard, royalty-summary, platform CRUD, content add/list/update/advance/delete, audience log/history/summary, revenue add/list/summary, content-calendar, creator-goal-set/status) + REST routes (/api/creator/*, /api/economy/withdraw, /api/marketplace/listings, /api/social/profile).

## Has (verified in code)
- 5-tab workspace: Overview, Listings, Profile, Followers, Cascade
- Overview dashboard: earnings, top-cited DTUs, royalty summary, influence metrics; creator leaderboard
- Multi-platform tracking (platform add/list/delete); content pipeline with advance-stage workflow
- Audience tracking with history + summary; revenue add/list/summary
- Content calendar; creator goal-set + status (milestone tracking)
- Listings management: edit price, withdraw, relist, tier pricing (usage/remix/commercial)
- Withdrawal flow with 48h hold status; royalty cascade visualization; social profile + followers

## Missing — buildable feature backlog
- [ ] `[M]` Time-series revenue charts — earnings over days/weeks/months (data exists, needs charting)
- [ ] `[M]` Per-artifact content performance — views, conversion, citation rate per DTU
- [ ] `[M]` Audience demographics — who buys/cites with geographic/segment breakdown
- [ ] `[M]` Membership tiers / recurring subscriptions — Patreon-style supporter tiers
- [ ] `[S]` Payout history ledger — itemized list of past withdrawals
- [ ] `[S]` Scheduled publishing — queue artifacts for timed release
- [ ] `[S]` Comment/community management surface

## Parity
~60% of a YouTube Studio+Patreon composite. Genuinely strong monetization, royalty-cascade, content pipeline, and goal tracking; lacks time-series charts, per-artifact analytics, and recurring-membership monetization.
