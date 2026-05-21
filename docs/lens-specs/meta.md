# meta — Feature Gap vs Backstage / system-introspection tools

Category leader (2026): No direct consumer rival — internal/utility lens for system self-reflection. Closest analog: Backstage (developer portal / service catalog) + an observability dashboard. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/meta.js` — macros: systemReflection, actionAnalytics, qualityMetrics + SystemHealth component, code/file/dependency introspection.

## Has (verified in code)
- System reflection — introspect the platform's own structure (files, code, routes, packages)
- Action analytics — analyze macro/action usage and outcomes
- Quality metrics — compute platform quality indicators
- System health panel — live health snapshot
- Code/file tree browser, dependency view, route inventory surfaces
- Realtime indicator, DTU export

## Missing — buildable feature backlog
- [ ] `[M]` Service catalog — registry of all subsystems with ownership, status, dependencies
- [ ] `[M]` Dependency graph visualization — render the module/lens dependency network
- [ ] `[M]` Live metrics dashboards — time-series charts of heartbeat rate, macro latency, errors
- [ ] `[S]` Health-check aggregation — green/yellow/red roll-up per subsystem
- [ ] `[M]` Change/deploy timeline — what shipped when, tied to system state
- [ ] `[S]` Alert surface — surface Prometheus alerts (heartbeat stopped, overrun) in-lens
- [ ] `[M]` API/macro explorer — searchable catalog with try-it-now per macro

## Parity
~40% of a developer-portal + observability surface. Real self-introspection (system reflection, action analytics, quality metrics, health), but missing the service catalog, dependency-graph visualization, live time-series dashboards, and alert surfacing that make an internal platform observable.
