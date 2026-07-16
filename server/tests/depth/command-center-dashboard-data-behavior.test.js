// tests/depth/command-center-dashboard-data-behavior.test.js — REAL
// behavioral tests for command-center's `dashboardData` macro, closing
// docs/WAVE4_INVENTORY.md row 135 ("saveDashboard stores a panel-id list,
// not a live composable widget grid").
//
// Scope pinned here: `saveDashboard` was already honest — it stores a
// freeform list of `{type, id}` widget descriptors and the UI never claimed
// to render them back as a live grid. `dashboardData` is the missing REAL
// capability: given a saved dashboard, resolve each widget id against this
// domain's actual data sources (recorded vital-metric series via the same
// logic `vitalHistory` uses, and alert rules via the same state `listAlertRules`
// reads) and report real current data per widget — or an honest per-widget
// error when the id matches no real source. Nothing here fabricates data.
//
// NB: lens.run wraps a handler's {ok:false,error} as {ok:true, result:{ok:false,error}}
// — the OUTER ok is dispatch success; the handler's verdict is in result.ok
// only when it failed. A successful handler's own {ok:true, result:{...}} is
// unwrapped one level, so a passing call's real payload is at `r.result.<field>`
// directly (no `r.result.ok`).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("command-center — dashboardData (live widget grid resolution)", () => {
  let ctx;
  before(async () => {
    ctx = await depthCtx("command-center-dashboard-data");
  });

  it("resolves a real vital-metric widget to actual recorded data, matching vitalHistory", async () => {
    await lensRun("command-center", "recordVital", { params: { metric: "heap_mb", value: 100 } }, ctx);
    await lensRun("command-center", "recordVital", { params: { metric: "heap_mb", value: 180 } }, ctx);
    await lensRun("command-center", "recordVital", { params: { metric: "heap_mb", value: 140 } }, ctx);

    const dash = await lensRun("command-center", "saveDashboard", {
      params: { name: "Ops overview", widgets: [{ type: "panel", id: "heap_mb" }] },
    }, ctx);
    assert.equal(dash.ok, true);
    const dashboardId = dash.result.dashboard.id;

    const data = await lensRun("command-center", "dashboardData", { params: { dashboardId } }, ctx);
    assert.equal(data.ok, true);
    assert.equal(data.result.dashboardId, dashboardId);
    assert.equal(data.result.name, "Ops overview");
    assert.equal(data.result.count, 1);
    assert.equal(data.result.resolvedCount, 1);
    assert.equal(data.result.unresolvedCount, 0);

    const widget = data.result.widgets[0];
    assert.equal(widget.id, "heap_mb");
    assert.equal(widget.type, "panel");
    assert.equal(widget.error, undefined);
    assert.equal(widget.kind, "vital");
    // Assert against the ACTUAL recorded values, not just "it returned something".
    assert.equal(widget.data.metric, "heap_mb");
    assert.equal(widget.data.count, 3);
    assert.equal(widget.data.stats.min, 100);
    assert.equal(widget.data.stats.max, 180);
    assert.equal(widget.data.stats.latest, 140);
    assert.equal(widget.data.points.length, 3);
    assert.deepEqual(widget.data.points.map((p) => p.v), [100, 180, 140]);

    // Cross-check against the standalone vitalHistory macro this resolver
    // reuses — the two must agree bit-for-bit on stats for the same window.
    const direct = await lensRun("command-center", "vitalHistory", {
      params: { metric: "heap_mb", windowMinutes: 1440, maxPoints: 240 },
    }, ctx);
    assert.deepEqual(widget.data.stats, direct.result.stats);
  });

  it("resolves a real alert-rule widget to actual rule state", async () => {
    const rule = await lensRun("command-center", "createAlertRule", {
      params: { name: "Heap high", metric: "heap_mb", comparator: "gt", threshold: 150, severity: "high" },
    }, ctx);
    assert.equal(rule.ok, true);
    const ruleId = rule.result.rule.id;
    // heap_mb's latest recorded value (140, from the previous test in this
    // shared ctx) is below the 150 threshold, so this rule is not breaching.

    const dash = await lensRun("command-center", "saveDashboard", {
      params: { name: "Alerting view", widgets: [{ type: "panel", id: ruleId }] },
    }, ctx);
    const dashboardId = dash.result.dashboard.id;

    const data = await lensRun("command-center", "dashboardData", { params: { dashboardId } }, ctx);
    assert.equal(data.result.resolvedCount, 1);
    const widget = data.result.widgets[0];
    assert.equal(widget.kind, "alert-rule");
    assert.equal(widget.error, undefined);
    assert.equal(widget.data.ruleId, ruleId);
    assert.equal(widget.data.name, "Heap high");
    assert.equal(widget.data.metric, "heap_mb");
    assert.equal(widget.data.threshold, 150);
    assert.equal(widget.data.severity, "high");
  });

  it("honestly reports a per-widget error for a bogus/stale panel id, without breaking the rest of the response", async () => {
    const dash = await lensRun("command-center", "saveDashboard", {
      params: {
        name: "Mixed dashboard",
        widgets: [
          { type: "panel", id: "heap_mb" },
          { type: "panel", id: "totally_made_up_metric_xyz" },
        ],
      },
    }, ctx);
    const dashboardId = dash.result.dashboard.id;

    const data = await lensRun("command-center", "dashboardData", { params: { dashboardId } }, ctx);
    assert.equal(data.ok, true);
    assert.equal(data.result.count, 2);
    assert.equal(data.result.resolvedCount, 1);
    assert.equal(data.result.unresolvedCount, 1);

    const good = data.result.widgets.find((w) => w.id === "heap_mb");
    assert.equal(good.error, undefined);
    assert.ok(good.data);

    const bad = data.result.widgets.find((w) => w.id === "totally_made_up_metric_xyz");
    assert.equal(bad.data, null);
    assert.equal(typeof bad.error, "string");
    assert.match(bad.error, /no data source/);
    // Never a fabricated placeholder graph for the unresolvable widget.
    assert.equal(bad.kind, undefined);
  });

  it("honestly rejects a bogus dashboardId", async () => {
    const data = await lensRun("command-center", "dashboardData", { params: { dashboardId: "dash_does_not_exist" } }, ctx);
    assert.equal(data.ok, true); // dispatch succeeded
    assert.equal(data.result.ok, false); // handler-level rejection
    assert.equal(data.result.error, "dashboard_not_found");
  });

  it("rejects a missing dashboardId param", async () => {
    const data = await lensRun("command-center", "dashboardData", { params: {} }, ctx);
    assert.equal(data.result.ok, false);
    assert.equal(data.result.error, "dashboardId_required");
  });

  it("returns an honest empty widgets array for a dashboard saved with no widgets — not an error", async () => {
    const dash = await lensRun("command-center", "saveDashboard", {
      params: { name: "Empty layout", widgets: [] },
    }, ctx);
    const dashboardId = dash.result.dashboard.id;

    const data = await lensRun("command-center", "dashboardData", { params: { dashboardId } }, ctx);
    assert.equal(data.ok, true);
    assert.equal(data.result.error, undefined);
    assert.deepEqual(data.result.widgets, []);
    assert.equal(data.result.count, 0);
    assert.equal(data.result.resolvedCount, 0);
    assert.equal(data.result.unresolvedCount, 0);
  });

  it("per-user isolation: another user cannot resolve this user's dashboard", async () => {
    const dash = await lensRun("command-center", "saveDashboard", {
      params: { name: "Private view", widgets: [{ type: "panel", id: "heap_mb" }] },
    }, ctx);
    const dashboardId = dash.result.dashboard.id;

    const otherCtx = await depthCtx("command-center-dashboard-data-other-user");
    const data = await lensRun("command-center", "dashboardData", { params: { dashboardId } }, otherCtx);
    assert.equal(data.result.ok, false);
    assert.equal(data.result.error, "dashboard_not_found");

    // Confirm the owning user can still resolve it — the rejection above is
    // real per-user scoping, not a general bug.
    const ownerData = await lensRun("command-center", "dashboardData", { params: { dashboardId } }, ctx);
    assert.equal(ownerData.result.count, 1);
  });
});
