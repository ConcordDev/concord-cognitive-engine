import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { findActiveUserRowByEmail, emailsMatchIgnoreCase } from "../lib/user-email-lookup.js";

let db;
function add(id, email, { active = 1, createdAt = "2026-01-01T00:00:00Z" } = {}) {
  db.prepare("INSERT INTO users (id, username, email, password_hash, role, scopes, created_at, last_login_at, is_active) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, `u_${id}`, email, "h", "member", "[]", createdAt, null, active);
}

describe("findActiveUserRowByEmail", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, email TEXT UNIQUE NOT NULL, password_hash TEXT,
      role TEXT, scopes TEXT, created_at TEXT, last_login_at TEXT, is_active INTEGER DEFAULT 1)`);
  });

  it("finds a legacy mixed-case row from its lower-case twin (blocks duplicate sign-up)", () => {
    add("1", "Bob@Example.com");
    assert.equal(findActiveUserRowByEmail(db, "bob@example.com")?.id, "1");
  });

  it("finds a lower-case row from a mixed-case lookup (login)", () => {
    add("1", "bob@example.com");
    assert.equal(findActiveUserRowByEmail(db, "BOB@Example.COM")?.id, "1");
  });

  it("prefers the exact-case row when two case-variants coexist", () => {
    add("1", "Bob@example.com", { createdAt: "2026-01-01T00:00:00Z" });
    add("2", "bob@example.com", { createdAt: "2026-02-01T00:00:00Z" });
    assert.equal(findActiveUserRowByEmail(db, "bob@example.com")?.id, "2");
  });

  it("falls back to the oldest account when no exact match exists among variants", () => {
    add("1", "BOB@example.com", { createdAt: "2026-03-01T00:00:00Z" });
    add("2", "Bob@example.com", { createdAt: "2026-01-01T00:00:00Z" });
    assert.equal(findActiveUserRowByEmail(db, "bob@example.com")?.id, "2");
  });

  it("ignores inactive accounts and unknown addresses", () => {
    add("1", "Gone@example.com", { active: 0 });
    assert.equal(findActiveUserRowByEmail(db, "gone@example.com"), null);
    assert.equal(findActiveUserRowByEmail(db, "nobody@example.com"), null);
  });

  it("rejects non-string / empty input without querying", () => {
    assert.equal(findActiveUserRowByEmail(db, undefined), null);
    assert.equal(findActiveUserRowByEmail(db, ""), null);
    assert.equal(findActiveUserRowByEmail(db, { $ne: 1 }), null);
  });

  it("does not treat LIKE wildcards in the address as patterns", () => {
    add("1", "bob@example.com");
    assert.equal(findActiveUserRowByEmail(db, "%@example.com"), null);
    assert.equal(findActiveUserRowByEmail(db, "b_b@example.com"), null);
  });
});

describe("emailsMatchIgnoreCase", () => {
  it("compares case-insensitively and rejects non-strings", () => {
    assert.equal(emailsMatchIgnoreCase("A@x.com", "a@X.com"), true);
    assert.equal(emailsMatchIgnoreCase("a@x.com", "b@x.com"), false);
    assert.equal(emailsMatchIgnoreCase(null, "a@x.com"), false);
  });
});

describe("server.js wiring", () => {
  const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  it("AuthDB.getUserByEmail goes through the case-insensitive helper", () => {
    const body = src.slice(src.indexOf("getUserByEmail(email) {"), src.indexOf("getUserByEmail(email) {") + 1200);
    assert.match(body, /findActiveUserRowByEmail\(db, email\)/);
    assert.doesNotMatch(body, /WHERE email = \?/);
  });
});
