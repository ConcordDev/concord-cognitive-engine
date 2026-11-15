# DM-SURFACES — the DM read-surface inventory (SB-10)

Mega Plan v2, Track B, SB-G3. Compiled by B3 (Muse builder), 2026-11-14, claim CB-0628,
premise CB-0629. Basis: branch `fix/audit-sweep-20261110` at head `f4f9ee8a1`, read from
FETCH_HEAD extracts only. Read-only inventory — no production code was changed.
Completeness is machine-checked by `scripts/sec/assert-dm-surfaces.mjs` (fails when a
grep-found DM symbol is missing from this doc).

## The headline verdict

**ctx.userId is client-reachable: NO**

Evidence chain (all at the basis head):

1. `makeCtx` (`server/server.js:18839`) — the ctx builder for `/api/lens/run` — never sets
   a top-level `ctx.userId`. The returned ctx carries `actor` only. The actor resolves, in
   order, from `req.actor`, else from `req.user` (`server.js:18882ff`), else the anon
   baseline (`userId: "anon"`, role member in public mode / viewer otherwise).
2. `req.actor` is set by exactly one global middleware (`server.js:40688`): from `req.user`
   (a verified JWT/cookie identity) at `server.js:40693`, or from `getActorFromReq(req)` at
   `server.js:40708`, then identity-enriched server-side (`enrichActorIdentity`,
   `server.js:40714`).
3. `getActorFromReq` (`server.js:40478`) resolves `userId` from a hashed API-key lookup
   (the `X-API-Key` header or `?apiKey=` query — a credential resolved against server
   state, `server.js:40484ff`) or returns the `"anon"` baseline. No body, query, or header
   field sets an arbitrary userId anywhere in this chain.
4. A tree-wide search for writes (`ctx.userId =` / `ctx["userId"] =`) across `server/`
   finds them **only in test files** (hand-built test ctxs, e.g.
   `server/tests/lab-list-mine.test.js:19`). No production code sets `ctx.userId` at all.
5. The MCP/gateway path is the same shape: `_runMacroFromGateway` (`server.js:79472`)
   takes `userId` from the gateway's authenticated context and calls `makeCtx` with a
   synthetic `req.user` — server-resolved, never request input.

Consequence for the downstream items: the `ctx?.userId` actor fallbacks at
`server/domains/social.js:159` and `server/domains/message.js:54` read `undefined` on
every production path today. They are a **latent trap** (any future ctx producer that
copies request input into `ctx` would arm them), not a live spoof. SB-12 therefore prices
as hardening; SB-11's `userId`-spoof case should pass on pristine through the HTTP paths,
and this doc says so plainly so it is not filed as a leak.

## Leak-class taxonomy used below

- **NONE** — actor is server-resolved and a participant/membership check bounds the read.
- **EXISTENCE-HIDING (by design)** — denials are 404-shaped (`dmDenied`,
  `social-layer.js:1388`), so a non-participant cannot distinguish "no such conversation"
  from "not yours".
- **LATENT-FALLBACK** — safe today only because no production ctx sets `ctx.userId`
  (see the verdict); the fallback itself is the hazard SB-12 removes.
- **ANON-BUCKET** — per-user state keyed by the literal `"anon"` actor, shared by every
  unauthenticated caller who reaches dispatch (SB-13's ground).
- **ROLE-SCOPE** — a synthesized or elevated identity (founder role / wildcard scopes)
  whose reads are still bounded by participant checks, recorded for SB-11's matrix.

## §1 REST surfaces — the router set (wins registration order)

Mounted via `createSocialEngagementRoutes` at `server.js:44244`, which nests
`createSocialCoreRoutes` (`server/routes/social-engagement.js:39`). Middleware:
`auth = asAuth(requireAuth)` (`server/routes/social-core.js:83`, `:110`) where
`requireAuth` is the role gate's (`server/lib/role-gate.js:11` — pass-through when
AUTH_MODE is public at `:13`, session-demanding otherwise). Every handler additionally
re-checks `req.user?.id` itself and 401s when absent. Actor source on all rows:
`req.user?.id` (the verified session identity).

| Route | Layer call | Participant check | Leak class |
|---|---|---|---|
| POST `/dm` (`social-core.js:360`) | `sendMessage` (layer) | sender = session user; recipient must resolve (`recipientResolvable`); block + dmPolicy gates in the layer | NONE |
| GET `/dm/:conversationId` (`social-core.js:378`) | `getMessages` | `isDmParticipant` in the layer; defers `conversations`/`requests` ids via `next()` | NONE + EXISTENCE-HIDING |
| GET `/dm/requests` (`social-core.js:456`) | `listMessageRequests` (`server/lib/social-loop.js:185`) | self-scoped: only rows with `toUserId === userId` | NONE |
| POST `/dm/requests/accept` (`social-core.js:464`) | `acceptMessageRequest` (`social-loop.js:137`) | self-scoped match on `toUserId === userId` + `requestStatus === "pending"` | NONE |
| POST `/dm/requests/decline` (`social-core.js:474`) | `declineMessageRequest` (`social-loop.js:153`) | same self-scoped match | NONE |
| POST `/dm/hide` (`social-core.js:484`) | `hideMessageForUser` (`social-loop.js:169`) | conversation parts must include `userId` (404 otherwise) | NONE + EXISTENCE-HIDING |
| POST `/dm/recall` (`social-core.js:492`) | `recallMessage` (layer) | participant + sender-only + 120 s window in the layer | NONE |

## §2 REST surfaces — the monolith set (server.js, registered after the router)

These handlers derive the actor as `req.user?.id || req.actor?.userId || <fallback>` and
sit behind `requireAuth()`. Registration order matters: the router (§1) is mounted at
`server.js:44244`, long before these at `server.js:70908+`, so where both define a route
the router's handler answers first.

| Route | Layer call | Actor fallback | Participant check | Leak class |
|---|---|---|---|---|
| POST `/api/social/dm` (`server.js:70899`) | `socialSendMessage` | `\|\| "anon"` — the layer does not reject an `"anon"` sender (see §12) | block + dmPolicy gates in the layer; shadowed by §1's POST `/dm` while the router is mounted | NONE (ANON-BUCKET sender edge, §12) |
| GET `/api/social/dm/conversations` (`server.js:70908`) | `socialGetConversations` | `\|\| "anon"` → the layer returns an empty list for `"anon"` | `isDmParticipant` filter inside `getConversations` | NONE |
| GET `/api/social/dm/:conversationId` (`server.js:70921`) | `socialGetMessages` | `\|\| null` → not a participant | `isDmParticipant` in the layer (shadowed by §1's route in practice) | NONE + EXISTENCE-HIDING |
| DELETE `/api/social/dm/:messageId` (`server.js:70929`) | `socialRecallMessage` | `\|\| null` | participant + sender-only + window in the layer | NONE |
| POST `/api/social/dm/read` (`server.js:70937`) | `socialMarkMessagesRead` | `\|\| null` | `isDmParticipant` in the layer | NONE |
| POST `/api/social/dm/:conversationId/read` (`server.js:70945`) | `socialMarkMessagesRead` | `\|\| null` | `isDmParticipant` in the layer | NONE |

All six monolith routes are shadowed by §1's router for the paths both define
(POST `/dm`, GET `/dm/:conversationId`) while the engagement router is mounted —
its mount is try/catch-wrapped (`server.js:44244`), so if that mount ever fails,
this set becomes the live one and its `"anon"`/null fallbacks govern.

## §3 The layer (server/emergent/social-layer.js) — one participant gate under both sets

Conversation ids are the sorted pair key from `getConversationId` (`social-layer.js:1368`).
The single gate is `isDmParticipant` (`social-layer.js:1381`): false for a missing userId,
false for `"anon"`, otherwise true iff the userId is one of the two id parts. Denials
return `dmDenied()` — `{ ok: false, status: 404, error: "not found" }`
(`social-layer.js:1388`).

| Function | Behaviour relevant to reads |
|---|---|
| `sendMessage` (`:1392`) | block check, rate limit, recipient `dmPolicy` (nobody / followers → requestStatus "pending"); writes to the pair's message list; notification carries no body ("New message from X") |
| `getConversations` (`:1438`) | iterates only conversations where `isDmParticipant(convId, userId)`; `"anon"`/missing userId returns an empty list; pending requests hidden from the recipient's list |
| `getMessages` (`:1465`) | `isDmParticipant` gate, then hidden-for-caller and pending/declined-for-recipient filtering; returns body + mediaUrl + readBy |
| `markMessagesRead` (`:1488`) | `isDmParticipant` gate; mutates seenBy/readBy (receipts honour the profile's readReceipts pref) |
| `recallMessage` (`:1509`) | participant gate, sender-only, 120 s window; body wiped to a tombstone, receipt metadata kept |

## §4 Lens-action surfaces — domains/social.js (via /api/lens/run and MCP)

Actor: `const actor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon"`
(`server/domains/social.js:159`) — LATENT-FALLBACK per the verdict; the live value is
`ctx.actor.userId` from `makeCtx`. Dispatch is behind the H1 anon gate on
`/api/lens/run` (see §9 overlap).

| Action | Handler | Participant check | Leak class |
|---|---|---|---|
| `social.sendMessage` (`social.js:524`) | layer `sendMessage` with `from = actor(ctx)` | recipient-resolvable check (skipped only for `ctx.internal` server calls); block check | NONE (LATENT-FALLBACK on the actor line) |
| `social.inbox` (`social.js:551`) | `getConversations(STATE, me)` | participant filter in the layer; `"anon"` → empty | NONE + ANON-BUCKET (inert: layer returns empty for anon) |
| `social.conversation` (`social.js:582`) | `markMessagesRead` + `getMessages` | explicit `parts.includes(me)` check before the layer calls; **reading marks read** (a side effect SB-11 should pin) | NONE + EXISTENCE-HIDING |

## §5 Lens-action surfaces — domains/message.js (channels; the /messages surface)

Actor: `msgActor` (`server/domains/message.js:54`) —
`ctx?.actor?.userId || ctx?.userId || "anon"` (LATENT-FALLBACK + ANON-BUCKET).
Channels come in two shapes (`message.js:336`, `usesShared`): per-user channels, whose
state lives in the actor's own bucket, and shared threads — kind `"dm"` and `"group_dm"`
(the social-persist header's model, `server/lib/social-persist.js:14`) — whose messages
live in one shared list gated by `isChannelMember` (`message.js:337`: the userId must be
in the channel's participants).

Read/write surfaces that can touch another person's words:

| Action | Check |
|---|---|
| `channels-list` (`:349`) | lists the actor's own channels + shared channels they belong to |
| `messages-list` (`:427`) | shared channel → `isChannelMember` required ("not a participant"); per-user channel → the actor's own bucket only |
| `messages-send` (`:449`) | shared channel → `isChannelMember` required |
| `thread-list` (`:567`) / `thread-reply` (`:537`) | same channel scoping as messages-list |
| `search-messages` (`:199`) | searches only the actor's own search index (`s.searchIdx.get(userId)`) |
| `ai-search-messages` (`:928`) / `ai-summarize-channel` (`:835`) | channel-scoped through the same member/bucket rules |
| `schedule-send` (`:713`) / `schedule-list` (`:740`) / `schedule-cancel` (`:749`) / `schedule-flush-due` (`:796`) | the actor's own queue only |

Full action inventory of the domain (72 actions, all resolving the actor through
`msgActor`): saved-list, save-message, unsave-message, index-message, index-backfill,
search-messages, react, unreact, reactions-for, voice-register, voice-list, channels-list,
channels-create, channels-archive, messages-list, messages-send, messages-edit,
messages-delete, messages-mark-read, thread-reply, thread-list, activity-feed,
labels-list, labels-create, labels-delete, labels-apply, labels-remove,
labels-for-message, snooze, snooze-list, unsnooze, schedule-send, schedule-list,
schedule-cancel, schedule-flush-due, ai-summarize-channel, ai-smart-reply,
ai-action-items, ai-search-messages, inbox-summary, pin-message, unpin-message,
pins-list, bookmark-add, bookmark-list, bookmark-remove, status-set, status-get,
status-clear, huddle-start, huddle-join, huddle-leave, huddle-end, huddle-list,
file-upload, file-list, file-delete, typing-start, typing-stop, channel-live-state,
command-list, command-register, command-remove, command-run, app-messages-list,
notif-prefs-get, notif-prefs-set, notif-channel-set, notif-check, profile-set,
profile-get, directory-list.

The ANON-BUCKET exposure: every per-user store above is keyed by `msgActor(ctx)`, so an
unauthenticated caller who reaches dispatch shares the `"anon"` key with every other
such caller (SB-13). Reachability is bounded by the dispatch gates: the H1 anon gate
blocks anon lens dispatch in secured production, and production boot refuses
AUTH_MODE=public outright (`server.js:4111`). In public (local-first dev) mode the
bucket is live.

## §6 Persistence (server/lib/social-persist.js)

Write-through cache for `STATE._social`: DM threads and messages persist to the SQL
tables `social_dm_threads` (id, participant_a, participant_b, updated_at) and
`social_dm_messages` (id, thread_id, from_user_id, to_user_id, body, created_at,
read_by_json, recalled) — flush at `social-persist.js:184ff`, hydration at `:370ff`.
The in-memory source of truth the layer reads is `STATE._social.messages`, a Map keyed
by conversation id. Persistence adds no read surface of its own; every read goes
through §3's gate.

## §7 Realtime (socket emits of DM events)

A completed search for DM-content emits (`realtimeEmit` / `io.to` / emit patterns over
`server/emergent/`, `server/routes/`, and the socket handlers in `server.js`) finds
**no emit that carries DM content or DM metadata to any room**. The only DM-adjacent
realtime path is the notification fan-out: `createNotification` fires
`_fireNotificationSocket` (`social-layer.js:26`), wired in `server.js:10810` to
`setSocialEmitter`, which calls `emitToUser(uid, "social:notification", …)` — the
recipient's own `user:` room only — plus a push fan-out whose DM title is "New message"
(no body). The notification payload for a DM is `New message from <fromUserId>`
(`social-layer.js:1440`-region, in `sendMessage`). SB-15's emit-side ground is therefore
this one site; the join side is SB-04's.

## §8 Export providers (lens export for social / message)

A completed search over every `registerLensExportProvider(...)` call in
`server/domains/` (52 registrations: achievements, affect, agriculture, attention,
calendar, careers, chem, civic-bonds, commonsense, concord-link-frontier, creatures,
cri, crisis, entity, event-timeline, feed, film-studios, fishing, gallery, garage,
genesis, global, inference, inheritance, law-enforcement, lfg, linguistics, mail,
meditation, metacognition, metalearning, move-builder, photography, poetry, privacy,
quests, resonance, root, society, space, staking, vault, veterinary, world-creator, and
the remainder) finds **no provider registered for `social` and none for `message`** —
DM content has no lens-export surface. The nearest neighbours are the generic
owner-scoped export legs in `server/lib/lens-export.js` (the canonical-DTU leg whose
owner rule was settled in CB-0610), which carry DTUs and artifacts, never DM bodies.

## §9 MCP lens tools

- HTTP entry: `POST /mcp/call` (`server.js:42746`) → `dispatchMCP` (auth-gate) with
  `actor: req.user || null`. The generic lens-action tool is `run_lens_action`
  (with `list_lens_actions`), and both sit in `MCP_TOOLS_REQUIRE_REAL_AUTH`
  (`server.js:42634`) — they are refused for the credential-less bypass identity.
- The bypass itself: when `CONCORD_MCP_PUBLIC=1` or AUTH_MODE is public and the caller
  sent no credentials, the auth pipeline synthesizes
  `req.user = { id: "mcp-anonymous", role: "founder", scopes: ["*"] }`
  (`server.js:8728ff`). Leak class ROLE-SCOPE, bounded twice: `run_lens_action` is
  real-auth-only (above), and even a resolved `mcp-anonymous` actor is
  participant-bounded to its own (empty) conversation set by §3's gate.
- Gateway path: `_runMacroFromGateway` (`server.js:79472`) — see verdict item 5.

## §10 AUTH_MODE behaviour per route family

AUTH_MODE resolves at `server.js:4090ff` (public | apikey | jwt | hybrid; default
hybrid when legacy auth is enabled, else public). Production + public is a boot-time
FATAL (`server.js:4111`).

| Family | public | apikey / jwt / hybrid |
|---|---|---|
| §1 router `/dm*` | `requireAuth` passes through (`role-gate.js:13`); the handler's own `req.user?.id` check still 401s a session-less caller. With a valid token, `authMiddleware` best-effort identifies (`server.js:8303`) and the routes work | `requireAuth` demands a session (401); handler check agrees |
| §2 monolith `/api/social/dm/*` | same pass-through; session-less callers reach handlers with the `"anon"`/null fallbacks, bounded by §3's gate (empty list / 404 denial) | session demanded at `requireAuth()`; fallbacks inert |
| §4/§5 lens actions via `/api/lens/run` | anon actor = `"anon"` with member role + write scope (`makeCtx`, `server.js:18905ff`); the H1 anon gate is a secured-production gate, so public mode dispatches — §5's ANON-BUCKET is live here, §4's social reads stay empty for `"anon"` by the layer's own guard | H1 gate: anon dispatch 401s (`LENS_AUTH`) except guestRead-opted actions (GB-1536 set); actors are session/API-key resolved |
| §9 MCP | bypass synthesis available (ROLE-SCOPE, bounded as recorded) | real credentials resolve `req.user`; `run_lens_action` demands them in every mode |

## §11 Overlap with B8's platform programme (referenced, not duplicated)

The gates that surround the ctx builder — the H1 anon gate
(`_lensActionForbiddenForAnon`), the macro ACL, the platform-internal role gate, and
the guestRead pass — are the `/api/lens/run` authz family owned by B8's platform
programme (CB-0566: the authz family ×14, the reasoning-005 chains leg, ux-suite-005;
claimed CB-0573). This inventory references those gates only where a DM surface passes
through them (§4, §5, §10) and enumerates what SB-10 owns: the DM surfaces themselves
and the provenance of the actor they consume. Where the two meet — the ctx builder —
SB-10's contribution is the §0 trace: `makeCtx` never sets `ctx.userId`, and nothing
downstream of a request can either.

## §12 What the downstream items should expect

- **SB-11 (pin matrix):** every §1–§5 surface is participant- or self-scoped at the
  basis head; the spoof case (`userId: A` in the body) has no production path to the
  actor (verdict §0) and should pass on pristine via HTTP. The cases with real teeth
  are the `"anon"` shared bucket (§5, public mode) and the read-marks-read side effect
  in `social.conversation` (§4).
- **SB-12 (fallback removal):** `server/domains/social.js:159` and
  `server/domains/message.js:54` are the DM-bearing instances of a platform-wide idiom;
  removal is hardening (LATENT-FALLBACK), urgent only if a future ctx producer copies
  input into `ctx`.
- **SB-13 (anon bucket):** the bucket is `msgActor`'s `"anon"` key (§5); the same
  fallback shape exists in `social.js`'s `actor`, inert for reads because
  `getConversations` early-returns empty for `"anon"` — writes are the edge to pin:
  `social.sendMessage` (§4) and the monolith's POST `/api/social/dm` (§2) both pass
  an `"anon"` fromUserId into a layer `sendMessage` that does not reject it, so in
  public mode a session-less caller can send as the shared `"anon"` identity and
  create `anon:<user>` conversations.
- **SB-14 (DM routes under public):** code read says the §1 handlers 401 a
  session-less caller in every mode (their own `req.user?.id` check), and §2's
  handlers degrade to empty/404 via §3's gate — the pin settles the live behaviour.
- **SB-15 (realtime):** the only DM-adjacent emit site is §7's user-scoped
  notification; no broadcast or room-wide DM emit exists at the basis head.

— Compiled by B3 (Muse builder), 2026-11-14. Enumeration only; nothing VERIFIED;
the live behaviours named for SB-11/SB-14 settle on their pins, not on this doc.
