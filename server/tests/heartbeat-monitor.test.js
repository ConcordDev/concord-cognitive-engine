// tests/heartbeat-monitor.test.js
//
// Bidirectional pin for heartbeat-monitor: a static server.js (or
// server/emergent/*.js) registerHeartbeat() with too few total entries, an
// invalid/stale frequency, or runtime failure/staleness state must be
// flagged; the same shapes with healthy values must NOT be. Every test
// forces `opts.useRegistry: false` so the static-parse path (not the real,
// process-wide live heartbeat registry) is what's under test — this keeps
// results deterministic regardless of what else has run in-process.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runHeartbeatMonitor } from "../lib/detectors/heartbeat-monitor.js";

async function tmpRepo({ serverJs = "", emergentFiles = {} } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hbm-"));
  await mkdir(path.join(dir, "server", "emergent"), { recursive: true });
  await writeFile(path.join(dir, "server", "server.js"), serverJs, "utf8");
  for (const [name, content] of Object.entries(emergentFiles)) {
    await writeFile(path.join(dir, "server", "emergent", name), content, "utf8");
  }
  return dir;
}

/** 18 distinct, valid registerHeartbeat() lines — clears EXPECTED_MIN. */
function manyValidHeartbeats(n = 18) {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += `registerHeartbeat("hb-${i}", { frequency: 60, handler: noop${i} });\n`;
  }
  return out;
}

describe("heartbeat-monitor detector — end to end (static fallback, useRegistry: false)", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FLAGS heartbeat_count_low when zero heartbeats are registered", async () => {
    dir = await tmpRepo({ serverJs: `// no heartbeats here\n` });
    const r = await runHeartbeatMonitor({ root: dir, opts: { useRegistry: false } });
    assert.equal(r.ok, true);
    const hit = r.findings.find((f) => f.id === "heartbeat_count_low");
    assert.ok(hit, "an empty registry must be flagged as too few heartbeats");
    assert.equal(hit.severity, "high");
    assert.equal(hit.evidence.count, 0);
    assert.equal(hit.evidence.min, 18);
  });

  it("does NOT flag heartbeat_count_low when >= 18 distinct heartbeats are registered", async () => {
    dir = await tmpRepo({ serverJs: manyValidHeartbeats(18) });
    const r = await runHeartbeatMonitor({ root: dir, opts: { useRegistry: false } });
    const hit = r.findings.find((f) => f.id === "heartbeat_count_low");
    assert.equal(hit, undefined, "18 distinct heartbeats meets the EXPECTED_MIN floor");
  });

  it("FLAGS heartbeat_invalid_freq for a frequency of 0", async () => {
    dir = await tmpRepo({
      serverJs: manyValidHeartbeats(17) + `registerHeartbeat("bad-freq", { frequency: 0, handler: noop });\n`,
    });
    const r = await runHeartbeatMonitor({ root: dir, opts: { useRegistry: false } });
    const hit = r.findings.find((f) => f.id === "heartbeat_invalid_freq" && f.subject?.id === "bad-freq");
    assert.ok(hit, "frequency 0 must be flagged as invalid (<= FREQ_TOO_AGGRESSIVE)");
    assert.equal(hit.severity, "high");
  });

  it("does NOT flag heartbeat_invalid_freq for a normal frequency (60)", async () => {
    dir = await tmpRepo({ serverJs: `registerHeartbeat("normal-freq", { frequency: 60, handler: noop });\n` });
    const r = await runHeartbeatMonitor({ root: dir, opts: { useRegistry: false } });
    const hit = r.findings.find((f) => f.id === "heartbeat_invalid_freq" && f.subject?.id === "normal-freq");
    assert.equal(hit, undefined, "frequency 60 is a healthy, common value");
  });

  it("FLAGS heartbeat_too_stale for a frequency above 5760 ticks", async () => {
    dir = await tmpRepo({ serverJs: `registerHeartbeat("stale-thing", { frequency: 6000, handler: noop });\n` });
    const r = await runHeartbeatMonitor({ root: dir, opts: { useRegistry: false } });
    const hit = r.findings.find((f) => f.id === "heartbeat_too_stale" && f.subject?.id === "stale-thing");
    assert.ok(hit, "frequency 6000 (> FREQ_TOO_STALE=5760) must be flagged");
    assert.equal(hit.severity, "low");
  });

  it("does NOT flag heartbeat_too_stale at the exact 5760 boundary (not > 5760)", async () => {
    dir = await tmpRepo({ serverJs: `registerHeartbeat("boundary-thing", { frequency: 5760, handler: noop });\n` });
    const r = await runHeartbeatMonitor({ root: dir, opts: { useRegistry: false } });
    const hit = r.findings.find((f) => f.id === "heartbeat_too_stale" && f.subject?.id === "boundary-thing");
    assert.equal(hit, undefined, "5760 is the boundary itself, condition requires strictly greater");
  });

  it("FLAGS heartbeat_failing when runtime failures >= 5 (via state.heartbeatStats)", async () => {
    dir = await tmpRepo({ serverJs: `// static entries irrelevant to this runtime check\n` });
    const state = { heartbeatStats: { "my-heartbeat": { failures: 5, lastError: "boom" } } };
    const r = await runHeartbeatMonitor({ root: dir, state, opts: { useRegistry: false } });
    const hit = r.findings.find((f) => f.id === "heartbeat_failing" && f.subject?.id === "my-heartbeat");
    assert.ok(hit, "5 failures since boot must be flagged");
    assert.equal(hit.severity, "high");
    assert.equal(hit.fixHint, "restart_heartbeat_module");
    assert.equal(hit.evidence.lastError, "boom");
  });

  it("does NOT flag heartbeat_failing when runtime failures are below 5", async () => {
    dir = await tmpRepo({ serverJs: `// n/a\n` });
    const state = { heartbeatStats: { "flaky-but-ok": { failures: 4, lastError: "meh" } } };
    const r = await runHeartbeatMonitor({ root: dir, state, opts: { useRegistry: false } });
    const hit = r.findings.find((f) => f.id === "heartbeat_failing" && f.subject?.id === "flaky-but-ok");
    assert.equal(hit, undefined, "4 failures is below the >= 5 threshold");
  });

  it("FLAGS heartbeat_stale_run when the module hasn't run in over 30 minutes", async () => {
    dir = await tmpRepo({ serverJs: `// n/a\n` });
    const state = { heartbeatStats: { "cold-module": { lastRunMs: Date.now() - 31 * 60 * 1000 } } };
    const r = await runHeartbeatMonitor({ root: dir, state, opts: { useRegistry: false } });
    const hit = r.findings.find((f) => f.id === "heartbeat_stale_run" && f.subject?.id === "cold-module");
    assert.ok(hit, "31 minutes since last run must be flagged as stale");
    assert.equal(hit.severity, "medium");
  });

  it("does NOT flag heartbeat_stale_run when the module ran recently", async () => {
    dir = await tmpRepo({ serverJs: `// n/a\n` });
    const state = { heartbeatStats: { "warm-module": { lastRunMs: Date.now() - 5 * 60 * 1000 } } };
    const r = await runHeartbeatMonitor({ root: dir, state, opts: { useRegistry: false } });
    const hit = r.findings.find((f) => f.id === "heartbeat_stale_run" && f.subject?.id === "warm-module");
    assert.equal(hit, undefined, "5 minutes ago is well within the 30-minute freshness window");
  });

  it("does NOT double-count a heartbeat id declared in BOTH server.js and an emergent/*.js file, and DOES pick up one declared only in emergent/", async () => {
    // Detector-specific edge case: static fallback merges server.js
    // registrations with a walk over server/emergent/*.js, deduping by id
    // via a shared `seen` Set so a heartbeat registered (or re-registered)
    // in both places isn't counted twice.
    dir = await tmpRepo({
      serverJs: manyValidHeartbeats(17) + `registerHeartbeat("dupe-hb", { frequency: 90, handler: noop });\n`,
      emergentFiles: {
        "dupe-cycle.js": `registerHeartbeat("dupe-hb", { frequency: 90, handler: noop });\n`,
        "only-here-cycle.js": `registerHeartbeat("emergent-only-hb", { frequency: 45, handler: noop });\n`,
      },
    });
    const r = await runHeartbeatMonitor({ root: dir, opts: { useRegistry: false } });
    const summary = r.findings.find((f) => f.id === "heartbeat_summary");
    // 17 manyValidHeartbeats + 1 "dupe-hb" (counted once, not twice) + 1 "emergent-only-hb" = 19.
    assert.equal(summary.evidence.count, 19, "dupe-hb must be counted exactly once across both sources");
    assert.ok(summary.evidence.ids.includes("emergent-only-hb"), "a heartbeat declared only in emergent/ must still be discovered");
    assert.ok(summary.evidence.ids.includes("dupe-hb"));
  });
});
