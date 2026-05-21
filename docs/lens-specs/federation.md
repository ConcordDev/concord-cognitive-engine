# federation — Feature Gap vs Mastodon / ActivityPub clients

Category leader (2026): Mastodon (fediverse instance + client). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `federation` domain macros (peers, activity) + REST `/api/federation/*` (status, instances, peers, search, probe, register, remove, sync).

## Has (verified in code)
- Network tab — federation status, instances, peer/trust graph
- Search tab — cross-instance search (`/api/federation/search?q=`)
- Peers tab — probe / register / remove peers
- Sync tab — manual sync trigger
- FediverseFeed component; federated-signal shadow-DTU activity stream
- Optional Bearer-token gating on the social-shadows export

## Missing — buildable feature backlog
- [ ] `[L]` Full ActivityPub actor/inbox/outbox — interoperate with real Mastodon servers, not just Concord peers
- [ ] `[M]` Follow remote accounts and see their posts in a home timeline
- [ ] `[M]` Boost / favourite / reply on federated posts
- [ ] `[M]` Local + federated public timelines (firehose views)
- [ ] `[S]` Instance blocklist / allowlist moderation controls
- [ ] `[S]` WebFinger account resolution (`@user@instance`)
- [ ] `[M]` Post composer that publishes outward to followers across instances

## Parity
~35% of Mastodon. It is a peer-mesh admin console for Concord-to-Concord federation, not an ActivityPub social client — no remote follows, no interaction on federated posts, no real fediverse interop.
