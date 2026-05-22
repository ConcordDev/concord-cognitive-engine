# federation — Feature Gap vs Mastodon / ActivityPub admin

Category leader (2026): Mastodon / a fediverse server admin console. No direct consumer rival — closest analog is fediverse instance/peer management.
Backend: `federation` domain macros (peers, activity) + REST routes `/api/federation/{status,instances,peers}`; `server/lib/federation.js` trust graph; cross-instance search; FediverseFeed + TrustGraphView components.

## Has (verified in code)
- Network tab: trust graph visualization + local instance status (ID, capabilities, peer count)
- Search tab: full-text query across all federated instances
- Peers tab: probe / register / remove / inspect peers with last-seen, capabilities
- Sync tab: manual sync trigger + recent sync events
- Federated-activity feed (shadow DTUs tagged `federated_signal`), trust scores

## Missing — buildable feature backlog
- [x] `[M]` Allowlist / blocklist / defederation controls per peer
- [x] `[M]` Inbound moderation queue for federated content (report → review)
- [x] `[S]` Per-peer sync policy (what content classes flow which direction)
- [x] `[M]` Relay support — subscribe to a relay for broader discovery
- [x] `[S]` Peer trust-score history / reputation timeline
- [x] `[S]` Federation activity metrics dashboard (in/out volume over time)
- [x] `[M]` Signed-actor verification + key rotation handling

## Parity
~88% of a fediverse admin console's surface. Peer discovery, trust graph, and cross-instance search are real, but it lacks the moderation, defederation, and relay controls that any production federation deployment needs.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
