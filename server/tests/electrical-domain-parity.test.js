// Contract tests for server/domains/electrical.js — NEC compute macros
// (load calc, voltage drop, conduit fill, box fill, wire size) plus the
// persistent contractor-ops macros (panel schedule builder, estimate →
// invoice flow, one-line diagram, inspection checklists, price list).
//
// Mirrors the travel-domain-parity.test.js pattern: a synthetic register
// fn captures handlers, `call` invokes them with (ctx, artifact, params).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerElectricalActions from "../domains/electrical.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
// All electrical macros read params via { ...artifact?.data, ...params },
// so passing the same object as both is exactly what /api/lens/run does.
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`electrical.${name}`);
  if (!fn) throw new Error(`electrical.${name} not registered`);
  return fn(ctx, { id: null, domain: "electrical", data: params, meta: {} }, params);
}

before(() => { registerElectricalActions(register); });

beforeEach(() => {
  // Fresh in-memory state per test so persistent macros don't leak.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// ── pure-math NEC macros ──────────────────────────────────────────────

describe("electrical.loadCalculation", () => {
  it("totals watts/amps and recommends panel size", () => {
    const r = call("loadCalculation", ctxA, {
      circuits: [{ name: "Kitchen", watts: 1800, voltage: 120 }, { name: "AC", watts: 3600, voltage: 240 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalWatts, 5400);
    assert.ok(r.result.panelSizeRecommended);
    assert.ok(["PASS", "FAIL — exceeds 80% continuous load rating"].includes(r.result.nec80PercentRule));
  });
  it("returns guidance message when no circuits supplied", () => {
    const r = call("loadCalculation", ctxA, { circuits: [] });
    assert.equal(r.ok, true);
    assert.ok(r.result.message);
  });
});

describe("electrical.voltageDropCalc", () => {
  it("computes drop percent and flags out-of-limit runs", () => {
    const r = call("voltageDropCalc", ctxA, { amps: 20, distanceFeet: 200, wireGauge: 12, voltage: 120 });
    assert.equal(r.ok, true);
    assert.ok(r.result.dropPercentValue > 3);
    assert.equal(r.result.acceptable, false);
  });
});

describe("electrical.conduitFill", () => {
  it("sizes conduit for a conductor bundle", () => {
    const r = call("conduitFill", ctxA, {
      conductors: [{ awg: 12, count: 3 }, { awg: 10, count: 1 }],
      conduitType: "EMT",
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.recommendedConduitSize);
    assert.equal(r.result.totalConductors, 4);
    assert.equal(r.result.necFillLimitPercent, 40);
  });
  it("verifies a requested conduit size pass/fail", () => {
    const r = call("conduitFill", ctxA, {
      conductors: [{ awg: 12, count: 9 }],
      conduitSize: "1/2",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.requested.size, "1/2");
    assert.equal(typeof r.result.requested.pass, "boolean");
  });
  it("returns guidance when no conductors", () => {
    const r = call("conduitFill", ctxA, { conductors: [] });
    assert.equal(r.ok, true);
    assert.ok(r.result.message);
  });
});

describe("electrical.boxFill", () => {
  it("computes required box volume and verdict", () => {
    const r = call("boxFill", ctxA, {
      largestAwg: 14, currentCarrying: 4, groundConductors: 2,
      devices: 1, internalClamps: true, boxVolumeCubicInches: 18,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalConductorEquivalents, 4 + 1 + 1 + 2);
    assert.ok(r.result.requiredBoxVolume > 0);
    assert.equal(typeof r.result.pass, "boolean");
  });
});

describe("electrical.wireSize", () => {
  it("recommends a wire gauge for a continuous load", () => {
    const r = call("wireSize", ctxA, { loadAmps: 40, continuous: true, distanceFeet: 60, voltage: 240 });
    assert.equal(r.ok, true);
    assert.ok(r.result.recommendedWire);
    assert.ok(r.result.minBreaker);
    assert.equal(r.result.designAmps, 50);
  });
  it("returns guidance when load is zero", () => {
    const r = call("wireSize", ctxA, { loadAmps: 0 });
    assert.equal(r.ok, true);
    assert.ok(r.result.message);
  });
});

// ── panel schedule builder (persistent) ───────────────────────────────

describe("electrical.panel* (panel schedule builder)", () => {
  it("creates, lists, adds circuits, computes schedule", () => {
    const created = call("panelCreate", ctxA, { name: "Main", mainBreaker: 200, voltage: 240, spaces: 40 });
    assert.equal(created.ok, true);
    const panelId = created.result.id;

    const listed = call("panelList", ctxA);
    assert.equal(listed.ok, true);
    assert.equal(listed.result.panels.length, 1);

    const c1 = call("panelAddCircuit", ctxA, { panelId, name: "Lights", watts: 1200, voltage: 120, phase: "A" });
    assert.equal(c1.ok, true);
    const c2 = call("panelAddCircuit", ctxA, { panelId, name: "Dryer", watts: 5400, voltage: 240, phase: "B" });
    assert.equal(c2.ok, true);
    assert.equal(c2.result.circuit.poles, 2);

    const sched = call("panelSchedule", ctxA, { panelId });
    assert.equal(sched.ok, true);
    assert.equal(sched.result.spacesUsed, 2);
    assert.equal(sched.result.totalConnectedWatts, 6600);
    assert.ok("phaseImbalancePercent" in sched.result);
  });
  it("removes a circuit and deletes the panel", () => {
    const created = call("panelCreate", ctxA, { name: "Sub" });
    const panelId = created.result.id;
    const c = call("panelAddCircuit", ctxA, { panelId, name: "X", watts: 600 });
    const rm = call("panelRemoveCircuit", ctxA, { panelId, circuitId: c.result.circuit.id });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.removed, 1);
    const del = call("panelDelete", ctxA, { panelId });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, 1);
  });
  it("isolates panels per user", () => {
    call("panelCreate", ctxA, { name: "A-panel" });
    const bList = call("panelList", ctxB);
    assert.equal(bList.result.panels.length, 0);
  });
});

// ── estimate → invoice flow (persistent) ──────────────────────────────

describe("electrical.estimate* / invoice* (estimate→invoice flow)", () => {
  it("builds an estimate with labor + material lines and totals", () => {
    const est = call("estimateCreate", ctxA, { client: "Acme", title: "Rewire", taxRate: 8 });
    assert.equal(est.ok, true);
    const estimateId = est.result.id;

    const l = call("estimateAddLine", ctxA, { estimateId, lineType: "labor", description: "Install", hours: 10, rate: 95 });
    assert.equal(l.ok, true);
    const m = call("estimateAddLine", ctxA, { estimateId, lineType: "material", description: "Wire", quantity: 5, unitPrice: 89 });
    assert.equal(m.ok, true);
    assert.equal(m.result.laborTotal, 950);
    assert.equal(m.result.materialTotal, 445);
    assert.equal(m.result.subtotal, 1395);
    assert.ok(m.result.tax > 0);
  });
  it("converts an estimate to an invoice and marks it paid", () => {
    const est = call("estimateCreate", ctxA, { client: "Bob" });
    const estimateId = est.result.id;
    call("estimateAddLine", ctxA, { estimateId, lineType: "labor", hours: 2, rate: 100 });

    const inv = call("estimateToInvoice", ctxA, { estimateId });
    assert.equal(inv.ok, true);
    assert.ok(inv.result.invoiceNumber.startsWith("INV-"));
    assert.equal(inv.result.total, 200);

    const dup = call("estimateToInvoice", ctxA, { estimateId });
    assert.equal(dup.ok, false);

    const list = call("invoiceList", ctxA);
    assert.equal(list.ok, true);
    assert.equal(list.result.summary.count, 1);

    const paid = call("invoiceMarkPaid", ctxA, { invoiceId: inv.result.id });
    assert.equal(paid.ok, true);
    assert.equal(paid.result.status, "paid");
  });
  it("removes lines and deletes estimates", () => {
    const est = call("estimateCreate", ctxA, { client: "C" });
    const estimateId = est.result.id;
    const l = call("estimateAddLine", ctxA, { estimateId, lineType: "labor", hours: 1, rate: 50 });
    const lineId = l.result.laborLines[0].id;
    const rm = call("estimateRemoveLine", ctxA, { estimateId, lineId });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.laborLines.length, 0);
    const del = call("estimateDelete", ctxA, { estimateId });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, 1);
  });
});

// ── one-line diagram (persistent) ─────────────────────────────────────

describe("electrical.diagram* (one-line diagram)", () => {
  it("creates a diagram and builds a node tree", () => {
    const d = call("diagramCreate", ctxA, { name: "Service" });
    assert.equal(d.ok, true);
    const diagramId = d.result.id;

    const util = call("diagramAddNode", ctxA, { diagramId, kind: "utility", label: "Grid" });
    assert.equal(util.ok, true);
    const panel = call("diagramAddNode", ctxA, { diagramId, kind: "main_panel", label: "MDP", rating: "200A", parentId: util.result.node.id });
    assert.equal(panel.ok, true);
    assert.equal(panel.result.diagram.edges.length, 1);

    const list = call("diagramList", ctxA);
    assert.equal(list.result.diagrams[0].nodes.length, 2);
  });
  it("removes a node and its edges, deletes the diagram", () => {
    const d = call("diagramCreate", ctxA, { name: "D" });
    const diagramId = d.result.id;
    const n = call("diagramAddNode", ctxA, { diagramId, kind: "load", label: "L" });
    const rm = call("diagramRemoveNode", ctxA, { diagramId, nodeId: n.result.node.id });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.nodes.length, 0);
    const del = call("diagramDelete", ctxA, { diagramId });
    assert.equal(del.result.deleted, 1);
  });
});

// ── inspection checklist templates (persistent) ───────────────────────

describe("electrical.checklist* (inspection checklists)", () => {
  it("lists templates and instantiates one", () => {
    const tpls = call("checklistTemplates", ctxA);
    assert.equal(tpls.ok, true);
    assert.ok(tpls.result.templates.length >= 4);

    const chk = call("checklistCreate", ctxA, { template: "rough_in", jobName: "123 Oak" });
    assert.equal(chk.ok, true);
    assert.ok(chk.result.items.length > 0);
    assert.equal(chk.result.items[0].passed, null);
  });
  it("rejects an unknown template", () => {
    const r = call("checklistCreate", ctxA, { template: "nonsense" });
    assert.equal(r.ok, false);
  });
  it("sets item state and computes a verdict", () => {
    const chk = call("checklistCreate", ctxA, { template: "final" });
    const checklistId = chk.result.id;
    let last;
    for (const item of chk.result.items) {
      last = call("checklistSetItem", ctxA, { checklistId, itemId: item.id, passed: true });
      assert.equal(last.ok, true);
    }
    assert.equal(last.result.progress.verdict, "PASS");

    const del = call("checklistDelete", ctxA, { checklistId });
    assert.equal(del.result.deleted, 1);
  });
});

// ── material price list (persistent) ──────────────────────────────────

describe("electrical.priceList* (material price list)", () => {
  it("seeds a default catalog on first access", () => {
    const r = call("priceListGet", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "default-catalog");
    assert.ok(r.result.materials.length > 0);
  });
  it("upserts and removes materials", () => {
    call("priceListGet", ctxA); // seed
    const add = call("priceListUpsert", ctxA, { name: "Custom lug", unit: "each", price: 4.5, category: "misc" });
    assert.equal(add.ok, true);
    const added = add.result.materials.find((m) => m.name === "Custom lug");
    assert.ok(added);

    const upd = call("priceListUpsert", ctxA, { id: added.id, price: 5.25 });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.materials.find((m) => m.id === added.id).price, 5.25);

    const rm = call("priceListRemove", ctxA, { id: added.id });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.removed, 1);
  });
});
