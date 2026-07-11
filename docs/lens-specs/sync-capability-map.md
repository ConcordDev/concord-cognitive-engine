# Sync Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Backend surface enumerated by reading
> `server/domains/sync.js` (582 LOC) in full, plus one macro registered
> inline in `server/server.js`, confirmed with:
> `grep -rn 'register("sync",\|registerLensAction("sync",' server/domains/*.js server/server.js`
> → **16 macros** (15 `registerLensAction` in `domains/sync.js` + 1
> `register` in `server.js`, exact domain `"sync"` only — filtered out
> the unrelated legacy `dtu_sync` domain and the `mesh.sync` macro, both
> of which match a loose `sync` substring but are not this lens's
> domain). Frontend audited by reading `app/lenses/sync/page.tsx` (63
> LOC) and all 3 `components/sync/*.tsx` files (`SyncDashboard.tsx` 623
> LOC, `SyncRepos.tsx` 68 LOC, `SyncthingReleases.tsx` 86 LOC) in full —
> confirmed complete via `ls concord-frontend/components/sync/`.

## What this lens is

`/lenses/sync` — "DTU Sync," a cross-device synchronization *experience*
layer: a device registry (register/list/revoke), a manual "Sync now"
per device, an auto-sync toggle, selective sync (choose which DTU
collections a device pulls), an advisory storage quota, a
conflict-detection + resolution flow (keep local / keep remote / keep
both), an activity-feed timeline, and a real-data "what does the
category leader ship" reference panel pulling Syncthing's GitHub
releases. Framed in the page header as "iCloud-killer for thoughts. No
subscription." — a Dropbox/iCloud/Syncthing "device management" page,
not a literal running sync client.

**Sibling domain, deliberately separate:** the legacy `dtu_sync` domain
(`server.js:77302-77349`, DB-backed via the `dtu_sync_devices` SQLite
table) is the *actual* portable-pack mechanism — `dtu_sync.force_sync`
calls the real Phase 6b `dtu-portability.js#exportUserCorpus` to
produce a real SHA-256-hashed export envelope. It is not surfaced by
this lens's UI at all (dead capability, not touched this session — see
Genuinely-missing below). The `sync.js` domain file's own header
comment says it "mirrors / annotates" the legacy registry; in the code
as found, it does not (`register_device` never touches
`dtu_sync_devices`) — this is a pre-existing doc/code mismatch, noted
but not chased down this session since untangling it is an
architecture-level decision, not a lens-page bug.

## Backend surface — 16 macros, all real

`register_device`, `list_devices`, `sync_now`, `revoke_device`,
`set_auto_sync`, `set_scopes`, `available_scopes`, `heartbeat`,
`sync_history`, `report_conflict`, `list_conflicts`, `resolve_conflict`,
`sync_status`, `set_quota`, `syncthing_releases` (all
`registerLensAction`, `server/domains/sync.js`) + `force`
(`register`, `server.js:46768` — a distinct, older "list DTUs modified
since X" macro used only by the mobile PWA's "Force Sync" quick action
at `/api/sync/force`, per `server.js:46732` and `:46785`; not part of
this lens's page and left alone).

All per-user state (`devices`, `logs`, `conflicts`) lives in
`globalThis._concordSTATE.syncLens`, keyed by `userId`, following the
same in-memory pattern used by 241 other domain files (`grep -rl
"globalThis._concordSTATE" server/domains/ | wc -l`) — an established,
codebase-wide idiom, not a sync-specific shortcut.

## Reference app

Dropbox / iCloud Drive / Syncthing "manage devices" screens — device
list with online/offline presence, per-device selective sync, storage
quota, conflict resolution, activity log. The dark command-panel
layout (device cards, quota bars, conflict-resolution buttons, GitHub
release feed) reads as a real device-management console, not a generic
dashboard.

## Frontend → backend wiring

`SyncDashboard.tsx` (623 LOC) drives 13 of the 15 `registerLensAction`
macros directly via `lensRun`: `list_devices`, `sync_status`,
`list_conflicts`, `sync_history`, `available_scopes`, `register_device`,
`sync_now`, `revoke_device`, `set_auto_sync`, `set_scopes`,
`set_quota`, `report_conflict`, `resolve_conflict`. `SyncthingReleases.tsx`
calls `syncthing_releases`. `heartbeat` is the one genuinely unsurfaced
macro — see Genuinely missing.

`SyncRepos.tsx` fetches `api.github.com/search/repositories` directly
from the client rather than through a `cachedFetchJson` backend macro —
confirmed this is a deliberate, established, codebase-wide idiom (20
other `*Repos.tsx` components — `TelcoRepos`, `SchemaRepos`,
`SandboxRepos`, `MeshRepos`, `SecurityRepos`, etc. — all do the same
direct unauthenticated public-API fetch), not a sync-specific shortcut.

## What was found and fixed

Two real bugs found via instruction #6 (field-shape mismatches) and #4
(fabricated/simulated data), both in `sync_now` (`server/domains/sync.js`).

### 1. `sync_now` counted every user's DTUs, not just the caller's own

```js
// before
const all = STATE?.dtus ? [...STATE.dtus.values()] : [];
candidate = all.filter((d) => {
  const scope = d?.scope || d?.core?.scope || "personal";
  if (scope === "personal" && !dev.scopes.includes("personal")) return false;
  if (scope === "public" && !dev.scopes.includes("public")) return false;
  if ((d?.artifact || d?.artifactPath) && !dev.scopes.includes("artifacts")) return false;
  return true;
});
```

`STATE.dtus` is the whole-platform in-memory DTU map (every user's
DTUs — confirmed via `STATE.dtus.set(id, dtu)` call sites throughout
`server.js`, none scoped by user at the map level). The filter never
checked ownership, so clicking "Sync now" on your own device counted
(and quota-charged) the *entire platform's* non-personal-scoped DTU
corpus, not "your second brain" as the page promises. Confirmed real —
not a hypothetical: any two users on the same instance would have seen
the same inflated `dtuCount`/`bytes` regardless of what either of them
had actually authored.

**Fix:** added an ownership gate as the first filter predicate, reading
`ownerId` (the canonical creator field set by `dtu.create` at
`server.js:21287`: `ownerId: ctx?.actor?.userId`) with the same
fallback chain used by the platform's own `userVisibleDTUs()` helper
(`server.js:14604`: `d.author || d.ownerId || d.userId || d.createdBy`).

### 2. Selective-sync "Personal"/"Public" toggles filtered the wrong field, and artifact bytes were always 0

The pre-existing filter checked `d.scope === "personal"` /
`d.scope === "public"`. Real DTU `scope` values across the codebase are
technical/federation-placement tags — `local`/`global`/`world`/
`marketplace`/`synced_global`/`org_global` (`grep -oE 'scope:\s*"[a-z_]+"'
server/server.js | sort | uniq -c`) — literal `scope==="personal"`
appears only 3 times in the whole tree and `scope==="public"` never.
The real personal-vs-published axis on a DTU is the `visibility` field
(`server.js:21209-21213`: private by default, public for social
lenses; `published` after council promotion). Practical effect: for
the overwhelming majority of real DTUs, toggling "Personal DTUs" or
"Published DTUs" off in the Selective Sync UI did nothing — a designed
control with no functional effect, the same class of defect
`docs/UI_QUALITY_RUBRIC.md` and this file's zero-generic invariant flag
for "reads/writes fields that don't exist."

A companion byte-accounting bug: the quota estimate read
`d?.artifactBytes || d?.artifact?.bytes`, neither of which is ever set
anywhere in the codebase (confirmed by grep — the real field is
`artifact.sizeBytes`, set at `server.js:38846-38847` and read back at
`:38963-38969`). Every device's "storage used" therefore silently
counted **zero** bytes for any artifact, contradicting the lens page's
own header text: *"Phase 0 universal file format means any artifact
bytes ride along too."*

**Fix:** rewrote the classification to use `visibility`
(public/published → the "Published DTUs" bucket; everything else →
"Personal DTUs"), added a `meta.status === "draft"` check for the
"Drafts" scope (verified this is a no-op today since no live `dtus`
row currently sets `status` — `draft` defaults only exist on the
separate `lensArtifacts`/`paper`/`law.draft` substrates — so this is
forward-compatible, not a behavior change), and fixed the artifact-byte
read to `d?.artifact?.sizeBytes`. Left the "Shared with me" scope
un-filtered (documented in a code comment) — there is no per-DTU field
recording cross-user sharing grants today, and inventing one would be
exactly the fabrication this project's invariants forbid.

Diff is entirely inside `sync_now` in `server/domains/sync.js` — no
other macro touched.

## 1.5 Reference-parity checklist

| # | Item | Disposition |
|---|---|---|
| 1 | Device registry (register/list/revoke) | ALREADY REAL — `SyncDashboard` device cards |
| 2 | Manual "sync now" per device | ALREADY REAL, now correctly scoped to the caller's own DTUs (fixed this session) |
| 3 | Auto-sync toggle | ALREADY REAL |
| 4 | Selective sync (per-device collection filter) | ALREADY REAL, but 2 of 5 scopes were functionally inert — fixed this session |
| 5 | Storage quota + usage | ALREADY REAL; artifact-byte contribution was always 0 — fixed this session |
| 6 | Conflict detection + resolution (keep local/remote/both) | ALREADY REAL — `SyncDashboard` conflict panel |
| 7 | Activity feed / sync history | ALREADY REAL — `TimelineView` + log list |
| 8 | Presence (online/offline) | ALREADY REAL — derived from `lastSeenAt` freshness |
| 9 | "What the category leader ships" reference panel | ALREADY REAL — live Syncthing GitHub releases via `syncthing_releases` |
| 10 | Real-world sync tooling discovery | ALREADY REAL — `SyncRepos.tsx`, live GitHub search, same idiom as 20 sibling lenses |

**Coverage summary:** 10 of 10 checklist items were already real and
designed (no `<UniversalActions>`/generic button wall — confirmed by
the UX-polish grader: `bespokeRatio: 0.924`, `hasMacroButtonWall: true`
is a false-positive-prone heuristic field name but `isGenericScaffold:
false` and `importsGenericTrio: false` are the ones that matter and
both are clean). Two real correctness bugs found and fixed within
existing, already-designed features — not new capability, a repair of
what was already built.

## Genuinely missing (deferred, not faked)

- **`sync.heartbeat` is unsurfaced.** No frontend call anywhere
  (confirmed by grep across `concord-frontend/`). Left unwired
  deliberately, not by omission: a registered "device" here is a
  user-typed label (e.g. "MacBook Pro"), not bound to the browser tab
  running the dashboard, so there is no honest way for this page to
  know *which* labeled device it should be heartbeating on an interval
  — auto-heartbeating every registered device from one open tab would
  be exactly the kind of fabricated-presence the honesty invariant
  forbids. This only becomes wireable once a real native/agent client
  exists that can identify itself. ENGINEERING-class gap, not
  DATA-SOURCING or CURATION — ships only if/when a real client exists
  to be honest about.
- **The real portable-pack export (`dtu_sync.force_sync` →
  `dtu-portability.js#exportUserCorpus`, real SHA-256-hashed envelope)
  is not wired into this lens.** `sync_now` reports a real DTU count
  and real artifact-byte total (after this session's fixes) but does
  not produce a downloadable/verifiable pack the way `dtu_sync.force_sync`
  already does. Classed ENGINEERING: the pieces exist and are tested,
  wiring them together is a deliberate architecture decision (the two
  systems have different selective-sync semantics — `exportUserCorpus`
  has no per-scope filter) best done as its own reviewed change, not
  folded into a Wave-3 audit fix.

## Verification

- `cd server && node --test tests/sync-domain-parity.test.js` — **19/19 pass, 12/12 suites**.
- `cd server && node --test tests/depth/sync-behavior.test.js` — **1/1 pass** (boots the full server; exercises every macro via `lensRun`).
- `cd server && npx eslint domains/sync.js` — clean, 0 errors/warnings.
- `cd server && node --check domains/sync.js` — syntax OK.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged; `sync` not in the `NO-BACKEND-CALL` list (`narrative-walk`, `ux-suite` only), confirming it's still counted WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `sync`: `"tier": "polished"`, `"isGenericScaffold": false`, `"importsGenericTrio": false`, `"antiPatterns": 0` (checked `audit/ux-polish-honest.json`, not the non-honest file).
- `git checkout -- audit/` run after grading to discard the transient regenerated grader output.

## Files touched

- `server/domains/sync.js` — `sync_now` ownership + selective-sync +
  artifact-byte fixes (see above). No other file changed.
