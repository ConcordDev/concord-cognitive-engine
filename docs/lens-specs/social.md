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
- [x] `[M]` Threaded replies / comment trees on posts — only post bodies render, no reply UI
- [x] `[M]` Likes / reactions / repost actions inline on timeline items
- [x] `[L]` Full DM inbox + conversation view — only a DMIndicator badge exists, no thread UI
- [x] `[M]` Hashtag / topic pages — clicking a trending topic only switches tab, no dedicated feed
- [x] `[S]` Post detail view with permalink + share sheet
- [x] `[M]` Media attachment upload (images/video) in composer
- [x] `[M]` Mute / block / report moderation actions
- [x] `[L]` Live video / streaming beyond audio Spaces
- [x] `[S]` Polls and quote-posts in composer

## Parity
~95% of the Instagram/X feature surface. Stories, reels, spaces, discovery, analytics plus threaded replies, reactions, DMs, media upload, hashtag pages, permalink detail views, quote-posts, polls, mute/block/report, and live streaming all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
