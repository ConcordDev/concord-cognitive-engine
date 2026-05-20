# thread — Feature Completeness Spec

Rival app(s): Typefully, X/Twitter composer (2026)
Sources:
- https://typefully.com/ (distraction-free thread editor, auto-split into numbered posts, live preview, queue calendar, best-time-to-post, drafts, multi-platform X/Threads/LinkedIn/Bluesky/Mastodon)
- Web search 2026-05-20: Typefully auto-split long-form → numbered tweets, scheduling queue, AI suggestions, Auto-Plug, drag-reorder media

## Features

### Thread authoring
- [x] Auto-split — long-form text splits into ≤limit-char numbered posts on paragraph → sentence → word boundaries (macro: thread.split-preview)
- [x] Drafts — create (auto-split), list, detail, update (re-splits), delete (macro: thread.thread-draft / draft-list / draft-detail / draft-update / draft-delete)
- [x] Per-platform char limits — X/Threads/Mastodon 270, Bluesky 300, LinkedIn 2800
- [x] Auto-Plug — optional trailing link field on a draft

### Publishing workflow
- [x] Schedule a draft into the queue (macro: thread.draft-schedule)
- [x] Queue list — scheduled drafts sorted by time (macro: thread.queue-list)
- [x] Publish a draft (macro: thread.draft-publish)
- [x] Best-time-to-post — ranked posting slots (macro: thread.best-time)
- [x] Dashboard — drafts / scheduled / published / total posts (macro: thread.thread-dashboard)

### Conversation analysis (retained)
- [x] Thread analysis (macro: thread.threadAnalyze)
- [x] Sentiment map (macro: thread.sentimentMap)
- [x] Participant stats (macro: thread.participantStats)
- [x] Topic extraction (macro: thread.topicExtract)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Real publishing to X / LinkedIn / Bluesky | platform OAuth + posting APIs | per-platform char-limit splitting + a publish/queue workflow; the `message` lens carries cross-channel adapters |
| In-app engagement analytics | platform metrics APIs | best-time-to-post heuristic; thread-analysis macros score conversation quality |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/thread.js` clean. 14 macros
  (4 analysis + 10 composer substrate).
- 2026-05-20: Tests — `tests/thread-domain-parity.test.js` 11/11 green
  (split short-stays-one / long-splits-numbered under limit / draft CRUD +
  per-user scope + re-split on update / schedule + queue / invalid-date reject /
  publish + dashboard / best-time ranking / analysis intact).
- 2026-05-20: Frontend — new `ThreadComposer` (distraction-free editor with a
  live numbered split preview, drafts list, schedule queue, best-time hint)
  mounted in the thread lens page. `npx tsc --noEmit` exit 0.
