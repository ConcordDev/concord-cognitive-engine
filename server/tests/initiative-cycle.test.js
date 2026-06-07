// Contract test for "living chat" Layer 2 — the pulse (salience-gated initiative clock).
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migAffect } from "../migrations/110_affect_state.js";
import { feelChatTurn } from "../lib/chat-self.js";
import { runInitiativeCycle } from "../emergent/initiative-cycle.js";

function setupDb() {
  const db = new Database(":memory:");
  migAffect(db);
  db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, creator_id TEXT, type TEXT, title TEXT, created_at INTEGER DEFAULT (unixepoch()))`);
  db.exec(`CREATE TABLE forward_predictions (id TEXT PRIMARY KEY, user_id TEXT, subject_kind TEXT, subject_id TEXT, anticipated TEXT, confidence REAL, composed_at INTEGER DEFAULT (unixepoch()), expires_at INTEGER, realised_at INTEGER)`);
  return db;
}

// a stub initiative engine that records calls (avoids needing the full initiative schema)
function stubEngine({ shouldFire = true } = {}) {
  const calls = { evaluated: [], created: [] };
  return {
    calls,
    evaluateTrigger: (userId, triggerType) => { calls.evaluated.push({ userId, triggerType }); return { shouldFire, suggestedPriority: "normal" }; },
    createInitiative: (userId, triggerType, message) => { calls.created.push({ userId, triggerType, message }); return { id: "init_x" }; },
  };
}

test("Living chat — the pulse (initiative cycle)", async (t) => {
  await t.test("stays SILENT when there's no real thought to surface (salience gate)", () => {
    const db = setupDb();
    // a user with a fresh/neutral assistant self and no morning brief → nothing to say
    feelChatTurn(db, "quiet", "ok"); // neutral
    const eng = stubEngine();
    const r = runInitiativeCycle({ db, engine: eng });
    assert.equal(r.fired, 0, "no initiative when nothing crossed threshold");
    assert.equal(eng.calls.created.length, 0);
  });

  await t.test("reaches out on a notably-lit felt state (reflective_followup)", () => {
    const db = setupDb();
    // a run of warm exchanges lifts the assistant's mood past threshold
    for (let i = 0; i < 6; i++) feelChatTurn(db, "warm", "thank you, this was genuinely brilliant and amazing");
    const eng = stubEngine();
    const r = runInitiativeCycle({ db, engine: eng });
    assert.equal(r.fired, 1, "the lit felt state earned an outreach");
    assert.equal(eng.calls.created[0].triggerType, "reflective_followup");
    assert.match(eng.calls.created[0].message, /turning over|sitting with/i);
  });

  await t.test("an unsurfaced morning brief surfaces (path to the surface)", () => {
    const db = setupDb();
    feelChatTurn(db, "u1", "hello there friend"); // makes them recently-active
    db.prepare(`INSERT INTO dtus (id, creator_id, type, title) VALUES ('b1', 'u1', 'morning_brief', 'three threads from overnight')`).run();
    const eng = stubEngine();
    const r = runInitiativeCycle({ db, engine: eng });
    assert.equal(r.fired, 1);
    assert.equal(eng.calls.created[0].triggerType, "morning_context");
    assert.match(eng.calls.created[0].message, /overnight/i);
  });

  await t.test("a forward-sim anticipation reaches the surface (Layer 3 cognition → chat)", () => {
    const db = setupDb();
    feelChatTurn(db, "u9", "hey what's next"); // recently active
    db.prepare(`INSERT INTO forward_predictions (id, user_id, subject_kind, subject_id, anticipated, confidence, expires_at)
      VALUES ('p1', 'u9', 'self', 'u9', 'you may circle back to the migration idea.', 0.8, unixepoch() + 3600)`).run();
    const eng = stubEngine();
    const r = runInitiativeCycle({ db, engine: eng });
    assert.equal(r.fired, 1);
    assert.equal(eng.calls.created[0].triggerType, "reflective_followup");
    assert.match(eng.calls.created[0].message, /hunch|migration idea/i);
  });

  await t.test("the engine's own gate (rate-limit/quiet-hours) can still veto", () => {
    const db = setupDb();
    for (let i = 0; i < 6; i++) feelChatTurn(db, "warm", "thank you, this was genuinely brilliant and amazing");
    const eng = stubEngine({ shouldFire: false }); // engine says not now
    const r = runInitiativeCycle({ db, engine: eng });
    assert.equal(r.evaluated, 1, "we asked");
    assert.equal(r.fired, 0, "but the engine vetoed (rate limit / quiet hours)");
  });

  await t.test("kill-switch + totality", () => {
    const db = setupDb();
    const prev = process.env.CONCORD_INITIATIVE_CYCLE;
    process.env.CONCORD_INITIATIVE_CYCLE = "0";
    assert.equal(runInitiativeCycle({ db, engine: stubEngine() }).reason, "disabled");
    if (prev === undefined) delete process.env.CONCORD_INITIATIVE_CYCLE; else process.env.CONCORD_INITIATIVE_CYCLE = prev;
    assert.doesNotThrow(() => runInitiativeCycle({}));
    assert.equal(runInitiativeCycle({ db: null }).ok, true);
  });
});
