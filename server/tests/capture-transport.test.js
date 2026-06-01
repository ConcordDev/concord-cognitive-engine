// Temperament P5 contract — capture / carry / load / transport / deliver + escape.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up } from "../migrations/318_npc_captures.js";
import {
  captureNpc, advanceCapture, deliverCapture, attemptEscape, getCapture,
  listCaptivesFor, canTransition, CAPTURE_STAGES,
} from "../lib/capture-transport.js";
import { getCombatState } from "../lib/combat-restraint.js";

function withTemp(on, fn) {
  const prev = process.env.CONCORD_TEMPERAMENT;
  process.env.CONCORD_TEMPERAMENT = on ? "1" : "0";
  try { return fn(); } finally { if (prev === undefined) delete process.env.CONCORD_TEMPERAMENT; else process.env.CONCORD_TEMPERAMENT = prev; }
}
function db0() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT, combat_state TEXT NOT NULL DEFAULT 'active', morale REAL NOT NULL DEFAULT 1.0, surrendered_at INTEGER);`);
  up(db);
  return db;
}
function npc(db, id, state, morale = 1) {
  db.prepare(`INSERT INTO world_npcs (id, world_id, combat_state, morale) VALUES (?, 'w1', ?, ?)`).run(id, state, morale);
}

test("off → capture disabled (binary combat preserved)", () => {
  withTemp(false, () => {
    const db = db0(); npc(db, "n1", "surrendered");
    assert.equal(captureNpc(db, { npcId: "n1", captorId: "p1", worldId: "w1" }).ok, false);
  });
});

test("can only capture an hors-de-combat target", () => {
  withTemp(true, () => {
    const db = db0();
    npc(db, "fighter", "active");
    npc(db, "quit", "surrendered");
    assert.equal(captureNpc(db, { npcId: "fighter", captorId: "p1", worldId: "w1" }).ok, false);
    const ok = captureNpc(db, { npcId: "quit", captorId: "p1", worldId: "w1" });
    assert.equal(ok.ok, true);
    assert.equal(ok.stage, "captured");
  });
});

test("double-capture is rejected", () => {
  withTemp(true, () => {
    const db = db0(); npc(db, "quit", "downed");
    const a = captureNpc(db, { npcId: "quit", captorId: "p1", worldId: "w1" });
    const b = captureNpc(db, { npcId: "quit", captorId: "p2", worldId: "w1" });
    assert.equal(b.ok, false);
    assert.equal(b.reason, "already_captured");
    assert.equal(b.captureId, a.captureId);
  });
});

test("full chain: captured → carried → loaded(mount) → transported → delivered(jail) sets arrested", () => {
  withTemp(true, () => {
    const db = db0(); npc(db, "quit", "surrendered");
    const { captureId } = captureNpc(db, { npcId: "quit", captorId: "p1", worldId: "w1" });
    assert.equal(advanceCapture(db, captureId, "carried").ok, true);
    assert.equal(advanceCapture(db, captureId, "loaded", { carrierKind: "mount", carrierId: "m1" }).ok, true);
    assert.equal(getCapture(db, captureId).carrier_kind, "mount");
    assert.equal(advanceCapture(db, captureId, "transported").ok, true);
    const d = deliverCapture(db, captureId, "jail");
    assert.equal(d.ok, true);
    assert.equal(d.destination, "jail");
    assert.equal(getCombatState(db, "quit").combatState, "arrested");
  });
});

test("illegal transition rejected (can't load before carry from captured? captured→loaded illegal)", () => {
  withTemp(true, () => {
    const db = db0(); npc(db, "quit", "surrendered");
    const { captureId } = captureNpc(db, { npcId: "quit", captorId: "p1", worldId: "w1" });
    assert.equal(advanceCapture(db, captureId, "loaded").ok, false);
    assert.equal(canTransition("captured", "loaded"), false);
    assert.equal(canTransition("carried", "loaded"), true);
  });
});

test("ransom delivery records the CC owed for the caller to mint", () => {
  withTemp(true, () => {
    const db = db0(); npc(db, "quit", "surrendered");
    const { captureId } = captureNpc(db, { npcId: "quit", captorId: "p1", worldId: "w1" });
    advanceCapture(db, captureId, "carried");
    const d = deliverCapture(db, captureId, "ransom", { ransom: 120 });
    assert.equal(d.ok, true);
    assert.equal(d.ransomOwed, 120);
    assert.equal(d.captorId, "p1");
    assert.equal(getCapture(db, captureId).stage, "delivered");
  });
});

test("escape: deterministic roll frees the captive and reactivates it", () => {
  withTemp(true, () => {
    const db = db0(); npc(db, "quit", "downed", 1.0);
    const { captureId } = captureNpc(db, { npcId: "quit", captorId: "p1", worldId: "w1" });
    advanceCapture(db, captureId, "carried");
    const fail = attemptEscape(db, captureId, { roll: 0.99 });
    assert.equal(fail.escaped, false);
    const win = attemptEscape(db, captureId, { roll: 0.0 });
    assert.equal(win.escaped, true);
    assert.equal(getCapture(db, captureId).stage, "escaped");
    assert.equal(getCombatState(db, "quit").combatState, "active");
  });
});

test("a delivered capture can't escape, and listCaptivesFor excludes it", () => {
  withTemp(true, () => {
    const db = db0(); npc(db, "quit", "surrendered");
    const { captureId } = captureNpc(db, { npcId: "quit", captorId: "p1", worldId: "w1" });
    advanceCapture(db, captureId, "carried");
    assert.equal(listCaptivesFor(db, "p1").length, 1);
    deliverCapture(db, captureId, "jail");
    assert.equal(attemptEscape(db, captureId, { roll: 0 }).ok, false);
    assert.equal(listCaptivesFor(db, "p1").length, 0);
  });
});

test("CAPTURE_STAGES are the full chain", () => {
  assert.deepEqual(CAPTURE_STAGES, ["captured", "carried", "loaded", "transported", "delivered", "released", "escaped"]);
});
