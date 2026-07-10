# Queue — capability map (Wave 2 batch 7, Docs/B2B SaaS archetype)

## Parity target

Reference apps: **Sidekiq** (Redis-backed Ruby job queue — queues, dead-letter/
retry, worker dashboard, latency histograms) and **BullMQ Board** (Node job
queue UI — priority lanes, scheduled/delayed jobs, throughput charts). Framing:
"the only difference should be that this queue is backed by in-memory
per-user state instead of Redis, nothing else."

## Backend macro surface (`server/domains/queue.js`, 17 macros)

| Macro | Shape | Disposition before this pass | Disposition after |
|---|---|---|---|
| `queues` | list queues + live counts/paused/concurrency | ALREADY REAL, designed (queue cards) | unchanged |
| `list` | list jobs, filter by queue/status | ALREADY REAL, designed (Jobs tab) | unchanged |
| `job-detail` | inspect one job + event history | ALREADY REAL, designed (detail drawer) | unchanged |
| `enqueue` | add a job | ALREADY REAL, designed (Enqueue form) | unchanged |
| `process` | run next eligible / a specific job | ALREADY REAL, designed ("Process next" + per-row) | unchanged |
| `retry` | requeue failed/dead job | ALREADY REAL, designed | unchanged |
| `dead-letter` | list/retry-all/purge dead jobs | ALREADY REAL, designed (Dead-letter tab) | unchanged |
| `remove` | delete a job | ALREADY REAL, designed | unchanged |
| `scheduled` | list delayed jobs | ALREADY REAL, designed (Scheduled tab) | unchanged |
| `control` | pause/resume + set concurrency | ALREADY REAL, designed (per-queue card) | unchanged |
| `workers` | register/list/stop workers | ALREADY REAL, designed (Workers tab) | unchanged |
| `metrics` | totals, byPriority, throughput series, alerts | ALREADY REAL, designed (stat tiles, charts, priority lanes, alert banners) | unchanged |
| `events` | recent activity feed | ALREADY REAL, designed | unchanged |
| `clear-completed` | bulk-clear completed jobs | ALREADY REAL, designed | unchanged |
| `queueAnalytics` | queueing-theory model (M/M/1, M/M/c, Erlang C, service-time distribution) from `{arrivals[], completions[], servers}` | **UNSURFACED — zero callers anywhere in the frontend** | wired: `QueueAnalyticsPanel` "Queueing Theory" tab, auto-derives arrivals/completions from every real job's `createdAt`/`finishedAt` |
| `prioritySchedule` | weighted-fair / deadline-monotonic / priority-preemptive scheduling simulation + fairness (Jain's index) + starvation detection | **UNSURFACED — zero callers** | wired: `QueueAnalyticsPanel` "Priority Scheduling" tab, simulates over the real pending/scheduled job population |
| `backpressure` | fill-ratio, backpressure signal, adaptive throttling tiers, trend | **UNSURFACED — zero callers** | wired: `QueueAnalyticsPanel` "Backpressure" tab, ingress/egress measured from real job timestamps over the last 5 minutes |

## What was genuinely wrong

Nothing was fake or generic-CRUD-disconnected. The 14 job-lifecycle macros
were already a complete, well-designed BullMQ-style console (`page.tsx` +
`JobList`/`JobDetailDrawer`/`EnqueueForm`/`QueueRepos`). The one real gap: the
domain's three analytical macros (queueing theory, priority scheduling,
backpressure — ~150-200 LOC of real math each: Erlang C, weighted-fair-queuing
virtual-time scheduling, Jain's fairness index) had **no UI caller anywhere**
— confirmed by grep across `app/` and `components/`. They were reachable only
through the generic capability-list body, which is not a designed feature per
the program's own definition.

## Fix

New `components/queue/QueueAnalyticsPanel.tsx`, mounted as a 5th "Analytics"
tab (keyboard shortcut `a`). No manual JSON/form entry needed for the primary
path — every input is derived from the queue's own live job population
(arrivals from `createdAt`, completions from `finishedAt`, servers from the
live worker count, ingress/egress from a real 5-minute window), with the
scheduling-algorithm choice and target-capacity/fill-ratio as the only user
controls (both genuinely operator-facing parameters, not workarounds for
missing data). This is the same "wire real analytics off the lens's own real
data" pattern used for `metalearning`/`anon`/`fork` in the prior batch.

The generic auto-discovered capability-list section (the collapsible "Lens
Features" body) was also removed — redundant now that every macro has a real
caller.

## Verify gate

- `npx eslint` on touched files: clean.
- `npx tsc --noEmit -p .`: 0 errors in `queue`-scoped files (unrelated
  transient errors exist in `export/legacy/audit/schema/projects` — those
  belong to sibling agents' concurrently in-flight edits in this shared
  worktree, confirmed via `git status`).
- `node scripts/verify-lens-backends.mjs`: `queue` stays WIRED; total
  unchanged at 258 WIRED / 2 NO-BACKEND-CALL.
- `node scripts/grade-ux-polish.mjs --honest`: `queue` → `tier: "polished"`,
  `isGenericScaffold: false` (was `functional`/`true` before this pass).
- No dedicated `queue` lens vitest file exists in `concord-frontend/tests/` —
  none was added; the existing behavioral coverage is the backend's own
  `server/domains/queue.js` macro tests plus the eslint/tsc/verifier/grader
  gate above.
