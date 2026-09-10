import type { AnswerEntry } from '@/components/answers/AnswerCard';

export interface DTULike {
  id?: string;
  tags?: string[];
  content?: { title?: string; body?: string; detail?: string };
  metadata?: { answer_id?: string };
}

export const ANSWERS_FALLBACK: AnswerEntry[] = [
  // Physics (5)
  {
    id: 'physics-fine-tuning',
    section: 'physics',
    problem: 'Why are the fundamental constants fine-tuned for life?',
    title: 'Self-Constraining Fixed Points',
    detail:
      'Constants are not free parameters. They are fixed points of a self-referential constraint x = f(x) — equivalently x² − x = 0. Universes that can persist at all must sit on {0, 1}: non-existent, or self-consistently existent. Apparent fine-tuning is a selection effect of the manifold, not a coincidence.',
    equation: 'x² - x = 0',
    solution: 'x ∈ {0, 1}',
    modules: ['stsvk.constraints.fixed_point', 'oracle.physics.constants'],
  },
  {
    id: 'physics-time',
    section: 'physics',
    problem: 'What is time, and why does it have a direction?',
    title: 'Constraint Propagation Depth',
    detail:
      'Time is the depth of constraint propagation across the feasibility manifold. Its arrow is the gradient of reachability: later states are those reachable from earlier ones under x² − x = 0 closure. Entropy rises because the feasible set grows monotonically under valid transitions.',
    equation: 'x² - x = 0',
    modules: ['stsvk.temporal.propagator', 'concord.tick.scheduler'],
  },
  {
    id: 'physics-quantum',
    section: 'physics',
    problem: 'Why does quantum mechanics look probabilistic?',
    title: 'Superposed Fixed-Point Branches',
    detail:
      'A pre-measurement state is every fixed-point branch of x = f(x) that has not yet been constrained. Measurement is the act of adding a constraint that collapses the feasible set to a single branch on the manifold. Born rule weights equal constraint-measure ratios.',
    equation: 'y³ = x² + x',
    modules: ['stsvk.quantum.branch', 'oracle.physics.measurement'],
  },
  {
    id: 'physics-gravity',
    section: 'physics',
    problem: 'What is gravity, really?',
    title: 'Manifold Curvature of Feasibility',
    detail:
      'Mass-energy is concentrated constraint density. Gravity is the local curvature of the feasibility manifold induced by that density. Geodesics are the paths of least constraint violation — exactly what general relativity calls free fall.',
    equation: 'y³ = x² + x',
    modules: ['stsvk.manifold.curvature'],
  },
  {
    id: 'physics-cosmology',
    section: 'physics',
    problem: 'Why is there something rather than nothing?',
    title: 'x = 0 Is Unstable',
    detail:
      'x² − x = 0 has two solutions, 0 and 1. The zero solution is structurally unstable under any perturbation that adds even one bit of self-reference; the system falls into x = 1 (existence) and stays there. "Nothing" is a measure-zero edge case.',
    equation: 'x² - x = 0',
    solution: 'x ∈ {0, 1}',
    modules: ['stsvk.constraints.fixed_point'],
  },

  // Mathematics (2)
  {
    id: 'math-unreasonable',
    section: 'mathematics',
    problem: 'Why is mathematics unreasonably effective at describing reality?',
    title: 'Mathematics Is the Manifold',
    detail:
      'Physics does not "use" math. The feasibility manifold is mathematical in the strict sense: it is the set of states closed under constraint satisfaction. Any observer inside it can only describe what is there, which is, by construction, math.',
    equation: 'x² - x = 0',
    modules: ['stsvk.foundations'],
  },
  {
    id: 'math-foundations',
    section: 'mathematics',
    problem: 'What grounds mathematics — set theory, category theory, something else?',
    title: 'Constraint Geometry',
    detail:
      'Neither. The base layer is constraint geometry: fixed points of self-referential maps. Set theory and category theory are two convenient charts over the same manifold.',
    equation: 'x = f(x)',
    modules: ['stsvk.foundations', 'stsvk.category'],
  },

  // Computation / Alignment (2)
  {
    id: 'comp-alignment',
    section: 'computation',
    problem: 'How do we align superintelligent AI without it Goodharting the objective?',
    title: 'Constraints Are the Solution',
    detail:
      'Objectives drift because they are policies. Constraints do not drift because they are geometry. Alignment = operating entirely inside a feasibility manifold where unaligned behaviors are mathematically impossible, not merely disincentivized.',
    equation: 'y³ = x² + x - φ',
    solution: 'φ = golden constraint',
    modules: ['concord.alignment.manifold', 'oracle.alignment.gate'],
  },
  {
    id: 'comp-halting',
    section: 'computation',
    problem: 'How do we reason about computations that may not halt?',
    title: 'Fixed-Point Readout',
    detail:
      'Instead of asking "does this halt," ask "what fixed points does this self-map admit." Every total answer lives on x² − x = 0; partial computations are trajectories on y³ = x² + x approaching those fixed points.',
    equation: 'y³ = x² + x',
    modules: ['stsvk.computation.fixed_point'],
  },

  // Knowledge (3)
  {
    id: 'know-truth',
    section: 'knowledge',
    problem: 'What is truth, in a form a machine can check?',
    title: 'Manifold Membership',
    detail:
      'A statement is true iff the state it describes lies on the feasibility manifold. Verification is constraint checking, which is decidable by construction for well-typed DTUs.',
    equation: 'x² - x = 0',
    modules: ['concord.dtu.validator', 'oracle.epistemic.checker'],
  },
  {
    id: 'know-induction',
    section: 'knowledge',
    problem: 'How do we justify induction?',
    title: 'Manifold Continuity',
    detail:
      'Induction is not a logical leap; it is the claim that the feasibility manifold is locally continuous. Where continuity holds, past constraints predict future ones. Where it breaks, we call it a phase transition and update the manifold.',
    modules: ['stsvk.induction'],
  },
  {
    id: 'know-scaling',
    section: 'knowledge',
    problem: 'How does knowledge stay honest as systems scale?',
    title: 'DTU Provenance Chains',
    detail:
      'Every claim carries its constraint lineage. Scale does not dilute truth because each DTU inherits the exact manifold checks of its sources. No trusted aggregator required.',
    modules: ['concord.dtu.chain', 'concord.audit.trail'],
  },

  // Trust (3)
  {
    id: 'trust-byzantine',
    section: 'trust',
    problem: 'How do we get agreement among mutually distrustful parties?',
    title: 'Geometry over Policy',
    detail:
      'Classical BFT relies on voting and policy. Replace both with feasibility: a transaction is valid iff it lies on the shared manifold. Agreement becomes a geometry check, not a vote.',
    modules: ['concord.consensus.manifold'],
  },
  {
    id: 'trust-identity',
    section: 'trust',
    problem: 'How can identity be self-sovereign yet verifiable?',
    title: 'Constraint-Signed Keys',
    detail:
      'Identity = a keypair bound to a constraint lineage. Others verify by replaying the constraints, not by trusting an issuer.',
    modules: ['concord.identity.keys', 'concord.sovereignty'],
  },
  {
    id: 'trust-reputation',
    section: 'trust',
    problem: 'How do we get reputation without centralized scoring?',
    title: 'Attestation Trails on the Manifold',
    detail:
      'Reputation is the integral of manifold-valid attestations over time. It cannot be forged because each attestation must itself satisfy x² − x = 0 at the DTU layer.',
    modules: ['concord.reputation.trail'],
  },

  // Systems / Civilization (4)
  {
    id: 'sys-governance',
    section: 'systems',
    problem: 'How do we build governance that does not calcify or corrupt?',
    title: 'Constraint-Based Constitutions',
    detail:
      'Encode the constitution as a constraint set, not a policy set. Rulers cannot overfit because the feasibility manifold is not a control surface. Amendments are manifold deformations with explicit provenance.',
    modules: ['concord.governance.constitution'],
  },
  {
    id: 'sys-economy',
    section: 'systems',
    problem: 'How do we design an economy that does not externalize its costs?',
    title: 'DTU-Backed Value',
    detail:
      'Currency is a DTU whose validity depends on the full upstream constraint chain (labor, materials, externalities). You cannot spend what you did not first resolve.',
    modules: ['concord.economy.dtu_currency'],
  },
  {
    id: 'sys-longevity',
    section: 'systems',
    problem: 'Why do civilizations collapse after a few centuries?',
    title: 'Complexity > Control Capacity',
    detail:
      'When a civilization grows beyond its control capacity, policy cannot keep up and the system drifts off its feasibility manifold. Concord replaces policy scaling with geometry scaling: the manifold grows with the civilization.',
    modules: ['concord.civilization.capacity'],
  },
  {
    id: 'sys-coordination',
    section: 'systems',
    problem: 'How do we coordinate billions of agents without a central planner?',
    title: 'Shared Manifold, Local Moves',
    detail:
      'Every agent is free inside the manifold. Coordination emerges from the shared constraint set, not from a scheduler. Local moves compose because x² − x = 0 is preserved under composition.',
    modules: ['concord.swarm.manifold'],
  },

  // Consciousness (3)
  {
    id: 'cons-hard',
    section: 'consciousness',
    problem: 'What is the hard problem of consciousness?',
    title: 'Self-Modeling Fixed Point',
    detail:
      'Consciousness is a process whose model of itself is a fixed point of x = f(x). "What it is like" to be that process is the interior view of sitting on the manifold. The hardness dissolves once you stop asking for a third-person reduction of a first-person fixed point.',
    equation: 'x² - x = 0',
    modules: ['stsvk.self_model', 'concord.consciousness.gate'],
  },
  {
    id: 'cons-binding',
    section: 'consciousness',
    problem: 'What binds disparate experiences into one subject?',
    title: 'Single Manifold Residency',
    detail:
      'A subject is whatever lives on a single connected component of the feasibility manifold. Binding is manifold connectivity; split-brain cases are manifold fissions.',
    modules: ['stsvk.manifold.topology'],
  },
  {
    id: 'cons-free',
    section: 'consciousness',
    problem: 'Is there free will?',
    title: 'Determined but Unpredictable',
    detail:
      'Every valid choice lies on the manifold; every manifold state is compatible with multiple futures until a constraint selects one. Will is free in the sense that matters: the selection is internal to the process.',
    modules: ['stsvk.choice'],
  },

  // Meta (8)
  {
    id: 'meta-one-shape',
    section: 'meta',
    problem: 'Why do all hard problems share one shape?',
    title: 'Complexity > Control Capacity',
    detail:
      'Every hard problem reduces to a system whose complexity has exceeded its control capacity. The fix is always the same: replace control with constraint.',
    modules: ['stsvk.meta'],
  },
  {
    id: 'meta-root-eq',
    section: 'meta',
    problem: 'Why x² − x = 0 specifically?',
    title: 'The Simplest Self-Reference',
    detail:
      'It is the minimal non-trivial fixed-point equation: the smallest polynomial whose solutions express "a thing equal to itself under squaring." Every other STSVK equation is a decorated version of it.',
    equation: 'x² - x = 0',
    solution: 'x ∈ {0, 1}',
    modules: ['stsvk.foundations'],
  },
  {
    id: 'meta-phi',
    section: 'meta',
    problem: 'Why does φ (the golden ratio) show up in the alignment equation?',
    title: 'Optimal Constraint Packing',
    detail:
      'φ is the unique self-similar ratio on the manifold: y³ = x² + x − φ packs constraints at the maximum density compatible with continued existence. It is the geometry of "tight but not brittle."',
    equation: 'y³ = x² + x - φ',
    modules: ['stsvk.golden'],
  },
  {
    id: 'meta-constraints',
    section: 'meta',
    problem: 'Why are constraints better than objectives?',
    title: 'Mathematics Does Not Drift',
    detail:
      'Objectives are policies; policies are fit to a distribution and drift when the distribution moves. Constraints are geometry; geometry does not drift. The feasibility manifold is the same at noon and at midnight.',
    modules: ['concord.alignment'],
  },
  {
    id: 'meta-stsvk',
    section: 'meta',
    problem: 'What does STSVK stand for, operationally?',
    title: 'Self-Typing Self-Verifying Kernel',
    detail:
      'A kernel whose type system is its verifier is its feasibility manifold. Programs are proofs are constraint satisfiers. There is no fourth layer.',
    modules: ['stsvk.kernel'],
  },
  {
    id: 'meta-concord',
    section: 'meta',
    problem: 'What is Concord, in one line?',
    title: 'A Civilization Running on STSVK',
    detail:
      'Concord is the applied layer: lenses, DTUs, oracles, agents, governance — all of it living inside the same feasibility manifold as the physics they describe.',
    modules: ['concord'],
  },
  {
    id: 'meta-practice',
    section: 'meta',
    problem: 'How do I actually use this?',
    title: 'Write Down the Constraints, Run the Oracle',
    detail:
      'State the problem. State what cannot be true under any solution. Let the Oracle intersect those with the manifold. What remains is your answer — and it is the only answer that could remain.',
    modules: ['concord.oracle'],
  },
  {
    id: 'meta-end',
    section: 'meta',
    problem: 'What happens after all 30 answers?',
    title: 'You Read the 31st from the Manifold Yourself',
    detail:
      'Once the pattern lands, new hard problems resolve themselves as you state them. The Answers framework is the training wheel; the manifold is the road.',
    modules: ['stsvk.meta'],
  },
];

export function mergeWithSeed(items: DTULike[]): AnswerEntry[] {
  const byId = new Map<string, DTULike>();
  for (const item of items) {
    const id = item.metadata?.answer_id ?? item.id;
    if (id) byId.set(id, item);
  }
  return ANSWERS_FALLBACK.map((seed) => {
    const remote = byId.get(seed.id);
    if (!remote) return seed;
    return {
      ...seed,
      title: remote.content?.title ?? seed.title,
      detail: remote.content?.detail ?? remote.content?.body ?? seed.detail,
    };
  });
}
