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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");

export default function registerDetectorMacros(register) {
  /**
   * detectors.list — return registered detector specs.
   */
  register("detectors", "list", async (_ctx, _input = {}) => {
    return { ok: true, detectors: listDetectors() };
  }, { note: "list registered detectors" });

  /**
   * detectors.run — run a single detector by id.
   * input: { id, opts? }
   */
  register("detectors", "run", async (ctx, input = {}) => {
    if (!input?.id) return { ok: false, reason: "id_required" };
    const report = await runDetector(input.id, {
      db: ctx?.db,
      state: ctx?.state,
      opts: input.opts || {},
    });
    return { ok: true, report };
  }, { note: "run a single detector" });

  /**
   * detectors.runAll — run every detector. Optional `consumer` filter so
   * Repair Cortex / Concordia / HUD can subscribe to just their slice.
   * input: { consumer?, minSeverity? }
   */
  register("detectors", "runAll", async (ctx, input = {}) => {
    const report = await runAllDetectors({
      db: ctx?.db,
      state: ctx?.state,
      consumer: input.consumer,
    });
    return { ok: true, report };
  }, { note: "run the whole detector suite" });

  /**
   * detectors.findings — flatten + filter findings across detectors. Useful
   * for the lens HUD and for repair-cortex which wants only actionable
   * items at >=high severity.
   * input: { consumer?, minSeverity?, kinds?, actionableOnly? }
   */
  register("detectors", "findings", async (ctx, input = {}) => {
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
}
