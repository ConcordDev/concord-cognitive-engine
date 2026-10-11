// GET /api/account/export is the portable copy of one account.
// The router is mounted at /api/account, so the handler path is /export.
// /account/export stays as an alias for the doubled URL that already shipped.
//
// A signed-out request is 401. User B's export never contains user A's DTU.
// Delete then cancel round-trips scheduled → cancelled without removing the user.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import createAccountLifecycleRouter from "../routes/account-lifecycle.js";
import { exportUserData } from "../lib/account-lifecycle.js";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT,
      title TEXT NOT NULL,
      body_json TEXT NOT NULL DEFAULT '{}',
      tags_json TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL DEFAULT 'private',
      tier TEXT NOT NULL DEFAULT 'regular',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE chat_sessions (
      session_id TEXT PRIMARY KEY,
      owner_id TEXT,
      title TEXT,
      last_lens TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      msg_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE TABLE account_deletion_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'scheduled',
      balance_at_request REAL DEFAULT 0,
      forfeit_date TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );
  `);
  return db;
}

function appFor(db) {
  const app = express();
  app.use(express.json());
  app.use("/api/account", createAccountLifecycleRouter({
    db,
    requireAuth: () => (req, res, next) => {
      const id = req.headers["x-user-id"];
      if (!id) return res.status(401).json({ ok: false, error: "unauthorized" });
      req.user = { id: String(id) };
      next();
    },
  }));
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

describe("GET /api/account/export and deletion grace", () => {
  let db;
  let server;
  let base;

  before(async () => {
    db = createDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users (id, username, email, role, created_at) VALUES (?,?,?,?,?)")
      .run("user-a", "ada", "ada@example.com", "member", now);
    db.prepare("INSERT INTO users (id, username, email, role, created_at) VALUES (?,?,?,?,?)")
      .run("user-b", "bea", "bea@example.com", "member", now);
    db.prepare("INSERT INTO dtus (id, owner_user_id, title, body_json) VALUES (?,?,?,?)")
      .run("dtu-a", "user-a", "Ada note", JSON.stringify({ content: "created during the test" }));
    db.prepare("INSERT INTO dtus (id, owner_user_id, title) VALUES (?,?,?)")
      .run("dtu-b", "user-b", "Bea note");
    db.prepare("INSERT INTO dtus (id, owner_user_id, title) VALUES (?,?,?)")
      .run("dtu-system", "system", "System feed");
    db.prepare("INSERT INTO dtus (id, owner_user_id, title) VALUES (?,?,?)")
      .run("dtu-orphan", null, "Ownerless");
    db.prepare("INSERT INTO chat_sessions (session_id, owner_id, title, last_lens, created_at, updated_at, msg_count) VALUES (?,?,?,?,?,?,?)")
      .run("sess-a", "user-a", "Morning", "chat", 1, 2, 1);
    db.prepare("INSERT INTO chat_messages (session_id, role, content, ts) VALUES (?,?,?,?)")
      .run("sess-a", "user", "hello from the test", 2);

    const app = appFor(db);
    server = await listen(app);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });

  async function getExport(userId, path = "/api/account/export") {
    const headers = userId ? { "x-user-id": userId } : {};
    const res = await fetch(base + path, { headers });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  }

  it("returns 401 when signed out", async () => {
    const res = await getExport(null);
    assert.equal(res.status, 401);
    assert.equal(res.body.ok, false);
  });

  it("returns 200 with the caller's DTU and not another account's", async () => {
    const res = await getExport("user-a");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.dtus));
    const ids = res.body.dtus.map((d) => d.id);
    assert.ok(ids.includes("dtu-a"), "own DTU must be in the file");
    assert.ok(!ids.includes("dtu-b"), "user B's DTU must not be in user A's export");
    assert.ok(!ids.includes("dtu-system"), "system DTUs are not the caller's");
    assert.ok(!ids.includes("dtu-orphan"), "ownerless DTUs are not the caller's");
    assert.equal(res.body.user.id, "user-a");
    assert.equal(res.body.chats.sessions[0].session_id, "sess-a");
    assert.equal(res.body.chats.messages[0].content, "hello from the test");
    assert.equal(res.body.sessions.auth.length, 0);
    assert.ok(res.body.settings && res.body.settings.preferences, "settings must be present");
    assert.equal(res.body.privacy.spec, "concord-privacy-export/v1");
    assert.equal(res.body.privacy.userId, "user-a");
  });

  it("user B never sees user A's DTU", async () => {
    const res = await getExport("user-b");
    assert.equal(res.status, 200);
    const ids = res.body.dtus.map((d) => d.id);
    assert.deepEqual(ids, ["dtu-b"]);
    assert.equal(res.body.chats.sessions.length, 0);
    assert.equal(res.body.privacy.userId, "user-b");
  });

  it("keeps the doubled /api/account/account/export alias", async () => {
    const res = await getExport("user-a", "/api/account/account/export");
    assert.equal(res.status, 200);
    assert.ok(res.body.dtus.some((d) => d.id === "dtu-a"));
  });

  it("delete then cancel round-trips scheduled → cancelled", async () => {
    const del = await fetch(base + "/api/account/delete", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "user-a" },
      body: JSON.stringify({ confirm: "DELETE_MY_ACCOUNT" }),
    });
    const delBody = await del.json();
    assert.equal(del.status, 200);
    assert.equal(delBody.ok, true);
    assert.equal(delBody.scheduled, true);
    assert.equal(delBody.deletedImmediately, undefined);
    assert.equal(delBody.graceDays, 7);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE id = ?").get("user-a").c, 1);

    const status = await fetch(base + "/api/account/deletion", { headers: { "x-user-id": "user-a" } });
    const statusBody = await status.json();
    assert.equal(status.status, 200);
    assert.equal(statusBody.scheduled, true);

    const cancel = await fetch(base + "/api/account/account/cancel-deletion", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "user-a" },
      body: "{}",
    });
    const cancelBody = await cancel.json();
    assert.equal(cancel.status, 200);
    assert.equal(cancelBody.ok, true);
    assert.equal(cancelBody.cancelled, true);
    assert.equal(
      db.prepare("SELECT status FROM account_deletion_requests WHERE user_id = ?").get("user-a").status,
      "cancelled",
    );
    assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE id = ?").get("user-a").c, 1);

    const after = await fetch(base + "/api/account/deletion", { headers: { "x-user-id": "user-a" } });
    const afterBody = await after.json();
    assert.equal(afterBody.scheduled, false);
  });
});

describe("exportUserData includes live social posts", () => {
  let prior;
  before(() => { prior = globalThis._concordSTATE; });
  after(() => { globalThis._concordSTATE = prior; });

  it("merges this user's memory posts with SQL rows and leaves other users out", () => {
    const db = createDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users (id, username, email, role, created_at) VALUES (?,?,?,?,?)")
      .run("user-a", "ada", "ada@example.com", "member", now);
    db.exec(`
      CREATE TABLE social_posts (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        author_id TEXT,
        content TEXT,
        created_at INTEGER
      );
    `);
    db.prepare("INSERT INTO social_posts (id, user_id, author_id, content, created_at) VALUES (?,?,?,?,?)")
      .run("sql-1", "user-a", "user-a", "stored in sql", 10);
    globalThis._concordSTATE = {
      socialLens: {
        posts: new Map([
          ["mem-1", { id: "mem-1", userId: "user-a", body: "lens post", createdAt: "2026-10-10T12:00:00.000Z" }],
          ["mem-b", { id: "mem-b", userId: "user-b", body: "not mine", createdAt: "2026-10-10T12:00:00.000Z" }],
        ]),
      },
      _social: {
        posts: new Map([
          ["rest-1", { id: "rest-1", userId: "user-a", content: "rest post", createdAt: "2026-10-10T13:00:00.000Z" }],
        ]),
      },
    };
    const r = exportUserData(db, "user-a");
    assert.equal(r.ok, true);
    const ids = r.data.socialPosts.map((p) => p.id).sort();
    assert.deepEqual(ids, ["mem-1", "rest-1", "sql-1"]);
    assert.equal(r.data.socialPosts.find((p) => p.id === "mem-1").content, "lens post");
    assert.equal(r.data.socialPosts.some((p) => p.id === "mem-b"), false);
    db.close();
  });

  it("still returns memory posts when the social_posts table is missing", () => {
    const db = createDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users (id, username, email, role, created_at) VALUES (?,?,?,?,?)")
      .run("user-a", "ada", "ada@example.com", "member", now);
    globalThis._concordSTATE = {
      socialLens: { posts: new Map([["mem-2", { id: "mem-2", userId: "user-a", body: "only memory", createdAt: "2026-10-10T12:00:00.000Z" }]]) },
    };
    const r = exportUserData(db, "user-a");
    assert.equal(r.ok, true);
    assert.equal(r.data.socialPosts.length, 1);
    assert.equal(r.data.socialPosts[0].content, "only memory");
    db.close();
  });
});
