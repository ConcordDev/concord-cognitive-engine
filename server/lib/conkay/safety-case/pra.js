// server/lib/conkay/safety-case/pra.js
//
// Phase 2 quantification on top of the Phase 1 cut sets (fault-tree.js):
//   quantifyTree   rare-event (Σ Π p, NUREG-0492 eq. VI-7), min-cut upper bound and the exact
//                  probability from a BDD (bdd.js)
//   importance     Birnbaum, Fussell-Vesely, risk achievement worth (RAW) and risk reduction worth
//                  (RRW) of every basic event, exact (from the BDD by fixing the event to 1 / 0), plus
//                  the cut-set Fussell-Vesely used in NUREG-0492's worked examples
//   betaFactor     beta-factor common-cause groups: each member X becomes X_I OR CCF_group, with
//                  P(X_I) = (1 - β) Q and P(CCF_group) = β Q (Q = the member's total failure probability)
//   basic events   from sourced data claims: demand p, or 1 - exp(-λ t) over an exposure time t
//   monteCarlo     seeded sampling of every data parameter from its beta / gamma distribution; one draw
//                  per data key per trial (state-of-knowledge correlation: identical components share
//                  the draw), the exact BDD probability per trial
//   eventTree      sequences as AND of failed headers and NOT of succeeded ones, quantified exactly on one
//                  shared BDD (so a support event shared by two headers is counted once), times the
//                  initiating-event frequency
// Screening only: every number is a model output for review, never a safety determination.

import { buildBdd, variableOrder, BDD_VERSION } from "./bdd.js";
import { minimalCutSets, quantify } from "./fault-tree.js";
import { COMPONENT_DATA, INITIATOR_DATA, CCF_DATA } from "./reliability-data.js";

export const PRA_VERSION = "1.0.0";

// ── fault-tree quantification and importance ─────────────────────────────────

export function quantifyTree(ft, top, p, { maxOrder = Infinity } = {}) {
  const cutSets = minimalCutSets(ft, top, { maxOrder });
  const q = quantify(cutSets, p);
  const { bdd, roots } = buildBdd(ft.gates || {}, [top]);
  const exact = bdd.probability(roots[top], p);
  return { cutSets, terms: q.terms, rareEvent: q.rareEvent, minCutUpperBound: q.minCutUpperBound, exact, bddNodes: bdd.size(roots[top]), truncatedAtOrder: Number.isFinite(maxOrder) ? maxOrder : null };
}

/** Exact importance measures of every basic event of `top` (or of a given BDD root). */
export function importance(ft, top, p, { built } = {}) {
  const { bdd, roots } = built || buildBdd(ft.gates || {}, [top]);
  const u = roots[top];
  const P = bdd.probability(u, p);
  const cutSets = minimalCutSets(ft, top);
  const csTerms = quantify(cutSets, p).terms;
  const rare = csTerms.reduce((s, t) => s + t.probability, 0);
  const rows = bdd.support(u).map((e) => {
    const P1 = bdd.probability(bdd.restrict(u, e, 1), p);
    const P0 = bdd.probability(bdd.restrict(u, e, 0), p);
    const fvCutSets = rare ? csTerms.filter((t) => t.cutSet.includes(e)).reduce((s, t) => s + t.probability, 0) / rare : 0;
    return {
      event: e, p: p[e],
      birnbaum: P1 - P0,
      fussellVesely: P ? (P - P0) / P : 0,
      fussellVeselyCutSets: fvCutSets,
      raw: P ? P1 / P : null,
      rrw: P0 > 0 ? P / P0 : Infinity,
    };
  });
  rows.sort((a, b) => b.fussellVesely - a.fussellVesely || a.event.localeCompare(b.event));
  return { top: P, measures: rows, definitions: IMPORTANCE_DEFINITIONS };
}

export const IMPORTANCE_DEFINITIONS = Object.freeze({
  birnbaum: "P(top | x = 1) - P(top | x = 0)",
  fussellVesely: "(P(top) - P(top | x = 0)) / P(top): the fraction of the top-event probability that involves x (exact, from the BDD)",
  fussellVeselyCutSets: "sum of the probabilities of the minimal cut sets containing x / sum over all minimal cut sets (rare-event form, as in NUREG-0492's examples)",
  raw: "risk achievement worth: P(top | x = 1) / P(top)",
  rrw: "risk reduction worth: P(top) / P(top | x = 0) (Infinity when x appears in every way the top event can occur)",
});

// ── common cause: beta factor ────────────────────────────────────────────────

/**
 * groups: [{ id, members: [event ids], ccf: CCF data key (beta) }]. Returns a new fault tree in which every
 * member X is replaced by gate X = OR(X__IND, <group id>), plus the probability transform to apply.
 */
export function betaFactor(ft, groups) {
  const gates = { ...(ft.gates || {}) };
  const transform = [];
  for (const g of groups) {
    if (!CCF_DATA[g.ccf]) throw new Error(`CCF group ${g.id}: no beta-factor data "${g.ccf}"`);
    if (g.members.length !== CCF_DATA[g.ccf].groupSize) throw new Error(`CCF group ${g.id}: ${g.members.length} members, but the beta factor ${g.ccf} is for a group of ${CCF_DATA[g.ccf].groupSize}`);
    for (const m of g.members) {
      if (gates[m]) throw new Error(`CCF group ${g.id}: member ${m} is a gate, not a basic event`);
      gates[m] = { type: "or", inputs: [`${m}__IND`, g.id] };
    }
    transform.push({ group: g.id, members: [...g.members], ccf: g.ccf });
  }
  return { ft: { gates }, transform };
}

// ── basic events from data ───────────────────────────────────────────────────

/**
 * A basic-event spec: { id, data: COMPONENT_DATA key, hours? (exposure for a rate), ccf?: { group, role } }.
 * params: data key -> parameter value (p for demand data, λ per hour for rate data).
 */
export function eventProbability(spec, params) {
  const d = COMPONENT_DATA[spec.data];
  if (!d) throw new Error(`basic event ${spec.id}: no component data "${spec.data}"`);
  const x = params[spec.data];
  if (!Number.isFinite(x)) throw new Error(`basic event ${spec.id}: no value for ${spec.data}`);
  if (d.kind === "demand") return x;
  if (!(spec.hours > 0)) throw new Error(`basic event ${spec.id}: a rate needs an exposure time (hours)`);
  return 1 - Math.exp(-x * spec.hours);
}

/** Probabilities of every basic event of a model (specs + beta-factor groups) for parameter values. */
export function modelProbabilities(model, params) {
  const p = {};
  for (const s of model.events) p[s.id] = eventProbability(s, params);
  for (const g of model.ccf || []) {
    const qs = g.members.map((m) => p[m]);
    if (qs.some((q) => Math.abs(q - qs[0]) > 1e-15 * Math.max(1, qs[0]))) throw new Error(`CCF group ${g.id}: members must have the same total failure probability (got ${qs.join(", ")})`);
    const beta = params[g.ccf];
    if (!(beta >= 0 && beta <= 1)) throw new Error(`CCF group ${g.id}: no beta for ${g.ccf}`);
    for (const m of g.members) { p[`${m}__IND`] = (1 - beta) * p[m]; delete p[m]; }
    p[g.id] = beta * qs[0];
  }
  return p;
}

/** Point-estimate parameters: the printed means of every data key the model uses. */
export function meanParams(model) {
  const out = {};
  for (const s of model.events) out[s.data] = COMPONENT_DATA[s.data].mean;
  for (const g of model.ccf || []) out[g.ccf] = CCF_DATA[g.ccf].mean;
  for (const k of model.initiators || []) out[k] = INITIATOR_DATA[k].mean;
  return out;
}

// ── seeded sampling ──────────────────────────────────────────────────────────

/** sfc32 seeded from a string (deterministic across platforms). */
export function rng(seed) {
  let h = 1779033703 ^ String(seed).length;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  const next = () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
  let a = next(), b = next(), c = next(), d = next();
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
    return ((t >>> 0) + 0.5) / 4294967296; // (0, 1)
  };
}

function normal(u) {
  // Box-Muller with two uniforms in (0, 1)
  const a = u(), b = u();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}

/** Gamma(shape α, rate 1) by Marsaglia-Tsang (2000); α < 1 by the boost Gamma(α + 1) U^(1/α). */
export function sampleGamma(u, alpha) {
  if (!(alpha > 0)) throw new Error("gamma shape must be > 0");
  if (alpha < 1) return sampleGamma(u, alpha + 1) * Math.pow(u(), 1 / alpha);
  const d = alpha - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = normal(u); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const w = u();
    if (w < 1 - 0.0331 * x ** 4 || Math.log(w) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleDist(u, dist) {
  if (dist.type === "gamma") return sampleGamma(u, dist.alpha) / dist.beta;
  if (dist.type === "beta") { const x = sampleGamma(u, dist.alpha), y = sampleGamma(u, dist.beta); return x / (x + y); }
  throw new Error(`unknown distribution ${dist.type}`);
}

const DIST_OF = (k) => (COMPONENT_DATA[k] || CCF_DATA[k] || INITIATOR_DATA[k])?.dist;

function percentile(sorted, q) {
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * Seeded Monte Carlo over the data parameters. keys: the data keys to sample (one draw per key per trial);
 * evaluate(params) -> { name: number } for each trial. Returns per-output mean / 5th / 50th / 95th.
 */
export function monteCarlo(keys, evaluate, { n = 5000, seed = "conkay-pra" } = {}) {
  const u = rng(seed);
  const outs = {};
  for (let i = 0; i < n; i++) {
    const params = {};
    for (const k of keys) {
      const d = DIST_OF(k);
      if (!d) throw new Error(`no distribution for ${k}`);
      params[k] = sampleDist(u, d);
    }
    for (const [name, v] of Object.entries(evaluate(params))) (outs[name] ||= []).push(v);
  }
  return Object.fromEntries(Object.entries(outs).map(([name, xs]) => {
    const s = [...xs].sort((a, b) => a - b);
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (s.length - 1));
    return [name, { mean, p05: percentile(s, 0.05), p50: percentile(s, 0.5), p95: percentile(s, 0.95), standardErrorOfMean: sd / Math.sqrt(s.length), n: s.length, seed: String(seed) }];
  }));
}

// ── event trees ──────────────────────────────────────────────────────────────

/**
 * et: { id, initiator: INITIATOR_DATA key, headers: [{ id, gate }], sequences: [{ id, path: { header: "S" | "F" }, endState }] }
 * (a header missing from a path is not asked on that sequence). gates: the fault-tree gates the headers point to.
 * Builds one BDD for all sequences, checks that the sequences partition the outcome space (their conditional
 * probabilities sum to 1), and quantifies each exactly.
 */
export function eventTree(et, gates, p, ieFrequency) {
  const seqGates = {};
  for (const s of et.sequences) {
    const inputs = [];
    for (const h of et.headers) {
      const b = s.path[h.id];
      if (b == null) continue;
      if (b === "F") inputs.push(h.gate);
      else if (b === "S") { seqGates[`${s.id}__NOT_${h.id}`] = { type: "not", inputs: [h.gate] }; inputs.push(`${s.id}__NOT_${h.id}`); }
      else throw new Error(`sequence ${s.id}: branch for ${h.id} must be "S" or "F"`);
    }
    seqGates[`SEQ_${s.id}`] = inputs.length ? { type: "and", inputs } : null;
  }
  const all = { ...gates, ...Object.fromEntries(Object.entries(seqGates).filter(([, g]) => g)) };
  const roots = et.sequences.map((s) => `SEQ_${s.id}`).filter((r) => all[r]);
  const order = variableOrder(all, et.headers.map((h) => h.gate));
  const headerTops = [...new Set(et.headers.map((h) => h.gate))];
  const built = buildBdd(all, [...roots, ...headerTops], { order });
  const { bdd } = built;
  const seqs = et.sequences.map((s) => {
    const root = built.roots[`SEQ_${s.id}`];
    const cond = root == null ? 1 : bdd.probability(root, p);
    // rare-event style point estimate: product of the failed headers' probabilities, success branches ignored
    const failed = et.headers.filter((h) => s.path[h.id] === "F");
    const indep = failed.reduce((x, h) => x * bdd.probability(built.roots[h.gate], p), 1);
    return { id: s.id, path: s.path, endState: s.endState, conditionalProbability: cond, frequency: ieFrequency * cond, ignoringDependenceAndSuccess: ieFrequency * indep };
  });
  const partition = seqs.reduce((a, s) => a + s.conditionalProbability, 0);
  const endStates = {};
  for (const s of seqs) endStates[s.endState] = (endStates[s.endState] || 0) + s.frequency;
  return { id: et.id, initiator: et.initiator, initiatorFrequency: ieFrequency, sequences: seqs, endStates, partitionSum: partition, bddNodes: bdd.nodes.length - 2, method: `exact BDD (v${BDD_VERSION}) over all sequences; sequence = AND of failed header tops and NOT of succeeded ones` };
}
