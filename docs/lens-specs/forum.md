# forum — Feature Gap vs Reddit / Discourse

Category leader (2026): Reddit / Discourse. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `forum` domain — category CRUD, topic CRUD + pin/lock, post-reply, vote, tags, flag queue + resolve, user reputation, forum search, dashboard, thread/community-health/topic-clustering analytics.

## Has (verified in code)
- Categories + topics with create/list/get/delete, pin and lock
- Threaded replies, up/down voting, tags, full-text forum search
- Moderation: flag creation, flag queue, flag resolution, moderation-queue analytics
- User reputation system; community-health + topic-clustering + thread analytics
- Bookmarks, sort by trending/new/hot; ForumChatter live-discussion component

## Missing — buildable feature backlog
- [ ] `[M]` Nested comment trees with collapse/expand (replies appear flat)
- [ ] `[S]` Rich-text / markdown post editor with image embeds
- [ ] `[M]` User-created communities/subforums with per-community rules + mod teams
- [ ] `[S]` Notification + subscribe-to-thread system
- [ ] `[M]` Awards / badges given by users on posts
- [ ] `[S]` Saved posts, post history, user profile pages
- [ ] `[M]` Trending / personalized "hot" ranking algorithm across categories

## Parity
~60% of Reddit's feature surface. Categories, voting, tags, search, moderation, and reputation form a real forum, but it lacks nested comment trees, a rich editor, user-created communities, and subscription notifications — the structural Reddit/Discourse features.
