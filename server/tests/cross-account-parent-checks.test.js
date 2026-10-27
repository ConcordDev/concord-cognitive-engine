// Child-create actions only attach to the caller's OWN parent record
// (fk_not_validated_cross_account in the 10-26 sweep). Account B pointing a
// child at account A's parent gets the same "not found" as a made-up id.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerAgriculture from "../domains/agriculture.js";
import registerHomeImprovement from "../domains/homeimprovement.js";
import registerMining from "../domains/mining.js";
import registerOps from "../domains/ops.js";
import registerArtistry from "../domains/artistry.js";

const A = { actor: { userId: "xacct_A", role: "member" }, userId: "xacct_A" };
const B = { actor: { userId: "xacct_B", role: "member" }, userId: "xacct_B" };
const m = new Map();
const col = (d, n, h) => m.set(`${d}.${n}`, h);
const call = (k, ctx, p) => m.get(k)(ctx, { id: null, data: {}, meta: {} }, p);
const unwrap = (r) => (r && typeof r.then === "function" ? r : Promise.resolve(r));

describe("cross-account parent checks", () => {
  before(() => {
    globalThis._concordSTATE = globalThis._concordSTATE || {};
    for (const reg of [registerAgriculture, registerHomeImprovement, registerMining, registerOps, registerArtistry]) {
      try { reg(col); } catch { reg(col, col); }
    }
  });

  it("agriculture: children attach only to the caller's own field/equipment", () => {
    const f = call("agriculture.field-create", A, { name: "A field", acreage: 10, lat: 41.5, lng: -93.6 });
    assert.equal(f.ok, true, JSON.stringify(f));
    const fieldId = f.result.field.id;
    const eq = call("agriculture.equipment-add", A, { name: "A tractor" });
    const equipmentId = eq.result.equipment?.id || eq.result.unit?.id || eq.result.eq?.id || Object.values(eq.result).find((v) => v?.id)?.id;
    const cases = [
      ["zones-create", { fieldId, name: "z" }],
      ["prescriptions-create", { fieldId, product: "urea" }],
      ["planting-log", { fieldId, crop: "corn" }],
      ["harvest-log", { fieldId, crop: "corn", acresHarvested: 1, yieldBushels: 100 }],
      ["nitrogen-plan-create", { fieldId, targetLbsPerAcre: 150 }],
      ["work-orders-create", { fieldId, operation: "spray" }],
      ["cost-entry-add", { fieldId, label: "seed", amount: 5 }],
      ["trial-entry-add", { fieldId, trialName: "t", hybrid: "h", yieldPerAcre: 200 }],
    ];
    for (const [a, p] of cases) {
      assert.equal(call(`agriculture.${a}`, B, p).ok, false, `B ${a} on A's field`);
      assert.equal(call(`agriculture.${a}`, A, { ...p, fieldId: "field_made_up" }).ok, false, `A ${a} on a made-up field`);
      assert.equal(call(`agriculture.${a}`, A, p).ok, true, `A ${a} on own field`);
    }
    assert.equal(call("agriculture.work-orders-create", B, { fieldId: "x", operation: "spray", equipmentId }).ok, false);
    const bf = call("agriculture.field-create", B, { name: "B field", acreage: 5, lat: 40, lng: -90 }).result.field.id;
    assert.equal(call("agriculture.planting-log", B, { fieldId: bf, crop: "corn", equipmentId }).error, "equipment not found");
  });

  it("home-improvement gallery-add links only the caller's own project", () => {
    const p = call("home-improvement.project-add", A, { name: "Kitchen" }).result.project.id;
    const img = { room: "kitchen", afterImage: "https://example.com/a.jpg" };
    assert.equal(call("home-improvement.gallery-add", B, { ...img, projectId: p }).error, "project not found");
    assert.equal(call("home-improvement.gallery-add", B, img).ok, true, "unlinked entry still fine");
    assert.equal(call("home-improvement.gallery-add", A, { ...img, projectId: p }).ok, true);
  });

  it("mining equipment-add assigns only to the caller's own site", () => {
    const site = call("mining.site-add", A, { name: "Pit 1", commodity: "copper" });
    const siteId = site.result.site.id;
    assert.equal(call("mining.equipment-add", B, { name: "Truck", siteId }).error, "site not found");
    assert.equal(call("mining.equipment-add", A, { name: "Truck", siteId }).ok, true);
    assert.equal(call("mining.equipment-add", B, { name: "Truck" }).ok, true);
  });

  it("ops postmortemDraft / shiftOverride only use the caller's own incident/shift", () => {
    const inc = call("ops.incidentCreate", A, { title: "DB down", severity: "sev2" }).result.incident.id;
    assert.equal(call("ops.postmortemDraft", B, { incidentId: inc }).error, "incident not found");
    const own = call("ops.postmortemDraft", A, { incidentId: inc });
    assert.equal(own.ok, true); assert.match(own.result.title, /DB down/);
    assert.equal(call("ops.postmortemDraft", B, {}).ok, true, "blank template still works");
    const sh = call("ops.shiftCreate", A, { responder: "amy", startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-11-02T00:00:00Z" }).result.shift.id;
    const ov = { shiftId: sh, responder: "bob", startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-11-01T06:00:00Z" };
    assert.equal(call("ops.shiftOverride", B, ov).error, "shift not found");
    assert.equal(call("ops.shiftOverride", A, ov).ok, true);
  });

  it("artistry projectView counts another viewer once", async () => {
    const c = await unwrap(call("artistry.projectCreate", A, { title: "Mural", description: "d" }));
    const projectId = c.result.project.id;
    for (let i = 0; i < 3; i++) assert.equal((await unwrap(call("artistry.projectView", B, { projectId }))).ok, true);
    const v = await unwrap(call("artistry.projectView", A, { projectId }));
    assert.equal(v.result.project.views, 1);
  });
});
