// server/tests/agent-loop-memory.test.js
//
// Real memory in the agent loop: DTU snippets (not just titles) from the
// user's own DTUs and the session's compressed memory go into the prompt, and
// marathon compression saves a findings DTU. Offline, in-memory DB.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runAgentLoop } from "../lib/chat-agent.js";
import { up as upMig171 } from "../migrations/171_agent_marathon_sessions.js";
import { up as upMig379 } from "../migrations/379_agent_marathon_governance.js";
import { up as upMig387 } from "../migrations/387_agent_marathon_turn_compaction.js";
import { up as upMig394 } from "../migrations/394_agent_marathon_tool_log.js";
import { tickMarathon, compressMarathonHistory, extractFindings } from "../lib/agent-marathon.js";
import { startLongTask, longTaskStatus, formatLongTaskStatus } from "../lib/long-task.js";

function brainSpy(responses = []) {
  const sys = [];
  const fn = async ({ messages }) => { sys.push(messages[0]?.content || ""); return { ok: true, text: responses.shift() ?? "done.", provider: "t", model: "t" }; };
  fn.sys = sys;
  return fn;
}

describe("agent loop memory", () => {
  it("injects DTU snippets and session memory, and harvest DTUs carry snippets", async () => {
    const db = new Database(":memory:");
    const brain = brainSpy();
    const seenQ = [];
    const recallMemory = async ({ query, userId, sessionId }) => {
      seenQ.push({ query, userId, sessionId });
      return {
        dtus: [{ id: "dtu_a", title: "Servo torque notes", snippet: "MG996R stalls at 11 kg-cm at 6 V; MG90S 2.2 kg-cm." }],
        session: [{ id: "dtu_m", title: "mem", snippet: "Earlier the user picked a 3-DOF arm with a 30 cm reach." }],
      };
    };
    const runMacro = async (domain, name) => (domain === "chat" && name === "harvest"
      ? { ok: true, dtus: [{ id: "dtu_h", title: "Arm build log", human: { summary: "Printed the base in PETG." } }] }
      : { ok: true });
    await runAgentLoop({
      db, userId: "u1", message: "which servo should the shoulder use?", runMacro, lensActions: new Map(),
      opts: { brainChat: brain, sessionId: "s1", maxTurns: 1, recallMemory, actionMemory: false },
    });
    const sys = brain.sys[0];
    assert.match(sys, /\[M1\] Servo torque notes: MG996R stalls at 11 kg-cm/);
    assert.match(sys, /Earlier the user picked a 3-DOF arm/);
    assert.match(sys, /Arm build log \(tier: regular\): Printed the base in PETG\./);
    assert.deepEqual(seenQ[0], { query: "which servo should the shoulder use?", userId: "u1", sessionId: "s1" });
  });

  it("memory:false and a failing recall both leave the prompt alone", async () => {
    const db = new Database(":memory:");
    const b1 = brainSpy();
    await runAgentLoop({ db, userId: "u1", message: "hi", runMacro: async () => ({ ok: true }), lensActions: new Map(), opts: { brainChat: b1, shadowContext: false, maxTurns: 1, memory: false, recallMemory: async () => { throw new Error("no"); }, actionMemory: false } });
    const b2 = brainSpy();
    await runAgentLoop({ db, userId: "u1", message: "hi", runMacro: async () => ({ ok: true }), lensActions: new Map(), opts: { brainChat: b2, shadowContext: false, maxTurns: 1, recallMemory: async () => { throw new Error("no"); }, actionMemory: false } });
    assert.doesNotMatch(b1.sys[0], /From your saved DTUs/);
    assert.doesNotMatch(b2.sys[0], /From your saved DTUs/);
  });
});

function mdb() {
  const db = new Database(":memory:");
  upMig171(db); upMig379(db); upMig387(db); upMig394(db);
  db.exec(`CREATE TABLE initiatives (id TEXT PRIMARY KEY, user_id TEXT, trigger_type TEXT, priority TEXT, message TEXT, status TEXT, metadata_json TEXT, created_at INTEGER)`);
  return db;
}

describe("findings DTU at compression", () => {
  it("extracts the latest progress notes", () => {
    const f = extractFindings([
      { role: "user", content: "go" },
      { role: "assistant", content: "Searched. Progress notes: MG90S is 9 g and 1.8 kg-cm at 4.8 V (towerpro.com.tw)." },
      { role: "assistant", content: "Read more. Progress notes: MG996R is 55 g, 11 kg-cm at 6 V (components101.com). Left: compare prices.\n[TOOL_CALL: {\"tool\":\"web_search\",\"params\":{\"query\":\"x\"}}]" },
    ]);
    assert.match(f, /MG90S is 9 g/);
    assert.match(f, /MG996R is 55 g/);
    assert.doesNotMatch(f, /TOOL_CALL/);
  });

  it("compresses with a per-call threshold", () => {
    const db = mdb();
    db.prepare(`INSERT INTO agent_marathon_sessions (id, user_id, title, goal, status) VALUES ('m1','u1','t','g','running')`).run();
    const ins = db.prepare(`INSERT INTO agent_marathon_turns (session_id, turn_index, role, content) VALUES ('m1', ?, ?, ?)`);
    for (let i = 0; i < 10; i++) ins.run(i, i % 2 ? "assistant" : "user", i % 2 ? `Progress notes: finding number ${i} with enough words to count as a note.` : "continue");
    assert.equal(compressMarathonHistory(db, "m1").compressed, false);
    const r = compressMarathonHistory(db, "m1", { threshold: 8, batch: 6 });
    assert.equal(r.compressed, true);
    assert.equal(r.turnsCompacted, 6);
    assert.match(r.findings, /finding number 5/);
  });

  it("a long task saves a findings DTU when its history compresses, and status counts it", async () => {
    const db = mdb();
    const job = startLongTask(db, { userId: "u1", goal: "research servos and write me a report" });
    const ins = db.prepare(`INSERT INTO agent_marathon_turns (session_id, turn_index, role, content) VALUES (?, ?, ?, ?)`);
    for (let i = 0; i < 10; i++) ins.run(job.jobId, i, i % 2 ? "assistant" : "user", i % 2 ? `Progress notes: servo fact ${i}, sourced from example.com/servo-${i}, plus what is left.` : "continue");
    db.prepare(`UPDATE agent_marathon_sessions SET total_turns = 10 WHERE id = ?`).run(job.jobId);
    const created = [];
    const runMacro = async (domain, name, input, ctx) => {
      if (domain === "dtu" && name === "create") { created.push({ input, ctx }); return { ok: true, id: `dtu_f${created.length}` }; }
      if (domain === "chat" && name === "harvest") return { ok: true, dtus: [] };
      return { ok: true };
    };
    const brain = brainSpy(["More found. Progress notes: still going."]);
    await tickMarathon({ db, sessionId: job.jobId, runMacro, lensActions: new Map(), opts: { tickTurns: 1, brainChat: brain } });
    assert.equal(created.length, 1);
    assert.match(created[0].input.title, /^Findings 1: research servos/);
    assert.match(created[0].input.content, /servo fact \d/);
    assert.equal(created[0].input.visibility, "private");
    assert.equal(created[0].ctx.actor.userId, "u1");
    const meta = JSON.parse(db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id=?`).get(job.jobId).meta_json);
    assert.deepEqual(meta.findingsDtuIds, ["dtu_f1"]);
    assert.match(formatLongTaskStatus(longTaskStatus(db, "u1", job.jobId)), /1 findings DTU saved/);
  });
});
