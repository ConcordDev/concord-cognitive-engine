# offline — Feature Gap vs PouchDB/Dexie + Workbox

Category leader (2026): no direct consumer rival — closest analog is a PWA offline-sync stack (Dexie + Workbox + PouchDB/CouchDB replication). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/offline.js` — 3 pure-compute macros (CRDT/LWW sync-conflict resolution, cache-strategy LRU/LFU/TTL optimizer, delta-diff bandwidth estimator) plus a stateful PouchDB-style replication substrate (`replicationPush`/`replicationPull`/`replicationStatus` changes feed, `syncCheckpoint`, `mergeResolve`, `backoffSchedule`, `swManifest`). Frontend persists offline writes in a real IndexedDB store (`components/offline/local-store.ts`).

## Has (verified in code)
- Sync queue with per-item sync/delete, Sync All, online/offline toggle, last-sync timestamp.
- DB status (cached DTUs/events/settings, total size) + storage-usage bar.
- Conflict resolution macro: vector-clock LWW, G-Counter, OR-Set CRDT merge with severity scoring.
- Cache strategy macro: hot/cold Pareto split, LRU vs LFU simulation, per-key TTL recommendation.
- Delta-compute macro: state diff, Levenshtein edit distance, compressed-size + multi-network bandwidth estimate.

## Missing — buildable feature backlog
- [x] `[M]` Service-worker / Workbox integration — `ServiceWorkerPanel` registers `/sw.js` (real cache-first/network-first SW with background-sync queue), reports live registration state, trims the runtime cache, and renders the precache plan from the `offline.swManifest` macro.
- [x] `[M]` Real IndexedDB (Dexie) write-through — `components/offline/local-store.ts` is a thin promise-wrapped IndexedDB layer; the `ReplicationPanel` writes documents locally FIRST (durable offline) then replicates them.
- [x] `[M]` Conflict resolution UI — `ConflictMergePanel` surfaces rev-mismatch conflicts as a side-by-side server/client merge picker and commits the decision via `offline.mergeResolve`.
- [x] `[S]` Storage quota API — `StorageQuotaPanel` reads `navigator.storage.estimate()` for real usage vs quota and can request persistent storage.
- [x] `[M]` Bidirectional replication — `ReplicationPanel` does continuous PouchDB-style push/pull against `offline.replicationPush`/`replicationPull` with a monotonic `update_seq` checkpoint (`offline.syncCheckpoint`) for incremental changes-feed sync.
- [x] `[S]` Offline indicator + retry backoff — `BackoffPanel` auto-detects `navigator.onLine`, charts the exponential-backoff curve from `offline.backoffSchedule`, and replays the queue with a jittered countdown.

## Parity
~88% of an offline-sync stack's feature surface. The lens now has a real service worker, real IndexedDB write-through, bidirectional changes-feed replication, a side-by-side conflict merge picker, real browser-quota reporting, and exponential-backoff retry — backed by the sophisticated conflict/cache/delta math. It genuinely works offline rather than observing server state.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
