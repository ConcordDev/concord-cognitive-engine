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
- [x] `[M]` Time-series revenue charts — earnings over days/weeks/months (data exists, needs charting)
- [x] `[M]` Per-artifact content performance — views, conversion, citation rate per DTU
- [x] `[M]` Audience demographics — who buys/cites with geographic/segment breakdown
- [x] `[M]` Membership tiers / recurring subscriptions — Patreon-style supporter tiers
- [x] `[S]` Payout history ledger — itemized list of past withdrawals
- [x] `[S]` Scheduled publishing — queue artifacts for timed release
- [x] `[S]` Comment/community management surface

## Parity
~95% of a YouTube Studio+Patreon composite. Monetization, royalty-cascade, content pipeline, goal tracking plus time-series revenue charts, per-artifact performance, audience demographics, membership tiers/subscriptions, payout history, scheduled publishing, and comment/community management all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
