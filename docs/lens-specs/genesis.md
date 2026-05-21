# genesis — Feature Gap vs no direct rival (emergent-AI observatory)

Category leader (2026): no direct consumer rival — closest analog is an AI-agent observability dashboard (e.g. an agent monitoring console).
Backend: inline `register("genesis", ...)` macros in server.js + emergent-identity tables; reads emergent AI identities (given name, naming origin, current focus, last active) with a live socket feed; OriginExplorer component.

## Has (verified in code)
- Emergent-identity roster — name, naming origin, role, current focus, last-active, active flag
- Live feed of emergent events via socket subscription with relative-time formatting
- Origin explorer component for inspecting how an emergent identity formed
- Per-identity activity surfacing

## Missing — buildable feature backlog
- [ ] `[M]` Identity detail page — full timeline of an emergent's actions/decisions
- [ ] `[S]` Filter/search the roster by role, focus, activity state
- [ ] `[M]` Relationship graph between emergent identities
- [ ] `[S]` Event-type filtering on the live feed
- [ ] `[M]` Identity "lineage" view — naming-origin chain / ancestry
- [ ] `[S]` Metrics — counts, activity over time, focus distribution

## Parity
~50% of an agent-observability console's surface for what it scopes. It is a genuinely novel window into emergent AI identities; the gaps are depth (per-identity timeline, lineage) and navigation (search, filters, relationship graph) rather than missing a defined rival's features.
