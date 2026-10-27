import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerDistrictActions, { recordDistrictSnapshot, listDistrictSnapshots } from "../domains/district.js";
import { readDistrictTimeline } from "../lib/sim-infra.js";
import { runDistrictSnapshotHeartbeat, MIN_INTERVAL_MS } from "../lib/district-snapshot-heartbeat.js";

const actions = new Map();
registerDistrictActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));
const act = (name, params) => actions.get(`district.${name}`)({}, null, params);

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE worlds (id TEXT PRIMARY KEY, population INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE world_buildings (id TEXT PRIMARY KEY, world_id TEXT NOT NULL, state TEXT DEFAULT 'standing');
  `);
  return db;
}

beforeEach(() => { globalThis._concordSTATE = { districtSnapshots: new Map() }; });

describe("district lens actions (unchanged behaviour)", () => {
  it("validates input", () => {
    assert.equal(act("snapshot-record", {}).error, "districtId required");
    assert.equal(act("snapshot-record", { districtId: "d" }).error, "numeric buildingCount required");
    assert.equal(act("snapshot-record", { districtId: "d", buildingCount: 1 }).error, "numeric population required");
    assert.equal(act("snapshot-record", { districtId: "d", buildingCount: 1, population: 2, activeUsers: -1 }).error, "numeric activeUsers required");
    assert.equal(act("snapshot-record", { districtId: "d", buildingCount: 1, population: 2, at: "nope" }).error, "invalid timestamp");
    assert.equal(act("timeline-list", {}).error, "districtId required");
  });

  it("records, defaults activeUsers to 0, lists oldest->newest with limit", () => {
    const r1 = act("snapshot-record", { districtId: "d", buildingCount: 1, population: 2, at: "2026-01-02T00:00:00Z" });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.snapshot.activeUsers, 0);
    act("snapshot-record", { districtId: "d", buildingCount: 3, population: 4, activeUsers: 5, at: "2026-01-01T00:00:00Z" });
    const all = act("timeline-list", { districtId: "d" }).result;
    assert.equal(all.count, 2);
    assert.deepEqual(all.snapshots.map((s) => s.buildingCount), [3, 1]);
    assert.deepEqual(act("timeline-list", { districtId: "d", limit: 1 }).result.snapshots.map((s) => s.buildingCount), [1]);
  });

  it("growth-analysis reports null activeUsers delta when not recorded", () => {
    recordDistrictSnapshot({ districtId: "w", buildingCount: 1, population: 1, activeUsers: null, at: "2026-01-01T00:00:00Z" });
    recordDistrictSnapshot({ districtId: "w", buildingCount: 2, population: 2, activeUsers: null, at: "2026-01-02T00:00:00Z" });
    const g = act("growth-analysis", { districtId: "w" }).result;
    assert.equal(g.deltas.activeUsers, null);
    assert.equal(g.deltas.buildingCount, 1);
  });

  it("caps history at 500", () => {
    for (let i = 0; i < 505; i++) recordDistrictSnapshot({ districtId: "c", buildingCount: i, population: 0, at: new Date(1e12 + i).toISOString() });
    assert.equal(listDistrictSnapshots("c").result.count, 500);
  });
});

describe("district snapshot heartbeat", () => {
  it("records real counts per world, excluding collapsed buildings, activeUsers null", () => {
    const db = makeDb();
    db.prepare("INSERT INTO worlds VALUES ('w1', 7), ('w2', 0)").run();
    db.prepare("INSERT INTO world_buildings (id, world_id, state) VALUES ('a','w1','standing'),('b','w1','collapsed'),('c','w1','damaged')").run();
    const out = runDistrictSnapshotHeartbeat({ db, now: 1_000_000_000_000 });
    assert.equal(out.ok, true);
    assert.equal(out.recorded, 2);
    const s1 = listDistrictSnapshots("w1").result.snapshots[0];
    assert.equal(s1.buildingCount, 2);
    assert.equal(s1.population, 7);
    assert.equal(s1.activeUsers, null);
    const s2 = listDistrictSnapshots("w2").result.snapshots[0];
    assert.equal(s2.buildingCount, 0);
  });

  it("dedups within 55 minutes and records again after", () => {
    const db = makeDb();
    db.prepare("INSERT INTO worlds VALUES ('w1', 1)").run();
    const t0 = 1_000_000_000_000;
    runDistrictSnapshotHeartbeat({ db, now: t0 });
    const again = runDistrictSnapshotHeartbeat({ db, now: t0 + MIN_INTERVAL_MS - 1000 });
    assert.equal(again.recorded, 0);
    assert.equal(again.skippedRecent, 1);
    runDistrictSnapshotHeartbeat({ db, now: t0 + MIN_INTERVAL_MS + 1000 });
    assert.equal(listDistrictSnapshots("w1").result.count, 2);
  });

  it("no-ops without throwing when tables or db are missing", () => {
    assert.equal(runDistrictSnapshotHeartbeat({}).reason, "no_db");
    const bare = new Database(":memory:");
    assert.equal(runDistrictSnapshotHeartbeat({ db: bare }).reason, "no_worlds_table");
    bare.exec("CREATE TABLE worlds (id TEXT PRIMARY KEY, population INTEGER)");
    assert.equal(runDistrictSnapshotHeartbeat({ db: bare }).reason, "no_world_buildings_table");
  });
});

describe("readDistrictTimeline", () => {
  it("requires a district id", () => {
    assert.equal(readDistrictTimeline("").status, 400);
  });

  it("empty state is explicit with null+reason fields", () => {
    const t = readDistrictTimeline("nowhere");
    assert.equal(t.ok, true);
    assert.deepEqual(t.snapshots, []);
    assert.equal(t.count, 0);
    assert.equal(t.reason, "no_snapshots_recorded_yet");
    for (const k of ["power", "water", "environmentalScore"]) {
      assert.equal(t[k], null);
      assert.match(t[`${k}Reason`], /^not_recorded/);
    }
  });

  it("returns real snapshots oldest->newest and honours limit", () => {
    for (let i = 1; i <= 4; i++) recordDistrictSnapshot({ districtId: "w", buildingCount: i, population: i * 10, activeUsers: null, at: new Date(1e12 + i * 1000).toISOString() });
    const t = readDistrictTimeline("w");
    assert.deepEqual(t.snapshots.map((s) => s.buildingCount), [1, 2, 3, 4]);
    assert.equal(t.reason, undefined);
    assert.equal(t.snapshots[0].activeUsers, null);
    assert.deepEqual(readDistrictTimeline("w", { limit: "2" }).snapshots.map((s) => s.buildingCount), [3, 4]);
  });
});

// Reviewer: querying an unknown id must not grow the persisted store.
import { describe as _d2, it as _i2 } from "node:test";
import _a2 from "node:assert/strict";
import { listDistrictSnapshots as _list2 } from "../domains/district.js";
_d2("timeline read is side-effect free", () => {
  _i2("unknown id adds no Map entry", () => {
    const m = globalThis._concordSTATE?.districtSnapshots;
    const before = m instanceof Map ? m.size : 0;
    const r = _list2("zk-never-recorded-" + Date.now());
    _a2.equal(r.ok, true);
    _a2.equal(r.result.count, 0);
    const after = globalThis._concordSTATE.districtSnapshots.size;
    _a2.equal(after, before);
  });
});
