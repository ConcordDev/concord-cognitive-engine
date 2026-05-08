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
