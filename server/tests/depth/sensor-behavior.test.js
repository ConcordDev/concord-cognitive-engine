// tests/depth/sensor-behavior.test.js — REAL behavioral tests for the sensor
// (IoT device-registry) domain (registerLensAction family, invoked via lensRun).
// Exact-value + round-trip + validation-rejection per macro.
//
// The sensor domain is registered centrally in domains/index.js by the owner;
// at the time these tests run that wiring may not be present, so the setup below
// registers the handlers directly into the live LENS_ACTIONS map
// (globalThis.__concordLensActions) by importing the default export and feeding
// it a registerLensAction shim. After that, lensRun("sensor", …) dispatches
// through the real lens.run macro exactly as production would.
//
// lens.run wraps a handler's {ok:false,error} as {ok:true, result:{ok:false,error}}
// — the OUTER ok is dispatch success; the handler's verdict is in result.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, load } from "./_harness.js";
import registerSensorActions from "../../domains/sensor.js";

before(async () => {
  await load(); // boot server.js once → LENS_ACTIONS map exists on globalThis
  const map = globalThis.__concordLensActions;
  assert.ok(map, "LENS_ACTIONS map must be available");
  registerSensorActions((domain, action, handler) => {
    map.set(`${domain}.${action}`, handler);
  });
});

describe("sensor — device CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("sensor-crud"); });

  it("device-add → device-list: a device reads back, kind normalized lower-case", async () => {
    const add = await lensRun("sensor", "device-add", {
      params: { name: "Air Quality AQ-01", kind: "Environmental", location: "District-3", unit: "ppm" },
    }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.device.name, "Air Quality AQ-01");
    assert.equal(add.result.device.kind, "environmental");
    assert.equal(add.result.device.status, "registered");
    const id = add.result.device.id;

    const list = await lensRun("sensor", "device-list", {}, ctx);
    assert.equal(list.ok, true);
    assert.ok(list.result.devices.some((d) => d.id === id));
    // No reading yet → reads as offline.
    const found = list.result.devices.find((d) => d.id === id);
    assert.equal(found.status, "offline");
  });

  it("device-add: missing name / kind / location are each rejected", async () => {
    const noName = await lensRun("sensor", "device-add", { params: { kind: "energy", location: "L1" } }, ctx);
    assert.equal(noName.result.ok, false);
    assert.ok(noName.result.error.includes("name required"));

    const noKind = await lensRun("sensor", "device-add", { params: { name: "X", location: "L1" } }, ctx);
    assert.equal(noKind.result.ok, false);
    assert.ok(noKind.result.error.includes("kind required"));

    const noLoc = await lensRun("sensor", "device-add", { params: { name: "X", kind: "energy" } }, ctx);
    assert.equal(noLoc.result.ok, false);
    assert.ok(noLoc.result.error.includes("location required"));
  });

  it("device-update changes fields and reads back; missing id rejected", async () => {
    const add = await lensRun("sensor", "device-add", { params: { name: "Old Name", kind: "gas", location: "Bay 1" } }, ctx);
    const id = add.result.device.id;
    const upd = await lensRun("sensor", "device-update", { params: { id, name: "New Name", location: "Bay 2" } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.device.name, "New Name");
    assert.equal(upd.result.device.location, "Bay 2");

    const list = await lensRun("sensor", "device-list", {}, ctx);
    const found = list.result.devices.find((d) => d.id === id);
    assert.equal(found.name, "New Name");

    const bad = await lensRun("sensor", "device-update", { params: { id: "nope_999", name: "Z" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("device not found"));
  });

  it("device-delete removes the device; a missing id is rejected", async () => {
    const add = await lensRun("sensor", "device-add", { params: { name: "Temp Probe", kind: "structural", location: "Pillar A" } }, ctx);
    const id = add.result.device.id;
    const del = await lensRun("sensor", "device-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, true);

    const list = await lensRun("sensor", "device-list", {}, ctx);
    assert.ok(!list.result.devices.some((d) => d.id === id));

    const bad = await lensRun("sensor", "device-delete", { params: { id: "nope_404" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("device not found"));
  });
});

describe("sensor — reading-record + anomaly detection (exact deterministic)", () => {
  it("reading-record: a non-numeric value is rejected; an unknown device is rejected", async () => {
    const ctx = await depthCtx("sensor-read-validate");
    const add = await lensRun("sensor", "device-add", { params: { name: "R1", kind: "energy", location: "L" } }, ctx);
    const deviceId = add.result.device.id;

    const badVal = await lensRun("sensor", "reading-record", { params: { deviceId, value: "abc" } }, ctx);
    assert.equal(badVal.result.ok, false);
    assert.ok(badVal.result.error.includes("numeric value required"));

    const badDev = await lensRun("sensor", "reading-record", { params: { deviceId: "nope", value: 5 } }, ctx);
    assert.equal(badDev.result.ok, false);
    assert.ok(badDev.result.error.includes("device not found"));
  });

  it("reading-record updates readingCount + lastValue and reads back online", async () => {
    const ctx = await depthCtx("sensor-read-roundtrip");
    const add = await lensRun("sensor", "device-add", { params: { name: "R2", kind: "environmental", location: "L", unit: "C" } }, ctx);
    const deviceId = add.result.device.id;

    const r1 = await lensRun("sensor", "reading-record", { params: { deviceId, value: 21.5 } }, ctx);
    assert.equal(r1.ok, true);
    assert.equal(r1.result.readingCount, 1);
    assert.equal(r1.result.isAnomaly, false);

    const list = await lensRun("sensor", "device-list", {}, ctx);
    const found = list.result.devices.find((d) => d.id === deviceId);
    assert.equal(found.lastValue, 21.5);
    assert.equal(found.readingCount, 1);
    assert.equal(found.status, "online"); // fresh reading, no anomaly
  });

  it("anomaly-list: an explicit threshold flags out-of-range readings exactly", async () => {
    const ctx = await depthCtx("sensor-threshold");
    const add = await lensRun("sensor", "device-add", {
      params: { name: "Pressure P1", kind: "hydraulic", location: "Line A", threshold: { min: 10, max: 20 } },
    }, ctx);
    const deviceId = add.result.device.id;

    await lensRun("sensor", "reading-record", { params: { deviceId, value: 15 } }, ctx); // in range
    const hot = await lensRun("sensor", "reading-record", { params: { deviceId, value: 25 } }, ctx); // above max
    assert.equal(hot.result.isAnomaly, true);
    await lensRun("sensor", "reading-record", { params: { deviceId, value: 5 } }, ctx); // below min

    const an = await lensRun("sensor", "anomaly-list", { params: { deviceId } }, ctx);
    assert.equal(an.ok, true);
    assert.equal(an.result.count, 2); // the 25 (above) and the 5 (below)
    assert.equal(an.result.counts.critical, 2);
    const values = an.result.anomalies.map((a) => a.value).sort((a, b) => a - b);
    assert.deepEqual(values, [5, 25]);
    assert.ok(an.result.anomalies.find((a) => a.value === 25).reason.includes("above threshold"));
  });

  it("anomaly-list: with no threshold, a reading beyond mean ± 2σ is flagged (statistical)", async () => {
    const ctx = await depthCtx("sensor-stddev");
    const add = await lensRun("sensor", "device-add", { params: { name: "Acoustic A1", kind: "acoustic", location: "Plaza" } }, ctx);
    const deviceId = add.result.device.id;
    // Tight cluster around 10, then a clear outlier at 100.
    for (const v of [10, 10, 10, 10, 10, 100]) {
      await lensRun("sensor", "reading-record", { params: { deviceId, value: v } }, ctx);
    }
    const an = await lensRun("sensor", "anomaly-list", { params: { deviceId } }, ctx);
    assert.equal(an.result.count, 1);
    assert.equal(an.result.anomalies[0].value, 100);
    assert.ok(an.result.anomalies[0].z > 0);
  });

  it("anomaly-list: a stable series under MIN_SAMPLES produces no anomalies", async () => {
    const ctx = await depthCtx("sensor-no-anomaly");
    const add = await lensRun("sensor", "device-add", { params: { name: "Calm C1", kind: "other", location: "Lab" } }, ctx);
    const deviceId = add.result.device.id;
    await lensRun("sensor", "reading-record", { params: { deviceId, value: 50 } }, ctx);
    await lensRun("sensor", "reading-record", { params: { deviceId, value: 51 } }, ctx);
    const an = await lensRun("sensor", "anomaly-list", {}, ctx);
    assert.equal(an.result.count, 0);
  });
});

describe("sensor — dashboard-summary (exact counts)", () => {
  it("counts devices, online, and anomalies exactly for an isolated user", async () => {
    const ctx = await depthCtx("sensor-dashboard");
    // Empty by construction.
    const empty = await lensRun("sensor", "dashboard-summary", {}, ctx);
    assert.equal(empty.result.deviceCount, 0);
    assert.equal(empty.result.onlineCount, 0);
    assert.equal(empty.result.anomalyCount, 0);

    // Device 1: fresh reading, no anomaly → online.
    const d1 = await lensRun("sensor", "device-add", { params: { name: "D1", kind: "energy", location: "L1" } }, ctx);
    await lensRun("sensor", "reading-record", { params: { deviceId: d1.result.device.id, value: 100 } }, ctx);

    // Device 2: threshold-violating reading → warning (not online) + 1 anomaly.
    const d2 = await lensRun("sensor", "device-add", { params: { name: "D2", kind: "gas", location: "L2", threshold: { max: 10 } } }, ctx);
    await lensRun("sensor", "reading-record", { params: { deviceId: d2.result.device.id, value: 99 } }, ctx);

    // Device 3: no readings → offline.
    await lensRun("sensor", "device-add", { params: { name: "D3", kind: "structural", location: "L3" } }, ctx);

    const sum = await lensRun("sensor", "dashboard-summary", {}, ctx);
    assert.equal(sum.result.deviceCount, 3);
    assert.equal(sum.result.onlineCount, 1);    // only D1
    assert.equal(sum.result.offlineCount, 2);   // D2 (warning) + D3 (no readings)
    assert.equal(sum.result.anomalyCount, 1);   // D2's out-of-threshold reading
    assert.equal(sum.result.byKind.energy, 1);
    assert.equal(sum.result.byKind.gas, 1);
    assert.equal(sum.result.byKind.structural, 1);
  });
});
