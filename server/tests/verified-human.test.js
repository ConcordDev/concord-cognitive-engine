import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migrateVerifiedHuman } from "../migrations/314_verified_human.js";
import {
  verifyHuman, setBadgeVisible, isVerifiedHuman, badgeVisibleFor, filterVerifiedHuman, statusFor,
} from "../lib/verified-human.js";

// Universal Move System — opt-in verified-human badge. Default indistinguishable;
// verify is opt-in; display is separately opt-in; synthetic agents are ineligible
// by construction (they never verify).

function freshDb() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT)");
  db.prepare("INSERT INTO users (id, username) VALUES ('human1','Ada'), ('agent1','Bot'), ('human2','Lin')").run();
  migrateVerifiedHuman(db); // adds verified_human / verified_human_at / badge_visible
  return db;
}

test("default: nobody is verified (world is indistinguishable)", () => {
  const db = freshDb();
  assert.equal(isVerifiedHuman(db, "human1"), false);
  assert.equal(badgeVisibleFor(db, "human1"), false);
});

test("verify is opt-in + idempotent; display defaults visible", () => {
  const db = freshDb();
  assert.equal(verifyHuman(db, "human1").ok, true);
  assert.equal(isVerifiedHuman(db, "human1"), true);
  assert.equal(badgeVisibleFor(db, "human1"), true); // badge_visible defaults 1
  const at = db.prepare("SELECT verified_human_at FROM users WHERE id='human1'").get().verified_human_at;
  verifyHuman(db, "human1"); // idempotent — timestamp preserved
  assert.equal(db.prepare("SELECT verified_human_at FROM users WHERE id='human1'").get().verified_human_at, at);
});

test("verified-but-private: can hide the badge while staying verified", () => {
  const db = freshDb();
  verifyHuman(db, "human1");
  setBadgeVisible(db, "human1", false);
  assert.equal(isVerifiedHuman(db, "human1"), true);    // still verified
  assert.equal(badgeVisibleFor(db, "human1"), false);   // but not displayed
});

test("verified-human-only filter keeps only verified ids (agents excluded)", () => {
  const db = freshDb();
  verifyHuman(db, "human1");
  verifyHuman(db, "human2");
  // agent1 never verifies → ineligible by construction
  assert.deepEqual(filterVerifiedHuman(db, ["human1", "agent1", "human2"]).sort(), ["human1", "human2"]);
});

test("kill-switch CONCORD_VERIFIED_HUMAN_BADGE=0 disables the surface", () => {
  const db = freshDb();
  verifyHuman(db, "human1");
  const prev = process.env.CONCORD_VERIFIED_HUMAN_BADGE;
  process.env.CONCORD_VERIFIED_HUMAN_BADGE = "0";
  try {
    assert.equal(isVerifiedHuman(db, "human1"), false);
    assert.equal(statusFor(db, "human1").available, false);
  } finally {
    if (prev === undefined) delete process.env.CONCORD_VERIFIED_HUMAN_BADGE;
    else process.env.CONCORD_VERIFIED_HUMAN_BADGE = prev;
  }
});
