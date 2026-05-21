# queue — Feature Gap vs RabbitMQ / BullMQ dashboard

Category leader (2026): RabbitMQ Management / BullMQ-board (job/message queue console — no consumer rival). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/queue.js` — 3 macros (queueAnalytics, prioritySchedule, backpressure); page also reads REST `/api/status`, `/api/jobs/status`, and DELETE `/api/queue/:id`.

## Has (verified in code)
- Live queue counts from `/api/status` + job status from `/api/jobs/status`
- Remove a queued item via `DELETE /api/queue/:id`
- Queue analytics macro (throughput/latency stats), priority scheduling macro, backpressure analysis macro

## Missing — buildable feature backlog
- [ ] `[M]` Per-job detail + retry/requeue — inspect a job's payload, error, attempts; retry failed jobs
- [ ] `[M]` Failed/dead-letter queue view — list and bulk-act on failed jobs
- [ ] `[S]` Throughput + latency time-series charts — visualize processing rate over time
- [ ] `[S]` Pause/resume + concurrency controls — throttle a queue from the UI
- [ ] `[M]` Scheduled / delayed job view — see and manage future-dated jobs
- [ ] `[S]` Worker status — which workers are alive and what they're processing
- [ ] `[S]` Alert on queue depth / stalled jobs

## Parity
~40% of a queue-management console. It shows real queue/job counts and can remove items, and the analytics macros are useful, but it lacks per-job retry, a dead-letter view, and worker/throughput visibility — the operational core of a queue dashboard.
