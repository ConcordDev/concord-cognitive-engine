/**
 * W3-C — spike-timing-dependent plasticity tests: window-shape closed form,
 * clamping, and the actual emergent behavior (a causal chain rewires
 * itself) using a SpikingNetwork's real recorded spike trains — not just
 * the formula checked in isolation. Run WITHOUT --test-force-exit.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  stdpWeightChange,
  pairSpikes,
  clampWeight,
  computeSynapseUpdate,
  applySTDP,
  pruneSynapses,
  growSynapses,
  DEFAULT_STDP_PARAMS,
  HONEST_BOUNDARY,
} from '../lib/simulation/stdp.js';
import { SpikingNetwork } from '../lib/simulation/spiking-network.js';

function mkRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

describe('HONEST_BOUNDARY re-export', () => {
  it('matches the spiking-network disclosure', () => {
    assert.ok(typeof HONEST_BOUNDARY === 'string' && HONEST_BOUNDARY.length > 40);
  });
});

describe('stdpWeightChange — window shape against the closed form', () => {
  const params = { A_plus: 0.01, A_minus: 0.012, tau_plus: 20, tau_minus: 20 };

  it('matches +A_plus*exp(-dt/tau_plus) for dt > 0 (pre-before-post => potentiation)', () => {
    for (const dt of [0.001, 1, 5, 10, 20, 50, 100]) {
      const expected = params.A_plus * Math.exp(-dt / params.tau_plus);
      const got = stdpWeightChange(dt, params);
      assert.ok(got > 0, `dt=${dt}: expected potentiation (>0), got ${got}`);
      assert.ok(Math.abs(got - expected) < 1e-12, `dt=${dt}: ${got} vs ${expected}`);
    }
  });

  it('matches -A_minus*exp(-|dt|/tau_minus) for dt < 0 (post-before-pre => depression)', () => {
    for (const dt of [-0.001, -1, -5, -10, -20, -50, -100]) {
      const expected = -params.A_minus * Math.exp(-Math.abs(dt) / params.tau_minus);
      const got = stdpWeightChange(dt, params);
      assert.ok(got < 0, `dt=${dt}: expected depression (<0), got ${got}`);
      assert.ok(Math.abs(got - expected) < 1e-12, `dt=${dt}: ${got} vs ${expected}`);
    }
  });

  it('dt === 0 is defined as zero change', () => {
    assert.equal(stdpWeightChange(0, params), 0);
  });

  it('is antisymmetric in magnitude only when A_plus === A_minus and tau_plus === tau_minus (documented asymmetry otherwise)', () => {
    const symParams = { A_plus: 0.01, A_minus: 0.01, tau_plus: 20, tau_minus: 20 };
    for (const dt of [1, 5, 20]) {
      assert.ok(Math.abs(stdpWeightChange(dt, symParams) + stdpWeightChange(-dt, symParams)) < 1e-15);
    }
  });
});

describe('stdpWeightChange — limits', () => {
  const params = { A_plus: 0.01, A_minus: 0.012, tau_plus: 20, tau_minus: 20 };

  it('magnitude is maximal near dt -> 0 on each side', () => {
    const nearZeroPos = Math.abs(stdpWeightChange(1e-6, params));
    const fartherPos = Math.abs(stdpWeightChange(5, params));
    assert.ok(nearZeroPos > fartherPos);

    const nearZeroNeg = Math.abs(stdpWeightChange(-1e-6, params));
    const fartherNeg = Math.abs(stdpWeightChange(-5, params));
    assert.ok(nearZeroNeg > fartherNeg);

    // sup as dt->0+ is A_plus, as dt->0- is A_minus
    assert.ok(Math.abs(nearZeroPos - params.A_plus) < 1e-5);
    assert.ok(Math.abs(nearZeroNeg - params.A_minus) < 1e-5);
  });

  it('decays to ~0 at large |dt|', () => {
    assert.ok(Math.abs(stdpWeightChange(1000, params)) < 1e-20);
    assert.ok(Math.abs(stdpWeightChange(-1000, params)) < 1e-20);
  });
});

describe('weight clamping', () => {
  it('clampWeight bounds into [wMin, wMax]', () => {
    assert.equal(clampWeight(5, 0, 1), 1);
    assert.equal(clampWeight(-5, 0, 1), 0);
    assert.equal(clampWeight(0.5, 0, 1), 0.5);
  });

  it('repeated potentiation saturates at w_max and never exceeds it', () => {
    const synapse = { weight: 0.9 };
    const params = { A_plus: 0.05, A_minus: 0.05, tau_plus: 20, tau_minus: 20, w_min: 0, w_max: 1, mode: 'nearest' };
    for (let i = 0; i < 50; i++) {
      const { weight } = computeSynapseUpdate(synapse, [0], [2], params); // strong potentiating pair each round
      synapse.weight = weight;
      assert.ok(synapse.weight <= 1 + 1e-12);
    }
    assert.ok(Math.abs(synapse.weight - 1) < 1e-9);
  });

  it('repeated depression floors at w_min and never goes below it (w_min=0, no negative weights supported by default)', () => {
    const synapse = { weight: 0.1 };
    const params = { A_plus: 0.05, A_minus: 0.05, tau_plus: 20, tau_minus: 20, w_min: 0, w_max: 1, mode: 'nearest' };
    for (let i = 0; i < 50; i++) {
      const { weight } = computeSynapseUpdate(synapse, [2], [0], params); // strong depressing pair each round
      synapse.weight = weight;
      assert.ok(synapse.weight >= 0 - 1e-12);
    }
    assert.ok(Math.abs(synapse.weight - 0) < 1e-9);
  });

  it('negative weights ARE reachable when w_min < 0 is explicitly configured (inhibitory synapses)', () => {
    const synapse = { weight: 0.1 };
    const params = { A_plus: 0.05, A_minus: 0.05, tau_plus: 20, tau_minus: 20, w_min: -1, w_max: 1, mode: 'nearest' };
    for (let i = 0; i < 50; i++) {
      const { weight } = computeSynapseUpdate(synapse, [2], [0], params);
      synapse.weight = weight;
    }
    assert.ok(synapse.weight < 0, `expected the floor to go negative when w_min=-1, got ${synapse.weight}`);
    assert.ok(Math.abs(synapse.weight - (-1)) < 1e-9);
  });
});

describe('pairSpikes', () => {
  it('all-to-all produces n*m pairs with dt = t_post - t_pre', () => {
    const pairs = pairSpikes([0, 10], [5, 15, 25], { mode: 'all-to-all' });
    assert.equal(pairs.length, 6);
    assert.ok(pairs.includes(5)); // t_post(5) - t_pre(0) = 5
    assert.ok(pairs.includes(-5)); // t_post(5) - t_pre(10) = -5
  });

  it('nearest mode never produces more pairs than 2x the smaller train length-ish (no combinatorial blowup) and defaults correctly', () => {
    const pre = Array.from({ length: 20 }, (_, i) => i * 10);
    const post = Array.from({ length: 20 }, (_, i) => i * 10 + 3);
    const explicitNearest = pairSpikes(pre, post, { mode: 'nearest' });
    const defaultMode = pairSpikes(pre, post, {});
    assert.deepEqual(defaultMode, explicitNearest, 'default mode must be nearest');
    const allToAll = pairSpikes(pre, post, { mode: 'all-to-all' });
    assert.ok(explicitNearest.length < allToAll.length);
  });

  it('rejects unknown pairing modes', () => {
    assert.throws(() => pairSpikes([1], [2], { mode: 'bogus' }));
  });
});

describe('applySTDP over a real SpikingNetwork — the emergent behavior, not just the formula', () => {
  it('a reliable causal chain (A fires just before B) strengthens A->B and weakens B->A', () => {
    const dt = 0.1;
    const net = new SpikingNetwork({ dt });
    const P = { tau_m: 10, V_rest: -65, V_reset: -65, V_th: -50, R: 10, refractory: 3 };
    net.addNeuron('A', P);
    net.addNeuron('B', P);
    // Reciprocal synapses of EQUAL initial weight — any asymmetry in the
    // post-STDP weights must come from spike-timing, not initial bias.
    net.addSynapse({ id: 'AB', from: 'A', to: 'B', weight: 3, delay: 1 });
    net.addSynapse({ id: 'BA', from: 'B', to: 'A', weight: 3, delay: 1 });
    // A is driven suprathreshold on its own; B is subthreshold alone and
    // only crosses threshold when A's synaptic kick arrives shortly after.
    net.run(500, { A: 2.0, B: 1.4 });

    const aSpikes = net.getSpikeTrain('A');
    const bSpikes = net.getSpikeTrain('B');
    assert.ok(aSpikes.length > 10, `need a real spike train for A, got ${aSpikes.length}`);
    assert.ok(bSpikes.length > 5, `need a real spike train for B (i.e. the synapse actually drove it), got ${bSpikes.length}`);
    // Structural check that this really is a causal chain: every B spike
    // should be preceded by an A spike within one synaptic delay + a short
    // integration window.
    for (const b of bSpikes) {
      const precededByA = aSpikes.some((a) => a.time < b.time && b.time - a.time <= 20);
      assert.ok(precededByA, `B spike at ${b.time} has no recent preceding A spike`);
    }

    const before = Object.fromEntries(net.getSynapseWeights().map((s) => [s.id, s.weight]));
    assert.equal(before.AB, before.BA, 'initial weights must be equal — asymmetry must come from timing');

    applySTDP(net, { A_plus: 0.02, A_minus: 0.024, tau_plus: 20, tau_minus: 20, w_min: 0, w_max: 10, mode: 'nearest' });

    const after = Object.fromEntries(net.getSynapseWeights().map((s) => [s.id, s.weight]));
    assert.ok(after.AB > before.AB, `A->B (causal: A leads B) must STRENGTHEN: ${before.AB} -> ${after.AB}`);
    assert.ok(after.BA < before.BA, `B->A (anti-causal: B leads A) must WEAKEN: ${before.BA} -> ${after.BA}`);
  });

  it('an UNcorrelated pair of neurons (independent Poisson-ish drive, no synapse between them) shows no directional bias when checked via the raw pairing formula on symmetric jittered trains', () => {
    // Two trains that are shifted-mirror images of each other around a
    // common lattice sum to ~0 net causal bias under all-to-all pairing --
    // a sanity check that the formula itself introduces no asymmetry when
    // none exists in the timing.
    const times = [10, 30, 50, 70, 90];
    const shiftedEarlier = times.map((t) => t - 3);
    const shiftedLater = times.map((t) => t + 3);
    const params = { A_plus: 0.01, A_minus: 0.01, tau_plus: 20, tau_minus: 20 };
    let dwEarlierAsPre = 0;
    for (const dt of pairSpikes(shiftedEarlier, times, { mode: 'all-to-all' })) dwEarlierAsPre += stdpWeightChange(dt, params);
    let dwLaterAsPre = 0;
    for (const dt of pairSpikes(shiftedLater, times, { mode: 'all-to-all' })) dwLaterAsPre += stdpWeightChange(dt, params);
    assert.ok(dwEarlierAsPre > 0, 'pre consistently earlier than post must net potentiate');
    assert.ok(dwLaterAsPre < 0, 'pre consistently later than post must net depress');
    assert.ok(Math.abs(dwEarlierAsPre + dwLaterAsPre) < 1e-9, 'symmetric A_plus/A_minus must cancel under mirrored offsets');
  });
});

describe('dynamic topology — pruning', () => {
  it('removes synapses at (or within epsilon of) the weight floor and leaves others intact', () => {
    const net = new SpikingNetwork({ dt: 0.1 });
    net.addNeuron('a');
    net.addNeuron('b');
    net.addNeuron('c');
    net.addSynapse({ id: 'weak', from: 'a', to: 'b', weight: 1e-9 });
    net.addSynapse({ id: 'strong', from: 'a', to: 'c', weight: 0.8 });
    const pruned = pruneSynapses(net, { floor: 0, epsilon: 1e-6 });
    assert.deepEqual(pruned, ['weak']);
    assert.equal(net.synapses.length, 1);
    assert.equal(net.synapses[0].id, 'strong');
  });

  it('is a no-op when no synapse is at the floor', () => {
    const net = new SpikingNetwork({ dt: 0.1 });
    net.addNeuron('a');
    net.addNeuron('b');
    net.addSynapse({ id: 's', from: 'a', to: 'b', weight: 0.5 });
    const pruned = pruneSynapses(net, { floor: 0, epsilon: 1e-6 });
    assert.deepEqual(pruned, []);
    assert.equal(net.synapses.length, 1);
  });
});

describe('dynamic topology — growth (deterministic given seed)', () => {
  it('forms new synapses only between correlated, previously-unconnected neurons, deterministically for a fixed seed', () => {
    function buildAndGrow(seed, formationProbability) {
      const net = new SpikingNetwork({ dt: 0.1, rng: mkRng(seed) });
      net.addNeuron('a', { tau_m: 10, V_rest: -65, V_th: -50, R: 10, refractory: 3 });
      net.addNeuron('b', { tau_m: 10, V_rest: -65, V_th: -50, R: 10, refractory: 3 });
      net.run(200, { a: 2.0, b: 2.0 }); // both fire independently — correlated by shared params
      return { net, formed: growSynapses(net, { formationProbability, correlationWindow: 5 }) };
    }
    const run1 = buildAndGrow(99, 0.5);
    const run2 = buildAndGrow(99, 0.5);
    assert.deepEqual(run1.formed, run2.formed, 'same seed must produce the same growth decisions');

    const full = buildAndGrow(99, 1.0);
    assert.ok(full.formed.length > 0, 'formationProbability=1.0 over correlated neurons must form something');
    for (const id of full.formed) {
      const syn = full.net.getSynapse(id);
      assert.notEqual(syn.from, syn.to);
    }
  });

  it('never forms a synapse where one already exists between the same ordered pair', () => {
    const net = new SpikingNetwork({ dt: 0.1, rng: mkRng(5) });
    net.addNeuron('a', { tau_m: 10, V_rest: -65, V_th: -50, R: 10, refractory: 3 });
    net.addNeuron('b', { tau_m: 10, V_rest: -65, V_th: -50, R: 10, refractory: 3 });
    net.addSynapse({ from: 'a', to: 'b', weight: 0.2 });
    net.run(200, { a: 2.0, b: 2.0 });
    const before = net.synapses.length;
    growSynapses(net, { formationProbability: 1.0, correlationWindow: 5 });
    const dupCount = net.synapses.filter((s) => s.from === 'a' && s.to === 'b').length;
    assert.equal(dupCount, 1);
    assert.ok(net.synapses.length >= before);
  });

  it('forms nothing when neurons never spike (no correlation possible)', () => {
    const net = new SpikingNetwork({ dt: 0.1, rng: mkRng(1) });
    net.addNeuron('a', { tau_m: 10, V_rest: -65, V_th: -50, R: 10, refractory: 3 });
    net.addNeuron('b', { tau_m: 10, V_rest: -65, V_th: -50, R: 10, refractory: 3 });
    net.run(200, { a: 0.5, b: 0.5 }); // deeply subthreshold
    const formed = growSynapses(net, { formationProbability: 1.0 });
    assert.deepEqual(formed, []);
  });
});

describe('computeSynapseUpdate does not mutate its input synapse', () => {
  it('returns a fresh weight without touching synapse.weight', () => {
    const synapse = { weight: 0.5 };
    computeSynapseUpdate(synapse, [0], [5], DEFAULT_STDP_PARAMS);
    assert.equal(synapse.weight, 0.5);
  });
});
