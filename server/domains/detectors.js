// server/domains/detectors.js
//
// Macro surface for the detector registry. Read-only — all macros either
// list detectors or run them and return a normalized report. Mutating the
// codebase / DB based on findings is the caller's responsibility (e.g.
// repair-cortex auto-fixes).

import {
  listDetectors,
  runDetector,
  runAllDetectors,
  filterFindings,
} from "../lib/detectors/index.js";
import {
  loadBaseline,
  diffAgainstBaseline,
  loadHistory,
  loadBudget,
} from "../lib/detectors/baseline.js";
import {
  snapshot as telemetrySnapshot,
  loadAggregated as telemetryLoadAggregated,
  flush as telemetryFlush,
  MACRO_LIVE_WINDOW_DAYS,
} from "../lib/detectors/macro-telemetry.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import registerCodeQualityActions from "./code-quality.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");

const KNOWN_SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);

/**
 * Fast, honest input validation for the heavy detector-suite macros
 * (diff/findings/runAll/summary). These macros always run the FULL detector
 * suite (a multi-minute, whole-repo walk) regardless of the fields present in
 * `input` — the fuzz/adversarial harness sends structurally-hostile payloads
 * (an `artifact` wrapper + `__assassin_garbage`) that no real caller ever
 * sends, and those payloads would otherwise sail past validation straight
 * into the multi-minute suite and time out. Reject anything outside the real
 * accepted shape BEFORE starting the heavy work — never fabricate a result.
 * @returns {{ok:false, reason:string, detail?:string}|null} null when input is valid.
 */
function rejectInvalidDetectorInput(input, allowedFields) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "invalid_input", detail: "input_must_be_object" };
  }
  for (const key of Object.keys(input)) {
    if (!allowedFields.has(key)) {
      return { ok: false, reason: "invalid_input", detail: `unknown_field:${key}` };
    }
  }
  if ("consumer" in input && input.consumer !== undefined && typeof input.consumer !== "string") {
    return { ok: false, reason: "invalid_input", detail: "consumer_must_be_string" };
  }
  if ("minSeverity" in input && input.minSeverity !== undefined) {
    if (typeof input.minSeverity !== "string" || !KNOWN_SEVERITIES.has(input.minSeverity)) {
      return { ok: false, reason: "invalid_input", detail: "minSeverity_must_be_known_severity" };
    }
  }
  if ("kinds" in input && input.kinds !== undefined && !Array.isArray(input.kinds)) {
    return { ok: false, reason: "invalid_input", detail: "kinds_must_be_array" };
  }
  if ("actionableOnly" in input && input.actionableOnly !== undefined && typeof input.actionableOnly !== "boolean") {
    return { ok: false, reason: "invalid_input", detail: "actionableOnly_must_be_boolean" };
  }
  if ("codebaseId" in input && input.codebaseId !== undefined && typeof input.codebaseId !== "string") {
    return { ok: false, reason: "invalid_input", detail: "codebaseId_must_be_string" };
  }
  return null;
}

export default function registerDetectorMacros(register) {
  /**
   * detectors.list — return registered detector specs.
   */
  register("detectors", "list", async (_ctx, _input = {}) => {
    return { ok: true, detectors: listDetectors() };
  }, { note: "list registered detectors" });

  /**
   * detectors.run — run a single detector by id.
   * input: { id, opts?, codebaseId? }
   *
   * When codebaseId is set (plugin path), emits detector:run.started +
   * run.complete + finding.added events on the /dx socket bus so the
   * plugin renders findings as gutter diagnostics live.
   */
  register("detectors", "run", async (ctx, input = {}) => {
    if (!input?.id) return { ok: false, reason: "id_required" };
    const codebaseId = input.codebaseId || null;
    const runId = `dr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let dx;
    if (codebaseId) {
      try { dx = await import("../lib/dx/dx-socket-bus.js"); }
      catch { dx = null; }
      dx?.emitDetectorEvent(codebaseId, "run.started", { runId, detectorIds: [input.id] });
    }
    const report = await runDetector(input.id, {
      db: ctx?.db,
      state: ctx?.state,
      opts: input.opts || {},
    });
    if (codebaseId && dx && Array.isArray(report?.findings)) {
      for (const finding of report.findings) {
        dx.emitDetectorEvent(codebaseId, "finding.added", { runId, finding });
      }
      dx.emitDetectorEvent(codebaseId, "run.complete", {
        runId,
        durationMs: report?.durationMs,
        summary: report?.summary,
      });
    }
    return { ok: true, report, runId };
  }, { note: "run a single detector (streams to /dx if codebaseId set)" });

  /**
   * detectors.runAll — run every detector. Optional `consumer` filter so
   * Repair Cortex / Concordia / HUD can subscribe to just their slice.
   * input: { consumer?, minSeverity?, codebaseId? }
   */
  register("detectors", "runAll", async (ctx, input = {}) => {
    const rejected = rejectInvalidDetectorInput(input, new Set(["consumer", "minSeverity", "codebaseId"]));
    if (rejected) return rejected;
    const codebaseId = input.codebaseId || null;
    const runId = `da_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let dx;
    if (codebaseId) {
      try { dx = await import("../lib/dx/dx-socket-bus.js"); }
      catch { dx = null; }
      dx?.emitDetectorEvent(codebaseId, "run.started", { runId, consumer: input.consumer || null });
    }
    const report = await runAllDetectors({
      db: ctx?.db,
      state: ctx?.state,
      consumer: input.consumer,
    });
    if (codebaseId && dx && Array.isArray(report?.reports)) {
      for (const sub of report.reports) {
        if (!Array.isArray(sub?.findings)) continue;
        for (const finding of sub.findings) {
          dx.emitDetectorEvent(codebaseId, "finding.added", {
            runId, finding, detectorId: sub.id,
          });
        }
      }
      dx.emitDetectorEvent(codebaseId, "run.complete", {
        runId,
        durationMs: report?.durationMs,
        totals: report?.totals,
      });
    }
    return { ok: true, report, runId };
  }, { note: "run the whole detector suite (streams to /dx if codebaseId set)" });

  /**
   * detectors.findings — flatten + filter findings across detectors. Useful
   * for the lens HUD and for repair-cortex which wants only actionable
   * items at >=high severity.
   * input: { consumer?, minSeverity?, kinds?, actionableOnly? }
   */
  register("detectors", "findings", async (ctx, input = {}) => {
    const rejected = rejectInvalidDetectorInput(
      input,
      new Set(["consumer", "minSeverity", "kinds", "actionableOnly"]),
    );
    if (rejected) return rejected;
    const report = await runAllDetectors({
      db: ctx?.db,
      state: ctx?.state,
      consumer: input.consumer,
    });
    const findings = filterFindings(report, {
      minSeverity: input.minSeverity || "info",
      kinds: Array.isArray(input.kinds) ? input.kinds : undefined,
      actionableOnly: !!input.actionableOnly,
    });
    return {
      ok: true,
      generatedAt: report.generatedAt,
      totals: report.totals,
      findingCount: findings.length,
      findings,
    };
  }, { note: "filtered, flattened findings list" });

  /**
   * detectors.macro_telemetry — runtime fact about which macros are
   * actually firing. Resolves the dispatcher-reach mystery — macros
   * that have fired in the last MACRO_LIVE_WINDOW_DAYS are live; macros
   * that haven't are retirement candidates. Input: { mode?: "snapshot"|"aggregated", windowDays?: 30, top?: 50 }.
   */
  register("detectors", "macro_telemetry", async (_ctx, input = {}) => {
    const mode = input?.mode === "snapshot" ? "snapshot" : "aggregated";
    const top = Math.min(Math.max(Number(input?.top) || 50, 1), 1000);
    if (mode === "snapshot") {
      return { ok: true, mode, rows: telemetrySnapshot().slice(0, top) };
    }
    const windowDays = Number(input?.windowDays) || MACRO_LIVE_WINDOW_DAYS;
    const agg = await telemetryLoadAggregated(REPO_ROOT, windowDays);
    const rows = Array.from(agg.totals.entries())
      .map(([key, total]) => ({
        key, total,
        lastFiredAt: agg.lastFiredAt.get(key) || 0,
        live: agg.liveKeys.has(key),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, top);
    return {
      ok: true, mode, windowDays,
      liveCount: agg.liveKeys.size,
      totalKeys: agg.totals.size,
      rows,
    };
  }, { note: "runtime macro telemetry" });

  /**
   * detectors.flush_telemetry — force a flush of in-memory telemetry to
   * disk. Used by tests + ad-hoc audits.
   */
  register("detectors", "flush_telemetry", async () => {
    const r = await telemetryFlush();
    return { ok: true, ...r };
  }, { note: "force telemetry flush" });

  /**
   * detectors.history — return the recent N rows from history.jsonl. Lens
   * UI consumes this to render a sparkline trend per detector / severity.
   */
  register("detectors", "history", async (_ctx, input = {}) => {
    const n = Math.min(Math.max(Number(input.n) || 30, 1), 200);
    const rows = await loadHistory(REPO_ROOT, n);
    return { ok: true, rows };
  }, { note: "recent detector history rows" });

  /**
   * detectors.baseline — load BASELINE.json. Used by HUD to show
   * acknowledged finding count.
   */
  register("detectors", "baseline", async (_ctx, _input = {}) => {
    const baseline = await loadBaseline(REPO_ROOT);
    return {
      ok: true,
      generatedAt: baseline.generatedAt,
      totals: baseline.totals,
      fingerprintCount: Object.keys(baseline.fingerprints || {}).length,
    };
  }, { note: "current detector baseline summary" });

  /**
   * detectors.diff — compute live delta vs BASELINE.json without persisting.
   */
  register("detectors", "diff", async (ctx, input = {}) => {
    const rejected = rejectInvalidDetectorInput(input, new Set(["consumer"]));
    if (rejected) return rejected;
    const report = await runAllDetectors({
      db: ctx?.db,
      state: ctx?.state,
      consumer: input?.consumer,
    });
    const baseline = await loadBaseline(REPO_ROOT);
    const delta = diffAgainstBaseline(report, baseline);
    const budget = await loadBudget(REPO_ROOT);
    return {
      ok: true,
      generatedAt: report.generatedAt,
      totals: report.totals,
      delta: {
        addedCount: delta.addedCount,
        removedCount: delta.removedCount,
        unchangedCount: delta.unchangedCount,
        addedBySeverity: delta.addedBySeverity,
        added: delta.added.slice(0, 200),
      },
      budget,
    };
  }, { note: "delta vs committed baseline" });

  /**
   * detectors.summary — short totals-only payload for the HUD.
   */
  register("detectors", "summary", async (ctx, input = {}) => {
    const rejected = rejectInvalidDetectorInput(input, new Set(["consumer"]));
    if (rejected) return rejected;
    const report = await runAllDetectors({
      db: ctx?.db,
      state: ctx?.state,
      consumer: input?.consumer,
    });
    return {
      ok: true,
      generatedAt: report.generatedAt,
      detectorCount: report.detectorCount,
      totals: report.totals,
      perDetector: report.reports.map(r => ({
        id: r.id,
        ok: r.ok,
        summary: r.summary,
        durationMs: r.durationMs,
      })),
    };
  }, { note: "lightweight detector totals" });

  // ---------------------------------------------------------------------
  // Code-quality static-analysis surface.
  //
  // server/domains/code-quality.js exports a `registerLensAction`-style
  // registrar — handler signature (ctx, artifact, params). The canonical
  // macro registry here uses (ctx, input). We bridge the two with a thin
  // adapter so the code-quality.* macros resolve through /api/lens/run
  // without touching server.js or domains/index.js. The code-quality
  // handlers already return { ok, result?, error? } envelopes; the macro
  // path passes that straight through to the lens-run response.
  // ---------------------------------------------------------------------
  const codeQualityAdapter = (domain, action, handler, spec = {}) => {
    register(
      domain,
      action,
      async (ctx, input = {}) => handler(ctx, { data: input }, input),
      { ...spec, note: spec.note || `code-quality:${action}` },
    );
  };
  registerCodeQualityActions(codeQualityAdapter);
}
