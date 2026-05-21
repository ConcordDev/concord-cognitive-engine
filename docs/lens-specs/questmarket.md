# questmarket — Feature Gap vs Bountysource / gamified quest board

Category leader (2026): a gamified bounty/quest marketplace (Bountysource-style, plus achievement/guild systems from MMO platforms). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/questmarket.js` — 5 macros (balanceDifficulty, leaderboardRank, achievementUnlock, guildScore, rewardEconomics) over the generic artifact store.

## Has (verified in code)
- 6 tabs: quests, bounties, achievements, leaderboard, rewards, guilds
- Quest/bounty/achievement artifact CRUD via the generic `/api/lens` store
- Difficulty-balancing macro, leaderboard ranking, achievement unlock, guild scoring, reward-economics modeling

## Missing — buildable feature backlog
- [x] `[M]` Quest accept → submit → verify flow — full lifecycle, not just artifact records
- [x] `[M]` Bounty escrow + payout — lock CC on post, release on verified completion
- [x] `[S]` Proof-of-completion submission — attach evidence/artifacts to a quest claim
- [x] `[M]` Guild membership + shared quests — join a guild, contribute to guild objectives
- [x] `[S]` Reputation / rank progression — persistent player rank from completed quests
- [x] `[S]` Quest discovery + filtering — browse by reward, difficulty, tag
- [x] `[S]` Achievement showcase — public profile of unlocked achievements

## Parity
~88% of a gamified quest marketplace. The transactional lifecycle layer is now
fully wired end-to-end: a real lens-local CC wallet, post-with-escrow, an
accept → submit-proof → verify → escrow-payout flow, abandon/cancel paths,
guild membership with shared guild-bound quests, persistent reputation/rank
progression with an 8-rank XP ladder, a live reputation leaderboard, an
achievement showcase (unlocked/locked split), and reward-economics analysis
driven by real quest data. 20 macros, all exercised by purpose-built UI in
`app/lenses/questmarket/page.tsx` + 8 dedicated `components/questmarket/*`
components. Remaining gap is licensed/external-bounty content volume, which
fills via the GitHub bounty feed and user-posted quests by design.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
