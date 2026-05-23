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
- [x] `[L]` Live multiplayer cursors + real-time co-editing — *cursor presence + co-editing via the `collab` macros; after Phase 4, edits broadcast on a Socket.IO room (`collab:doc:${docId}`) so peers receive ops in real-time. Full CRDT/OT (Y.js / Automerge) is not yet integrated — see the conflict-free line below.*
- [x] `[M]` Conflict-free concurrent edits — *deterministic lamport+authorId total order ensures concurrent edits converge on the same final state, but the merge strategy is last-write per element rather than CRDT-style structural merge. True CRDT (Y.js / Automerge) is on the backlog (see `docs/FEATURE_UPGRADE_BACKLOG.md`) and would replace lamport-order with conflict-free merges of overlapping structural changes.*
- [x] `[M]` Version history / restore previous state
- [x] `[S]` @-mention in comments with notifications
- [x] `[M]` Per-element commenting / threaded discussion pins
- [x] `[S]` Follow-mode (follow another user's viewport)
- [x] `[S]` Permission tiers (view / comment / edit) per invitee

## Parity
~88% parity. Real-time-collaboration backbone shipped. The `CollabDocWorkspace` component
(mounted in `app/lenses/collab/page.tsx`) wires the multiplayer co-editing
surface against the `collab` domain macros: shared documents with a deterministic
lamport+authorId total-order op log (concurrent edits converge on the same final
state via last-write-per-element, not via CRDT structural merge), Socket.IO
realtime push after Phase 4 (previously 1s poll), live multiplayer cursors
+ presence roster, follow-mode, version-history snapshot/restore with a timeline,
@-mention threaded comments with per-element pins and mention/reply notifications,
and per-invitee view/comment/edit permission tiers. Sessions, invites, presence,
and collaboration analytics remain real. True CRDT-based conflict-free
merging (Y.js / Automerge) is the final gap to Figma's full surface; see
`docs/FEATURE_UPGRADE_BACKLOG.md`. Contract tests: `server/tests/collab-domain-parity.test.js` (24 cases).

_Backlog implemented except where prose explicitly flags a remaining gap (CRDT). Updated 2026-05-23._
