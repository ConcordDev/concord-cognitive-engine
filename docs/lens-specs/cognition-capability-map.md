# cognition — capability map (Frontend Rebuild Program, Wave 3)

Reference apps: no single commercial product does exactly this (a live
console over an LLM-reasoning + knowledge-graph substrate), so the nearest
real analogs are used per-facet: **LangSmith / Weights & Biases traces**
(inspectable multi-step reasoning traces, run comparison, export) for the
Reasoning tab, and a **knowledge-graph explorer** (Neo4j Bloom-shaped:
cluster/gap/redundancy inspection) for the Lattice Topology tab. Parity
target: the only difference should be that the underlying engines are
Concord's own (HLR/HLM/breakthrough-clusters/drift-monitor/forgetting-
engine) rather than a third-party observability vendor's.

## Backend macro surface

`cognition` domain — 7 macros (`compareModes`, `recommendMode`,
`exportTrace`, `listExports`, `getExport`, `deleteExport`, `driftAlerts`).
The lens also cross-mounts four sibling substrates that previously had
macros but no UI at all: `hlr` (`run`, `trace`, `list_traces`), `hlm`
(`topology`, `run`), `breakthrough` (`metrics`, `list`), `forgetting`
(`status`, `candidates`).

`node scripts/lens-unsurfaced.mjs --lens cognition` → **0/7 unsurfaced**,
unchanged by this audit.

## Audit finding: already comprehensive, no gaps

Five tabs, each a genuine designed workflow, not a generic button wall:

- **Reasoning** — a claim/question box, 7 reasoning-mode picker
  (deductive/inductive/abductive/adversarial/analogical/temporal/
  counterfactual) with per-mode tooltips, a mode recommender
  (`ModeRecommender.tsx`), an inference-tree viewer
  (`ReasoningTraceTree.tsx`), a recent-traces list with re-load, a
  side-by-side two-mode comparison (`ModeComparison.tsx`, real
  `cognition.compareModes` round-trip, confidence/convergence/novelty +
  full inference trees for both sides), and a saved-exports manager
  (`TraceExports.tsx`, `exportTrace`/`listExports`/`deleteExport`).
- **Lattice Topology** — cluster/gap/redundancy stat tiles, a real graph
  view (`LatticeTopologyGraph.tsx`), a manual "Run HLM pass" trigger, raw
  JSON inspector.
- **Breakthroughs** — cross-domain synthesis cluster stats + list, sourced
  from `breakthrough.metrics`/`breakthrough.list`.
- **Forgetting** — retention threshold + forgotten-count stats and a
  pending-candidates table (`forgetting.status`/`forgetting.candidates`).
- **Drift** — a severity-filterable alert timeline (`DriftTimeline.tsx`)
  over `cognition.driftAlerts`, describing the drift-monitor's actual
  finding types (Goodhart gaming, memetic drift, capability creep, circular
  evidence, echo chambers, metric divergence).

Plus a live brain-pool status panel (`BrainPoolStatus.tsx`, polling the
real `/api/brain/status` endpoint every 8s, with a Save-as-DTU snapshot
action).

Every data source verified as a real macro/REST round-trip — no
`Math.random`, no hardcoded arrays, no placeholder/lorem content anywhere
in the 7 component files audited (`BrainPoolStatus`, `DriftTimeline`,
`LatticeTopologyGraph`, `ModeComparison`, `ModeRecommender`,
`ReasoningTraceTree`, `TraceExports`).

## What this rebuild changed

Nothing. This is one of the strongest lenses in the fleet: it single-
handedly surfaces four previously-headless engines (`hlr-engine.js`,
`hlm-engine.js`, `breakthrough-clusters.js`, `drift-monitor.js`,
`forgetting-engine.js`) through a genuinely designed, keyboard-navigable
(`r`/`t`/`b`/`f`/`d` tab shortcuts) console. Per the program's honesty
rule, an audit that finds nothing wrong says so rather than inventing a
diff.

## Disposition ledger (step 1.5)

- **ALREADY REAL**: all 7 `cognition` macros; the cross-mounted `hlr`/
  `hlm`/`breakthrough`/`forgetting` read/run macros; the live brain-pool
  status panel.
- **BACKEND-CAPABLE-BUT-UNSURFACED**: none found.
- **GENUINELY MISSING**: none against the LangSmith-trace / knowledge-
  graph-explorer parity checklist (inspectable traces ✓, run comparison ✓,
  export ✓, cluster/gap/redundancy view ✓, alert stream with severity
  filter ✓).

## Verification

- Confirmed via read-only audit; no files touched.
- `node scripts/verify-lens-backends.mjs` — `cognition` still `WIRED`.
- `node scripts/grade-ux-polish.mjs --honest` — `cognition`:
  `tier: "polished"`, `isGenericScaffold: false`.
- `node scripts/lens-unsurfaced.mjs --lens cognition` — 0/7 unsurfaced.
