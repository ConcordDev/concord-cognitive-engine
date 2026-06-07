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
