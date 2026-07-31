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
import { runMaintenanceGatesDetector } from "./maintenance-gates-detector.js";
import { runFakeDataDetector } from "./fake-data-detector.js";
import { runFrontendFakeDataDetector } from "./frontend-fake-data-detector.js";
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
import { runCommandInjectionDetector } from "./command-injection-detector.js";
import { runAuthzCoverageDetector } from "./authz-coverage-detector.js";
import { runFrontendUnsafeChainDetector } from "./frontend-unsafe-chain-detector.js";
import { runAsymmetricStatusUpdateDetector } from "./asymmetric-status-update-detector.js";
import { runUnusedDestructuredParamDetector } from "./unused-destructured-param-detector.js";
import { runDeadEnvelopeFieldAccessDetector } from "./dead-envelope-field-access-detector.js";
import { runDuplicateHandlerRaceDetector } from "./duplicate-handler-race-detector.js";
import { runFabricationMechanismDetector } from "./fabrication-mechanism-detector.js";
import { runWorkflowGateIntegrityDetector } from "./workflow-gate-integrity-detector.js";
import { runMoneyTxnHygieneDetector } from "./money-txn-hygiene-detector.js";
import { runRealtimeEmitSignatureDetector } from "./realtime-emit-signature-detector.js";
import { runStaleLyingTestDetector } from "./stale-lying-test-detector.js";
import { runDeadMacroCallDetector } from "./dead-macro-call-detector.js";
import { runHardcodedLiteralDataPropDetector } from "./hardcoded-literal-data-prop-detector.js";
import { runDomainReachabilityDetector } from "./domain-reachability-detector.js";
import { runLensManifestCapabilityDetector } from "./lens-manifest-capability-detector.js";
import { runConstantTimeDetector } from "./constant-time-detector.js";
import { runPublicReadWriteVerbDetector } from "./public-read-write-verb-detector.js";
import { runWorldShardWriteBoundaryDetector } from "./world-shard-write-boundary-detector.js";
import { runInternalActorStampDetector } from "./internal-actor-stamp-detector.js";
import { runCheckerSelfCoverageDetector } from "./checker-self-coverage-detector.js";
import { runDocClaimResolutionDetector } from "./doc-claim-resolution-detector.js";

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
  id: "maintenance-gates",
  label: "MaintenanceGates",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["spawn"],
  description: "Runs the schema-drift + economic-invariant gates; a failure is a build-blocking critical (Prophet/per-commit only).",
  run: runMaintenanceGatesDetector,
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
// `security` added 2026-07-27: this detector was NOT in the blocking
// security gate, which is the directly-relevant prevention for a
// committed-credential incident — the exact thing the gate should catch on the
// PR rather than after merge. Measured before promoting, not assumed: it
// currently reports 1 finding at `info` (its own scan-summary row) and 0
// high/critical, so it cannot change today's gate result; and its pattern
// table does emit `critical`/`high` for real hits (AWS/Stripe/private-key
// shapes), so it can genuinely block a future one. Cost measured in isolation:
// 3.4s over 9,245 files -- negligible in the gate. (The full-sweep report's
// per-detector column showed 236s for it; that is wall-clock under contention
// with ~30 other detectors, NOT this detector's own cost. Measure a detector
// alone before sizing a timeout around it.)
//
// `constant-time` was evaluated for the same promotion and deliberately NOT
// added: it only ever emits `info` severity, and the gate fails only on new
// high/critical — so adding it would run for 13s on every PR and could never
// block anything. That is coverage theatre, not coverage.
registerDetector({
  id: "secret-leak",
  label: "SecretLeakDetector",
  consumers: ["code-quality", "repair-cortex", "security"],
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

// Frontend fake-data detector — scoped to concord-frontend/app/lenses +
// concord-frontend/components. Distinct from fake-data (name-based) and
// fabrication-mechanism (assignment-taint-based): this one catches
// hardcoded array-of-objects literals rendered as if live substrate data
// with no fetch hook in the enclosing component, Math.random() called
// directly inside a JSX expression container, and lorem/sample/placeholder
// content sitting in a rendered string literal. A general UX-honesty
// finding, NOT a security finding — deliberately not tagged "security" so
// it feeds only the code-quality baseline/budget ratchet, never the
// blocking security-gate consumer.
registerDetector({
  id: "frontend-fake-data",
  label: "FrontendFakeDataDetector",
  consumers: ["code-quality", "repair-cortex", "hud"],
  dataNeeds: ["fs"],
  description: "Flags hardcoded arrays rendered as live data with no fetch hook nearby, Math.random() synthesizing a rendered value inside JSX, and lorem/sample/placeholder content rendered as real copy, across lens pages + components.",
  run: runFrontendFakeDataDetector,
});

// Sibling to frontend-fake-data, seeded by a real bug found in
// SpikingNetworkPanel.tsx (2026-07-25): the success path called
// `setRunCount(n => n + 1)` but the early-return refusal branch did not,
// while the render read `runCount === 0 ? 'idle' : status` — so a real
// backend refusal displayed to the user as "never attempted". Same honesty
// class as fabricated data (the UI states something untrue about what the
// system did), arrived at from the opposite direction: not inventing a
// success, but hiding a failure.
registerDetector({
  id: "asymmetric-status-update",
  label: "AsymmetricStatusUpdateDetector",
  consumers: ["code-quality", "repair-cortex", "hud"],
  dataNeeds: ["fs"],
  description:
    "A state setter called on the success path but not in a sibling early-return refusal/error branch, where that state gates an idle-vs-status ternary — a refusal disguised as never-attempted.",
  run: runAsymmetricStatusUpdateDetector,
});

// Seeded by a real bug fixed this session: `analyticISI` destructured
// V_reset + refractory and then used neither, silently ignoring two
// caller-supplied physical parameters. Its top hit on the real tree is the
// same shape on the money path — `mintCoins(db, { …, requestId, ip })`
// references neither, while economy_ledger has request_id + ip columns
// waiting for them.
registerDetector({
  id: "unused-destructured-param",
  label: "UnusedDestructuredParamDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description:
    "A function destructures an object parameter but never references one of the bound names — a caller-supplied value silently dropped on the floor.",
  run: runUnusedDestructuredParamDetector,
});

// Seeded by the ConceptArtBoard silent-failure bug: an error branch read
// `r.data?.result?.ok` when lensRun had already unwrapped the envelope, so
// the branch was structurally unreachable and failures rendered as nothing.
// Cross-references each call's actual backend handler to tell a genuinely
// dead nested read from a live flat one — see the detector's own
// classifyBackendMacroShapes note for why that pass is required.
registerDetector({
  id: "dead-envelope-field-access",
  label: "DeadEnvelopeFieldAccessDetector",
  consumers: ["code-quality", "repair-cortex", "hud"],
  dataNeeds: ["fs"],
  description:
    "A lensRun()-sourced .result.ok/.result.error read that the macro's own backend handler proves is structurally unreachable.",
  run: runDeadEnvelopeFieldAccessDetector,
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

// ── Security detector pack (PR-blocking subset) ────────────────────────
// These two carry the `consumer: "security"` tag so the PR gate can run JUST
// them (`run-detectors.js --consumer security --diff --ci`) as a fast,
// blocking check — distinct from the monitor-only full-suite nightly run.
// Seeded from the real PR #808 execSync miss: the suite HAD ~30 detectors and
// still let an external scanner (CodeQL) be the one to catch a shell-injection
// sink. Now the class is caught in-house, on the PR, before merge.
registerDetector({
  id: "command-injection",
  label: "CommandInjectionDetector",
  consumers: ["code-quality", "repair-cortex", "security"],
  dataNeeds: ["fs"],
  description: "Flags child_process exec/execSync (and spawn-family with shell:true) called on a non-literal command — shell-injection sinks. Excludes db.exec SQL by binding to child_process imports only.",
  run: runCommandInjectionDetector,
});
registerDetector({
  id: "authz-coverage",
  label: "AuthzCoverageDetector",
  consumers: ["code-quality", "repair-cortex", "security"],
  dataNeeds: ["fs"],
  description: "Flags mutating HTTP routes (app/router POST/PUT/DELETE/PATCH) with no auth middleware, no handler-body auth idiom, and no `// AUTH:` marker. Scans server.js (the monolith check-route-auth.js ignored) + routes/*.",
  run: runAuthzCoverageDetector,
});

// ── Verification-audit detector wave (2026-07) ──────────────────────────
// Five new classes + the two X1/X2 extensions above (resource-leak,
// dead-event-listener), drafted from the Deep Verification-Audit Campaign's
// confirmed findings. Each ships a positive fixture from a real confirmed
// finding and a negative fixture from a refuted one.
registerDetector({
  id: "frontend-unsafe-chain",
  label: "FrontendUnsafeChainDetector",
  consumers: ["code-quality", "repair-cortex", "hud"],
  dataNeeds: ["fs"],
  description: "Unguarded member-access chains on data flowing from a fetch/lensRun/useSWR API surface — the envelope-unwrap crash class (finding: music/page.tsx listings/beats mismatch).",
  run: runFrontendUnsafeChainDetector,
});
registerDetector({
  id: "duplicate-handler-race",
  label: "DuplicateHandlerRaceDetector",
  consumers: ["code-quality", "repair-cortex", "hud"],
  dataNeeds: ["fs"],
  description: "Same global keybinding/socket-event/route registered by more than one co-mounting handler with no de-dup — double-fire races (finding: triple-owner Ctrl+K).",
  run: runDuplicateHandlerRaceDetector,
});
registerDetector({
  id: "fabrication-mechanism",
  label: "FabricationMechanismDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "Random-generated or fake-incrementing values flowing into a shipped response/render as if real — the honest-by-construction violation class (finding: frontier-part4.js's fabricated /dtu/diff response).",
  run: runFabricationMechanismDetector,
});
registerDetector({
  id: "workflow-gate-integrity",
  label: "WorkflowGateIntegrityDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "CI gate-integrity holes — unexempted continue-on-error, missing NODE_ENV backstops, captured-never-asserted checks, push-only gates that should also run on PRs.",
  run: runWorkflowGateIntegrityDetector,
});
registerDetector({
  id: "money-txn-hygiene",
  label: "MoneyTxnHygieneDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "Multiple money-table writes in one function without a wrapping db.transaction, and SELECT * on money tables — money-invariant files are scanned but emit escalate-only findings.",
  run: runMoneyTxnHygieneDetector,
});
registerDetector({
  id: "realtime-emit-signature",
  label: "RealtimeEmitSignatureDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "realtimeEmit(event, payload, opts) called with the wrong argument order/shape — silently falls through to an unscoped broadcast (finding: the brawl-invited misordered calls).",
  run: runRealtimeEmitSignatureDetector,
});
registerDetector({
  id: "stale-lying-test",
  label: "StaleLyingTestDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "Tests that assert against a source-string match instead of rendering/dispatching real behavior — pass-for-the-wrong-reason tests that can't catch a regression (finding: command-palette-wired.test.tsx).",
  run: runStaleLyingTestDetector,
});
registerDetector({
  id: "dead-macro-call",
  label: "DeadMacroCallDetector",
  consumers: ["code-quality", "repair-cortex", "hud"],
  dataNeeds: ["fs"],
  description: "A frontend call site invokes a macro/action name that no domain registers — dead buttons that always hit the unknown_macro fallback.",
  run: runDeadMacroCallDetector,
});
registerDetector({
  id: "hardcoded-literal-data-prop",
  label: "HardcodedLiteralDataPropDetector",
  consumers: ["code-quality", "repair-cortex", "hud"],
  dataNeeds: ["fs"],
  description: "A component is mounted with a hardcoded empty/off literal (0, false, null, [], '') passed to a prop whose name implies live/computed data — silently making a feature permanently inert.",
  run: runHardcodedLiteralDataPropDetector,
});

// OP4 (2026-07-23) — generalized, permanent version of the manual wiring
// audit that found 5 fully-coded domain files whose registrar was never
// imported by server.js or domains/index.js (commit 61a29cc0). Distinct from
// `stale-code`'s "ghost module" rule, which explicitly treats every file
// under server/domains/ as wired-by-convention and skips it — domains/ was a
// deliberate blind spot there, closed here.
registerDetector({
  id: "domain-reachability",
  label: "DomainReachabilityDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "Cross-references every server/domains/*.js file against the real loader graph (server.js import+call, domains/index.js array) and flags a registrar with zero reachability path — caller-with-no-receiver dead code.",
  run: runDomainReachabilityDetector,
});

// OP4 (2026-07-23) — the manifest half of the same "static truth drifted from
// runtime truth" class: concord-frontend/lib/lenses/manifest.ts declares a
// literal "domain.name" macro string per capability, but nothing previously
// verified those strings against the real MACROS/LENS_ACTIONS registry (the
// manifest's own `sentinel` entry documents a past MANUAL catch of exactly
// this drift — "Phantom `lens.sentinel.*` refs replaced with the REAL
// registered macros" — this detector is the permanent, automated version).
registerDetector({
  id: "lens-manifest-capability",
  label: "LensManifestCapabilityDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "Cross-references concord-frontend/lib/lenses/manifest.ts's declared macros:{...} capability claims against the real register()/registerLensAction() registry and flags any claim with no real backing macro.",
  run: runLensManifestCapabilityDetector,
});

// W3-A (2026-07-24) — the first AST-based detector in the suite (every other
// detector is regex/string matching over raw file text). Parses each backend
// source file with the TypeScript compiler API's parser and runs a small,
// intentionally-simple intra-file taint analysis to find secret-dependent
// control flow / memory indexing — the source-level PRECONDITION for a
// timing side channel, not proof of one. See the module header for the full
// honest-boundary statement (microarchitectural effects are not modeled).
registerDetector({
  id: "constant-time",
  label: "ConstantTimeDetector",
  consumers: ["code-quality"],
  dataNeeds: ["fs"],
  description: "AST-based: flags secret-dependent branches, secret-dependent array/object indexing, and secret-dependent loop bounds/early-exits (the classic non-constant-time-compare pattern) across server/ — the timing-side-channel precondition, not a hardware-level proof.",
  run: runConstantTimeDetector,
});

// ── "What other bugs could there even be" wave (2026-07-31) ────────────────
// Five detectors for the five specific bug categories identified while
// debugging PR #875's CI: (1) an auth surface trusted to self-police that
// might not, matching the exact shape of the SEC-3 RBAC bug; (2) a
// production write happening from the wrong process boundary, a class
// invisible in every normal test run because CONCORD_SHARD_WORLDS defaults
// off; (3) the exact `{ ...actor, internal: true }` shape that let
// jobs.enqueue grant privileges it shouldn't have (fixed 2026-07-27; this is
// the permanent regression guard for the pattern, not a re-check of that one
// site); (4) a meta-detector for checkers with no test proving they work in
// either direction — seeded by two real instances found this same session
// (the ssrf-guard/no-egress bypass, the emit-subscribe-pairing regex bug);
// (5) a doc claiming something is fixed/closed while referencing a file or
// symbol that no longer resolves, seeded by a stale external-fetch.js claim
// found this session. Security-relevant but NOT tagged consumer:"security"
// pending a measured false-positive pass on the real tree, same promotion
// discipline documented above for secret-leak/constant-time.
registerDetector({
  id: "public-read-write-verb",
  label: "PublicReadWriteVerbDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "A write-shaped macro name (create/update/delete/transfer/...) sitting in publicReadDomains (Gate 2, anonymous-callable) whose handler shows no ownership-check idiom.",
  run: runPublicReadWriteVerbDetector,
});
registerDetector({
  id: "world-shard-write-boundary",
  label: "WorldShardWriteBoundaryDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "A route or scope:'global' heartbeat writing directly to a PER_WORLD_WRITE_TABLES table — invisible with CONCORD_SHARD_WORLDS off, a real race once sharding is enabled.",
  run: runWorldShardWriteBoundaryDetector,
});
registerDetector({
  id: "internal-actor-stamp",
  label: "InternalActorStampDetector",
  consumers: ["code-quality", "repair-cortex", "security"],
  dataNeeds: ["fs"],
  description: "`{ ...var, internal: true }` or `x.internal = true` on a non-literal target — the jobs.enqueue privilege-escalation shape (fixed 2026-07-27; permanent regression guard).",
  run: runInternalActorStampDetector,
});
registerDetector({
  id: "checker-self-coverage",
  label: "CheckerSelfCoverageDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "A detector or gate script with no test anywhere referencing it — nothing proves it's correct in either direction (false-positive or false-negative).",
  run: runCheckerSelfCoverageDetector,
});
registerDetector({
  id: "doc-claim-resolution",
  label: "DocClaimResolutionDetector",
  consumers: ["code-quality", "repair-cortex"],
  dataNeeds: ["fs"],
  description: "A 'fixed/closed/resolved' doc claim naming a specific file or symbol that no longer exists in the tree.",
  run: runDocClaimResolutionDetector,
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
