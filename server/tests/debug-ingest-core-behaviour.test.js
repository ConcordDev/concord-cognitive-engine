// The one grouping core (ingestIssueCore in server/domains/debug.js) serves BOTH
// the issue-ingest macro and the public envelope endpoint (debugIngest.ingestEvent).
// The per-user issue cap and the issue/regression alert firing live IN the core, so
// the unauthenticated-ish envelope feed is bounded and alerts the same way the macro
// does. (The cap is read at import, so the env is set before the dynamic import.)

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.CONCORD_DEBUG_MAX_ISSUES = "10"; // module floor is 10

const { default: registerDebugActions, debugIngest } = await import("../domains/debug.js");
const { getNotifications } = await import("../emergent/social-layer.js");

const ACTIONS = new Map();
before(() => { registerDebugActions((d, n, fn) => ACTIONS.set(`${d}.${n}`, fn)); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const call = (name, ctx, params = {}) => ACTIONS.get(`debug.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
const member = (userId) => ({ actor: { userId, role: "member" }, userId });
const fields = (message, extra = {}) => ({
  type: "Error", message, culprit: null, level: "error", release: null, stack: null, breadcrumbs: [], ...extra,
});
const notifs = (userId) => getNotifications(globalThis._concordSTATE, userId, { limit: 100 })
  .notifications.filter((n) => n.type === "debug_alert");
const issues = (ctx) => call("issue-list", ctx, {}).result.issues;

describe("ingestIssueCore: envelope endpoint path (debugIngest.ingestEvent)", () => {
  it("fires the issue rule once per new issue, not on repeats", () => {
    const ctx = member("core_ada");
    assert.equal(call("alert-create", ctx, { name: "Any new issue", kind: "issue" }).ok, true);
    const first = debugIngest.ingestEvent("core_ada", undefined, fields("boom via envelope"));
    assert.equal(first.ok, true);
    assert.equal(first.result.isNew, true);
    assert.equal(notifs("core_ada").length, 1);
    assert.match(notifs("core_ada")[0].content, /New issue/);
    const again = debugIngest.ingestEvent("core_ada", undefined, fields("boom via envelope"));
    assert.equal(again.result.isNew, false);
    assert.equal(notifs("core_ada").length, 1, "repeat occurrence does not re-notify");
  });

  it("fires the regression rule once on resolved -> open, not on later repeats", () => {
    const ctx = member("core_bob");
    call("alert-create", ctx, { name: "Regressions", kind: "regression" });
    debugIngest.ingestEvent("core_bob", undefined, fields("flaky"));
    call("issue-update", ctx, { id: issues(ctx)[0].id, status: "resolved" });
    debugIngest.ingestEvent("core_bob", undefined, fields("flaky"));
    assert.equal(notifs("core_bob").length, 1);
    assert.match(notifs("core_bob")[0].content, /Regression/);
    debugIngest.ingestEvent("core_bob", undefined, fields("flaky"));
    assert.equal(notifs("core_bob").length, 1, "already open: no second regression alert");
  });

  it("alerts go to the userId passed to the core (the key owner), not an ambient actor", () => {
    const owner = member("core_owner");
    call("alert-create", owner, { name: "Any new issue", kind: "issue" });
    debugIngest.ingestEvent("core_owner", undefined, fields("owned"));
    assert.equal(notifs("core_owner").length, 1);
    assert.equal(notifs("someone_else").length, 0);
  });

  it("is capped per user: floods of distinct events cannot grow STATE without limit", () => {
    const ctx = member("core_cap");
    for (let i = 0; i < 40; i++) debugIngest.ingestEvent("core_cap", undefined, fields(`flood${i}`));
    assert.equal(issues(ctx).length, 10);
  });

  it("eviction drops resolved issues before open ones, and keeps the newest", () => {
    const ctx = member("core_evict");
    for (let i = 0; i < 10; i++) debugIngest.ingestEvent("core_evict", undefined, fields(`e${i}`));
    const keep = issues(ctx).find((x) => x.message === "e3");
    for (const x of issues(ctx)) if (x.message !== "e3") call("issue-update", ctx, { id: x.id, status: "resolved" });
    debugIngest.ingestEvent("core_evict", undefined, fields("newest"));
    const msgs = issues(ctx).map((x) => x.message);
    assert.equal(msgs.length, 10);
    assert.ok(msgs.includes("newest"));
    assert.ok(msgs.includes("e3"), "the one open issue survives while resolved ones are evicted");
    assert.equal(issues(ctx).find((x) => x.id === keep.id).status, "open");
  });
});

describe("ingestIssueCore: the macro gets the same behaviour", () => {
  it("issue-ingest is capped and fires the issue rule once", () => {
    const ctx = member("core_macro");
    call("alert-create", ctx, { name: "Any new issue", kind: "issue" });
    call("issue-ingest", ctx, { type: "Error", message: "m0" });
    call("issue-ingest", ctx, { type: "Error", message: "m0" });
    assert.equal(notifs("core_macro").length, 1);
    for (let i = 1; i < 30; i++) call("issue-ingest", ctx, { type: "Error", message: `m${i}` });
    assert.equal(issues(ctx).length, 10);
  });
});
