// server/lib/detectors/index.js
//
// Multi-purpose detector registry.
//
// Detectors are not just static-analysis tools — they are general anomaly
// reporters. Any subsystem (repair-cortex, Concordia gameplay, NPC
// behaviour heuristics, the lens HUD) can:
//
//   - listDetectors() — get the registered set with metadata
//   - runDetector(id, ctx) — invoke a single one
//   - runAllDetectors(ctx) — invoke the whole suite
//   - registerDetector(spec) — plug in custom detectors at runtime
//
// Each detector is a `(ctx) => Promise<DetectorReport>` (see _framework.js).
// `ctx` is plain-object: { root, db, state, opts }. Detectors that don't
// need a particular field tolerate it being undefined.
//
// The registry is shared via globalThis so the lens / heartbeat / repair
// cortex / CLI all observe the same set without import cycles.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { runStaleCodeDetector } from "./stale-code-detector.js";
import { runInvariantGuardian } from "./invariant-guardian.js";
import { runMacroUsageDetector } from "./macro-usage-detector.js";
import { runLensHealthDetector } from "./lens-health-detector.js";
import { runDtuLineageDetector } from "./dtu-lineage-detector.js";
import { runHeartbeatMonitor } from "./heartbeat-monitor.js";
import { runSecretLeakDetector } from "./secret-leak-detector.js";
import { runPerformanceHotspotDetector } from "./performance-hotspot-detector.js";
import { runHistoricalTrendDetector } from "./historical-trend-detector.js";
import { runPredictiveGrowthDetector } from "./predictive-growth-detector.js";
import { runArchitecturalHubDetector } from "./architectural-hub-detector.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

/**
 * @typedef {(ctx: {root?: string, db?: any, state?: any, opts?: object}) => Promise<DetectorReport>} DetectorFn
 *
 * @typedef {Object} DetectorSpec
 * @property {string} id           kebab-case identifier
 * @property {string} label        human-readable name
 * @property {string[]} consumers  who uses this — ["code-quality"|"repair-cortex"|"concordia"|"hud"]
 * @property {string[]} dataNeeds  ["fs"|"db"|"runtime-state"|"frontend-tree"]
 * @property {string} description  one-line summary
 * @property {DetectorFn} run      handler
 */

const REGISTRY = new Map();

/** Register a detector. Idempotent — second registration replaces the first. */
export function registerDetector(spec) {
  if (!spec?.id || typeof spec.run !== "function") {
    throw new Error("registerDetector: { id, run } required");
  }
  REGISTRY.set(spec.id, {
    id: spec.id,
    label: spec.label || spec.id,
    consumers: spec.consumers || ["code-quality"],
    dataNeeds: spec.dataNeeds || [],
    description: spec.description || "",
    run: spec.run,
  });
}

export function listDetectors() {
  return Array.from(REGISTRY.values()).map(({ run: _r, ...rest }) => rest);
}

export function getDetector(id) {
  return REGISTRY.get(id);
}

/**
 * Run a single detector by id. ctx.root defaults to the repo root.
 * Returns a normalized DetectorReport even on failure.
 */
export async function runDetector(id, ctx = {}) {
  const entry = REGISTRY.get(id);
  if (!entry) {
    return {
      id,
      ok: false,
      reason: "unknown_detector",
      summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      findings: [],
      durationMs: 0,
    };
  }
  const t0 = Date.now();
  try {
    return await entry.run({ root: REPO_ROOT, ...ctx });
  } catch (err) {
    return {
      id,
      ok: false,
      reason: "exception",
      error: err?.message || String(err),
      summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      findings: [],
      durationMs: Date.now() - t0,
    };
  }
}

/**
 * Run every registered detector in parallel. Each individual detector
 * is exception-safe; the suite never throws.
 *
 * Optionally filter by consumer ("code-quality" | "repair-cortex" |
 * "concordia" | "hud"). Detectors with NO consumers field default to
 * "code-quality".
 */
export async function runAllDetectors(ctx = {}) {
  const consumer = ctx.consumer;
  const ids = Array.from(REGISTRY.keys()).filter(id => {
    if (!consumer) return true;
    const consumers = REGISTRY.get(id)?.consumers || ["code-quality"];
    return consumers.includes(consumer);
  });
  const results = await Promise.all(ids.map(id => runDetector(id, ctx)));
  const overall = {
    generatedAt: new Date().toISOString(),
    consumer: consumer || "all",
    detectorCount: results.length,
    totals: { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 },
    durationMs: 0,
    reports: results,
  };
  for (const r of results) {
    overall.durationMs = Math.max(overall.durationMs, r.durationMs ?? 0);
    for (const k of Object.keys(overall.totals)) {
      overall.totals[k] += (r.summary?.[k] ?? 0);
    }
  }
  return overall;
}

/**
 * Filter findings across reports for repair-cortex / NPC consumers.
 *
 * @param {object} report  output of runAllDetectors
 * @param {object} opts    { minSeverity, kinds, actionableOnly }
 */
export function filterFindings(report, opts = {}) {
  const order = ["info", "low", "medium", "high", "critical"];
  const minIdx = order.indexOf(opts.minSeverity || "info");
  const kinds = opts.kinds ? new Set(opts.kinds) : null;
  const out = [];
  for (const r of report?.reports || []) {
    for (const f of r.findings || []) {
      if (order.indexOf(f.severity) < minIdx) continue;
      if (kinds && !kinds.has(f.kind)) continue;
      if (opts.actionableOnly && !f.fixHint) continue;
      out.push({ detector: r.id, ...f });
    }
  }
  return out;
}

// Built-in registrations — once at module load.
registerDetector({
  id: "stale-code",
  label: "StaleCodeDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "Finds unused macros, dead routes, orphaned tables, ghost modules.",
  run: runStaleCodeDetector,
});
registerDetector({
  id: "invariant-guardian",
  label: "InvariantGuardian",
  consumers: ["code-quality", "repair-cortex", "concordia"],
  dataNeeds: ["fs"],
  description: "Checks core system invariants (royalty cap, refusal-field gates, fee constants, …).",
  run: runInvariantGuardian,
});
registerDetector({
  id: "macro-usage",
  label: "MacroUsageDetector",
  consumers: ["code-quality"],
  dataNeeds: ["fs"],
  description: "Histogram of how often each registered macro is called.",
  run: runMacroUsageDetector,
});
registerDetector({
  id: "lens-health",
  label: "LensHealthDetector",
  consumers: ["code-quality", "hud"],
  dataNeeds: ["fs"],
  description: "Checks every lens for broken mounts, missing shells, dead endpoints.",
  run: runLensHealthDetector,
});
registerDetector({
  id: "dtu-lineage",
  label: "DTULineageDetector",
  consumers: ["code-quality", "repair-cortex", "concordia"],
  dataNeeds: ["db"],
  description: "Finds broken royalty cascades, orphaned DTUs, citation loops, cascade overflow.",
  run: runDtuLineageDetector,
});
registerDetector({
  id: "heartbeat-monitor",
  label: "HeartbeatMonitor",
  consumers: ["code-quality", "repair-cortex", "hud"],
  dataNeeds: ["runtime-state"],
  description: "Reports heartbeat registry health, frequency anomalies, stale ticks.",
  run: runHeartbeatMonitor,
});
registerDetector({
  id: "secret-leak",
  label: "SecretLeakDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "Scans the codebase for hardcoded API keys, tokens, credentials.",
  run: runSecretLeakDetector,
});
registerDetector({
  id: "performance-hotspot",
  label: "PerformanceHotspotDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "Flags slow queries, sync fs in handlers, N+1 patterns, unbounded caches.",
  run: runPerformanceHotspotDetector,
});

// ── T1 Phase 6: semantic / historical / predictive / architectural ─────
registerDetector({
  id: "historical-trend",
  label: "HistoricalTrendDetector",
  consumers: ["code-quality", "repair-cortex", "reflex"],
  dataNeeds: ["fs"],
  description: "Trend slopes from history.jsonl — flags finding count growth, severity explosion.",
  run: runHistoricalTrendDetector,
});
registerDetector({
  id: "predictive-growth",
  label: "PredictiveGrowthDetector",
  consumers: ["code-quality", "repair-cortex", "reflex"],
  dataNeeds: ["db", "runtime-state"],
  description: "Linear-regression projection of table size, heap pressure, DTU corpus growth.",
  run: runPredictiveGrowthDetector,
});
registerDetector({
  id: "architectural-hub",
  label: "ArchitecturalHubDetector",
  consumers: ["code-quality", "repair-cortex", "reflex"],
  dataNeeds: ["fs"],
  description: "Module fan-in / fan-out / centrality + import-cycle detection.",
  run: runArchitecturalHubDetector,
});

// Shared across modules so repair-cortex / Concordia / HUD see the same
// registry without re-registering.
globalThis.__CONCORD_DETECTORS__ = Object.assign(globalThis.__CONCORD_DETECTORS__ || {}, {
  registerDetector,
  listDetectors,
  getDetector,
  runDetector,
  runAllDetectors,
  filterFindings,
});
