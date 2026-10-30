// DTU classification + quality service. Additive only: it writes meta.classification (and a `quality:low` label)
// onto DTUs; it never deletes or rewrites content. Backfill runs in small budgeted batches behind an in-flight
// guard and yields to the event loop (the #1839 pattern), so a large store never freezes the site.
import { CLASSIFY_VERSION, classifyDtu } from "./classify.js";
import { scoreQuality, createDuplicateIndex } from "./quality.js";

export function dtuQualityMode(env = process.env) {
  const m = String(env.CONCORD_DTU_QUALITY_MODE || "on").toLowerCase();
  return m === "off" ? "off" : "on";
}

const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

export function createDtuQualityService({ store, deps = {}, now = Date.now, dupMax = 50000 } = {}) {
  const exists = deps.exists || (() => true);
  const yieldNow = deps.yieldNow || (() => new Promise((r) => setImmediate(r)));
  const dupIndex = createDuplicateIndex({ maxEntries: dupMax });
  let running = false;
  let lastCycle = null;
  let classified = 0;
  let building = { byKind: {}, byGate: {}, byDomain: {}, total: 0 };
  let lastPass = null;

  function evaluate(d) {
    const c = classifyDtu(d);
    const q = scoreQuality(d, { kind: c.kind, exists, dupIndex });
    if (q.sketch.length) dupIndex.add(d.id, q.sketch);
    return {
      version: CLASSIFY_VERSION, vo: voOf(d), kind: c.kind, origin: c.origin, domain: c.domain, at: new Date(now()).toISOString(),
      quality: { score: q.score, gate: q.gate, reasons: q.reasons.slice(0, 6), duplicateOf: q.duplicateOf },
    };
  }

  const voOf = (d) => d?.meta?.verification?.outcome ?? null;
  // current = same rule version AND scored against the same verify-gate outcome
  const current = (d) => d?.meta?.classification?.version === CLASSIFY_VERSION && (d.meta.classification.vo ?? null) === voOf(d);
  const tally = (into, rec) => { into.total++; bump(into.byKind, rec.kind); bump(into.byGate, rec.quality?.gate || "unknown"); bump(into.byDomain, rec.domain); };

  /** Synchronous, cheap: call on every DTU write. Mutates meta in place; the caller persists. */
  function annotateInPlace(d) {
    if (!d || typeof d !== "object" || !d.id || current(d)) return null;
    const rec = evaluate(d);
    d.meta = { ...(d.meta || {}), classification: rec };
    if (rec.quality.gate === "low_quality" || rec.quality.gate === "refuted") {
      const tag = "quality:low";
      d.tags = [...new Set([...(Array.isArray(d.tags) ? d.tags : []), tag])];
      d.meta.rankPenalty = Math.round((1 - rec.quality.score) * 100) / 100;
    }
    classified++;
    return rec;
  }

  async function cycle({ maxExamine = 300, maxWrite = 60, budgetMs = 40 } = {}) {
    if (running) return { skipped: "in_flight" };
    running = true;
    const t0 = now();
    try {
      const { examined, needs, done, counted } = store.scan(maxExamine, maxWrite);
      for (const rec of counted || []) tally(building, rec);
      let written = 0;
      for (const d of needs) {
        if (written >= maxWrite || now() - t0 > budgetMs) break;
        const rec = store.classify ? store.classify(d, evaluate) : evaluate(d);
        store.write(d.id, rec);
        tally(building, rec);
        classified++; written++;
        if (written % 20 === 0) await yieldNow();
      }
      if (done) { lastPass = { ...building, completedAt: new Date(now()).toISOString() }; building = { byKind: {}, byGate: {}, byDomain: {}, total: 0 }; }
      lastCycle = { at: new Date(now()).toISOString(), examined, written, ms: now() - t0, passComplete: Boolean(done) };
      return { ...lastCycle };
    } finally { running = false; }
  }

  function metrics() {
    return { mode: dtuQualityMode(), version: CLASSIFY_VERSION, classifiedThisProcess: classified, lastCycle, lastPass, inProgress: building, dupIndexSize: dupIndex.size() };
  }

  return { evaluate, annotateInPlace, cycle, metrics, isCurrent: current };
}
