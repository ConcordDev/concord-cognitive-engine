# Federation Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.
>
> This lens is cross-instance federation (peer discovery, DTU flow between
> Concord instances, ActivityPub) — not to be confused with `feed`
> (in-app content feed), audited separately in this wave.

## Backend surface — three separate registration sites

```
grep -c 'registerLensAction("federation"' server/domains/federation.js
```
→ **22** macros in `server/domains/federation.js` (658 lines): peer
discovery/status (`peers`, `activity`), allow/blocklist defederation
(`setPeerPolicy`, `listPeerPolicies`, `removePeerPolicy`,
`checkPeerAllowed`), inbound moderation (`reportInbound`,
`listModerationQueue`, `reviewInbound`), sync scheduling (`setSyncPolicy`,
`listSyncPolicies`), relay subscriptions (`subscribeRelay`, `listRelays`,
`pollRelay`, `unsubscribeRelay`), trust scoring (`recordTrustEvent`,
`trustHistory`), activity metrics (`recordMetric`, `metricsDashboard`), and
signed-actor key management (`registerActorKey`, `verifyActorSignature`,
`listActorKeys`). `node scripts/lens-unsurfaced.mjs --lens federation` →
before this pass, `1/22 macros never referenced` (`checkPeerAllowed`); after,
**`0/22`**.

**A second registration site the static scanner cannot see**:
```
grep -n 'register("federation"' server/server.js
```
→ **8 more macros**, registered directly in `server.js` via `register()`
(the `MACROS` map, not `LENS_ACTIONS`), in two sub-clusters:
- **ActivityPub identity** (Phase 6.3 + Phase 8.2, `server.js:75804-75821`
  + `:76019-76041`): `actor`, `outbox`, `inbox`, `inbox_receive` — real W3C
  ActivityPub reads over `server/lib/activitypub-bridge.js` (`buildActor`,
  `readOutbox`, `readInbox`, `receiveActivity`), backed by real
  `activitypub_outbox`/`activitypub_inbox` tables. `actor` returns a
  spec-conformant ActivityStreams `Person` descriptor; `outbox`/`inbox`
  read the calling user's own sent/received activity streams.
- **Communes** (Phase 6.2, `server.js:75707-75801`): `commune_create`,
  `commune_join`, `commune_list`, `commune_status` — "a federated peer-set +
  shared lens-anchor pool" (the code's own comment), backed by real
  `communes`/`commune_members` tables (lazy-created), founder/member roles.

`scripts/lens-unsurfaced.mjs` only scans `server/domains/*.js`
(`DOMAINS = path.join(ROOT, 'server/domains')`), so these 8 macros are
structurally invisible to it — exactly the class of gap this wave's brief
asked to look past the narrow detector for. Confirmed genuinely unsurfaced
(not a false miss) via the same loose token-match the script itself uses:
`grep -rqE "['\"]$m['\"]" app components lib` for each of the 8 names —
`actor` and `inbox` returned false-positive hits (`type Tab = 'inbox' |
'sent' | 'compose'` in the unrelated `mail` lens; `requiredFields: [...,
'actor', ...]` in an audit-log schema in `productization-roadmap.ts`), and
the other 6 had zero hits at all.

**A third registration site with the same domain string is unrelated**:
`server.js:55586-55620` implements a SEPARATE, older ActivityPub-adjacent
system (`POST /api/federation/inbox`, `server/lib/federation-outbox.js`,
migration 198's `federation_inbox`/`federation_outbox`/
`federation_peer_actors` tables — Phase 11 Item 12) wired directly as a REST
route, not through any macro. It coexists with, and appears to duplicate
some of, the Phase 6.3/8.2 ActivityPub-bridge cluster above (different
tables, different code path, no macro surface). This is a backend
architecture question — not something this frontend-focused pass resolves
— noted here for the record. The macros this pass wired
(`federation.actor/outbox/inbox`) are the real, functional
`activitypub-bridge.js` path; that's the one with a macro surface a lens
can call.

The Network/Search/Peers/Sync tabs on the existing page use a **fourth
surface**: direct REST calls to `/api/federation/status|instances|peers|
probe|register|remove|search|sync` (not through `lensRun`/macros at all —
confirmed real routes, not fabricated, by reading the page's `fetch(...)`
calls against `server.js`'s route table). This is a legitimate, working
peer-management surface; it's simply a different wiring mechanism (REST
route vs. macro) than the rest of the lens.

## Reference app

**Mastodon/Fediverse instance admin** — peer allow/blocklist (defederation),
inbound moderation queue, relay subscriptions, trust/metrics dashboards,
signed-actor key rotation (already well-built) + **ActivityPub identity**
(actor descriptor, outbox/inbox — the part that was missing) + **Lemmy-style
communities/communes** (federated peer-groups, the part that was missing).

## Classification (before this pass)

**Mixed, in the "hidden second cluster" shape**: the 22 `registerLensAction`
macros were already very well surfaced across 8 real, substantial
components (`PeerPolicyPanel`, `ModerationQueuePanel`, `SyncPolicyPanel`,
`RelayPanel`, `TrustHistoryPanel`, `MetricsDashboardPanel`,
`ActorKeysPanel`, `TrustGraphView`) plus the REST-driven Network/Search/
Peers/Sync tabs — all real, all reading and writing genuine state, no
fabrication found (`grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem"
app/lenses/federation/page.tsx components/federation/*.tsx` → zero hits).
`FediverseFeed` is an honest, live external-data panel (real-world Reddit
r/fediverse/r/Mastodon/etc. discussion, matching the `eco`/`experience`
"reference-app content panel" pattern) — not a stand-in for this instance's
own federation identity.

But **8 real macros for 2 genuine features (ActivityPub identity, Communes)
had zero UI anywhere** — not a disabled button, not a wrong-domain detour,
just never built. `checkPeerAllowed` (1 macro) was also a small, real,
reachable gap: a "test a domain's effective policy" utility with no button.

## What changed

- **`concord-frontend/components/federation/FediverseIdentityPanel.tsx`
  (new)** — "My ActivityPub identity": the calling user's real actor
  descriptor (`federation.actor` — handle, canonical id, inbox/outbox URLs,
  whether a signing key is configured), their outbox (`federation.outbox`
  — real sent federated activities), and inbox (`federation.inbox` — real
  received activities), with honest empty states ("No federated activity
  sent yet"). `federation.inbox_receive` is deliberately NOT surfaced —
  documented in the component's header comment as the internal handler for
  the PUBLIC `POST /api/federation/users/:userId/inbox` delivery route that
  remote peers call, not something a user triggers directly (the same
  disposition class as any webhook receiver — real, correctly unsurfaced,
  not a gap).
- **`concord-frontend/components/federation/CommunesPanel.tsx` (new)** —
  browse public communes (`commune_list`), create one (`commune_create`),
  open one to see real members + roles (`commune_status`), join
  (`commune_join`) with a founder crown badge and idempotent re-join
  handling.
- **`concord-frontend/app/lenses/federation/page.tsx`** — added a
  "Fediverse" tab (keyboard `f`) mounting both new panels; extended the
  `Tab` union and the keyboard-command list.
- **`concord-frontend/components/federation/PeerPolicyPanel.tsx`** — added
  a small "Check a domain's effective policy" inline utility wiring
  `checkPeerAllowed`, showing the real allowed/blocked verdict plus which
  policy row (or "default") produced it — lets an operator test a domain
  before deciding whether to add an explicit policy row.
- **`server/tests/depth/federation-activitypub-commune-behavior.test.js`
  (new)** — the ActivityPub-identity + Communes macro clusters had **zero**
  test coverage before this pass. 8 behavioral tests via `macroRuntime`:
  `actor` builds a spec-shaped `Person` (correct id/inbox/outbox URLs);
  `outbox`/`inbox` return `{ok, items:[]}` for a fresh user; `commune_create`
  rejects a missing name and auto-joins the founder with role `founder`;
  `commune_join` adds a second member without duplicating the founder and
  is idempotent on re-join; `commune_list` returns only public communes;
  `commune_status` on an unknown id fails honestly (`not_found`), not with
  fabricated data.

## Verification

- `cd concord-frontend && npx eslint app/lenses/federation/page.tsx components/federation/PeerPolicyPanel.tsx components/federation/FediverseIdentityPanel.tsx components/federation/CommunesPanel.tsx` — clean, exit 0.
- `cd concord-frontend && npx tsc --noEmit -p .` filtered to `federation/` — 0 errors (one pre-fix type mismatch on `commune_create`'s failure shape found and fixed during this pass).
- `node scripts/lens-unsurfaced.mjs --lens federation` → `0/22` (was `1/22`).
- `node scripts/verify-lens-backends.mjs` → unaffected, `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260.
- `cd server && node --test tests/federation-domain-parity.test.js tests/federation-lens-macros.test.js tests/federation-mesh.test.js tests/federation-outbox.test.js tests/federation.test.js` → `164 pass / 0 fail` (pre-existing, unaffected).
- `cd server && node --test tests/depth/federation-activitypub-commune-behavior.test.js` → new file, all assertions pass.
- `cd server && npx eslint tests/depth/federation-activitypub-commune-behavior.test.js` — clean, exit 0.
- Did not touch `server/domains/federation.js`, `server/server.js`, or any
  of the 8 pre-existing frontend files beyond the two edits listed above —
  no further gap found in any of them after a full read.
