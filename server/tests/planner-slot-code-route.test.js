// server/tests/planner-slot-code-route.test.js
//
// Planner slot (byo-router.js#plannerBrainChat) for long-task planning and
// summary turns, and the 'code' agent route.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { plannerBrainChat } from "../lib/byo-router.js";
import { chatAgentRoute, isCodeAsk } from "../lib/chat/agent-route.js";
import { conkayTurnPlan } from "../lib/conkay/agent-turn.js";
import { runAgentLoop } from "../lib/chat-agent.js";

function db0() { return new Database(":memory:"); }

describe("plannerBrainChat", () => {
  const msgs = [{ role: "user", content: "plan it" }];
  it("falls back to the conscious slot when no planner model is set", async () => {
    const seen = [];
    const r = await plannerBrainChat({ db: db0(), userId: "u1", messages: msgs, brainMode: "standard" }, {
      env: {}, brainChat: async (a) => { seen.push(a.slot); return { ok: true, text: "c" }; }, ollamaChat: async () => { throw new Error("unused"); },
    });
    assert.equal(r.plannerRoute, "conscious");
    assert.deepEqual(seen, ["conscious"]);
  });

  it("uses CONCORD_PLANNER_MODEL on the conscious host, and falls back when it fails", async () => {
    const calls = [];
    const ok = await plannerBrainChat({ db: db0(), userId: "u1", messages: msgs, brainMode: "standard" }, {
      env: { CONCORD_PLANNER_MODEL: "qwen2.5:32b" },
      ollamaChat: async (slot, m, o) => { calls.push({ slot, model: o.model, timeoutMs: o.timeoutMs }); return { ok: true, text: "p" }; },
      brainChat: async () => ({ ok: true, text: "c" }),
    });
    assert.equal(ok.plannerRoute, "planner_model");
    assert.equal(ok.model, "qwen2.5:32b");
    assert.deepEqual(calls[0], { slot: "conscious", model: "qwen2.5:32b", timeoutMs: 240000 });
    const bad = await plannerBrainChat({ db: db0(), userId: "u1", messages: msgs, brainMode: "private" }, {
      env: { CONCORD_PLANNER_MODEL: "qwen2.5:32b" },
      ollamaChat: async () => ({ ok: false, error: "model not found" }),
      brainChat: async () => ({ ok: true, text: "c" }),
    });
    assert.equal(bad.plannerRoute, "conscious");
  });

  it("High Power users go through brainChat's BYO/platform routing", async () => {
    const r = await plannerBrainChat({ db: db0(), userId: "u1", messages: msgs, brainMode: "high_power" }, {
      env: { CONCORD_PLANNER_MODEL: "qwen2.5:32b" },
      ollamaChat: async () => { throw new Error("should not use the local planner"); },
      brainChat: async (a) => ({ ok: true, text: "hp", slot: a.slot, mode: a.brainMode }),
    });
    assert.equal(r.plannerRoute, "high_power");
    assert.equal(r.mode, "high_power");
  });
});

describe("wrap-up turn uses wrapUpBrainChat", () => {
  it("routes only the summary turn to the planner brain", async () => {
    const main = [];
    const wrap = [];
    const brain = async () => { main.push(1); return { ok: true, text: `[TOOL_CALL: {"tool":"web_search","params":{"query":"servo"}}]`, provider: "t", model: "t" }; };
    const out = await runAgentLoop({
      db: db0(), userId: "u1", message: "find servos", runMacro: async () => ({ ok: true, results: [] }), lensActions: new Map(),
      opts: { brainChat: brain, wrapUpBrainChat: async () => { wrap.push(1); return { ok: true, text: "Progress notes: summary.", provider: "planner", model: "big" }; }, shadowContext: false, actionMemory: false, maxTurns: 2 },
    });
    assert.equal(main.length, 2);
    assert.equal(wrap.length, 1);
    assert.match(out.answer, /Progress notes: summary\./);
  });
});

describe("code route", () => {
  it("routes coding asks to code and leaves lens writes alone", () => {
    for (const q of ["write a python script that renames my photos by date", "write unit tests for this function", "fix the bug in my parser", "implement quicksort in rust", "build a react component for a todo list"]) {
      assert.equal(chatAgentRoute(q), "code", q);
    }
    for (const q of ["create a task to call the machinist", "add a todo to buy milk", "remind me to write tests tomorrow", "design a steel cantilever beam 2 m long", "build a desktop robot arm", "plan a 2-week build of a desktop robot arm"]) {
      assert.notEqual(chatAgentRoute(q), "code", q);
    }
    assert.ok(!isCodeAsk("what is a python decorator"));
  });

  it("ConKay falls back to code.build for builds, not for tests", () => {
    const b = conkayTurnPlan("write a python script that renames my photos by date", []);
    assert.equal(b.route, "code");
    assert.deepEqual(b.fallbackCall, { tool: "run_lens_action", params: { domain: "code", action: "build", params: { request: "write a python script that renames my photos by date" } } });
    assert.match(b.hint, /code\.build/);
    const t = conkayTurnPlan("write unit tests for this function", []);
    assert.equal(t.route, "code");
    assert.equal(t.fallbackCall, null);
  });
});
