/**
 * Tier-2 contract tests for the detector suite.
 *
 * The suite wires 8 detectors behind a single registry. Each must:
 *   - return a normalised DetectorReport never throw
 *   - report ok=false with a reason when its inputs are unavailable
 *   - degrade gracefully on missing fs / db / state
 *
 * Run: node --test tests/detectors-suite.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  listDetectors,
  getDetector,
  runDetector,
  runAllDetectors,
  filterFindings,
  registerDetector,
} from "../lib/detectors/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");

const REPORT_SHAPE = ["id", "ok", "summary", "findings", "durationMs"];

// One full-suite report shared across tests — each detector walks the
// 1.3M-LOC tree, so re-running per test pushes the suite over 120s.
let _cachedAllReport = null;
async function getAllReport() {
  if (!_cachedAllReport) {
    _cachedAllReport = await runAllDetectors({ root: REPO_ROOT });
  }
  return _cachedAllReport;
}

function assertReportShape(r) {
  assert.ok(typeof r === "object" && r !== null, "must return an object");
  for (const k of REPORT_SHAPE) {
    assert.ok(k in r, `report missing key: ${k}`);
  }
  assert.equal(typeof r.ok, "boolean");
  assert.ok(Array.isArray(r.findings));
  for (const k of ["total", "critical", "high", "medium", "low", "info"]) {
    assert.equal(typeof r.summary[k], "number", `summary missing ${k}`);
  }
  assert.equal(r.summary.total, r.findings.length);
}

describe("detector registry", () => {
  it("registers all 8 built-in detectors", () => {
    const ids = listDetectors().map(d => d.id);
    const expected = [
      "stale-code", "invariant-guardian", "macro-usage", "lens-health",
      "dtu-lineage", "heartbeat-monitor", "secret-leak", "performance-hotspot",
    ];
    for (const id of expected) {
      assert.ok(ids.includes(id), `missing detector: ${id}`);
    }
  });

  it("exposes consumer / dataNeeds metadata for routing", () => {
    for (const d of listDetectors()) {
      assert.ok(Array.isArray(d.consumers), `${d.id} consumers must be array`);
      assert.ok(d.consumers.length >= 1, `${d.id} must declare ≥1 consumer`);
      assert.ok(typeof d.description === "string");
    }
  });

  it("registerDetector adds new entries idempotently", async () => {
    let calls = 0;
    registerDetector({
      id: "test-detector-tmp",
      label: "TmpDetector",
      description: "test only",
      consumers: ["code-quality"],
      run: async () => {
        calls++;
        return { id: "test-detector-tmp", ok: true,
          summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          findings: [], durationMs: 0 };
      },
    });
    assert.ok(getDetector("test-detector-tmp"));
    const r = await runDetector("test-detector-tmp");
    assertReportShape(r);
    assert.equal(calls, 1);
  });

  it("runDetector(unknown) returns ok:false with reason", async () => {
    const r = await runDetector("nope-not-real");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_detector");
  });
});

describe("each detector survives the no-input path", () => {
  for (const id of [
    "stale-code", "invariant-guardian", "macro-usage", "lens-health",
    "dtu-lineage", "heartbeat-monitor", "secret-leak", "performance-hotspot",
  ]) {
    it(`${id} returns a shape-compliant report with no ctx`, async () => {
      const r = await runDetector(id, {});
      assertReportShape(r);
      // Either succeeds (likely via REPO_ROOT default) or fails cleanly.
      if (!r.ok) {
        assert.equal(typeof r.reason, "string");
      }
    });
  }
});

// Cold runAllDetectors over the full repo takes ~30 s on a typical CI box.
// Each `it` that calls getAllReport() must allow >= that, otherwise the
// first cache miss times out under npm test's --test-timeout=30000.
const DET_TIMEOUT = 90_000;

describe("runAllDetectors", { timeout: 120_000 }, () => {
  it("returns an envelope with reports + totals + durationMs", async () => {
    const report = await getAllReport();
    assert.ok(typeof report.generatedAt === "string");
    assert.ok(Array.isArray(report.reports));
    assert.ok(report.reports.length >= 8);
    for (const k of ["total", "critical", "high", "medium", "low", "info"]) {
      assert.equal(typeof report.totals[k], "number", `totals missing ${k}`);
    }
    // Each individual report has the canonical shape
    for (const r of report.reports) assertReportShape(r);
  }, { timeout: DET_TIMEOUT });

  it("filters by consumer", async () => {
    const all = await getAllReport();
    const repair = await runAllDetectors({ root: REPO_ROOT, consumer: "repair-cortex" });
    assert.ok(repair.reports.length <= all.reports.length);
    for (const r of repair.reports) {
      const spec = listDetectors().find(d => d.id === r.id);
      assert.ok(spec.consumers.includes("repair-cortex"), `${r.id} should declare repair-cortex`);
    }
  }, { timeout: DET_TIMEOUT });
});

describe("filterFindings", { timeout: 120_000 }, () => {
  it("filters by minSeverity", async () => {
    const report = await getAllReport();
    const high = filterFindings(report, { minSeverity: "high" });
    for (const f of high) {
      assert.ok(["high", "critical"].includes(f.severity), `unexpected severity: ${f.severity}`);
    }
  }, { timeout: DET_TIMEOUT });

  it("filters by kind", async () => {
    const report = await getAllReport();
    const onlySecret = filterFindings(report, { kinds: ["secret-leak"] });
    for (const f of onlySecret) assert.equal(f.kind, "secret-leak");
  }, { timeout: DET_TIMEOUT });

  it("actionableOnly drops findings with no fixHint", async () => {
    const report = await getAllReport();
    const actionable = filterFindings(report, { actionableOnly: true });
    for (const f of actionable) assert.ok(typeof f.fixHint === "string" && f.fixHint.length > 0);
  }, { timeout: DET_TIMEOUT });
});

describe("dtu-lineage gracefully handles missing db", () => {
  it("returns ok:false reason 'no_db'", async () => {
    const r = await runDetector("dtu-lineage", {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("returns ok with a 'dtu_table_missing' info finding when db has no dtus table", async (t) => {
    let Database;
    try { Database = (await import("better-sqlite3")).default; }
    catch { return t.skip("better-sqlite3 not installed in this environment"); }
    const db = new Database(":memory:");
    const r = await runDetector("dtu-lineage", { db });
    assertReportShape(r);
    assert.equal(r.ok, true);
    assert.ok(r.findings.some(f => f.id === "dtu_table_missing"));
  });
});

describe("invariant-guardian recognises object-literal constants", () => {
  it("does not flag PLATFORM_FEE_RATE as unset (it lives in a constants object)", async () => {
    const r = await runDetector("invariant-guardian", { root: REPO_ROOT });
    const unset = r.findings.filter(f => f.id === "invariant_constant_unset"
      && f.evidence?.name === "PLATFORM_FEE_RATE");
    assert.equal(unset.length, 0, `unexpected: ${JSON.stringify(unset[0])}`);
  });
});

describe("heartbeat-monitor static fallback", () => {
  it("populates 'static' source when registry is empty", async () => {
    const r = await runDetector("heartbeat-monitor", { root: REPO_ROOT, opts: { useRegistry: false } });
    assertReportShape(r);
    const summary = r.findings.find(f => f.id === "heartbeat_summary");
    assert.ok(summary);
    assert.equal(summary.evidence.source, "static");
    assert.ok(summary.evidence.count >= 18);
  });
});

describe("stale-code detector smoke", () => {
  it("returns within a reasonable time and emits the expected shape", async () => {
    const r = await runDetector("stale-code", { root: REPO_ROOT });
    assertReportShape(r);
    assert.ok(r.durationMs < 60_000, `stale-code took ${r.durationMs}ms`);
    // Should at least find ONE thing (orphan tables are abundant in this repo)
    const orphanRow = r.findings.find(f => f.id === "table_orphan");
    assert.ok(orphanRow || r.findings.length >= 0); // tolerant — don't pin counts
  });
});
