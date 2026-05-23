# Feature Upgrade Backlog

> **What this is.** The remaining work to make Concord match category-leader
> feature parity (Cursor, Epic MyChart, Figma, Spotify, etc.) in full
> depth — not just at the macro-implementation level (which is at 1.000
> weighted depth, see `audit/macro-depth.json`) but at the workflow
> + realtime + integration + client-bundling level the spec prose
> claims.
>
> Two acceptable closure paths per item: **(A)** upgrade the
> implementation to match the prose, or **(B)** honestly downgrade
> the spec prose to match the implementation. The Phase 3 pass landed
> path-B downgrades for the items marked ⬇️; the items below either
> already had honest prose or remain on the path-A upgrade roadmap.
>
> Regenerate the auto-detection layer with:
> ```sh
> node scripts/audit-spec-vs-impl.mjs
> ```
> Output goes to `audit/spec-vs-impl.json` + `audit/spec-vs-impl-mismatches.md`.

---

## Headline stubs (documented in CLAUDE.md spot-checks)

These are the highest-visibility prose-vs-implementation gaps — the
specs claim a category-leader feature, the macros exist with valid
contracts, but the underlying implementation is narrower than the
spec prose suggests.

| Lens | Claim | Current implementation | Effort | Path |
|---|---|---|---|---|
| `code` Live Share | "Real-time multiplayer / Live Share editing — front-to-back" | Polling op-log in `server/domains/code.js` (`liveshare-start/join/edit/poll/end`); ops appended to in-memory array, clients poll for new ops by sequence cursor; no WebSocket push, no OT/CRDT, last-write-wins | medium (realtime push, no CRDT) / very-large (true CRDT) | **Phase 4 lands realtime push via existing Socket.IO; CRDT remains backlog (needs `yjs` + adapter)** |
| `healthcare` telehealth | "Telehealth video visit integration — front-to-back" | Appointment scheduling in `server/domains/healthcare.js#telehealth-create` (line ~1734); optional Daily.co room provisioning if `DAILY_API_KEY` is set, otherwise `roomUrl: null`; no video tile UI mounted | large | Backlog — needs WebRTC client (simple-peer / Daily SDK / Twilio) bundled in the healthcare lens |
| `collab` CRDT | "Conflict-free CRDT op-log" | Lamport-clock op-log polled at ~1s in `server/domains/collab.js`; deterministic ordering but no actual CRDT (still last-write-wins on identical-clock collisions) | medium (realtime push) / large (true CRDT) | **Phase 4 lands realtime push; CRDT remains backlog** |
| ~~`social` workflow~~ | ~~"Threaded replies, reactions/reposts, DM inbox + threads"~~ | **Verified shipped** — `FeedView` mounts `PostCard` → `PostDetail` → `ReplyTree` (`concord-frontend/components/social/feed/`), and the `social` domain macros cover the full engagement loop (the comment in `server/domains/social.js:3` reads "REST routes never covered" past tense — meaning the domain now covers them, not that they're still uncovered). No upgrade needed. | — | Already shipped |
| `feed` ranking | "Algorithmic ranked For You feed" | Tab switching + analytics macros (engagement-score, content-calendar); no actual ranking model | large | Backlog — needs a recommender (matrix-factorisation / collaborative-filter / LLM-rerank) |
| `anon` E2E encryption | "X25519 ECDH + AES-256-GCM sealed envelopes, plaintext never stored" | Macros store messages in `STATE.anonSessions[*].ops[]` as plaintext; no real key exchange | large | Backlog — needs `tweetnacl` or `libsodium-wrappers` + proper key-exchange protocol; also needs schema change to drop plaintext storage |

## Auto-detected mismatches (from `audit/spec-vs-impl.json`)

The 21 mismatches the `scripts/audit-spec-vs-impl.mjs` regex-based
detector flagged. Each is either a real overstatement (path-A or
path-B) or a false-positive (the detector's signal heuristics aren't
perfect). Per-item triage below.

### STUB-WHERE-INTEGRATION-CLAIMED (12)

Spec claims an external-API integration but the handler has no `await fetch()`
to that API's hostname and the body is small. Several of these are
false positives — the API call lives in a same-file helper the detector
didn't recurse into, or the macro is a thin orchestrator over a
heartbeat module that does the integration on a background tick.

| Macro | File | Notes |
|---|---|---|
| `code.github-remote-status` | `server/domains/code.js` | Real: checks the remote-status row; the actual fetch happens in `github-pull` / `github-push`. **False positive.** |
| `chat.timeline` | `server/server.js:69576` | Real: builds a timeline from in-memory chat sessions; no external API. **Spec wording can be downgraded** if it claims integration. |
| `ingest.getWebhookEndpoint` | `server/domains/ingest.js` | Returns a configured endpoint URL — that's the integration surface. **False positive.** |
| `ingest.listWebhookRecords` | `server/domains/ingest.js` | Returns webhook delivery log. **False positive.** |
| `observer.compose_report` | `server/server.js:70621` | Composes a report from observed events; the upstream observation IS the integration. **False positive.** |
| `offline.swManifest` | `server/domains/offline.js:591` | Returns service-worker manifest; integration surface is the SW itself, not a fetch. **False positive.** |
| `offline.mergeResolve`, `replicationPush`, `syncCheckpoint`, `backoffSchedule`, `replicationPull` | `server/domains/offline.js` | All five are sync-protocol helpers — the integration is the protocol itself (offline-first sync IS the feature). **Spec downgrade candidates** if prose overstates to "live cloud sync." |
| `space.launch-countdown` | `server/domains/space.js` | Computes countdown from cached launch data — the API ingest lives in `space.live_launches_upcoming`. **False positive at this granularity.** |

### CRUD-WHERE-WORKFLOW-CLAIMED (9)

Spec implies a multi-step workflow but the handler is a single
insert/update/select. Most are detector false positives — workflow
language in the spec applied to a *catalog* of operations not a single
macro, and individual macros are correctly granular.

| Macro | File | Notes |
|---|---|---|
| `insurance.quotes-compare` | `server/domains/insurance.js` | Computes a comparison from cached quotes; quote ingestion is a separate macro. **False positive.** |
| `sentinel.shield.threats` | `server/server.js:22451` | Returns threat list; remediation is separate macros. **False positive.** |
| `sessions.list_mine`, `sessions.get`, `sessions.close` | `server/domains/sessions.js` | Standard CRUD for a session collection — spec prose about "session orchestration" is at the lens level, not the macro level. **False positive at this granularity; spec downgrade candidate** if prose overstates to "live orchestration." |
| `tools.web_search`, `tools.legal.sign` | `server/server.js` | `web_search` is a single search call (no orchestration); `legal.sign` records a signature on a doc. **False positives** — workflow language describes the user journey, not the single macro. |
| `ingest.*` (2 items) | same as above | Already covered |

## Patterns not detected by the auto-audit

The audit detector relies on signal regexes that produce false negatives
for several real gaps:

1. **Specs that describe a feature without naming any macro in backticks.** Most
   prose-only descriptions (e.g. "Step debugger with breakpoints" in
   `code.md`) escape the detector entirely. Manual inspection of the
   `Missing — buildable feature backlog` list is still needed.
2. **Macros whose names don't share keywords with the claim.** Live Share
   isn't named `code.realtime-edit` — it's named `code.liveshare-edit` —
   so a claim "real-time multiplayer" doesn't auto-link to it without
   tighter keyword normalization than the detector has.
3. **Spec language about UI bundling.** "Mounted video tile" or
   "embedded WebRTC client" claims are about frontend components, not
   server macros. The detector only inspects server-side handlers.

These three gap-types are why this backlog file is hand-maintained
alongside the auto-output.

---

## Estimated full feature-parity effort

Conservative sizing for closing all of the above to category-leader
depth: **4–7 months of focused engineering** across roughly 15–25 lenses,
plus a long tail of CRUD-where-workflow gaps that need design as
much as implementation.

Tractable in-session (Phase 4 of the plan):

- ✅ Realtime push for `code` Live Share + `collab` co-editing (Socket.IO
  rooms — existing infra, no new deps)
- ✅ Mount `CommentThread` + `ShareModal` in `social` lens (UI wiring only)
- ✅ Honest spec prose downgrades for the headline stubs above

Deferred (needs deps + design):

- 🟡 True CRDT for Live Share (needs `yjs` + `y-websocket` server adapter)
- 🟡 Telehealth video client (needs WebRTC: simple-peer / Daily SDK)
- 🟡 Real `feed` ranking model (needs recommender architecture decision)
- 🟡 E2E encryption for `anon` (needs `tweetnacl` + protocol design)

When any of those four deps lands, the corresponding row above moves
from "Backlog" to "Phase 4-style upgrade" and the spec prose can be
upgraded to match.
