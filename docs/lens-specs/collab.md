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
- [x] `[L]` Live multiplayer cursors + real-time co-editing (CRDT/OT)
- [x] `[M]` Conflict-free concurrent edits (current edit model looks last-write)
- [x] `[M]` Version history / restore previous state
- [x] `[S]` @-mention in comments with notifications
- [x] `[M]` Per-element commenting / threaded discussion pins
- [x] `[S]` Follow-mode (follow another user's viewport)
- [x] `[S]` Permission tiers (view / comment / edit) per invitee

## Parity
~90% parity. Real-time-collaboration backbone shipped. The `CollabDocWorkspace` component
(mounted in `app/lenses/collab/page.tsx`) wires the full multiplayer co-editing
surface against the `collab` domain macros: shared documents with a conflict-free
CRDT op log (deterministic lamport+authorId total order so concurrent edits
converge), poll-based 1s sync, live multiplayer cursors + presence roster,
follow-mode, version-history snapshot/restore with a timeline, @-mention
threaded comments with per-element pins and mention/reply notifications, and
per-invitee view/comment/edit permission tiers. Sessions, invites, presence,
and collaboration analytics remain real. Contract tests:
`server/tests/collab-domain-parity.test.js` (24 cases).

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
