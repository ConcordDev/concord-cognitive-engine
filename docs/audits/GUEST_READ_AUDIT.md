# Guest Read Audit — GB-1536 "Enter means Enter"

**Rule (hard):** a guest / logged-out request may return only public or
seeded sample content — never another user's data. This audit enumerates
every GET path reachable anonymously through the `publicReadPaths`
allowlist (server/server.js, the auth middleware's GET bypass) and every
lens action marked `guestRead: true`, and records for each: what an
anonymous caller receives, the owner/visibility filter applied, and the
verdict — **public-safe**, **fixed here**, or **closed to guests**.

Read at branch `fix/audit-sweep-20261110` head 11d2774c2 (the GB-1536
trace head); fixes are this ticket's commits on the same branch.
"Anon actor" below means no resolved session: `ctx.actor.userId` absent
or a placeholder (`anon` / `anonymous` / `guest` — the lens-authz
doctrine that placeholder identities are not a person).

## Fixed in this ticket

| Surface | What anon got before | Fix |
|---|---|---|
| `code.snippets-list` + `collectSnippets` (server/domains/code.js) | **Every user's snippets.** The collector skipped a row only when a caller id existed AND the row had a different `creator_id`; with no caller it returned the whole corpus, and ownerless snippets went to everyone. The doc comment even advertised a "global snippet corpus" fallback. | Caller resolved via lens-authz `actorId(ctx)` (placeholders → null). No actor → `[]`. With an actor, a row rides only when `dtuListedOwner(row) === actor`. Comment deleted. |
| `code.snapshots-list` + `collectSnapshots` | Same leak shape as snippets. | Same fix. |
| Snippet/snapshot saves (`snippets-save`, `commit-snapshot`) | Stamped `creator_id` only — a field `dtuListedOwner` did not read, so every saved snippet looked **ownerless** to DTU list / visibility / export paths. | Saves now stamp `ownerId` alongside `creator_id` (GB-1536 §4b). |
| `dtuListedOwner` (server/lib/dtu-list-source.js) | Chain was `author‖ownerId‖userId‖createdBy‖authorId` — no `creator_id`. | `creator_id` added as the **last** fallback. Plus a one-time boot backfill in the state-load migration path (`ownerId := creator_id` where `ownerId` is missing, written through the DTU store, idempotent). |
| `lens.list` SOCIAL_DOMAINS bypass (server/server.js) | For the ten social domains (forum, feed, marketplace, collab, thread, vote, alliance, global, news, questmarket) the list macro applied **no ownership or visibility filter at all** — private/draft artifacts in those domains returned to anyone who reached the macro, including anonymous callers through `GET /api/lens/:domain`. Non-social domains kept ownerless/`anon`-owned rows visible to all. | For anonymous actors the macro now applies one guest filter in **every** domain: a row rides only when `meta.visibility` is `public` or `published`; activity mints never ride; ownerless rows fall (office call CB-0594). Signed-in behaviour is unchanged. |
| `lens.get` + `_lensArtifactVisible` | Same social bypass + ownerless-open branch, shared by get/run/export/update. | Anonymous actors are scoped first by the same guest rule (`_lensAnonVisible`); the bypass and the ownerless-open branch never apply to them. Signed-in behaviour unchanged. |
| `GET /api/lens/:domain/:id/dtus` | Returned the **full DTU bodies** linked to any artifact, no visibility check, no ctx at all. | Route now gates on `_lensArtifactVisible(makeCtx(req), artifact)`; a viewer who cannot see the artifact gets 404 (the `/api/dtus/:id/context` pattern). Guests reach only public artifacts' DTUs. |
| `GET /api/context/user/:userId` | `context.userProfile` (registered `public: true`) returned any user's context profile for any userId, to anyone. | Route self-gates: caller must be that user or an admin/owner/founder; guests 401, other users 403 (the `/api/context/inspector` shape). |
| `GET /api/context/panel/:sessionId` | Returned a session's working set (the owner's DTU titles, tiers, activation scores) for any session id, to anyone. | **Closed to guests**: no resolved `req.user` → 401. Residual (named, not fixed here): a *signed-in* caller can still probe another session's id; owner-scoping session panels needs session ownership in the activation system and is a follow-up, not a guest-rule breach. |
| `productionWriteAuthMiddleware` (writes, req 2c) | Passed any non-GET carrying an `Authorization` header, an `x-api-key`, or a `concord_auth` cookie — **presence, not validity** — so a garbage credential carried writes in production. | The presence fallback is removed: reaching the tail with `req.user` unresolved is a 401. Verified credentials resolve `req.user` upstream (session cookie/JWT verified, API keys hash-matched) and pass at the function's head. Every existing exact-path exception (receipts/verify, receipts/sheet, Stripe webhook, ingest webhooks, proof-comment, debug ingest) sits above the change and is untouched. Note: a caller whose only credential is a legacy state-store API key (the local-first key path in `getActorFromReq`) no longer passes the *HTTP write gate* in production — it needs a session or an AuthDB-issued key. That is the ticket's intent: presence of a header was the hole. |
| H1 lens-action gate (`_lensActionForbiddenForAnon`) | Denied **every** anon lens action, reads included — correct for privacy, incompatible with guest browsing. | Deny-by-default stands. The one pass-through: an action whose spec carries `guestRead: true` (see the register below), consulted at all three H1 sites (`/api/lens/run`, the `lens.run` macro, the gateway dispatcher). |
| The two production gates in front of H1 (`authMiddleware`'s 401 tail; `productionWriteAuthMiddleware`) | Both 401 **every** unresolved POST `/api/lens/run` before H1 runs — the spectate comment in `authMiddleware` records this exact dead-letter shape ("Gate 1 hard-401s any unauthenticated POST to /api/lens/run … regardless of Gate 2"). Without a pass, `guestRead` would be unreachable over HTTP in production. | Each gate gains one narrow, fail-closed pass at its tail: POST `/api/lens/run` whose parsed body's (domain, action) is `guestRead` proceeds as anonymous. `authMiddleware`'s pass sits **after** credential resolution has failed, so no resolved identity can be bypassed or lost; H1 re-checks the flag at the route regardless. Non-guestRead actions still 401 at both gates. |

## The guestRead register (complete — anything not listed is denied to guests)

An action may be marked `guestRead` only if it (i) is not write-shaped
per `isWriteActionName`, (ii) makes no LLM/brain/paid-API call and starts
no long job, and (iii) returns only public or seeded sample rows to an
anonymous actor. Marked in this ticket:

| Action | Why it qualifies |
|---|---|
| `lens.list` | Read-only macro; anonymous actors are scoped by the fixed guest filter above (public/published rows only). |
| `lens.get` | Read-only macro; anonymous actors get `not found` for anything not public/published (fixed above). |
| `code.snippets-list` | Read-only; anonymous actors receive `[]` by the actorId rule (fixed above). The Code lens renders its client-side samples instead. |
| `code.snapshots-list` | Same as snippets-list. |

No other action is marked. Lens views whose data needs a non-guestRead
action render the labelled guest empty state (plus req-5 sample content
where a seed source exists) — follow-up candidates for guestRead marking
must be proposed per action with the same three-part evidence and added
to this register in the same commit that marks them.

## Public-safe (verified at the trace head — no change)

| Path / prefix | What anon gets | Filter |
|---|---|---|
| `GET /api/lens/:domain` | `lens.list` output | The macro's filter — **fixed above** for anon. (The `agents` domain additionally self-gates anon → 401 at this route, INC-SWEEP F15; it stays.) |
| `GET /api/lens/:domain/:id` | `lens.get` output | **Fixed above** for anon. |
| `GET /api/lens/:domain/:id/export` | One artifact's export | The export macro checks `_lensArtifactVisible` — **fixed above** for anon. |
| `GET /api/lens/:domain/schema` | Domain validation schema | No user data. |
| `GET /api/dtus`, `/api/dtu`, `/api/dtus/paginated` | DTU list/detail | The read model (`userVisibleDTUs` + `privateDtuHiddenFrom` + `dtuListedOwner`): private rows are hidden from non-owners; anonymous list scopes are the caller's own (none) or the `global` substrate. Snippet rows now resolve their owner via the `creator_id` fallback (**fixed above**), so a private snippet is no longer "ownerless-visible". |
| `GET /api/dtus/:id/context`, `/api/dtus/:id/artifact` | Per-DTU context / artifact | Visibility-pool gated: the id must be in the viewer's visible pool or the route 404s — the pattern the `:id/dtus` fix now follows. |
| `GET /api/search/ranked` | Ranked search results | Ranking scopes are `["public"]` when `req.user` is absent (personal/org/federated scopes require a session); history/saved endpoints carry `requireAuth()`. |
| `GET /api/graph/visual`, `/api/graph/search`, `/api/graph/force` | Graph nodes/edges + title search | Per-viewer visibility (`_graphCanSeeId`) — the same filtered node set the graph renders. |
| `GET /api/messaging/*` (routes/messaging.js) | — | Every user-data GET (`/bindings`, `/messages`) self-gates on `req.user?.id` → 401; `/status` is a health shape. The prefix's presence on the allowlist does not reach data. |
| `GET /api/settings` (routes/domain.js) | Global cognitive-tuning knobs | Handler is genuinely public-safe (no PII) — established by the 2026-07-27 audit correction recorded at the allowlist. |
| `GET /api/analytics` (bare) | Aggregate analytics | Identity comes only from `req.user`/`req.session`; the per-user sub-path (`/personal/:userId`) is **excluded** from the allowlist and handler-gated (2026-07-27 follow-up recorded at the allowlist). |
| `GET /api/context/profiles`, `/api/context/metrics`, `/api/context/inspector` | Lens context profiles (static), engine metrics, inspector | Profiles/metrics carry no per-user rows; inspector self-gates 401 without a user. |
| `GET /api/atlas/*` (routes/atlas.js) | Geospatial tile/volume/material/coverage data | Public map data; no user rows. `/api/atlas/signals` and `/api/atlas/privacy` are signal/privacy aggregates. |
| `GET /api/lattice/*` (routes/lattice.js) | Corpus stats, drift alerts | User-shaped reads (`/consent-log`, `/corpus/mine`) carry the router's `auth` middleware. |
| `GET /api/forge/templates`, `/sections`, `/constants` | Template catalog | Public catalog data. |
| `GET /api/connective-tissue/search`, `/bounties` | Public search + bounty board | Public discovery surface (the allowlist's Phase-K note); bounty rows are public listings. |
| `GET /api/worlds/spectator-counts`, `/api/cross-world/feed`, `/api/foundry/worlds`, `/api/tournaments/active`, `/api/achievements/catalog`, `/api/achievements/recent`, `/api/lfg/open`, `/api/diseases/catalog`, `/api/diseases/plagues` | Counts, world-event summaries, catalogs, public boards | Server-generated or catalog content, no PII — the allowlist's per-prefix notes stand. |
| `GET /api/auctions/active`, `/api/auctions/` | Auction listings | Public-read by design (money stays OFF; bidding is a write and stays gated). |
| `GET /api/evo-asset/*` | EvoAsset resolve/material/file/stats | Public per the routes file's own design; its one mutating route carries its own auth (allowlist note, 2026-08-08). |
| `GET /api/council/voices`, `/proposals`, `/theater`, `/debate` | Council voices + public governance content | Public governance surface. |
| `GET /api/brain/personality`, `/wants`, `/spontaneous/status`, `/api/embeddings/status`, `/api/status`, `/api/system`, `/api/metrics`, `/api/growth`, `/api/backpressure`, `/api/pwa`, `/api/schema`, `/api/species`, `/api/events`, `/api/lenses`, `/api/lens-actions`, `/api/inference/slos`, `/api/audit/provenance`, `/api/plugins`, `/api/macros`, `/api/openapi.json|yaml`, `/api/docs`, `/api/chat/web-metrics`, `/api/webrtc/ice-servers` | System/persona status, catalogs, specs, aggregates | No per-user rows. AI **invocation** is not here: every chat/brain/agent POST is a non-GET and is refused to guests by the tightened write gate + H1 (req 2d) — status reads are not model calls. |
| `GET /api/creator/leaderboard`, `/trending-citations`, `/influence-drift` | Public creator rankings | Public-by-design surfaces (the creator dashboard stays authed). |
| `GET /api/entity-growth`, `/api/entity-exploration`, `/api/goals`, `/api/hypothesis` | Aggregate entity/hypothesis data | Aggregate shapes; per-user hypothesis work runs through lens actions, which H1 + guestRead govern. |
| `GET /api/emergent`, `/api/knowledge`, `/api/sandbox`, `/api/guidance`, `/api/scope`, `/api/inspect`, `/api/worldmodel`, `/api/resonance` | Macro-dispatched reads | These prefixes reach macro dispatch, not raw tables: macro ACL + H1 govern execution, and the reads that return DTU-shaped rows pass through the same visibility machinery audited above (`lens.list`/`lens.get` filters, `userVisibleDTUs`). No handler under these prefixes returns a private row to an anonymous actor at the trace head. |
| Music / Market visitor routes (GB-0664) | Public items, field-stripped for anon; 30-second media previews | Unchanged by this ticket; the lenses fold into the general guest mode on the frontend with the preview rules kept. |

## Follow-ups named (not in this ticket)

- **Seed authoring / seedless lenses (req 5):** lenses whose views have
  no `SEED_*` array, no ConKay showcase snapshot, and no starter-pack
  source render the labelled guest empty state. Authoring seeds for
  them is a per-lens content task — proposed as a follow-up sweep, one
  lens at a time, after the post-deploy re-walk shows which guest
  views read emptiest.
- **guestRead candidates:** per-domain list/read actions beyond the
  register above (e.g. per-lens `*.list` actions that read only public
  catalog rows) — each needs its own three-part evidence before
  marking; none was marked on a skim.
- **Session-panel ownership** (see the `/api/context/panel` row):
  owner-scope panels to the session's owner for signed-in callers too.
- **`lens.list` signed-in social behaviour:** this audit scoped the
  *anonymous* case only. Whether signed-in non-owners should also see
  only public/published social-domain artifacts is a product call for
  the desk, not a guest-rule breach.

## Verification

Pinned by `server/tests/guest-read-privacy.test.js` (A/B users, private
rows in social + non-social domains, ownerless + public rows, deep scan
of every audited GET + every guestRead action, snippets + snapshots as
named cases) and `server/tests/guest-write-gate.test.js` (route-stack
enumeration + garbage-credential cases) in CI. Acceptance remains the
post-deploy live re-walk; nothing in this document marks anything
VERIFIED.
