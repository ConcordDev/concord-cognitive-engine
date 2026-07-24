/**
 * Spiking Network — leaky integrate-and-fire (LIF) neurons on a weighted,
 * delayed, dynamically-rewireable synapse graph.
 *
 * Membrane dynamics for each neuron:
 *   tau_m * dV/dt = -(V - V_rest) + R * I(t)
 * integrated with the repo's existing RK4 ODE solver
 * (server/lib/compute/numerical.js#rk4ODE) rather than a hand-rolled
 * integrator — the repo already has RK4, Euler, and a separate Verlet
 * integrator; a fourth would be exactly the duplication a prior audit
 * flagged. Because a spike is a *discontinuous* event (threshold crossing
 * resets V instantly and opens a refractory window), the network cannot
 * hand rk4ODE one call spanning many steps the way a smooth-ODE caller
 * (e.g. degradation-kinetics.js) does — instead it calls rk4ODE once per
 * simulation step (`t0` -> `t0+dt`, itself resolved with a single RK4
 * sub-step), checks for threshold crossing / refractory clamp between
 * calls, and lets rk4ODE do the actual numerical integration.
 *
 * Synapses are voltage-jump ("delta") connections: a pre-synaptic spike at
 * time t is delivered to the post-synaptic neuron's membrane potential as
 * V += weight at time t + delay. This is a standard simplification (used
 * e.g. in introductory Brian2/NEST examples) that keeps the network
 * analytically checkable — see the honest boundary below.
 *
 * HONEST BOUNDARY: this is a simulation of neuromorphic DYNAMICS, not
 * neuromorphic HARDWARE. Leaky integrate-and-fire is a deliberately simple
 * point-neuron abstraction: no dendritic computation, no ion-channel or
 * Hodgkin-Huxley conductance dynamics, no neuromodulation, no glial
 * interaction. "Dynamic topology" (see stdp.js#pruneSynapses/growSynapses)
 * means the simulator adds and prunes synapse objects in software; nothing
 * here reconfigures physical routing, and no claim is made about any
 * particular non-von-Neumann silicon. This runs on the same conventional
 * CPU as everything else in this codebase. Its value is as a deterministic,
 * inspectable model of spike-driven plasticity — not as an emulation of any
 * real neuromorphic chip.
 */

import { rk4ODE } from '../compute/numerical.js';

export const HONEST_BOUNDARY =
  'Simulated neuromorphic dynamics (leaky integrate-and-fire point neurons + ' +
  'pairwise STDP), not neuromorphic hardware. No dendritic computation, no ' +
  'Hodgkin-Huxley conductances, no neuromodulation, no glial interaction. ' +
  '"Dynamic topology" means synapses are added/pruned in software on a ' +
  'conventional CPU; no physical routing or silicon is implied.';

export const DEFAULT_NEURON_PARAMS = Object.freeze({
  tau_m: 10, // membrane time constant, ms
  V_rest: -65, // resting potential, mV
  V_reset: -65, // post-spike reset potential, mV
  V_th: -50, // spike threshold, mV
  R: 10, // membrane resistance, MOhm
  refractory: 2, // absolute refractory period, ms
});

/** Gaussian shock via Box-Muller (same construction as stochastic.js#monteCarloExit). */
function gaussianFromUniforms(rng) {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function createNeuron(id, params = {}) {
  const p = { ...DEFAULT_NEURON_PARAMS, ...params };
  if (!(p.tau_m > 0)) throw new Error(`createNeuron(${id}): tau_m must be > 0`);
  if (!(p.refractory >= 0)) throw new Error(`createNeuron(${id}): refractory must be >= 0`);
  return {
    id,
    tau_m: p.tau_m,
    V_rest: p.V_rest,
    V_reset: p.V_reset,
    V_th: p.V_th,
    R: p.R,
    refractory: p.refractory,
    V: p.V_rest,
    lastSpikeTime: -Infinity,
  };
}

export class SpikingNetwork {
  /**
   * @param {object} opts
   * @param {number} opts.dt - simulation step, ms.
   * @param {() => number} opts.rng - injectable uniform-[0,1) RNG. Defaults
   *   to Math.random; pass a seeded generator (see tests) for determinism.
   */
  constructor({ dt = 0.1, rng = Math.random } = {}) {
    if (!(dt > 0)) throw new Error('SpikingNetwork: dt must be > 0');
    this.dt = dt;
    this.rng = rng;
    this.neurons = new Map();
    this.synapses = [];
    this._synapseSeq = 0;
    this.t = 0;
    this.spikeTrain = []; // [{ neuron, time }], append-only, chronological
    this._pending = []; // scheduled synaptic deliveries [{ time, to, amount }]
  }

  addNeuron(id, params) {
    if (this.neurons.has(id)) throw new Error(`SpikingNetwork: neuron '${id}' already exists`);
    this.neurons.set(id, createNeuron(id, params));
    return id;
  }

  addSynapse({ from, to, weight = 1, delay = 0, id } = {}) {
    if (!this.neurons.has(from)) throw new Error(`SpikingNetwork.addSynapse: unknown source neuron '${from}'`);
    if (!this.neurons.has(to)) throw new Error(`SpikingNetwork.addSynapse: unknown target neuron '${to}'`);
    const synId = id || `syn_${this._synapseSeq++}`;
    this.synapses.push({ id: synId, from, to, weight, delay: Math.max(0, delay), enabled: true });
    return synId;
  }

  removeSynapse(id) {
    const idx = this.synapses.findIndex((s) => s.id === id);
    if (idx >= 0) this.synapses.splice(idx, 1)[0];
    return idx >= 0;
  }

  getSynapse(id) {
    return this.synapses.find((s) => s.id === id) || null;
  }

  /** Gaussian noise current draw using the network's injected rng. */
  gaussianNoise(std = 1, mean = 0) {
    return mean + std * gaussianFromUniforms(this.rng);
  }

  /**
   * Advance the network by one dt step.
   * @param {Record<string, number>} externalCurrents - per-neuron-id I_ext.
   * @returns {Array<{neuron: string, time: number}>} spikes fired this step.
   */
  step(externalCurrents = {}) {
    const dt = this.dt;
    const t0 = this.t;
    const t1 = t0 + dt;
    const EPS = 1e-9;
    const spikesThisStep = [];

    // 1. Deliver scheduled synaptic events landing in this step.
    if (this._pending.length) {
      const stillPending = [];
      for (const ev of this._pending) {
        if (ev.time <= t1 + EPS) {
          const neuron = this.neurons.get(ev.to);
          if (neuron) neuron.V += ev.amount;
        } else {
          stillPending.push(ev);
        }
      }
      this._pending = stillPending;
    }

    // 2. Integrate membrane potentials (or hold at reset during refractory).
    for (const neuron of this.neurons.values()) {
      const sinceSpike = t0 - neuron.lastSpikeTime;
      const inRefractory = sinceSpike < neuron.refractory - EPS;
      if (inRefractory) {
        neuron.V = neuron.V_reset;
      } else {
        const Iext = externalCurrents[neuron.id] || 0;
        const f = (_t, V) => (-(V - neuron.V_rest) + neuron.R * Iext) / neuron.tau_m;
        // Single RK4 sub-step spanning exactly this dt, in LOCAL relative
        // time (0 -> dt) rather than the network's accumulated global time
        // (t0 -> t1). The dynamics are autonomous over one step (I_ext is
        // held constant for the step), so this is mathematically identical
        // — but it matters numerically: rk4ODE recomputes
        // steps = ceil((tEnd-t0)/dt) internally, and once t0 has
        // accumulated thousands of floating-point additions,
        // (t0+dt)-t0 is occasionally a hair above dt, so ceil() silently
        // returns 2 instead of 1 and rk4ODE overshoots by a whole extra
        // step. Local (0, dt) keeps that division exact.
        const trace = rk4ODE(f, neuron.V, 0, dt, dt);
        neuron.V = trace[trace.length - 1].y;
      }

      // 3. Threshold crossing.
      if (!inRefractory && neuron.V >= neuron.V_th) {
        neuron.V = neuron.V_reset;
        neuron.lastSpikeTime = t1;
        spikesThisStep.push({ neuron: neuron.id, time: t1 });
      }
    }

    // 4. Schedule synaptic deliveries triggered by this step's spikes.
    for (const spike of spikesThisStep) {
      this.spikeTrain.push(spike);
      for (const syn of this.synapses) {
        if (!syn.enabled || syn.from !== spike.neuron) continue;
        this._pending.push({ time: spike.time + syn.delay, to: syn.to, amount: syn.weight });
      }
    }

    this.t = t1;
    return spikesThisStep;
  }

  /**
   * Run for `duration` ms. `externalCurrentsFn` is either a static
   * { neuronId: I } map or a function (t, network) => map, called each step
   * (use it + `this.gaussianNoise` for time-varying / stochastic drive).
   */
  run(duration, externalCurrentsFn = {}) {
    const steps = Math.round(duration / this.dt);
    const allSpikes = [];
    for (let i = 0; i < steps; i++) {
      const currents = typeof externalCurrentsFn === 'function'
        ? externalCurrentsFn(this.t, this)
        : externalCurrentsFn;
      const spikes = this.step(currents);
      if (spikes.length) allSpikes.push(...spikes);
    }
    return allSpikes;
  }

  getSpikeTrain(neuronId) {
    return neuronId ? this.spikeTrain.filter((s) => s.neuron === neuronId) : this.spikeTrain.slice();
  }

  getSynapseWeights() {
    return this.synapses.map((s) => ({ id: s.id, from: s.from, to: s.to, weight: s.weight, delay: s.delay, enabled: s.enabled }));
  }

  reset() {
    this.t = 0;
    this.spikeTrain = [];
    this._pending = [];
    for (const n of this.neurons.values()) {
      n.V = n.V_rest;
      n.lastSpikeTime = -Infinity;
    }
  }
}

/** Analytic sub-threshold LIF trajectory: V(t) = V_rest + R*I*(1 - e^(-t/tau_m)), V(0) = V_rest. */
export function analyticSubthresholdV(t, { tau_m, V_rest, R }, I) {
  return V_rest + R * I * (1 - Math.exp(-t / tau_m));
}

/**
 * Analytic steady-state periodic-firing ISI for a LIF neuron.
 *
 *   ISI = tau_m * ln( (R*I - (V_reset - V_rest)) / (R*I - (V_th - V_rest)) ) + refractory
 *
 * Derivation: after a spike the neuron restarts at V_reset, so
 *   V(t) = V_rest + R*I + (V_reset - V_rest - R*I) * e^(-t/tau_m).
 * Setting V(T) = V_th and solving for T gives the log term; the absolute
 * refractory period is then added because the simulator (correctly) holds the
 * neuron clamped for that long before charging resumes.
 *
 * NOTE (fixed during conductor verification): this previously returned
 * `tau_m * ln(drive / (drive - gap))`, which silently DROPPED both `V_reset`
 * and `refractory` — it is only correct when `V_reset === V_rest` AND
 * `refractory === 0`. Because the function destructures a full neuron-params
 * object it looked general, so a caller with a distinct reset potential or any
 * refractory period got a confidently wrong number with no warning. Measured
 * against the simulator, the corrected formula matches on every axis:
 * V_reset -65/-70/-75 -> 13.863/16.095/17.918 ms, and refractory 0/2/5 shifts
 * the ISI by exactly that amount.
 */
export function analyticISI({ tau_m, V_rest, V_reset = V_rest, V_th, R, refractory = 0 }, I) {
  const drive = R * I;
  const gap = V_th - V_rest;
  if (drive <= gap) return Infinity; // steady state below threshold — never fires
  const fromReset = drive - (V_reset - V_rest);
  return tau_m * Math.log(fromReset / (drive - gap)) + refractory;
}
