// tests/depth/electrical-behavior.test.js — REAL behavioral tests for the
// electrical domain (registerLensAction family, via lensRun). NEC engineering
// calcs assert exact computed values; panel/estimate→invoice CRUD round-trips.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("electrical — NEC calcs (exact values)", () => {
  it("loadCalculation: amps = watts/voltage; panel sized from total load", async () => {
    const r = await lensRun("electrical", "loadCalculation", { data: { circuits: [{ name: "Kitchen", watts: 1200, voltage: 120 }] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalWatts, 1200);
    assert.equal(r.result.totalAmps, 10);            // 1200 / 120
    assert.equal(r.result.panelSizeRecommended, "100A");
    assert.equal(r.result.utilization, 10);          // 10 / 100 * 100
  });

  it("boxFill: conductor equivalents = hots + grounds(=1) + devices*2 + …", async () => {
    const r = await lensRun("electrical", "boxFill", { data: { currentCarrying: 3, groundConductors: 2, devices: 1, largestAwg: 14 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalConductorEquivalents, 6);   // 3 + 1(grounds) + 1*2(devices)
  });

  it("wireSize: continuous load design current = load * 1.25", async () => {
    const r = await lensRun("electrical", "wireSize", { data: { loadAmps: 40, continuous: true, distanceFeet: 50, voltage: 240 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.designAmps, 50);           // 40 * 1.25
  });

  it("voltageDropCalc: short 12 AWG run stays under the 3% NEC limit", async () => {
    const r = await lensRun("electrical", "voltageDropCalc", { data: { amps: 15, distanceFeet: 50, wireGauge: 12, voltage: 120 } });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.dropPercentValue, "number");
    assert.equal(r.result.acceptable, true);         // ~2.5% ≤ 3%
  });

  it("conduitFill: 3 conductors use the 40% NEC fill limit and size a conduit", async () => {
    const r = await lensRun("electrical", "conduitFill", { data: { conductors: [{ awg: 12, count: 3 }] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.recommendedConduitSize, "should recommend a conduit size");
  });
});

describe("electrical — CRUD round-trips", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("electrical-crud"); });

  it("panelCreate → panelList → panelAddCircuit", async () => {
    const created = await lensRun("electrical", "panelCreate", { params: { name: "Main Service", spaces: 40, mainBreaker: 200 } }, ctx);
    assert.equal(created.ok, true);
    const panelId = created.result.panel?.id ?? created.result.id;
    assert.ok(panelId);
    const list = await lensRun("electrical", "panelList", {}, ctx);
    assert.ok(list.result.panels.some((p) => p.id === panelId));
    const add = await lensRun("electrical", "panelAddCircuit", { params: { panelId, name: "Lights", watts: 1200, voltage: 120 } }, ctx);
    assert.equal(add.ok, true);
  });

  it("estimateCreate → estimateToInvoice → invoiceMarkPaid", async () => {
    const est = await lensRun("electrical", "estimateCreate", { params: { client: "Acme Co", title: "Panel upgrade" } }, ctx);
    assert.equal(est.ok, true);
    const estimateId = est.result.estimate?.id ?? est.result.id;
    await lensRun("electrical", "estimateAddLine", { params: { estimateId, lineType: "labor", description: "Install", hours: 4, rate: 95 } }, ctx);
    const inv = await lensRun("electrical", "estimateToInvoice", { params: { estimateId } }, ctx);
    assert.equal(inv.ok, true);
    const invoiceId = inv.result.invoice?.id ?? inv.result.id;
    assert.ok(invoiceId);
    const paid = await lensRun("electrical", "invoiceMarkPaid", { params: { invoiceId } }, ctx);
    assert.equal(paid.ok, true);
    assert.equal((paid.result.status ?? paid.result.invoice?.status), "paid");
  });

  it("validation: panelAddCircuit on a missing panel is rejected", async () => {
    const bad = await lensRun("electrical", "panelAddCircuit", { params: { panelId: "nope", watts: 100 } }, ctx);
    assert.equal(bad.result.ok, false);              // lens.run wraps handler {ok:false}
    assert.match(bad.result.error, /panel not found/);
  });
});

// ════════════════════════════════════════════════════════════════════
//  EXTENSION — uncovered NEC calcs (exact engineering math)
// ════════════════════════════════════════════════════════════════════
describe("electrical — uncovered NEC calc math", () => {
  it("voltageDropCalc: 3-phase uses the 1.732 factor (8 AWG, 100ft, 40A, 240V → 2.21%)", async () => {
    const r = await lensRun("electrical", "voltageDropCalc", {
      data: { amps: 40, distanceFeet: 100, wireGauge: 8, voltage: 240, phase: 3 },
    });
    assert.equal(r.ok, true);
    // drop = (0.764/1000)·100·40·1.732 = 5.2913V → 5.2913/240·100 = 2.205%
    assert.ok(Math.abs(r.result.dropPercentValue - 2.21) < 1e-3);
    assert.equal(r.result.acceptable, true);         // 2.21% ≤ 3%
    assert.equal(r.result.phase, "3-phase");
  });

  it("voltageDropCalc: long run exceeds 3% and recommends an upgrade", async () => {
    const r = await lensRun("electrical", "voltageDropCalc", {
      data: { amps: 20, distanceFeet: 200, wireGauge: 12, voltage: 120, phase: 1 },
    });
    assert.equal(r.ok, true);
    // drop = (1.93/1000)·200·20·2 = 15.44V → 12.87% — well over 3%
    assert.ok(Math.abs(r.result.dropPercentValue - 12.87) < 1e-3);
    assert.equal(r.result.acceptable, false);
    assert.match(r.result.recommendation, /Upgrade to/);
  });

  it("conduitFill: 4×#10 THHN sizes to 1/2\" EMT at 27.8% fill (40% limit)", async () => {
    const r = await lensRun("electrical", "conduitFill", {
      data: { conductors: [{ awg: 10, count: 4 }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalConductors, 4);
    assert.equal(r.result.necFillLimitPercent, 40);  // 3+ conductors
    // total area = 0.0211·4 = 0.0844; 1/2" 100% area 0.304 → 27.8%
    assert.equal(r.result.recommendedConduitSize, '1/2"');
    assert.ok(Math.abs(r.result.recommendedActualFillPercent - 27.8) < 1e-3);
  });

  it("conduitFill: requested-conduit check reports pass + 31% rule for 2 conductors", async () => {
    const r = await lensRun("electrical", "conduitFill", {
      data: { conductors: [{ awg: 12, count: 2 }], conduitSize: "3/4" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.necFillLimitPercent, 31);  // exactly 2 conductors
    // area = 0.0133·2 = 0.0266; 3/4" 100% 0.533 → 4.99%, well under 31%
    assert.equal(r.result.requested.pass, true);
    assert.equal(r.result.requested.allowedFillPercent, 31);
  });

  it("conduitFill: empty conductor list returns the prompt message, not a size", async () => {
    const r = await lensRun("electrical", "conduitFill", { data: { conductors: [] } });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Add conductors/);
  });

  it("boxFill: 12 AWG, 4 hots, grounds, 2 devices → 10 equivalents, 22.5 in³", async () => {
    const r = await lensRun("electrical", "boxFill", {
      data: { currentCarrying: 4, groundConductors: 2, devices: 2, largestAwg: 12, boxVolumeCubicInches: 24 },
    });
    assert.equal(r.ok, true);
    // 4 + 1(grounds) + 0(clamps) + 2*2(devices) = 9 ... wait verify below
    assert.equal(r.result.totalConductorEquivalents, 9);
    // 9 × 2.25 = 20.25 in³
    assert.ok(Math.abs(r.result.requiredBoxVolume - 20.25) < 1e-3);
    assert.equal(r.result.pass, true);               // 24 ≥ 20.25
  });

  it("boxFill: undersized box FAILs and reports the shortfall", async () => {
    const r = await lensRun("electrical", "boxFill", {
      data: { currentCarrying: 6, groundConductors: 1, devices: 1, internalClamps: true, largestAwg: 14, boxVolumeCubicInches: 12 },
    });
    assert.equal(r.ok, true);
    // 6 + 1 + 1(clamps) + 2 = 10 equiv × 2.0(14awg) = 20 in³ required
    assert.equal(r.result.totalConductorEquivalents, 10);
    assert.ok(Math.abs(r.result.requiredBoxVolume - 20) < 1e-3);
    assert.equal(r.result.pass, false);              // 12 < 20
    assert.match(r.result.verdict, /FAIL/);
  });

  it("wireSize: 40A continuous → 50A design → 8 AWG ampacity (NEC 310.16)", async () => {
    const r = await lensRun("electrical", "wireSize", {
      data: { loadAmps: 40, continuous: true, distanceFeet: 50, voltage: 240 },
    });
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.designAmps - 50) < 1e-3);     // 40 × 1.25
    assert.equal(r.result.ampacityRequiredWire, "8 AWG");      // ampacity 50 ≥ 50
    assert.equal(r.result.minBreaker, "50A");
  });

  it("wireSize: zero load returns the prompt, not a wire", async () => {
    const r = await lensRun("electrical", "wireSize", { data: { loadAmps: 0 } });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /load in amps/);
  });

  it("circuitTrace: maps circuits + averages devices per circuit", async () => {
    const r = await lensRun("electrical", "circuitTrace", {
      data: {
        panels: [{ name: "Main" }],
        circuits: [
          { name: "Kitchen", room: "Kitchen", devices: ["recep", "recep", "light"] },
          { name: "Spare", devices: ["recep"] },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCircuits, 2);
    assert.equal(r.result.unassigned, 1);            // "Spare" has no room
    assert.ok(Math.abs(r.result.avgDevicesPerCircuit - 2) < 1e-3); // (3+1)/2
  });

  it("safetyInspection: a critical failure forces an overall FAIL with pass-rate", async () => {
    const r = await lensRun("electrical", "safetyInspection", {
      data: {
        inspectionItems: [
          { name: "GFCI present", passed: true },
          { name: "Open ground", passed: false, critical: true },
          { name: "Loose lug", passed: false },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 3);
    assert.equal(r.result.passed, 1);
    assert.equal(r.result.criticalFailures, 1);
    assert.ok(Math.abs(r.result.passRate - 33) < 1e-3);  // round(1/3*100)=33
    assert.match(r.result.overallResult, /FAIL/);
  });

  it("safetyInspection: empty item list returns the prompt message", async () => {
    const r = await lensRun("electrical", "safetyInspection", { data: { inspectionItems: [] } });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Add inspection items/);
  });
});

// ════════════════════════════════════════════════════════════════════
//  EXTENSION — panel schedule / leg balance + remove + delete
// ════════════════════════════════════════════════════════════════════
describe("electrical — panel schedule + leg balance", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("electrical-panel-sched"); });

  it("panelSchedule: computes phase imbalance from A/B leg amps", async () => {
    const created = await lensRun("electrical", "panelCreate", { params: { name: "Sub A", spaces: 12, mainBreaker: 100, voltage: 240 } }, ctx);
    const panelId = created.result.id;
    // Leg A: 2400W/120 = 20A ; Leg B: 1200W/120 = 10A
    await lensRun("electrical", "panelAddCircuit", { params: { panelId, name: "Range", watts: 2400, voltage: 120, phase: "A" } }, ctx);
    await lensRun("electrical", "panelAddCircuit", { params: { panelId, name: "Lights", watts: 1200, voltage: 120, phase: "B" } }, ctx);
    const sched = await lensRun("electrical", "panelSchedule", { params: { panelId } }, ctx);
    assert.equal(sched.ok, true);
    assert.ok(Math.abs(sched.result.legA_amps - 20) < 1e-3);
    assert.ok(Math.abs(sched.result.legB_amps - 10) < 1e-3);
    // imbalance = |20-10|/20 * 100 = 50%
    assert.ok(Math.abs(sched.result.phaseImbalancePercent - 50) < 1e-3);
    assert.equal(sched.result.totalConnectedWatts, 3600);
  });

  it("panelRemoveCircuit removes a circuit and re-positions; round-trips via panelSchedule", async () => {
    const created = await lensRun("electrical", "panelCreate", { params: { name: "Sub B", spaces: 8 } }, ctx);
    const panelId = created.result.id;
    const a = await lensRun("electrical", "panelAddCircuit", { params: { panelId, name: "C1", watts: 600, voltage: 120 } }, ctx);
    await lensRun("electrical", "panelAddCircuit", { params: { panelId, name: "C2", watts: 600, voltage: 120 } }, ctx);
    const circuitId = a.result.circuit.id;
    const rem = await lensRun("electrical", "panelRemoveCircuit", { params: { panelId, circuitId } }, ctx);
    assert.equal(rem.ok, true);
    assert.equal(rem.result.removed, 1);
    assert.ok(!rem.result.panel.circuits.some((c) => c.id === circuitId));
    assert.equal(rem.result.panel.circuits[0].position, 1); // re-numbered
  });

  it("panelDelete removes the panel from the list", async () => {
    const created = await lensRun("electrical", "panelCreate", { params: { name: "Throwaway" } }, ctx);
    const panelId = created.result.id;
    const del = await lensRun("electrical", "panelDelete", { params: { panelId } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, 1);
    const list = await lensRun("electrical", "panelList", {}, ctx);
    assert.ok(!list.result.panels.some((p) => p.id === panelId));
  });

  it("validation: panelSchedule on a missing panel is rejected", async () => {
    const bad = await lensRun("electrical", "panelSchedule", { params: { panelId: "ghost" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /panel not found/);
  });
});

// ════════════════════════════════════════════════════════════════════
//  EXTENSION — estimate list / remove-line / delete + invoice list
// ════════════════════════════════════════════════════════════════════
describe("electrical — estimate totals + invoice list", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("electrical-est-inv"); });

  it("estimateAddLine totals: labor 4h×$95 + material 10×$5 = $430 subtotal", async () => {
    const est = await lensRun("electrical", "estimateCreate", { params: { client: "Bob", title: "Rewire" } }, ctx);
    const estimateId = est.result.id;
    await lensRun("electrical", "estimateAddLine", { params: { estimateId, lineType: "labor", description: "Install", hours: 4, rate: 95 } }, ctx);
    const r = await lensRun("electrical", "estimateAddLine", { params: { estimateId, lineType: "material", description: "Wire", quantity: 10, unitPrice: 5 } }, ctx);
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.result.laborTotal - 380) < 1e-3);    // 4×95
    assert.ok(Math.abs(r.result.materialTotal - 50) < 1e-3);  // 10×5
    assert.ok(Math.abs(r.result.subtotal - 430) < 1e-3);
    assert.ok(Math.abs(r.result.total - 430) < 1e-3);         // taxRate 0
  });

  it("estimateList reflects added estimates with computed totals", async () => {
    const est = await lensRun("electrical", "estimateCreate", { params: { client: "Carol" } }, ctx);
    const estimateId = est.result.id;
    await lensRun("electrical", "estimateAddLine", { params: { estimateId, lineType: "labor", hours: 2, rate: 100 } }, ctx);
    const list = await lensRun("electrical", "estimateList", {}, ctx);
    assert.equal(list.ok, true);
    const found = list.result.estimates.find((e) => e.id === estimateId);
    assert.ok(found);
    assert.ok(Math.abs(found.laborTotal - 200) < 1e-3);       // 2×100
  });

  it("estimateRemoveLine drops the line and re-totals to zero", async () => {
    const est = await lensRun("electrical", "estimateCreate", { params: { client: "Dan" } }, ctx);
    const estimateId = est.result.id;
    const added = await lensRun("electrical", "estimateAddLine", { params: { estimateId, lineType: "labor", hours: 5, rate: 80 } }, ctx);
    const lineId = added.result.laborLines[0].id;
    const r = await lensRun("electrical", "estimateRemoveLine", { params: { estimateId, lineId } }, ctx);
    assert.equal(r.ok, true);
    assert.ok(!r.result.laborLines.some((l) => l.id === lineId));
    assert.ok(Math.abs(r.result.subtotal - 0) < 1e-3);
  });

  it("estimateDelete removes the estimate", async () => {
    const est = await lensRun("electrical", "estimateCreate", { params: { client: "Eve" } }, ctx);
    const estimateId = est.result.id;
    const del = await lensRun("electrical", "estimateDelete", { params: { estimateId } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, 1);
    const list = await lensRun("electrical", "estimateList", {}, ctx);
    assert.ok(!list.result.estimates.some((e) => e.id === estimateId));
  });

  it("invoiceList summary aggregates billed/outstanding; estimate→invoice carries totals", async () => {
    const est = await lensRun("electrical", "estimateCreate", { params: { client: "Fred" } }, ctx);
    const estimateId = est.result.id;
    await lensRun("electrical", "estimateAddLine", { params: { estimateId, lineType: "labor", hours: 3, rate: 100 } }, ctx);
    const inv = await lensRun("electrical", "estimateToInvoice", { params: { estimateId } }, ctx);
    const invoiceId = inv.result.id;
    assert.ok(Math.abs(inv.result.total - 300) < 1e-3);       // 3×100
    const list = await lensRun("electrical", "invoiceList", {}, ctx);
    assert.equal(list.ok, true);
    const found = list.result.invoices.find((i) => i.id === invoiceId);
    assert.ok(found);
    assert.ok(list.result.summary.outstanding >= 300);        // unpaid invoice contributes
  });

  it("validation: double estimateToInvoice on the same estimate is rejected", async () => {
    const est = await lensRun("electrical", "estimateCreate", { params: { client: "Gina" } }, ctx);
    const estimateId = est.result.id;
    await lensRun("electrical", "estimateToInvoice", { params: { estimateId } }, ctx);
    const again = await lensRun("electrical", "estimateToInvoice", { params: { estimateId } }, ctx);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /already invoiced/);
  });
});

// ════════════════════════════════════════════════════════════════════
//  EXTENSION — one-line diagram CRUD
// ════════════════════════════════════════════════════════════════════
describe("electrical — one-line diagram CRUD", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("electrical-diagram"); });

  it("diagramCreate → diagramList round-trips", async () => {
    const created = await lensRun("electrical", "diagramCreate", { params: { name: "Service Riser" } }, ctx);
    assert.equal(created.ok, true);
    const diagramId = created.result.id;
    const list = await lensRun("electrical", "diagramList", {}, ctx);
    assert.ok(list.result.diagrams.some((d) => d.id === diagramId && d.name === "Service Riser"));
  });

  it("diagramAddNode with a parent creates an edge; unknown kind defaults to load", async () => {
    const created = await lensRun("electrical", "diagramCreate", { params: { name: "Riser" } }, ctx);
    const diagramId = created.result.id;
    const utility = await lensRun("electrical", "diagramAddNode", { params: { diagramId, kind: "utility", label: "Utility" } }, ctx);
    const utilityId = utility.result.node.id;
    const panel = await lensRun("electrical", "diagramAddNode", { params: { diagramId, kind: "bogus_kind", label: "Panel", parentId: utilityId } }, ctx);
    assert.equal(panel.ok, true);
    assert.equal(panel.result.node.kind, "load");   // unknown → load
    assert.ok(panel.result.diagram.edges.some((e) => e.from === utilityId && e.to === panel.result.node.id));
  });

  it("diagramRemoveNode drops the node and its incident edges", async () => {
    const created = await lensRun("electrical", "diagramCreate", { params: { name: "Riser2" } }, ctx);
    const diagramId = created.result.id;
    const a = await lensRun("electrical", "diagramAddNode", { params: { diagramId, kind: "main_panel", label: "MP" } }, ctx);
    const aId = a.result.node.id;
    const b = await lensRun("electrical", "diagramAddNode", { params: { diagramId, kind: "subpanel", label: "SP", parentId: aId } }, ctx);
    const bId = b.result.node.id;
    const r = await lensRun("electrical", "diagramRemoveNode", { params: { diagramId, nodeId: bId } }, ctx);
    assert.equal(r.ok, true);
    assert.ok(!r.result.nodes.some((n) => n.id === bId));
    assert.ok(!r.result.edges.some((e) => e.from === bId || e.to === bId));
  });

  it("diagramDelete removes the diagram", async () => {
    const created = await lensRun("electrical", "diagramCreate", { params: { name: "Temp" } }, ctx);
    const diagramId = created.result.id;
    const del = await lensRun("electrical", "diagramDelete", { params: { diagramId } }, ctx);
    assert.equal(del.result.deleted, 1);
    const list = await lensRun("electrical", "diagramList", {}, ctx);
    assert.ok(!list.result.diagrams.some((d) => d.id === diagramId));
  });

  it("validation: diagramAddNode on a missing diagram is rejected", async () => {
    const bad = await lensRun("electrical", "diagramAddNode", { params: { diagramId: "nope", kind: "load" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /diagram not found/);
  });
});

// ════════════════════════════════════════════════════════════════════
//  EXTENSION — inspection checklist templates + CRUD
// ════════════════════════════════════════════════════════════════════
describe("electrical — checklist templates + CRUD", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("electrical-checklist"); });

  it("checklistTemplates lists the authored NEC job-type templates", async () => {
    const r = await lensRun("electrical", "checklistTemplates", {});
    assert.equal(r.ok, true);
    const keys = r.result.templates.map((t) => t.key);
    assert.ok(keys.includes("rough_in"));
    assert.ok(keys.includes("service"));
    assert.ok(keys.includes("final"));
    const roughIn = r.result.templates.find((t) => t.key === "rough_in");
    assert.equal(roughIn.itemCount, 7);              // 7 authored rough-in items
  });

  it("checklistCreate from a template seeds the items; round-trips via checklistList", async () => {
    const created = await lensRun("electrical", "checklistCreate", { params: { template: "service", jobName: "Panel swap" } }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.items.length, 7);
    const checklistId = created.result.id;
    const list = await lensRun("electrical", "checklistList", {}, ctx);
    assert.ok(list.result.checklists.some((c) => c.id === checklistId));
  });

  it("checklistSetItem marks a critical failure and the verdict becomes FAIL", async () => {
    const created = await lensRun("electrical", "checklistCreate", { params: { template: "final" } }, ctx);
    const checklistId = created.result.id;
    // mark every item: all pass except one critical fail
    for (let i = 0; i < created.result.items.length; i++) {
      const item = created.result.items[i];
      const isFail = i === 0;
      await lensRun("electrical", "checklistSetItem", {
        params: { checklistId, itemId: item.id, passed: !isFail, critical: isFail },
      }, ctx);
    }
    const last = await lensRun("electrical", "checklistSetItem", {
      params: { checklistId, itemId: created.result.items[0].id, passed: false, critical: true, notes: "no GFCI" },
    }, ctx);
    assert.equal(last.ok, true);
    assert.equal(last.result.progress.criticalFailures, 1);
    assert.equal(last.result.progress.verdict, "FAIL — critical issues");
  });

  it("checklistDelete removes the checklist", async () => {
    const created = await lensRun("electrical", "checklistCreate", { params: { template: "ev_charger" } }, ctx);
    const checklistId = created.result.id;
    const del = await lensRun("electrical", "checklistDelete", { params: { checklistId } }, ctx);
    assert.equal(del.result.deleted, 1);
    const list = await lensRun("electrical", "checklistList", {}, ctx);
    assert.ok(!list.result.checklists.some((c) => c.id === checklistId));
  });

  it("validation: checklistCreate with an unknown template is rejected", async () => {
    const bad = await lensRun("electrical", "checklistCreate", { params: { template: "not_a_template" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unknown template/);
  });
});

// ════════════════════════════════════════════════════════════════════
//  EXTENSION — material price list CRUD (seeds from default catalog)
// ════════════════════════════════════════════════════════════════════
describe("electrical — material price list CRUD", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("electrical-pricelist"); });

  it("priceListGet seeds from the default catalog on first access", async () => {
    const r = await lensRun("electrical", "priceListGet", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "default-catalog");
    assert.ok(r.result.materials.length >= 16);
    assert.ok(r.result.materials.some((m) => m.name.includes("GFCI receptacle")));
  });

  it("priceListUpsert adds a new material; round-trips via priceListGet", async () => {
    const up = await lensRun("electrical", "priceListUpsert", { params: { name: "Custom whip", unit: "each", price: 7.25, category: "misc" } }, ctx);
    assert.equal(up.ok, true);
    const added = up.result.materials.find((m) => m.name === "Custom whip");
    assert.ok(added);
    assert.ok(Math.abs(added.price - 7.25) < 1e-3);
    const get = await lensRun("electrical", "priceListGet", {}, ctx);
    assert.ok(get.result.materials.some((m) => m.name === "Custom whip"));
    assert.equal(get.result.source, "user");
  });

  it("priceListUpsert edits an existing material in place by id", async () => {
    const seed = await lensRun("electrical", "priceListGet", {}, ctx);
    const target = seed.result.materials[0];
    const up = await lensRun("electrical", "priceListUpsert", { params: { id: target.id, price: 999 } }, ctx);
    assert.equal(up.ok, true);
    const edited = up.result.materials.find((m) => m.id === target.id);
    assert.ok(Math.abs(edited.price - 999) < 1e-3);
  });

  it("priceListRemove deletes a material by id", async () => {
    const up = await lensRun("electrical", "priceListUpsert", { params: { name: "Temp item", price: 1 } }, ctx);
    const temp = up.result.materials.find((m) => m.name === "Temp item");
    const rem = await lensRun("electrical", "priceListRemove", { params: { id: temp.id } }, ctx);
    assert.equal(rem.ok, true);
    assert.equal(rem.result.removed, 1);
    const get = await lensRun("electrical", "priceListGet", {}, ctx);
    assert.ok(!get.result.materials.some((m) => m.id === temp.id));
  });

  it("validation: priceListUpsert with a non-existent id is rejected", async () => {
    // ensure list exists first so the lookup path is hit
    await lensRun("electrical", "priceListGet", {}, ctx);
    const bad = await lensRun("electrical", "priceListUpsert", { params: { id: "missing_id", price: 5 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /material not found/);
  });
});
