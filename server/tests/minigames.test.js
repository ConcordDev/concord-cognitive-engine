/**
 * Sports minigame test suite — basketball + racing.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up106 } from "../migrations/106_minigame_matches.js";
import {
  createMatch as bbCreate,
  recordShot,
  endMatch as bbEnd,
  getMatch as bbGet,
  HOOP_REACH_M,
  TWO_POINT_RADIUS_M,
} from "../lib/minigames/basketball.js";
import {
  createRace,
  recordCheckpoint,
  getRace,
  VEHICLE_MAX_SPEED_M_S,
} from "../lib/minigames/racing.js";

function setupDb() {
  const db = new Database(":memory:");
  up106(db);
  return db;
}

describe("basketball: createMatch", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("creates a match with default target", () => {
    const r = bbCreate(db, { challengerId: "u1", opponentId: "u2" });
    assert.equal(r.ok, true);
    assert.ok(r.matchId);
    const m = bbGet(db, r.matchId);
    assert.equal(m.kind, "basketball");
    assert.equal(m.players.length, 2);
    assert.equal(m.scores["u1"], 0);
  });

  it("rejects self-play", () => {
    const r = bbCreate(db, { challengerId: "u1", opponentId: "u1" });
    assert.equal(r.ok, false);
  });

  it("rejects missing args", () => {
    const r = bbCreate(db, { challengerId: "u1" });
    assert.equal(r.ok, false);
  });
});

describe("basketball: recordShot", () => {
  let db, matchId;
  beforeEach(() => {
    db = setupDb();
    const r = bbCreate(db, { challengerId: "u1", opponentId: "u2", hoopPosition: { x: 0, z: 0 }, targetScore: 5 });
    matchId = r.matchId;
  });

  it("rejects shots out of reach", () => {
    const r = recordShot(db, matchId, {
      shooterId: "u1", shooterPos: { x: 100, z: 100 }, made: true,
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "out_of_reach");
  });

  it("scores 2 points for inside-the-arc shots", () => {
    const r = recordShot(db, matchId, {
      shooterId: "u1", shooterPos: { x: 3, z: 0 }, made: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.points, 2);
    assert.equal(r.scoreNow.u1, 2);
  });

  it("scores 3 points beyond the arc", () => {
    const r = recordShot(db, matchId, {
      shooterId: "u1",
      shooterPos: { x: TWO_POINT_RADIUS_M + 1, z: 0 },
      made: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.points, 3);
  });

  it("missed shot scores 0", () => {
    const r = recordShot(db, matchId, {
      shooterId: "u1", shooterPos: { x: 3, z: 0 }, made: false,
    });
    assert.equal(r.ok, true);
    assert.equal(r.points, 0);
    assert.equal(r.eventKind, "shot_missed");
  });

  it("ends match when target score reached", () => {
    // First made-3 = 3; second made-3 = 6 ≥ 5 target → match ends
    recordShot(db, matchId, { shooterId: "u1", shooterPos: { x: TWO_POINT_RADIUS_M + 1, z: 0 }, made: true });
    const r = recordShot(db, matchId, { shooterId: "u1", shooterPos: { x: TWO_POINT_RADIUS_M + 1, z: 0 }, made: true });
    assert.equal(r.ended, true);
    assert.equal(r.winner, "u1");
    const m = bbGet(db, matchId);
    assert.equal(m.status, "ended");
  });

  it("rejects non-player shots", () => {
    const r = recordShot(db, matchId, {
      shooterId: "u3", shooterPos: { x: 3, z: 0 }, made: true,
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_a_player");
  });
});

describe("racing: createRace", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("creates a race with multiple racers", () => {
    const r = createRace(db, { trackId: "track1", racerIds: ["u1", "u2", "u3"] });
    assert.equal(r.ok, true);
    const race = getRace(db, r.raceId);
    assert.equal(race.players.length, 3);
    assert.equal(race.scores.u1.lap, 0);
  });

  it("rejects empty racer list", () => {
    const r = createRace(db, { trackId: "track1", racerIds: [] });
    assert.equal(r.ok, false);
  });
});

describe("racing: recordCheckpoint anti-cheat", () => {
  let db, raceId;
  beforeEach(() => {
    db = setupDb();
    const r = createRace(db, {
      trackId: "track1", racerIds: ["u1"], lapCount: 1,
      allowedVehicleClasses: ["car"],
    });
    raceId = r.raceId;
  });

  it("rejects checkpoint with wrong vehicle class", () => {
    const r = recordCheckpoint(db, raceId, {
      racerId: "u1",
      checkpointIdx: 0,
      checkpointPos: { x: 10, z: 0 },
      vehicleClass: "plane", // not in allowed list
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "vehicle_class_not_allowed");
  });

  it("first checkpoint accepted without prev-checkpoint check", () => {
    const r = recordCheckpoint(db, raceId, {
      racerId: "u1",
      checkpointIdx: 0,
      checkpointPos: { x: 10, z: 0 },
      vehicleClass: "car",
    });
    assert.equal(r.ok, true);
  });

  it("rejects impossible time delta (faster than max speed)", () => {
    // First checkpoint at (0, 0) right now
    recordCheckpoint(db, raceId, {
      racerId: "u1", checkpointIdx: 0,
      checkpointPos: { x: 0, z: 0 },
      vehicleClass: "car",
      t: Date.now(),
    });
    // Second checkpoint 1000m away in 1ms — way faster than 40 m/s car
    const r = recordCheckpoint(db, raceId, {
      racerId: "u1", checkpointIdx: 1,
      checkpointPos: { x: 1000, z: 0 },
      prevCheckpointPos: { x: 0, z: 0 },
      vehicleClass: "car",
      t: Date.now() + 1,
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "checkpoint_too_fast");
  });

  it("plane class allows higher speeds", () => {
    const r = createRace(db, {
      trackId: "track-air", racerIds: ["u1"], lapCount: 1,
      allowedVehicleClasses: ["plane"],
    });
    recordCheckpoint(db, r.raceId, {
      racerId: "u1", checkpointIdx: 0,
      checkpointPos: { x: 0, z: 0 },
      vehicleClass: "plane",
      t: Date.now() - 5000,
    });
    // 500m in 5s = 100 m/s, well within plane's 150 m/s
    const cp = recordCheckpoint(db, r.raceId, {
      racerId: "u1", checkpointIdx: 1,
      checkpointPos: { x: 500, z: 0 },
      prevCheckpointPos: { x: 0, z: 0 },
      vehicleClass: "plane",
      t: Date.now(),
    });
    assert.equal(cp.ok, true);
  });
});

describe("racing: lap progression", () => {
  let db, raceId;
  beforeEach(() => {
    db = setupDb();
    const r = createRace(db, {
      trackId: "track-loop", racerIds: ["u1"], lapCount: 1,
      allowedVehicleClasses: ["car"],
    });
    raceId = r.raceId;
  });

  it("ends race when racer completes lapCount laps", () => {
    // Checkpoint sequence: 0 → 1 → 0 (lap complete)
    recordCheckpoint(db, raceId, {
      racerId: "u1", checkpointIdx: 0,
      checkpointPos: { x: 0, z: 0 },
      vehicleClass: "car", t: Date.now() - 10000,
    });
    recordCheckpoint(db, raceId, {
      racerId: "u1", checkpointIdx: 1,
      checkpointPos: { x: 50, z: 0 },
      prevCheckpointPos: { x: 0, z: 0 },
      vehicleClass: "car", t: Date.now() - 5000,
    });
    const final = recordCheckpoint(db, raceId, {
      racerId: "u1", checkpointIdx: 0,
      checkpointPos: { x: 0, z: 0 },
      prevCheckpointPos: { x: 50, z: 0 },
      vehicleClass: "car", t: Date.now(),
    });
    assert.equal(final.ok, true);
    assert.equal(final.ended, true);
    assert.equal(final.winner, "u1");
  });
});

describe("vehicle max speeds", () => {
  it("car < glider < plane", () => {
    assert.ok(VEHICLE_MAX_SPEED_M_S.car < VEHICLE_MAX_SPEED_M_S.glider);
    assert.ok(VEHICLE_MAX_SPEED_M_S.glider < VEHICLE_MAX_SPEED_M_S.plane);
  });
});

describe("HOOP / arc constants sanity", () => {
  it("two-point radius < hoop reach", () => {
    assert.ok(TWO_POINT_RADIUS_M < HOOP_REACH_M);
  });
});
