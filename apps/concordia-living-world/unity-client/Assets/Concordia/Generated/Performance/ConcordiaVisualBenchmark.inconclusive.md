# Concordia Visual Benchmark — INCONCLUSIVE

Status: INCONCLUSIVE

Benchmark scene: `Assets/Concordia/Generated/Performance/ConcordiaVisualBenchmark.unity`
Controller: `ConcordiaVisualBenchmarkController`
Configured profile: `Assets/Concordia/Generated/Performance/ConcordiaFrameBudgetProfile.asset`

## Configured measurement contract

- Warmup: 180 frames
- Sample duration: 30 seconds
- Minimum measured frames: 300
- GPU timing capture: enabled
- CPU/GPU budget: 16.67 ms

## Verification record

- The benchmark scene originally referenced a stale frame-profile GUID. The scene reference was corrected to the current profile asset GUID (`79a2e83afb0b44d0badae2f89006baba`).
- The first Play-mode attempt started at `2026-09-21T23:13:00.254776-04:00` and logged `Visual benchmark started: Hub_UnburnedCourt (warmup=180)`.
- That run also logged `Visual benchmark has no frame budget profile; using safe defaults`, confirming the stale scene reference prevented the configured profile from loading at runtime.
- No `latest-visual-benchmark.json` was produced, so no measured p95, p99, worst CPU frame, or GPU timing result exists to report.
- After the run, Unity reported project-owned compilation errors in `Assets/Concordia/Scripts/GameplayCore/Persistence/ConcordiaPersistenceService.cs` and `Assets/Concordia/Scripts/WorldBook.cs`, including merge-conflict markers. These files were not modified because persistence assets are explicitly protected.
- The editor subsequently reported `hasCompilationErrors: true` and the connection became unavailable, preventing a second complete Play-mode measurement.

## Metrics

No p95, p99, worst CPU, or GPU metrics were captured. PASS is not claimed.

## Blocker

A complete 30-second measurement requires the protected persistence/world scripts to compile cleanly. Resolve the existing merge-conflict markers in those protected files, then rerun this scene so the controller can persist `latest-visual-benchmark.json`.
