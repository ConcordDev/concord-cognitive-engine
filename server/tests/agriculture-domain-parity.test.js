// Tier-2 contract tests for agriculture lens parity macros
// (fields / weather-for-field / scouting).
// Pins per-user scoping + input validation + per-field scoping.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAgricultureActions from "../domains/agriculture.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`agriculture.${name}`);
  if (!fn) throw new Error(`agriculture.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerAgricultureActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("agriculture — fields CRUD", () => {
  it("creates a field with valid coords + acreage", () => {
    const r = call("field-create", ctxA, {
      name: "North 40", acreage: 40, lat: 41.5, lng: -93.5,
      soilType: "loam", currentCrop: "corn",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.field.name, "North 40");
    assert.equal(r.result.field.acreage, 40);
  });

  it("rejects out-of-range latitude", () => {
    const r = call("field-create", ctxA, { name: "X", acreage: 10, lat: 95, lng: 0 });
    assert.equal(r.ok, false);
    assert.match(r.error, /lat must be/);
  });

  it("rejects out-of-range longitude", () => {
    const r = call("field-create", ctxA, { name: "X", acreage: 10, lat: 0, lng: 181 });
    assert.equal(r.ok, false);
    assert.match(r.error, /lng must be/);
  });

  it("rejects zero or negative acreage", () => {
    const r = call("field-create", ctxA, { name: "X", acreage: 0, lat: 0, lng: 0 });
    assert.equal(r.ok, false);
    assert.match(r.error, /acreage must be/);
  });

  it("INVARIANT: fields scoped per-user", () => {
    call("field-create", ctxA, { name: "A only", acreage: 10, lat: 0, lng: 0 });
    const b = call("field-list", ctxB);
    assert.equal(b.result.fields.length, 0);
  });

  it("update modifies in place", () => {
    const c = call("field-create", ctxA, { name: "v1", acreage: 10, lat: 0, lng: 0 });
    const u = call("field-update", ctxA, { id: c.result.field.id, currentCrop: "soybean" });
    assert.equal(u.result.field.currentCrop, "soybean");
  });

  it("update rejects clearing name", () => {
    const c = call("field-create", ctxA, { name: "keep", acreage: 10, lat: 0, lng: 0 });
    const u = call("field-update", ctxA, { id: c.result.field.id, name: "  " });
    assert.equal(u.ok, false);
  });

  it("delete removes from list", () => {
    const c = call("field-create", ctxA, { name: "tmp", acreage: 10, lat: 0, lng: 0 });
    call("field-delete", ctxA, { id: c.result.field.id });
    const l = call("field-list", ctxA);
    assert.equal(l.result.fields.length, 0);
  });
});

describe("agriculture — weather-for-field", () => {
  it("rejects missing coords", async () => {
    const r = await call("weather-for-field", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /lat\/lng required/);
  });

  it("returns error on network failure (hermetic test)", async () => {
    const r = await call("weather-for-field", ctxA, { lat: 40, lng: -100 });
    assert.equal(r.ok, false);
    // Either the explicit fetch error or upstream failure shape — both pass
    assert.ok(r.error);
  });
});

describe("agriculture — scouting log", () => {
  beforeEach(() => {
    call("field-create", ctxA, { name: "f1", acreage: 10, lat: 0, lng: 0 });
  });

  it("creates a scouting pin with sanitized category/severity", () => {
    const fields = call("field-list", ctxA);
    const fid = fields.result.fields[0].id;
    const r = call("scout-add", ctxA, {
      fieldId: fid, note: "found cutworm in NE corner",
      category: "pest", severity: "high",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.pin.category, "pest");
    assert.equal(r.result.pin.severity, "high");
  });

  it("defaults unknown category/severity to safe values", () => {
    const fields = call("field-list", ctxA);
    const fid = fields.result.fields[0].id;
    const r = call("scout-add", ctxA, {
      fieldId: fid, note: "x", category: "unknown_cat", severity: "extreme",
    });
    assert.equal(r.result.pin.category, "other");
    assert.equal(r.result.pin.severity, "low");
  });

  it("rejects empty note", () => {
    const fields = call("field-list", ctxA);
    const r = call("scout-add", ctxA, {
      fieldId: fields.result.fields[0].id, note: "  ",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /note required/);
  });

  it("scout-list filters by fieldId", () => {
    const fields = call("field-list", ctxA);
    const fid = fields.result.fields[0].id;
    call("scout-add", ctxA, { fieldId: fid, note: "in f1" });
    call("field-create", ctxA, { name: "f2", acreage: 10, lat: 0, lng: 0 });
    const f2 = call("field-list", ctxA).result.fields.find((f) => f.name === "f2");
    call("scout-add", ctxA, { fieldId: f2.id, note: "in f2" });
    const l = call("scout-list", ctxA, { fieldId: fid });
    assert.equal(l.result.pins.length, 1);
    assert.equal(l.result.pins[0].note, "in f1");
  });

  it("INVARIANT: scouts scoped per-user", () => {
    const fields = call("field-list", ctxA);
    call("scout-add", ctxA, { fieldId: fields.result.fields[0].id, note: "a-only" });
    const b = call("scout-list", ctxB);
    assert.equal(b.result.pins.length, 0);
  });
});

describe("agriculture — STATE unavailable path", () => {
  it("returns error shape when STATE is missing", () => {
    globalThis._concordSTATE = undefined;
    const r = call("field-list", ctxA);
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE unavailable/);
  });
});

// ── Full-app parity (John Deere Ops Center + FieldView 2026) ───

describe("agriculture.equipment-* (machine fleet + telemetry)", () => {
  it("add / list / update-telemetry / delete cycle", () => {
    const a = call("equipment-add", ctxA, { name: "8R 410", kind: "tractor", make: "John Deere", year: 2024 });
    assert.equal(a.ok, true);
    assert.equal(a.result.equipment.status, "idle");
    assert.equal(call("equipment-list", ctxA, {}).result.equipment.length, 1);
    const u = call("equipment-update-telemetry", ctxA, { id: a.result.equipment.id, lat: 42.1, lng: -93.5, speedMph: 4.8, fuelLevelPct: 78, status: "working" });
    assert.equal(u.result.equipment.status, "working");
    assert.equal(u.result.equipment.fuelLevelPct, 78);
    assert.equal(call("equipment-delete", ctxA, { id: a.result.equipment.id }).ok, true);
  });
  it("rejects empty name", () => {
    assert.equal(call("equipment-add", ctxA, { name: "" }).ok, false);
  });
});

describe("agriculture.zones-* (field zones)", () => {
  it("create / list / delete cycle, scoped by fieldId", () => {
    const z1 = call("zones-create", ctxA, { fieldId: "f1", name: "North high", productivityClass: "high", areaAcres: 24, soilType: "loam" });
    assert.equal(z1.ok, true);
    call("zones-create", ctxA, { fieldId: "f1", name: "South low", productivityClass: "low" });
    call("zones-create", ctxA, { fieldId: "f2", name: "Other" });
    assert.equal(call("zones-list", ctxA, { fieldId: "f1" }).result.zones.length, 2);
    assert.equal(call("zones-delete", ctxA, { id: z1.result.zone.id }).ok, true);
  });
  it("rejects missing fieldId/name", () => {
    assert.equal(call("zones-create", ctxA, { fieldId: "", name: "X" }).ok, false);
  });
});

describe("agriculture.prescriptions-* (variable-rate scripts)", () => {
  it("create / approve / delete cycle with avg rate calc", () => {
    const r = call("prescriptions-create", ctxA, {
      fieldId: "f1", product: "UAN-32", kind: "nitrogen",
      zoneRates: [{ zoneId: "z1", rate: 180 }, { zoneId: "z2", rate: 140 }, { zoneId: "z3", rate: 100 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.prescription.avgRate, 140);
    assert.equal(r.result.prescription.status, "draft");
    const a = call("prescriptions-approve", ctxA, { id: r.result.prescription.id });
    assert.equal(a.result.prescription.status, "approved");
    assert.equal(call("prescriptions-delete", ctxA, { id: r.result.prescription.id }).ok, true);
  });
  it("flat-rate prescription works", () => {
    const r = call("prescriptions-create", ctxA, { fieldId: "f1", product: "Seed", kind: "seed", flatRate: 34000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.prescription.flatRate, 34000);
  });
});

describe("agriculture.planting-passes + harvest-passes", () => {
  it("planting log records pass with seeding rate", () => {
    const p = call("planting-log", ctxA, { fieldId: "f1", crop: "corn", variety: "DKC65-95", seedingRate: 34000, depthInches: 2, acresPlanted: 80 });
    assert.equal(p.ok, true);
    assert.equal(p.result.pass.crop, "corn");
    assert.equal(call("planting-passes", ctxA, { fieldId: "f1" }).result.passes.length, 1);
  });
  it("harvest log computes yieldPerAcre", () => {
    const h = call("harvest-log", ctxA, { fieldId: "f1", crop: "corn", acresHarvested: 80, yieldBushels: 16000, moisturePct: 15.5 });
    assert.equal(h.ok, true);
    assert.equal(h.result.pass.yieldPerAcre, 200);
    assert.match(h.result.pass.ticketNumber, /^TKT-/);
  });
  it("rejects zero acres on harvest", () => {
    assert.equal(call("harvest-log", ctxA, { fieldId: "f1", crop: "corn", acresHarvested: 0, yieldBushels: 100 }).ok, false);
  });
});

describe("agriculture.nitrogen-plans + apply", () => {
  it("create plan / apply / track remaining", () => {
    const p = call("nitrogen-plan-create", ctxA, { fieldId: "f1", targetLbsPerAcre: 180, crop: "corn" });
    assert.equal(p.ok, true);
    assert.equal(p.result.plan.remaining, 180);
    const a1 = call("nitrogen-apply", ctxA, { planId: p.result.plan.id, lbsPerAcre: 50, timing: "preplant" });
    assert.equal(a1.result.plan.totalApplied, 50);
    assert.equal(a1.result.plan.remaining, 130);
    const a2 = call("nitrogen-apply", ctxA, { planId: p.result.plan.id, lbsPerAcre: 60, timing: "sidedress" });
    assert.equal(a2.result.plan.totalApplied, 110);
    assert.equal(a2.result.plan.remaining, 70);
  });
  it("rejects invalid input", () => {
    assert.equal(call("nitrogen-plan-create", ctxA, { fieldId: "", targetLbsPerAcre: 100 }).ok, false);
    assert.equal(call("nitrogen-plan-create", ctxA, { fieldId: "f1", targetLbsPerAcre: 0 }).ok, false);
  });
});

describe("agriculture.imagery-* (satellite + drone)", () => {
  it("attach / list, scoped by fieldId", () => {
    call("imagery-attach", ctxA, { fieldId: "f1", url: "/a.tif", source: "drone", kind: "ndvi" });
    call("imagery-attach", ctxA, { fieldId: "f1", url: "/b.tif", source: "satellite", kind: "rgb" });
    call("imagery-attach", ctxA, { fieldId: "f2", url: "/c.tif" });
    assert.equal(call("imagery-list", ctxA, { fieldId: "f1" }).result.imagery.length, 2);
  });
  it("rejects missing url", () => {
    assert.equal(call("imagery-attach", ctxA, { fieldId: "f1", url: "" }).ok, false);
  });
});

describe("agriculture.tank-mixes-* (mix builder)", () => {
  it("create + list", () => {
    const m = call("tank-mix-create", ctxA, {
      name: "Spring burndown",
      components: [{ product: "Roundup PowerMax", ratePerAcre: 32, costPerAcre: 8 }, { product: "Atrazine", ratePerAcre: 16, costPerAcre: 5 }],
      carrierGalPerAcre: 15,
    });
    assert.equal(m.ok, true);
    assert.equal(m.result.mix.totalCostPerAcre, 13);
    assert.equal(m.result.mix.compatible, true);
  });
  it("rejects empty components", () => {
    assert.equal(call("tank-mix-create", ctxA, { name: "X", components: [] }).ok, false);
  });
});

describe("agriculture.work-orders-*", () => {
  it("create / complete cycle", () => {
    const o = call("work-orders-create", ctxA, { fieldId: "f1", operation: "Apply UAN sidedress", kind: "fertilize", scheduledFor: "2026-06-15" });
    assert.equal(o.ok, true);
    assert.equal(o.result.order.status, "scheduled");
    const c = call("work-orders-complete", ctxA, { id: o.result.order.id, notes: "applied 60 lbs/ac" });
    assert.equal(c.result.order.status, "completed");
  });
});

describe("agriculture.grain-bins-* (storage)", () => {
  it("create / load / unload cycle", () => {
    const b = call("grain-bins-create", ctxA, { name: "Bin A", capacityBushels: 50000, crop: "corn" });
    assert.equal(b.ok, true);
    assert.equal(b.result.bin.currentBushels, 0);
    const load = call("grain-bins-load", ctxA, { id: b.result.bin.id, bushels: 30000 });
    assert.equal(load.result.bin.currentBushels, 30000);
    const overload = call("grain-bins-load", ctxA, { id: b.result.bin.id, bushels: 30000 });
    assert.equal(overload.ok, false);
    const unload = call("grain-bins-unload", ctxA, { id: b.result.bin.id, bushels: 10000 });
    assert.equal(unload.result.bin.currentBushels, 20000);
    const overdraw = call("grain-bins-unload", ctxA, { id: b.result.bin.id, bushels: 100000 });
    assert.equal(overdraw.ok, false);
  });
  it("rejects invalid capacity", () => {
    assert.equal(call("grain-bins-create", ctxA, { name: "X", capacityBushels: 0 }).ok, false);
  });
});

describe("agriculture.dashboard-summary (AgFarmShell data source)", () => {
  it("aggregates fields + equipment + work orders + harvest + bins", () => {
    const ctxC = { actor: { userId: "user_dash" }, userId: "user_dash" };
    call("field-create", ctxC, { name: "F1", acreage: 80, currentCrop: "corn", lat: 42, lng: -93 });
    call("field-create", ctxC, { name: "F2", acreage: 120, currentCrop: "soybeans", lat: 42, lng: -93 });
    call("equipment-add", ctxC, { name: "8R" });
    const eq = call("equipment-add", ctxC, { name: "S7" });
    call("equipment-update-telemetry", ctxC, { id: eq.result.equipment.id, status: "working" });
    call("work-orders-create", ctxC, { fieldId: "f1", operation: "Spray" });
    const fields = call("field-list", ctxC, {}).result.fields;
    const fieldId = fields[0].id;
    call("harvest-log", ctxC, { fieldId, crop: "corn", acresHarvested: 80, yieldBushels: 16000 });
    const bin = call("grain-bins-create", ctxC, { name: "B", capacityBushels: 20000 });
    call("grain-bins-load", ctxC, { id: bin.result.bin.id, bushels: 10000 });
    const d = call("dashboard-summary", ctxC, {});
    assert.equal(d.result.totalFields, 2);
    assert.equal(d.result.totalAcres, 200);
    assert.equal(d.result.equipmentCount, 2);
    assert.equal(d.result.equipmentWorking, 1);
    assert.equal(d.result.scheduledWorkOrders, 1);
    assert.equal(d.result.seasonYieldBushels, 16000);
    assert.equal(d.result.avgYieldPerAcre, 80);
    assert.equal(d.result.grainStored, 10000);
    assert.equal(d.result.grainUtilizationPct, 50);
  });
});
