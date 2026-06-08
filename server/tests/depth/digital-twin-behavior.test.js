// tests/depth/digital-twin-behavior.test.js — REAL behavioral tests for the
// digital-twin lens-action domain. The domain is NOT yet globally registered
// (it is intentionally absent from domains/index.js), so these tests import the
// register function directly and capture its handlers in a LOCAL SHIM, then
// invoke each handler with a constructed (ctx, artifact, params) tuple.
//
// Every handler is exercised with exact-value assertions, CRUD round-trips
// (create → list → get → update → delete), and validation rejections
// ({ ok:false, error }). globalThis._concordSTATE is stubbed so the in-memory
// per-user store works without booting server.js.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import register from "../../domains/digital-twin.js";

// LOCAL SHIM — capture handlers by action name.
const H = new Map();
before(() => {
  register((_domain, action, fn) => H.set(action, fn));
});

// Fresh STATE per test so per-user stores don't leak between cases.
beforeEach(() => {
  globalThis._concordSTATE = {};
});

// Invoke a captured handler: (ctx, { data }, params).
const run = (action, data = {}, params = {}, ctx = { actor: { userId: "u1" } }) =>
  H.get(action)(ctx, { data }, params);

describe("digital-twin — create + validation", () => {
  it("twin-create returns an active v1 twin with the supplied name + sourceId", () => {
    const r = run("twin-create", {}, { name: "Civic Center Twin", sourceId: "dtu_civic_01" });
    assert.equal(r.ok, true);
    const t = r.result.twin;
    assert.equal(t.name, "Civic Center Twin");
    assert.equal(t.sourceId, "dtu_civic_01");
    assert.equal(t.version, 1);
    assert.equal(t.status, "active");
    assert.ok(t.id.includes("twin_"));
    assert.equal(t.lastSyncAt, null);
  });

  it("twin-create accepts an initial state snapshot", () => {
    const r = run("twin-create", {}, { name: "Bridge", sourceId: "src1", state: { strain: 12, temp: 20 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.twin.state.strain, 12);
    assert.equal(r.result.twin.state.temp, 20);
  });

  it("twin-create reads name/sourceId from artifact.data when params omit them", () => {
    const r = run("twin-create", { name: "FromData", sourceId: "srcData" }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.twin.name, "FromData");
    assert.equal(r.result.twin.sourceId, "srcData");
  });

  it("twin-create with no name is rejected", () => {
    const r = run("twin-create", {}, { sourceId: "src1" });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("name required"));
  });

  it("twin-create with no sourceId is rejected", () => {
    const r = run("twin-create", {}, { name: "Nameless source" });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("sourceId required"));
  });
});

describe("digital-twin — list is per-user and starts empty", () => {
  it("twin-list returns an empty list before any twin is created", () => {
    const r = run("twin-list");
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
    assert.equal(r.result.twins.length, 0);
  });

  it("twin-list scopes by user — u2 does not see u1's twin", () => {
    run("twin-create", {}, { name: "U1 Twin", sourceId: "s1" }, { actor: { userId: "u1" } });
    const u2 = run("twin-list", {}, {}, { actor: { userId: "u2" } });
    assert.equal(u2.result.count, 0);
    const u1 = run("twin-list", {}, {}, { actor: { userId: "u1" } });
    assert.equal(u1.result.count, 1);
    assert.equal(u1.result.twins[0].name, "U1 Twin");
  });
});

describe("digital-twin — CRUD round-trip", () => {
  it("create → list → get → delete round-trips; get + delete reject missing ids", () => {
    const created = run("twin-create", {}, { name: "RT", sourceId: "rt_src" });
    const id = created.result.twin.id;

    const list = run("twin-list");
    assert.ok(list.result.twins.some((t) => t.id === id));

    const got = run("twin-get", {}, { id });
    assert.equal(got.ok, true);
    assert.equal(got.result.twin.id, id);
    assert.equal(got.result.twin.name, "RT");

    const del = run("twin-delete", {}, { id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, true);
    assert.equal(del.result.id, id);

    const after = run("twin-list");
    assert.ok(!after.result.twins.some((t) => t.id === id));
  });

  it("twin-get on an unknown id is rejected with not-found", () => {
    const r = run("twin-get", {}, { id: "twin_does_not_exist" });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("twin not found"));
  });

  it("twin-get with no id is rejected", () => {
    const r = run("twin-get", {}, {});
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("id required"));
  });

  it("twin-delete on an unknown id is rejected with not-found", () => {
    const r = run("twin-delete", {}, { id: "twin_nope" });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("twin not found"));
  });
});

describe("digital-twin — update-state merges + bumps version", () => {
  it("twin-update-state merges the patch, bumps version, reports changedFields", () => {
    const created = run("twin-create", {}, { name: "Upd", sourceId: "u_src", state: { a: 1, b: 2 } });
    const id = created.result.twin.id;

    const upd = run("twin-update-state", {}, { id, state: { b: 99, c: 3 } });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.version, 2);
    assert.deepEqual(upd.result.changedFields, ["b", "c"]);
    // Merge preserved untouched fields and overwrote/added the patched ones.
    assert.equal(upd.result.twin.state.a, 1);
    assert.equal(upd.result.twin.state.b, 99);
    assert.equal(upd.result.twin.state.c, 3);

    // The version bump persisted — a subsequent get sees v2.
    const got = run("twin-get", {}, { id });
    assert.equal(got.result.twin.version, 2);
  });

  it("twin-update-state honours an explicit status change", () => {
    const created = run("twin-create", {}, { name: "St", sourceId: "st_src" });
    const id = created.result.twin.id;
    const upd = run("twin-update-state", {}, { id, state: { x: 1 }, status: "offline" });
    assert.equal(upd.result.twin.status, "offline");
  });

  it("twin-update-state with no state object is rejected", () => {
    const created = run("twin-create", {}, { name: "NoState", sourceId: "ns_src" });
    const r = run("twin-update-state", {}, { id: created.result.twin.id });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("state object required"));
  });

  it("twin-update-state on an unknown id is rejected", () => {
    const r = run("twin-update-state", {}, { id: "twin_nope", state: { a: 1 } });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("twin not found"));
  });
});

describe("digital-twin — sync computes real drift", () => {
  it("identical source → driftScore 0, inSync true, no changedFields", () => {
    const created = run("twin-create", {}, { name: "Sync0", sourceId: "sy_src", state: { strain: 10, temp: 20 } });
    const id = created.result.twin.id;
    const r = run("twin-sync", {}, { id, source: { strain: 10, temp: 20 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.driftScore, 0);
    assert.equal(r.result.inSync, true);
    assert.equal(r.result.changedCount, 0);
    assert.equal(r.result.changedFields.length, 0);
    assert.equal(r.result.comparedCount, 2);
  });

  it("one of two fields diverged → driftScore 0.5, exact changed field captured", () => {
    const created = run("twin-create", {}, { name: "Sync1", sourceId: "sy_src", state: { strain: 10, temp: 20 } });
    const id = created.result.twin.id;
    const r = run("twin-sync", {}, { id, source: { strain: 10, temp: 35 } });
    assert.equal(r.result.driftScore, 0.5); // 1 of 2 fields differ
    assert.equal(r.result.inSync, false);
    assert.equal(r.result.changedCount, 1);
    const f = r.result.changedFields.find((c) => c.field === "temp");
    assert.equal(f.twinValue, 20);
    assert.equal(f.sourceValue, 35);
    // High drift flips status to degraded (not offline).
    const got = run("twin-get", {}, { id });
    assert.equal(got.result.twin.status, "degraded");
    assert.equal(got.result.twin.lastDriftScore, 0.5);
  });

  it("source introduces a new field absent from the twin → counted as drift", () => {
    const created = run("twin-create", {}, { name: "Sync2", sourceId: "sy_src", state: { strain: 10 } });
    const id = created.result.twin.id;
    const r = run("twin-sync", {}, { id, source: { strain: 10, vibration: 4 } });
    assert.equal(r.result.comparedCount, 2);   // union: strain, vibration
    assert.equal(r.result.changedCount, 1);    // only vibration differs
    const f = r.result.changedFields.find((c) => c.field === "vibration");
    assert.equal(f.twinValue, null);           // absent on twin side
    assert.equal(f.sourceValue, 4);
  });

  it("twin-sync does NOT mutate the twin's recorded state (measures only)", () => {
    const created = run("twin-create", {}, { name: "Sync3", sourceId: "sy_src", state: { strain: 10 } });
    const id = created.result.twin.id;
    run("twin-sync", {}, { id, source: { strain: 999 } });
    const got = run("twin-get", {}, { id });
    assert.equal(got.result.twin.state.strain, 10); // unchanged by sync
    assert.equal(got.result.twin.version, 1);       // sync never bumps version
  });

  it("twin-sync with no source snapshot is rejected", () => {
    const created = run("twin-create", {}, { name: "Sync4", sourceId: "sy_src" });
    const r = run("twin-sync", {}, { id: created.result.twin.id });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("source snapshot required"));
  });

  it("twin-sync on an unknown id is rejected", () => {
    const r = run("twin-sync", {}, { id: "twin_nope", source: { a: 1 } });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("twin not found"));
  });
});
