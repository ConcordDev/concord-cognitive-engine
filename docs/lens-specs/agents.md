# agents — Feature Gap vs OpenAI Assistants / CrewAI

Category leader (2026): OpenAI Assistants / CrewAI agent platforms. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/agents.js` (86 LOC, thin) — macros `evaluateCapability`, `routeTask`, `swarmStatus`, `benchmarkAgent`; generic artifact store for agent definitions.

## Has (verified in code)
- Agent roster with 6 types (general/research/critic/synthesizer/monitor/orchestrator)
- Per-agent config: model, maxTokens, temperature, goals, tools (25 tool catalog)
- Detail tabs: overview, logs, memory, config; tick counts, success rate, latency
- Compute macros: capability eval, task routing, swarm status, benchmarking
- Create/enable/run, search + filter (all/active/dormant/error)

## Missing — buildable feature backlog
- [ ] `[L]` Real autonomous run loop — agents actually execute multi-step tasks on a tick
- [ ] `[M]` Tool-call inspector showing inputs/outputs per step
- [ ] `[M]` Agent-to-agent orchestration graph (orchestrator type has no wiring)
- [ ] `[M]` Scheduled / triggered agent runs (cron, webhook, event)
- [ ] `[S]` Conversation thread per agent with message history
- [ ] `[M]` Cost/token budget per agent with enforcement
- [ ] `[S]` Agent templates / marketplace import

## Parity
~40% of an agent platform's surface. The 86-LOC backend gives roster + config + metrics scaffolding, but the defining feature — agents autonomously executing real tasks — is not wired; this reads as an agent registry, not an agent runtime.
