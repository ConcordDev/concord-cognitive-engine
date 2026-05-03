// Tests for soundscape-bridge district playlist.
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { getDistrictPlaylist } from "../lib/soundscape-bridge.js";

function makeFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT,
      title TEXT,
      body_json TEXT,
      tags_json TEXT,
      visibility TEXT DEFAULT 'public',
      created_at TEXT
    );
  `);
  return db;
}

function insertTrack(db, { id, owner = "alice", title, tags, visibility = "public" }) {
  db.prepare(`
    INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, visibility, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    owner,
    title,
    JSON.stringify({ type: "music_track", durationMs: 180000 }),
    JSON.stringify(tags),
    visibility,
    new Date().toISOString(),
  );
}

describe("soundscape-bridge", () => {
  let db;
  before(() => {
    db = makeFixture();
    insertTrack(db, { id: "t1", title: "Plaza Calm", tags: ["soundscape", "district:plaza", "concordia", "mood:calm"] });
    insertTrack(db, { id: "t2", title: "Plaza Intense", tags: ["soundscape", "district:plaza", "concordia", "mood:intense"] });
    insertTrack(db, { id: "t3", title: "Forge Track", tags: ["soundscape", "district:forge", "concordia"] });
    insertTrack(db, { id: "t4", title: "Private Track", tags: ["soundscape", "district:plaza"], visibility: "private" });
    insertTrack(db, { id: "t5", title: "No Soundscape Tag", tags: ["district:plaza", "concordia"] });
  });

  test("returns tracks for the requested district", () => {
    const r = getDistrictPlaylist(db, "plaza");
    assert.equal(r.tracks.length, 2);
    const ids = r.tracks.map((t) => t.dtuId).sort();
    assert.deepEqual(ids, ["t1", "t2"]);
  });

  test("excludes private tracks", () => {
    const r = getDistrictPlaylist(db, "plaza");
    assert.equal(r.tracks.find((t) => t.dtuId === "t4"), undefined);
  });

  test("requires soundscape opt-in tag", () => {
    const r = getDistrictPlaylist(db, "plaza");
    assert.equal(r.tracks.find((t) => t.dtuId === "t5"), undefined);
  });

  test("filters by mood when provided", () => {
    const r = getDistrictPlaylist(db, "plaza", { mood: "calm" });
    assert.equal(r.tracks.length, 1);
    assert.equal(r.tracks[0].dtuId, "t1");
  });

  test("filters by universe when provided", () => {
    const r = getDistrictPlaylist(db, "plaza", { universe: "concordia" });
    assert.equal(r.tracks.length, 2);
    const r2 = getDistrictPlaylist(db, "plaza", { universe: "other-universe" });
    assert.equal(r2.tracks.length, 0);
  });

  test("returns empty for unknown district", () => {
    const r = getDistrictPlaylist(db, "nowhere");
    assert.deepEqual(r.tracks, []);
  });

  test("returns empty when db missing", () => {
    const r = getDistrictPlaylist(null, "plaza");
    assert.deepEqual(r.tracks, []);
  });
});
