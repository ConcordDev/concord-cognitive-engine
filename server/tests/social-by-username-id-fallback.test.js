// GB-0489 (d): GET /api/social/users/by-username/<uuid> was a 404 x4 because the "people to follow" card opens
// /lenses/social/u/<userId>. The lookup now falls back to the user id after the handle misses.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { findUserByUsername } from "../lib/social-loop.js";
import { upsertProfile } from "../emergent/social-layer.js";

function dbWith(rows) {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, is_active INTEGER NOT NULL DEFAULT 1)");
  const ins = db.prepare("INSERT INTO users (id, username, is_active) VALUES (?, ?, ?)");
  for (const r of rows) ins.run(r.id, r.username, r.active ?? 1);
  return db;
}

describe("findUserByUsername id fallback", () => {
  const ID = "0a6c582d-1b7e-4f55-9c3a-aaaaaaaaaaaa";
  const db = dbWith([
    { id: ID, username: "Tester" },
    { id: "11111111-2222-3333-4444-555555555555", username: "gone", active: 0 },
  ]);
  const STATE = { db };

  it("still resolves by handle, case-insensitively", () => {
    assert.deepEqual(findUserByUsername(STATE, "tester").user, { id: ID, username: "Tester" });
  });

  it("resolves by user id when the handle misses (same response shape)", () => {
    const r = findUserByUsername(STATE, ID);
    assert.equal(r.ok, true);
    assert.deepEqual(r.user, { id: ID, username: "Tester" });
  });

  it("an inactive user's id is not found, nor is an unknown id", () => {
    assert.equal(findUserByUsername(STATE, "11111111-2222-3333-4444-555555555555").status, 404);
    assert.equal(findUserByUsername(STATE, "99999999-0000-0000-0000-000000000000").status, 404);
  });

  it("falls back to an in-memory social profile id when there is no users row", () => {
    const S = { db: dbWith([]), dtus: new Map() };
    upsertProfile(S, "user_abc123", { displayName: "Bea", isPublic: true });
    assert.deepEqual(findUserByUsername(S, "user_abc123").user, { id: "user_abc123", username: "Bea" });
  });

  it("a handle match wins over an id match, and too-short input is still a 400", () => {
    const d = dbWith([{ id: "ab", username: "zed" }, { id: "zed-id", username: "ab" }]);
    assert.equal(findUserByUsername({ db: d }, "ab").user.id, "zed-id", "username 'ab' beats id 'ab'");
    assert.equal(findUserByUsername({ db: d }, "a").status, 400);
  });
});
