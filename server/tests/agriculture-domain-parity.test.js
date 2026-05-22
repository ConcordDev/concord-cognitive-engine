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

// ── 2026 Climate FieldView feature-parity backlog ──────────────

describe("agriculture.satellite-ndvi-* (vegetation imagery layers)", () => {
  it("fetch rejects missing fieldId", async () => {
    const r = await call("satellite-ndvi-fetch", ctxA, { lat: 41, lng: -93 });
    assert.equal(r.ok, false);
    assert.match(r.error, /fieldId required/);
  });
  it("fetch rejects missing coords", async () => {
    const r = await call("satellite-ndvi-fetch", ctxA, { fieldId: "f1" });
    assert.equal(r.ok, false);
    assert.match(r.error, /lat\/lng required/);
  });
  it("list returns empty array for a field with no layers", () => {
    const r = call("satellite-ndvi-list", ctxA, { fieldId: "f_none" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.layers, []);
  });
  it("delete rejects unknown layer id", () => {
    const r = call("satellite-ndvi-delete", ctxA, { id: "nope" });
    assert.equal(r.ok, false);
    assert.match(r.error, /layer not found/);
  });
});

describe("agriculture.telemetry-import (ISOBUS / CAN sync)", () => {
  it("imports a telemetry batch and applies machine state", () => {
    const eq = call("equipment-add", ctxA, { name: "8R 410", kind: "tractor" });
    const id = eq.result.equipment.id;
    const r = call("telemetry-import", ctxA, {
      equipmentId: id,
      protocol: "isobus",
      rows: [
        { ts: "2026-05-21T14:00:00Z", latitude: 41.5, longitude: -93.5, groundSpeed: 4.8, engineHours: 1240.5, fuelLevel: 72, areaWorked: 3.2 },
        { ts: "2026-05-21T14:01:00Z", latitude: 41.51, longitude: -93.51, groundSpeed: 5.1, engineHours: 1240.6, fuelLevel: 71, areaWorked: 1.1 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.sync.rowsReceived, 2);
    assert.equal(r.result.sync.rowsApplied, 2);
    assert.equal(r.result.sync.areaWorkedAcres, 4.3);
    assert.equal(r.result.equipment.fuelLevelPct, 71);
    assert.equal(r.result.equipment.status, "working");
  });
  it("rejects unknown equipment", () => {
    const r = call("telemetry-import", ctxA, { equipmentId: "ghost", rows: [{ speed: 1 }] });
    assert.equal(r.ok, false);
    assert.match(r.error, /equipment not found/);
  });
  it("rejects empty rows", () => {
    const eq = call("equipment-add", ctxA, { name: "S7" });
    const r = call("telemetry-import", ctxA, { equipmentId: eq.result.equipment.id, rows: [] });
    assert.equal(r.ok, false);
    assert.match(r.error, /rows required/);
  });
  it("syncs-list returns the import history", () => {
    const eq = call("equipment-add", ctxA, { name: "Sprayer" });
    const id = eq.result.equipment.id;
    call("telemetry-import", ctxA, { equipmentId: id, rows: [{ speed: 3 }] });
    const l = call("telemetry-syncs-list", ctxA, { equipmentId: id });
    assert.equal(l.ok, true);
    assert.equal(l.result.syncs.length, 1);
  });
});

describe("agriculture.profit-analysis + cost-entry-* (per-field economics)", () => {
  it("cost entries CRUD scoped by field", () => {
    const a = call("cost-entry-add", ctxA, { fieldId: "fp1", label: "seed corn", amount: 110, category: "seed", perAcre: true });
    assert.equal(a.ok, true);
    call("cost-entry-add", ctxA, { fieldId: "fp1", label: "fertilizer", amount: 95, category: "fertilizer", perAcre: true });
    call("cost-entry-add", ctxA, { fieldId: "fp2", label: "other", amount: 10, category: "other" });
    assert.equal(call("cost-entries-list", ctxA, { fieldId: "fp1" }).result.entries.length, 2);
    assert.equal(call("cost-entry-delete", ctxA, { id: a.result.entry.id }).ok, true);
  });
  it("cost-entry-add rejects negative amount", () => {
    const r = call("cost-entry-add", ctxA, { fieldId: "fp1", label: "x", amount: -5 });
    assert.equal(r.ok, false);
    assert.match(r.error, /amount must be/);
  });
  it("computes gross / net / breakeven from costs + price", () => {
    const ctxP = { actor: { userId: "user_profit" }, userId: "user_profit" };
    const f = call("field-create", ctxP, { name: "Profit 80", acreage: 80, lat: 42, lng: -93 });
    const fid = f.result.field.id;
    call("cost-entry-add", ctxP, { fieldId: fid, label: "seed", amount: 110, category: "seed", perAcre: true });
    call("cost-entry-add", ctxP, { fieldId: fid, label: "fertilizer", amount: 90, category: "fertilizer", perAcre: true });
    call("harvest-log", ctxP, { fieldId: fid, crop: "corn", acresHarvested: 80, yieldBushels: 16000 });
    const r = call("profit-analysis", ctxP, { fieldId: fid, commodityPrice: 4.5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCost, 16000); // (110+90) * 80
    assert.equal(r.result.grossRevenue, 72000); // 16000 bu * 4.5
    assert.equal(r.result.netProfit, 56000);
    assert.equal(r.result.breakevenPrice, 1); // 16000 cost / 16000 bu
    assert.equal(r.result.status, "profitable");
  });
  it("rejects missing commodity price", () => {
    const ctxP2 = { actor: { userId: "user_profit2" }, userId: "user_profit2" };
    const f = call("field-create", ctxP2, { name: "P", acreage: 40, lat: 0, lng: 0 });
    const r = call("profit-analysis", ctxP2, { fieldId: f.result.field.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /commodityPrice/);
  });
});

describe("agriculture.spray-window-advisor (weather-driven)", () => {
  it("rejects missing coords", async () => {
    const r = await call("spray-window-advisor", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /lat\/lng required/);
  });
  it("returns an error on network failure (hermetic)", async () => {
    const r = await call("spray-window-advisor", ctxA, { lat: 41, lng: -93 });
    assert.equal(r.ok, false);
    assert.ok(r.error);
  });
});

describe("agriculture.yield-map-build (harvest-monitor overlay)", () => {
  it("bins geo-tagged points into a grid with per-cell tiers", () => {
    const r = call("yield-map-build", ctxA, {
      fieldId: "fy1",
      gridCells: 4,
      points: [
        { lat: 41.50, lng: -93.50, yieldPerAcre: 220 },
        { lat: 41.51, lng: -93.51, yieldPerAcre: 210 },
        { lat: 41.59, lng: -93.59, yieldPerAcre: 120 },
        { lat: 41.58, lng: -93.58, yieldPerAcre: 130 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.map.pointCount, 4);
    assert.ok(r.result.map.cells.length >= 2);
    assert.ok(r.result.map.fieldMaxYield >= r.result.map.fieldMinYield);
  });
  it("rejects when no geo-tagged points available", () => {
    const r = call("yield-map-build", ctxA, { fieldId: "fy_empty" });
    assert.equal(r.ok, false);
    assert.match(r.error, /no geo-tagged harvest-monitor points/);
  });
  it("yield-maps-list returns built maps", () => {
    call("yield-map-build", ctxA, {
      fieldId: "fy2",
      points: [{ lat: 1, lng: 1, yieldPerAcre: 100 }, { lat: 2, lng: 2, yieldPerAcre: 200 }],
    });
    const l = call("yield-maps-list", ctxA, { fieldId: "fy2" });
    assert.equal(l.ok, true);
    assert.equal(l.result.maps.length, 1);
  });
});

describe("agriculture.trial-* (seed / hybrid comparison)", () => {
  it("logs trial entries and ranks hybrids by yield", () => {
    const ctxT = { actor: { userId: "user_trial" }, userId: "user_trial" };
    call("trial-entry-add", ctxT, { trialName: "Corn 2026", hybrid: "DKC65-95", brand: "DeKalb", yieldPerAcre: 218, replicate: "1" });
    call("trial-entry-add", ctxT, { trialName: "Corn 2026", hybrid: "DKC65-95", brand: "DeKalb", yieldPerAcre: 222, replicate: "2" });
    call("trial-entry-add", ctxT, { trialName: "Corn 2026", hybrid: "P1197", brand: "Pioneer", yieldPerAcre: 205, replicate: "1" });
    const c = call("trial-compare", ctxT, { trialName: "Corn 2026" });
    assert.equal(c.ok, true);
    assert.equal(c.result.hybridCount, 2);
    assert.equal(c.result.entryCount, 3);
    assert.equal(c.result.winner.hybrid, "DKC65-95");
    assert.equal(c.result.ranked[0].avgYieldPerAcre, 220);
    assert.equal(c.result.ranked[0].replicates, 2);
  });
  it("trial-entry-add rejects missing hybrid", () => {
    const r = call("trial-entry-add", ctxA, { trialName: "T", hybrid: "", yieldPerAcre: 100 });
    assert.equal(r.ok, false);
    assert.match(r.error, /trialName and hybrid required/);
  });
  it("trial-compare rejects unknown trial", () => {
    const r = call("trial-compare", ctxA, { trialName: "does-not-exist" });
    assert.equal(r.ok, false);
    assert.match(r.error, /no entries for this trial/);
  });
  it("trial-entry-delete removes the entry", () => {
    const ctxT2 = { actor: { userId: "user_trial2" }, userId: "user_trial2" };
    const e = call("trial-entry-add", ctxT2, { trialName: "X", hybrid: "H1", yieldPerAcre: 50 });
    call("trial-entry-delete", ctxT2, { id: e.result.entry.id });
    assert.equal(call("trial-entries-list", ctxT2, { trialName: "X" }).result.entries.length, 0);
  });
});

describe("agriculture.soil-grid-* (sampling grid + lab import)", () => {
  it("generates a grid from field coords + acreage", () => {
    const ctxS = { actor: { userId: "user_soil" }, userId: "user_soil" };
    const f = call("field-create", ctxS, { name: "Soil 40", acreage: 40, lat: 42, lng: -93 });
    const g = call("soil-grid-generate", ctxS, { fieldId: f.result.field.id, acresPerSample: 5 });
    assert.equal(g.ok, true);
    assert.ok(g.result.grid.sampleCount >= 1);
    assert.equal(g.result.grid.points[0].lab, null);
  });
  it("rejects field with no coords and no bounds", () => {
    const r = call("soil-grid-generate", ctxA, { fieldId: "no_coords_field" });
    assert.equal(r.ok, false);
    assert.match(r.error, /bounds|coords/);
  });
  it("imports lab results against grid points + computes averages", () => {
    const ctxS2 = { actor: { userId: "user_soil2" }, userId: "user_soil2" };
    const f = call("field-create", ctxS2, { name: "Soil A", acreage: 20, lat: 41, lng: -93 });
    const g = call("soil-grid-generate", ctxS2, { fieldId: f.result.field.id, acresPerSample: 10 });
    const points = g.result.grid.points;
    const imp = call("soil-grid-import-results", ctxS2, {
      gridId: g.result.grid.id,
      results: points.map((p, i) => ({ pointId: p.pointId, ph: 6.0 + i * 0.2, p_ppm: 25 + i, k_ppm: 150 })),
    });
    assert.equal(imp.ok, true);
    assert.equal(imp.result.applied, points.length);
    assert.ok(imp.result.grid.averages.k_ppm === 150);
  });
  it("import flags unmatched pointIds", () => {
    const ctxS3 = { actor: { userId: "user_soil3" }, userId: "user_soil3" };
    const f = call("field-create", ctxS3, { name: "Soil B", acreage: 10, lat: 41, lng: -93 });
    const g = call("soil-grid-generate", ctxS3, { fieldId: f.result.field.id });
    const imp = call("soil-grid-import-results", ctxS3, {
      gridId: g.result.grid.id,
      results: [{ pointId: "BOGUS", ph: 7 }],
    });
    assert.equal(imp.ok, true);
    assert.equal(imp.result.applied, 0);
    assert.equal(imp.result.unmatched, 1);
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
