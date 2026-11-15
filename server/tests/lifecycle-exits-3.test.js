// CB-0521 server pins — lifecycle exits third leg + feed history.
// FIX-security-010 (rule-update) · FIX-graph-008 (node-update propagates
// to the linked DTU) · FIX-hr-004 (offboard closes open onboarding
// tasks) · FIX-fork-011 view leg (feed-list reads its own mint back).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSecurity from "../domains/security.js";
import registerGraph from "../domains/graph.js";
import registerHr from "../domains/hr.js";
import registerFork from "../domains/fork.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
async function call(domain, name, ctx, params = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name} not registered`);
  return await fn(ctx, { id: null, domain, type: "domain_action", data: params, meta: {} }, params);
}

before(() => {
  registerSecurity(register);
  registerGraph(register);
  registerHr(register);
  registerFork(register);
});
beforeEach(() => { globalThis._concordSTATE = {}; });

const u1 = { actor: { userId: "u1" } };
const u2 = { actor: { userId: "u2" } };

describe("FIX-security-010 — detection rules are editable", () => {
  it("rule-update changes the sent fields and leaves the rest", async () => {
    const added = await call("security", "rule-add", u1, { name: "Brute force", pattern: "failed login", threshold: 3 });
    assert.equal(added.ok, true);
    const id = added.result.rule.id;
    const upd = await call("security", "rule-update", u1, { id, name: "Brute force SSH", threshold: 5 });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.rule.name, "Brute force SSH");
    assert.equal(upd.result.rule.threshold, 5);
    assert.equal(upd.result.rule.pattern, "failed login");
    const list = await call("security", "rule-list", u1, {});
    assert.equal(list.result.rules[0].name, "Brute force SSH");
  });

  it("rule-update refuses an empty name, an unknown id, and another actor's rule", async () => {
    const added = await call("security", "rule-add", u1, { name: "R", pattern: "p" });
    const id = added.result.rule.id;
    const empty = await call("security", "rule-update", u1, { id, name: "   " });
    assert.equal(empty.ok, false);
    assert.match(empty.error, /rule name required/);
    const missing = await call("security", "rule-update", u1, { id: "nope", name: "X" });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /rule not found/);
    const foreign = await call("security", "rule-update", u2, { id, name: "Hijack" });
    assert.equal(foreign.ok, false);
    assert.match(foreign.error, /rule not found/);
  });
});

describe("FIX-graph-008 — editing a DTU-linked node updates the DTU", () => {
  it("node-update propagates label and notes to the linked DTU in the same write", async () => {
    const map = await call("graph", "map-create", u1, { title: "M" });
    const mapId = map.result.map.id;
    const node = await call("graph", "node-add", u1, { mapId, label: "Alpha", notes: "first notes" });
    const nodeId = node.result.node.id;
    // Link the node to a real DTU in the store (the shipped suite's shape;
    // the server owns STATE.dtus, the harness seeds it).
    const dtuId = "dtu_alpha";
    if (!(globalThis._concordSTATE.dtus instanceof Map)) globalThis._concordSTATE.dtus = new Map();
    globalThis._concordSTATE.dtus.set(dtuId, { id: dtuId, title: "Alpha", content: "first notes", human: { summary: "first notes" }, ownerId: "u1" });
    const link = await call("graph", "link-node-dtu", u1, { mapId, nodeId, dtuId });
    assert.equal(link.ok, true);
    const before = globalThis._concordSTATE.dtus.get(dtuId);
    assert.ok(before, "the backing DTU is in the store");
    const upd = await call("graph", "node-update", u1, { mapId, nodeId, label: "Alpha Prime", notes: "revised notes" });
    assert.equal(upd.ok, true);
    const after = globalThis._concordSTATE.dtus.get(dtuId);
    assert.equal(after.title, "Alpha Prime");
    assert.equal(after.content, "revised notes");
    if (after.human && typeof after.human === "object") assert.equal(after.human.summary, "revised notes");
  });

  it("an unlinked node still edits cleanly (graph-only degradation)", async () => {
    const map = await call("graph", "map-create", u1, { title: "M2" });
    const mapId = map.result.map.id;
    const node = await call("graph", "node-add", u1, { mapId, label: "Solo" });
    const nodeId = node.result.node.id;
    // Sever the link the way a legacy node presents.
    for (const list of globalThis._concordSTATE.graphLens.maps.values()) {
      for (const m of list) for (const n of m.nodes) if (n.id === nodeId) delete n.dtuId;
    }
    const upd = await call("graph", "node-update", u1, { mapId, nodeId, label: "Solo Renamed" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.node.label, "Solo Renamed");
  });
});

describe("FIX-hr-004 — offboarding closes the open onboarding checklist", () => {
  it("open tasks close with the offboard; other employees' tasks are untouched; rehire does not resurrect", async () => {
    const emp = await call("hr", "employee-add", u1, { name: "Pat Departing" });
    const empId = emp.result.employee.id;
    const other = await call("hr", "employee-add", u1, { name: "Sam Staying" });
    const otherId = other.result.employee.id;
    await call("hr", "onboarding-task-add", u1, { employeeId: empId, task: "Collect laptop" });
    await call("hr", "onboarding-task-add", u1, { employeeId: empId, task: "Revoke badges" });
    await call("hr", "onboarding-task-add", u1, { employeeId: otherId, task: "Book training" });
    const done = await call("hr", "onboarding-task-add", u1, { employeeId: empId, task: "Sign NDA" });
    await call("hr", "onboarding-complete", u1, { id: done.result.task.id });

    const off = await call("hr", "employee-offboard", u1, { id: empId });
    assert.equal(off.ok, true);
    assert.equal(off.result.onboardingClosed, 2);
    const list = await call("hr", "onboarding-list", u1, { employeeId: empId });
    const tasks = list.result.tasks || list.result.onboarding || [];
    assert.ok(tasks.every((t) => t.done), "no open task survives the offboard");
    const closed = tasks.filter((t) => t.closedReason === "offboarded");
    assert.equal(closed.length, 2);
    const otherList = await call("hr", "onboarding-list", u1, { employeeId: otherId });
    const otherTasks = otherList.result.tasks || otherList.result.onboarding || [];
    assert.equal(otherTasks.filter((t) => !t.done).length, 1, "the staying employee's task stays open");

    const re = await call("hr", "employee-offboard", u1, { id: empId, rehire: true });
    assert.equal(re.ok, true);
    const list2 = await call("hr", "onboarding-list", u1, { employeeId: empId });
    const tasks2 = list2.result.tasks || list2.result.onboarding || [];
    assert.ok(tasks2.every((t) => t.done), "rehire does not resurrect the closed list");
  });
});

describe("FIX-fork-011 — feed-list reads the lens's own ingest back", () => {
  const feedCtx = {
    actor: { userId: "u1" },
    macro: {
      run: async (domain, action) => {
        assert.equal(domain, "dtu");
        assert.equal(action, "list");
        return { ok: true, dtus: [
          { id: "d1", title: "Push on nodejs/node by octocat", source: "github-events-feed", createdAt: "2026-11-10T00:00:00Z", meta: { repo: "nodejs/node", type: "PushEvent", actor: "octocat", createdAt: "2026-11-10T00:00:00Z" } },
          { id: "d2", title: "Issues on nodejs/node by hubot", source: "github-events-feed", createdAt: "2026-11-12T00:00:00Z", meta: { repo: "nodejs/node", type: "IssuesEvent", actor: "hubot", createdAt: "2026-11-12T00:00:00Z" } },
          { id: "d3", title: "Cereal yield", source: "worldbank-feed", createdAt: "2026-11-11T00:00:00Z", meta: {} },
        ] };
      },
    },
  };

  it("returns only the github-events-feed DTUs, newest first, with their event faces", async () => {
    const r = await call("fork", "feed-list", feedCtx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.deepEqual(r.result.items.map((i) => i.id), ["d2", "d1"]);
    assert.equal(r.result.items[0].repo, "nodejs/node");
    assert.equal(r.result.items[0].actor, "hubot");
  });
});
