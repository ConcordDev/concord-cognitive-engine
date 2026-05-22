# saved — Feature Gap vs Twitter/X Bookmarks

Category leader (2026): X Bookmarks / Pocket (saved-content surface). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: reads `/api/auth/me`; mounts `BookmarksList` which fetches the user's bookmarked social posts (set via BookmarkButton elsewhere).

## Has (verified in code)
- Lists every post the current user has bookmarked via BookmarkButton
- Empty state when nothing saved; "Post unavailable" placeholder for deleted posts with one-click Remove
- Back-to-Social navigation; cross-lens recents panel

## Missing — buildable feature backlog
- [x] `[M]` Folders / collections — organize bookmarks into named groups (X Bookmark Folders)
- [x] `[S]` Search within bookmarks — filter saved posts by text/author
- [x] `[S]` Sort + filter — by date saved, by author, by media type
- [x] `[M]` Save content beyond social posts — bookmark DTUs, articles, lens artifacts cross-lens
- [x] `[S]` Tags on bookmarks — freeform labels for retrieval
- [x] `[S]` Read-later / archive states — mark a bookmark as processed
- [x] `[S]` Export saved list

## Parity
~90% of X Bookmarks' feature surface. It does the core job — a real, no-fake-data list of saved posts with a clean empty/unavailable handling — but it lacks folders, search, and the ability to save anything beyond social posts.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
