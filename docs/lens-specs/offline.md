# offline — Feature Gap vs PouchDB/Dexie + Workbox

Category leader (2026): no direct consumer rival — closest analog is a PWA offline-sync stack (Dexie + Workbox + PouchDB/CouchDB replication). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/offline.js` — 3 pure-compute macros (CRDT/LWW sync-conflict resolution, cache-strategy LRU/LFU/TTL optimizer, delta-diff bandwidth estimator); page also uses `/api/db/status` + `/api/db/sync` and generic `/api/lens` sync-item store.

## Has (verified in code)
- Sync queue with per-item sync/delete, Sync All, online/offline toggle, last-sync timestamp.
- DB status (cached DTUs/events/settings, total size) + storage-usage bar.
- Conflict resolution macro: vector-clock LWW, G-Counter, OR-Set CRDT merge with severity scoring.
- Cache strategy macro: hot/cold Pareto split, LRU vs LFU simulation, per-key TTL recommendation.
- Delta-compute macro: state diff, Levenshtein edit distance, compressed-size + multi-network bandwidth estimate.

## Missing — buildable feature backlog
- [ ] `[M]` Service-worker / Workbox integration — actual offline asset caching + background sync registration, not just a queue UI.
- [ ] `[M]` Real IndexedDB (Dexie) write-through — the page imports Dexie naming but reads server `/api/db/status`; persist actual offline writes locally.
- [ ] `[M]` Conflict resolution UI — surface `syncConflict` results as a side-by-side merge picker, not a JSON dump.
- [ ] `[S]` Storage quota API — show real `navigator.storage.estimate()` usage vs browser quota.
- [ ] `[M]` Bidirectional replication — continuous changes-feed replication (PouchDB-style) instead of one-shot Sync All.
- [ ] `[S]` Offline indicator + retry backoff — auto-detect connectivity and replay queue with exponential backoff.

## Parity
~45% of an offline-sync stack's feature surface. The conflict/cache/delta math is genuinely sophisticated, but the lens has no real service worker or local persistence — it observes server state rather than working offline.
