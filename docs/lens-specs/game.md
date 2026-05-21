# game — Feature Gap vs Habitica / gamification platforms

Category leader (2026): Habitica (gamified self-improvement) — the page is a gamification dashboard. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `game` domain has only 4 design-utility macros (balanceCheck, economySimulate, levelCurve, dropRateCalc); the player-facing dashboard is wired to platform skill/quest/achievement/economy systems + TriviaPanel.

## Has (verified in code)
- Player dashboard with XP, skills tree (production/theory/engineering/performance branches)
- Quests (available/accepted/completed), achievements with rarity tiers + progress
- Leaderboard (weekly/monthly/all-time), shop with lock/unlock items, history
- Minigame (trivia panel); game-feed; game-economy balance/level-curve/drop-rate design tools

## Missing — buildable feature backlog
- [ ] `[M]` Daily habits / dailies / to-dos that feed XP (Habitica's core loop)
- [ ] `[S]` Streaks + habit chains with loss penalties
- [ ] `[M]` Parties / guilds with shared quests and accountability
- [ ] `[S]` Avatar customization with purchasable cosmetics
- [ ] `[M]` Custom user-defined rewards + reward-redemption economy
- [ ] `[S]` Reminders / scheduled notifications for tasks
- [ ] `[S]` Challenges joinable across users with shared leaderboards

## Parity
~50% of Habitica's feature surface. The XP/skills/quests/achievements/leaderboard/shop scaffold is real, but it lacks the habit-tracking loop (dailies, streaks, custom rewards) and the social party mechanic that make Habitica a behavior-change tool rather than a stats screen.
