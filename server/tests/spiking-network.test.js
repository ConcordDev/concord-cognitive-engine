/**
 * W3-C — spiking neural substrate, LIF-layer tests.
 *
 * Per CLAUDE.md's "compute-don't-guess" doctrine: expected values are
 * closed-form analytic results derived independently of the
 * module-under-test's own numerics (never a value pasted from the
 * module's own output). Run WITHOUT --test-force-exit.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SpikingNetwork,
  createNeuron,
  analyticSubthresholdV,
  analyticISI,
  DEFAULT_NEURON_PARAMS,
  HONEST_BOUNDARY,
} from '../lib/simulation/spiking-network.js';

// Deterministic seeded LCG rng — never Math.random in these tests.
function mkRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const P = { tau_m: 10, V_rest: -65, V_reset: -65, V_th: -50, R: 10, refractory: 2 };

describe('HONEST_BOUNDARY', () => {
  it('is a non-empty disclosure string', () => {
    assert.ok(typeof HONEST_BOUNDARY === 'string' && HONEST_BOUNDARY.length > 40);
  });
});

describe('createNeuron', () => {
  it('applies defaults and starts at V_rest with no prior spike', () => {
    const n = createNeuron('x');
    assert.equal(n.V, DEFAULT_NEURON_PARAMS.V_rest);
    assert.equal(n.lastSpikeTime, -Infinity);
  });

  it('rejects non-positive tau_m and negative refractory', () => {
    assert.throws(() => createNeuron('x', { tau_m: 0 }));
    assert.throws(() => createNeuron('x', { refractory: -1 }));
  });
});

describe('LIF subthreshold trajectory vs analytic closed form', () => {
  // tau_m dV/dt = -(V-V_rest) + R*I, V(0)=V_rest
  // => V(t) = V_rest + R*I*(1 - e^(-t/tau_m))   [analytic, independent of rk4ODE]
  it('matches the analytic exponential-charging solution to ~1e-9 or better', () => {
    const dt = 0.01;
    const I = 1.0; // R*I = 10 < (V_th - V_rest) = 15 -> stays subthreshold
    const net = new SpikingNetwork({ dt });
    net.addNeuron('a', P);
    net.run(50, { a: I });
    const simV = net.neurons.get('a').V;
    const analytic = analyticSubthresholdV(50, P, I);
    const absErr = Math.abs(simV - analytic);
    assert.ok(absErr < 1e-9, `abs error ${absErr} not < 1e-9 (sim=${simV}, analytic=${analytic})`);
    assert.equal(net.getSpikeTrain('a').length, 0, 'must not have crossed threshold');
  });

  it('tracks the analytic curve at multiple intermediate times, not just the endpoint', () => {
    const dt = 0.01;
    const I = 1.2; // R*I = 12 < 15, still subthreshold
    const net = new SpikingNetwork({ dt });
    net.addNeuron('a', P);
    const checkpoints = [1, 5, 10, 25, 50];
    let idx = 0;
    const steps = Math.round(checkpoints[checkpoints.length - 1] / dt);
    for (let i = 0; i < steps; i++) {
      net.step({ a: I });
      if (idx < checkpoints.length && Math.abs(net.t - checkpoints[idx]) < dt / 2) {
        const simV = net.neurons.get('a').V;
        const analytic = analyticSubthresholdV(net.t, P, I);
        assert.ok(Math.abs(simV - analytic) < 1e-8, `t=${net.t}: sim=${simV} analytic=${analytic}`);
        idx++;
      }
    }
    assert.equal(idx, checkpoints.length, 'all checkpoints must have been sampled');
  });
});

describe('firing threshold behavior', () => {
  it('never fires when R*I is below (V_th - V_rest)', () => {
    const net = new SpikingNetwork({ dt: 0.01 });
    net.addNeuron('a', P);
    net.run(500, { a: 1.0 }); // R*I = 10 < 15
    assert.equal(net.getSpikeTrain('a').length, 0);
    // and settles at the correct subthreshold steady state
    const ss = P.V_rest + P.R * 1.0;
    assert.ok(Math.abs(net.neurons.get('a').V - ss) < 1e-6);
  });

  it('fires periodically when R*I is above (V_th - V_rest), matching the analytic ISI', () => {
    const dt = 0.01;
    const I = 2.0; // R*I = 20 > 15
    const net = new SpikingNetwork({ dt });
    net.addNeuron('a', { ...P, refractory: 0 }); // isolate the pure charging-time ISI formula
    net.run(300, { a: I });
    const spikes = net.getSpikeTrain('a').map((s) => s.time);
    assert.ok(spikes.length >= 10, `expected many spikes, got ${spikes.length}`);
    const isis = [];
    for (let i = 1; i < spikes.length; i++) isis.push(spikes[i] - spikes[i - 1]);
    // Pass the SAME params the network is running (refractory: 0) — analyticISI
    // now accounts for refractory and V_reset, so the two sides must agree on
    // the full parameter set rather than coincidentally agreeing because the
    // formula ignored them.
    const analytic = analyticISI({ ...P, refractory: 0 }, I);
    // Skip the very first ISI (transient from V_rest, not yet periodic) — the
    // formula assumes periodic firing from V_reset === V_rest, which is true
    // for every ISI here since V_reset === V_rest, so even isis[0] should
    // match, but we assert on the full steady train for robustness.
    for (const isi of isis) {
      assert.ok(Math.abs(isi - analytic) < 0.02, `isi ${isi} vs analytic ${analytic}`);
    }
  });

  it('analyticISI reports Infinity (never reaches threshold) when drive is at or below the gap', () => {
    assert.equal(analyticISI(P, 1.5), Infinity); // R*I = 15 == gap
    assert.equal(analyticISI(P, 1.0), Infinity); // R*I = 10 < gap
  });
});

describe('refractory period is honored', () => {
  it('no two spikes from one neuron closer than the refractory period, under strong drive', () => {
    const dt = 0.01;
    const refractory = 5;
    const net = new SpikingNetwork({ dt });
    net.addNeuron('a', { ...P, refractory });
    net.run(200, { a: 100 }); // enormous overdrive — would fire almost every step without clamping
    const spikes = net.getSpikeTrain('a').map((s) => s.time);
    assert.ok(spikes.length >= 20, `expected many spikes under overdrive, got ${spikes.length}`);
    for (let i = 1; i < spikes.length; i++) {
      const isi = spikes[i] - spikes[i - 1];
      assert.ok(isi >= refractory - 1e-9, `ISI ${isi} violates refractory period ${refractory}`);
    }
  });

  it('membrane potential is held at V_reset throughout the refractory window even under continued strong drive', () => {
    const dt = 0.01;
    const net = new SpikingNetwork({ dt });
    net.addNeuron('a', { ...P, refractory: 3 });
    // Drive until first spike, then sample V for exactly the refractory window.
    let spiked = false;
    let spikeTime = null;
    for (let i = 0; i < 100000 && !spiked; i++) {
      const s = net.step({ a: 50 });
      if (s.length) { spiked = true; spikeTime = s[0].time; }
    }
    assert.ok(spiked, 'neuron must have spiked under strong drive');
    while (net.t < spikeTime + 3 - dt / 2) {
      net.step({ a: 50 });
      assert.equal(net.neurons.get('a').V, P.V_reset, `V must be clamped at V_reset during refractory (t=${net.t})`);
    }
  });
});

describe('determinism', () => {
  it('same seed => identical spike train, twice, under stochastic drive', () => {
    function build() {
      const net = new SpikingNetwork({ dt: 0.1, rng: mkRng(1234) });
      net.addNeuron('a', P);
      net.run(300, (t, n) => ({ a: 1.6 + n.gaussianNoise(0.3) }));
      return net.getSpikeTrain('a').map((s) => s.time);
    }
    const r1 = build();
    const r2 = build();
    assert.ok(r1.length > 0, 'stochastic drive should produce spikes to compare');
    assert.deepEqual(r1, r2);
  });

  it('different seeds produce different spike trains (sanity that the rng is actually wired in)', () => {
    function build(seed) {
      const net = new SpikingNetwork({ dt: 0.1, rng: mkRng(seed) });
      net.addNeuron('a', P);
      net.run(300, (t, n) => ({ a: 1.6 + n.gaussianNoise(0.6) }));
      return net.getSpikeTrain('a').map((s) => s.time);
    }
    const r1 = build(1);
    const r2 = build(2);
    assert.notDeepEqual(r1, r2);
  });
});

describe('network wiring + synapse delivery', () => {
  it('addSynapse rejects unknown neuron ids', () => {
    const net = new SpikingNetwork({ dt: 0.1 });
    net.addNeuron('a', P);
    assert.throws(() => net.addSynapse({ from: 'a', to: 'ghost', weight: 1 }));
    assert.throws(() => net.addSynapse({ from: 'ghost', to: 'a', weight: 1 }));
  });

  it('delivers a voltage-jump synapse after its delay, not before', () => {
    const dt = 0.1;
    const net = new SpikingNetwork({ dt });
    net.addNeuron('pre', { ...P, refractory: 0 });
    net.addNeuron('post', { ...P, V_th: 1e9 }); // post never spikes on its own — pure delivery probe
    net.addSynapse({ from: 'pre', to: 'post', weight: 5, delay: 2 });
    // Drive pre hard enough to fire almost immediately, post gets zero current.
    let fired = false;
    let fireTime = null;
    for (let i = 0; i < 1000 && !fired; i++) {
      const s = net.step({ pre: 50, post: 0 });
      if (s.some((x) => x.neuron === 'pre')) { fired = true; fireTime = s[0].time; }
    }
    assert.ok(fired);
    const vBeforeDelivery = net.neurons.get('post').V;
    assert.equal(vBeforeDelivery, P.V_rest, 'no delivery yet — must still be at rest');
    // advance past delivery time (fireTime + delay)
    while (net.t < fireTime + 2 + dt) net.step({ pre: 0, post: 0 });
    assert.ok(net.neurons.get('post').V > P.V_rest, 'synapse must have delivered the jump by now');
  });

  it('removeSynapse and getSynapseWeights reflect live state', () => {
    const net = new SpikingNetwork({ dt: 0.1 });
    net.addNeuron('a', P);
    net.addNeuron('b', P);
    const id = net.addSynapse({ from: 'a', to: 'b', weight: 0.7, delay: 1 });
    assert.equal(net.getSynapseWeights().length, 1);
    assert.equal(net.removeSynapse(id), true);
    assert.equal(net.getSynapseWeights().length, 0);
    assert.equal(net.removeSynapse('nonexistent'), false);
  });

  it('reset() restores rest potential and clears spike history', () => {
    const net = new SpikingNetwork({ dt: 0.1 });
    net.addNeuron('a', P);
    net.run(200, { a: 2.0 });
    assert.ok(net.getSpikeTrain('a').length > 0);
    net.reset();
    assert.equal(net.t, 0);
    assert.equal(net.getSpikeTrain('a').length, 0);
    assert.equal(net.neurons.get('a').V, P.V_rest);
    assert.equal(net.neurons.get('a').lastSpikeTime, -Infinity);
  });
});
