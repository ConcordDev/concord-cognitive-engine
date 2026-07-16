# Collab Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("collab"' server/domains/collab.js` → 25
> Unsurfaced check: `node scripts/lens-unsurfaced.mjs --lens collab` → `1/25 macros never referenced in the frontend` (`presenceState`; see below — a reasoned omission, not a gap).

## Reference apps + parity target

`collab.js` is genuinely **two real capabilities in one domain file**, so
this lens honestly needs two parity targets rather than one conflated
target:

1. **Figma/Notion/Google-Docs-style live co-editing** — the domain's
   flagship, backed by a real conflict-free op-log (lamport + authorId
   total order) *and* a real Yjs CRDT (`server/lib/yjs-realtime.js`,
   `Y.encodeStateAsUpdate`/`replaceDoc`), plus live multiplayer cursors,
   follow-mode, per-element threaded comments with @-mentions, tiered
   permissions (view/comment/edit), and @-mention notifications.
   Parity target: the only difference from Figma/Notion should be feature
   breadth (rich formatting, multi-cursor color-coding at scale), not
   whether co-editing/versioning/presence/comments are real.
2. **Discord/Teams-style session rooms** — a lighter, separate concept:
   browse/create/join a live multi-participant working session with group
   chat, shared notes, file drops, and screen share. Parity target: a
   session someone creates should be genuinely discoverable and joinable
   by other users, with real screen share / chat / notes underneath it —
   not a decorative shell around a scratchpad only the creator can ever see.

## Checklist — reference-app features vs. Concord collab

| Feature | Bucket | Disposition |
|---|---|---|
| Real-time co-editing via conflict-free op log (lamport+authorId total order) | ALREADY REAL | `docCreate`/`docState`/`docOp`/`docSync` — `CollabDocWorkspace` |
| Full-fidelity Yjs CRDT sync (structure/formatting survive exactly, not just text) | ALREADY REAL | `useYjsDoc` + `Y.Text` binding, socket push (`yjs:update`) with 5s poll backstop |
| Live multiplayer cursors + selections | ALREADY REAL | `cursorUpdate` heartbeats every 2s, rendered as colored presence chips |
| Follow-mode (lock your view to another user's cursor) | ALREADY REAL | `setFollow` — click a presence chip to follow/unfollow |
| Text-level version history (label, save, restore, auto-snapshot-before-restore) | ALREADY REAL | `docSnapshot`/`docHistory`/`docRestore` — Versions tab + `TimelineView` |
| Full-fidelity CRDT version history (exact Y.Doc structure, not just text) | ALREADY REAL | `docCrdtSnapshot`/`docCrdtSnapshotList`/`docCrdtRestore` — "Full-fidelity CRDT snapshots" sub-panel, already wired (this was mis-flagged stale in the Wave 3 backlog — see note below) |
| Tiered permissions (view/comment/edit), per-user + default-tier | ALREADY REAL | `setPermission`/`getPermissions` — Access tab |
| Threaded, per-element-pinned comments with @-mention parsing | ALREADY REAL | `addComment`/`listComments`/`resolveThread` — Comments tab |
| @-mention + reply notifications | ALREADY REAL | `notifications`/`markNotificationRead` — bell icon + dropdown |
| Read-only "who's viewing" roster without joining edit presence | **BACKEND-CAPABLE-BUT-UNSURFACED** | `presenceState` exists specifically for a passive observer that never heartbeats a cursor; `CollabDocWorkspace` legitimately doesn't need it (its own `docSync` response already carries the presence roster for anyone actively viewing). Genuinely optional — no dedicated read-only-observer surface exists yet to hang it on. Disposition: **scoped-deferred** (would need a new "peek without joining" affordance; not invented this pass). |
| Browsable/joinable multi-participant session directory (Active/Mine/Invitations/History) | was **fabricated-success** | Real, shared (`collab` is a `SOCIAL_DOMAINS` entry — cross-user visible by design), backend-persisted via the generic lens-artifact store — but **Create Session silently 404'd on every use** (see fixes below) and the grid could never be populated. **Fixed this rebuild.** |
| Session group chat, shared notes, file drops | was **cross-session bleed** | Real persistence (`useLensData`), but not scoped per-session — every session shared the exact same global chat/notes/files. **Fixed this rebuild** (tagged by session id). |
| Screen share (WebRTC) inside a session | ALREADY REAL | `getDisplayMedia` + manual RTCPeerConnection signaling over the existing socket room |
| Invite link | was **fabricated success** | Claimed "copied to clipboard" without ever calling the Clipboard API. **Fixed this rebuild.** |
| ~~Live participant join/leave with real roster sync~~ **CLOSED (2026-07-12, `7468a72b`)** | was GENUINELY MISSING | Sessions still have a static `participants` array set at creation (unchanged, still the wrong thing to read for "who's here"), but a session now also has a genuinely live joined set. `collab.sessionJoin` / `collab.sessionLeave` / `collab.sessionRoster` (`server/domains/collab.js`) track real per-user join/leave state in an in-memory `sessionRosters` map, validated against the real session artifact in `STATE.lensArtifacts` (rejects a `sessionId` that was never created). Join/leave broadcast `collab:participant-joined` / `collab:participant-left` to the `collab:${sessionId}` room — the same room the session's screen-share signaling already joins — so every other connected participant sees the roster change live, no poll required. Both events are registered in `server/lib/event-shapes.js`. On the frontend, entering `ActiveSessionView` (clicking "Join") now calls `collab.sessionJoin` on mount and `collab.sessionLeave` on unmount/Leave — real state, not just opening the socket room — and the Participants panel renders the live roster instead of the static array. Storage is intentionally in-memory, not a DB migration: unlike a persistent catalog, "who is currently connected" is inherently session-scoped and ephemeral (a restart drops every real socket connection too, so a surviving DB row would already be stale the instant the process comes back) — same reasoning as the pre-existing `presence` map for doc-cursor tracking in this same file. Regression tests: `server/tests/collab-domain-parity.test.js` (hermetic, 8 cases), `server/tests/depth/collab-behavior.test.js` (real-server-boot, 4 cases), `server/tests/collab-session-roster-event-shape.test.js` (event-shape pinning, 8 cases), `concord-frontend/tests/collab-lens-states.test.tsx` (3 new cases: Join calls the real macro + renders the returned roster, a genuine socket push live-updates the roster, Leave calls the real macro). |
| Targeted (to-a-specific-user) session invitations, Invitations-tab producer | ~~GENUINELY MISSING~~ **CLOSED (2026-07-16, `128f214b`)** | New `sessionInvite`/`sessionInviteRespond`/`sessionInviteList` macros in a dedicated `STATE.collabLens.invites` store, scoped per-caller on read (the generic cross-user artifact store the frontend previously targeted for the `invitation` type would have made a private 1:1 invite readable by any caller, since `collab` is listed in `LENS_SOCIAL_DOMAINS`). `sessionJoin` was refactored into a named `sessionJoinHandler` so `sessionInviteRespond`'s accept path calls the exact same join logic rather than duplicating it — accepting genuinely adds a tracked roster participant, not a flipped status flag. The `/api/collab/create`+`/accept`+`/close` `COLLAB_SESSIONS` pairwise substrate this row originally described turned out to be a genuinely unrelated feature (a DTU-search-scoping collaboration with no `sessionId` concept, reachable only as an HTTP route) — left untouched. The frontend's prior invitation click-through also targeted a third, also-unrelated `/api/shared-session/*` substrate that would 404 for any real collab invite — removed. |
| Team facilitation analytics (session balance, contribution scoring, consensus, workload) on real input | ALREADY REAL | `sessionAnalytics`/`contributionScore`/`detectConsensus`/`balanceWorkload` — `CollabActionPanel`'s structured row editors + real "Load DM"/"Load workspace" fetchers, DTU mint/publish, agent facilitator brief |
| DTU-comment collaboration workspaces (a third, separate substrate: threaded comments/revisions/edit-sessions on DTUs) | ALREADY REAL | `WorkspaceRoster` — polls `/api/collab/workspaces`, real |

## What this rebuild found and fixed

The domain has **three parallel, genuinely-real backend substrates** under
one `collab` name (the CRDT doc engine in `collab.js`; the generic
cross-user lens-artifact store the session tabs read from; the pairwise
`COLLAB_SESSIONS`/Artistry-project session systems). The CRDT substrate and
its UI (`CollabDocWorkspace`) were already excellent and needed nothing.
The session-directory half of the page had real defects:

1. **Create Session silently failed on the default path.** The mutation's
   *primary* call was `apiHelpers.artistry.collab.sessions.create({projectId: form.linkedProjectId || '', ...})` — the server 404s (`Project not found`) whenever no project is linked, which is the default/common case ("No linked project" is the pre-selected option). On failure, only `console.error` fired — no toast, no visible state change — so clicking the lens's primary CTA did nothing, with no explanation. Even when a project *was* linked and that call succeeded, the follow-up `POST /api/collab/create` (meant to register the session for the "Active Collaborations" panel) always failed too: its schema requires a non-empty `inviteeId`, and the modal always sent `''`. **Net effect: Create Session had never produced a visible result via any path.**
2. **`mySessions` and chat identity were hardcoded to a placeholder `'p-0'`/`'me'`/`'You'`** instead of the real authenticated user, so "My Sessions" could never match a real user and chat messages never carried a real sender.
3. **Chat / shared notes / shared files were not scoped per session** — all three reused the exact same `(domain, type)` lens-artifact bucket globally, so opening any two different sessions showed identical chat/notes/files (cross-session data bleed).
4. **The Invite button claimed "Invite link copied to clipboard" without calling the Clipboard API** — a specific, false, verifiable success claim.
5. **A redundant, structurally-broken "Collab Actions" panel duplicated `CollabActionPanel`.** It called `sessionAnalytics`/`contributionScore`/`detectConsensus`/`balanceWorkload` against `sessionItems[0]?.id ?? 'default'` — a phantom artifact whose `.data` shape (session metadata: name/host/participants/privacy) can never contain the `messages`/`contributions`/`votes`/`tasks` arrays these macros need, so it could only ever render "Track contributions to calculate scores." The already-shipped `CollabActionPanel` component (mounted lower on the same page) covers the identical 4 macros correctly, with structured row editors and real "Load DM"/"Load workspace" data sources — a textbook case of a generic scaffold shadowing a working designed feature.
6. **Dead fabrication debris**: an unused `NAMES` array + `_makePart()` demo-participant generator (never called; harmless but a lint/audit smell matching the pattern this program watches for).

### Fixes applied (`concord-frontend/app/lenses/collab/page.tsx`)

- `useAuth()` now supplies the real `userId`/`username`; `mySessions`,
  chat `senderId`/`senderName`, and the new host identity all use it.
  Added `avatarForUser(id)` — a deterministic per-user gradient (same
  hashing technique as the backend's `colorFor(userId)` in
  `server/domains/collab.js`) replacing the removed name/avatar generator.
- `CreateSessionModal` now creates the session directly through the real,
  shared, already-cross-user-visible lens-artifact store
  (`useLensData('collab','session',...).create`) — this is what the grid
  actually reads, so a created session is now genuinely discoverable.
  Linking an existing studio project is now **best-effort and
  non-blocking**: it opens a real Artistry jam session for that project
  when requested, but its failure never blocks or silently eats the
  primary session the user asked to create. The broken `inviteeId: ''`
  call was removed (wrong shape for this feature; was never anything but
  a guaranteed validation failure).
- `sessionItems`/`invitationItems`/`historyItems` now correctly merge the
  wrapping artifact's real `id` into `.data` (previously dropped, so a
  `CollabSession.id` was always `undefined`).
- Chat / shared-notes / shared-files in `ActiveSessionView` are now tagged
  and filtered by `session.id` (`tags` on read, `meta.tags` on write) so
  each session has its own isolated chat/notes/files instead of sharing
  one global bucket. The seeded placeholder note text was dropped in favor
  of a genuinely empty pad (was dev-only demo content that no longer made
  sense once notes are correctly per-session).
- "Leave" now does something real: the host's click updates the session's
  `status` to `closed` via the same generic artifact route (so it drops
  out of "Active Sessions" for everyone), and any guest's click just
  returns to the list — it no longer POSTs to a pairwise-invite endpoint
  that could never resolve to this session's id space.
- "Invite" now actually calls `navigator.clipboard.writeText()` with a
  real session link, and only shows success when the copy genuinely
  succeeds (an honest error toast, including the raw link, on failure).
- Removed the redundant, structurally-broken "Collab Actions" panel and
  its dead types/state (`useRunArtifact`, `ActionResult*` interfaces) —
  `CollabActionPanel` already covers the same 4 macros correctly.
- Removed the unused `NAMES` array and `_makePart()` generator.

## Left alone (already real, no changes made)

- `CollabDocWorkspace.tsx` — the CRDT doc workspace. Already wires all 25
  macros correctly, including `docCrdtSnapshot`/`docCrdtSnapshotList`/
  `docCrdtRestore` (the Wave-3 backlog's stale claim that these 3 were
  unsurfaced didn't hold up under a fresh `lens-unsurfaced.mjs` run —
  they're already called at lines 420–446 with a dedicated "Full-fidelity
  CRDT snapshots" UI). `presenceState` is the one legitimately-unused
  macro, and the component's own header comment explains why: `docSync`'s
  response already carries the live presence roster for any actively
  viewing client, so a dedicated poll would be redundant for this surface.
- `CollabActionPanel.tsx` — already a genuinely designed "team facilitator
  bench": structured row editors (not JSON textareas), real "Load DM" /
  "Load workspace" data sources, DTU mint/publish with recall windows, and
  an agent-facilitator brief. No changes.
- `WorkspaceRoster.tsx` — already real, polls the actual
  `/api/collab/workspaces` DTU-collaboration substrate. No changes.
- Screen share (WebRTC signaling over the session's socket room) and file
  upload (`apiHelpers.artistry.blobs.upload`) — both already real, no
  changes beyond the per-session tag scoping above.

## Verification

- `cd concord-frontend && npx eslint app/lenses/collab/page.tsx components/collab/*.tsx` — clean, 0 errors / 0 warnings.
- `cd concord-frontend && npx tsc --noEmit -p .` — 0 errors in any collab file; 2 pre-existing, unrelated errors remain in `app/lenses/dtus/page.tsx` (`TS2448`/`TS2454`, block-scoped variable used before declaration) — not touched by, or related to, this rebuild.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}`; collab stays WIRED (not in the 2 by-design exceptions).
- `node scripts/grade-ux-polish.mjs --honest` — collab: `tier: "polished"`, `isGenericScaffold: false`.
- Transient regenerated audit files (`audit/ux-polish-honest.json`, `audit/ux-polish-honest-gaps.md`) reverted via `git checkout` after verification, per program instructions.
