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
- [ ] `[L]` Live multiplayer cursors + real-time co-editing (CRDT/OT)
- [ ] `[M]` Conflict-free concurrent edits (current edit model looks last-write)
- [ ] `[M]` Version history / restore previous state
- [ ] `[S]` @-mention in comments with notifications
- [ ] `[M]` Per-element commenting / threaded discussion pins
- [ ] `[S]` Follow-mode (follow another user's viewport)
- [ ] `[S]` Permission tiers (view / comment / edit) per invitee

## Parity
~44% of Figma's real-time-collaboration surface. Sessions, invites, comments, presence, and collaboration analytics are real, but the defining feature — live conflict-free multiplayer editing with cursors — is not implemented.
