# social — Feature Gap vs Instagram / X (Twitter)

Category leader (2026): Instagram / X. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: REST routes (`/api/social/following-activity`, `/api/presence/active`, `/api/auth/me`) + ~18 social components (StoriesBar, Discovery, ReelsFeed, audio Spaces) backed by their own routes.

## Has (verified in code)
- For-You discovery feed, Following timeline (reverse-chron), Notifications center
- Stories bar (24h ephemeral), QuickPostComposer (post + story modes)
- Reels feed (short video), audio Spaces with WebRTC RoomStage (mic/hand/leave)
- Right rail: UserProfile, TrendingTopics, TrendingDomains, SuggestedFollows, live presence
- Bookmarks/Saved, CreatorAnalytics, streak + DM indicators, mobile tab bar

## Missing — buildable feature backlog
- [ ] `[M]` Threaded replies / comment trees on posts — only post bodies render, no reply UI
- [ ] `[M]` Likes / reactions / repost actions inline on timeline items
- [ ] `[L]` Full DM inbox + conversation view — only a DMIndicator badge exists, no thread UI
- [ ] `[M]` Hashtag / topic pages — clicking a trending topic only switches tab, no dedicated feed
- [ ] `[S]` Post detail view with permalink + share sheet
- [ ] `[M]` Media attachment upload (images/video) in composer
- [ ] `[M]` Mute / block / report moderation actions
- [ ] `[L]` Live video / streaming beyond audio Spaces
- [ ] `[S]` Polls and quote-posts in composer

## Parity
~60% of Instagram/X feature surface. Strong IA (stories, reels, spaces, discovery, analytics all wired) but core engagement loops — replies, reactions, DMs, media upload — are missing or stubbed.
