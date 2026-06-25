// server/tests/signal-tomography.test.js
//
// Signal Tomography (#23) — reconstructs a voxel field from REAL
// embodied_signal_log readings written via the actual recordSignal path. No mock
// data: measured cells carry the recorded value; interior gaps are inverse-
// distance interpolated and flagged measured:false. Offline. (CELL_SIZE = 50m.)

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { recordSignal } from "../lib/embodied/signals.js";
import { reconstructChannel, reconstructVoxels } from "../lib/signal-tomography.js";
import registerTomographyMacros from "../domains/tomography.js";

const CH = "thermal_os.ambient_temp";

describe("Signal Tomography (#23)", () => {
  let db, macros;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    // Real readings at cell (0,0)=val 0.2 and cell (2,0)=val 0.8 (x=0, x=100 @ 50m cells).
    recordSignal(db, { worldId: "w1", x: 0, z: 0, channel: CH, value: 0.2, source: "sensor", ttlSeconds: 3600 });
    recordSignal(db, { worldId: "w1", x: 100, z: 0, channel: CH, value: 0.8, source: "sensor", ttlSeconds: 3600 });
    macros = new Map();
    registerTomographyMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("measured cells carry the recorded value; the gap is interpolated between them", () => {
    const r = reconstructChannel(db, "w1", CH);
    assert.equal(r.ok, true);
    assert.equal(r.summary.measured, 2, "two real readings");
    assert.equal(r.summary.interpolated, 1, "one interior gap (cell x=1)");
    const c0 = r.voxels.find((v) => v.cx === 0);
    const c2 = r.voxels.find((v) => v.cx === 2);
    const c1 = r.voxels.find((v) => v.cx === 1);
    assert.equal(c0.value, 0.2);
    assert.equal(c0.measured, true);
    assert.equal(c2.value, 0.8);
    assert.equal(c1.measured, false, "interpolated cell is flagged, not faked as measured");
    assert.ok(c1.value > 0.2 && c1.value < 0.8, "interpolated value lies between the real readings");
  });

  it("uses the latest reading when a cell is re-observed", () => {
    recordSignal(db, { worldId: "w1", x: 0, z: 0, channel: CH, value: 0.5, source: "sensor", ttlSeconds: 3600 });
    const r = reconstructChannel(db, "w1", CH);
    assert.equal(r.voxels.find((v) => v.cx === 0).value, 0.5, "newest value wins");
  });

  it("an empty world reconstructs to an honest empty field", () => {
    const r = reconstructChannel(db, "nowhere", CH);
    assert.equal(r.ok, true);
    assert.deepEqual(r.voxels, []);
    assert.equal(r.summary.measured, 0);
  });

  it("reconstructVoxels stacks channels as layers; macro round-trips", async () => {
    recordSignal(db, { worldId: "w1", x: 0, z: 0, channel: "sonic_os.ambient_db", value: 0.3, source: "sensor", ttlSeconds: 3600 });
    const multi = reconstructVoxels(db, "w1");
    assert.ok(multi.layers.length >= 2, "thermal + sonic layers");
    const r = await macros.get("tomography.reconstruct")({ db }, { worldId: "w1", channel: CH });
    assert.equal(r.ok, true);
    const chans = await macros.get("tomography.channels")({ db }, { worldId: "w1" });
    assert.ok(chans.channels.includes(CH));
  });
});
