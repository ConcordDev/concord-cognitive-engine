// Contract tests for server/domains/organ.js — pure-math analysis macros
// plus the STATE-backed ChartHop-parity org-design substrate (roster CRUD,
// HRIS import, visual chart tree, drag-reassign, comp rollups, headcount
// scenarios, tenure/attrition, dated org snapshots + diffs).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerOrganActions from "../domains/organ.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`organ.${name}`);
  if (!fn) throw new Error(`organ.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
function callWithArtifact(name, ctx, artifact, params = {}) {
  const fn = ACTIONS.get(`organ.${name}`);
  if (!fn) throw new Error(`organ.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerOrganActions(register); });

const ctxA = { actor: { userId: "organ_user_a" }, userId: "organ_user_a" };
const ctxB = { actor: { userId: "organ_user_b" }, userId: "organ_user_b" };

beforeEach(() => {
  // Fresh per-user STATE for each test for isolation.
  globalThis._concordSTATE = {};
});

describe("organ analytical macros (pure-compute)", () => {
  it("orgChart computes span, depth, flatness, bottlenecks", () => {
    const employees = [
      { id: "ceo", name: "CEO", managerId: null },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, name: `E${i}`, managerId: "ceo" })),
    ];
    const r = callWithArtifact("orgChart", ctxA, { data: { employees } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalEmployees, 13);
    assert.equal(r.result.depth.max, 1);
    assert.ok(r.result.bottleneckManagers.length >= 1);
  });

  it("teamComposition flags gaps + SPOFs", () => {
    const r = callWithArtifact("teamComposition", ctxA, {
      data: { team: [{ name: "A", skills: ["js"] }], requiredSkills: ["js", "rust"] },
    }, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.gaps, ["rust"]);
    assert.equal(r.result.singlePointsOfFailure[0].skill, "js");
  });

  it("communicationFlow builds a directed graph", () => {
    const r = callWithArtifact("communicationFlow", ctxA, {
      data: { communications: [{ from: "a", to: "b" }, { from: "b", to: "a" }] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.nodes, 2);
    assert.equal(r.result.reciprocity, 1);
  });
});

describe("organ roster CRUD + chart tree", () => {
  it("roster-list is empty for a fresh user", () => {
    const r = call("roster-list", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
    assert.deepEqual(r.result.tree, []);
  });

  it("employee-upsert adds a person and roster-list returns it", () => {
    const up = call("employee-upsert", ctxA, { name: "Ada", title: "VP Eng", department: "Eng", compensation: 200000 });
    assert.equal(up.ok, true);
    assert.equal(up.result.employee.name, "Ada");
    const list = call("roster-list", ctxA);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.activeCount, 1);
    assert.equal(list.result.tree.length, 1);
  });

  it("employee-upsert without name fails", () => {
    const r = call("employee-upsert", ctxA, { title: "X" });
    assert.equal(r.ok, false);
  });

  it("roster-set replaces the whole roster + builds a tree", () => {
    const r = call("roster-set", ctxA, {
      employees: [
        { id: "m", name: "Manager" },
        { id: "r1", name: "Report1", managerId: "m" },
        { id: "r2", name: "Report2", managerId: "m" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 3);
    const list = call("roster-list", ctxA);
    assert.equal(list.result.tree.length, 1);
    assert.equal(list.result.tree[0].children.length, 2);
  });

  it("employee-remove reassigns orphaned reports to the removed manager's manager", () => {
    call("roster-set", ctxA, {
      employees: [
        { id: "ceo", name: "CEO" },
        { id: "mgr", name: "Mgr", managerId: "ceo" },
        { id: "ic", name: "IC", managerId: "mgr" },
      ],
    });
    const rm = call("employee-remove", ctxA, { id: "mgr" });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.reassigned, 1);
    const list = call("roster-list", ctxA);
    assert.equal(list.result.employees.find((e) => e.id === "ic").managerId, "ceo");
  });

  it("rosters are isolated per user", () => {
    call("employee-upsert", ctxA, { name: "OnlyA" });
    const listB = call("roster-list", ctxB);
    assert.equal(listB.result.count, 0);
  });
});

describe("organ reassign (drag-to-reassign)", () => {
  beforeEach(() => {
    call("roster-set", ctxA, {
      employees: [
        { id: "ceo", name: "CEO" },
        { id: "a", name: "A", managerId: "ceo" },
        { id: "b", name: "B", managerId: "ceo" },
        { id: "c", name: "C", managerId: "a" },
      ],
    });
  });

  it("moves a person under a new manager", () => {
    const r = call("reassign", ctxA, { employeeId: "c", newManagerId: "b" });
    assert.equal(r.ok, true);
    assert.equal(r.result.newManagerId, "b");
  });

  it("rejects a reporting cycle", () => {
    const r = call("reassign", ctxA, { employeeId: "a", newManagerId: "c" });
    assert.equal(r.ok, false);
    assert.match(r.error, /cycle/);
  });

  it("rejects self-report", () => {
    const r = call("reassign", ctxA, { employeeId: "a", newManagerId: "a" });
    assert.equal(r.ok, false);
  });

  it("can move someone to the top of the org", () => {
    const r = call("reassign", ctxA, { employeeId: "c", newManagerId: null });
    assert.equal(r.ok, true);
    assert.equal(r.result.newManagerId, null);
  });
});

describe("organ hris-import (CSV)", () => {
  it("imports a generic CSV roster + resolves manager-by-name", () => {
    const csv = [
      "name,title,department,manager,compensation,startDate,status",
      "Grace Hopper,CTO,Engineering,,300000,2019-01-10,active",
      "Alan Turing,Staff Eng,Engineering,Grace Hopper,250000,2021-06-01,active",
    ].join("\n");
    const r = call("hris-import", ctxA, { csv, mode: "replace" });
    assert.equal(r.ok, true);
    assert.equal(r.result.imported, 2);
    const turing = r.result.employees.find((e) => e.name === "Alan Turing");
    const grace = r.result.employees.find((e) => e.name === "Grace Hopper");
    assert.equal(turing.managerId, grace.id);
  });

  it("rejects a CSV with no name column", () => {
    const r = call("hris-import", ctxA, { csv: "foo,bar\n1,2" });
    assert.equal(r.ok, false);
  });

  it("rejects empty csv", () => {
    const r = call("hris-import", ctxA, { csv: "" });
    assert.equal(r.ok, false);
  });

  it("merge mode preserves existing roster rows", () => {
    call("roster-set", ctxA, { employees: [{ id: "keep", name: "Keep Me" }] });
    const csv = "name\nNew Person";
    const r = call("hris-import", ctxA, { csv, mode: "merge" });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCount, 2);
  });
});

describe("organ comp-rollup", () => {
  it("rolls up comp per department + manager subtree", () => {
    call("roster-set", ctxA, {
      employees: [
        { id: "vp", name: "VP", department: "Eng", compensation: 250000 },
        { id: "e1", name: "E1", department: "Eng", managerId: "vp", compensation: 150000 },
        { id: "s1", name: "S1", department: "Sales", compensation: 120000 },
      ],
    });
    const r = call("comp-rollup", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.headcount, 3);
    assert.equal(r.result.totalComp, 520000);
    const eng = r.result.departments.find((d) => d.department === "Eng");
    assert.equal(eng.totalComp, 400000);
    const vpTree = r.result.subtrees.find((s) => s.managerId === "vp");
    assert.equal(vpTree.subtreeComp, 400000);
  });

  it("returns a message when roster is empty", () => {
    const r = call("comp-rollup", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.message);
  });
});

describe("organ tenure-attrition", () => {
  it("computes tenure + flight-risk + attrition", () => {
    call("roster-set", ctxA, {
      employees: [
        { id: "old", name: "Veteran", startDate: "2018-01-01", status: "active" },
        { id: "new", name: "Newbie", startDate: "2026-03-01", status: "active" },
        { id: "gone", name: "Left", startDate: "2020-01-01", status: "departed" },
      ],
    });
    const r = call("tenure-attrition", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.departedCount, 1);
    assert.ok(r.result.attritionRate > 0);
    assert.ok(Array.isArray(r.result.tenureBuckets));
    const vet = r.result.employees.find((e) => e.name === "Veteran");
    assert.equal(vet.riskLabel, "high");
  });

  it("returns a message when roster is empty", () => {
    const r = call("tenure-attrition", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.message);
  });
});

describe("organ headcount scenarios", () => {
  it("scenario-create projects fully-loaded cost", () => {
    call("roster-set", ctxA, { employees: [{ id: "a", name: "A", compensation: 100000 }] });
    const r = call("scenario-create", ctxA, {
      name: "FY27 Expansion",
      loadFactor: 1.3,
      openReqs: [{ title: "Engineer", department: "Eng", baseComp: 150000, count: 2 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.scenario.projection.projectedHeadcount, 3);
    assert.equal(r.result.scenario.projection.addedFullyLoadedCost, 390000);
  });

  it("scenario-create requires a name", () => {
    const r = call("scenario-create", ctxA, { openReqs: [] });
    assert.equal(r.ok, false);
  });

  it("scenario-list + scenario-delete round-trip", () => {
    const created = call("scenario-create", ctxA, { name: "Plan A" });
    const list = call("scenario-list", ctxA);
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    const del = call("scenario-delete", ctxA, { id: created.result.scenario.id });
    assert.equal(del.ok, true);
    assert.equal(call("scenario-list", ctxA).result.count, 0);
  });

  it("scenario-delete fails for unknown id", () => {
    const r = call("scenario-delete", ctxA, { id: "nope" });
    assert.equal(r.ok, false);
  });
});

describe("organ snapshots", () => {
  beforeEach(() => {
    call("roster-set", ctxA, {
      employees: [
        { id: "a", name: "A", department: "Eng", compensation: 100000 },
        { id: "b", name: "B", department: "Eng", managerId: "a", compensation: 90000 },
      ],
    });
  });

  it("snapshot-capture + snapshot-list round-trip", () => {
    const cap = call("snapshot-capture", ctxA, { label: "Q1 2026" });
    assert.equal(cap.ok, true);
    assert.equal(cap.result.snapshot.headcount, 2);
    const list = call("snapshot-list", ctxA);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.snapshots[0].label, "Q1 2026");
  });

  it("snapshot-capture fails on empty roster", () => {
    const r = call("snapshot-capture", ctxB);
    assert.equal(r.ok, false);
  });

  it("snapshot-diff surfaces hires, departures and comp drift vs live", () => {
    const cap = call("snapshot-capture", ctxA, { label: "Baseline" });
    // Mutate the live roster: add a hire, raise comp.
    call("employee-upsert", ctxA, { name: "Carol", department: "Eng", compensation: 110000 });
    call("employee-upsert", ctxA, { id: "a", compensation: 120000 });
    const diff = call("snapshot-diff", ctxA, { fromId: cap.result.snapshot.id, toId: "live" });
    assert.equal(diff.ok, true);
    assert.equal(diff.result.summary.hired, 1);
    assert.equal(diff.result.summary.compAdjusted, 1);
    assert.equal(diff.result.headcountDelta, 1);
  });

  it("snapshot-diff fails for an unknown snapshot id", () => {
    const r = call("snapshot-diff", ctxA, { fromId: "missing", toId: "live" });
    assert.equal(r.ok, false);
  });
});
