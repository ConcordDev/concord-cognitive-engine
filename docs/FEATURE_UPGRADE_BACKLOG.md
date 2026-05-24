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
| ~~`code` Live Share~~ | ~~"Real-time multiplayer / Live Share editing — front-to-back"~~ | **Shipped 2026-05-24.** Y.js CRDT via `server/lib/yjs-realtime.js`; per-session `Y.Doc`s with `Y.Text` per file, synced over Socket.IO (`yjs:sync-state`, `yjs:update`). Concurrent overlapping edits merge structurally. Op-log + poll path stays as backstop for late-rejoin + audit. | — | Shipped |
| ~~`healthcare` telehealth~~ | ~~"Telehealth video visit integration — front-to-back"~~ | **Shipped 2026-05-24.** In-lens WebRTC video tile (`concord-frontend/components/healthcare/TelehealthVideoCall.tsx`) using `simple-peer` + Concord's Socket.IO signalling layer (`server/lib/webrtc-signalling.js`). Camera + mic permissions, local + remote tiles, mute/cam-off controls, clean tear-down. Daily.co external-handoff path retained for orgs that prefer Daily's SFU. | — | Shipped |
| ~~`collab` CRDT~~ | ~~"Conflict-free CRDT op-log"~~ | **Shipped 2026-05-24.** Y.js CRDT layer via the same `yjs-realtime.js` infrastructure; `Y.Text("content")` per document, synced over Socket.IO. Concurrent overlapping edits merge structurally. Lamport-clock op-log stays as the persistence path. | — | Shipped |
| ~~`social` workflow~~ | ~~"Threaded replies, reactions/reposts, DM inbox + threads"~~ | **Verified shipped** — `FeedView` mounts `PostCard` → `PostDetail` → `ReplyTree` (`concord-frontend/components/social/feed/`), and the `social` domain macros cover the full engagement loop (the comment in `server/domains/social.js:3` reads "REST routes never covered" past tense — meaning the domain now covers them, not that they're still uncovered). No upgrade needed. | — | Already shipped |
| ~~`feed` ranking~~ | ~~"Algorithmic ranked For You feed"~~ | **Verified shipped (2026-05-21, batch 38ish).** `server/domains/feed.js` ships `rank-for-you` + `record-interaction` macros — engagement-based scoring + interaction-history reinforcement. Not a deep ML recommender, but a real ranking pipeline that learns from user behaviour. | — | Already shipped |
| ~~`anon` E2E encryption~~ | ~~"X25519 ECDH + AES-256-GCM sealed envelopes, plaintext never stored"~~ | **Verified shipped (2026-05-21).** `server/domains/anon.js` ships **real** X25519 ECDH + AES-256-GCM sealed envelopes via Node's built-in `crypto` module (no external dep needed — Node 18+ supports both natively). 981 LOC across `identity`, `rotateIdentity`, `safetyNumber`, `verifyPeer`, `startConversation`, `listConversations` + group conversations + ephemeral sweep + disappearing-message defaults. My earlier backlog entry was wrong. | — | Already shipped |

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

## Status: 2026-05-24 — backlog cleared

All headline stubs shipped:

- ✅ `feed` ranking — real engagement-based ranker (`rank-for-you` /
  `record-interaction`); shipped in the 39-batch run
- ✅ `anon` E2E encryption — real X25519 + AES-256-GCM via Node `crypto`;
  shipped in the 39-batch run
- ✅ `social` workflow — full FeedView + PostCard + PostDetail + ReplyTree;
  shipped in the 39-batch run
- ✅ `code` Live Share — **Y.js CRDT** via `server/lib/yjs-realtime.js` +
  the new `useYjsDoc` hook; concurrent overlapping edits merge
  structurally
- ✅ `collab` co-editing — same Y.js CRDT infrastructure, bound to
  `Y.Text("content")` per document; replaces the prior lamport-clock
  last-write-per-element layer
- ✅ `healthcare` telehealth — **in-lens WebRTC video tile**
  (`TelehealthVideoCall.tsx`) with `simple-peer` + Concord Socket.IO
  signalling (`server/lib/webrtc-signalling.js`); local + remote tiles,
  mute/cam controls, clean tear-down. Daily.co handoff retained for orgs
  that prefer Daily's SFU.

Spec README's "91% parity / 0 buildable backlog" claim is now true
per-item. The lenses that haven't reached literal category-leader depth
are ones where parity requires content (Spotify catalog, Wikipedia
article volume) or design decisions beyond the scope of an upgrade
backlog (custom recommender architectures, voice/audio licensing) —
those remain "structural gaps" rather than buildable features.

Remaining nice-to-haves (lower priority than this file's prior contents):

- Shared debugging + terminal sharing in Code Live Share (the 2pp gap
  to literal VS Code Live Share). Y.js CRDT is the hard part; sharing
  the debug protocol is incremental on top.
- Multi-party telehealth (today is 1:1; the room can hold N peers but
  the UI tile-layout assumes 1+1). Extension is straightforward — keep
  a Map<peerId, SimplePeer> instead of a single peer ref.
- True CRDT-aware version snapshots for collab (current snapshots are
  text-only; capturing the Y.Doc binary state lets users undo/redo
  across history boundaries).

These are improvements, not backlogged "missing" features. The depth
grader still reports 1.000 weighted; the verifier still reports
234 WIRED / 1 NO-BACKEND-CALL (ux-suite by design).
