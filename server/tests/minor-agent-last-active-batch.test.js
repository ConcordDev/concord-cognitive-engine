// #1939's syncIo named `INSERT INTO emergent_identity ... ON CONFLICT` holding the
// event loop 10.7 s at boot (EmergentMinorAgent._updateLastActive via
// MinorAgentScheduler.initialize). The write is now queued and flushed in one
// transaction after each scheduler tick: nothing is written at boot.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { EmergentMinorAgent, flushLastActive } from "../emergent/minor-agent.js";
import { MinorAgentScheduler } from "../emergent/minor-agent-scheduler.js";

function mkDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE emergent_identity (emergent_id TEXT PRIMARY KEY, given_name TEXT, last_active_at INTEGER)`);
  return db;
}
const count = (db) => db.prepare("SELECT count(*) c FROM emergent_identity").get().c;

describe("minor-agent last_active batching", () => {
  let db;
  beforeEach(() => { db = mkDb(); });

  it("_updateLastActive queues in memory and writes nothing", () => {
    const a = new EmergentMinorAgent("e1", db, () => {});
    a._updateLastActive();
    assert.ok(a._lastActiveDirty > 0);
    assert.equal(count(db), 0);
  });

  it("one flush upserts every dirty agent in a single transaction and clears the flag", () => {
    const agents = ["e1", "e2", "e3"].map((id) => { const a = new EmergentMinorAgent(id, db, () => {}); a._updateLastActive(); return a; });
    let txns = 0;
    const realTx = db.transaction.bind(db);
    db.transaction = (fn) => { txns++; return realTx(fn); };
    assert.equal(flushLastActive(db, agents), 3);
    assert.equal(txns, 1);
    assert.equal(count(db), 3);
    assert.ok(agents.every((a) => a._lastActiveDirty === 0));
    assert.equal(flushLastActive(db, agents), 0, "clean agents write nothing");
  });

  it("upserts over an existing identity row without touching other columns", () => {
    db.prepare("INSERT INTO emergent_identity (emergent_id, given_name, last_active_at) VALUES ('e1','Ada',1)").run();
    const a = new EmergentMinorAgent("e1", db, () => {});
    a._updateLastActive();
    flushLastActive(db, [a]);
    const row = db.prepare("SELECT * FROM emergent_identity WHERE emergent_id='e1'").get();
    assert.equal(row.given_name, "Ada");
    assert.ok(row.last_active_at > 1);
  });

  it("a failed flush keeps the agents dirty for the next tick and warns on SQLITE_BUSY", () => {
    const a = new EmergentMinorAgent("e1", db, () => {});
    a._updateLastActive();
    const warns = [];
    const w = console.warn; console.warn = (m) => warns.push(String(m));
    const busy = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    const failing = { prepare() { throw busy; } };
    try { assert.equal(flushLastActive(failing, [a]), 0); } finally { console.warn = w; }
    assert.ok(a._lastActiveDirty > 0);
    assert.match(warns.join(), /SQLITE_BUSY/);
    assert.equal(flushLastActive(db, [a]), 1, "retries and succeeds");
  });

  it("scheduler: registering agents at boot writes nothing; tickAll and stop flush", async () => {
    const sch = new MinorAgentScheduler(db, () => {});
    await sch.initialize(new Map([["e1", {}], ["e2", {}]]));
    assert.equal(count(db), 0, "no boot write");
    for (const a of sch.agents.values()) a.tick = async () => { a._updateLastActive(); return {}; };
    await sch.tickAll();
    assert.equal(count(db), 2);
    sch.agents.get("e1")._updateLastActive();
    sch.stop();
    assert.equal(sch.agents.get("e1")._lastActiveDirty, 0);
  });

  it("agent source no longer upserts per call", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../emergent/minor-agent.js", import.meta.url), "utf8");
    const m = src.slice(src.indexOf("  _updateLastActive() {"), src.indexOf("export function flushLastActive"));
    assert.doesNotMatch(m, /INSERT INTO emergent_identity/);
  });
});
