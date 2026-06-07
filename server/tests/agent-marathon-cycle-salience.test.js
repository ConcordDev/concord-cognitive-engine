// Integration test for Wave 7 / E2 — salience gate LIVE on the agent marathon cycle.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migIdent } from "../migrations/325_agent_identity.js";
import { runAgentMarathonCycle } from "../emergent/agent-marathon-cycle.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE agent_marathon_sessions (
      id TEXT PRIMARY KEY, user_id TEXT, status TEXT, goal TEXT,
      total_turns INTEGER DEFAULT 0, max_turns INTEGER DEFAULT 100,
      next_tick_at INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE agent_marathon_turns (session_id TEXT, turn_index INTEGER, role TEXT, content TEXT);
    CREATE TABLE affect_state (entity_id TEXT, world_id TEXT, v REAL, a REAL, s REAL, c REAL, g REAL, t REAL, f REAL, meta_json TEXT, last_tick_at INTEGER, created_at INTEGER, updated_at INTEGER, PRIMARY KEY (entity_id, world_id));
  `);
  migIdent(db);
  return db;
}

test("E2 — salience gate live on the marathon cycle", async (t) => {
  const prevRunMacro = globalThis.__concordRunMacro;
  const prevSalience = process.env.CONCORD_AFFECT_SALIENCE;
  globalThis.__concordRunMacro = () => ({ ok: true });
  delete process.env.CONCORD_AFFECT_SALIENCE; // default on

  await t.test("a calm autonomous agent stays on INSTINCT — no LLM loop, session not advanced", async () => {
    const db = setupDb();
    // a deployed agent (agent_identities) with a calm drive profile, due to tick
    db.prepare(`INSERT INTO agent_marathon_sessions (id, user_id, status, goal, total_turns, max_turns, next_tick_at) VALUES ('m1','agent-user','running','tend the garden',0,100,0)`).run();
    db.prepare(`INSERT INTO agent_identities (agent_id, user_id, world_id, given_name, core_values_json, drive_profile_json, status) VALUES ('ag1','agent-user','w','Veya','[]', ?, 'active')`)
      .run(JSON.stringify({ SEEKING: 0.3, FEAR: 0.2, RAGE: 0.1, CARE: 0.3, PANIC: 0.1, PLAY: 0.3, LUST: 0.2 }));
    // calm affect
    db.prepare(`INSERT INTO affect_state (entity_id, world_id, v, a) VALUES ('ag1','w',0.1,0.15)`).run();

    const r = await runAgentMarathonCycle({ db });
    assert.equal(r.ok, true);
    assert.ok(r.onInstinct >= 1, "the calm agent ran on instinct (deliberated:false)");
    // the session was NOT advanced by an expensive loop
    assert.equal(db.prepare(`SELECT total_turns FROM agent_marathon_sessions WHERE id='m1'`).get().total_turns, 0);
  });

  await t.test("a non-agent (human) marathon is ungated — null gate, no agent_identities", async () => {
    const db = setupDb();
    // a running session whose user has NO agent_identities → the gate is not built
    db.prepare(`INSERT INTO agent_marathon_sessions (id, user_id, status, goal, next_tick_at) VALUES ('m2','human-user','running','write a report',0)`).run();
    // we can't run the full LLM loop here; assert buildSalienceGate stays null by
    // confirming the cycle attempts to tick (errors caught) without crashing.
    const r = await runAgentMarathonCycle({ db });
    assert.equal(r.ok, true, "human marathons are processed (ungated path), cycle never throws");
  });

  globalThis.__concordRunMacro = prevRunMacro;
  if (prevSalience !== undefined) process.env.CONCORD_AFFECT_SALIENCE = prevSalience;
});
