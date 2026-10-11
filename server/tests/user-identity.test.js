import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { lookupUserIdentity } from "../lib/user-identity.js";

describe("lookupUserIdentity", () => {
  it("uses username when users has no display_name column", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT)`);
    db.prepare("INSERT INTO users (id, username) VALUES (?, ?)").run("u1", "ada");
    assert.deepEqual(lookupUserIdentity(db, "u1"), { username: "ada", displayName: "ada" });
    assert.deepEqual(lookupUserIdentity(db, "missing"), { username: null, displayName: null });
    db.close();
  });

  it("prefers display_name when that column exists", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, display_name TEXT)`);
    db.prepare("INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)").run("u1", "ada", "Ada Lovelace");
    assert.deepEqual(lookupUserIdentity(db, "u1"), { username: "ada", displayName: "Ada Lovelace" });
    db.close();
  });

  it("returns nulls when the table or the caller is missing", () => {
    const db = new Database(":memory:");
    assert.deepEqual(lookupUserIdentity(db, "u1"), { username: null, displayName: null });
    assert.deepEqual(lookupUserIdentity(null, "u1"), { username: null, displayName: null });
    db.close();
  });
});
