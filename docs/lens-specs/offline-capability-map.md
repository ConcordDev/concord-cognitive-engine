# offline — capability map (Frontend Rebuild Program, Wave 2 batch 6)

This lens is a genuinely different kind of surface from most of the wave:
not a domain-content app (geology, ml, robotics) but a **meta/infrastructure
workbench for the offline-first sync substrate itself** — the thing a real
app's engineering team would use to develop and debug local-first sync, not
an end-user feature. The right reference apps are accordingly tooling, not
consumer apps: **PouchDB/CouchDB replication** (bidirectional push/pull,
`_changes` feed, revision conflicts) and **Workbox** (service-worker
caching strategies, install/update lifecycle) — both patterns this lens's
backend + browser-API surface already implements.

## Backend macro surface (verified via reading `server/domains/offline.js`)

`registerLensAction("offline", ...)` — 10 macros, all pure compute or
in-memory per-user replication/changes-feed state:

- **Sync intelligence (pure compute)**: `syncConflict`, `cacheStrategy`, `deltaCompute`
- **Replication (PouchDB-style)**: `replicationPull`, `replicationPush`, `replicationStatus`, `syncCheckpoint`
- **Retry**: `backoffSchedule`
- **Conflict resolution**: `mergeResolve`
- **Service worker**: `swManifest`

## Pre-existing frontend depth (found BEFORE this rebuild)

`concord-frontend/components/offline/` already had 7 files of real,
macro-and-browser-API-wired UI, plus a genuine local IndexedDB store
(`local-store.ts`) backing the replication surface:

- `ReplicationPanel.tsx` — the centerpiece: writes go to IndexedDB **first**
  (real offline-durable local writes, editable/deletable in the UI), then
  `replicationPush`/`replicationPull`/`replicationStatus`/`syncCheckpoint`
  drive a real incremental changes-feed sync with a monotonic checkpoint, an
  optional 12s continuous-replication poll, and a replication event log.
- `ConflictMergePanel.tsx` — side-by-side server-vs-client picker wired to
  `mergeResolve`, fed real conflicts surfaced by a push.
- `BackoffPanel.tsx` — `navigator.onLine` + `backoffSchedule` jittered
  retry-plan display.
- `ServiceWorkerPanel.tsx` — registers a real `/sw.js` and reads
  `swManifest`.
- `StorageQuotaPanel.tsx` — real `navigator.storage.estimate()` browser API,
  not a fabricated quota number.
- `SyncAnalysisPanel.tsx` — the three pure-compute macros (`syncConflict`,
  `cacheStrategy`, `deltaCompute`) run against real local data and rendered
  as purpose-built charts.
- `OfflineRepos.tsx` — live GitHub topic search (offline-first/pwa/
  service-worker/crdt/local-first), real external API data.

All 10 backend macros were already surfaced through real, designed UI
before this rebuild touched anything — confirmed by cross-referencing every
`registerLensAction("offline", ...)` name against `lensRun('offline', …)`
call sites in the component tree. There is no unsurfaced macro. The one
`Math.random()` in this tree (`ReplicationPanel`'s event-feed entry key,
`${Date.now()}-${Math.random()}`) is a React list-key generator, not
fabricated data.

## What was actually wrong

Exactly one defect class, matching the pattern found across this wave: the
page imported and rendered the generic manifest-driven action bar and the
generic lens-feature-spec panel (behind a "Lens Features & Capabilities"
toggle) alongside the real bespoke depth above. Neither `analyze`,
`generate`, nor `suggest` is registered anywhere in `offline.js`, so the
generic action bar had nothing domain-specific to offer over the six real
panels already in place. The honest UX grader correctly flagged this and
capped the lens at `functional`.

No fabricated data, no dead buttons, and no generic-CRUD `useLensData`
store were found anywhere in the lens.

## What changed

- Removed the generic action-bar and lens-feature-panel body from the page
  (import + JSX usage both gone), along with the now-unused `showFeatures`
  toggle state and its icon imports. Nothing else in the page or its
  components was touched — every panel and macro call was already a real
  designed feature.

## Reference-parity checklist (PouchDB/CouchDB replication + Workbox shape)

| Capability | Disposition | Where |
|---|---|---|
| Local-first durable writes (survive offline) | ALREADY REAL | `ReplicationPanel` (IndexedDB `local-store.ts`) |
| Bidirectional push/pull replication | ALREADY REAL | `ReplicationPanel` (`replicationPush`/`replicationPull`) |
| Incremental changes-feed with checkpoint | ALREADY REAL | `ReplicationPanel` (`replicationStatus`/`syncCheckpoint`) |
| Continuous (live) replication mode | ALREADY REAL | `ReplicationPanel` (12s poll toggle) |
| Revision-conflict detection + side-by-side resolution | ALREADY REAL | `ReplicationPanel` (surfaces conflicts) + `ConflictMergePanel` (`mergeResolve`) |
| Exponential-backoff retry scheduling | ALREADY REAL | `BackoffPanel` (`backoffSchedule`) |
| Service-worker registration + cache manifest | ALREADY REAL | `ServiceWorkerPanel` (`swManifest`) |
| Browser storage-quota visibility | ALREADY REAL | `StorageQuotaPanel` (`navigator.storage.estimate()`) |
| Sync-conflict / cache-strategy / delta-size analysis on real local data | ALREADY REAL | `SyncAnalysisPanel` (`syncConflict`/`cacheStrategy`/`deltaCompute`) |
| Real-world tooling reference (PWA/CRDT/local-first repos) | ALREADY REAL | `OfflineRepos` (live GitHub search) |
| Filtered/scoped replication (per-collection or per-query sync, CouchDB `_filter`-style) | GENUINELY MISSING | `replicationPull`/`replicationPush` operate over the whole per-user document set; there's no filter-function concept in `offline.js`. Deferred — a real scoped-replication feature would need a new macro parameter + backend filter evaluation, out of scope for a UI-parity pass. |
| Multi-device conflict provenance (which device wrote which revision) | GENUINELY MISSING | The `local-store.ts` / `mergeResolve` model tracks revisions but not a device/origin id. Deferred — would need a schema change to `offline.js`'s in-memory doc model. |

## Verify-gate results

- `npx eslint app/lenses/offline/page.tsx components/offline/*.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `npx vitest run tests/components/ServiceWorkerPanel.test.tsx tests/lib/offline-db.test.ts` — 8/8 and 28/28 passing (unchanged; neither test targets the page body that was edited).
- `node scripts/verify-lens-backends.mjs` — `offline` stays WIRED; total unchanged at 258 WIRED / 2 NO-BACKEND-CALL / 260.
- `node scripts/grade-ux-polish.mjs --honest` — `offline` now `tier: "polished"`, `isGenericScaffold: false` (was `functional`/`true` before).
