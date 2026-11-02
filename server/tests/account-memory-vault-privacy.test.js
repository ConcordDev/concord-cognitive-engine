// memory_vault holds raw ~500-char chat "exchange" rows per user (context-orchestrator). It must be
// purged on account deletion and included in the data export, scoped strictly by user_id.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { executeAccountDeletion, exportUserData } from "../lib/account-lifecycle.js";
import { up as createMemoryVault } from "../migrations/413_memory_vault.js";

const A = "user-a";
const B = "user-b";

let db;
const vaultRows = (uid) => db.prepare("SELECT key, content FROM memory_vault WHERE user_id = ?").all(uid);

beforeEach(async () => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL DEFAULT 'x', role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login_at TEXT, is_active INTEGER NOT NULL DEFAULT 1
    );
  `);
  await createMemoryVault(db);
  for (const [id, name] of [[A, "alice"], [B, "bob"]]) {
    db.prepare("INSERT INTO users (id, username, email) VALUES (?, ?, ?)").run(id, name, `${name}@example.com`);
  }
  const ins = db.prepare("INSERT INTO memory_vault (user_id, kind, key, content, embedding, created_at) VALUES (?, 'exchange', ?, ?, ?, ?)");
  ins.run(A, "conscious:1", "alice secret exchange one", Buffer.from([1, 2, 3, 4]), 1000);
  ins.run(A, "conscious:2", "alice secret exchange two", null, 2000);
  ins.run(B, "conscious:3", "bob private exchange", null, 3000);
});

describe("memory_vault x account lifecycle", () => {
  it("deleting user A removes every A vault row and leaves B untouched", () => {
    const r = executeAccountDeletion(db, A);
    assert.equal(r.ok, true);
    assert.equal(vaultRows(A).length, 0);
    assert.deepEqual(vaultRows(B).map((x) => x.content), ["bob private exchange"]);
  });

  it("export for A includes A's vault rows (no embedding blob) and none of B's", () => {
    const r = exportUserData(db, A);
    assert.equal(r.ok !== false, true);
    const data = r.data ?? r;
    const rows = data.memoryVault;
    assert.equal(rows.length, 2);
    assert.ok(rows.every((x) => /^alice/.test(x.content)));
    assert.ok(rows.every((x) => !("embedding" in x) && !("user_id" in x)));
    assert.ok(!JSON.stringify(data).includes("bob private exchange"));
  });

  it("a DB without the table still deletes and exports cleanly", () => {
    db.exec("DROP TABLE memory_vault");
    assert.equal(executeAccountDeletion(db, A).ok, true);
    assert.equal(exportUserData(db, B).ok !== false, true);
  });
});
