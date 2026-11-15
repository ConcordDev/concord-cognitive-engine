// Audit fix sweep (PR #2356) — FIX-courtship-003: partners rendered
// as raw ids in the courtship lens, and a past marriage showed a bare
// "player:" because the presenters strip the other player's raw
// account id without putting a name in its place. Rows now carry
// partner_name / partner_handle resolved the way mail names
// correspondents: players through the users table, an NPC's id is its
// world name, an unresolvable player carries nulls — never the raw id.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  listMyCourtships, listMyMarriages, presentCourtship,
} from "../lib/romance-engine.js";

let db;
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, display_name TEXT);
    CREATE TABLE player_courtship (
      player_user_id TEXT NOT NULL, partner_kind TEXT NOT NULL, partner_id TEXT NOT NULL,
      affinity REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'acquainted',
      started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_interaction INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (player_user_id, partner_kind, partner_id)
    );
    CREATE TABLE player_marriages (
      id TEXT PRIMARY KEY, player_user_id TEXT NOT NULL, partner_kind TEXT NOT NULL,
      partner_id TEXT NOT NULL, married_at INTEGER NOT NULL DEFAULT (unixepoch()),
      dissolved_at INTEGER, dissolved_reason TEXT
    );
  `);
  db.prepare("INSERT INTO users (id, username, display_name) VALUES ('u-bob', 'bobby', 'Bob Rivers')").run();
  db.prepare("INSERT INTO users (id, username, display_name) VALUES ('u-cid', 'cid', NULL)").run();
});

describe("courtship partner names", () => {
  it("courtship rows name player partners from the users table and NPCs by their world name", () => {
    db.prepare("INSERT INTO player_courtship (player_user_id, partner_kind, partner_id, affinity, status) VALUES ('u-alice', 'player', 'u-bob', 0.5, 'acquainted')").run();
    db.prepare("INSERT INTO player_courtship (player_user_id, partner_kind, partner_id, affinity, status) VALUES ('u-alice', 'npc', 'innkeeper-mara', 0.2, 'acquainted')").run();
    db.prepare("INSERT INTO player_courtship (player_user_id, partner_kind, partner_id, affinity, status) VALUES ('u-alice', 'player', 'u-ghost', 0.1, 'acquainted')").run();
    const rows = listMyCourtships(db, "u-alice");
    const by = Object.fromEntries(rows.map((r) => [r.partner_id, r]));
    assert.equal(by["u-bob"].partner_name, "Bob Rivers");
    assert.equal(by["u-bob"].partner_handle, "bobby");
    assert.equal(by["innkeeper-mara"].partner_name, "innkeeper-mara");
    assert.equal(by["u-ghost"].partner_name, null);
    assert.equal(by["u-ghost"].partner_handle, null);
  });

  it("a dissolved marriage to a player keeps a name even though the raw id is stripped", () => {
    db.prepare("INSERT INTO player_marriages (id, player_user_id, partner_kind, partner_id, dissolved_at, dissolved_reason) VALUES ('m1', 'u-alice', 'player', 'u-cid', 1700000000, 'drifted apart')").run();
    const past = listMyMarriages(db, "u-alice", false);
    assert.equal(past.length, 1);
    assert.equal(past[0].partner_id, undefined); // privacy strip stands
    assert.equal(past[0].partner_name, "cid"); // display_name null → username
  });

  it("presentCourtship strips the id but keeps the name", () => {
    const row = { player_user_id: "u-alice", partner_kind: "player", partner_id: "u-bob", affinity: 0.4, status: "acquainted" };
    const out = presentCourtship(row, "u-alice", db);
    assert.equal(out.partner_id, undefined);
    assert.equal(out.partner_name, "Bob Rivers");
  });
});
