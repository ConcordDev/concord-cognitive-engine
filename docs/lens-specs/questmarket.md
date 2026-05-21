# questmarket — Feature Gap vs Bountysource / gamified quest board

Category leader (2026): a gamified bounty/quest marketplace (Bountysource-style, plus achievement/guild systems from MMO platforms). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/questmarket.js` — 5 macros (balanceDifficulty, leaderboardRank, achievementUnlock, guildScore, rewardEconomics) over the generic artifact store.

## Has (verified in code)
- 6 tabs: quests, bounties, achievements, leaderboard, rewards, guilds
- Quest/bounty/achievement artifact CRUD via the generic `/api/lens` store
- Difficulty-balancing macro, leaderboard ranking, achievement unlock, guild scoring, reward-economics modeling

## Missing — buildable feature backlog
- [ ] `[M]` Quest accept → submit → verify flow — full lifecycle, not just artifact records
- [ ] `[M]` Bounty escrow + payout — lock CC on post, release on verified completion
- [ ] `[S]` Proof-of-completion submission — attach evidence/artifacts to a quest claim
- [ ] `[M]` Guild membership + shared quests — join a guild, contribute to guild objectives
- [ ] `[S]` Reputation / rank progression — persistent player rank from completed quests
- [ ] `[S]` Quest discovery + filtering — browse by reward, difficulty, tag
- [ ] `[S]` Achievement showcase — public profile of unlocked achievements

## Parity
~35% of a gamified quest marketplace. The 6-tab structure and game-balance macros (difficulty, leaderboard, guilds, reward economics) frame the concept well, but it lacks the accept→submit→verify lifecycle and bounty escrow that make a quest marketplace transactional.
