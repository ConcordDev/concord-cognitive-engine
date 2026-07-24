/**
 * STDP — spike-timing-dependent plasticity (canonical pairwise exponential
 * window) applied to a SpikingNetwork's real recorded spike trains, plus
 * deterministic (seed-driven) dynamic topology: synapse pruning at the
 * weight floor and Hebbian-correlated synapse growth.
 *
 * Weight update for a pre/post spike-time pair with dt = t_post - t_pre:
 *   dt > 0 (pre fired before post)  -> potentiation: +A_plus  * exp(-dt/tau_plus)
 *   dt < 0 (post fired before pre)  -> depression:  -A_minus * exp(-|dt|/tau_minus)
 * This is the classic pairwise model (Bi & Poo 1998; Song, Miller & Abbott
 * 2000) — a simplification of measured biological plasticity. Triplet and
 * voltage-dependent STDP effects are NOT modeled. See spiking-network.js's
 * HONEST_BOUNDARY for the full disclosure; it applies to this module too.
 */

import { HONEST_BOUNDARY } from './spiking-network.js';

export { HONEST_BOUNDARY };

export const DEFAULT_STDP_PARAMS = Object.freeze({
  A_plus: 0.01,
  A_minus: 0.012,
  tau_plus: 20, // ms
  tau_minus: 20, // ms
  w_min: 0,
  w_max: 1,
  mode: 'nearest', // pairing scheme — see pairSpikes()
  window: Infinity,
});

/**
 * Δw for a single spike-timing offset dt = t_post - t_pre (ms).
 * dt === 0 (simultaneous) is defined as zero change — neither side of the
 * window applies at the boundary.
 */
export function stdpWeightChange(dt, params = {}) {
  const p = { ...DEFAULT_STDP_PARAMS, ...params };
  if (dt === 0) return 0;
  if (dt > 0) return p.A_plus * Math.exp(-dt / p.tau_plus);
  return -p.A_minus * Math.exp(dt / p.tau_minus); // dt < 0 => exp(dt/tau) = exp(-|dt|/tau)
}

export function clampWeight(w, wMin, wMax) {
  return Math.min(wMax, Math.max(wMin, w));
}

/**
 * Pair a pre-synaptic and post-synaptic spike train into a list of
 * dt = t_post - t_pre offsets, ready for stdpWeightChange.
 *
 * mode: 'nearest' (DEFAULT) | 'all-to-all'
 *  - 'all-to-all': every pre spike paired with every post spike. Standard,
 *    but O(n*m) pairs — the classic combinatorial blow-up on long trains.
 *  - 'nearest' (default): adjacent-in-time pairing only, to avoid that
 *    blow-up. Concretely: each POST spike pairs with the most recent PRE
 *    spike strictly before it (a potentiation candidate, dt > 0); each PRE
 *    spike pairs with the most recent POST spike strictly before it (a
 *    depression candidate, dt < 0). Each spike contributes at most one
 *    pairing per role, so this never double-counts a single adjacency.
 *
 * `window` (ms) optionally discards pairs with |dt| beyond it.
 */
export function pairSpikes(preTimes, postTimes, { mode = 'nearest', window = Infinity } = {}) {
  const pre = [...preTimes].sort((a, b) => a - b);
  const post = [...postTimes].sort((a, b) => a - b);
  const pairs = [];

  if (mode === 'all-to-all') {
    for (const tpre of pre) {
      for (const tpost of post) {
        const dt = tpost - tpre;
        if (Math.abs(dt) <= window) pairs.push(dt);
      }
    }
    return pairs;
  }
  if (mode !== 'nearest') throw new Error(`pairSpikes: unknown mode '${mode}'`);

  for (const tpost of post) {
    let bestPre = -Infinity;
    for (const tpre of pre) {
      if (tpre < tpost && tpre > bestPre) bestPre = tpre;
    }
    if (bestPre > -Infinity) {
      const dt = tpost - bestPre;
      if (dt <= window) pairs.push(dt);
    }
  }
  for (const tpre of pre) {
    let bestPost = -Infinity;
    for (const tpost of post) {
      if (tpost < tpre && tpost > bestPost) bestPost = tpost;
    }
    if (bestPost > -Infinity) {
      const dt = bestPost - tpre;
      if (Math.abs(dt) <= window) pairs.push(dt);
    }
  }
  return pairs;
}

/** Apply STDP to one synapse given its endpoints' real spike-time arrays. Returns the update, does not mutate. */
export function computeSynapseUpdate(synapse, preSpikeTimes, postSpikeTimes, params = {}) {
  const p = { ...DEFAULT_STDP_PARAMS, ...params };
  const pairs = pairSpikes(preSpikeTimes, postSpikeTimes, { mode: p.mode, window: p.window });
  let deltaW = 0;
  for (const dt of pairs) deltaW += stdpWeightChange(dt, p);
  const weight = clampWeight(synapse.weight + deltaW, p.w_min, p.w_max);
  return { weight, deltaW, pairCount: pairs.length };
}

/**
 * Apply STDP to every enabled synapse in a SpikingNetwork using its real
 * recorded spike trains (network.getSpikeTrain). Mutates synapse weights in
 * place and returns a per-synapse report.
 */
export function applySTDP(network, params = {}) {
  const results = [];
  for (const syn of network.synapses) {
    if (!syn.enabled) continue;
    const preSpikes = network.getSpikeTrain(syn.from).map((s) => s.time);
    const postSpikes = network.getSpikeTrain(syn.to).map((s) => s.time);
    const { weight, deltaW, pairCount } = computeSynapseUpdate(syn, preSpikes, postSpikes, params);
    syn.weight = weight;
    results.push({ id: syn.id, from: syn.from, to: syn.to, weight, deltaW, pairCount });
  }
  return results;
}

// ─── Dynamic topology ────────────────────────────────────────────────────────

/**
 * Prune synapses whose weight has decayed to (within epsilon of) the floor.
 * Mutates network.synapses in place. Returns the removed synapse ids.
 */
export function pruneSynapses(network, { floor = DEFAULT_STDP_PARAMS.w_min, epsilon = 1e-6 } = {}) {
  const pruned = [];
  network.synapses = network.synapses.filter((s) => {
    if (s.enabled && s.weight <= floor + epsilon) {
      pruned.push(s.id);
      return false;
    }
    return true;
  });
  return pruned;
}

/**
 * Candidate pairs for growth: neuron pairs with NO existing synapse whose
 * recorded spikes co-occurred within `correlationWindow` ms ("fire together,
 * wire together" — Hebbian candidacy only; formation itself is still gated
 * by formationProbability below).
 */
function defaultCandidatePairs(network, correlationWindow) {
  const ids = [...network.neurons.keys()];
  const spikesById = new Map(ids.map((id) => [id, network.getSpikeTrain(id)]));
  const pairs = [];
  for (const a of ids) {
    const spikesA = spikesById.get(a);
    if (!spikesA.length) continue;
    for (const b of ids) {
      if (a === b) continue;
      const spikesB = spikesById.get(b);
      if (!spikesB.length) continue;
      const correlated = spikesA.some((sa) => spikesB.some((sb) => Math.abs(sa.time - sb.time) <= correlationWindow));
      if (correlated) pairs.push([a, b]);
    }
  }
  return pairs;
}

/**
 * Deterministically (given the network's seeded rng) form new synapses
 * between correlated, currently-unconnected neuron pairs. Returns the ids
 * of newly-formed synapses.
 */
export function growSynapses(network, {
  candidatePairs,
  formationProbability = 0.1,
  initialWeight = 0.05,
  delay = 1,
  correlationWindow = 5,
} = {}) {
  const formed = [];
  const pairsToConsider = candidatePairs || defaultCandidatePairs(network, correlationWindow);
  for (const [from, to] of pairsToConsider) {
    if (from === to) continue;
    if (network.synapses.some((s) => s.from === from && s.to === to)) continue;
    if (network.rng() < formationProbability) {
      formed.push(network.addSynapse({ from, to, weight: initialWeight, delay }));
    }
  }
  return formed;
}
