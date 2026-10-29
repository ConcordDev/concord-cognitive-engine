// Debug domain handler tests (Product Review 2, debug.md — B5 build).
//
// Exercises domains/debug.js directly through its registrar with the
// real guardAnonWrites wrapper, against a shimmed global STATE — the
// same ctx shape the lens-run dispatch builds. The HTTP-level
// acceptance (fresh login → record an exception) lives in
// debug-workspace.test.js; this file proves the domain logic the
// unwall (S1) exposes: per-user workspaces, grouping/regression (S4),
// the release/trace/metric backends (S7/S8), the quartet's params
// input path (S5), and anonymous-write refusal.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerDebugActions from "../domains/debug.js";
import { getNotifications } from "../emergent/social-layer.js";

const handlers = new Map();
before(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  registerDebugActions((domain, action, handler) => {
    handlers.set(`${domain}.${action}`, handler);
  });
});

const call = (action, ctx, params = {}, artifact = null) => {
  const h = handlers.get(`debug.${action}`);
  assert.ok(h, `debug.${action} registered`);
  return h(ctx, artifact, params);
};
const member = (userId) => ({ actor: { userId, role: "member" } });
const ANON = { actor: { userId: "anon", role: "viewer" } };

describe("debug domain (S1 unwalled workspace)", () => {
  it("registers the review's 21 macros plus the build's alert-test and S11 monitors", () => {
    assert.equal(handlers.size, 27);
  });

  it("a normal account ingests, lists, works and deletes its own issue", () => {
    const ctx = member("u_alice");
    const ing = call("issue-ingest", ctx, {
      type: "TypeError",
      message: "Cannot read properties of undefined (reading 'map')",
      culprit: "QueryGrid.tsx:renderRows",
      level: "error",
      stack: "TypeError: x\n    at renderRows (QueryGrid.tsx:42:17)",
      release: "v1.2.0",
    });
    assert.equal(ing.ok, true);
    assert.equal(ing.result.isNew, true);
    const id = ing.result.issue.id;

    const list = call("issue-list", ctx, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.issues[0].stack, undefined, "list strips stack");
    const detail = call("issue-detail", ctx, { id });
    assert.match(detail.result.issue.stack, /renderRows/);

    const upd = call("issue-update", ctx, { id, status: "resolved", assignee: "alice" });
    assert.equal(upd.result.issue.status, "resolved");
    assert.equal(call("issue-delete", ctx, { id }).ok, true);
    assert.equal(call("issue-list", ctx, {}).result.count, 0);
  });

  it("S4: identical errors group; recurrence after resolve reopens as regression", () => {
    const ctx = member("u_bob");
    const payload = { type: "RangeError", message: "Maximum call stack size exceeded in worker 7", culprit: "walk.ts:visit" };
    const a = call("issue-ingest", ctx, payload);
    const b = call("issue-ingest", ctx, { ...payload, message: "Maximum call stack size exceeded in worker 99" });
    assert.equal(a.result.issue.id, b.result.issue.id);
    assert.equal(b.result.issue.count, 2);
    call("issue-update", ctx, { id: a.result.issue.id, status: "resolved" });
    const c = call("issue-ingest", ctx, payload);
    assert.equal(c.result.issue.status, "open");
    assert.equal(c.result.issue.regressed, true);
    assert.equal(c.result.issue.count, 3);
  });

  it("workspaces are per-user", () => {
    const carol = member("u_carol");
    assert.equal(call("issue-list", carol, {}).result.count, 0);
    assert.equal(call("trace-list", carol, {}).result.count, 0);
    assert.equal(call("alert-list", carol, {}).result.count, 0);
    assert.equal(call("release-list", carol, {}).result.count, 0);
    // Cross-user detail access is a miss, not a leak.
    const bobIssue = call("issue-list", member("u_bob"), {}).result.issues[0];
    assert.equal(call("issue-detail", carol, { id: bobIssue.id }).ok, false);
  });

  it("anonymous writes are refused by the domain's own guard; anon reads see an empty bucket", () => {
    const w = call("issue-ingest", ANON, { type: "Error", message: "anon attempt" });
    assert.equal(w.ok, false);
    assert.equal(w.error, "auth_required");
    assert.equal(call("issue-list", ANON, {}).result.count, 0);
  });

  it("S7/S8 backends: release annotation, trace waterfall, metric series", () => {
    const ctx = member("u_dana");
    const rel = call("release-create", ctx, { version: "v2.0.0", environment: "production" });
    assert.equal(rel.ok, true);
    call("issue-ingest", ctx, { type: "Error", message: "boom in v2", release: "v2.0.0" });
    const rels = call("release-list", ctx, {});
    assert.equal(rels.result.releases[0].issueCount, 1);
    assert.equal(rels.result.releases[0].openIssues, 1);
    assert.equal(call("release-delete", ctx, { id: rel.result.release.id }).ok, true);

    const tr = call("trace-record", ctx, {
      name: "lens-run",
      spans: [
        { spanId: "a", name: "http", service: "web", startMs: 0, endMs: 100 },
        { spanId: "b", parentId: "a", name: "solve", service: "conkay", startMs: 10, endMs: 60, status: "error" },
      ],
    });
    assert.equal(tr.ok, true);
    assert.equal(tr.result.trace.errorCount, 1);
    assert.equal(tr.result.trace.spans[1].depth, 1);
    assert.equal(call("trace-detail", ctx, { id: tr.result.trace.id }).result.serviceBreakdown.length, 2);

    call("metric-record", ctx, { metric: "heap_used_mb", value: 512, unit: "MB" });
    call("metric-record", ctx, { metric: "heap_used_mb", value: 640, unit: "MB" });
    const series = call("metric-series", ctx, { metric: "heap_used_mb" });
    assert.equal(series.result.stats.count, 2);
    assert.equal(series.result.stats.max, 640);
  });

  it("S6: alert rules reach the owner as Concord notifications, deduped by transition/event", () => {
    const ctx = member("u_frank");
    const notifs = () => getNotifications(globalThis._concordSTATE, "u_frank", { limit: 50 })
      .notifications.filter((n) => n.type === "debug_alert");

    // Metric rule: fires on the ok→alerting transition only.
    const mr = call("alert-create", ctx, { name: "Heap high", metric: "heap_used_mb", op: ">", threshold: 100, severity: "critical" });
    assert.equal(mr.ok, true);
    assert.equal(mr.result.rule.channel, "notifications");
    call("metric-record", ctx, { metric: "heap_used_mb", value: 150 });
    assert.equal(notifs().length, 1);
    assert.match(notifs()[0].content, /Heap high/);
    assert.match(notifs()[0].content, /150/);
    call("metric-record", ctx, { metric: "heap_used_mb", value: 160 });
    assert.equal(notifs().length, 1, "still alerting — no duplicate notification");
    call("metric-record", ctx, { metric: "heap_used_mb", value: 50 });
    call("metric-record", ctx, { metric: "heap_used_mb", value: 170 });
    assert.equal(notifs().length, 2, "recovery + new breach notifies again");

    // Issue rule: fires once, at creation.
    call("alert-create", ctx, { name: "Any new issue", kind: "issue" });
    call("issue-ingest", ctx, { type: "Error", message: "fresh splat" });
    assert.equal(notifs().length, 3);
    call("issue-ingest", ctx, { type: "Error", message: "fresh splat" });
    assert.equal(notifs().length, 3, "repeat occurrence of the same issue does not re-notify");

    // Regression rule: fires on the reopen transition.
    call("alert-create", ctx, { name: "Regressions", kind: "regression" });
    const issue = call("issue-list", ctx, {}).result.issues[0];
    call("issue-update", ctx, { id: issue.id, status: "resolved" });
    call("issue-ingest", ctx, { type: "Error", message: "fresh splat" });
    assert.equal(notifs().length, 4);
    assert.match(notifs()[0].content, /Regression/);

    // Test-fire proves the channel on demand.
    const t = call("alert-test", ctx, { id: mr.result.rule.id });
    assert.equal(t.ok, true);
    assert.equal(t.result.delivered, true);
    assert.equal(notifs().length, 5);
    assert.match(notifs()[0].content, /Test notification/);
  });

  it("S11: uptime monitors probe real URLs, keep history, and notify on down/recovery", async () => {
    const { createServer } = await import("node:http");
    let targetUp = true;
    const target = createServer((req, res) => {
      res.writeHead(targetUp ? 200 : 503, { "Content-Type": "text/plain" });
      res.end(targetUp ? "ok" : "bad");
    });
    await new Promise((r) => target.listen(0, "127.0.0.1", r));
    const port = target.address().port;
    try {
      const ctx = member("u_grace");
      const notifs = () => getNotifications(globalThis._concordSTATE, "u_grace", { limit: 50 })
        .notifications.filter((n) => n.type === "debug_alert");

      const bad = call("monitor-create", ctx, { name: "Nope", url: "ftp://example.com" });
      assert.equal(bad.ok, false);
      const meta = call("monitor-create", ctx, { name: "Meta", url: "http://169.254.169.254/latest" });
      assert.equal(meta.ok, false);

      const mon = call("monitor-create", ctx, { name: "Local target", url: `http://127.0.0.1:${port}/health`, intervalMinutes: 5 });
      assert.equal(mon.ok, true);
      assert.equal(mon.result.monitor.status, "unknown");

      const c1 = await call("monitor-check", ctx, { id: mon.result.monitor.id });
      assert.equal(c1.ok, true);
      assert.equal(c1.result.results[0].ok, true);
      let list = call("monitor-list", ctx, {});
      assert.equal(list.result.monitors[0].status, "up");
      assert.equal(list.result.monitors[0].history.length, 1);
      assert.equal(notifs().length, 0, "first check establishes state without notifying");

      targetUp = false;
      await call("monitor-check", ctx, { id: mon.result.monitor.id });
      list = call("monitor-list", ctx, {});
      assert.equal(list.result.monitors[0].status, "down");
      assert.equal(list.result.down, 1);
      assert.equal(notifs().length, 1);
      assert.match(notifs()[0].content, /DOWN/);

      await call("monitor-check", ctx, { id: mon.result.monitor.id });
      assert.equal(notifs().length, 1, "staying down does not re-notify");

      targetUp = true;
      await call("monitor-check", ctx, { id: mon.result.monitor.id });
      assert.equal(notifs().length, 2);
      assert.match(notifs()[0].content, /recovered/);
      assert.equal(call("monitor-list", ctx, {}).result.monitors[0].history.length, 4);

      assert.equal(call("monitor-delete", ctx, { id: mon.result.monitor.id }).ok, true);
      assert.equal(call("monitor-list", ctx, {}).result.count, 0);
    } finally {
      target.close();
    }
  });

  it("S5: the quartet answers from params input and names its contents", () => {
    const ctx = member("u_erin");
    const now = new Date().toISOString();
    const logs = call("logAnalysis", ctx, {
      logs: [
        { timestamp: now, level: "error", message: "frobnicate failed for widget", source: "api" },
        { timestamp: now, level: "error", message: "frobnicate failed for widget", source: "api" },
        { timestamp: now, level: "info", message: "boot ok", source: "api" },
      ],
    });
    assert.equal(logs.ok, true);
    assert.equal(logs.result.totalLogs, 3);
    assert.equal(logs.result.levelDistribution.error, 2);

    const clusters = call("errorCluster", ctx, {
      errors: [
        { message: "frobnicate failed for widget", count: 2 },
        { message: "frobnicate failed for widget", count: 1 },
        { message: "unrelated splat", count: 1 },
      ],
    });
    assert.equal(clusters.ok, true);
    assert.equal(clusters.result.totalErrors, 3);

    const stack = call("stackTraceAnalysis", ctx, {
      stackTraces: [
        { error: "TypeError: frobnicate failed", stack: "TypeError: frobnicate failed\n    at doFrob (src/frob.ts:12:5)\n    at main (src/main.ts:3:1)" },
      ],
    });
    assert.equal(stack.ok, true);
    assert.equal(stack.result.totalTraces, 1);
    // The artifact path still works exactly as before.
    const viaArtifact = call("logAnalysis", ctx, {}, { data: { logs: [{ timestamp: now, level: "info", message: "x" }] } });
    assert.equal(viaArtifact.result.totalLogs, 1);
  });
});
