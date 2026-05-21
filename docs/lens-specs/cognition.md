# cognition — Feature Gap vs (reasoning-substrate console)

Category leader (2026): no direct consumer rival — internal cognition-substrate surface. Closest analog is an AI reasoning-trace inspector (LangSmith / OpenAI reasoning logs).
Backend: macros `hlr.run/trace/list_traces/metrics/findings` (7 reasoning modes), `hlm.run/clusters/gaps/redundancy/orphans/topology/domain_census/freshness/metrics` (lattice topology), `cognition.understand/live_understanding`; surfaces breakthrough-clusters + drift-monitor.

## Has (verified in code)
- HLR: 7 reasoning modes (deductive/inductive/abductive/adversarial/analogical/temporal/+) with traces + metrics + findings
- HLM lattice topology: clusters, knowledge gaps, redundancy, orphans, domain census, freshness
- Breakthrough-cluster cross-domain synthesis; drift detection scan
- BrainPoolStatus; understanding evolution; live-understanding view

## Missing — buildable feature backlog
- [ ] `[M]` Visual reasoning-trace tree (expand/collapse each inference step)
- [ ] `[S]` Compare two reasoning modes side-by-side on the same prompt
- [ ] `[M]` Interactive lattice-topology graph (nodes = clusters, edges = relations)
- [ ] `[S]` Drift-alert timeline with severity filter
- [ ] `[M]` Reasoning-mode recommendation given a question type
- [ ] `[S]` Export a reasoning trace as a shareable artifact

## Parity
~60% of a reasoning-inspector's surface. The substrate is genuinely deep (7 HLR modes, full HLM topology, breakthrough synthesis, drift), but it is mostly tabular — the visual trace tree and topology graph that would make it explorable are missing.
