// server/tests/whiteboard-agent.test.js
//
// Tier-2 contract test for Whiteboard Sprint B Item #9 — canvas
// agent. Real migration 171 + 208 + real DB writes. The LLM call
// inside runAgentStep is stubbed via ctx.llm so the suite doesn't
// need Ollama; what we test here is the wiring + tool dispatch.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerWhiteboardAgentMacros from "../domains/whiteboard-agent.js";
import { runAgentStep } from "../lib/whiteboard/canvas-agent.js";
import { upsertBoard, inviteParticipant, getBoard, appendDelta } from "../lib/whiteboard/persistence.js";

let db; let boardId; const macros = new Map();

before(async () => {
  db = new Database(":memory:");
  const m208 = await import("../migrations/208_whiteboard_persistence.js");
  m208.up(db);
  const m171 = await import("../migrations/171_agent_marathon_sessions.js");
  if (typeof m171.up === "function") m171.up(db); else if (typeof m171.default === "function") m171.default(db);
  registerWhiteboardAgentMacros((_d, n, h) => macros.set(n, h));
  const r = upsertBoard(db, { ownerId: "u_alice", title: "Agent board" });
  boardId = r.id;
  inviteParticipant(db, { boardId, userId: "u_view", role: "viewer" });
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("canvas-agent: agent_start / agent_status / agent_cancel / agent_list", () => {
  let sessionId;
  it("agent_start rejects no auth", async () => {
    const r = await macros.get("agent_start")({ db }, { boardId, task: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "auth_required");
  });

  it("agent_start rejects missing task or boardId", async () => {
    const r1 = await macros.get("agent_start")({ db, actor: { userId: "u_alice" } }, { task: "x" });
    assert.equal(r1.ok, false);
    const r2 = await macros.get("agent_start")({ db, actor: { userId: "u_alice" } }, { boardId });
    assert.equal(r2.ok, false);
  });

  it("agent_start inserts a marathon row with kind=whiteboard_agent_session", async () => {
    const r = await macros.get("agent_start")({ db, actor: { userId: "u_alice" } }, {
      boardId, task: "lay out a customer journey", maxSteps: 3,
    });
    assert.equal(r.ok, true);
    sessionId = r.sessionId;
    const row = db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id = ?`).get(sessionId);
    assert.ok(row.meta_json.includes('"kind":"whiteboard_agent_session"'));
    assert.ok(row.meta_json.includes(`"boardId":"${boardId}"`));
  });

  it("agent_status returns session + turns", async () => {
    const r = await macros.get("agent_status")({ db }, { sessionId });
    assert.equal(r.ok, true);
    assert.equal(r.session.id, sessionId);
    assert.ok(Array.isArray(r.turns));
  });

  it("agent_list scopes to owner + boardId", async () => {
    const r = await macros.get("agent_list")({ db, actor: { userId: "u_alice" } }, { boardId });
    assert.equal(r.ok, true);
    assert.ok(r.sessions.find((s) => s.id === sessionId));
  });

  it("agent_cancel sets status abandoned", async () => {
    const r = await macros.get("agent_cancel")({ db, actor: { userId: "u_alice" } }, { sessionId });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT status FROM agent_marathon_sessions WHERE id = ?`).get(sessionId);
    assert.equal(row.status, "abandoned");
  });
});

describe("canvas-agent: runAgentStep tool dispatch (stubbed LLM)", () => {
  it("LLM returns add_sticky → sticky lands in scene + element_add delta written", async () => {
    const ctx = {
      db, actor: { userId: "u_alice" },
      llm: { chat: async () => ({ text: JSON.stringify({ tool: "add_sticky", args: { text: "first sticky", x: 50, y: 60 } }) }) },
    };
    const step = await runAgentStep({ ctx, boardId, task: "drop a sticky", sessionId: "test", history: [] });
    assert.equal(step.ok, true);
    assert.equal(step.toolCalled, "add_sticky");
    const row = getBoard(db, boardId);
    assert.ok(row.scene.elements.some((e) => e.text === "first sticky"));
  });

  it("LLM returns connect with valid ids → arrow appears", async () => {
    // Seed two elements directly via appendDelta
    const a = { id: "n_a", kind: "rectangle", x: 0, y: 0, width: 100, height: 50 };
    const b = { id: "n_b", kind: "rectangle", x: 300, y: 200, width: 100, height: 50 };
    const start = getBoard(db, boardId).scene;
    const scene = { ...start, elements: [...(start.elements || []), a, b] };
    appendDelta(db, { boardId, userId: "u_alice", deltaKind: "scene_replace", delta: { reason: "seed" }, newScene: scene });
    const ctx = {
      db, actor: { userId: "u_alice" },
      llm: { chat: async () => ({ text: JSON.stringify({ tool: "connect", args: { fromId: "n_a", toId: "n_b" } }) }) },
    };
    const step = await runAgentStep({ ctx, boardId, task: "connect them", sessionId: "test", history: [] });
    assert.equal(step.ok, true);
    assert.equal(step.toolCalled, "connect");
    const row = getBoard(db, boardId);
    assert.ok(row.scene.elements.some((e) => e.kind === "arrow"));
  });

  it("LLM returns done → step marks done=true", async () => {
    const ctx = {
      db, actor: { userId: "u_alice" },
      llm: { chat: async () => ({ text: JSON.stringify({ tool: "done", args: { reason: "task complete" } }) }) },
    };
    const step = await runAgentStep({ ctx, boardId, task: "x", sessionId: "test", history: [] });
    assert.equal(step.ok, true);
    assert.equal(step.done, true);
  });

  it("No LLM → fallback adds a single sticky describing the task", async () => {
    const ctx = { db, actor: { userId: "u_alice" } };
    const step = await runAgentStep({ ctx, boardId, task: "no llm task", sessionId: "test", history: [] });
    assert.equal(step.ok, true);
    assert.equal(step.toolCalled, "add_sticky");
    assert.equal(step.done, true);
  });

  it("Forbidden when caller lacks editor role", async () => {
    const ctx = { db, actor: { userId: "u_view" }, llm: { chat: async () => ({ text: "{}" }) } };
    const step = await runAgentStep({ ctx, boardId, task: "x", sessionId: "test", history: [] });
    assert.equal(step.ok, false);
    assert.equal(step.reason, "forbidden");
  });
});

describe("agent_tick: heartbeat advances a due session", () => {
  it("agent_tick advances a pending session and writes a turn", async () => {
    // Start a new session
    const start = await macros.get("agent_start")({ db, actor: { userId: "u_alice" } }, { boardId, task: "advance me", maxSteps: 3 });
    // Force next_tick into the past
    db.prepare(`UPDATE agent_marathon_sessions SET next_tick_at = unixepoch() - 10 WHERE id = ?`).run(start.sessionId);
    const ctx = {
      db,
      llm: { chat: async () => ({ text: JSON.stringify({ tool: "add_sticky", args: { text: "tick added" } }) }) },
    };
    const r = await macros.get("agent_tick")(ctx, {});
    assert.equal(r.ok, true);
    assert.ok(r.advanced >= 1);
    const turn = db.prepare(`SELECT * FROM agent_marathon_turns WHERE session_id = ? AND turn_index = 1`).get(start.sessionId);
    assert.ok(turn);
  });
});
