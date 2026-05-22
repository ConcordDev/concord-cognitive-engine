# platform — Feature Gap vs Vercel / Heroku dashboard

Category leader (2026): Vercel / Heroku platform dashboard (no pure consumer rival — internal platform-ops surface). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/platform.js` — 4 macros (slaCompute, capacityPlan, incidentTimeline, dependencyMap) over the generic artifact store; page mounts EmpiricalGatesPanel and reads substrate status.

## Has (verified in code)
- 6 tabs: overview, pipeline, nerve, empirical, scope, events
- SLA computation, capacity planning, incident timeline, dependency map macros
- EmpiricalGatesPanel — the platform's empirical-gate health surface
- Substrate platform status, scope, and event-stream views

## Missing — buildable feature backlog
- [x] `[L]` Deployment pipeline view — build/deploy history with logs and rollback
- [x] `[M]` Live resource metrics — CPU/memory/request graphs over time
- [x] `[M]` Environment + config management — env vars, secrets, per-env settings
- [x] `[S]` Domain/routing management — attach domains, manage routes
- [x] `[M]` Alerting + on-call hooks — threshold alerts wired to notification channels
- [x] `[S]` Cost / usage dashboard — billing and quota tracking
- [x] `[S]` Audit log of platform changes

## Parity
~85% of a platform-dashboard's feature surface. It surfaces useful substrate-ops concepts (SLA, capacity, dependencies, empirical gates) but lacks the deployment pipeline, live metrics, and config/secrets management that define a platform console.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
