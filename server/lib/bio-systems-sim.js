// server/lib/bio-systems-sim.js
//
// Deterministic toy simulations for the Bio lens's Organisms view — the
// producing capability the view always lacked (its four system cards
// switched a heading over "No metrics reported for this system yet."
// because no macro existed that could produce a metric).
//
// Each system is a small, STATED model — a few lines of dynamics whose
// rules are printed in the result's `note`, run over N steps with a
// seeded PRNG so the same inputs always produce the same metrics.
// These are teaching models, labelled as simulations wherever they are
// rendered; they are not measurements of any real organism.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const round3 = (v) => Math.round(v * 1000) / 1000;

function homeostasis(steps, rand) {
  const setpoint = 37.0;
  const k = 0.35; // proportional control gain
  let x = setpoint;
  let devSum = 0, effortSum = 0;
  const devs = [];
  let worstDev = 0;
  for (let t = 0; t < steps; t++) {
    const disturbance = Math.sin(t / 7) * 0.9 + (rand() - 0.5) * 0.5;
    const effort = k * (setpoint - x);
    x += effort + disturbance * 0.4;
    const dev = Math.abs(x - setpoint);
    devs.push(dev); devSum += dev; effortSum += Math.abs(effort);
    if (dev > worstDev) worstDev = dev;
  }
  // Recovery: steps after the worst deviation until |dev| stays < 0.1.
  let rec = steps;
  const worstIdx = devs.indexOf(worstDev);
  for (let t = worstIdx + 1; t < steps; t++) {
    if (devs[t] < 0.1) { rec = t - worstIdx; break; }
  }
  const mean = devSum / steps;
  const variance = devs.reduce((s, d) => s + (d - mean) ** 2, 0) / steps;
  return {
    metrics: [
      { name: "Stability", value: round3(clamp01(1 - mean / 2)) },
      { name: "Coherence", value: round3(clamp01(1 - Math.sqrt(variance) / 2)) },
      { name: "Adaptation", value: round3(clamp01(1 - rec / steps)) },
      { name: "Energy", value: round3(clamp01(1 - (effortSum / steps) / 1.5)) },
    ],
    note: "Model: a regulated variable (setpoint 37.0) under proportional control (gain 0.35) with sinusoidal + random disturbance each step. Stability/Coherence fall as mean deviation grows; Adaptation rises the faster the variable returns to within 0.1 of setpoint after its worst deviation; Energy falls as mean control effort grows.",
  };
}

function metabolism(steps, rand) {
  let store = 60; // energy store, capacity 120
  let intakeSum = 0, spentSum = 0, lowSteps = 0;
  for (let t = 0; t < steps; t++) {
    const feeding = (t % 12) < 3; // feeding windows
    const intake = feeding ? 6 + rand() * 3 : 0;
    const activity = 2 + Math.max(0, Math.sin(t / 5)) * 2.5 + rand();
    const basal = 1.6;
    const spent = Math.min(store + intake, basal + activity);
    store = Math.max(0, Math.min(120, store + intake - (basal + activity)));
    intakeSum += intake; spentSum += spent;
    if (store < 15) lowSteps++;
  }
  return {
    metrics: [
      { name: "Reserve", value: round3(clamp01(store / 120)) },
      { name: "Efficiency", value: round3(clamp01(intakeSum > 0 ? spentSum / intakeSum : 0)) },
      { name: "Throughput", value: round3(clamp01((intakeSum / steps) / 3)) },
      { name: "Resilience", value: round3(clamp01(1 - lowSteps / steps)) },
    ],
    note: "Model: an energy store (capacity 120) refilled in feeding windows (3 of every 12 steps) and drained by basal + activity costs each step. Reserve is the closing store; Efficiency is spent/intaken; Resilience falls with steps spent below a store of 15.",
  };
}

function neural(steps, rand) {
  let rate = 0.2; // firing rate, 0..1
  let habit = 0;
  let trackHits = 0, responseSum = 0, stimCount = 0;
  for (let t = 0; t < steps; t++) {
    const stim = (t % 15) < 4 ? 0.85 : 0.15 + rand() * 0.1; // stimulus pulses
    habit = stim > 0.5 ? Math.min(0.5, habit + 0.04) : Math.max(0, habit - 0.02);
    const target = Math.max(0, stim - habit);
    const before = rate;
    rate += 0.45 * (target - rate);
    if (stim > 0.5) { stimCount++; responseSum += Math.abs(rate - before); if (Math.abs(rate - target) < 0.15) trackHits++; }
  }
  return {
    metrics: [
      { name: "Responsiveness", value: round3(clamp01((responseSum / Math.max(1, stimCount)) * 2.2)) },
      { name: "Fidelity", value: round3(clamp01(trackHits / Math.max(1, stimCount))) },
      { name: "Adaptation", value: round3(clamp01(habit * 2)) },
      { name: "Resting tone", value: round3(clamp01(rate)) },
    ],
    note: "Model: a firing rate (0..1) chasing a pulsing stimulus (4 of every 15 steps) with habituation that builds during stimulation and decays at rest. Responsiveness is the mean rate jump on stimulus steps; Fidelity the share of stimulus steps ending within 0.15 of target; Adaptation is end-state habituation.",
  };
}

function geneticMemory(steps, rand) {
  let p = 0.3; // allele frequency
  const s = 0.06; // selection coefficient in its favour
  const N = 200; // population size (drift scale)
  let hetSum = 0, aboveSteps = 0;
  for (let t = 0; t < steps; t++) {
    const pSel = (p * (1 + s)) / (1 + s * p);
    const drift = (rand() * 2 - 1) * Math.sqrt((p * (1 - p)) / (2 * N)) * 3;
    p = Math.max(0.001, Math.min(0.999, pSel + drift));
    hetSum += 2 * p * (1 - p);
    if (p > 0.05) aboveSteps++;
  }
  return {
    metrics: [
      { name: "Retention", value: round3(clamp01(p)) },
      { name: "Diversity", value: round3(clamp01((hetSum / steps) / 0.5)) },
      { name: "Persistence", value: round3(clamp01(aboveSteps / steps)) },
      { name: "Selection gain", value: round3(clamp01((p - 0.3) / 0.7)) },
    ],
    note: "Model: one allele's frequency under constant selection (s = 0.06 in its favour) plus genetic drift at population size 200, starting at p = 0.30. Retention is the closing frequency; Diversity is mean heterozygosity 2p(1−p) against its 0.5 maximum; Persistence is the share of generations the allele stayed above 0.05.",
  };
}

const SYSTEMS = {
  homeostasis: { label: "Homeostasis", run: homeostasis },
  metabolism: { label: "Metabolism", run: metabolism },
  neural: { label: "Neural Network", run: neural },
  genetic: { label: "Genetic Memory", run: geneticMemory },
};

export function simulateBioSystem({ system, steps = 60, seed } = {}) {
  const sys = SYSTEMS[system];
  if (!sys) {
    return { ok: false, error: `unknown system "${system}" — one of ${Object.keys(SYSTEMS).join(", ")}` };
  }
  const n = Math.max(10, Math.min(500, Number(steps) || 60));
  const seedUsed = Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : (system.length * 7919 + n);
  const rand = mulberry32(seedUsed);
  const { metrics, note } = sys.run(n, rand);
  return {
    ok: true,
    result: {
      system, label: sys.label, steps: n, seed: seedUsed,
      simulated: true,
      metrics, note,
    },
  };
}

export { SYSTEMS as BIO_SYSTEMS };
