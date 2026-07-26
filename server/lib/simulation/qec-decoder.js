// server/lib/simulation/qec-decoder.js
//
// Delfosse-Nickerson Union-Find decoder (arXiv:1709.06218) for the toric-code
// lattice built by qec-surface-code.js. Almost-linear time: cluster growth +
// union-find merging is O(n·α(n)); the final peeling pass over the resulting
// spanning forest is O(n). This is a research/verification simulator, not a
// control system — see the header of qec-surface-code.js and the repo-wide
// honesty note at the bottom of this file for the full boundary statement.
//
// Algorithm (standard two-phase UF decoder):
//   1. GROWTH. Every syndrome-violated lattice node starts as its own
//      "odd" (active) singleton cluster; every other node starts "even"
//      (inactive) with defect-count 0. Each round, every node currently
//      belonging to an ACTIVE cluster grows a half-edge along each of its
//      not-yet-fully-grown incident edges. An edge that receives growth from
//      both sides (in the same round, from two different active clusters
//      simultaneously, or over two rounds from one active cluster growing
//      into passive territory) becomes FULL and triggers a union of its two
//      endpoints' clusters. A cluster's defect-count parity flips as clusters
//      merge; once a cluster's defect count is EVEN, it stops growing (goes
//      inactive). Repeat until no active clusters remain.
//   2. PEELING (Duclos-Cianci & Poulin). The edges that triggered a genuine
//      union (not a redundant same-cluster touch) form a spanning FOREST over
//      the final clusters. Peel each tree from its leaves inward: a leaf with
//      unmet parity ("needs correction") contributes its edge to the
//      correction set and passes its unmet parity to its parent; a leaf
//      without unmet parity is simply dropped. Because every final cluster
//      has an even total defect count (a structural invariant of the growth
//      phase), peeling a whole tree always resolves its root to parity 0.
//
// The correction this produces is not guaranteed minimum-weight (that's what
// makes it near-linear instead of the O(n^3) blossom algorithm MWPM uses) —
// but it IS guaranteed to close the syndrome exactly, which is verified
// independently below rather than assumed.

import { UnionFind } from "../compute/graph-algorithms.js";
import {
  buildToricCode,
  sampleBitFlipError,
  sampleDepolarizingError,
  syndromeOf,
  isHomologicallyTrivial,
  xorEdgeSets,
} from "./qec-surface-code.js";

/** Symmetric difference of two Sets (works for node ids or edge ids alike). */
function symmetricDifference(a, b) {
  const out = new Set(a);
  for (const x of b) {
    if (out.has(x)) out.delete(x);
    else out.add(x);
  }
  return out;
}

/**
 * Run the Union-Find decoder against a lattice (as built by buildToricCode)
 * and a syndrome (Set of violated node ids). Returns:
 *   - correction: Set<edgeId> — the edges to flip back
 *   - rounds: number of growth rounds it took to close all clusters
 *   - residualSyndrome: Set<node> — recomputed post-correction syndrome
 *     (should always be empty; callers/tests verify this independently)
 */
export function unionFindDecode(lattice, syndromeNodeIds) {
  const uf = new UnionFind();
  const defectCount = new Map(); // root -> parity-relevant defect count
  const clusterMembers = new Map(); // root -> Set(node)
  const edgeGrowth = new Map(); // edgeId -> 0 | 1 | 2
  const spanningEdges = new Set(); // edges that triggered a genuine cluster merge

  // Initialize every node as its own singleton cluster.
  for (let node = 0; node < lattice.numNodes; node++) {
    uf.makeSet(node);
    const isDefect = syndromeNodeIds.has(node) ? 1 : 0;
    defectCount.set(node, isDefect);
    clusterMembers.set(node, new Set([node]));
  }

  const isActive = (root) => (defectCount.get(root) || 0) % 2 === 1;

  function fuse(rootA, rootB) {
    const pa = defectCount.get(rootA) || 0;
    const pb = defectCount.get(rootB) || 0;
    uf.union(rootA, rootB);
    const newRoot = uf.find(rootA);
    const otherRoot = newRoot === rootA ? rootB : rootA;
    const membersNew = clusterMembers.get(newRoot);
    const membersOther = clusterMembers.get(otherRoot);
    for (const m of membersOther) membersNew.add(m);
    clusterMembers.delete(otherRoot);
    defectCount.delete(otherRoot);
    defectCount.set(newRoot, pa + pb);
    return newRoot;
  }

  let rounds = 0;
  const MAX_ROUNDS = lattice.numNodes + 4; // growth radius is bounded by lattice size; +4 is slack, not a magic tune
  while (rounds < MAX_ROUNDS) {
    // Snapshot which clusters are active at the start of this round.
    const activeRoots = new Set();
    for (const root of clusterMembers.keys()) {
      if (isActive(root)) activeRoots.add(root);
    }
    if (activeRoots.size === 0) break;

    // Gather growth increments from every member of every active cluster,
    // for edges not yet full. An edge touched from both sides this round
    // gets +2 (fills in one round); touched from one side gets +1 (fills
    // over two rounds if the far side never joins in on its own).
    const delta = new Map();
    for (const root of activeRoots) {
      for (const node of clusterMembers.get(root)) {
        for (const { edgeId } of lattice.adjacencyOf(node)) {
          if ((edgeGrowth.get(edgeId) || 0) >= 2) continue;
          delta.set(edgeId, (delta.get(edgeId) || 0) + 1);
        }
      }
    }

    const newlyFull = [];
    for (const [edgeId, inc] of delta) {
      const prev = edgeGrowth.get(edgeId) || 0;
      const next = Math.min(2, prev + inc);
      edgeGrowth.set(edgeId, next);
      if (next >= 2 && prev < 2) newlyFull.push(edgeId);
    }

    // Process fusions one at a time, re-checking roots live, so redundant
    // (same-cluster / cycle-forming) edges are correctly excluded from the
    // spanning forest used for peeling.
    for (const edgeId of newlyFull) {
      const edge = lattice.edges[edgeId];
      const ru = uf.find(edge.u);
      const rv = uf.find(edge.v);
      if (ru !== rv) {
        fuse(ru, rv);
        spanningEdges.add(edgeId);
      }
    }

    rounds++;
  }

  // Peel each final cluster's spanning tree from the leaves inward.
  const correction = new Set();
  const visitedClusters = new Set();
  for (let node = 0; node < lattice.numNodes; node++) {
    const root = uf.find(node);
    if (visitedClusters.has(root)) continue;
    visitedClusters.add(root);
    const members = [...clusterMembers.get(root)];
    if (members.length === 1) continue; // isolated node: no edges, nothing to peel (its own defect flag, if any, must be 0 — verified below by residual check)
    const treeEdgeIds = [...spanningEdges].filter((eid) => {
      const e = lattice.edges[eid];
      return uf.find(e.u) === root; // both endpoints share this root by construction
    });
    peelTree(members, treeEdgeIds, lattice, syndromeNodeIds, correction);
  }

  // Independent verification (not an assumption): a correction "closes the
  // syndrome" when applying it together with the original error cancels out,
  // i.e. syndromeOf(correction) == the target syndrome exactly (syndrome is
  // linear over GF(2), so syndromeOf(error XOR correction) is empty iff
  // syndromeOf(correction) matches syndromeOf(error) — which is exactly
  // `syndromeNodeIds`, the input to this function). We recompute
  // syndromeOf(correction) for real here and diff it against the target
  // rather than trust the growth+peel derivation, per this repo's "compute,
  // don't guess" convention. Callers/tests check `residualSyndrome.size ===
  // 0`; a nonempty result means the correction failed to close the syndrome
  // — a decoder bug, independent of whether the eventual logical outcome
  // happens to look right.
  const correctionSyndrome = syndromeOf(lattice, correction);
  const residualSyndrome = symmetricDifference(correctionSyndrome, syndromeNodeIds);

  return { correction, rounds, residualSyndrome };
}

/** Peel one cluster's spanning tree (Duclos-Cianci & Poulin), mutating `correction`. */
function peelTree(memberNodes, edgeIds, lattice, syndromeNodeIds, correction) {
  const adj = new Map(memberNodes.map((n) => [n, new Map()])); // node -> Map(neighbor -> edgeId)
  for (const edgeId of edgeIds) {
    const e = lattice.edges[edgeId];
    adj.get(e.u).set(e.v, edgeId);
    adj.get(e.v).set(e.u, edgeId);
  }
  const degree = new Map(memberNodes.map((n) => [n, adj.get(n).size]));
  const target = new Map(memberNodes.map((n) => [n, syndromeNodeIds.has(n) ? 1 : 0]));
  const removed = new Set();

  const queue = memberNodes.filter((n) => degree.get(n) <= 1);
  let qi = 0;
  while (qi < queue.length) {
    const u = queue[qi++];
    if (removed.has(u)) continue;
    if (degree.get(u) === 0) { removed.add(u); continue; }
    // Find its one still-live neighbor.
    let neighbor = null;
    let edgeId = null;
    for (const [v, eid] of adj.get(u)) {
      if (!removed.has(v)) { neighbor = v; edgeId = eid; break; }
    }
    removed.add(u);
    if (neighbor == null) continue;
    degree.set(neighbor, degree.get(neighbor) - 1);
    if (target.get(u) === 1) {
      correction.add(edgeId);
      target.set(neighbor, target.get(neighbor) ^ 1);
    }
    if (degree.get(neighbor) <= 1 && !removed.has(neighbor)) queue.push(neighbor);
  }
}

/**
 * Run one full bit-flip trial: sample error -> syndrome -> decode -> check
 * whether (error XOR correction) is a trivial loop (success) or a logical
 * operator (failure). Deterministic given `rng`.
 */
export function runBitFlipTrial(lattice, p, rng = Math.random) {
  const error = sampleBitFlipError(lattice, p, rng);
  const syndrome = syndromeOf(lattice, error);
  const { correction, rounds, residualSyndrome } = unionFindDecode(lattice, syndrome);
  const residual = xorEdgeSets(error, correction);
  const success = isHomologicallyTrivial(lattice, residual);
  return {
    success,
    logicalFailure: !success,
    rounds,
    errorWeight: error.size,
    syndromeSize: syndrome.size,
    residualSyndromeClosed: residualSyndrome.size === 0,
  };
}

/**
 * Run one full depolarizing trial: decoupled X-sector and Z-sector decode
 * (see qec-surface-code.js header for why this is decoupled by design).
 * Overall success requires BOTH sectors to resolve without a logical error.
 */
export function runDepolarizingTrial(lattice, p, rng = Math.random) {
  const { xErrors, zErrors } = sampleDepolarizingError(lattice, p, rng);
  const xSyndrome = syndromeOf(lattice, xErrors);
  const zSyndrome = syndromeOf(lattice, zErrors);
  const xDecode = unionFindDecode(lattice, xSyndrome);
  const zDecode = unionFindDecode(lattice, zSyndrome);
  const xResidual = xorEdgeSets(xErrors, xDecode.correction);
  const zResidual = xorEdgeSets(zErrors, zDecode.correction);
  const xOk = isHomologicallyTrivial(lattice, xResidual);
  const zOk = isHomologicallyTrivial(lattice, zResidual);
  return {
    success: xOk && zOk,
    logicalFailure: !(xOk && zOk),
    rounds: Math.max(xDecode.rounds, zDecode.rounds),
    residualSyndromeClosed: xDecode.residualSyndrome.size === 0 && zDecode.residualSyndrome.size === 0,
  };
}

/**
 * Sweep physical error rate `p` across a range for one code distance,
 * returning the estimated logical failure rate at each point. Used to find
 * the threshold crossing (where curves for different distances cross).
 * `trialsPer` Monte Carlo trials per point; deterministic given `rng`.
 */
export function sweepLogicalErrorRate(d, pValues, trialsPer, rng = Math.random, channel = "bitflip") {
  const lattice = buildToricCode(d);
  const runTrial = channel === "depolarizing" ? runDepolarizingTrial : runBitFlipTrial;
  return pValues.map((p) => {
    let failures = 0;
    for (let t = 0; t < trialsPer; t++) {
      if (runTrial(lattice, p, rng).logicalFailure) failures++;
    }
    return { p, logicalErrorRate: failures / trialsPer, trials: trialsPer, d };
  });
}

// ── Honest boundary ─────────────────────────────────────────────────────
// Stabilizer simulation under the Gottesman-Knill theorem (polynomial-time)
// with a Union-Find decoder of almost-linear O(n·α(n)) complexity. This is a
// research/verification simulator, not a control system: real fault-tolerant
// hardware requires decoding within the qubit coherence window
// (microseconds), which is an FPGA/ASIC problem — this engine makes no
// latency claim whatsoever. The error model is i.i.d. and independent per
// qubit; correlated noise, leakage, crosstalk, and realistic measurement-
// error models are not simulated (this is "perfect syndrome measurement," the
// standard first benchmark regime in the literature, not the noisier
// syndrome-extraction-error regime some papers also study). The statevector
// simulator in quantum-compute.js is a different, complementary tool (exact
// amplitudes, ~20-qubit ceiling); it cannot run these codes and this cannot
// produce its amplitudes.
//
// ── Measured threshold vs. the published value (do not overstate this) ──
// The qualitative threshold behavior reproduces cleanly and unambiguously:
// below the crossing, increasing code distance SUPPRESSES the logical error
// rate (topological protection working); above it, increasing distance makes
// things WORSE; and the d3/d5 and d5/d7 crossings agree with each other. That
// is the real evidence the decoder is correct.
//
// The crossing LOCATION, however, lands consistently BELOW the published
// 0.099 (Delfosse & Nickerson, arXiv:1709.06218). Two independent runs with
// different seeds, p-grids and trial counts measured ~0.0952/0.0953 and
// ~0.0916/0.0914 — i.e. roughly 0.4–0.8 percentage points low, reproducibly,
// not as scatter around the published figure.
//
// This is recorded rather than tuned away. The likely contributors, in
// rough order of expected size: (a) finite-size drift — d = 3,5,7 are small,
// and a published threshold is an asymptotic value extrapolated from larger
// distances, so small-distance crossings systematically deviate; (b) this is
// unweighted cluster growth, while optimized Union-Find variants use weighted
// growth and score slightly better; (c) Monte Carlo noise, which at these
// trial counts is real but too small to explain a consistent one-directional
// offset. Treat the number as "reproduces the threshold phenomenon at
// approximately the right place," NOT as an exact reproduction of 0.099.
