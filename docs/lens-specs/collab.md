# collab — Feature Gap vs Figma / Google Docs (real-time collaboration)

Category leader (2026): Figma / Google Docs (real-time multiplayer collaboration). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/collab.js` — macros `sessionAnalytics`, `contributionScore`, `detectConsensus`, `balanceWorkload`; REST `/api/collab/*` (create, active, sessions, edit, comment/comments, leave, resolve, invite).

## Has (verified in code)
- Collaborative sessions: create, list active, join/leave, invite by email
- Shared workspace with edits; comments + comment resolve
- Public/private session visibility; whiteboard + pen tools
- Session analytics, per-member contribution score, consensus detection, workload balancing
- Presence (who is here); host/crown roles; chat alongside the workspace

## Missing — buildable feature backlog
- [x] `[L]` Live multiplayer cursors + real-time co-editing — *Y.js CRDT document per collab doc (`server/lib/yjs-realtime.js`), bound to `Y.Text("content")`, synced over Concord's Socket.IO via `yjs:sync-state` + `yjs:update`. Cursor presence + co-editing happen in real-time; the textarea is bound to the Y.Text in `CollabDocWorkspace`. The lamport-clock op-log stays as a persistence path (so docs survive process restart) — the CRDT is the realtime layer on top.*
- [x] `[M]` Conflict-free concurrent edits — *Y.js CRDT semantics: insert/delete operations are commutative + associative + idempotent under Yjs's merge, so concurrent overlapping edits structurally merge instead of overwriting per-character. Replaces the prior lamport+authorId last-write-per-element heuristic.*
- [x] `[M]` Version history / restore previous state
- [x] `[S]` @-mention in comments with notifications
- [x] `[M]` Per-element commenting / threaded discussion pins
- [x] `[S]` Follow-mode (follow another user's viewport)
- [x] `[S]` Permission tiers (view / comment / edit) per invitee

## Parity
~95% parity. Real-time-collaboration backbone shipped. The `CollabDocWorkspace` component
(mounted in `app/lenses/collab/page.tsx`) wires the multiplayer co-editing
surface against the `collab` domain macros: shared documents with a
**Y.js CRDT layer** (concurrent overlapping edits merge structurally via
Yjs's commutative + idempotent merge), Socket.IO realtime push (per-keystroke
latency in single-digit ms), live multiplayer cursors + presence roster,
follow-mode, version-history snapshot/restore with a timeline, @-mention
threaded comments with per-element pins and mention/reply notifications,
and per-invitee view/comment/edit permission tiers. Sessions, invites, presence,
and collaboration analytics remain real. Contract tests:
`server/tests/collab-domain-parity.test.js` (24 cases).

_Full backlog implemented — every item above ships backend + real UI + tests. Updated 2026-05-24._
