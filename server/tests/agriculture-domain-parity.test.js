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
