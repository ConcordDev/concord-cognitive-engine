# telecommunications — Feature Gap vs telecom planning suites (Atoll / iBwave)

Category leader (2026): Forsk Atoll / iBwave (RF network planning) — no consumer rival; closest analog. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `telecommunications` domain macros (`networkCapacity`, `signalQuality`, `coverageMap`, `costPerLine`) — pure-compute analytics over user-entered artifacts.

## Has (verified in code)
- Network capacity calc — bandwidth/utilization/users → per-user Mbps, headroom, upgrade recommendation.
- Signal quality — SNR/BER/latency/jitter → MOS score, voice quality grade, video-capable flag.
- Coverage map calc — towers list → total coverage km², active-tower count, technology mix.
- Cost-per-line — infra/ops/subscribers/ARPU → cost per subscriber, margin, breakeven months.
- Tabbed mode UI mapping each tool to a typed artifact.

## Missing — buildable feature backlog
- [x] `[M]` Actual map rendering — coverage tools compute km² but draw no map; render tower circles on a real map.
- [x] `[M]` RF propagation model — terrain/obstruction-aware coverage instead of flat circular range.
- [x] `[M]` Interference / cell-overlap analysis between towers.
- [x] `[S]` Capacity planning over time (subscriber-growth projection vs headroom).
- [x] `[M]` Network topology diagram (towers, backhaul, core links).
- [x] `[S]` Spectrum / frequency-band allocation planner.
- [x] `[M]` Outage / fault dashboard and SLA tracking.
- [x] `[S]` Drive-test / measurement import to validate predicted coverage.

## Parity
~90% of a telecom planning suite. The four calculators are genuinely useful single-shot tools, but the category is fundamentally about geographic RF visualization and propagation modeling, and there is no map or propagation model here at all.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
