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
import { runConcordiaSubstrateDetector } from "./concordia-substrate-detector.js";
import { runFakeDataDetector } from "./fake-data-detector.js";
import { runResourceLeakDetector } from "./resource-leak-detector.js";
import { runEnvConfigDriftDetector } from "./env-config-drift-detector.js";
import { runObservabilityGapDetector } from "./observability-gap-detector.js";
import { runAgentBudgetDetector } from "./agent-budget-detector.js";
import { runLensDecorativeStateDetector } from "./lens-decorative-state-detector.js";
import { runHttpErrorDetector } from "./http-error-detector.js";
import { runFrontendGhostClickDetector } from "./frontend-ghost-click-detector.js";
import { runDeadEventListenerDetector } from "./dead-event-listener-detector.js";
import { runUxBrokenLinkDetector } from "./ux-broken-link-detector.js";
import { runUxA11yButtonNoLabelDetector } from "./ux-a11y-button-no-label-detector.js";
import { runUxLoadingStateMissingDetector } from "./ux-loading-state-missing-detector.js";
import { runUxFormErrorDisplayDetector } from "./ux-form-error-display-detector.js";
import { runUxRouteEmptyRenderDetector } from "./ux-route-empty-render-detector.js";
import { runUxModalNoEscapeDetector } from "./ux-modal-no-escape-detector.js";

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
  id: "lens-decorative-state",
  label: "LensDecorativeStateDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "Flags lens-page UI controls whose state is never read (decorative non-functional UI). Catches discarded-value useState, set-but-never-read state, view-mode toggles with no render branch, useMemo filters with missing deps, and empty event handlers.",
  run: runLensDecorativeStateDetector,
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

// Concordia substrate health — referential integrity in authored content,
// cross-phase invariants (Phase 5b legacy ↔ death, Phase 4c quest ↔ Phase 5e
// region cascade, Phase 3 single-open-beat invariant, etc.), and
// distribution sanity (faction population imbalance, procgen overspawn,
// scarcity index out of clamp).
registerDetector({
  id: "concordia-substrate",
  label: "ConcordiaSubstrateDetector",
  consumers: ["code-quality", "repair-cortex", "concordia"],
  dataNeeds: ["db", "fs"],
  description: "Referential integrity + cross-phase invariants + distribution sanity for the world's data.",
  run: runConcordiaSubstrateDetector,
});

// Fake-data detector — catches mock/fake/stub/placeholder data living
// in production paths, test mocks of production modules without
// fixture-loaders, and TODO/FIXME markers that have outlived their
// context. Closes the gap that allowed the CommandPalette test suite
// to drift from its real component for multiple PRs.
registerDetector({
  id: "fake-data",
  label: "FakeDataDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "Flags mock/fake/stub/placeholder data in production paths + test mocks of real modules.",
  run: runFakeDataDetector,
});

// Category #2 — production resource leaks (setInterval without clear,
// db.prepare in loops, listeners without remove, fs.open without close).
registerDetector({
  id: "resource-leak",
  label: "ResourceLeakDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "Production resource leaks that surface only under sustained load.",
  run: runResourceLeakDetector,
});

// Category #4 — env / config drift (hardcoded URLs, ports, timeouts).
registerDetector({
  id: "env-config-drift",
  label: "EnvConfigDriftDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "Hardcoded URLs, magic ports, magic timeouts that should live in env.",
  run: runEnvConfigDriftDetector,
});

// Category #7 — observability gaps in production paths.
registerDetector({
  id: "observability-gap",
  label: "ObservabilityGapDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "Production paths missing try/catch, telemetry, error logging.",
  run: runObservabilityGapDetector,
});

// Category #10 — AI/agent-specific risks (cost spirals, recursion,
// LLM passthrough). New for the AI-native era.
registerDetector({
  id: "agent-budget",
  label: "AgentBudgetDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "Unbounded agent loops, recursive LLM calls without caps, throttle-less heartbeats, output passthrough.",
  run: runAgentBudgetDetector,
});

// HTTP-error-shape patterns the rest of the matrix (500/401 already
// covered by observability-gap + invariant-guardian).
registerDetector({
  id: "http-error",
  label: "HttpErrorDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "Static patterns that surface as HTTP 400/404/409/429/504 — missing input validation, null-checks, conflict guards, per-route rate limiters, fetch/axios timeouts.",
  run: runHttpErrorDetector,
});

// Frontend ghost-click patterns — buttons without handlers, async
// click handlers that swallow errors, forms that don't preventDefault,
// stuck loading state. Complements http-error-detector on the
// frontend side of the "click did nothing" UX bug class.
registerDetector({
  id: "frontend-ghost-click",
  label: "FrontendGhostClickDetector",
  consumers: ["code-quality", "repair-cortex", "hud"],
  dataNeeds: ["fs"],
  description: "Frontend UI patterns where a button click does nothing visible — missing onClick handler, async fetch without error path, form submit without preventDefault, loading state without finally.",
  run: runFrontendGhostClickDetector,
});

// Ghost-event pattern — CustomEvent dispatched with no subscriber.
// Closes the wiring loop: ghost-click ensures every button has an
// onClick; dead-event-listener ensures every dispatched event has a
// listener. Without it, a fully-wired button can still produce a
// dead UX (the event fires but nothing acts on it).
registerDetector({
  id: "dead-event-listener",
  label: "DeadEventListenerDetector",
  consumers: ["code-quality", "repair-cortex", "hud"],
  dataNeeds: ["fs"],
  description: "Namespaced CustomEvent names dispatched with no addEventListener/useEventListener subscriber anywhere in the frontend tree.",
  run: runDeadEventListenerDetector,
});

// UX-quality detector suite — six per-shape regression gates so
// "top-notch UX with no issues" stays a measurable property.
registerDetector({
  id: "ux-broken-link",
  label: "UxBrokenLinkDetector",
  consumers: ["code-quality", "repair-cortex", "hud"],
  dataNeeds: ["fs"],
  description: "<Link href>/router.push targets that don't match any concord-frontend/app/ route — clicking 404s.",
  run: runUxBrokenLinkDetector,
});
registerDetector({
  id: "ux-a11y-button-no-label",
  label: "UxA11yButtonNoLabelDetector",
  consumers: ["code-quality", "repair-cortex", "hud"],
  dataNeeds: ["fs"],
  description: "Icon-only <button> with no aria-label / aria-labelledby / title / visible text.",
  run: runUxA11yButtonNoLabelDetector,
});
registerDetector({
  id: "ux-loading-state-missing",
  label: "UxLoadingStateMissingDetector",
  consumers: ["code-quality", "repair-cortex", "hud"],
  dataNeeds: ["fs"],
  description: "Async onClick that hits the network with no visible loading state — double-click vulnerable.",
  run: runUxLoadingStateMissingDetector,
});
registerDetector({
  id: "ux-form-error-display",
  label: "UxFormErrorDisplayDetector",
  consumers: ["code-quality", "repair-cortex", "hud"],
  dataNeeds: ["fs"],
  description: "<form onSubmit> with a silent catch block — failed submissions invisible to the user.",
  run: runUxFormErrorDisplayDetector,
});
registerDetector({
  id: "ux-route-empty-render",
  label: "UxRouteEmptyRenderDetector",
  consumers: ["code-quality", "repair-cortex", "hud"],
  dataNeeds: ["fs"],
  description: "Lens page that returns null/undefined/<></> with no EmptyState / Skeleton / loading guard — blank screen.",
  run: runUxRouteEmptyRenderDetector,
});
registerDetector({
  id: "ux-modal-no-escape",
  label: "UxModalNoEscapeDetector",
  consumers: ["code-quality", "repair-cortex", "hud"],
  dataNeeds: ["fs"],
  description: "<Modal>/<Dialog>/<Drawer>/<Sheet>/<Popover>/<Overlay> opened without onClose / onOpenChange / Esc handler — traps the user.",
  run: runUxModalNoEscapeDetector,
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
