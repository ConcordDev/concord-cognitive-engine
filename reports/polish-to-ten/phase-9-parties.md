# Phase 9 — Party / Group System

## Goal

Players can form ad-hoc groups (≤8 members), invite each other, transfer leadership, kick, leave, and chat to the party — laying the foundation for shared-quest / shared-loot gameplay.

## Pre-implementation discoveries

The Block C sweep identified `film_watch_parties` (migration 021) and `guild_members` (migration 052) as adjacent prior art:
- Film watch party tracks party_id + members table — same shape as needed here
- Guild has leader_id + role on members
- Both lack the **invite/accept lifecycle** with a pending-state

Each is a partial template. Phase 9 cleanly composes both: a `parties` + `party_members` pair (guild-shaped) plus a third `party_invites` table for the pending-invite state machine.

## Changes

### `server/migrations/070_parties.js` (new)

Three tables:
- `parties` — id, leader_id, name, max_size (default 8, hard cap), privacy enum, loot_policy enum (free_for_all / round_robin / leader_loots), created_at, disbanded_at
- `party_members` — party_id + user_id composite PK, role enum (leader/member), joined_at
- `party_invites` — id, party_id, invited_id, invited_by, status enum (pending/accepted/declined/expired/cancelled), created_at, expires_at, responded_at

Indexes on the obvious lookup paths.

### `server/routes/parties.js` (new)

Endpoints:
- `POST /` — create party (caller becomes leader); rejects if already in a party
- `GET /me` — current party + members for caller
- `POST /:id/invite` — leader-only; 5min lifetime; emits `party:invite` to invitee
- `POST /invites/:inviteId/accept` — joins the party; emits `party:member_joined` to all members
- `POST /invites/:inviteId/decline` — emits `party:invite_declined` to inviter
- `POST /:id/leave` — caller leaves; auto-promotes longest-tenured member to leader if leader leaves; auto-disbands if last out (sets `disbanded_at`)
- `POST /:id/kick` — leader-only; emits `party:kicked` to target + `party:member_left` to remaining
- `POST /:id/transfer` — leader-only; transactional role swap; emits `party:leader_changed` to all
- `POST /:id/chat` — broadcasts `party:chat` to all members; 500-char limit

Each emit goes through the `emitToUser` helper added in Phase 8 (which uses the `user:${userId}` room from Phase 3). Same delivery channel for trade and party — one room per user, multiple event types.

### `server/server.js`

Mounted `createPartiesRouter` at `/api/parties`, passing the same `{ requireAuth, db, emitToUser }` triple as the trade router.

### `concord-frontend/components/party/PartyHUD.tsx` (new)

HUD widget (264px wide). Shows party name, member count vs cap, member list with leader star, loot policy, leave button. Subscribes to all 4 party events plus `party:kicked` for cleanup. Refetches `/api/parties/me` on each event since member detail (display name) lives server-side. Toasts for joins/leaves/leader-change via `useUIStore`.

### `concord-frontend/lib/realtime/socket.ts`

`SocketEvent` union extended with the 7 party events.

## Verification

- `node --check server.js routes/parties.js migrations/070_parties.js` — clean
- `npx tsc --noEmit` — no new errors
- `npx eslint components/party/PartyHUD.tsx lib/realtime/socket.ts` — clean
- Manual verification (Phase 20): two-tab test → user A creates party → invites B → B accepts → both see member_joined → A transfers leadership → both see leader_changed → B leaves → A's HUD updates → A leaves alone → party auto-disbands.

## Files touched

| File | Action |
|---|---|
| `server/migrations/070_parties.js` | created — 3 tables (parties, party_members, party_invites) |
| `server/routes/parties.js` | created — Express router with 9 endpoints |
| `server/server.js` | mounted parties router at `/api/parties` |
| `concord-frontend/components/party/PartyHUD.tsx` | created — live HUD widget |
| `concord-frontend/lib/realtime/socket.ts` | extended SocketEvent union with 7 party events |

## Notes for downstream phases

- Phase 10 (anti-dupe): party-shared-loot policies will eventually need per-policy ledger entries; out of scope here, but the loot_policy enum is already wired in the schema.
- Phase 17 (onboarding refinement): if a new player accepts a party invite during onboarding, the wizard should pause; the events are already on the same WebSocket channel so onboarding can subscribe.
- Phase 18 (loop closure): when a party member completes a quest, can fire `quest:complete` to all party members via the existing `user:${userId}` room — emergent quest sharing rides on the same plumbing as Phase 3.
