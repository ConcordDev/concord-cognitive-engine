/**
 * Tier-2 contract tests for the async-cooperation player-signs
 * substrate (Theme deferred, game-feel pass).
 *
 * Pins:
 *   - placeSign rejects bad inputs (missing fields, bad kind, bad coords)
 *   - placeSign respects MAX_ACTIVE_PER_USER
 *   - placeSign respects PLACE_COOLDOWN_S
 *   - signsNearby returns sorted-by-recency, radius-filtered rows
 *   - signsNearby skips expired rows
 *   - removeSign is owner-only
 *   - cleanupExpiredSigns hard-deletes past-TTL rows
 *   - emit fires on placeSign with shape {worldId, kind, ...} on
 *     world:<id> channel
 *   - heartbeat runs without throwing on missing/empty db
 *
 * Run: node --test tests/player-signs.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  placeSign,
  signsNearby,
  mySigns,
  removeSign,
  cleanupExpiredSigns,
  ALLOWED_KINDS,
  MAX_ACTIVE_PER_USER,
} from "../lib/player-signs.js";
import { runPlayerSignsCleanup } from "../emergent/player-signs-cleanup.js";
import { up as up146 } from "../migrations/146_player_signs.js";

function setupDb() {
  const db = new Database(":memory:");
  up146(db);
  return db;
}

function installFakeRealtime() {
  const calls = [];
  globalThis.__CONCORD_REALTIME__ = {
    io: {
      to(channel) {
        return {
          emit(event, payload) { calls.push({ channel, event, payload }); },
        };
      },
    },
  };
  return calls;
}

function clearRealtime() { delete globalThis.__CONCORD_REALTIME__; }

describe("placeSign — input validation + emit", () => {
  let db, calls;
  beforeEach(() => { db = setupDb(); calls = installFakeRealtime(); });
  afterEach(() => clearRealtime());

  it("rejects missing fields", () => {
    assert.equal(placeSign(db, { userId: "u1" }).ok, false);
    assert.equal(placeSign(db, { userId: "u1", worldId: "w1" }).ok, false);
    assert.equal(
      placeSign(db, { userId: "u1", worldId: "w1", position: { x: 0, z: 0 } }).reason,
      "bad_kind",
    );
  });

  it("rejects unknown kind", () => {
    const r = placeSign(db, {
      userId: "u1", worldId: "w1", position: { x: 0, z: 0 }, kind: "asteroid",
    });
    assert.equal(r.reason, "bad_kind");
  });

  it("places + emits world:sign-placed", () => {
    const r = placeSign(db, {
      userId: "u1", worldId: "concordia-hub",
      position: { x: 10, y: 0, z: 5 }, kind: "arrow", message: "this way",
    });
    assert.equal(r.ok, true);
    assert.equal(r.sign.kind, "arrow");
    assert.equal(r.sign.message, "this way");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].event, "world:sign-placed");
    assert.equal(calls[0].channel, "world:concordia-hub");
    assert.equal(calls[0].payload.kind, "arrow");
  });

  it("truncates messages > 80 chars", () => {
    const long = "x".repeat(120);
    const r = placeSign(db, {
      userId: "u1", worldId: "w1",
      position: { x: 0, z: 0 }, kind: "warning", message: long,
    });
    assert.equal(r.ok, true);
    assert.equal(r.sign.message.length, 80);
  });
});

describe("placeSign — caps + cooldowns", () => {
  let db;
  beforeEach(() => {
    db = setupDb();
    installFakeRealtime();
  });
  afterEach(() => clearRealtime());

  it("respects MAX_ACTIVE_PER_USER", () => {
    // Seed MAX_ACTIVE_PER_USER signs directly to bypass cooldown.
    const now = Math.floor(Date.now() / 1000);
    const ins = db.prepare(`
      INSERT INTO player_signs (id, world_id, user_id, x, y, z, kind, message, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < MAX_ACTIVE_PER_USER; i++) {
      ins.run(`s_${i}`, "w1", "u1", i, 0, 0, "poi", null, now - i, now + 86400);
    }
    const r = placeSign(db, {
      userId: "u1", worldId: "w1",
      position: { x: 100, z: 100 }, kind: "poi",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "active_limit");
    assert.equal(r.active, MAX_ACTIVE_PER_USER);
  });

  it("respects PLACE_COOLDOWN_S", () => {
    const r1 = placeSign(db, {
      userId: "u1", worldId: "w1",
      position: { x: 0, z: 0 }, kind: "praise",
    });
    assert.equal(r1.ok, true);
    const r2 = placeSign(db, {
      userId: "u1", worldId: "w1",
      position: { x: 5, z: 5 }, kind: "help",
    });
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, "cooldown");
  });
});

describe("signsNearby + mySigns", () => {
  let db;
  beforeEach(() => {
    db = setupDb();
    installFakeRealtime();
    // Seed 4 signs across 2 users; 2 in radius, 1 far, 1 expired.
    const now = Math.floor(Date.now() / 1000);
    const ins = db.prepare(`
      INSERT INTO player_signs (id, world_id, user_id, x, y, z, kind, message, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    ins.run("s_close",  "w1", "u1", 5,  0, 5,  "arrow", null, now - 10, now + 100);
    ins.run("s_close2", "w1", "u2", 8,  0, 6,  "help",  null, now - 5,  now + 100);
    ins.run("s_far",    "w1", "u1", 200, 0, 200, "poi", null, now - 1,  now + 100);
    ins.run("s_expired","w1", "u1", 6,  0, 6,  "warning", null, now - 1000, now - 10);
  });
  afterEach(() => clearRealtime());

  it("returns active signs within radius, sorted by recency", () => {
    const got = signsNearby(db, {
      worldId: "w1", position: { x: 0, z: 0 }, radiusM: 30,
    });
    assert.equal(got.length, 2);
    // Most recent first
    assert.equal(got[0].id, "s_close2");
    assert.equal(got[1].id, "s_close");
  });

  it("excludes signs past their expires_at", () => {
    const got = signsNearby(db, { worldId: "w1", position: { x: 6, z: 6 }, radiusM: 30 });
    assert.ok(got.every((s) => s.id !== "s_expired"));
  });

  it("excludes signs outside radius", () => {
    const got = signsNearby(db, { worldId: "w1", position: { x: 0, z: 0 }, radiusM: 30 });
    assert.ok(got.every((s) => s.id !== "s_far"));
  });

  it("returns world-wide list when no position given", () => {
    const got = signsNearby(db, { worldId: "w1", limit: 100 });
    assert.equal(got.length, 3); // all active in w1 (close, close2, far) — expired excluded
  });

  it("mySigns returns only that user's active signs", () => {
    const got = mySigns(db, { userId: "u1" });
    assert.equal(got.length, 2); // close + far; expired excluded
    assert.ok(got.every((s) => s.user_id === "u1"));
  });
});

describe("removeSign + cleanupExpiredSigns + heartbeat", () => {
  let db;
  beforeEach(() => {
    db = setupDb();
    installFakeRealtime();
  });
  afterEach(() => clearRealtime());

  it("removeSign is owner-only", () => {
    const r = placeSign(db, {
      userId: "u1", worldId: "w1",
      position: { x: 0, z: 0 }, kind: "arrow",
    });
    const id = r.sign.id;
    const denied = removeSign(db, { userId: "u2", signId: id });
    assert.equal(denied.ok, false);
    const allowed = removeSign(db, { userId: "u1", signId: id });
    assert.equal(allowed.ok, true);
  });

  it("removeSign reports not_found for unknown ids", () => {
    const r = removeSign(db, { userId: "u1", signId: "sign_does_not_exist" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_found_or_forbidden");
  });

  it("cleanupExpiredSigns deletes past-TTL rows", () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO player_signs (id, world_id, user_id, x, y, z, kind, message, created_at, expires_at)
      VALUES ('s_old', 'w1', 'u1', 0, 0, 0, 'poi', null, ?, ?)
    `).run(now - 1000, now - 5);
    const removed = cleanupExpiredSigns(db);
    assert.equal(removed, 1);
  });

  it("heartbeat runs without throwing on empty db", async () => {
    const r = await runPlayerSignsCleanup({ db });
    assert.equal(r.ok, true);
    assert.equal(r.removed, 0);
  });

  it("heartbeat reason='disabled' under kill-switch", async () => {
    process.env.CONCORD_PLAYER_SIGNS_CLEANUP = "0";
    const r = await runPlayerSignsCleanup({ db });
    delete process.env.CONCORD_PLAYER_SIGNS_CLEANUP;
    assert.equal(r.ok, false);
    assert.equal(r.reason, "disabled");
  });

  it("heartbeat reason='no_db' when db missing", async () => {
    const r = await runPlayerSignsCleanup({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });
});

describe("ALLOWED_KINDS sanity", () => {
  it("contains the documented five kinds", () => {
    assert.deepEqual(
      Array.from(ALLOWED_KINDS).sort(),
      ["arrow", "help", "poi", "praise", "warning"],
    );
  });
});
