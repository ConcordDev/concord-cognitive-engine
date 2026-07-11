// Regression coverage for GET /api/social/users/search — the real,
// already-shipped user-lookup endpoint (server/routes/social-groups.js) that
// the mail lens's Wave-4 gap-closure pass (docs/lens-specs/mail-capability-map.md
// "Genuinely missing" -> CLOSED) and the message lens's own earlier fix both
// depend on via concord-frontend/components/message/RecipientSearchInput.tsx.
// The route previously had ZERO test coverage anywhere in the tree despite
// now being load-bearing for two lenses' recipient-picker UX — this pins its
// real contract (query, shape, and inactive-user exclusion) against a real
// migrated in-memory DB, not a mock.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import createSocialGroupRoutes from "../routes/social-groups.js";

function requireAuthStub() {
  return (req, res, next) => next();
}

function insertUser(db, { id, username, email, isActive = 1 }) {
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, created_at, is_active)
     VALUES (?, ?, ?, 'x', 'member', datetime('now'), ?)`
  ).run(id, username, email, isActive);
}

describe("GET /api/social/users/search — real DB-backed user lookup", () => {
  let db;
  let server;
  let baseUrl;

  before(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    insertUser(db, { id: "user_zara", username: "zara_the_bold", email: "zara@example.com" });
    insertUser(db, { id: "user_zane", username: "zane99", email: "zane@example.com" });
    insertUser(db, { id: "user_matches_by_email", username: "unrelated_handle", email: "findzaraq@example.com" });
    insertUser(db, { id: "user_inactive", username: "zara_gone", email: "gone@example.com", isActive: 0 });

    const app = express();
    app.use(express.json());
    app.use("/api/social", createSocialGroupRoutes({ db, requireAuth: requireAuthStub }));

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test("returns real matching users with id + username + displayName", async () => {
    const res = await fetch(`${baseUrl}/api/social/users/search?q=zara`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    const ids = body.users.map((u) => u.id);
    assert.ok(ids.includes("user_zara"), "username-substring match must be present");
    assert.ok(ids.includes("user_matches_by_email"), "email-substring match must be present");
    assert.ok(!ids.includes("user_zane"), "non-matching user must not be returned");
    for (const u of body.users) {
      assert.equal(typeof u.id, "string");
      assert.equal(typeof u.username, "string");
      assert.equal(typeof u.displayName, "string");
    }
  });

  test("excludes inactive users (is_active = 0)", async () => {
    const res = await fetch(`${baseUrl}/api/social/users/search?q=zara`);
    const body = await res.json();
    const ids = body.users.map((u) => u.id);
    assert.ok(!ids.includes("user_inactive"), "is_active=0 users must never surface as recipient candidates");
  });

  test("short queries (<2 chars) return an empty honest result, not an error", async () => {
    const res = await fetch(`${baseUrl}/api/social/users/search?q=z`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.users, []);
    assert.equal(body.total, 0);
  });

  test("no query returns an empty result, not all users", async () => {
    const res = await fetch(`${baseUrl}/api/social/users/search`);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.users, []);
  });

  test("results are capped at 20", async () => {
    for (let i = 0; i < 25; i++) {
      insertUser(db, { id: `user_bulk_${i}`, username: `bulkmatch_${i}`, email: `bulk${i}@example.com` });
    }
    const res = await fetch(`${baseUrl}/api/social/users/search?q=bulkmatch`);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.users.length <= 20, `expected <=20 results, got ${body.users.length}`);
  });
});
