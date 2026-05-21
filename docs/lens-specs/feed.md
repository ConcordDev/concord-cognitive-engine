# feed — Feature Gap vs X (Twitter) / Threads

Category leader (2026): X (Twitter) / Threads. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `feed` domain macros are analytics-only (engagementScore, contentCalendar, audienceInsights, hashtagAnalysis); the actual social feed runs on the platform timeline API + many `components/social/*` components; 2312-line page.

## Has (verified in code)
- Multi-tab feed (for-you / following / releases / trending) with virtualized infinite scroll
- Post composer with text/audio/release/art/collab post types; like/comment/repost/bookmark/share
- Stories bar, suggested follows, presence indicators, DMs, notification center, groups
- Trending topics, discovery, post scheduler, cross-post to external networks, streaks
- Provenance badges, vision analyze, report/flag, social-commerce tags, user profiles
- Engagement-score / content-calendar / audience-insights / hashtag analytics macros

## Missing — buildable feature backlog
- [ ] `[M]` Algorithmic ranked "For You" with a real recommendation model (tabs exist; ranking is shallow)
- [ ] `[S]` Quote-post / threaded reply trees with collapse
- [ ] `[M]` Lists / curated timelines and per-list feeds
- [ ] `[M]` Polls in the composer + live poll results
- [ ] `[S]` Bookmarks folders + saved-search alerts
- [ ] `[M]` Live audio rooms / Spaces from the feed
- [ ] `[S]` Content controls — mute words, sensitive-media filter, block

## Parity
~70% of X's feature surface. The social shell is unusually complete (stories, DMs, scheduling, cross-post, commerce), but it lacks a true ranking algorithm, threaded conversations, lists, and polls — structural features of a mature microblog.
