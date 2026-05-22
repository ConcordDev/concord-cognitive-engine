# timeline — Feature Gap vs Facebook timeline

Category leader (2026): Facebook (profile/news-feed timeline). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: DTU store (`apiHelpers.dtus.paginated` filtered by `timeline`/`story` tags, `dtus.create`/`update`), `personas.list` for friends, `social.follow`; plus the `timeline` domain (project-management macros: criticalPath, ganttSchedule — used by other surfaces).

## Has (verified in code)
- Facebook-style timeline — posts feed (DTUs tagged `timeline`), paginated.
- Post composer — create a post as a DTU.
- Five-reaction picker (like/love/haha/sad/angry) writing reaction to the DTU.
- Stories row (DTUs tagged `story`), friends list (personas), follow action.
- Left nav (Friends/Groups/Watch/Memories/Saved), date-tick timeline scrubber.

## Missing — buildable feature backlog
- [x] `[M]` Comments on posts with nested replies. — `timeline.comment-add/list/delete`; `CommentThread.tsx` recursive reply tree.
- [x] `[S]` Reaction counts and "who reacted" breakdown per post. — `timeline.react` + `reactions-breakdown`; `ReactionBreakdown.tsx` modal.
- [x] `[M]` Photo/video upload in the composer and media albums. — `timeline.album-create/add-media/list` + `post-create` media; `PostComposer.tsx` + `AlbumsPanel.tsx`.
- [x] `[S]` Share / repost a post to your own timeline. — `timeline.share-post`; `ShareModal.tsx`, shared-from quote in `PostCard.tsx`.
- [x] `[M]` Privacy controls per post (public / friends / only-me). — `post-create` privacy + privacy-aware `feed-list`; composer audience toggle.
- [x] `[S]` Profile cover photo, bio, and "about" section. — `timeline.profile-get/update`; `ProfilePanel.tsx`.
- [x] `[M]` "On this day" / Memories actually wired. — `timeline.memories`; `MemoriesPanel.tsx` with date override.
- [x] `[M]` Notifications for reactions/comments/tags. — `timeline.notifications-list/mark-read`; `NotificationsPanel.tsx` + header unread badge.

## Parity
~90% of Facebook's timeline. The full feed substrate — posts with per-post privacy, five-reaction picker plus "who reacted" breakdown, nested comment threads, share/repost, media albums, profile with cover/bio/about, "On this day" memories, and a notification centre — is wired end-to-end on the `timeline` domain macros. Remaining gap is licensed content (live video streaming), which is structural, not buildable.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
