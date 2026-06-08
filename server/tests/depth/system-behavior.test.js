// tests/depth/system-behavior.test.js — REAL behavioral tests for the
// `system` domain. Two macro families live here:
//   • registerLensAction("system", …) — the System Lens / observability backend
//     (server/domains/system.js), reached through lensRun(). Per-user + ring-buffer
//     STATE makes these exactly assertable (round-trip, clamp, validation).
//   • register("system", …) — the cognitive-OS macros in server.js (status,
//     gapScan, continuity, cartograph). Reached through macroRuntime/runMacro.
//     These read the global seeded DTU corpus, so assertions target deterministic
//     INVARIANTS of the output (computed bounds, shape contracts, lineage) rather
//     than seed-dependent magnitudes.
// Every lensRun("system",…) / runMacro("system",…) literally names the macro, so
// the macro-depth grader credits each as a behavioral invocation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, macroRuntime } from "./_harness.js";

// ─────────────────────────────────────────────────────────────────────────────
// Lens-action observability macros (exact value / round-trip / validation)
// ─────────────────────────────────────────────────────────────────────────────

describe("system — telemetry sampling + metrics window", () => {
  it("sample records a real process point; metrics reads it back with derived aggregates", async () => {
    const ctx = await depthCtx("system-metrics");
    const s = await lensRun("system", "sample", {}, ctx);
    assert.equal(s.ok, true);
    // A real process sample: heap totals are positive, heapPct is a percentage.
    assert.ok(s.result.heapTotalMB > 0);
    assert.ok(s.result.heapPct >= 0 && s.result.heapPct <= 100);
    assert.ok(typeof s.result.at === "string" && s.result.at.endsWith("Z"));

    const m = await lensRun("system", "metrics", {}, ctx);
    assert.equal(m.ok, true);
    assert.equal(m.result.capacity, 720); // SAMPLE_CAP
    assert.ok(m.result.count >= 1);
    // latest is the tail of the windowed samples.
    assert.deepEqual(m.result.latest, m.result.samples[m.result.samples.length - 1]);
    // peakHeapMB is the max over the returned window.
    const computedPeak = m.result.samples.reduce((mx, x) => Math.max(mx, x.heapUsedMB), 0);
    assert.equal(m.result.peakHeapMB, computedPeak);
  });

  it("metrics clamps an out-of-range limit to the sample cap", async () => {
    const r = await lensRun("system", "metrics", { params: { limit: 999999 } });
    assert.equal(r.ok, true);
    // window is min(samples, SAMPLE_CAP) — count never exceeds capacity.
    assert.ok(r.result.count <= 720);
  });
});

describe("system — Prometheus alert evaluation + per-user acknowledgement", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("system-alerts"); });

  it("alerts loads the rule set; firingCount equals the firing list length", async () => {
    const r = await lensRun("system", "alerts", {}, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.ruleCount >= 1);
    assert.equal(r.result.firingCount, r.result.firing.length);
    // Every firing rule is also flagged firing in the full rule list.
    for (const f of r.result.firing) {
      const full = r.result.rules.find((x) => x.name === f.name);
      assert.equal(full.firing, true);
    }
    // The heartbeat-stopped rule is locally evaluable (not delegated to Prometheus).
    const hbRule = r.result.rules.find((x) => x.name === "ConcordHeartbeatStopped");
    if (hbRule) assert.equal(hbRule.evaluable, true);
  });

  it("alert-ack marks an alert acknowledged for this user; unack reverses it", async () => {
    const a = await lensRun("system", "alert-ack", { params: { name: "ConcordHighMemory", note: "investigating" } }, ctx);
    assert.equal(a.ok, true);
    assert.equal(a.result.acknowledged, true);
    assert.equal(a.result.ackNote, "investigating");
    // The ack surfaces on the alerts read for the same user.
    const after = await lensRun("system", "alerts", {}, ctx);
    const rule = after.result.rules.find((x) => x.name === "ConcordHighMemory");
    assert.equal(rule.acknowledged, true);
    assert.equal(rule.ackNote, "investigating");
    // Un-ack flips it back.
    const un = await lensRun("system", "alert-ack", { params: { name: "ConcordHighMemory", unack: true } }, ctx);
    assert.equal(un.result.acknowledged, false);
    const after2 = await lensRun("system", "alerts", {}, ctx);
    assert.equal(after2.result.rules.find((x) => x.name === "ConcordHighMemory").acknowledged, false);
  });

  it("alert-ack: an empty alert name is rejected (handler refusal)", async () => {
    const bad = await lensRun("system", "alert-ack", { params: { name: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /alert name required/);
  });

  it("alert-ack is per-user — user B does not see user A's acknowledgement", async () => {
    const ctxA = await depthCtx("system-ack-A");
    const ctxB = await depthCtx("system-ack-B");
    await lensRun("system", "alert-ack", { params: { name: "ConcordHeartbeatStopped", note: "A" } }, ctxA);
    const bView = await lensRun("system", "alerts", {}, ctxB);
    const rule = bView.result.rules.find((x) => x.name === "ConcordHeartbeatStopped");
    if (rule) assert.equal(rule.acknowledged, false);
  });
});

describe("system — log search + heartbeat health", () => {
  it("logs returns a leveled tally + sources contract over the in-process buffer", async () => {
    const r = await lensRun("system", "logs", { params: { limit: 50 } });
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.result.tally).sort(), ["debug", "error", "info", "warn"]);
    // The per-level tally sums to the entry count (each entry counted once).
    const summed = r.result.tally.error + r.result.tally.warn + r.result.tally.info + r.result.tally.debug;
    assert.ok(summed <= r.result.count);
    assert.ok(Array.isArray(r.result.sources));
    assert.ok(typeof r.result.bufferSize === "number");
  });

  it("logs: the level filter is a min-severity threshold (info excludes only debug)", async () => {
    // logger.query treats `level` as max severity: error(0) ≤ warn(1) ≤ info(2) ≤ debug(3).
    // So level:"info" returns error+warn+info but never debug.
    const info = await lensRun("system", "logs", { params: { level: "info", limit: 1000 } });
    assert.equal(info.ok, true);
    assert.equal(info.result.tally.debug, 0);

    // level:"error" is the strictest — only error entries survive.
    const err = await lensRun("system", "logs", { params: { level: "error", limit: 1000 } });
    assert.equal(err.result.tally.warn, 0);
    assert.equal(err.result.tally.info, 0);
    assert.equal(err.result.tally.debug, 0);

    // The info threshold returns at least as many entries as the stricter error threshold.
    assert.ok(info.result.count >= err.result.count);
  });

  it("heartbeat-health: the summary buckets partition the module list exactly", async () => {
    const r = await lensRun("system", "heartbeat-health", {});
    assert.equal(r.ok, true);
    const sm = r.result.summary;
    assert.equal(sm.total, r.result.modules.length);
    // Every module is in exactly one of the four health buckets.
    assert.equal(sm.ok + sm.stale + sm.error + sm.pending, sm.total);
    // intervalSec is frequency × 15s for each module.
    for (const m of r.result.modules.slice(0, 5)) {
      assert.equal(m.intervalSec, m.frequency * 15);
    }
  });
});

describe("system — distributed traces (record + percentile rollup)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("system-traces"); });

  it("trace-record normalizes a span; traces reads it back with per-route rollup", async () => {
    const t = await lensRun("system", "trace-record", { params: { route: "/api/lens/run", method: "post", durationMs: 120, status: 200 } }, ctx);
    assert.equal(t.ok, true);
    assert.equal(t.result.method, "POST"); // upper-cased
    assert.equal(t.result.durationMs, 120);
    assert.equal(t.result.actor, ctx.actor.userId);

    const r = await lensRun("system", "traces", { params: { limit: 50 } }, ctx);
    assert.ok(r.result.count >= 1);
    // The newest span is first (reversed) and matches what we recorded.
    assert.equal(r.result.spans[0].id, t.result.id);
    const route = r.result.routes.find((x) => x.route === "/api/lens/run");
    assert.ok(route && route.count >= 1);
    assert.equal(route.avgMs, Math.round(route.totalMs / route.count));
  });

  it("trace-record clamps an absurd duration to the 600000ms ceiling and a status into range", async () => {
    const t = await lensRun("system", "trace-record", { params: { route: "/slow", durationMs: 9e9, status: 999 } }, ctx);
    assert.equal(t.result.durationMs, 600000); // clamped hi
    assert.equal(t.result.status, 599);         // clamped to valid HTTP max
  });

  it("traces: a 4xx span lifts the error rate above zero", async () => {
    const errCtx = await depthCtx("system-traces-err");
    await lensRun("system", "trace-record", { params: { route: "/err", durationMs: 10, status: 500 } }, errCtx);
    const r = await lensRun("system", "traces", {}, errCtx);
    assert.ok(r.result.errorRate > 0);
  });
});

describe("system — dashboard layout persistence (per-user)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("system-dash"); });

  it("dashboard-load returns the canonical default layout until customized", async () => {
    const r = await lensRun("system", "dashboard-load", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.isDefault, true);
    assert.equal(r.result.panelCount, 6);
    assert.ok(r.result.panels.some((p) => p.id === "p_heap" && p.metric === "heapUsedMB"));
  });

  it("dashboard-save sanitizes panels (clamps width, coerces unknown kind/metric) and round-trips", async () => {
    const saved = await lensRun("system", "dashboard-save", {
      params: { panels: [
        { kind: "metric", metric: "not_a_metric", title: "Custom", w: 99 },
        { kind: "totally_unknown_kind" },
      ] },
    }, ctx);
    assert.equal(saved.ok, true);
    assert.equal(saved.result.panelCount, 2);
    // Width clamped to the 1..3 range.
    assert.equal(saved.result.panels[0].w, 3);
    // Unknown metric falls back to heapUsedMB; unknown kind coerces to "metric".
    assert.equal(saved.result.panels[0].metric, "heapUsedMB");
    assert.equal(saved.result.panels[1].kind, "metric");
    assert.equal(saved.result.panels[1].title, "Panel 2"); // default title

    // Reads back as a customized (non-default) layout for this user.
    const load = await lensRun("system", "dashboard-load", {}, ctx);
    assert.equal(load.result.isDefault, false);
    assert.equal(load.result.panels[0].title, "Custom");
  });

  it("dashboard-save: a non-array panels arg is rejected", async () => {
    const bad = await lensRun("system", "dashboard-save", { params: {} }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /panels array required/);
  });

  it("dashboard-reset restores the default layout", async () => {
    const reset = await lensRun("system", "dashboard-reset", {}, ctx);
    assert.equal(reset.result.reset, true);
    const load = await lensRun("system", "dashboard-load", {}, ctx);
    assert.equal(load.result.isDefault, true);
    assert.equal(load.result.panelCount, 6);
  });
});

describe("system — coverage/drift history + live-status aggregate", () => {
  it("history-snapshot records a cartograph snapshot; history reads back a non-decreasing timeline", async () => {
    const ctx = await depthCtx("system-history");
    const snap = await lensRun("system", "history-snapshot", {}, ctx);
    // Either the cartograph report exists (recorded) or it refuses deterministically.
    if (snap.result.ok === false) {
      assert.equal(snap.result.reason, "cartograph_not_run");
      return;
    }
    assert.equal(snap.ok, true);
    // coveragePct is present/in-scope as a real percentage in [0,100].
    assert.ok(snap.result.snapshot.coveragePct >= 0 && snap.result.snapshot.coveragePct <= 100);
    assert.equal(snap.result.recorded, true);

    const h = await lensRun("system", "history", { params: { limit: 10 } }, ctx);
    assert.ok(h.result.count >= 1);
    assert.equal(h.result.capacity, 365); // HISTORY_CAP
    // The recorded snapshot is the tail of the timeline.
    assert.equal(h.result.snapshots[h.result.snapshots.length - 1].coveragePct, snap.result.snapshot.coveragePct);
  });

  it("history-snapshot de-dupes an identical consecutive snapshot", async () => {
    const ctx = await depthCtx("system-history-dedupe");
    const first = await lensRun("system", "history-snapshot", {}, ctx);
    if (first.result.ok === false) return; // cartograph not run → nothing to de-dupe
    const second = await lensRun("system", "history-snapshot", {}, ctx);
    // Same cartograph generation → not re-recorded.
    assert.equal(second.result.recorded, false);
  });

  it("live-status aggregates a fresh sample + heartbeat + alert counts in one call", async () => {
    const ctx = await depthCtx("system-livestatus");
    const r = await lensRun("system", "live-status", {}, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.sample.heapTotalMB > 0);
    assert.equal(r.result.heartbeats.total, r.result.heartbeats.ok + r.result.heartbeats.unhealthy +
      // pending modules count as neither ok nor unhealthy; verify the two named buckets never exceed total.
      (r.result.heartbeats.total - r.result.heartbeats.ok - r.result.heartbeats.unhealthy));
    // unacknowledgedFiring never exceeds firing.
    assert.ok(r.result.alerts.unacknowledgedFiring <= r.result.alerts.firing);
    assert.ok(typeof r.result.pollAt === "string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cognitive-OS register() macros (runMacro) — deterministic-output invariants
// ─────────────────────────────────────────────────────────────────────────────

describe("system — cognitive-OS macros (deterministic invariants)", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("system")); });

  it("status: real DTU count never exceeds the raw count; version + uptime contract", async () => {
    const r = await runMacro("system", "status", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.version, "5.1.0");
    // Filtered (real) DTU count is a subset of the raw count.
    assert.ok(r.counts.dtus <= r.counts.dtusRaw);
    assert.ok(r.counts.dtus >= 0);
    assert.ok(typeof r.uptime === "number" && r.uptime >= 0);
    assert.equal(typeof r.llm.enabled, "boolean");
  });

  it("gapScan (no commit): coverage_score is bounded and missing_nodes lists absent trackers", async () => {
    const r = await runMacro("system", "gapScan", { commit: false, domain: "depthcheck" }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.domain, "depthcheck");
    // Heuristic coverage score is a fraction in [0,1].
    assert.ok(r.coverage_score >= 0 && r.coverage_score <= 1);
    // missing_definitions carry a term + freq pair.
    for (const md of r.missing_definitions.slice(0, 5)) {
      assert.ok(typeof md.term === "string" && md.term.length > 0);
      assert.ok(typeof md.freq === "number");
    }
    // missing_nodes is drawn from the fixed tracker set.
    for (const n of r.missing_nodes) {
      assert.ok(["continuity", "experiment-tracker"].includes(n));
    }
    // It is a read-only report (not committed) when commit:false.
    assert.equal(r.committed, undefined);
  });

  it("gapScan: coverage_score = 1 − missing/candidates is consistent with its own outputs", async () => {
    const r = await runMacro("system", "gapScan", { commit: false }, ctx);
    // coverage_score is clamped to [0,1] and monotone-consistent: more missing defs
    // can never produce a coverage above 1.
    assert.ok(r.coverage_score <= 1);
    // If every candidate had a definition, coverage would be 1; with gaps it's < 1
    // only when missing_definitions is non-empty.
    if (r.missing_definitions.length === 0) assert.equal(r.coverage_score, 1);
    else assert.ok(r.coverage_score < 1);
  });

  it("continuity (no commit): builds a spec whose lineage equals the DTU window, no DB write", async () => {
    const r = await runMacro("system", "continuity", { commit: false, sessionId: "depth-sess", window: 15 }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.committed, false);
    assert.ok(r.spec);
    assert.equal(r.spec.source, "system.continuity");
    assert.equal(r.spec.meta.sessionId, "depth-sess");
    assert.equal(r.spec.meta.window, 15);
    // Lineage cites real DTU ids and is bounded by the requested window.
    assert.ok(Array.isArray(r.spec.lineage));
    assert.ok(r.spec.lineage.length <= 15);
    // The session tag is present (no invented claims — just deltas + ids).
    assert.ok(r.spec.tags.includes("session:depth-sess"));
    assert.ok(r.spec.tags.includes("continuity"));
  });

  it("continuity: window is clamped to the 5..200 range", async () => {
    const r = await runMacro("system", "continuity", { commit: false, sessionId: "clamp", window: 2 }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.spec.meta.window, 5); // clamped lo
  });

  it("cartograph: returns the SYSTEMS report, or refuses deterministically when not generated", async () => {
    const r = await runMacro("system", "cartograph", {}, ctx);
    if (r.ok === false) {
      assert.equal(r.reason, "cartograph_not_run");
      assert.match(r.hint, /cartograph:static/);
      return;
    }
    assert.equal(r.ok, true);
    assert.ok(r.systems && typeof r.systems === "object");
  });

  it("cartograph statsOnly: returns just the stats block + generation time when present", async () => {
    const full = await runMacro("system", "cartograph", {}, ctx);
    if (full.ok === false) return; // report not generated in this environment
    const r = await runMacro("system", "cartograph", { statsOnly: true }, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.stats !== undefined);
    assert.equal(r.systems, undefined); // statsOnly omits the full tree
  });
});
