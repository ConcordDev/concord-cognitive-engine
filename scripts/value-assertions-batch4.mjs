// scripts/value-assertions-batch4.mjs
// Wave 7 (final) — science stats, srs, linguistics, graph, food, legal, calendar, productivity.
// In-process; expected values hand-derived from the standard formula. See batch2 for methodology.

process.env.NODE_ENV = "test";
process.env.CONCORD_NO_LISTEN = "true";
process.env.JWT_SECRET = process.env.JWT_SECRET || "value-assert-fixed-secret-key-32plus-characters-2026";

const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", dim: "\x1b[2m", rst: "\x1b[0m" };
const near = (a, b, tol = 0.01) => typeof a === "number" && Number.isFinite(a) && Math.abs(a - b) <= tol;
const numIn = (s) => { const m = String(s ?? "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };

const mod = await import(new URL("../server/server.js", import.meta.url).href);
const T = mod.__TEST__ || mod.default?.__TEST__;
const { makeInternalCtx } = T;
const LA = globalThis.__concordLensActions;
const ctx = makeInternalCtx("value-assert-batch4");
async function run(dom, act, data = {}, params = {}) {
  const h = LA.get(`${dom}.${act}`);
  if (typeof h !== "function") return { ok: false, error: `no handler ${dom}.${act}` };
  try { return await h(ctx, { domain: dom, data }, params); } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

const BATCHES = {
  science: [
    { dom: "science", act: "stats-descriptive", data: { data: [1, 2, 3, 4, 5] }, params: { data: [1, 2, 3, 4, 5] },
      // mean=3 sum=15; SAMPLE variance (n-1) convention: var=10/4=2.5, sd=√2.5=1.5811
      assert: r => near(r.mean, 3) && near(r.sd, 1.5811, 1e-3) && near(r.variance, 2.5) && near(r.sum, 15),
      show: r => `mean=${r.mean} sd=${r.sd} var=${r.variance} sum=${r.sum}` },
    { dom: "science", act: "stats-correlation", data: { x: [1, 2, 3], y: [2, 4, 6] }, params: { x: [1, 2, 3], y: [2, 4, 6] },
      // perfect line y=2x: r=1, slope=2, intercept=0
      assert: r => near(r.pearsonR, 1, 1e-6) && near(r.slope, 2, 1e-6) && near(r.intercept, 0, 1e-6),
      show: r => `r=${r.pearsonR} slope=${r.slope} int=${r.intercept}` },
  ],
  linguistics: [
    { dom: "linguistics", act: "textAnalysis", data: { text: "Cats run. Dogs jump." }, params: { text: "Cats run. Dogs jump." },
      // 4 words, 2 sentences, all unique → lexicalDiversity=100
      assert: r => near(r.wordCount, 4) && near(r.sentenceCount, 2) && near(r.lexicalDiversity, 100, 0.5),
      show: r => `w=${r.wordCount} s=${r.sentenceCount} ld=${r.lexicalDiversity}` },
  ],
  graph: [
    { dom: "graph", act: "pathFind", data: { edges: [{ source: "A", target: "B" }, { source: "B", target: "C" }], from: "A", to: "C", directed: false }, params: { edges: [{ source: "A", target: "B" }, { source: "B", target: "C" }], from: "A", to: "C", directed: false },
      // BFS A→B→C: hopCount=2
      assert: r => near(r.hopCount, 2) && (r.path || []).length === 3,
      show: r => `hops=${r.hopCount} path=${JSON.stringify(r.path)}` },
    { dom: "graph", act: "graphMetrics", data: { edges: [{ source: "A", target: "B" }, { source: "B", target: "C" }, { source: "C", target: "A" }], nodes: ["A", "B", "C"], directed: false }, params: { edges: [{ source: "A", target: "B" }, { source: "B", target: "C" }, { source: "C", target: "A" }], nodes: ["A", "B", "C"], directed: false },
      // triangle: density=1, avgDegree=2
      assert: r => near(r.metrics?.density, 1, 0.01) && near(r.metrics?.averageDegree, 2, 0.01),
      show: r => `density=${r.metrics?.density} avgDeg=${r.metrics?.averageDegree}` },
  ],
  food: [
    { dom: "food", act: "costPlate", data: { menuItems: [{ name: "dish", menuPrice: 10, targetFoodCostPct: 30, ingredients: [{ quantity: 2, costPerUnit: 1.5 }] }] }, params: { itemName: "dish" },
      // cost=3; foodCostPct=30; suggestedPrice=3/0.3=10
      assert: r => near(r.items?.[0]?.foodCostPct, 30, 0.1) && near(r.items?.[0]?.suggestedPriceAtTarget, 10, 0.1),
      show: r => `fc%=${r.items?.[0]?.foodCostPct} sugg=${r.items?.[0]?.suggestedPriceAtTarget}` },
    { dom: "food", act: "scaleRecipe", data: { baseYield: 4, targetYield: 8, ingredients: [{ quantity: 2 }] }, params: { baseYield: 4, targetYield: 8, ingredients: [{ quantity: 2 }] },
      // factor=2
      assert: r => near(r.scaleFactor, 2),
      show: r => `factor=${r.scaleFactor}` },
  ],
  legal: [
    { dom: "legal", act: "generateInvoice", data: { timeEntries: [{ hours: 10, rate: 200 }], expenses: [{ amount: 500 }], taxRate: 0.1 }, params: { timeEntries: [{ hours: 10, rate: 200 }], expenses: [{ amount: 500 }], taxRate: 0.1 },
      // labor=2000; expense=500; subtotal=2500; tax=250; total=2750
      assert: r => near(r.laborSubtotal, 2000) && near(r.subtotal, 2500) && near(r.total, 2750, 0.01),
      show: r => `labor=${r.laborSubtotal} sub=${r.subtotal} total=${r.total}` },
  ],
  calendar: [
    { dom: "calendar", act: "expandRecurring", data: { startDate: "2026-01-01", frequency: "weekly", count: 3 }, params: { startDate: "2026-01-01", frequency: "weekly", count: 3 },
      // 3 weekly occurrences
      assert: r => (r.occurrences || []).length === 3,
      show: r => `n=${(r.occurrences || []).length}` },
  ],
  productivity: [
  ],
  srs: [
    { dom: "srs", act: "spacedRepetitionSchedule", data: { cards: [{ ease: 2.5, interval: 6, lastQuality: 5, lastReview: "2026-01-01" }] }, params: { cards: [{ ease: 2.5, interval: 6, lastQuality: 5, lastReview: "2026-01-01" }] },
      // SM-2 q5: interval=round(6*2.5)=15; ease=2.5+0.1=2.6
      assert: r => near(r.schedule?.[0]?.interval, 15) && near(r.schedule?.[0]?.ease, 2.6, 0.01),
      show: r => `interval=${r.schedule?.[0]?.interval} ease=${r.schedule?.[0]?.ease}` },
  ],
  telecommunications: [
    { dom: "telecommunications", act: "capacityProjection", params: { bandwidthGbps: 10, currentSubscribers: 1000, monthlyGrowthPercent: 0, months: 12, mbpsPerSubscriber: 1.5, targetUtilizationPercent: 80 },
      // capacity=10000 Mbps; demand=1000*1.5=1500; util=15% (no growth)
      assert: r => near(r.series?.[0]?.utilizationPercent, 15, 0.1),
      show: r => `util0=${r.series?.[0]?.utilizationPercent}%` },
  ],
  supplychain2: [
    { dom: "supplychain", act: "multiEchelonOptimize", params: { echelons: [{ dailyDemand: 10, leadTimeDays: 5, demandStdDev: 2, currentStock: 100 }], serviceLevelZ: 1.65 },
      // safety=ceil(1.65*2*√5)=ceil(7.38)=8; reorder=ceil(10*5+8)=58
      assert: r => near(r.echelons?.[0]?.safetyStock, 8) && near(r.echelons?.[0]?.reorderPoint, 58),
      show: r => `safety=${r.echelons?.[0]?.safetyStock} reorder=${r.echelons?.[0]?.reorderPoint}` },
    { dom: "supplychain", act: "demandForecast", data: { history: [{ demand: 100 }, { demand: 110 }, { demand: 120 }] }, params: { history: [{ demand: 100 }, { demand: 110 }, { demand: 120 }] },
      // avg=110; trend=(120-100)/3=6.667; predicted[1]=110+6.667*3=130
      assert: r => near(r.avgDemand, 110, 0.1) && near(r.forecast?.[0]?.predicted, 130, 1),
      show: r => `avg=${r.avgDemand} f0=${r.forecast?.[0]?.predicted}` },
  ],
};

const only = process.argv[2];
const batchNames = only ? [only] : Object.keys(BATCHES);
let pass = 0, fail = 0, err = 0; const failures = [];
console.log(`\nValue assertions — WAVE 7 (final compute domains)\n`);
for (const bn of batchNames) {
  const cases = BATCHES[bn]; if (!cases) continue;
  console.log(`${C.dim}── ${bn} ──${C.rst}`);
  for (const c of cases) {
    const raw = await run(c.dom, c.act, c.data || {}, c.params || {});
    const result = raw && typeof raw === "object" && "result" in raw ? raw.result : raw;
    if (raw?.ok === false) { err++; failures.push([`${c.dom}.${c.act}`, raw.error]); console.log(`  ${C.y}ERR ${C.rst}${c.dom}.${c.act}  ${C.dim}${raw.error}${C.rst}`); continue; }
    let ok = false, shown = "";
    try { ok = c.assert(result); shown = c.show ? c.show(result || {}) : ""; } catch (e) { ok = false; shown = `threw: ${e?.message}`; }
    if (ok) { pass++; console.log(`  ${C.g}PASS${C.rst} ${c.dom}.${c.act}  ${C.dim}${shown}${C.rst}`); }
    else { fail++; failures.push([`${c.dom}.${c.act}`, shown]); console.log(`  ${C.r}FAIL${C.rst} ${c.dom}.${c.act}  ${C.dim}${shown}${C.rst}`); }
  }
}
console.log(`\n${C.g}${pass} pass${C.rst}  ${fail ? C.r : C.dim}${fail} fail${C.rst}  ${err ? C.y : C.dim}${err} err${C.rst}`);
if (failures.length) { console.log(`\n${C.r}Triage:${C.rst}`); for (const [k, v] of failures) console.log(`  • ${k}  ${C.dim}${v}${C.rst}`); }
setImmediate(() => process.exit((fail > 0 || err > 0) ? 1 : 0)); // defer past V8 async-module fulfillment (exit-133 race)
