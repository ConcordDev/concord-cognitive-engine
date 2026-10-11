// tests/conkay-pra.test.js
//
// ConKay nuclear Phase 2: fault-tree / event-tree quantification (BDD), importance
// measures, beta-factor common cause, seeded uncertainty, NUREG/CR-6928 2020 data
// claims, NUREG-0492 benchmarks, and the toy LOOP / LOCHS demo. Screening only.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Bdd, buildBdd, variableOrder } from "../lib/conkay/safety-case/bdd.js";
import { BENCHMARKS, minimalCutSets } from "../lib/conkay/safety-case/fault-tree.js";
import { quantifyTree, importance, betaFactor, eventProbability, modelProbabilities, rng, sampleGamma, sampleDist, monteCarlo, eventTree } from "../lib/conkay/safety-case/pra.js";
import { COMPONENT_DATA, INITIATOR_DATA, CCF_DATA, DATA_SOURCES, distMean, dataClaim } from "../lib/conkay/safety-case/reliability-data.js";
import { runPraDemo, renderPraMarkdown, loopGates, LOOP_ET, DEMO_EVENTS, DEMO_CCF } from "../lib/conkay/safety-case/pra-demo.js";
import { forbiddenVerdicts, STATUSES } from "../lib/conkay/safety-case/vocabulary.js";

const close = (a, b, rel = 1e-12) => Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1e-300);

/** Every assignment of the variables (small n), with the probability of each. */
function enumerate(vars, p, f) {
  let total = 0;
  for (let m = 0; m < 1 << vars.length; m++) {
    const a = {};
    let w = 1;
    vars.forEach((v, i) => { const on = (m >> i) & 1; a[v] = !!on; w *= on ? p[v] : 1 - p[v]; });
    if (f(a)) total += w;
  }
  return total;
}
const dnf = (cutSets) => (a) => cutSets.some((cs) => cs.every((e) => a[e]));

/** A random coherent fault tree over n events (seeded). */
function randomTree(seed, n = 9, gatesN = 7) {
  const u = rng(seed);
  const ev = Array.from({ length: n }, (_, i) => `X${i}`);
  const gates = {};
  const nodes = [...ev];
  for (let g = 0; g < gatesN; g++) {
    const k = 2 + Math.floor(u() * 3);
    const inputs = [...new Set(Array.from({ length: k }, () => nodes[Math.floor(u() * nodes.length)]))];
    if (inputs.length < 2) inputs.push(ev[g % n]);
    const r = u();
    gates[`G${g}`] = r < 0.45 ? { type: "or", inputs } : r < 0.9 ? { type: "and", inputs } : { type: "atleast", k: 2, inputs: inputs.length >= 2 ? inputs : [...inputs, ev[0]] };
    nodes.push(`G${g}`);
  }
  const p = Object.fromEntries(ev.map((e) => [e, 0.05 + 0.4 * u()]));
  return { ft: { gates }, top: `G${gatesN - 1}`, p, ev };
}

describe("NUREG/CR-6928 2020 and CCF 2020 data claims", () => {
  it("every row is sourced with a document, table / section and PDF page; the documents are pinned by SHA-256", () => {
    for (const s of Object.values(DATA_SOURCES)) {
      assert.match(s.sha256, /^[0-9a-f]{64}$/);
      assert.match(s.url, /^https:\/\/nrcoe\.inl\.gov\//);
    }
    for (const [k, r] of Object.entries({ ...COMPONENT_DATA, ...INITIATOR_DATA, ...CCF_DATA })) {
      assert.ok(DATA_SOURCES[r.source], k);
      assert.match(r.locator, /(Table [14]|Section [\d.]+).*PDF page \d+/, k);
      assert.equal(dataClaim(k).status, "sourced");
    }
  });

  it("the printed α and β reproduce the printed mean (components and CCF within 0.5 %; initiators within their rounding, noted)", () => {
    for (const [k, r] of Object.entries({ ...COMPONENT_DATA, ...CCF_DATA })) {
      assert.ok(Math.abs(distMean(r.dist) / r.mean - 1) < 0.005, `${k}: ${distMean(r.dist)} vs ${r.mean}`);
      assert.ok(r.p5 < r.median && r.median < r.p95 && r.p5 < r.mean && r.mean < r.p95, k);
    }
    for (const [k, r] of Object.entries(INITIATOR_DATA)) {
      const rel = Math.abs(distMean(r.dist) / r.mean - 1);
      assert.ok(rel < 0.03, `${k}: ${rel}`);
      if (rel > 0.005) assert.match(r.note, /rounded/, `${k}: the rounding is stated`);
    }
    // spot values against the report (Table 1 p. 9, Table 4 p. 22, CCF 2020 section 2.11.1.1)
    assert.deepEqual([COMPONENT_DATA["EDG-FTS"].mean, COMPONENT_DATA["EDG-FTS"].dist.alpha, COMPONENT_DATA["EDG-FTS"].dist.beta], [2.22e-3, 23.8, 1.07e4]);
    assert.deepEqual([INITIATOR_DATA["PO.LOOP"].mean, INITIATOR_DATA["PO.LOOP"].events], [2.52e-2, 35]);
    assert.deepEqual([CCF_DATA["EPS-EDG-FS"].mean, CCF_DATA["EPS-EDG-FS"].dist.alpha, CCF_DATA["EPS-EDG-FS"].dist.beta], [8.28e-3, 1.469, 175.8]);
  });

  it("basic events: a demand probability as printed; a rate over its exposure as 1 - exp(-λ t)", () => {
    assert.equal(eventProbability({ id: "x", data: "EDG-FTS" }, { "EDG-FTS": 2.22e-3 }), 2.22e-3);
    assert.ok(close(eventProbability({ id: "x", data: "EDG-FTR", hours: 23 }, { "EDG-FTR": 1.18e-3 }), 1 - Math.exp(-1.18e-3 * 23)));
    assert.throws(() => eventProbability({ id: "x", data: "EDG-FTR" }, { "EDG-FTR": 1e-3 }), /exposure/);
    assert.throws(() => eventProbability({ id: "x", data: "NOPE" }, {}), /no component data/);
  });
});

describe("BDD: exact Boolean function and probability", () => {
  it("matches the minimal cut sets on every assignment (NUREG-0492 trees and seeded random coherent trees)", () => {
    const cases = [
      ...Object.values(BENCHMARKS).map((b) => ({ ft: b.ft, top: b.top })),
      ...Array.from({ length: 12 }, (_, i) => randomTree(`tree-${i}`)),
    ];
    for (const c of cases) {
      const { bdd, roots } = buildBdd(c.ft.gates, [c.top]);
      const cs = minimalCutSets(c.ft, c.top);
      const vars = variableOrder(c.ft.gates, [c.top]);
      for (let m = 0; m < 1 << vars.length; m++) {
        const a = Object.fromEntries(vars.map((v, i) => [v, !!((m >> i) & 1)]));
        assert.equal(bdd.evaluate(roots[c.top], a), dnf(cs)(a), `${c.top} at ${m}`);
      }
    }
  });

  it("the exact probability equals full enumeration; rare-event >= min-cut upper bound >= exact for coherent trees", () => {
    for (let i = 0; i < 12; i++) {
      const c = randomTree(`prob-${i}`);
      const q = quantifyTree(c.ft, c.top, c.p);
      const vars = variableOrder(c.ft.gates, [c.top]);
      const enumP = enumerate(vars, c.p, dnf(q.cutSets));
      assert.ok(close(q.exact, enumP, 1e-10), `${q.exact} vs ${enumP}`);
      assert.ok(q.rareEvent >= q.minCutUpperBound - 1e-15 && q.minCutUpperBound >= q.exact - 1e-15, JSON.stringify([q.rareEvent, q.minCutUpperBound, q.exact]));
    }
    // 2 of 3, analytic: 3p^2 - 2p^3
    const v = quantifyTree({ gates: { T: { type: "atleast", k: 2, inputs: ["A", "B", "C"] } } }, "T", { A: 0.1, B: 0.1, C: 0.1 });
    assert.ok(close(v.exact, 3 * 0.01 - 2 * 0.001));
    assert.ok(close(v.rareEvent, 0.03));
  });

  it("NOT gates (event-tree success branches), restriction and support", () => {
    const { bdd, roots } = buildBdd({ T: { type: "and", inputs: ["A", "NB"] }, NB: { type: "not", inputs: ["B"] } }, ["T"]);
    assert.ok(close(bdd.probability(roots.T, { A: 0.3, B: 0.2 }), 0.3 * 0.8));
    assert.deepEqual(bdd.support(roots.T), ["A", "B"]);
    assert.equal(bdd.restrict(roots.T, "A", 0), 0);
    assert.throws(() => new Bdd(["A"]).probability(2, { A: 2 }), /\[0, 1\]/);
  });
});

describe("NUREG-0492 pressure tank (Chapter VIII): quantification and importance", () => {
  const b = BENCHMARKS["nureg-0492-pressure-tank"];
  const q = quantifyTree(b.ft, b.top, b.probabilities);
  const im = importance(b.ft, b.top, b.probabilities);
  const m = Object.fromEntries(im.measures.map((x) => [x.event, x]));

  it("cut sets as published; exact, min-cut upper bound and rare-event agree to 3 significant figures here", () => {
    assert.deepEqual(q.cutSets, [["K2"], ["T"], ["K1", "S"], ["R", "S"], ["S", "S1"]]);
    assert.ok(Math.abs(q.exact - 3.5016e-5) < 1e-9);
    assert.ok(q.exact <= q.minCutUpperBound && q.minCutUpperBound <= q.rareEvent);
  });

  it("Fussell-Vesely reproduces the handbook's importances: T 14 %, K2 86 % (cut-set and exact forms)", () => {
    assert.deepEqual([Math.round(m.T.fussellVeselyCutSets * 100), Math.round(m.K2.fussellVeselyCutSets * 100)], [Math.round(b.published.importance.T * 100), Math.round(b.published.importance.K2 * 100)]);
    assert.deepEqual([Math.round(m.T.fussellVesely * 100), Math.round(m.K2.fussellVesely * 100)], [14, 86]);
  });

  it("importance identities: single events are Birnbaum ~1; RAW = P(top|x=1)/P; RRW = P/P(top|x=0)", () => {
    assert.ok(Math.abs(m.K2.birnbaum - (1 - b.probabilities.T) * 1) < 1e-4);
    assert.ok(close(m.K2.raw, 1 / q.exact, 1e-3));
    assert.ok(close(m.K2.rrw, q.exact / (q.exact - m.K2.birnbaum * b.probabilities.K2), 1e-9));
    const and = importance({ gates: { T: { type: "and", inputs: ["A", "B"] } } }, "T", { A: 0.1, B: 0.2 });
    for (const x of and.measures) {
      assert.equal(x.rrw, Infinity, "an event in every cut set: removing it removes the top");
      assert.ok(close(x.fussellVesely, 1));
    }
    assert.ok(close(and.measures.find((x) => x.event === "A").raw, 10));
  });
});

describe("beta-factor common cause", () => {
  it("replaces members by X__IND OR CCF and splits Q into (1 - β) Q and β Q", () => {
    const { ft } = betaFactor({ gates: { T: { type: "and", inputs: ["A", "B"] } } }, [{ id: "CCF_AB", members: ["A", "B"], ccf: "EPS-EDG-FS" }]);
    assert.deepEqual(ft.gates.A, { type: "or", inputs: ["A__IND", "CCF_AB"] });
    const model = { events: [{ id: "A", data: "EDG-FTS" }, { id: "B", data: "EDG-FTS" }], ccf: [{ id: "CCF_AB", members: ["A", "B"], ccf: "EPS-EDG-FS" }] };
    const Q = 2.22e-3, beta = 8.28e-3;
    const p = modelProbabilities(model, { "EDG-FTS": Q, "EPS-EDG-FS": beta });
    assert.ok(close(p.A__IND, (1 - beta) * Q) && close(p.CCF_AB, beta * Q));
    const exact = quantifyTree(ft, "T", p).exact;
    const ind = (1 - beta) * Q;
    assert.ok(close(exact, beta * Q + ind * ind - beta * Q * ind * ind), "P(both) = βQ + ((1-β)Q)^2 - βQ((1-β)Q)^2");
    assert.ok(exact > Q * Q * 3, "common cause dominates two-train failure here");
    assert.throws(() => betaFactor({ gates: {} }, [{ id: "X", members: ["A", "B", "C"], ccf: "EPS-EDG-FS" }]), /group of 2/);
    assert.throws(() => modelProbabilities({ events: [{ id: "A", data: "EDG-FTS" }, { id: "B", data: "MDP-FTS-NS" }], ccf: [{ id: "C", members: ["A", "B"], ccf: "EPS-EDG-FS" }] }, { "EDG-FTS": 1e-3, "MDP-FTS-NS": 2e-3, "EPS-EDG-FS": 0.01 }), /same total failure probability/);
  });
});

describe("seeded sampling", () => {
  it("gamma and beta samplers reproduce the analytic mean and variance (including shapes < 1)", () => {
    for (const d of [{ type: "gamma", alpha: 0.444, beta: 173 }, { type: "gamma", alpha: 18.5, beta: 1.07e4 }, { type: "beta", alpha: 0.831, beta: 218 }, { type: "beta", alpha: 23.8, beta: 1.07e4 }]) {
      const u = rng(`s-${d.type}-${d.alpha}`);
      const n = 40000;
      const xs = Array.from({ length: n }, () => sampleDist(u, d));
      const mean = xs.reduce((a, b) => a + b, 0) / n;
      const vr = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
      const m0 = distMean(d);
      const v0 = d.type === "gamma" ? d.alpha / d.beta ** 2 : (d.alpha * d.beta) / ((d.alpha + d.beta) ** 2 * (d.alpha + d.beta + 1));
      assert.ok(Math.abs(mean - m0) < 4 * Math.sqrt(v0 / n), `${JSON.stringify(d)} mean ${mean} vs ${m0}`);
      assert.ok(Math.abs(vr / v0 - 1) < 0.12, `${JSON.stringify(d)} variance ${vr} vs ${v0}`);
    }
    assert.throws(() => sampleGamma(rng("x"), 0), /shape/);
  });

  it("is deterministic per seed, different across seeds, and uses one draw per data key per trial", () => {
    const f = (params) => ({ a: params["EDG-FTS"], b: params["EDG-FTS"] });
    const r1 = monteCarlo(["EDG-FTS"], f, { n: 500, seed: "one" });
    const r2 = monteCarlo(["EDG-FTS"], f, { n: 500, seed: "one" });
    const r3 = monteCarlo(["EDG-FTS"], f, { n: 500, seed: "two" });
    assert.deepEqual(r1, r2);
    assert.notEqual(r1.a.mean, r3.a.mean);
    assert.equal(r1.a.mean, r1.b.mean, "same key, same draw (state-of-knowledge correlation)");
  });
});

describe("event trees: exact sequences on a shared BDD", () => {
  const demo = runPraDemo({ samples: 800 });
  const loop = demo.eventTrees.loop;
  const seq = Object.fromEntries(loop.sequences.map((s) => [s.id, s]));

  it("sequences partition the outcomes and end states sum their sequences", () => {
    for (const et of [demo.eventTrees.loop, demo.eventTrees.lochs]) {
      assert.ok(Math.abs(et.partitionSum - 1) < 1e-12, `${et.id}: ${et.partitionSum}`);
      const ldhr = et.sequences.filter((s) => s.endState === "LDHR").reduce((a, s) => a + s.frequency, 0);
      assert.ok(close(et.endStates.LDHR, ldhr));
    }
  });

  it("an independent Boolean Monte Carlo over basic-event states agrees with the exact sequence probabilities", () => {
    const gates = loopGates();
    const mean = Object.fromEntries([...DEMO_EVENTS.map((e) => [e.data, COMPONENT_DATA[e.data].mean]), ...DEMO_CCF.map((c) => [c.ccf, CCF_DATA[c.ccf].mean])]);
    const p = modelProbabilities({ events: DEMO_EVENTS, ccf: DEMO_CCF }, mean);
    const { bdd, roots } = buildBdd(gates, ["EPS", "AFW"]);
    const vars = bdd.order;
    const u = rng("boolean-mc");
    const n = 400000;
    let l3 = 0, l4 = 0;
    for (let i = 0; i < n; i++) {
      const a = {};
      for (const v of vars) a[v] = u() < p[v];
      const eps = bdd.evaluate(roots.EPS, a), afw = bdd.evaluate(roots.AFW, a);
      if (eps && !afw) l3++;
      if (eps && afw) l4++;
    }
    for (const [hits, s] of [[l3, seq.L3], [l4, seq.L4]]) {
      const pe = s.conditionalProbability, se = Math.sqrt(pe * (1 - pe) / n);
      assert.ok(Math.abs(hits / n - pe) < 4.5 * se, `${s.id}: MC ${hits / n} vs exact ${pe} (4.5 se = ${4.5 * se})`);
    }
  });

  it("shared supports matter: multiplying header probabilities misstates the dependent sequences by orders of magnitude", () => {
    assert.ok(seq.L4.frequency / seq.L4.ignoringDependenceAndSuccess > 100, "EPS failed makes the AC-powered AFW trains fail too");
    assert.ok(seq.L2.ignoringDependenceAndSuccess / seq.L2.frequency > 10, "EPS success removes the AC-induced AFW failures");
  });

  it("an event tree refuses an unknown branch value", () => {
    assert.throws(() => eventTree({ id: "x", initiator: "PO.LOOP", headers: [{ id: "H", gate: "A" }], sequences: [{ id: "s", path: { H: "maybe" }, endState: "OK" }] }, {}, { A: 0.1 }, 1), /"S" or "F"/);
  });
});

describe("Phase 2 demo report", () => {
  const a = runPraDemo({ samples: 600, seed: "fixed" });
  const b = runPraDemo({ samples: 600, seed: "fixed" });

  it("screening status, banner, no forbidden verdict words, deterministic", () => {
    assert.ok(STATUSES.includes(a.status));
    assert.match(a.banner, /Not a safety determination/);
    assert.deepEqual(forbiddenVerdicts(a), []);
    assert.deepEqual(forbiddenVerdicts({ md: renderPraMarkdown(a) }), []);
    assert.deepEqual(a, b);
  });

  it("every data key the model uses is a sourced claim; gaps and assumptions are listed, incl. the three-motor benchmark", () => {
    const used = new Set([...DEMO_EVENTS.map((e) => e.data), ...DEMO_CCF.map((c) => c.ccf), LOOP_ET.initiator, "LOCHS PWR FI"]);
    assert.deepEqual(new Set(a.data.map((d) => d.key)), used);
    for (const d of a.data) assert.ok(d.source && d.locator, d.key);
    assert.ok(a.gaps.some((g) => /three-motor/.test(g)));
    assert.ok(a.gaps.some((g) => /maintenance/.test(g)));
    assert.match(a.plant, /toy/);
    assert.match(a.endStateDefinitions.LDHR, /not a core-damage frequency/);
  });

  it("uncertainty: mean of the outputs above the point estimate's order of magnitude bounds; 5th < median < 95th", () => {
    for (const u of Object.values(a.uncertainty)) assert.ok(u.p05 < u.p50 && u.p50 < u.p95 && u.p05 < u.mean && u.mean < u.p95);
    const point = a.eventTrees.loop.endStates.LDHR;
    assert.ok(a.uncertainty["LOOP:LDHR"].p05 < point && point < a.uncertainty["LOOP:LDHR"].p95);
  });
});

describe("lens actions", () => {
  it("conkay_safety.pra-demo and conkay_safety.quantify", async () => {
    const actions = {};
    const { default: register } = await import("../domains/conkay-safety.js");
    register((domain, name, fn) => { actions[`${domain}.${name}`] = fn; });
    const d = actions["conkay_safety.pra-demo"]({}, null, { samples: 300 });
    assert.equal(d.ok, true);
    assert.match(d.result.markdown, /# ConKay PRA screening demo/);
    const b = BENCHMARKS["nureg-0492-pressure-tank"];
    const q = actions["conkay_safety.quantify"]({}, null, { ft: b.ft, top: b.top, p: b.probabilities });
    assert.equal(q.ok, true);
    assert.ok(Math.abs(q.result.exact - 3.5016e-5) < 1e-9);
    assert.equal(q.result.importance.measures[0].event, "K2");
    assert.equal(actions["conkay_safety.quantify"]({}, null, { ft: b.ft, top: b.top, p: {} }).ok, false);
  });
});
