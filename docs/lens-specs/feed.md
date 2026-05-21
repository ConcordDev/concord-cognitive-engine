# feed — Feature Gap vs X (Twitter) / Bluesky

Category leader (2026): X / Bluesky (algorithmic social feed). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `feed` domain analytics macros (engagementScore, contentCalendar, audienceInsights, hashtagAnalysis) + rich REST `/api/social/*` (feed/foryou·following·explore, post, react, share, bookmark, comment, trending, topics).

## Has (verified in code)
- For-You / Following / Releases / Trending tabs; full nav (Home, Explore, Notifications, Messages, Bookmarks, Profile, Media)
- Post composer; like / share / bookmark / comment / delete actions
- Trending topics + trending creators; presence ("who's on the feed now")
- HnFrontPage component (HN-style ranked view); DTU embeds in posts
- Creator analytics — engagement score, content calendar, audience insights, hashtag analysis
- Marketplace product search + economy transfer inline; group suggestions

## Missing — buildable feature backlog
- [ ] `[M]` Real-time streaming feed updates (new-post injection without refresh)
- [ ] `[M]` Quote-post / repost-with-comment
- [ ] `[M]` Threaded reply trees (currently flat comments)
- [ ] `[S]` Polls in the post composer
- [ ] `[M]` Direct messages actually wired (nav item exists)
- [ ] `[S]` Lists / custom feeds (Bluesky-style user-curated timelines)
- [ ] `[S]` Mute / block / content filters
- [ ] `[M]` Media-rich posts — multi-image, video, alt-text

## Parity
~60% of X/Bluesky. The core post→react→comment→trend loop and creator analytics are genuinely built out; missing streaming updates, quote-posts, threaded replies, working DMs, and polls.
