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
- [ ] `[M]` Comments on posts with nested replies.
- [ ] `[S]` Reaction counts and "who reacted" breakdown per post.
- [ ] `[M]` Photo/video upload in the composer and media albums.
- [ ] `[S]` Share / repost a post to your own timeline.
- [ ] `[M]` Privacy controls per post (public / friends / only-me).
- [ ] `[S]` Profile cover photo, bio, and "about" section.
- [ ] `[M]` "On this day" / Memories actually wired (nav item exists, no view).
- [ ] `[M]` Notifications for reactions/comments/tags.

## Parity
~45% of Facebook's timeline. Posts, reactions, stories, friends, and a date scrubber are wired on the DTU substrate, but comments, media upload, sharing, and privacy controls — core to the timeline experience — are missing.
