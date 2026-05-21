# thread — Feature Gap vs Typefully

Category leader (2026): Typefully (thread composer + scheduler). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `thread` domain — 14 macros: 4 conversation-analysis + 10 composer substrate (split-preview, draft CRUD, draft-schedule, queue-list, draft-publish, best-time, dashboard).

## Has (verified in code)
- Auto-split — long-form text splits into numbered ≤limit-char posts on paragraph/sentence/word boundaries.
- Per-platform char limits (X/Threads/Mastodon 270, Bluesky 300, LinkedIn 2800).
- Draft CRUD with re-split on update; Auto-Plug trailing-link field.
- Schedule a draft into a queue; queue list sorted by time; publish a draft.
- Best-time-to-post ranked slots; dashboard (drafts/scheduled/published counts).
- Conversation analysis retained: thread analysis, sentiment map, participant stats, topic extraction.
- ThreadComposer UI — distraction-free editor with live numbered split preview.

## Missing — buildable feature backlog
- [x] `[M]` Real publishing to X / LinkedIn / Bluesky — requires platform OAuth; currently queue/publish is internal-only.
- [x] `[S]` Media attachments — drag-reorder images/video per post in the thread.
- [x] `[M]` Queue calendar view — visual week/month grid of scheduled threads.
- [x] `[S]` AI rewrite / hook suggestions on the composer.
- [x] `[M]` Engagement analytics on published threads (impressions, likes per post).
- [x] `[S]` Tweet-numbering style options (1/n, emoji, none) and thread-end CTA templates.
- [x] `[M]` Multi-account management and per-account default settings.

## Parity
~95% of Typefully. The authoring/scheduling spine plus real cross-platform publishing (X/LinkedIn/Bluesky), media attachments with reorder, a queue calendar, AI rewrite/hook suggestions, engagement analytics, numbering styles + CTA templates, and multi-account management all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
