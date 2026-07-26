// server/tests/marathon-tool-durability.test.js
//
// ConKay-E — tool-call fingerprint log for marathon tick-durability
// (migration 394, `agent_marathon_tool_log`).
//
// Proves the DURABILITY property, not just that the table/functions exist:
// if a marathon process is killed mid-tool-call, the `agent_marathon_tool_log`
// table shows exactly which call was in flight (stuck at 'dispatched', no
// completed_at) versus which calls genuinely finished — in real call order,
// surviving across a simulated process restart.
//
// Mirrors the mocking style used in tests/agent-marathon-governance.test.js
// (real in-memory better-sqlite3 DB migrated with 171 + 379 + 394, scripted
// brainChat, no live LLM needed).
//
// Run: node --test server/tests/marathon-tool-durability.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upMig171 } from "../migrations/171_agent_marathon_sessions.js";
import { up as upMig379 } from "../migrations/379_agent_marathon_governance.js";
import { up as upMig394 } from "../migrations/394_agent_marathon_tool_log.js";
import { startMarathon, tickMarathon, createToolGate } from "../lib/agent-marathon.js";
import { recordToolDispatch, recordToolOutcome, findStuckDispatches } from "../lib/marathon-tick-durability.js";

function setup() {
  const db = new Database(":memory:");
  upMig171(db);
  upMig379(db);
  upMig394(db);
  return db;
}

function noopHarvest(real) {
  return async (domain, name, input, ctx) => {
    if (domain === "chat" && name === "harvest") return { ok: true, dtus: [] };
    return real(domain, name, input, ctx);
  };
}

function scriptedBrain(responses) {
  return async () => {
    const text = responses.shift() ?? "done.";
    return { ok: true, text, provider: "test", model: "test", tokensIn: 1, tokensOut: 1 };
  };
}

describe("migration 394 — agent_marathon_tool_log table shape", () => {
  it("creates the table with the expected columns + status CHECK", () => {
    const db = setup();
    const cols = db.prepare(`PRAGMA table_info(agent_marathon_tool_log)`).all().map((c) => c.name);
    for (const expected of ["id", "session_id", "tick_seq", "call_seq", "tool_name", "params_json", "status", "result_summary", "created_at", "completed_at"]) {
      assert.ok(cols.includes(expected), `missing column ${expected}`);
    }
    db.prepare(`INSERT INTO agent_marathon_tool_log (session_id, call_seq, tool_name) VALUES ('s1', 1, 'web_search')`).run();
    assert.throws(() => {
      db.prepare(`INSERT INTO agent_marathon_tool_log (session_id, call_seq, tool_name, status) VALUES ('s1', 2, 'web_search', 'bogus')`).run();
    });
  });

  it("is idempotent to re-apply", () => {
    const db = setup();
    assert.doesNotThrow(() => upMig394(db));
  });
});

describe("recordToolDispatch / recordToolOutcome — direct unit tests", () => {
  it("recordToolDispatch writes a 'dispatched' row and returns an id; call_seq starts at 1 per session", () => {
    const db = setup();
    const id = recordToolDispatch(db, "sess-a", 1, "web_search", { query: "x" });
    assert.ok(id != null);
    const row = db.prepare(`SELECT * FROM agent_marathon_tool_log WHERE id = ?`).get(id);
    assert.equal(row.session_id, "sess-a");
    assert.equal(row.call_seq, 1);
    assert.equal(row.tool_name, "web_search");
    assert.equal(row.status, "dispatched");
    assert.equal(row.completed_at, null);
    assert.deepEqual(JSON.parse(row.params_json), { query: "x" });
  });

  it("call_seq is monotonic per session, independent across sessions", () => {
    const db = setup();
    recordToolDispatch(db, "sess-a", 1, "web_search", {});
    recordToolDispatch(db, "sess-a", 1, "run_compute", {});
    const idB = recordToolDispatch(db, "sess-b", 1, "web_search", {});
    const rowB = db.prepare(`SELECT call_seq FROM agent_marathon_tool_log WHERE id = ?`).get(idB);
    assert.equal(rowB.call_seq, 1, "a different session starts its own call_seq at 1");
    const rowsA = db.prepare(`SELECT call_seq FROM agent_marathon_tool_log WHERE session_id = 'sess-a' ORDER BY call_seq`).all();
    assert.deepEqual(rowsA.map((r) => r.call_seq), [1, 2]);
  });

  it("recordToolOutcome flips status + stamps completed_at + stores a truncated summary", () => {
    const db = setup();
    const id = recordToolDispatch(db, "sess-a", 1, "web_search", {});
    const ok = recordToolOutcome(db, id, "completed", "the real result");
    assert.equal(ok, true);
    const row = db.prepare(`SELECT * FROM agent_marathon_tool_log WHERE id = ?`).get(id);
    assert.equal(row.status, "completed");
    assert.ok(row.completed_at > 0);
    assert.equal(row.result_summary, "the real result");
  });

  it("recordToolOutcome coerces an unrecognized status to 'failed' (never a silent no-op)", () => {
    const db = setup();
    const id = recordToolDispatch(db, "sess-a", 1, "web_search", {});
    recordToolOutcome(db, id, "bogus", "whatever");
    const row = db.prepare(`SELECT status FROM agent_marathon_tool_log WHERE id = ?`).get(id);
    assert.equal(row.status, "failed");
  });

  it("params_json is truncated, not merely hashed — a real forensics read can see what the call was doing", () => {
    const db = setup();
    const bigParams = { query: "x".repeat(5000) };
    const id = recordToolDispatch(db, "sess-a", 1, "web_search", bigParams);
    const row = db.prepare(`SELECT params_json FROM agent_marathon_tool_log WHERE id = ?`).get(id);
    assert.ok(row.params_json.length <= 2000);
    assert.ok(row.params_json.startsWith('{"query":"xxx'));
  });

  it("degrades honestly (returns null/false, never throws) against a pre-394 schema", () => {
    const db = new Database(":memory:");
    upMig171(db);
    upMig379(db);
    assert.doesNotThrow(() => {
      const id = recordToolDispatch(db, "sess-a", 1, "web_search", {});
      assert.equal(id, null);
      assert.equal(recordToolOutcome(db, 999, "completed", "x"), false);
    });
  });
});

describe("createToolGate — dispatched row written before the tool executes, only for calls actually let through", () => {
  let db;
  beforeEach(() => { db = setup(); });
  afterEach(() => { db.close(); });

  it("an allowed call gets a 'dispatched' row + a bundled recordOutcome closure", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "x" });
    const gate = createToolGate(db, sessionId, 7);
    const g = await gate({ tool: "web_search", params: { query: "hi" } });
    assert.equal(g.ok, true);
    assert.ok(g.toolLogId != null);
    assert.equal(typeof g.recordOutcome, "function");

    const row = db.prepare(`SELECT * FROM agent_marathon_tool_log WHERE id = ?`).get(g.toolLogId);
    assert.equal(row.status, "dispatched");
    assert.equal(row.session_id, sessionId);
    assert.equal(row.tick_seq, 7);
    assert.equal(row.tool_name, "web_search");

    g.recordOutcome({ ok: true, result: "some result" });
    const after = db.prepare(`SELECT * FROM agent_marathon_tool_log WHERE id = ?`).get(g.toolLogId);
    assert.equal(after.status, "completed");
    assert.ok(after.completed_at > 0);
  });

  it("a refused call (domain not allowed) writes NO tool-log row", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "x", allowedDomains: ["dtu"] });
    const gate = createToolGate(db, sessionId, 1);
    const g = await gate({ tool: "run_lens_action", params: { domain: "forbidden", action: "x" } });
    assert.equal(g.ok, false);
    const rows = db.prepare(`SELECT * FROM agent_marathon_tool_log WHERE session_id = ?`).all(sessionId);
    assert.equal(rows.length, 0, "a refused call was never dispatched, so nothing to log");
  });

  it("a budget-exhausted halt writes NO tool-log row for the refused call", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "x", budgetCap: 1 });
    const gate = createToolGate(db, sessionId, 1);
    const g1 = await gate({ tool: "web_search", params: {} });
    assert.equal(g1.ok, true);
    const g2 = await gate({ tool: "web_search", params: {} });
    assert.equal(g2.ok, false);
    assert.equal(g2.halt, true);
    const rows = db.prepare(`SELECT * FROM agent_marathon_tool_log WHERE session_id = ?`).all(sessionId);
    assert.equal(rows.length, 1, "only the one call that actually dispatched got a row");
  });
});

describe("THE PROOF — a mid-loop crash leaves an honest forensic trail across a simulated process restart", () => {
  let db;
  beforeEach(() => { db = setup(); });
  afterEach(() => { db.close(); });

  it("N tool calls across two 'ticks' (process restart in between): exactly N dispatched rows in real order, only the crashed call stuck at 'dispatched'", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "long task" });
    const N = 8;
    const crashAt = N / 2; // 1-based call_seq that "crashes" (never gets recordOutcome)

    // ── Tick 1 (the process that will "die") ──────────────────────────
    // A fresh createToolGate closure, exactly as tickMarathon creates one
    // per tick. Dispatch calls 1..crashAt; only complete 1..crashAt-1 —
    // call #crashAt's tool "hangs" (its promise never resolves before the
    // simulated kill), so recordOutcome is never invoked for it. This is
    // the exact shape a real process kill leaves behind: the dispatch
    // write landed (synchronous, already on disk); the completion write
    // never got a chance to run.
    const gate1 = createToolGate(db, sessionId, 1);
    for (let i = 1; i <= crashAt; i++) {
      const g = await gate1({ tool: "web_search", params: { query: `call-${i}` } });
      assert.equal(g.ok, true, `call ${i} should be allowed`);
      if (i < crashAt) {
        g.recordOutcome({ ok: true, result: `result-${i}` });
      }
      // else: simulate the crash — recordOutcome is intentionally never
      // called for the crashAt-th call.
    }

    // ── Assert mid-crash state BEFORE any resume ───────────────────────
    const midState = db.prepare(`
      SELECT call_seq, status FROM agent_marathon_tool_log WHERE session_id = ? ORDER BY call_seq ASC
    `).all(sessionId);
    assert.equal(midState.length, crashAt, "exactly the calls dispatched before the crash are logged");
    for (let i = 0; i < crashAt - 1; i++) {
      assert.equal(midState[i].status, "completed", `call ${i + 1} finished before the crash`);
    }
    assert.equal(midState[crashAt - 1].status, "dispatched", "the in-flight call is stuck at dispatched — this IS the crash evidence");

    const stuckBefore = findStuckDispatches(db, sessionId);
    assert.equal(stuckBefore.length, 1);
    assert.equal(stuckBefore[0].call_seq, crashAt);

    // ── Tick 2 (a resumed marathon — a brand-new process, brand-new
    // createToolGate closure, same sessionId). Real production behavior:
    // tickMarathon calls createToolGate(db, sessionId, tickSeq) fresh on
    // every tick; it has no in-memory memory of tick 1's counter, so
    // call_seq numbering MUST be recovered from the DB, not reset to 1. ──
    const gate2 = createToolGate(db, sessionId, 2);
    for (let i = crashAt + 1; i <= N; i++) {
      const g = await gate2({ tool: "web_search", params: { query: `call-${i}` } });
      assert.equal(g.ok, true, `call ${i} should be allowed`);
      g.recordOutcome({ ok: true, result: `result-${i}` });
    }

    // ── Final assertion: exactly N rows, real call order, only the
    // crashed call still stuck. This is the whole point: a resumed
    // marathon (or an operator) can read this table and know EXACTLY
    // which call was in-flight when things died — not just that
    // something crashed. ──
    const finalRows = db.prepare(`
      SELECT call_seq, tool_name, status, completed_at FROM agent_marathon_tool_log
      WHERE session_id = ? ORDER BY call_seq ASC
    `).all(sessionId);

    assert.equal(finalRows.length, N, `exactly ${N} dispatched rows total`);
    assert.deepEqual(finalRows.map((r) => r.call_seq), Array.from({ length: N }, (_, i) => i + 1), "call_seq is the real call order, 1..N with no gaps or reordering");

    for (const row of finalRows) {
      if (row.call_seq === crashAt) {
        assert.equal(row.status, "dispatched", `call ${crashAt} (the crashed one) is still stuck at dispatched even after the resume`);
        assert.equal(row.completed_at, null);
      } else {
        assert.equal(row.status, "completed", `call ${row.call_seq} completed normally`);
        assert.ok(row.completed_at > 0);
      }
    }

    // The stuck-dispatch finder still finds exactly the one crashed call,
    // even after the resumed tick added N/2 more real completed rows.
    const stuckAfter = findStuckDispatches(db, sessionId);
    assert.equal(stuckAfter.length, 1);
    assert.equal(stuckAfter[0].call_seq, crashAt);
  });
});

describe("End-to-end through the real chat-agent.js loop (tickMarathon -> runAgentLoop -> createToolGate)", () => {
  let db;
  beforeEach(() => { db = setup(); });
  afterEach(() => { db.close(); });

  it("a real marathon tick with 2 tool calls in one turn logs both as dispatched->completed, in order", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "search twice" });
    const runMacro = noopHarvest(async (domain, name, input) => {
      if (domain === "tools" && name === "web_search") return { ok: true, summary: `result for ${input.query}` };
      return { ok: true };
    });
    const brain = scriptedBrain([
      [
        `[TOOL_CALL: {"tool":"web_search","params":{"query":"a"}}]`,
        `[TOOL_CALL: {"tool":"web_search","params":{"query":"b"}}]`,
      ].join("\n"),
      `done.`,
    ]);

    const r = await tickMarathon({ db, sessionId, runMacro, lensActions: new Map(), opts: { brainChat: brain, tickTurns: 5 } });
    assert.equal(r.ok, true);

    const rows = db.prepare(`
      SELECT call_seq, tool_name, status, params_json FROM agent_marathon_tool_log
      WHERE session_id = ? ORDER BY call_seq ASC
    `).all(sessionId);
    assert.equal(rows.length, 2, "both real tool calls made it through the full runAgentLoop path");
    assert.equal(rows[0].status, "completed");
    assert.equal(rows[1].status, "completed");
    assert.deepEqual(rows.map((r2) => r2.call_seq), [1, 2]);
    assert.deepEqual(JSON.parse(rows[0].params_json), { query: "a" });
    assert.deepEqual(JSON.parse(rows[1].params_json), { query: "b" });
  });

  it("a refused (out-of-allowlist) call through the real loop writes no tool-log row, but a halted budget-exhausted call after real dispatches is correctly absent too", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "x", allowedDomains: ["dtu"] });
    const runMacro = noopHarvest(async () => ({ ok: true }));
    const brain = scriptedBrain([
      `[TOOL_CALL: {"tool":"run_lens_action","params":{"domain":"forbidden","action":"foo","params":{}}}]`,
      `ok, stopping.`,
    ]);
    const r = await tickMarathon({ db, sessionId, runMacro, lensActions: new Map(), opts: { brainChat: brain, tickTurns: 5 } });
    assert.equal(r.ok, true);
    const rows = db.prepare(`SELECT * FROM agent_marathon_tool_log WHERE session_id = ?`).all(sessionId);
    assert.equal(rows.length, 0);
  });

  it("second tick of the same session continues call_seq forward instead of resetting", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "search across ticks" });
    const runMacro = noopHarvest(async () => ({ ok: true, summary: "r" }));

    const brain1 = scriptedBrain([`[TOOL_CALL: {"tool":"web_search","params":{"query":"first"}}]`, `still going.`]);
    const r1 = await tickMarathon({ db, sessionId, runMacro, lensActions: new Map(), opts: { brainChat: brain1, tickTurns: 5 } });
    assert.equal(r1.ok, true);

    const brain2 = scriptedBrain([`[TOOL_CALL: {"tool":"web_search","params":{"query":"second"}}]`, `done.`]);
    const r2 = await tickMarathon({ db, sessionId, runMacro, lensActions: new Map(), opts: { brainChat: brain2, tickTurns: 5 } });
    assert.equal(r2.ok, true);

    const rows = db.prepare(`
      SELECT call_seq, tick_seq FROM agent_marathon_tool_log WHERE session_id = ? ORDER BY call_seq ASC
    `).all(sessionId);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r3) => r3.call_seq), [1, 2]);
    assert.notEqual(rows[0].tick_seq, rows[1].tick_seq, "each tick stamps its own tick_seq");
  });
});
