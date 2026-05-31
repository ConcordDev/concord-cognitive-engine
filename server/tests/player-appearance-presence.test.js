// Wave 5b — the presence `avatar` field is filled so other players see the
// character a player created (it was always null; broadcastPositions shipped it
// empty). Pins loadPlayerState's appearance hydration + the kill-switch.
//
// Run: node --test tests/player-appearance-presence.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { configurePresence, loadPlayerState } from "../lib/city-presence.js";

function seed(db, { userAppearance = null, avatarAppearance = null } = {}) {
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, appearance_json TEXT);
    CREATE TABLE avatars (id TEXT PRIMARY KEY, user_id TEXT, appearance_json TEXT);
    CREATE TABLE player_world_state (
      user_id TEXT PRIMARY KEY, city_id TEXT, district_id TEXT,
      x REAL, y REAL, z REAL, rotation REAL, direction REAL,
      current_animation TEXT, action TEXT, health INTEGER, max_health INTEGER,
      stamina INTEGER, max_stamina INTEGER, client_state_json TEXT, last_seen_at INTEGER
    );
  `);
  db.prepare(`INSERT INTO users (id, appearance_json) VALUES ('u1', ?)`).run(userAppearance);
  if (avatarAppearance) {
    db.prepare(`INSERT INTO avatars (id, user_id, appearance_json) VALUES ('av1','u1',?)`).run(avatarAppearance);
  }
  db.prepare(`INSERT INTO player_world_state
    (user_id, city_id, x, y, z, health, max_health, stamina, max_stamina, client_state_json)
    VALUES ('u1','concordia-hub',1,0,2,100,100,100,100,'{}')`).run();
}

let db;
beforeEach(() => { db = new Database(":memory:"); });
afterEach(() => { delete process.env.CONCORD_PLAYER_APPEARANCE_SYNC; try { db.close(); } catch { /* noop */ } });

describe("Wave 5b — presence avatar fill", () => {
  it("fills entry.avatar from users.appearance_json", () => {
    seed(db, { userAppearance: JSON.stringify({ skinColor: "#815c49", bodyArchetype: "broad" }) });
    configurePresence({ db });
    const entry = loadPlayerState("u1");
    assert.ok(entry, "state loads");
    assert.equal(entry.avatar?.bodyArchetype, "broad");
    assert.equal(entry.avatar?.skinColor, "#815c49");
  });

  it("falls back to an avatars row when the user-level appearance is absent", () => {
    seed(db, { userAppearance: null, avatarAppearance: JSON.stringify({ bodyArchetype: "slim" }) });
    configurePresence({ db });
    assert.equal(loadPlayerState("u1").avatar?.bodyArchetype, "slim");
  });

  it("is null when no appearance is saved", () => {
    seed(db, {});
    configurePresence({ db });
    assert.equal(loadPlayerState("u1").avatar, null);
  });

  it("kill-switch off → avatar stays null (today's behavior)", () => {
    process.env.CONCORD_PLAYER_APPEARANCE_SYNC = "0";
    seed(db, { userAppearance: JSON.stringify({ bodyArchetype: "broad" }) });
    configurePresence({ db });
    assert.equal(loadPlayerState("u1").avatar, null);
  });
});
