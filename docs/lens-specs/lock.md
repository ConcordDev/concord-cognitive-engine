# lock — Feature Gap vs concurrency-debugging tools (Java Flight Recorder / lock profilers)

Category leader (2026): no direct consumer rival — internal/utility lens; closest analog is a concurrency lock profiler / deadlock analyzer (JFR, ThreadSanitizer). The lens also doubles as the platform "sovereignty / 70-lock" dashboard.
Backend: `server/domains/lock.js` registerLensAction macros (deadlockDetect, contentionAnalysis, fairnessScore).

## Has (verified in code)
- Deadlock detection — builds wait-for graph from lock holder/waiter data, DFS cycle detection, returns deadlock sets
- Lock contention analysis and fairness scoring
- 70-lock / sovereignty dashboard — invariant lock percentage, lock state, sovereignty setup/prompt flows
- Lock event history, security repos panel, realtime indicators

## Missing — buildable feature backlog
- [ ] `[M]` Live lock-hold timeline — visualize which thread held which lock when
- [ ] `[M]` Lock-ordering analysis — detect potential (not yet realized) deadlock from inconsistent acquisition order
- [ ] `[S]` Contention hotspot ranking — locks sorted by total wait time
- [ ] `[M]` Wait-for graph visualization (currently computed, not drawn)
- [ ] `[S]` Lock-acquisition stack traces / blame attribution
- [ ] `[M]` Throughput-under-contention modeling / Amdahl projection

## Parity
~45% of a lock-profiler's surface. Deadlock detection and fairness scoring are real and useful, but it operates on supplied lock snapshots — missing live timelines, lock-ordering pre-detection, and graph visualization that a concurrency profiler provides.
