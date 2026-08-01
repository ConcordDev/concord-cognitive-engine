// tests/historical-trend-detector.test.js
//
// Bidirectional pin for historical-trend-detector: a history.jsonl series
// showing a >3x growth in total/critical/high finding counts (oldest vs.
// latest row, over a >= 5 row window) must be flagged; a flat or shrinking
// series must NOT be. A latest run with > 5 findings not present in
// BASELINE.json must be flagged; <= 5 must not.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runHistoricalTrendDetector } from "../lib/detectors/historical-trend-detector.js";

async function tmpRepo() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "htd-"));
  await mkdir(path.join(dir, "audit", "detectors"), { recursive: true });
  return dir;
}

async function writeHistory(dir, rows) {
  const lines = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await writeFile(path.join(dir, "audit", "detectors", "history.jsonl"), lines, "utf8");
}

async function writeBaseline(dir, obj) {
  await writeFile(path.join(dir, "audit", "detectors", "BASELINE.json"), JSON.stringify(obj), "utf8");
}

function row({ total = 10, critical = 0, high = 0, medium = 0, low = 0, info = 0, added = 0, removed = 0 } = {}) {
  return {
    generatedAt: new Date().toISOString(),
    totals: { total, critical, high, medium, low, info },
    detectorCount: 40,
    durationMs: 100,
    gitSha: "deadbeef",
    deltaVsBaseline: { added, removed },
  };
}

describe("historical-trend detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("does NOT run slope analysis with fewer than 5 history rows (early-return summary only)", async () => {
    dir = await tmpRepo();
    await writeHistory(dir, [row({ total: 10 }), row({ total: 10 })]);
    const r = await runHistoricalTrendDetector({ root: dir });
    assert.equal(r.ok, true);
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].id, "historical_trend_summary");
    assert.equal(r.findings[0].evidence.rowCount, 2);
  });

  it("FLAGS historical_finding_count_explosion when total grows more than 3x over the window", async () => {
    dir = await tmpRepo();
    await writeHistory(dir, [
      row({ total: 10 }), row({ total: 10 }), row({ total: 10 }), row({ total: 10 }), row({ total: 40 }),
    ]);
    const r = await runHistoricalTrendDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "historical_finding_count_explosion");
    assert.ok(hit, "10 -> 40 (4x) must be flagged");
    assert.equal(hit.severity, "high");
    assert.equal(hit.evidence.oldestTotal, 10);
    assert.equal(hit.evidence.latestTotal, 40);
    assert.equal(hit.evidence.growthRatio, 4);
    assert.equal(hit.evidence.window, 5);
  });

  it("does NOT flag historical_finding_count_explosion for a flat series (ratio 1x)", async () => {
    dir = await tmpRepo();
    await writeHistory(dir, [
      row({ total: 10 }), row({ total: 10 }), row({ total: 10 }), row({ total: 10 }), row({ total: 10 }),
    ]);
    const r = await runHistoricalTrendDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "historical_finding_count_explosion");
    assert.equal(hit, undefined, "a flat 5-row series has growth ratio 1, not > 3");
  });

  it("FLAGS historical_critical_explosion when critical count grows more than 3x (severity critical)", async () => {
    dir = await tmpRepo();
    await writeHistory(dir, [
      row({ total: 50, critical: 2, high: 1 }),
      row({ total: 50, critical: 2, high: 1 }),
      row({ total: 50, critical: 2, high: 1 }),
      row({ total: 50, critical: 2, high: 1 }),
      row({ total: 50, critical: 10, high: 1 }),
    ]);
    const r = await runHistoricalTrendDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "historical_critical_explosion");
    assert.ok(hit, "critical 2 -> 10 (5x) must be flagged");
    assert.equal(hit.severity, "critical");
    assert.equal(hit.evidence.oldest, 2);
    assert.equal(hit.evidence.latest, 10);
    // "high" stayed flat (1 -> 1) — must not also fire the high variant.
    const highHit = r.findings.find((f) => f.id === "historical_high_explosion");
    assert.equal(highHit, undefined);
  });

  it("FLAGS historical_high_explosion when high count grows more than 3x (severity high, not critical)", async () => {
    dir = await tmpRepo();
    await writeHistory(dir, [
      row({ total: 50, critical: 0, high: 2 }),
      row({ total: 50, critical: 0, high: 2 }),
      row({ total: 50, critical: 0, high: 2 }),
      row({ total: 50, critical: 0, high: 2 }),
      row({ total: 50, critical: 0, high: 10 }),
    ]);
    const r = await runHistoricalTrendDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "historical_high_explosion");
    assert.ok(hit, "high 2 -> 10 (5x) must be flagged");
    assert.equal(hit.severity, "high");
  });

  it("does NOT flag critical/high explosion when the oldest count was 0 (division-by-zero guard, not a 0->N explosion)", async () => {
    dir = await tmpRepo();
    await writeHistory(dir, [
      row({ total: 50, critical: 0 }),
      row({ total: 50, critical: 0 }),
      row({ total: 50, critical: 0 }),
      row({ total: 50, critical: 0 }),
      row({ total: 50, critical: 5 }),
    ]);
    const r = await runHistoricalTrendDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "historical_critical_explosion");
    assert.equal(hit, undefined, "old===0 is guarded (old>0 required) — 0 to 5 must not be reported as a ratio explosion");
  });

  it("FLAGS historical_unbaselined_findings when the latest run has more than 5 findings not in BASELINE.json", async () => {
    dir = await tmpRepo();
    await writeHistory(dir, [
      row({ total: 20 }), row({ total: 20 }), row({ total: 20 }), row({ total: 20 }), row({ total: 20, added: 8 }),
    ]);
    await writeBaseline(dir, { version: 1, fingerprints: { a: {}, b: {}, c: {} } });
    const r = await runHistoricalTrendDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "historical_unbaselined_findings");
    assert.ok(hit, "8 unbaselined findings (> 5) must be flagged");
    assert.equal(hit.severity, "medium");
    assert.equal(hit.evidence.unbaselined, 8);
    assert.equal(hit.evidence.baselineSize, 3);
    assert.equal(hit.fixHint, "review_or_baseline");
  });

  it("does NOT flag historical_unbaselined_findings when unbaselined count is at or below 5", async () => {
    dir = await tmpRepo();
    await writeHistory(dir, [
      row({ total: 20 }), row({ total: 20 }), row({ total: 20 }), row({ total: 20 }), row({ total: 20, added: 3 }),
    ]);
    const r = await runHistoricalTrendDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "historical_unbaselined_findings");
    assert.equal(hit, undefined, "3 unbaselined findings is within the tolerated <= 5 range");
  });

  it("skips malformed lines in history.jsonl instead of crashing (loadHistory resilience the detector depends on)", async () => {
    dir = await tmpRepo();
    const goodRows = [row({ total: 10 }), row({ total: 10 }), row({ total: 10 }), row({ total: 10 })];
    const lines = goodRows.map((r) => JSON.stringify(r)).join("\n") + "\nNOT VALID JSON\n";
    await writeFile(path.join(dir, "audit", "detectors", "history.jsonl"), lines, "utf8");
    const r = await runHistoricalTrendDetector({ root: dir });
    assert.equal(r.ok, true, "a malformed trailing line must not crash the detector");
    // Only the 4 valid rows are counted -> still below the 5-row slope-analysis floor.
    assert.equal(r.findings[0].id, "historical_trend_summary");
    assert.equal(r.findings[0].evidence.rowCount, 4);
  });
});
