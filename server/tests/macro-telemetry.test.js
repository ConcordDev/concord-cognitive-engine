/**
 * Tier-2 contract tests for the macro telemetry module.
 *
 * The telemetry module records every macro invocation at runtime so the
 * MacroUsageDetector can resolve dispatcher-reach by observed fact, not
 * just by static regex. Tests pin: invocation counting, source
 * classification, persistent flush, aggregation across files.
 *
 * Run: node --test tests/macro-telemetry.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  recordInvocation,
  snapshot,
  startTelemetry,
  stopTelemetry,
  _resetForTest,
  flush,
  loadAggregated,
  MACRO_LIVE_WINDOW_DAYS,
} from "../lib/detectors/macro-telemetry.js";

let tmpRoot;

before(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), "concord-telemetry-"));
});

after(async () => {
  stopTelemetry();
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe("recordInvocation", () => {
  it("counts invocations per (domain, name) and tracks lastFiredAt", () => {
    _resetForTest();
    const t0 = Date.now();
    recordInvocation("dtu", "list", { reqMeta: { path: "/api/foo" } });
    recordInvocation("dtu", "list", { reqMeta: { path: "/api/foo" } });
    recordInvocation("dtu", "get", { actor: { internal: true } });
    const snap = snapshot();
    const dtuList = snap.find(s => s.key === "dtu.list");
    assert.equal(dtuList.total, 2);
    assert.equal(dtuList.sources.http, 2);
    assert.ok(dtuList.lastFiredAt >= t0);
    const dtuGet = snap.find(s => s.key === "dtu.get");
    assert.equal(dtuGet.total, 1);
    assert.equal(dtuGet.sources.internal, 1);
  });

  it("handles missing domain/name without throwing", () => {
    assert.doesNotThrow(() => recordInvocation(null, "list", {}));
    assert.doesNotThrow(() => recordInvocation("dtu", null, {}));
    assert.doesNotThrow(() => recordInvocation("dtu", "list", null));
  });

  it("classifies sources from ctx shape", () => {
    _resetForTest();
    recordInvocation("a", "x", { reqMeta: { path: "/api/x" } });
    recordInvocation("a", "x", { actor: { internal: true }, reqMeta: { reason: "heartbeat" } });
    recordInvocation("a", "x", { actor: { internal: true } });
    recordInvocation("a", "x", {});
    const e = snapshot().find(s => s.key === "a.x");
    assert.equal(e.sources.http, 1);
    assert.equal(e.sources.heartbeat, 1);
    assert.equal(e.sources.internal, 1);
    assert.equal(e.sources.system, 1);
    assert.equal(e.total, 4);
  });
});

describe("flush + persistence", () => {
  it("appends a JSONL row per key on flush, then clears in-memory state", async () => {
    _resetForTest();
    startTelemetry(tmpRoot);
    recordInvocation("test", "alpha", {});
    recordInvocation("test", "beta", { reqMeta: { path: "/x" } });
    recordInvocation("test", "alpha", {});

    const r = await flush();
    assert.equal(r.written, 2);
    assert.ok(r.path.endsWith("audit/detectors/macro-telemetry.jsonl"));

    // Post-flush, in-memory snapshot is empty.
    assert.equal(snapshot().length, 0);

    const raw = await readFile(r.path, "utf-8");
    const lines = raw.trim().split("\n").map(JSON.parse);
    assert.equal(lines.length, 2);
    const alpha = lines.find(l => l.key === "test.alpha");
    assert.equal(alpha.total, 2);
  });

  it("flush is a no-op when nothing has been recorded", async () => {
    _resetForTest();
    startTelemetry(tmpRoot);
    const r = await flush();
    assert.equal(r.written, 0);
  });
});

describe("loadAggregated", () => {
  it("aggregates across multiple flushes and folds in-memory counts", async () => {
    _resetForTest();
    startTelemetry(tmpRoot);

    // Create a fresh dir for this test
    const localRoot = await mkdtemp(path.join(tmpdir(), "concord-tel-agg-"));
    stopTelemetry();
    startTelemetry(localRoot);

    recordInvocation("agg", "x", {});
    await flush();
    recordInvocation("agg", "x", {});
    recordInvocation("agg", "y", {});
    await flush();
    recordInvocation("agg", "x", {});  // still in-memory; not flushed

    const out = await loadAggregated(localRoot, MACRO_LIVE_WINDOW_DAYS);
    // 2 flushed + 1 in-memory = 3 total for "agg.x"
    assert.equal(out.totals.get("agg.x"), 3);
    assert.equal(out.totals.get("agg.y"), 1);
    assert.ok(out.liveKeys.has("agg.x"));
    assert.ok(out.liveKeys.has("agg.y"));

    await rm(localRoot, { recursive: true, force: true });
  });

  it("returns empty when no telemetry file exists", async () => {
    const emptyRoot = await mkdtemp(path.join(tmpdir(), "concord-tel-empty-"));
    const out = await loadAggregated(emptyRoot);
    assert.equal(out.liveKeys.size, 0);
    assert.equal(out.totals.size, 0);
    await rm(emptyRoot, { recursive: true, force: true });
  });

  it("excludes keys older than the window from liveKeys", async () => {
    const localRoot = await mkdtemp(path.join(tmpdir(), "concord-tel-stale-"));
    const tlPath = path.join(localRoot, "audit", "detectors", "macro-telemetry.jsonl");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.dirname(tlPath), { recursive: true });
    // Write a row that "fired" 60 days ago
    const old = Date.now() - 60 * 86_400_000;
    await writeFile(tlPath, JSON.stringify({
      generatedAt: new Date(old).toISOString(),
      key: "stale.macro",
      total: 5,
      lastFiredAt: old,
      sources: { http: 5, heartbeat: 0, internal: 0, system: 0 },
    }) + "\n", "utf-8");

    const out = await loadAggregated(localRoot, MACRO_LIVE_WINDOW_DAYS);
    assert.equal(out.totals.get("stale.macro"), 5);
    assert.equal(out.liveKeys.has("stale.macro"), false);

    await rm(localRoot, { recursive: true, force: true });
  });
});
