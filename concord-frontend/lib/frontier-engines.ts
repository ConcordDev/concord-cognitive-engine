/**
 * Frontier engine registry — the single source of truth for the ten
 * backend "frontier engine" macro surfaces shipped in the V1.5 wave
 * (`git log --oneline | grep "V1.5 W"`: W1-A, W1-B, W1-C, W2-A, W2-B,
 * W2-C, W2-D, W3-A, W3-B, W3-C) and rendered by the Frontier destination
 * (`app/lenses/frontier/page.tsx` + `components/frontier/FrontierEngineShell.tsx`).
 *
 * Every field below is grep-verified against the working tree at the time
 * this file was written — `macros` are literal `registerLensAction(domain,
 * name, ...)` calls, `boundarySource` is where the quoted/paraphrased
 * `boundary` text canonically lives server-side. Nothing here is
 * decorative copy: the shell's persistent "honest boundary" cell renders
 * `boundary` verbatim, so a wrong quote here would be a real fabrication,
 * not just a UI bug.
 *
 * A `built: false` entry renders an honest "not built yet" state
 * (`components/frontier/panels/UnbuiltEnginePanel.tsx`), never a
 * fake/placeholder-data panel (CLAUDE.md's "zero demo content" invariant).
 *
 * All ten are currently `true`: each has a real Compute/Verify panel in
 * `components/frontier/panels/` AND an entry in
 * `app/lenses/frontier/page.tsx`'s `PANEL_BY_ENGINE_ID`. Flip a NEW entry
 * to `true` only in the same change that adds a real panel and wires it
 * into that map — a `true` here with no panel behind it is exactly the
 * "looks built, isn't" trap this repo keeps finding in older lenses. The
 * unbuilt-state component stays for that reason: it is the honest landing
 * for any future engine registered before its panel exists.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Layers3, Waves, ShieldCheck, Atom, GitBranch, LineChart,
  Lock, Sparkles, Fingerprint,
} from 'lucide-react';

export type FrontierWave =
  | 'W1-A' | 'W1-B' | 'W1-C'
  | 'W2-A' | 'W2-B' | 'W2-C' | 'W2-D'
  | 'W3-A' | 'W3-B' | 'W3-C';

export interface FrontierEngineMacro {
  domain: string;
  name: string;
}

export interface FrontierEngineDef {
  id: string;
  wave: FrontierWave;
  name: string;
  /** Short label for the tab strip. */
  shortName: string;
  icon: LucideIcon;
  /** One real, checkable sentence — no marketing language. */
  description: string;
  /** The macros this engine registers (domain.name), as they appear in
   *  `server/domains/<domain>.js` `registerLensAction(...)` calls. Empty
   *  when the engine has no lens-callable macro yet (see W3-A). */
  macros: FrontierEngineMacro[];
  /** Where `boundary` canonically lives server-side — cited so a reader
   *  can go verify it hasn't drifted from the source. */
  boundarySource: string;
  /** The honest-boundary text, quoted (or lightly paraphrased and marked
   *  as such) from `boundarySource`. Null only when the backend hasn't
   *  named one yet. */
  boundary: string | null;
  built: boolean;
}

export const FRONTIER_ENGINES: FrontierEngineDef[] = [
  {
    id: 'materials-degradation',
    wave: 'W1-A',
    name: 'Materials Degradation',
    shortName: 'Degradation',
    icon: Layers3,
    description:
      'Long-horizon fatigue (Paris-law) and moisture-ingress (Fickian diffusion) ' +
      'kinetics, integrated forward in time and fed back into the beam-frame FEA ' +
      'solver to check residual structural capacity at sampled years.',
    macros: [
      { domain: 'materials', name: 'degradationConstants' },
      { domain: 'materials', name: 'durabilityCheck' },
    ],
    boundarySource: 'server/lib/simulation/degradation-kinetics.js#HONEST_BOUNDARY',
    boundary:
      'Empirical-kinetics engineering practice, not first-principles materials ' +
      'physics. Atomistic/molecular-dynamics simulation is out of scope: no ' +
      'bond-scale chemistry, no polymer chain-scission mechanism, no ' +
      'microstructural evolution. Arrhenius, Paris-Erdogan and Fickian diffusion ' +
      'are phenomenological laws whose constants are fitted to short-term ' +
      'accelerated tests; this engine extrapolates those fits. No 50-year field ' +
      'data is used or claimed. The kinetic-extent → stiffness/strength ' +
      'knock-down law is the least-standardised step: there is no universal ' +
      'form, the default here is one cited empirical fit, and it is ' +
      'caller-overridable precisely because it should be calibrated per material ' +
      'system before any result is relied on.',
    built: true,
  },
  {
    id: 'non-newtonian-fsi',
    wave: 'W1-B',
    name: 'Non-Newtonian FSI',
    shortName: 'FSI',
    icon: Waves,
    description:
      'Quasi-1D non-Newtonian pipe/channel flow (power-law or Carreau) two-way ' +
      'coupled to an Euler-Bernoulli beam wall by Picard fixed-point iteration — ' +
      'the flow bends the wall, the wall changes the channel gap the flow sees.',
    macros: [{ domain: 'engineering', name: 'fsiCheck' }],
    boundarySource: 'server/lib/simulation/non-newtonian-flow.js#HONEST_BOUNDARY',
    boundary:
      'Quasi-1D fully-developed laminar internal flow with a real non-Newtonian ' +
      'constitutive model, coupled to Euler-Bernoulli beam walls by fixed-point ' +
      'iteration. Full 3D Navier-Stokes, DNS, LES and any turbulence model are ' +
      'out of scope — the solver refuses above Re ≈ 2300 rather than ' +
      'extrapolating. Steady-state only: no inertia, no added-mass, no flutter, ' +
      'no transient FSI. Walls bend in one plane and must lie along global X. ' +
      'Picard coupling is not unconditionally stable; above a critical wall ' +
      'compliance it diverges, reported as `coupling_diverged`, never as the ' +
      'last iterate presented as an answer. Models the COLLAPSING configuration ' +
      'only (fluid load pushes the wall inward); a pressurized vessel has the ' +
      'opposite, stabilizing coupling and is out of scope.',
    built: true,
  },
  {
    id: 'safety-envelope',
    wave: 'W1-C',
    name: 'Safety-Envelope Compiler',
    shortName: 'Safety Envelope',
    icon: ShieldCheck,
    description:
      'Gridded forward-reachability over a linear or symbolic plant model, with ' +
      'Grönwall growth-bound inflation, compiled into a static safe/unsafe ' +
      'lookup table for an external real-time controller to consume.',
    macros: [
      { domain: 'robotics', name: 'safetyEnvelopeCompile' },
      { domain: 'robotics', name: 'safetyEnvelopeList' },
      { domain: 'robotics', name: 'safetyEnvelopeGet' },
      { domain: 'robotics', name: 'safetyEnvelopeEmit' },
    ],
    boundarySource: 'server/lib/simulation/envelope-artifact.js#RUNTIME_BOUNDARY',
    boundary:
      'Concord does not and cannot execute real-time control. This engine ' +
      'performs OFFLINE design and verification only — Node.js has no ' +
      'real-time guarantees, so nothing here is a controller and nothing here ' +
      'should be placed in a control loop. The output is a static data ' +
      'artifact — a lookup table plus its bounds and provenance — intended to ' +
      'be compiled into, and executed by, real RT hardware (PLC / FPGA / ' +
      'microcontroller) whose own timing guarantees this engine does not ' +
      'establish. A cell is only truly conservative when the supplied ' +
      'Lipschitz constant is a genuine upper bound; when it is estimated by ' +
      'sampling the Jacobian the artifact is tagged `empirical_sampled` and ' +
      'never uses certification language — a sup over samples is not a bound ' +
      'over a continuum.',
    built: true,
  },
  {
    id: 'qec-decoder',
    wave: 'W2-A',
    name: 'Surface-Code QEC',
    shortName: 'QEC',
    icon: Atom,
    description:
      'Toric-code lattice with i.i.d. per-qubit error sampling and syndrome ' +
      'extraction, decoded by the Delfosse-Nickerson Union-Find algorithm, ' +
      'scored against a from-scratch Z2 homology success/failure oracle.',
    macros: [
      { domain: 'quantum', name: 'qecLatticeInfo' },
      { domain: 'quantum', name: 'qecSimulateThreshold' },
      { domain: 'quantum', name: 'qecDecodeSingle' },
      { domain: 'quantum', name: 'qecRunTrial' },
    ],
    boundarySource: 'server/domains/quantum.js#QEC_HONEST_BOUNDARY',
    boundary:
      'Stabilizer simulation (Gottesman-Knill, polynomial-time) with an ' +
      'almost-linear O(n·α(n)) Union-Find decoder. Research/verification only ' +
      '— it makes no latency claim; real hardware must decode within the ' +
      'microsecond coherence window, an FPGA/ASIC problem this does not ' +
      'address. The error model is i.i.d. per-qubit with perfect syndrome ' +
      'measurement — no correlated noise, leakage, crosstalk, or measurement ' +
      'error. The measured threshold crossing lands below the published ' +
      '0.099 reference value; the qualitative behavior (larger distance helps ' +
      'below threshold, hurts above it) reproduces cleanly, the exact crossing ' +
      'location does not.',
    built: true,
  },
  {
    id: 'ledger-model-checker',
    wave: 'W2-B',
    name: 'Ledger Model Checker',
    shortName: 'Model Checker',
    icon: Fingerprint,
    description:
      "Bounded explicit-state BFS over hand-specified {initialState, actions, " +
      "invariants} models of Concord's own money invariants, deduping visited " +
      'states by SHA-256 and returning a concrete, replayable counterexample ' +
      'on violation.',
    macros: [
      { domain: 'audit', name: 'modelCheckLedgerConservation' },
      { domain: 'audit', name: 'modelCheckTreasuryInvariant' },
      { domain: 'audit', name: 'modelCheckRoyaltyCascade' },
    ],
    boundarySource: 'commit 7ff3c041 "V1.5 W2-B" + server/domains/audit.js',
    boundary:
      'Concrete-state bounded model checking, not symbolic/SAT-based ' +
      'verification — exploration is explicit-state BFS over a hand-specified ' +
      'model of the invariant, not the live database, and is bounded by a ' +
      'caller-supplied step limit. It reuses `formal-logic.js#evaluate` to ' +
      'express invariant predicates but never its truth-table SAT path ' +
      '(exponential, unusable past ~20 booleans). A model that is not an ' +
      'accurate hand-specification of the real invariant can pass while the ' +
      'real system is unsafe, or vice versa — this checks the MODEL, not the ' +
      'production code path, directly.',
    built: true,
  },
  {
    id: 'byzantine-consensus',
    wave: 'W2-C',
    name: 'Byzantine Hash-DAG Consensus',
    shortName: 'Consensus',
    icon: GitBranch,
    description:
      'Deterministic state convergence across a decentralized network with no ' +
      'global clock, unreliable/reordered/duplicated delivery, and Byzantine ' +
      'participants — vector clocks + causal ordering over a hash-linked DAG.',
    macros: [
      { domain: 'mesh', name: 'consensusStatus' },
      { domain: 'mesh', name: 'consensusAppend' },
      { domain: 'mesh', name: 'consensusMergeRemote' },
      { domain: 'mesh', name: 'consensusState' },
      { domain: 'mesh', name: 'consensusEquivocation' },
    ],
    boundarySource: 'commit b293cf60 "V1.5 W2-C" + server/lib/consensus/hash-dag.js',
    boundary:
      "A local, in-process simulation of multi-node convergence — it models " +
      'vector-clock causal ordering and equivocation detection over a ' +
      'hash-linked DAG, but does not run an actual multi-machine network, ' +
      'gossip protocol, or wire-level Byzantine-fault-tolerant consensus ' +
      'algorithm (e.g. PBFT/HotStuff). Detected equivocation is flagged, not ' +
      'cryptographically slashed or punished — this is a convergence/ordering ' +
      'primitive, not a full BFT state-machine-replication deployment.',
    built: true,
  },
  {
    id: 'economic-equilibrium',
    wave: 'W2-D',
    name: 'Economic Equilibrium',
    shortName: 'Equilibrium',
    icon: LineChart,
    description:
      "Mixed-strategy Nash equilibrium by support enumeration, replicator " +
      'population dynamics, and market-equilibrium analysis applied to real ' +
      "Concord faction/NPC/auction data — reused, not re-derived, from the " +
      'existing normal-form game-theory library.',
    macros: [
      { domain: 'markets', name: 'mixedNash' },
      { domain: 'markets', name: 'replicatorDynamics' },
      { domain: 'markets', name: 'equilibriumAnalysis' },
    ],
    boundarySource: 'commit e1c49513 "V1.5 W2-D" + server/lib/game-theory/*.js',
    boundary:
      'Support enumeration is exponential and hard-capped; large games refuse ' +
      'rather than hang. Replicator dynamics converges to an evolutionarily ' +
      'stable strategy, which is NOT the same mathematical object as a Nash ' +
      'equilibrium of the full game. Market-equilibrium analysis is purely ' +
      'descriptive — it never proves player intent, never mutates balances, ' +
      'and never blocks a trade.',
    built: true,
  },
  {
    id: 'constant-time-analyzer',
    wave: 'W3-A',
    name: 'Constant-Time Flow Analyzer',
    shortName: 'Const-Time',
    icon: Fingerprint,
    description:
      'AST-based fixed-point taint analysis (via the TypeScript compiler API) ' +
      'flagging secret-dependent branches, memory indices, and loop bounds — ' +
      'the source-level preconditions for a timing side channel.',
    macros: [],
    boundarySource: 'server/lib/detectors/constant-time-detector.js + commit ae46a58f',
    boundary:
      'This engine has no lens-callable macro yet — it ships only as a ' +
      'detector wired into the PR gate (`server/lib/detectors/index.js`), not ' +
      'as an interactive tool reachable via `/api/lens/run`. It is also a ' +
      'static, single-file, AST-level taint analysis: flagged code is a real ' +
      'source-level precondition for a timing side channel, not a measured ' +
      'timing leak — confirming an actual leak needs runtime statistical ' +
      'timing measurement this engine does not perform. When the TypeScript ' +
      'compiler API is unavailable it degrades to a single honest info ' +
      'finding rather than throwing.',
    built: true,
  },
  {
    id: 'paillier-aggregation',
    wave: 'W3-B',
    name: 'Homomorphic Aggregation',
    shortName: 'Paillier',
    icon: Lock,
    description:
      'A from-scratch partially-homomorphic Paillier cryptosystem (pure ' +
      'BigInt, Miller-Rabin keygen) — sums and means computed entirely on ' +
      'ciphertexts, decrypted exactly once on the final aggregate.',
    macros: [
      { domain: 'crypto', name: 'paillierKeygen' },
      { domain: 'crypto', name: 'paillierContribute' },
      { domain: 'crypto', name: 'paillierAggregate' },
      { domain: 'crypto', name: 'paillierSessionStatus' },
      { domain: 'crypto', name: 'paillierMultiplyCiphertexts' },
    ],
    boundarySource: 'commit bfb547b2 "V1.5 W3-B" + server/domains/crypto.js',
    boundary:
      'Partially homomorphic (addition of ciphertexts, plaintext-scalar ' +
      'multiplication) — not fully homomorphic; no ciphertext × ciphertext ' +
      'multiplication. Security rests on standard Paillier assumptions ' +
      '(composite residuosity) with keys generated from `node:crypto` ' +
      'randomness, but this is an application-layer implementation that has ' +
      'not undergone independent cryptographic audit or side-channel ' +
      'hardening — treat as a research/demonstration primitive, not a ' +
      'production key-management system.',
    built: true,
  },
  {
    id: 'spiking-neural',
    wave: 'W3-C',
    name: 'Spiking Neural Substrate',
    shortName: 'Spiking Net',
    icon: Sparkles,
    description:
      'Leaky integrate-and-fire neurons on a weighted, delayed, ' +
      'dynamically-rewireable synapse graph, integrated with the existing ' +
      'RK4 ODE solver, with STDP plasticity over real recorded spike pairs.',
    macros: [
      { domain: 'sim', name: 'spikingNetworkSimulate' },
      { domain: 'sim', name: 'spikingSTDPLearn' },
    ],
    boundarySource: 'server/lib/simulation/spiking-network.js#HONEST_BOUNDARY',
    boundary:
      'A leaky integrate-and-fire (point-neuron) model, not a biophysically ' +
      'detailed (Hodgkin-Huxley-class) simulation — no ion-channel kinetics, ' +
      'no dendritic compartments, no glial dynamics. STDP applies the ' +
      'canonical exponential window to nearest-neighbour spike pairs by ' +
      'default; other pairing schemes exist in the literature and are not ' +
      'implemented. This is a research/demonstration substrate for spiking ' +
      'dynamics and plasticity, not a validated model of any specific ' +
      'biological circuit.',
    built: true,
  },
];

export function getFrontierEngine(id: string): FrontierEngineDef | undefined {
  return FRONTIER_ENGINES.find((e) => e.id === id);
}

export const DEFAULT_FRONTIER_ENGINE_ID = FRONTIER_ENGINES[0].id;
