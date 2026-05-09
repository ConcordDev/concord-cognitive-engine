// server/lib/detectors/predictive-growth-detector.js
//
// Phase 6 / T1 — predictive kind detector.
//
// Reads runtime DB row counts (sample of top tables) plus heap stats
// from process.memoryUsage(). Compares against rolling history persisted
// to audit/detectors/runtime-history.jsonl.
//
// Emits findings:
//   - Table projected to exceed N rows in 21 days at current slope
//   - Heap committed projected to exceed MAX_OLD_SPACE_SIZE × 0.85 in 7 days
//   - DTU corpus growth >10× the consolidation rate
//
// Linear regression on slope; tolerates short history (<5 samples = info-only).

import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { makeReport, makeError } from "./_framework.js";

const HISTORY_FILE = "audit/detectors/runtime-history.jsonl";
const HISTORY_WINDOW = 30;
const TABLE_GROWTH_PROJECTION_DAYS = 21;
const TABLE_GROWTH_LIMIT = 10_000_000;
const HEAP_PROJECTION_DAYS = 7;
const HEAP_THRESHOLD_RATIO = 0.85;

const SAMPLE_TABLES = [
  "dtus", "events", "users", "world_buildings", "world_npcs",
  "city_presence", "embodied_signal_log", "pain_signals", "dreams",
  "forward_predictions", "faction_strategy_state", "npc_conversations",
  "economy_ledger", "royalty_lineage", "dtu_citations",
];

async function readRuntimeHistory(root) {
  try {
    const raw = await readFile(path.join(root, HISTORY_FILE), "utf-8");
    return raw.split("\n").filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean).slice(-HISTORY_WINDOW);
  } catch { return []; }
}

async function appendRuntimeHistory(root, row) {
  try {
    const p = path.join(root, HISTORY_FILE);
    await mkdir(path.dirname(p), { recursive: true });
    const { appendFile } = await import("node:fs/promises");
    await appendFile(p, JSON.stringify(row) + "\n", "utf-8");
  } catch { /* best-effort */ }
}

function linearSlope(samples) {
  if (!samples || samples.length < 2) return 0;
  const n = samples.length;
  const xMean = (n - 1) / 2;
  const yMean = samples.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (samples[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export async function runPredictiveGrowthDetector({ root, db, state, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("predictive-growth", "no_root", null, t0);

  try {
    const findings = [];
    const tableRows = {};
    const samplesPerInterval = (opts.samplesPerInterval || 4); // ~ samples per day if heartbeat fires every 6h

    // 1. Sample current table sizes (best-effort).
    if (db) {
      for (const t of SAMPLE_TABLES) {
        try {
          const r = db.prepare(`SELECT COUNT(*) AS n FROM ${t.replace(/[^a-zA-Z0-9_]/g, "")}`).get();
          if (r) tableRows[t] = r.n;
        } catch { /* table doesn't exist on this build */ }
      }
    }

    // 2. Sample heap.
    let heapMb = null, heapLimitMb = null;
    try {
      const mu = process.memoryUsage?.();
      if (mu) heapMb = Math.round(mu.heapUsed / 1024 / 1024);
      const maxOldMb = parseInt(process.env.MAX_OLD_SPACE_SIZE || "0", 10);
      heapLimitMb = maxOldMb || null;
    } catch { /* node-restricted env */ }

    // 3. Append to runtime-history.jsonl.
    const row = { generatedAt: new Date().toISOString(), tableRows, heapMb, heapLimitMb };
    await appendRuntimeHistory(root, row);

    // 4. Read recent history + project.
    const history = await readRuntimeHistory(root);
    if (history.length < 5) {
      findings.push({
        id: "predictive_growth_summary",
        severity: "info",
        kind: "predictive",
        category: "growth",
        message: `Only ${history.length} runtime samples — need ≥5 for projection`,
        evidence: { rowCount: history.length, currentTableRows: tableRows, heapMb, heapLimitMb },
      });
      return makeReport("predictive-growth", findings, t0);
    }

    // Per-table projection
    for (const table of SAMPLE_TABLES) {
      const samples = history.map(h => h.tableRows?.[table]).filter(n => Number.isFinite(n));
      if (samples.length < 5) continue;
      const slope = linearSlope(samples);
      if (slope <= 0) continue;
      const current = samples[samples.length - 1];
      const projected = current + slope * samplesPerInterval * TABLE_GROWTH_PROJECTION_DAYS;
      if (projected > TABLE_GROWTH_LIMIT) {
        findings.push({
          id: "predictive_table_growth_explosion",
          severity: "high",
          kind: "predictive",
          category: "growth",
          subject: { kind: "table", name: table },
          message: `Table ${table} projected to exceed ${TABLE_GROWTH_LIMIT.toLocaleString()} rows in ${TABLE_GROWTH_PROJECTION_DAYS} days (current ${current.toLocaleString()}, slope ${slope.toFixed(1)}/sample)`,
          evidence: { table, current, slope, projectedIn21Days: Math.round(projected) },
          fixHint: "shard_or_evict",
        });
      }
    }

    // Heap projection
    const heapSamples = history.map(h => h.heapMb).filter(Number.isFinite);
    if (heapSamples.length >= 5 && heapLimitMb) {
      const slope = linearSlope(heapSamples);
      const current = heapSamples[heapSamples.length - 1];
      const projected = current + slope * samplesPerInterval * HEAP_PROJECTION_DAYS;
      if (projected > heapLimitMb * HEAP_THRESHOLD_RATIO) {
        findings.push({
          id: "predictive_heap_pressure",
          severity: "critical",
          kind: "predictive",
          category: "growth",
          subject: { kind: "heap" },
          message: `Heap projected to exceed ${Math.round(heapLimitMb * HEAP_THRESHOLD_RATIO)}MB (${HEAP_THRESHOLD_RATIO * 100}% of MAX_OLD_SPACE_SIZE) in ${HEAP_PROJECTION_DAYS} days; current ${current}MB, projected ${Math.round(projected)}MB`,
          evidence: { current, slope, heapLimitMb, projected: Math.round(projected) },
          fixHint: "tune_caches",
        });
      }
    }

    // DTU corpus growth vs consolidation
    const dtuSamples = history.map(h => h.tableRows?.dtus).filter(Number.isFinite);
    if (dtuSamples.length >= 5) {
      const dtuSlope = linearSlope(dtuSamples);
      // Heuristic: warn if DTU count growing > 1000/sample without compression
      if (dtuSlope > 1000) {
        findings.push({
          id: "predictive_dtu_growth_unconsolidated",
          severity: "medium",
          kind: "predictive",
          category: "growth",
          message: `DTU corpus growing at ${dtuSlope.toFixed(0)} rows/sample; consolidation may be lagging`,
          evidence: { slope: dtuSlope, current: dtuSamples[dtuSamples.length - 1] },
          fixHint: "trigger_consolidation",
        });
      }
    }

    findings.unshift({
      id: "predictive_growth_summary",
      severity: "info",
      kind: "predictive",
      category: "growth",
      message: `${history.length} samples · ${Object.keys(tableRows).length} tables observed · heap ${heapMb || "?"}MB`,
      evidence: { historySamples: history.length, currentTableRows: tableRows, heapMb, heapLimitMb },
    });

    return makeReport("predictive-growth", findings, t0);
  } catch (err) {
    return makeError("predictive-growth", "exception", err, t0);
  }
}
