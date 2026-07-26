// server/tests/agent-marathon-governance.test.js
//
// Governance envelope for marathon sessions (mig 379, 2026-07-24 —
// user-approved: "an allowed-domains allowlist, a spend/action budget
// cap, and a revocation flag enforced inside every marathon tick").
//
// Exercises the REAL enforcement path: tickMarathon -> runAgentLoop's
// opt-in opts.toolGate hook -> agent-marathon.js#createToolGate, driven
// with a scripted brainChat (offline, no live LLM needed) against a real
// in-memory better-sqlite3 DB migrated with 171 + 379. Mirrors the exact
// mocking style used in tests/agent-action-memory-wire.test.js (scripted
// brain + fake runMacro + real DB), which is this repo's established
// pattern for testing chat-agent.js's runAgentLoop without live brain
// infra.
//
// Run: node --test server/tests/agent-marathon-governance.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upMig171 } from "../migrations/171_agent_marathon_sessions.js";
import { up as upMig379 } from "../migrations/379_agent_marathon_governance.js";
import {
  startMarathon, tickMarathon, getMarathon, revokeMarathon,
  domainForToolCall, createToolGate,
} from "../lib/agent-marathon.js";

function setup() {
  const db = new Database(":memory:");
  upMig171(db);
  upMig379(db);
  return db;
}

// tickMarathon's real path (through runAgentLoop) always attempts a
// shadow-context prefetch (`runMacro("chat", "harvest", ...)`) BEFORE the
// tool-dispatch loop even starts — that call is not one of the tool calls
// under test here and must never be counted or trigger any test-only side
// effect. Every `runMacro` stub below wraps its real logic in this so
// call-counting assertions measure only genuine tool dispatches.
function noopHarvest(real) {
  return async (domain, name, input, ctx) => {
    if (domain === "chat" && name === "harvest") return { ok: true, dtus: [] };
    return real(domain, name, input, ctx);
  };
}

// A scripted brain: returns the queued responses turn by turn.
function scriptedBrain(responses) {
  const fn = async () => {
    const text = responses.shift() ?? "done.";
    return { ok: true, text, provider: "test", model: "test", tokensIn: 1, tokensOut: 1 };
  };
  return fn;
}

describe("mig 379 — agent_marathon_sessions has the governance columns", () => {
  it("allowed_domains_json / budget_cap / budget_spent / revoked_at exist, and status admits 'revoked'", () => {
    const db = setup();
    const cols = db.prepare(`PRAGMA table_info(agent_marathon_sessions)`).all().map((c) => c.name);
    for (const expected of ["allowed_domains_json", "budget_cap", "budget_spent", "revoked_at"]) {
      assert.ok(cols.includes(expected), `missing column ${expected}`);
    }
    // Widened CHECK actually accepts 'revoked' at the DB level (not just in JS).
    const r = startMarathon(db, "alice", { goal: "x" });
    assert.doesNotThrow(() => {
      db.prepare(`UPDATE agent_marathon_sessions SET status = 'revoked' WHERE id = ?`).run(r.sessionId);
    });
  });

  it("budget_spent defaults to 0 and the other three default to NULL", () => {
    const db = setup();
    const r = startMarathon(db, "alice", { goal: "x" });
    const row = getMarathon(db, r.sessionId);
    assert.equal(row.budget_spent, 0);
    assert.equal(row.allowed_domains_json, null);
    assert.equal(row.budget_cap, null);
    assert.equal(row.revoked_at, null);
  });
});

describe("startMarathon — governance envelope at creation time", () => {
  it("persists allowedDomains as a JSON array and budgetCap as an integer", () => {
    const db = setup();
    const r = startMarathon(db, "alice", { goal: "x", allowedDomains: ["dtu", "tools"], budgetCap: 42 });
    const row = getMarathon(db, r.sessionId);
    assert.deepEqual(JSON.parse(row.allowed_domains_json), ["dtu", "tools"]);
    assert.equal(row.budget_cap, 42);
  });

  it("omitting allowedDomains/budgetCap leaves the session fully unrestricted (back-compat)", () => {
    const db = setup();
    const r = startMarathon(db, "alice", { goal: "x" });
    const row = getMarathon(db, r.sessionId);
    assert.equal(row.allowed_domains_json, null);
    assert.equal(row.budget_cap, null);
  });

  it("non-array / empty allowedDomains and a non-positive budgetCap are treated as absent", () => {
    const db = setup();
    const r1 = startMarathon(db, "alice", { goal: "x", allowedDomains: [], budgetCap: 0 });
    const row1 = getMarathon(db, r1.sessionId);
    assert.equal(row1.allowed_domains_json, null);
    assert.equal(row1.budget_cap, null);
    const r2 = startMarathon(db, "alice", { goal: "y", allowedDomains: "not-an-array", budgetCap: -5 });
    const row2 = getMarathon(db, r2.sessionId);
    assert.equal(row2.allowed_domains_json, null);
    assert.equal(row2.budget_cap, null);
  });
});

describe("domainForToolCall — maps each tool type to its macro-domain (or null)", () => {
  it("run_lens_action resolves to call.params.domain", () => {
    assert.equal(domainForToolCall({ tool: "run_lens_action", params: { domain: "crime", action: "record" } }), "crime");
  });
  it("web_search / create_dtu / expert_mode / generate_image resolve to their fixed domain", () => {
    assert.equal(domainForToolCall({ tool: "web_search", params: {} }), "tools");
    assert.equal(domainForToolCall({ tool: "create_dtu", params: {} }), "dtu");
    assert.equal(domainForToolCall({ tool: "expert_mode", params: {} }), "expert_mode");
    assert.equal(domainForToolCall({ tool: "generate_image", params: {} }), "multimodal");
  });
  it("tools with no macro-domain concept (browse_url, mcp_call, run_compute, ...) resolve to null", () => {
    assert.equal(domainForToolCall({ tool: "browse_url", params: {} }), null);
    assert.equal(domainForToolCall({ tool: "mcp_call", params: {} }), null);
    assert.equal(domainForToolCall({ tool: "run_compute", params: {} }), null);
    assert.equal(domainForToolCall({ tool: "browser_act", params: {} }), null);
    assert.equal(domainForToolCall({ tool: "mcp_list", params: {} }), null);
  });
});

describe("createToolGate — direct unit tests (no brain/loop needed)", () => {
  it("fails open when the session row doesn't exist", async () => {
    const db = setup();
    const gate = createToolGate(db, "nonexistent");
    const r = await gate({ tool: "web_search", params: {} });
    assert.deepEqual(r, { ok: true });
  });

  it("fails open against a pre-379 minimal schema (governance columns absent)", async () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE agent_marathon_sessions (id TEXT PRIMARY KEY, user_id TEXT, status TEXT)`);
    db.prepare(`INSERT INTO agent_marathon_sessions (id, user_id, status) VALUES ('m1','u1','running')`).run();
    const gate = createToolGate(db, "m1");
    const r = await gate({ tool: "run_lens_action", params: { domain: "anything" } });
    assert.equal(r.ok, true);
  });
});

describe("Item (a) — a tool call outside allowed_domains is refused, not crashed", () => {
  let db;
  beforeEach(() => { db = setup(); });
  afterEach(() => { db.close(); });

  it("refuses the out-of-scope call and lets the marathon keep going", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "do the thing", allowedDomains: ["dtu"] });

    let handlerCalled = false;
    const lensActions = new Map([
      ["forbidden_domain.foo", async () => { handlerCalled = true; return { ok: true }; }],
    ]);
    const runMacro = noopHarvest(async () => ({ ok: true, result: {} }));

    const brain = scriptedBrain([
      `Let me try something.\n[TOOL_CALL: {"tool":"run_lens_action","params":{"domain":"forbidden_domain","action":"foo","params":{}}}]`,
      `OK, I'll wrap up instead.`,
    ]);

    const r = await tickMarathon({
      db, sessionId, runMacro, lensActions,
      opts: { brainChat: brain, tickTurns: 5 },
    });

    assert.equal(r.ok, true);
    assert.equal(handlerCalled, false, "the forbidden domain's handler must never actually run");
    assert.notEqual(r.status, "revoked");
    assert.notEqual(r.status, "failed");

    const refusal = r.toolCalls.find((tc) => tc.tool === "run_lens_action");
    assert.ok(refusal, "the refusal is recorded as a real (failed) tool call, not silently dropped");
    assert.equal(refusal.ok, false);
    assert.match(refusal.error, /domain_not_allowed:forbidden_domain/);

    // Budget wasn't spent on a refused call.
    const row = getMarathon(db, sessionId);
    assert.equal(row.budget_spent, 0);
  });

  it("allows a call whose domain IS on the allowlist", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "do the thing", allowedDomains: ["dtu"] });
    const runMacro = noopHarvest(async (domain, name) => {
      assert.equal(domain, "dtu");
      assert.equal(name, "create");
      return { ok: true, id: "dtu_123" };
    });
    const brain = scriptedBrain([
      `[TOOL_CALL: {"tool":"create_dtu","params":{"title":"t","summary":"s"}}]`,
      `done.`,
    ]);
    const r = await tickMarathon({ db, sessionId, runMacro, lensActions: new Map(), opts: { brainChat: brain, tickTurns: 5 } });
    assert.equal(r.ok, true);
    const call = r.toolCalls.find((tc) => tc.tool === "create_dtu");
    assert.equal(call.ok, true);
    assert.equal(getMarathon(db, sessionId).budget_spent, 1);
  });
});

describe("Item (b) — budget cap halts the session exactly at the cap", () => {
  let db;
  beforeEach(() => { db = setup(); });
  afterEach(() => { db.close(); });

  it("allows exactly budgetCap real calls, then halts honestly on the next attempt", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "many searches", budgetCap: 2 });
    let realCalls = 0;
    const runMacro = noopHarvest(async () => { realCalls++; return { ok: true, summary: "result" }; });

    // Three TOOL_CALL markers in a single brain turn — chat-agent.js
    // executes up to 5 calls per turn, so all three are attempted in the
    // SAME tick, proving the halt fires mid-turn, not just between ticks.
    const brain = scriptedBrain([
      [
        `[TOOL_CALL: {"tool":"web_search","params":{"query":"a"}}]`,
        `[TOOL_CALL: {"tool":"web_search","params":{"query":"b"}}]`,
        `[TOOL_CALL: {"tool":"web_search","params":{"query":"c"}}]`,
      ].join("\n"),
    ]);

    const r = await tickMarathon({ db, sessionId, runMacro, lensActions: new Map(), opts: { brainChat: brain, tickTurns: 5 } });

    assert.equal(r.ok, true);
    assert.equal(r.status, "failed", "budget-halted sessions land on the existing 'failed' (ceiling-hit) status");
    assert.equal(r.halted, true);
    assert.equal(r.haltReason, "budget_exhausted");
    assert.equal(realCalls, 2, "only the first 2 (== budgetCap) calls actually ran");

    const row = getMarathon(db, sessionId);
    assert.equal(row.budget_spent, 2, "budget_spent never exceeds the cap");
    assert.equal(row.status, "failed");

    const refusal = r.toolCalls[r.toolCalls.length - 1];
    assert.equal(refusal.ok, false);
    assert.match(refusal.error, /budget_exhausted/);
  });

  it("a session with no budgetCap is never halted by the budget check", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "unrestricted spend" });
    const runMacro = noopHarvest(async () => ({ ok: true, summary: "result" }));
    const brain = scriptedBrain([
      Array.from({ length: 5 }, (_, i) => `[TOOL_CALL: {"tool":"web_search","params":{"query":"${i}"}}]`).join("\n"),
      `done.`,
    ]);
    const r = await tickMarathon({ db, sessionId, runMacro, lensActions: new Map(), opts: { brainChat: brain, tickTurns: 5 } });
    assert.equal(r.ok, true);
    assert.notEqual(r.halted, true);
    assert.equal(getMarathon(db, sessionId).budget_spent, 5, "spend is still recorded even with no cap to enforce");
  });
});

describe("Item (c) — revoked_at halts a running session immediately, even mid-tick", () => {
  let db;
  beforeEach(() => { db = setup(); });
  afterEach(() => { db.close(); });

  it("a revoke landing between two tool calls in the SAME turn stops the second call", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "do work" });
    // Flip to 'running' so revokeMarathon (which excludes only the terminal
    // set) can act on it — mirrors real usage: you can only revoke a live
    // session, and startMarathon's initial status is 'pending'.
    db.prepare(`UPDATE agent_marathon_sessions SET status = 'running' WHERE id = ?`).run(sessionId);

    let calls = 0;
    // Simulates a concurrent user action: the SECOND real tool call's
    // runMacro invocation is the moment "the user hits Revoke" lands —
    // exercising the exact mid-tick race the gate exists to close.
    const runMacro = noopHarvest(async () => {
      calls++;
      if (calls === 1) {
        const rr = revokeMarathon(db, sessionId, "alice");
        assert.equal(rr.ok, true);
      }
      return { ok: true, summary: "result" };
    });

    const brain = scriptedBrain([
      [
        `[TOOL_CALL: {"tool":"web_search","params":{"query":"a"}}]`,
        `[TOOL_CALL: {"tool":"web_search","params":{"query":"b"}}]`,
      ].join("\n"),
    ]);

    const r = await tickMarathon({ db, sessionId, runMacro, lensActions: new Map(), opts: { brainChat: brain, tickTurns: 5 } });

    assert.equal(r.ok, true);
    assert.equal(r.status, "revoked");
    assert.equal(r.halted, true);
    assert.equal(r.haltReason, "revoked");
    assert.equal(calls, 1, "the second (post-revoke) tool call never actually ran");

    const row = getMarathon(db, sessionId);
    assert.equal(row.status, "revoked");
    assert.ok(row.revoked_at > 0);
  });

  it("tickMarathon short-circuits BEFORE calling the brain at all when already revoked", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "do work" });
    db.prepare(`UPDATE agent_marathon_sessions SET status = 'running' WHERE id = ?`).run(sessionId);
    revokeMarathon(db, sessionId, "alice");

    let brainCalled = false;
    const brain = async () => { brainCalled = true; return { ok: true, text: "done." }; };

    const r = await tickMarathon({ db, sessionId, runMacro: async () => ({ ok: true }), lensActions: new Map(), opts: { brainChat: brain } });
    assert.equal(r.ok, true);
    assert.equal(r.status, "revoked");
    assert.equal(brainCalled, false, "no brain call is wasted on an already-revoked session");
  });

  it("a subsequent tick on an already-revoked session reports alreadyTerminal", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "do work" });
    db.prepare(`UPDATE agent_marathon_sessions SET status = 'revoked', revoked_at = unixepoch() WHERE id = ?`).run(sessionId);
    const r = await tickMarathon({ db, sessionId, runMacro: async () => ({ ok: true }), lensActions: new Map(), opts: {} });
    assert.equal(r.ok, true);
    assert.equal(r.alreadyTerminal, true);
    assert.equal(r.status, "revoked");
  });
});

describe("revokeMarathon — ownership + terminal-state guards", () => {
  let db;
  beforeEach(() => { db = setup(); });
  afterEach(() => { db.close(); });

  it("rejects a non-owner", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "x" });
    const r = revokeMarathon(db, sessionId, "mallory");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner");
    assert.equal(getMarathon(db, sessionId).status, "pending");
  });

  it("rejects an unknown session", () => {
    const r = revokeMarathon(db, "does-not-exist", "alice");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_found");
  });

  it("rejects revoking an already-terminal session", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "x" });
    db.prepare(`UPDATE agent_marathon_sessions SET status = 'completed' WHERE id = ?`).run(sessionId);
    const r = revokeMarathon(db, sessionId, "alice");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "already_terminal");
    assert.equal(r.status, "completed");
  });

  it("succeeds for the real owner on a pending/running/paused session", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "x" });
    const r = revokeMarathon(db, sessionId, "alice");
    assert.equal(r.ok, true);
    assert.equal(r.status, "revoked");
    const row = getMarathon(db, sessionId);
    assert.equal(row.status, "revoked");
    assert.ok(row.revoked_at > 0);
  });
});

describe("Item (d) — omitting the governance envelope preserves old backward-compatible behavior", () => {
  it("startMarathon still works against a pre-379 (migration-171-only) schema", () => {
    const db = new Database(":memory:");
    upMig171(db);
    const r = startMarathon(db, "alice", { goal: "old schema still works" });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id = ?`).get(r.sessionId);
    assert.equal(row.goal, "old schema still works");
    assert.equal(row.status, "pending");
  });

  it("revokeMarathon fails honestly (not silently) against a pre-379 schema", () => {
    const db = new Database(":memory:");
    upMig171(db);
    const r0 = startMarathon(db, "alice", { goal: "x" });
    const r = revokeMarathon(db, r0.sessionId, "alice");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "governance_columns_missing");
  });

  it("a marathon started with no allowedDomains/budgetCap runs tool calls exactly as before (unrestricted)", async () => {
    const db = setup();
    const { sessionId } = startMarathon(db, "alice", { goal: "unrestricted run" });
    let ran = false;
    const runMacro = noopHarvest(async () => { ran = true; return { ok: true, summary: "ok" }; });
    const brain = scriptedBrain([
      `[TOOL_CALL: {"tool":"web_search","params":{"query":"x"}}]`,
      `done.`,
    ]);
    const r = await tickMarathon({ db, sessionId, runMacro, lensActions: new Map(), opts: { brainChat: brain, tickTurns: 5 } });
    assert.equal(r.ok, true);
    assert.equal(ran, true);
    const call = r.toolCalls.find((tc) => tc.tool === "web_search");
    assert.equal(call.ok, true);
  });
});
