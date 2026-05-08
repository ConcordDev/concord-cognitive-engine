/**
 * Tier-2 contract tests for the repair-cortex detector bridge (Phase 5).
 *
 * Pins:
 *   - ingestDetectorDelta routes findings to fix tasks correctly
 *   - high/critical findings call observe() (pain-and-avoidance learning)
 *   - configureBridge wires optional callbacks idempotently
 *   - empty / null / malformed inputs never throw
 *
 * Run: node --test tests/repair-cortex-bridge.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  ingestDetectorDelta,
  configureBridge,
  pendingTasks,
  _flushPendingTasks,
} from "../emergent/repair-cortex/detector-bridge.js";

describe("ingestDetectorDelta — null safety", () => {
  beforeEach(() => { _flushPendingTasks(); });

  it("returns ok:false when report is null/undefined", async () => {
    const r1 = await ingestDetectorDelta(null);
    assert.equal(r1.ok, false);
    const r2 = await ingestDetectorDelta(undefined);
    assert.equal(r2.ok, false);
  });

  it("handles report with no reports[] without throwing", async () => {
    const r = await ingestDetectorDelta({ generatedAt: new Date().toISOString(), totals: {} });
    assert.equal(r.ok, true);
    assert.equal(r.enqueued, 0);
  });

  it("falls back to source from report.reports when delta absent", async () => {
    const report = {
      generatedAt: new Date().toISOString(),
      totals: { total: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0 },
      reports: [{
        id: "performance-hotspot",
        ok: true,
        findings: [{
          id: "perf_sync_fs_in_handler",
          severity: "high",
          kind: "static",
          message: "sync fs in async path",
          location: "server/lib/foo.js:10",
          fixHint: "sync_fs_to_promises",
        }],
        summary: { total: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0 },
      }],
    };
    const r = await ingestDetectorDelta(report, null);
    assert.equal(r.ok, true);
    assert.equal(r.enqueued, 1);
    const tasks = pendingTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].fix, "sync_fs_to_promises");
    assert.equal(tasks[0].riskTier, "low");
  });
});

describe("ingestDetectorDelta — fix matching", () => {
  beforeEach(() => { _flushPendingTasks(); });

  it("matches sync_fs hint to sync_fs_to_promises fix", async () => {
    const report = {
      generatedAt: new Date().toISOString(),
      totals: {},
      reports: [{
        id: "performance-hotspot",
        ok: true,
        findings: [{
          id: "perf_sync_fs_in_handler",
          severity: "high",
          message: "x",
          fixHint: "sync_fs_to_promises",
        }],
        summary: {},
      }],
    };
    await ingestDetectorDelta(report, null);
    const tasks = pendingTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].fix, "sync_fs_to_promises");
  });

  it("matches drop_console_log finding to drop_console_log fix", async () => {
    const report = {
      generatedAt: new Date().toISOString(),
      totals: {},
      reports: [{
        id: "performance-hotspot",
        ok: true,
        findings: [{
          id: "perf_console_log_production",
          severity: "low",
          message: "console.log in prod",
          fixHint: "drop_console_log",
        }],
        summary: {},
      }],
    };
    await ingestDetectorDelta(report, null);
    const tasks = pendingTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].fix, "drop_console_log");
  });

  it("skips info-severity findings", async () => {
    const report = {
      generatedAt: new Date().toISOString(),
      totals: {},
      reports: [{
        id: "any",
        ok: true,
        findings: [{
          id: "summary",
          severity: "info",
          message: "summary",
          fixHint: "sync_fs_to_promises",
        }],
        summary: {},
      }],
    };
    await ingestDetectorDelta(report, null);
    assert.equal(pendingTasks().length, 0);
  });

  it("does NOT enqueue findings with no matching fix", async () => {
    const report = {
      generatedAt: new Date().toISOString(),
      totals: {},
      reports: [{
        id: "any",
        ok: true,
        findings: [{
          id: "perf_uncaught_sql_loop",
          severity: "high",
          message: "n+1 loop",
          fixHint: null,
        }],
        summary: {},
      }],
    };
    const r = await ingestDetectorDelta(report, null);
    assert.equal(r.ok, true);
    assert.equal(r.enqueued, 0);
  });
});

describe("configureBridge", () => {
  beforeEach(() => { _flushPendingTasks(); configureBridge({}); });

  it("calls observe() for high+ findings", async () => {
    let observed = 0;
    configureBridge({ observe: () => { observed++; } });
    const report = {
      generatedAt: new Date().toISOString(),
      totals: {},
      reports: [{
        id: "any",
        ok: true,
        findings: [
          { id: "x", severity: "high", message: "h", fixHint: null },
          { id: "x", severity: "critical", message: "c", fixHint: null },
          { id: "x", severity: "low", message: "l", fixHint: null },
        ],
        summary: {},
      }],
    };
    await ingestDetectorDelta(report, null);
    assert.equal(observed, 2);  // high + critical, not low
  });

  it("invokes logDtu callback when set", async () => {
    let dtuCalls = 0;
    configureBridge({ logDtu: () => { dtuCalls++; } });
    await ingestDetectorDelta({
      generatedAt: new Date().toISOString(),
      totals: {},
      reports: [{ id: "x", ok: true, findings: [], summary: {} }],
    }, null);
    assert.equal(dtuCalls, 1);
  });

  it("does not crash if observe throws", async () => {
    configureBridge({ observe: () => { throw new Error("boom"); } });
    const r = await ingestDetectorDelta({
      generatedAt: new Date().toISOString(),
      totals: {},
      reports: [{
        id: "x", ok: true, findings: [{ id: "x", severity: "high", message: "h" }], summary: {},
      }],
    }, null);
    assert.equal(r.ok, true);
  });
});

describe("pendingTasks + _flushPendingTasks", () => {
  it("pendingTasks returns a snapshot, not the live array", async () => {
    _flushPendingTasks();
    await ingestDetectorDelta({
      generatedAt: new Date().toISOString(),
      totals: {},
      reports: [{
        id: "x", ok: true,
        findings: [{ id: "x", severity: "high", message: "h", fixHint: "sync_fs_to_promises" }],
        summary: {},
      }],
    }, null);
    const snap = pendingTasks();
    snap.push("evil");
    assert.equal(pendingTasks().length, 1, "mutating the snapshot must not affect the queue");
  });

  it("_flushPendingTasks empties the queue", () => {
    const flushed = _flushPendingTasks();
    assert.ok(Array.isArray(flushed));
    assert.equal(pendingTasks().length, 0);
  });
});
