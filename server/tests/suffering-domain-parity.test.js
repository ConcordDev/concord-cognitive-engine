// Contract tests for server/domains/suffering.js parity-sprint macros —
// pain-point board, theming, intervention tracking, trend view,
// evidence attachments, root-cause tree, and report export.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSufferingActions from "../domains/suffering.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`suffering.${name}`);
  if (!fn) throw new Error(`suffering.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSufferingActions(register); });

beforeEach(() => {
  // Fresh per-user state for every test.
  globalThis._concordSTATE = {};
});

const ctx = { actor: { userId: "suf_user" }, userId: "suf_user" };

describe("suffering — pain-point board", () => {
  it("creates, lists, updates, deletes pain points", () => {
    const created = call("pain-create", ctx, { title: "Slow load times", severity: 8, frequency: 7, impact: 9, effort: 4 });
    assert.equal(created.ok, true);
    const id = created.result.pain.id;

    const listed = call("pain-list", ctx, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.count, 1);
    assert.ok(listed.result.pains[0].priorityScore > 0);

    const updated = call("pain-update", ctx, { id, status: "in_progress", severity: 9 });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.pain.status, "in_progress");
    assert.equal(updated.result.pain.severity, 9);

    const deleted = call("pain-delete", ctx, { id });
    assert.equal(deleted.ok, true);
    assert.equal(call("pain-list", ctx, {}).result.count, 0);
  });

  it("rejects pain create without title", () => {
    const r = call("pain-create", ctx, {});
    assert.equal(r.ok, false);
  });

  it("builds an impact/effort priority matrix with quadrants", () => {
    call("pain-create", ctx, { title: "Quick win bug", severity: 9, frequency: 9, impact: 9, effort: 2 });
    call("pain-create", ctx, { title: "Big rework", severity: 9, frequency: 9, impact: 9, effort: 9 });
    const r = call("priority-matrix", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.summary.quickWins, 1);
    assert.equal(r.result.summary.majorProjects, 1);
  });
});

describe("suffering — theming / clustering", () => {
  it("creates themes and counts member pains", () => {
    const theme = call("theme-create", ctx, { name: "Performance" });
    assert.equal(theme.ok, true);
    const tid = theme.result.theme.id;
    call("pain-create", ctx, { title: "Lag", themeId: tid });
    const list = call("theme-list", ctx, {});
    assert.equal(list.result.themes[0].painCount, 1);
  });

  it("deleting a theme orphans its pains", () => {
    const tid = call("theme-create", ctx, { name: "T" }).result.theme.id;
    const pid = call("pain-create", ctx, { title: "P", themeId: tid }).result.pain.id;
    call("theme-delete", ctx, { id: tid });
    const pains = call("pain-list", ctx, {}).result.pains;
    assert.equal(pains.find((p) => p.id === pid).themeId, null);
  });

  it("auto-clusters pains by keyword overlap", () => {
    call("pain-create", ctx, { title: "checkout payment fails", description: "payment error checkout" });
    call("pain-create", ctx, { title: "payment checkout broken", description: "checkout payment timeout" });
    const r = call("theme-autocluster", ctx, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.clusterCount >= 1);
  });
});

describe("suffering — evidence attachments", () => {
  it("adds and removes evidence on a pain", () => {
    const pid = call("pain-create", ctx, { title: "Confusing UI" }).result.pain.id;
    const added = call("evidence-add", ctx, { painId: pid, quote: "I cannot find the button", source: "user 42" });
    assert.equal(added.ok, true);
    assert.equal(added.result.evidence.length, 1);
    const evId = added.result.evidence[0].id;
    const removed = call("evidence-remove", ctx, { painId: pid, evidenceId: evId });
    assert.equal(removed.result.evidence.length, 0);
  });

  it("rejects evidence without a quote", () => {
    const pid = call("pain-create", ctx, { title: "X" }).result.pain.id;
    assert.equal(call("evidence-add", ctx, { painId: pid }).ok, false);
  });
});

describe("suffering — intervention tracking", () => {
  it("tracks an intervention through status transitions", () => {
    const pid = call("pain-create", ctx, { title: "Bug" }).result.pain.id;
    const created = call("intervention-track", ctx, { title: "Add caching", painId: pid });
    assert.equal(created.ok, true);
    const id = created.result.intervention.id;

    const updated = call("intervention-update", ctx, { id, status: "completed", resolvePain: true });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.intervention.progress, 100);
    assert.ok(updated.result.intervention.history.length >= 2);

    // resolvePain cascade resolved the linked pain.
    const pain = call("pain-list", ctx, {}).result.pains.find((p) => p.id === pid);
    assert.equal(pain.status, "resolved");

    const list = call("intervention-list", ctx, {});
    assert.equal(list.result.byStatus.completed, 1);

    assert.equal(call("intervention-delete", ctx, { id }).ok, true);
  });
});

describe("suffering — trend view", () => {
  it("records snapshots and reports trend direction", () => {
    call("pain-create", ctx, { title: "A", severity: 9, frequency: 9, impact: 9 });
    const s1 = call("snapshot-record", ctx, {});
    assert.equal(s1.ok, true);
    call("pain-create", ctx, { title: "B", severity: 9, frequency: 9, impact: 9 });
    call("snapshot-record", ctx, {});
    const trend = call("trend-view", ctx, {});
    assert.equal(trend.ok, true);
    assert.equal(trend.result.count, 2);
    assert.equal(trend.result.direction, "worsening");
  });
});

describe("suffering — root-cause tree", () => {
  it("builds a 5-whys tree and fishbone for a pain", () => {
    const pid = call("pain-create", ctx, { title: "Outage" }).result.pain.id;
    const r = call("root-cause-tree", ctx, {
      painId: pid,
      causes: [
        { id: "c1", description: "Server crashed", category: "technology", probability: 0.8 },
        { id: "c2", description: "No autoscale", parentId: "c1", category: "process", probability: 0.7 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.tree.length, 1);
    assert.equal(r.result.tree[0].children.length, 1);
    assert.ok(r.result.rootCauses.length >= 1);
    assert.ok(Object.keys(r.result.fishbone).length >= 1);
  });

  it("rejects a tree for an unknown pain", () => {
    assert.equal(call("root-cause-tree", ctx, { painId: "nope" }).ok, false);
  });
});

describe("suffering — report export", () => {
  it("exports json and markdown reports", () => {
    call("pain-create", ctx, { title: "Latency", severity: 7 });
    const json = call("export-report", ctx, { format: "json" });
    assert.equal(json.ok, true);
    assert.equal(json.result.format, "json");
    assert.equal(json.result.report.pains.length, 1);

    const md = call("export-report", ctx, { format: "markdown" });
    assert.equal(md.ok, true);
    assert.match(md.result.markdown, /Pain-Point Analysis Report/);
  });
});
