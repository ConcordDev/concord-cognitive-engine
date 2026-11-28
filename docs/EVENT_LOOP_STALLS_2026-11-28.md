# Event-loop stalls under load (2026-11-28)

**Question:** why does the server stall under load to the point that the load shedder
rejects `POST /api/metrics/vitals`?

**Short answer:** the stalls come from synchronous work over the whole DTU set, and they grow
with the size of that set. On an empty database the same load gave **0 stalls and 0 rejections
in 500k requests**.

At 60k DTUs there are two offenders:
- **The worst one, fixed in this change:** the lattice audit compared every claim with every
  other claim, and held the loop for minutes at a time.
- **The steady one, written up below:** `dtu.list` (`GET /api/dtus`) scans every DTU on every
  call.

## How the shedder decides

`lib/request-admission.js` sheds anonymous ("sheddable") requests with a 503 once the p99
event-loop lag has stayed above 300 ms for 3 windows. The vitals beacon is anonymous, so it is
the first thing to go. Its own handler never fails. So "vitals rejected" really means the loop
was starved, and something else starved it.

## Method

- **Profiler:** `CONCORD_LAG_PROFILER=1` with a 480 s window and a 200 ms stall threshold. It
  logs `event_loop_busy_profile` with the owning frames, plus a `lag_profiler_summary`.
- **Database:** a seeded template with **60,005 DTUs**, all dated within the last 5 days so the
  7-day archive sweep leaves them hydrated. They hold **240,024 claims**.
- **Load:** a walker-like script. For every lens, 4 at a time, it sends:
  - `POST /api/lens/run`
  - `GET /api/lens/<lens>`
  - `GET /api/dtus?limit=20`
  - an anonymous `POST /api/metrics/vitals`
  - `GET /api/system/health`

  Each run is about 7 minutes, one server process at a time.

## Findings

### 1. The lattice audit's contradiction check: quadratic, minutes per run (fixed)

`emergent/index.js`, `repair.agent.tick`: the lattice audit compared every claim with every
other claim, looking for "X" against "not X". The loop stopped early only after finding 5
contradictions, and a healthy lattice has none, so it always ran to the end.

| Measurement (seeded lattice, 240,024 real claims) | Time |
|---|---:|
| old loop, first 20,000 claims only | **12.9 s** |
| old loop, all claims (quadratic extrapolation) | ~30 min |
| new pass (`lib/lattice-contradictions.js`), all claims | **125 ms** |

**First profile, while the audit ran:** it was the largest owner by far, **184 s in one busy
stretch**. That run also logged 291 rejected beacons, 35 requests over 2 s, and a worst request
of 5.5 s.

**The fix:** index the claims by text and look up each negated claim's un-negated twin. The
rule doesn't change: two claims from different DTUs contradict when one is the other with its
first `"not "` removed. That rule only matches exact strings, so an index finds the same pairs
in one pass. `server/tests/lattice-contradictions.test.js` pins:
- the same pairs, in the same order, as the old loop over 300 random lattices at limits 1, 3, 5
  and 1000;
- that a claim is never paired with its own DTU;
- 240k claims in under a second.

### 2. `dtu.list` scans every DTU on every call (not changed here)

**The A/B, same build with and without the fix, fresh copies of the 60k database, 7 minutes
each:** the audit did not come due inside either window, so the A/B does not measure the fix.
The rejection counts differ (73 with the fix, 0 without), but that difference is run-to-run
noise at the threshold, not an effect of the fix. What the A/B does show is the steady
offender. In both runs, **every logged `event_loop_burst_lag` window is owned by
`GET /api/dtus`**.

| | fixed run | main run |
|---|---:|---:|
| requests | 64,450 | 69,810 |
| rejected vitals beacons (503) | 72 | 0 |
| p99 lag in the burst windows | 223–812 ms | 218–526 ms |
| worst single `GET /api/dtus` | 2,483 ms | 576 ms |
| profiler owners: `dtu.list` (`server.js:28388` + `28246` + `dtuExcludedFromUserList`) | ~43 s | ~46 s |

Both runs sat right at the 300 ms line, and only the fixed run stayed above it for 3 windows.

**Where the time goes:** `userVisibleDTUs(userId).filter(...)`, then scope and visibility
filters, a sort and the domain/kind filters, all over every DTU. That costs 200–800 ms per call
at 60k DTUs, and spikes higher. The sort itself is not the cost: sorting 60k `createdAt`
strings takes 43 ms. The visibility scan is the cost.

**Already built for this:** the Rust DTU sidecar (`CONCORD_DTU_SIDECAR=1`, Concurrency Refactor
Phase 3) runs this filter off the loop. But:
- **Production doesn't enable it.** `ecosystem.config.cjs` and docker-compose don't set
  `CONCORD_DTU_SIDECAR`, so production runs the in-process scan on every call.
- **The lag bypass may feed the lag.** `_dtuSidecarLagBypass()` deliberately skips the sidecar
  once lag passes 250 ms. That was measured: under a starved loop the sidecar's reply queues
  behind everything. But it means that under load, each `dtu.list` falls back to the 200–800 ms
  scan, which adds to the lag that caused the fallback. It's worth re-measuring with the
  sidecar on before changing anything.

**Recommended next steps, in order:**
1. Turn the sidecar on in the A40 deployment and repeat this load.
2. If the bypass still feeds the lag, keep a per-viewer index of visible DTU ids, or cache the
   first page per viewer, invalidated on DTU write. `noteDtuWrite` already stamps the last
   write time.

### 3. Boot: `retroTagAllDTUs` and consolidation saturate the first ~75 s

These are **not** the trigger in steady state.
- **`retroTagAllDTUs`** (`server.js:92064`) re-tags every DTU at boot. It already yields every
  200 DTUs, and `autoClassifyDTU` costs about 0.25 ms per DTU (14.7 s over 60k). The profiler's
  "30.7 s stretch" is continuous busy time with requests interleaved, not one 30 s freeze. The
  lag windows from that period are owned by `GET /api/dtus` as well.
- **`heartbeat:consolidation`** logged one 1.6–1.9 s `event_loop_block` about 60 s after boot,
  in both runs.

### 4. Synchronous SQLite: `slowSyncIoWrapper` (~47 s in the first profile)

`lib/slow-sync-io.js:116` is the wrapper around synchronous `better-sqlite3` and `fs` calls, so
its time is time spent inside slow statements. The first profile also ran with a large WAL and
heavy checkpoints after seeding, which this load inflates. In the A/B runs, with fresh database
copies, it fell to 2–4 s. Its `slow_sync_io` records name the statements, so check those before
a production-size run.

## Also found

**The audit misreads lineage.** Its stale check uses `(dtu.lineage || []).length > 0`, but most
DTUs carry `lineage` as an object (`{ parents, children }`, for example `server.js:6028`), whose
`.length` is undefined. As a result:
- every DTU older than 7 days with object lineage is reported as having no lineage (false
  stale reports);
- the orphaned-lineage check (`Array.isArray(dtu.lineage)`) skips object lineage entirely.

This is a correctness problem in the audit's report, not a performance one. It's left for a
follow-up with its own test.

## Reproduce

```
# seed a 60k-DTU database (timestamps within 5 days), then:
CONCORD_LAG_PROFILER=1 CONCORD_LAG_PROFILER_DURATION_MS=480000 CONCORD_LAG_PROFILER_STALL_MS=200 \
  PORT=5071 DB_PATH=<copy of the seeded db> node --max-old-space-size=8192 --expose-gc server.js
# drive load (lens list + /api/dtus + anonymous vitals + health), then read
#   event_loop_busy_profile / event_loop_burst_lag / lag_profiler_summary from the log
node --test tests/lattice-contradictions.test.js
```
