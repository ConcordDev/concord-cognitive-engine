import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import registerSessions from "../domains/sessions.js";

function openDb() {
  const db = new DatabaseSync(":memory:");
  if (typeof db.transaction !== "function") db.transaction = (fn) => () => fn();
  db.exec(`
    CREATE TABLE lens_sessions (
      id TEXT PRIMARY KEY, user_id TEXT, lens_id TEXT, title TEXT, status TEXT,
      current_step TEXT, state_json TEXT, step_count INTEGER, created_at INTEGER,
      updated_at INTEGER, closed_at INTEGER
    );
    CREATE TABLE lens_session_events (
      id INTEGER PRIMARY KEY, session_id TEXT, event_kind TEXT, from_step TEXT,
      to_step TEXT, note TEXT, payload_json TEXT, created_at INTEGER
    );
  `);
  return db;
}

describe("sessions.remove", () => {
  it("deletes the caller's session and events, and not someone else's", async () => {
    const db = openDb();
    db.prepare(`INSERT INTO lens_sessions (id, user_id, title, status, current_step, state_json, step_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run("s1", "ada", "Mine", "open", "start", "{}", 1, 1, 1);
    db.prepare(`INSERT INTO lens_sessions (id, user_id, title, status, current_step, state_json, step_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run("s2", "bea", "Hers", "open", "start", "{}", 1, 1, 1);
    db.prepare(`INSERT INTO lens_session_events (session_id, event_kind, created_at) VALUES (?,?,?)`).run("s1", "started", 1);
    const macros = new Map();
    registerSessions((domain, name, fn) => macros.set(`${domain}.${name}`, fn));
    const remove = macros.get("sessions.remove");
    const ada = { db, actor: { userId: "ada" } };
    const missing = await remove(ada, { sessionId: "s2" });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "not_found");
    assert.equal(db.prepare(`SELECT id FROM lens_sessions WHERE id = 's2'`).get().id, "s2");
    const gone = await remove(ada, { sessionId: "s1" });
    assert.equal(gone.ok, true);
    assert.equal(db.prepare(`SELECT id FROM lens_sessions WHERE id = 's1'`).get(), undefined);
    assert.equal(db.prepare(`SELECT id FROM lens_session_events WHERE session_id = 's1'`).get(), undefined);
    db.close();
  });
});
