// Phase CB6 — hidden object via photo tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createScene, playScene, submitFind, leaderboardForScene } from "../lib/hidden-object.js";
import { up as upHO } from "../migrations/250_hidden_object.js";

function freshDb() { const db = new Database(":memory:"); upHO(db); return db; }

const TARGETS = [
  { id: "key", label: "Bronze key", x: 10, y: 10, w: 20, h: 20 },
  { id: "vial", label: "Glass vial", x: 100, y: 50, w: 15, h: 15 },
  { id: "letter", label: "Sealed letter", x: 200, y: 100, w: 30, h: 30 },
];

describe("Phase CB6 — hidden object", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("createScene + playScene round-trip", () => {
    const s = createScene(db, "host", { sceneDtuId: "dtu-photo-1", title: "Library", targets: TARGETS });
    assert.equal(s.ok, true);
    const p = playScene(db, "u1", s.sceneId);
    assert.equal(p.ok, true);
  });

  it("invalid target shape rejected", () => {
    const r = createScene(db, "host", { sceneDtuId: "dtu-1", targets: [{ id: "bad" }] });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_target");
  });

  it("submitFind inside bbox marks target found", () => {
    const s = createScene(db, "host", { sceneDtuId: "dtu-1", targets: TARGETS });
    const p = playScene(db, "u1", s.sceneId);
    const f = submitFind(db, p.runId, { x: 15, y: 15 });
    assert.equal(f.found, true);
    assert.equal(f.foundId, "key");
    assert.equal(f.totalFound, 1);
    assert.equal(f.totalTargets, 3);
  });

  it("submitFind outside bbox doesn't mark found", () => {
    const s = createScene(db, "host", { sceneDtuId: "dtu-1", targets: TARGETS });
    const p = playScene(db, "u1", s.sceneId);
    const f = submitFind(db, p.runId, { x: 5000, y: 5000 });
    assert.equal(f.found, false);
  });

  it("dedupe: re-finding the same object returns found:false (already found)", () => {
    const s = createScene(db, "host", { sceneDtuId: "dtu-1", targets: TARGETS });
    const p = playScene(db, "u1", s.sceneId);
    submitFind(db, p.runId, { x: 15, y: 15 });
    const second = submitFind(db, p.runId, { x: 15, y: 15 });
    assert.equal(second.found, false);
  });

  it("finding all targets marks run finished", () => {
    const s = createScene(db, "host", { sceneDtuId: "dtu-1", targets: TARGETS });
    const p = playScene(db, "u1", s.sceneId);
    submitFind(db, p.runId, { x: 15, y: 15 });
    submitFind(db, p.runId, { x: 105, y: 55 });
    const last = submitFind(db, p.runId, { x: 210, y: 110 });
    assert.equal(last.complete, true);
    const board = leaderboardForScene(db, s.sceneId);
    assert.equal(board.length, 1);
    assert.equal(board[0].score, 3);
  });
});
