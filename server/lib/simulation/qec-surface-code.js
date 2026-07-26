// server/lib/simulation/qec-surface-code.js
//
// Toric-code lattice construction + i.i.d. error sampling for quantum error
// correction simulation. This is STABILIZER simulation (Gottesman-Knill:
// polynomial-time), not amplitude simulation — it never touches a statevector.
//
// Complementary to, and NOT a replacement for, server/lib/compute/quantum-compute.js:
// that module is an exact gate-based statevector simulator (real complex
// amplitudes, arbitrary unitaries) whose arrays are length 2^numQubits, so it
// is unusable past ~20 qubits. Surface-code QEC needs hundreds-to-thousands of
// qubits (a distance-d toric code already has 2*d^2 of them), which is only
// tractable because the Gottesman-Knill theorem lets us track stabilizer
// syndromes combinatorially instead of amplitudes. quantum-compute.js can
// produce exact amplitudes this module cannot; this module can simulate
// lattices quantum-compute.js could never fit in memory. Neither subsumes the
// other — do not try to reuse or extend quantum-compute.js for this.
//
// Boundary conditions: TOROIDAL (periodic), i.e. the literal "toric code",
// not an open-boundary planar surface code. Toroidal boundaries were chosen
// deliberately: they admit the simplest, most standard threshold benchmark
// against the literature (Delfosse & Nickerson, arXiv:1709.06218, report
// ~9.9% for the 2D toric code decoded with a Union-Find decoder under a
// perfect-syndrome-measurement bit-flip channel — see qec-decoder.test.js for
// the reproduction). A planar/open-boundary variant is a real, common
// alternative in the surface-code family; it is not implemented here.
//
// Error model: i.i.d. per-qubit noise with an injectable `rng` (uniform
// 0..1), same determinism contract as server/lib/probability/stochastic.js's
// monteCarloExit — same seed in ⇒ same error pattern out, every time. The
// noise is independent per qubit: no correlated noise, no leakage, no
// crosstalk, no measurement error. Depolarizing noise here is DECOUPLED
// (independent X-component and Z-component sampled per qubit, with both
// occurring simultaneously representing a Y error); it does not exploit the
// X/Z correlation a joint depolarizing-aware decoder could use. This is a
// known, named simplification, not an oversight.

/**
 * Build a distance-d toric-code lattice. Qubits sit on the edges of a d×d
 * periodic square lattice; nodes represent one full family of stabilizer
 * checks (this lattice + its adjacency IS the decoding graph for one error
 * sector — X errors detected via Z-plaquette syndromes, or symmetrically Z
 * errors via X-plaquette syndromes; by construction the two sectors are
 * isomorphic, so the same lattice/decoder serves either).
 *
 * Node ids: integer 0..d*d-1, id = r*d + c.
 * Edge ids: 0..d*d-1 are "horizontal" edges (h edge (r,c) connects node(r,c)
 *   to node(r,c+1) mod d); d*d..2*d*d-1 are "vertical" edges (v edge (r,c)
 *   connects node(r,c) to node(r+1,c) mod d).
 * Total: d*d nodes (stabilizers of one type), 2*d*d qubits (edges).
 */
export function buildToricCode(d) {
  const dist = Math.max(2, Math.floor(d));
  const numNodes = dist * dist;
  const nid = (r, c) => (((r % dist) + dist) % dist) * dist + (((c % dist) + dist) % dist);
  const rc = (id) => [Math.floor(id / dist), id % dist];

  const edges = new Array(2 * dist * dist);
  // h edges: id = r*d + c
  for (let r = 0; r < dist; r++) {
    for (let c = 0; c < dist; c++) {
      const id = r * dist + c;
      edges[id] = { id, type: "h", r, c, u: nid(r, c), v: nid(r, c + 1) };
    }
  }
  // v edges: id = d*d + r*d + c
  const hCount = dist * dist;
  for (let r = 0; r < dist; r++) {
    for (let c = 0; c < dist; c++) {
      const id = hCount + r * dist + c;
      edges[id] = { id, type: "v", r, c, u: nid(r, c), v: nid(r + 1, c) };
    }
  }

  // Precompute adjacency once: node -> [{ edgeId, neighbor }] (4 entries each).
  const adj = new Array(numNodes);
  for (let node = 0; node < numNodes; node++) {
    const [r, c] = rc(node);
    const right = r * dist + c; // h(r,c)
    const left = r * dist + (((c - 1) % dist) + dist) % dist; // h(r, c-1)
    const down = hCount + r * dist + c; // v(r,c)
    const up = hCount + ((((r - 1) % dist) + dist) % dist) * dist + c; // v(r-1, c)
    adj[node] = [
      { edgeId: right, neighbor: nid(r, c + 1) },
      { edgeId: left, neighbor: nid(r, c - 1) },
      { edgeId: down, neighbor: nid(r + 1, c) },
      { edgeId: up, neighbor: nid(r - 1, c) },
    ];
  }

  return {
    d: dist,
    numNodes,
    numQubits: edges.length,
    edges,
    adjacencyOf: (node) => adj[node],
    nodeAt: (r, c) => nid(r, c),
    rcOf: rc,
  };
}

/**
 * Sample an i.i.d. bit-flip (X) error at physical error rate `p`. Returns a
 * Set of edge ids that flipped. Deterministic given `rng`.
 */
export function sampleBitFlipError(lattice, p, rng = Math.random) {
  const errs = new Set();
  for (let i = 0; i < lattice.numQubits; i++) {
    if (rng() < p) errs.add(i);
  }
  return errs;
}

/**
 * Sample i.i.d. depolarizing noise at total per-qubit error rate `p`
 * (probability p/3 each of X, Y, Z, matching the standard depolarizing
 * channel convention). Returns independent X-component and Z-component edge
 * sets (a Y error contributes to both). DECOUPLED by design — see header.
 */
export function sampleDepolarizingError(lattice, p, rng = Math.random) {
  const xErrors = new Set();
  const zErrors = new Set();
  for (let i = 0; i < lattice.numQubits; i++) {
    const roll = rng();
    if (roll < p / 3) xErrors.add(i); // X
    else if (roll < (2 * p) / 3) zErrors.add(i); // Z
    else if (roll < p) { xErrors.add(i); zErrors.add(i); } // Y = X and Z together
  }
  return { xErrors, zErrors };
}

/** Compute the syndrome (Set of node ids with odd incident-error parity) for an edge-id error set. */
export function syndromeOf(lattice, errorEdgeIds) {
  const violated = new Set();
  for (let node = 0; node < lattice.numNodes; node++) {
    let parity = 0;
    for (const { edgeId } of lattice.adjacencyOf(node)) {
      if (errorEdgeIds.has(edgeId)) parity ^= 1;
    }
    if (parity === 1) violated.add(node);
  }
  return violated;
}

/**
 * Homology class of a closed (all-even-degree) edge set on the torus: two
 * independent Z2 invariants, one per non-contractible cycle direction. Both
 * 0 ⇒ the edge set is a contractible (trivial) loop — a correction that
 * differs from the real error by only a trivial loop is a SUCCESS. Either
 * nonzero ⇒ the edge set wraps the torus — a genuine logical operator was
 * applied ⇒ FAILURE. This is what makes success/failure well-defined instead
 * of "the syndrome closed" (many wrong corrections also close the syndrome —
 * closing the syndrome is necessary, not sufficient).
 *
 * Derivation: for a FIXED reference edge subset R, crossing(E) := |E ∩ R| mod
 * 2 is linear over GF(2) in E (standard symmetric-difference-parity
 * identity), so it's automatically invariant under XOR-ing in any
 * closed/boundary loop (e.g. a single stabilizer's edge-boundary) whose
 * crossing count with R is itself always even — checked directly below by
 * construction (each plaquette boundary crosses column-c0 exactly 0 or 2
 * times, and row-r0 exactly 0 or 2 times), so any contractible loop always
 * scores 0 regardless of c0/r0, while the canonical wrapping loops score 1.
 * invariant1 uses horizontal edges at a fixed column (detects column-wrap);
 * invariant2 uses vertical edges at a fixed row (detects row-wrap) — together
 * they span the toric code's rank-2 Z2 homology group, i.e. both potential
 * logical qubits of the code.
 */
export function homologyClass(lattice, edgeIdSet) {
  const d = lattice.d;
  let inv1 = 0; // h-edges crossing column 0, summed over all rows
  for (let r = 0; r < d; r++) {
    const edgeId = r * d + 0; // h(r, 0)
    if (edgeIdSet.has(edgeId)) inv1 ^= 1;
  }
  let inv2 = 0; // v-edges crossing row 0, summed over all columns
  const hCount = d * d;
  for (let c = 0; c < d; c++) {
    const edgeId = hCount + 0 * d + c; // v(0, c)
    if (edgeIdSet.has(edgeId)) inv2 ^= 1;
  }
  return [inv1, inv2];
}

/** True iff the homology class is trivial (both invariants 0) — i.e. no logical operator was applied. */
export function isHomologicallyTrivial(lattice, edgeIdSet) {
  const [a, b] = homologyClass(lattice, edgeIdSet);
  return a === 0 && b === 0;
}

/** Symmetric difference of two edge-id sets (Set<number>). */
export function xorEdgeSets(a, b) {
  const out = new Set(a);
  for (const e of b) {
    if (out.has(e)) out.delete(e);
    else out.add(e);
  }
  return out;
}
