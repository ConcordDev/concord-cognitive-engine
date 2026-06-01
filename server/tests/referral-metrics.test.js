// F5 contract — referral / viral K-factor from world_invites.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { referralReport } from "../lib/referral-metrics.js";

function db0() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE world_invites (
    id TEXT PRIMARY KEY, from_user_id TEXT NOT NULL, to_user_id TEXT NOT NULL,
    world_id TEXT NOT NULL, world_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT, expires_at TEXT, responded_at TEXT);`);
  return db;
}
let _n = 0;
function invite(db, from, to, status) {
  db.prepare(`INSERT INTO world_invites (id, from_user_id, to_user_id, world_id, world_name, status) VALUES (?,?,?,?,?,?)`)
    .run(`i${_n++}`, from, to, "w1", "World", status);
}

test("empty invites → zeroed, non-viral", () => {
  const r = referralReport(db0());
  assert.equal(r.ok, true);
  assert.equal(r.invitesSent, 0);
  assert.equal(r.kFactor, 0);
  assert.equal(r.viral, false);
});

test("computes acceptance rate, invites-per-inviter, and K", () => {
  const db = db0();
  // 2 inviters, 4 invites, 2 accepted → acceptance 0.5, perInviter 2, K = 1.0 (viral)
  invite(db, "A", "x", "accepted");
  invite(db, "A", "y", "declined");
  invite(db, "B", "z", "accepted");
  invite(db, "B", "w", "pending");
  const r = referralReport(db);
  assert.equal(r.invitesSent, 4);
  assert.equal(r.accepted, 2);
  assert.equal(r.inviters, 2);
  assert.equal(r.acceptanceRate, 0.5);
  assert.equal(r.invitesPerInviter, 2);
  assert.equal(r.kFactor, 1);
  assert.equal(r.viral, true);
});

test("sub-viral when acceptance is low", () => {
  const db = db0();
  invite(db, "A", "x", "accepted");
  invite(db, "A", "y", "declined");
  invite(db, "A", "z", "declined");
  invite(db, "A", "w", "expired");
  const r = referralReport(db);
  assert.equal(r.acceptanceRate, 0.25);
  assert.equal(r.invitesPerInviter, 4);
  assert.equal(r.kFactor, 1); // 4 × 0.25
  // A second inviter who sends 1 declined drops perInviter → K below 1
  invite(db, "B", "q", "declined");
  const r2 = referralReport(db);
  assert.ok(r2.kFactor < 1, `expected sub-viral, got K=${r2.kFactor}`);
  assert.equal(r2.viral, false);
});

test("topInviters ranks by accepted then sent", () => {
  const db = db0();
  invite(db, "A", "x", "accepted");
  invite(db, "A", "y", "accepted");
  invite(db, "B", "z", "accepted");
  const r = referralReport(db);
  assert.equal(r.topInviters[0].userId, "A");
  assert.equal(r.topInviters[0].accepted, 2);
});

test("no_db is graceful", () => {
  assert.equal(referralReport(null).ok, false);
});
