// Contract tests for server/domains/diy.js — pure-math AI macros plus the
// per-user project workshop substrate (step builder, BOM, progress, fork).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDIYActions from "../domains/diy.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`diy.${name}`);
  assert.ok(fn, `diy.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerDIYActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("diy pure-compute AI macros", () => {
  it("estimateProject rolls up materials, labor, waste and contingency", () => {
    const r = call("estimateProject", ctxA, {
      data: {
        name: "Bookshelf", difficulty: "beginner",
        materials: [{ name: "Pine board", quantity: 4, unitPrice: 12 }],
        estimatedHours: 6, hourlyRate: 20,
      },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.breakdown.materialsCost, 48);
    assert.equal(r.result.breakdown.contingencyRate, "15%");
    assert.ok(r.result.totalEstimate > 48);
  });

  it("cutList packs cuts with first-fit-decreasing bin packing", () => {
    const r = call("cutList", ctxA, { data: { stockLength: 96, cuts: [{ length: 40, quantity: 3, label: "Shelf" }] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCuts, 3);
    assert.ok(r.result.boardsNeeded >= 2);
  });

  it("toolCheck flags missing tools with rent/buy estimates", () => {
    const r = call("toolCheck", ctxA, { data: { requiredTools: ["table saw", "drill"], ownedTools: [{ name: "drill", condition: "good" }] } }, {});
    assert.equal(r.result.missing, 1);
    assert.equal(r.result.readyToStart, false);
  });

  it("safetyCheck escalates risk and assembles PPE", () => {
    const r = call("safetyCheck", ctxA, { data: { category: "woodworking", tools: ["circular saw", "router"], materials: ["wood", "epoxy"] } }, {});
    assert.ok(r.result.requiredPPE.includes("safety glasses"));
    assert.ok(["moderate", "high"].includes(r.result.riskLevel));
  });

  it("buildTimeEstimate applies experience multiplier per step", () => {
    const r = call("buildTimeEstimate", ctxA, { data: { difficulty: "beginner", steps: [{ name: "Cut", estimatedMinutes: 60 }] } }, {});
    assert.ok(r.result.grandTotalMinutes > 60);
  });
});

describe("diy project workshop CRUD", () => {
  it("creates, lists and gets a project scoped per user", () => {
    const p = call("project-create", ctxA, { name: "Garden Bench", category: "Woodworking", difficulty: "intermediate" }).result.project;
    assert.equal(p.name, "Garden Bench");
    assert.equal(call("project-list", ctxA, {}).result.count, 1);
    assert.equal(call("project-list", ctxB, {}).result.count, 0);
    assert.equal(call("project-get", ctxA, { projectId: p.id }).result.project.name, "Garden Bench");
  });

  it("rejects a nameless project; unknown difficulty falls back to intermediate", () => {
    assert.equal(call("project-create", ctxA, {}).ok, false);
    assert.equal(call("project-create", ctxA, { name: "X", difficulty: "wizard" }).result.project.difficulty, "intermediate");
  });

  it("deletes a project", () => {
    const p = call("project-create", ctxA, { name: "Trash Me" }).result.project;
    assert.equal(call("project-delete", ctxA, { projectId: p.id }).ok, true);
    assert.equal(call("project-list", ctxA, {}).result.count, 0);
    assert.equal(call("project-delete", ctxA, { projectId: "nope" }).ok, false);
  });
});

describe("diy illustrated step builder", () => {
  it("adds, updates, reorders and deletes ordered steps", () => {
    const p = call("project-create", ctxA, { name: "Shelf" }).result.project;
    const s1 = call("step-add", ctxA, { projectId: p.id, text: "Measure", photoUrl: "http://x/1.jpg" }).result.step;
    const s2 = call("step-add", ctxA, { projectId: p.id, text: "Cut" }).result.step;
    assert.equal(s1.order, 1);
    assert.equal(s2.order, 2);
    call("step-update", ctxA, { projectId: p.id, stepId: s1.id, text: "Measure twice" });
    const reordered = call("step-reorder", ctxA, { projectId: p.id, stepId: s2.id, toIndex: 0 }).result.project;
    assert.equal(reordered.steps[0].id, s2.id);
    assert.equal(reordered.steps[0].order, 1);
    const afterDel = call("step-delete", ctxA, { projectId: p.id, stepId: s1.id }).result.project;
    assert.equal(afterDel.stepCount, 1);
  });

  it("rejects a step with no text", () => {
    const p = call("project-create", ctxA, { name: "Y" }).result.project;
    assert.equal(call("step-add", ctxA, { projectId: p.id, text: "" }).ok, false);
  });
});

describe("diy progress tracking", () => {
  it("marks steps complete and derives progress percent + status", () => {
    const p = call("project-create", ctxA, { name: "Box" }).result.project;
    const s1 = call("step-add", ctxA, { projectId: p.id, text: "A" }).result.step;
    const s2 = call("step-add", ctxA, { projectId: p.id, text: "B" }).result.step;
    let r = call("step-progress", ctxA, { projectId: p.id, stepId: s1.id, complete: true, resultPhotoUrl: "http://x/done.jpg" });
    assert.equal(r.result.progressPct, 50);
    assert.equal(r.result.project.status, "in_progress");
    r = call("step-progress", ctxA, { projectId: p.id, stepId: s2.id, complete: true });
    assert.equal(r.result.progressPct, 100);
    assert.equal(r.result.project.status, "completed");
  });
});

describe("diy bill of materials with cost rollup + shopping links", () => {
  it("adds BOM lines with auto-generated shopping links and rolls up cost", () => {
    const p = call("project-create", ctxA, { name: "Desk", estimatedHours: 0 }).result.project;
    const line = call("bom-add", ctxA, { projectId: p.id, item: "Oak plank", quantity: 3, unitPrice: 20, supplier: "Local Mill" }).result.line;
    assert.ok(line.links.length >= 3);
    assert.ok(line.links[0].url.includes("Oak"));
    call("bom-add", ctxA, { projectId: p.id, item: "Screws", quantity: 1, unitPrice: 8, owned: true });
    const rollup = call("bom-rollup", ctxA, { projectId: p.id }).result;
    assert.equal(rollup.totalCost, 68);
    assert.equal(rollup.toBuyCost, 60);
    assert.equal(rollup.bySupplier["Local Mill"], 60);
  });

  it("updates and deletes BOM lines", () => {
    const p = call("project-create", ctxA, { name: "Z" }).result.project;
    const line = call("bom-add", ctxA, { projectId: p.id, item: "Glue" }).result.line;
    call("bom-update", ctxA, { projectId: p.id, lineId: line.id, owned: true, unitPrice: 5 });
    let rollup = call("bom-rollup", ctxA, { projectId: p.id }).result;
    assert.equal(rollup.toBuyCost, 0);
    call("bom-delete", ctxA, { projectId: p.id, lineId: line.id });
    rollup = call("bom-rollup", ctxA, { projectId: p.id }).result;
    assert.equal(rollup.lineCount, 0);
  });
});

describe("diy tool-availability gate", () => {
  it("clears a project when all required tools are owned and usable", () => {
    const p = call("project-create", ctxA, { name: "Build" }).result.project;
    const r = call("project-tool-gate", ctxA, {
      projectId: p.id,
      requiredTools: ["drill", "sander"],
      inventory: [{ name: "Cordless Drill", condition: "Good" }, { name: "Orbital Sander", condition: "Good" }],
    });
    assert.equal(r.result.readyToStart, true);
  });

  it("blocks when a tool is missing or needs repair", () => {
    const p = call("project-create", ctxA, { name: "Build2" }).result.project;
    const r = call("project-tool-gate", ctxA, {
      projectId: p.id,
      requiredTools: ["drill", "table saw"],
      inventory: [{ name: "Drill", condition: "Needs Repair" }],
    });
    assert.equal(r.result.readyToStart, false);
    assert.ok(r.result.missing.includes("table saw"));
    assert.ok(r.result.unusable.includes("drill"));
  });
});

describe("diy browse facets", () => {
  it("aggregates difficulty, category, cost and time bands", () => {
    call("project-create", ctxA, { name: "P1", difficulty: "beginner", category: "Woodworking", estimatedHours: 1 });
    call("project-create", ctxA, { name: "P2", difficulty: "advanced", category: "Electronics", estimatedHours: 30 });
    const f = call("project-facets", ctxA, {}).result;
    assert.equal(f.total, 2);
    assert.equal(f.byDifficulty.beginner, 1);
    assert.equal(f.timeBands["over 24h"], 1);
  });
});

describe("diy project forking / remix", () => {
  it("publishes, browses and forks a project into another user's workshop", () => {
    const p = call("project-create", ctxA, { name: "Birdhouse" }).result.project;
    call("step-add", ctxA, { projectId: p.id, text: "Cut panels" });
    call("bom-add", ctxA, { projectId: p.id, item: "Cedar", quantity: 2, unitPrice: 6 });
    assert.equal(call("project-publish", ctxA, { projectId: p.id }).result.published, true);

    const catalog = call("project-browse-published", ctxB, {}).result.catalog;
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0].isMine, false);

    const fork = call("project-fork", ctxB, { projectId: p.id }).result.project;
    assert.match(fork.name, /remix/);
    assert.equal(fork.forkedFrom.name, "Birdhouse");
    assert.equal(fork.stepCount, 1);
    assert.equal(fork.bomLineCount, 1);
    assert.equal(call("project-list", ctxB, {}).result.count, 1);

    assert.equal(call("project-unpublish", ctxA, { projectId: p.id }).result.published, false);
    assert.equal(call("project-browse-published", ctxB, {}).result.count, 0);
  });

  it("rejects forking an unpublished project", () => {
    assert.equal(call("project-fork", ctxB, { projectId: "ghost" }).ok, false);
  });
});
