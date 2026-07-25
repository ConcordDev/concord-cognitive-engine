# Idle heap-growth measurement (2026-07-25)

Answers the question blocking a public launch: **is the backend's memory growth a leak
or normal GC pressure?**

**Verdict: a real, slow leak.** Sawtooth on a *rising floor* — GC reclaims, but the
retained baseline climbs. Measured under **zero load**.

## Method

Real `server.js`, bare `node` (no pm2), scratch DB, `--expose-gc`, no synthetic traffic.
`process.memoryUsage()` sampled every 30s for **46 minutes / 87 samples**. Two
`v8.writeHeapSnapshot()` captures (t≈130s and t≈2790s) diffed by constructor.

Raw data: `mem-samples.csv` in the run directory (not committed — regenerate with a new run).

## The curve

| t (s) | RSS MB | heapUsed MB |
|---:|---:|---:|
| 0 | 47 | 4 |
| 240 | 1151 | 210 |
| 480 | 1150 | 209 |
| 720 | 1149 | 209 |
| 960 | 1155 | 208 |
| 1200 | 1148 | **209** ← flat ends here |
| 1555 | 1263 | 339 |
| 1795 | 1206 | **285** |
| 2035 | 1280 | 339 |
| 2275 | 1263 | **338** |
| 2604 | 1319 | 362 |
| 2724 | 1339 | 415 |
| 2754 | 1396 | 470 (peak) |
| 2784 | 1284 | **360** |

Bold = local troughs. The peaks fall back — GC works — but each trough is higher than
the last: **209 → 285 → 338 → 360**. That rising floor is the leak.

Trough-to-trough rate: 7.7, 6.6, then 2.6 MB/min — averaging **~5–6 MB/min (≈300–350
MB/hr)**, decelerating somewhat over the window.

### The first 20 minutes are flat, and that matters

heapUsed sat at 208–210MB from t=240 to t=1200 with no drift at all, then began climbing.
**An observer who stops at 17 minutes concludes "no leak" and is wrong** — that mistake
was made during this very measurement and is corrected here. Any future check needs
≥30 minutes before it can claim anything.

The onset window (t≈1200–1555, wall-clock 21:36–21:42) contains nothing informative in
the server log — only the expected 2-minute `periodic_state_save` and a single
`event_loop_lag_spike`. **The growth is silent.** Worth noting that heartbeat frequency 80
(~20 min, `embodied-dream-cycle`) and 100 (~25 min, `forward-sim-cycle`) land near this
onset; that is a *lead to check*, not a conclusion.

## Snapshot diff (t≈130s → t≈2790s)

| Constructor | Δ self-size | Δ count |
|---|---:|---:|
| `Object` | +34.2 MB | **+439,087** |
| (string) | +31.1 MB | **+960,486** |
| (array) | +10.8 MB | +107,780 |
| `Array` | +3.3 MB | +107,320 |

Everything else is ~0. No class-specific growth, no `Worker`/`MessagePort`/`Statement`
accumulation, so it is **not** a handle or DB-cursor leak.

Self-size sums to ~79MB against ~260MB of heapUsed growth — expected, since self-size
excludes retained children. The signal is the *shape*: ~440k plain objects, ~960k strings
and ~107k arrays accumulating in generic containers. That is data being pushed into JS
structures and never released — consistent with the uncapped `STATE` maps flagged in the
durability audit (`STATE.dtus` and ~14 other maps are absent from
`memory-pressure.js#_aggressiveEviction`'s cap list).

**Not yet established: which structure.** Naming it needs retainer-path analysis, which
the constructor aggregation here does not do. That is the next step, not a solved item.

## What this does and does not explain

**Does:** an always-on server leaks with zero users. From a 209MB floor at ~300MB/hr,
the real bare-metal ceiling of **8192MB** (`ecosystem.config.cjs`, `--max-old-space-size=8192`)
is reached in roughly **a day of idle uptime**. For a service meant to stay up, that is a
launch blocker independent of traffic.

**Does not:** the original incident — 6,029MB in ~75 minutes under light browser probes.
That is ~50× this idle rate, so a second, faster, load-driven path very likely exists.
Idle-clean-then-leaky plus a much steeper load curve points at *both* a background
accumulation and a per-request retention path. Only the first is measured here.

## Bearing on `max_memory_restart`

`ecosystem.config.cjs` sets `max_memory_restart: '20G'` while V8 fatally aborts at the
8192MB heap ceiling (RSS ≈ 9–11GB). The graceful net cannot fire for this failure mode.
Idle RSS measured here is ~1.15GB steady, peaking 1.45GB — so a threshold in the **5–6G**
range would fire well before the V8 cliff and far above observed idle. Still wants a load
measurement before being set, since PM2 stops supervising after 10 restarts and an
over-eager trigger is its own outage.

## Reproduce

Boot `server.js` with `--expose-gc` and `MAX_OLD_SPACE_SIZE` in sync with
`--max-old-space-size`, sample `process.memoryUsage()` every 30s for **at least 40
minutes**, and compare trough-to-trough rather than peak-to-peak. Take
`v8.writeHeapSnapshot()` at both ends. Delete the snapshots afterwards — they were
184MB and 496MB here, and disk has filled twice during this work.
