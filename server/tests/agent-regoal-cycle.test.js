// Integration test for Wave 7 / B4 — autonomous re-goal in the marathon cycle.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migAgent } from "../migrations/325_agent_identity.js";
import { createAgentSelf } from "../lib/agent-self.js";
import { runAgentMarathonCycle } from "../emergent/agent-marathon-cycle.js";

function setupDb() {
  const db = new Database(":memory:");
  migAgent(db);
  db.exec(`
    CREATE TABLE agent_marathon_sessions (
      id TEXT PRIMARY KEY, user_id TEXT, status TEXT, goal TEXT, title TEXT,
      total_turns INTEGER DEFAULT 0, max_turns INTEGER DEFAULT 200,
      next_tick_at INTEGER, created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE agent_marathon_turns ( session_id TEXT, turn_index INTEGER, role TEXT, content TEXT );
  `);
  return db;
}

test("B4 — autonomous re-goal in the marathon cycle", async (t) => {
  // the cycle needs a runMacro global to proceed past the guard
  globalThis.__concordRunMacro = () => ({ ok: true });

  await t.test("an active agent with no running marathon forms a NEW goal and continues", async () => {
    const db = setupDb();
    const r = createAgentSelf(db, { userId: "u1", worldId: "w", coreValues: ["curiosity"], driveProfile: { SEEKING: 0.9, CARE: 0.2, RAGE: 0.1, FEAR: 0.2, PANIC: 0.1, PLAY: 0.3, LUST: 0.1 } });
    // the agent's user has an identity but NO running marathon (it just finished one)
    db.prepare(`INSERT INTO agent_marathon_sessions (id, user_id, status, goal) VALUES ('m_old','u1','completed','an old finished goal')`).run();

    const res = await runAgentMarathonCycle({ db });
    assert.equal(res.ok, true);
    assert.equal(res.reGoaled, 1, "the idle agent formed a new goal");
    // a fresh (pending) marathon now exists with a self-formed goal — the cycle will tick it
    const fresh = db.prepare(`SELECT goal FROM agent_marathon_sessions WHERE user_id='u1' AND status='pending'`).get();
    assert.ok(fresh, "a new marathon was started");
    assert.match(fresh.goal, /learn|explore|craft/i, "the goal reflects the agent's dominant SEEKING drive");
    assert.notEqual(fresh.goal, "an old finished goal");

    // re-running the cycle must NOT spawn a duplicate (the pending marathon counts as active)
    const res2 = await runAgentMarathonCycle({ db });
    assert.equal(res2.reGoaled, 0, "no duplicate re-goal while a pending marathon exists");
  });

  await t.test("does NOT re-goal an agent that still has a running marathon", async () => {
    const db = setupDb();
    createAgentSelf(db, { userId: "u2", worldId: "w" });
    db.prepare(`INSERT INTO agent_marathon_sessions (id, user_id, status, goal) VALUES ('m_run','u2','running','still working')`).run();
    const res = await runAgentMarathonCycle({ db });
    assert.equal(res.reGoaled, 0, "a busy agent is left alone");
  });

  await t.test("kill-switch CONCORD_AGENT_AUTOGOAL=0 disables re-goaling", async () => {
    const db = setupDb();
    createAgentSelf(db, { userId: "u3", worldId: "w" });
    db.prepare(`INSERT INTO agent_marathon_sessions (id, user_id, status, goal) VALUES ('m_done','u3','completed','done')`).run();
    const prev = process.env.CONCORD_AGENT_AUTOGOAL;
    process.env.CONCORD_AGENT_AUTOGOAL = "0";
    const res = await runAgentMarathonCycle({ db });
    assert.equal(res.reGoaled, 0);
    if (prev === undefined) delete process.env.CONCORD_AGENT_AUTOGOAL; else process.env.CONCORD_AGENT_AUTOGOAL = prev;
  });

  delete globalThis.__concordRunMacro;
});
