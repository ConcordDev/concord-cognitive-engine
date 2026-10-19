// ConKay tools-by-default (Ramaj 2026-10-17: "not using tools, not searching
// things up"). Turn plan routing, the fallback call when the model answers
// from memory, the conkay_design 3D model artifact, the FEA honesty guard,
// and the widened image ask.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runAgentLoop, executeToolCall } from "../lib/chat-agent.js";
import { conkayTurnPlan, isDesignAsk, relativeDateHint } from "../lib/conkay/agent-turn.js";
import { guardFeaClaim } from "../lib/chat/fea-honesty.js";
import { explicitImagePrompt } from "../lib/chat/image-router.js";

const H = [
  { role: "user", content: "design a bracket that holds 50 kg, aluminum, show me the model" },
  { role: "assistant", content: "PASS: SF 2.5" },
];

describe("conkayTurnPlan", () => {
  it("routes the demo asks to the right tool", () => {
    assert.equal(conkayTurnPlan("search the web for the lightest carbon bike frames 2026").fallbackCall.tool, "web_search");
    const d = conkayTurnPlan("design a bracket that holds 50 kg, aluminum, show me the model");
    assert.equal(d.route, "design");
    assert.equal(d.fallbackCall.tool, "conkay_design");
    const f = conkayTurnPlan("run FEA on it", H);
    assert.equal(f.route, "fea");
    assert.equal(f.fallbackCall.params.text, H[0].content);
    assert.equal(conkayTurnPlan("make a short song").fallbackCall.params.action, "compose");
    assert.equal(conkayTurnPlan("create a task: call the machinist about bracket quote friday").route, "action");
  });
  it("factual questions get web_search; small talk does not", () => {
    for (const q of ["what is the yield strength of 6061-T6", "who won the world series last year", "how heavy is a carbon fiber road bike"]) {
      assert.equal(conkayTurnPlan(q)?.fallbackCall?.tool, "web_search", q);
    }
    for (const q of ["yo", "what can you do", "thanks"]) assert.equal(conkayTurnPlan(q), null, q);
  });
  it("isDesignAsk needs a part plus a design verb or load", () => {
    assert.equal(isDesignAsk("size a steel shaft for 200 Nm torque"), true);
    assert.equal(isDesignAsk("render a concept image of a bracket"), false);
    assert.equal(isDesignAsk("what is a beam of light"), false);
  });
});

describe("runAgentLoop fallbackCall", () => {
  it("runs the planned call when the first turn answers from memory", async () => {
    const db = new Database(":memory:");
    const texts = ["Carbon frames weigh about 700 g.", "From the results: frame X is 650 g (https://example.com/x)."];
    const brain = async () => ({ ok: true, text: texts.shift() ?? "done", provider: "test", model: "test" });
    const runMacro = async (d, a, input) => (d === "expert_mode" && a === "web_search"
      ? { ok: true, results: [{ title: "Frame X 650 g", url: "https://example.com/x", snippet: `${input.query}` }] }
      : { ok: true });
    const out = await runAgentLoop({
      db, userId: "u1", message: "lightest carbon frames?", runMacro, lensActions: new Map(),
      opts: { brainChat: brain, shadowContext: false, actionMemory: false, fallbackCall: { tool: "web_search", params: { query: "lightest carbon frames" } } },
    });
    assert.equal(out.toolCalls[0].tool, "web_search");
    assert.match(out.answer, /650 g/);
    assert.doesNotMatch(out.answer, /700 g/);
    db.close();
  });
  it("does nothing when the model already called a tool", async () => {
    const db = new Database(":memory:");
    const texts = ['[TOOL_CALL: {"tool":"web_search","params":{"query":"q1"}}]', "answer"];
    const brain = async () => ({ ok: true, text: texts.shift() ?? "done", provider: "test", model: "test" });
    const runMacro = async () => ({ ok: true, results: [{ title: "q1 hit", url: "https://e.com/1", snippet: "q1" }] });
    const out = await runAgentLoop({
      db, userId: "u1", message: "q1?", runMacro, lensActions: new Map(),
      opts: { brainChat: brain, shadowContext: false, actionMemory: false, fallbackCall: { tool: "conkay_design", params: { text: "x" } } },
    });
    assert.deepEqual(out.toolCalls.map((t) => t.tool), ["web_search"]);
    db.close();
  });
});

describe("runAgentLoop echoed tool result", () => {
  it("asks for a summary instead of showing a raw [TOOL_RESULT] dump", async () => {
    const db = new Database(":memory:");
    const texts = ['[TOOL_CALL: {"tool":"web_search","params":{"query":"6061-T6 yield"}}]', "[TOOL_RESULT: web_search] 1. raw dump", "6061-T6 yields at about 276 MPa (https://e.com/al)."];
    const brain = async () => ({ ok: true, text: texts.shift() ?? "[TOOL_RESULT: x] again", provider: "test", model: "test" });
    const runMacro = async () => ({ ok: true, results: [{ title: "Al 6061-T6", url: "https://e.com/al", snippet: "6061-T6 yield 276 MPa" }] });
    const out = await runAgentLoop({ db, userId: "u1", message: "6061-T6 yield?", runMacro, lensActions: new Map(), opts: { brainChat: brain, shadowContext: false, actionMemory: false } });
    assert.match(out.answer, /276 MPa/);
    assert.doesNotMatch(out.answer, /TOOL_RESULT/);
    db.close();
  });
  it("never returns the dump even when the summary also echoes", async () => {
    const db = new Database(":memory:");
    const texts = ['[TOOL_CALL: {"tool":"web_search","params":{"query":"q"}}]'];
    const brain = async () => ({ ok: true, text: texts.shift() ?? "[TOOL_RESULT: web_search] dump", provider: "test", model: "test" });
    const runMacro = async () => ({ ok: true, results: [{ title: "q hit", url: "https://e.com/q", snippet: "q" }] });
    const out = await runAgentLoop({ db, userId: "u1", message: "q?", runMacro, lensActions: new Map(), opts: { brainChat: brain, shadowContext: false, actionMemory: false } });
    assert.doesNotMatch(out.answer, /TOOL_RESULT/);
    db.close();
  });
});

describe("conkay_design returns a 3D model artifact", () => {
  it("carries the part mesh", async () => {
    const r = await executeToolCall({ actor: { userId: "u1" } }, async () => ({}), new Map(), { tool: "conkay_design", params: { text: "design a bracket that holds 50 kg, aluminum" } });
    assert.equal(r.ok, true);
    assert.equal(r.artifact?.kind, "mesh");
    assert.ok(r.artifact.positions.length >= 9);
    assert.ok(r.artifact.indices.length >= 3);
  });
});

describe("conkay_design unsupported part", () => {
  it("fails with a retry hint so the model can size it by formula", async () => {
    const r = await executeToolCall({ actor: { userId: "u1" } }, async () => ({}), new Map(), { tool: "conkay_design", params: { text: "size a steel shaft for 200 Nm torque" } });
    assert.equal(r.ok, false);
    assert.match(r.retryHint, /by formula/);
    assert.match(r.retryHint, /Do not call run_python/);
  });
});

describe("guardFeaClaim", () => {
  const failed = [{ tool: "run_lens_action", key: "engineering.runFEA", domain: "engineering", action: "runFEA", ok: false, error: "model must have at least one node and one member" }];
  it("removes an FEA pass claim when every FEA run failed", () => {
    const out = guardFeaClaim("Sized. FEA and hand analysis both confirm pass. Margin 25%.", failed);
    assert.doesNotMatch(out, /confirm pass/);
    assert.match(out, /FEA run failed \(model must have/);
  });
  it("leaves the answer alone when an FEA run succeeded or none ran", () => {
    assert.equal(guardFeaClaim("FEA confirms pass.", [{ tool: "conkay_design", ok: true, result: { fea: { ok: true } } }]), "FEA confirms pass.");
    assert.equal(guardFeaClaim("Hello.", []), "Hello.");
  });
  it("treats a conkay_design result with fea.ok false as a failed FEA", () => {
    const out = guardFeaClaim("The FEA confirms the hand calculation.", [{ tool: "conkay_design", ok: true, result: { fea: { ok: false, error: "runFEA failed" } } }]);
    assert.match(out, /^Note: the FEA run failed/);
  });
});

describe("explicitImagePrompt", () => {
  it("accepts style words before the picture noun", () => {
    assert.equal(explicitImagePrompt("render a concept image of a futuristic car")?.prompt, "a futuristic car, concept art");
    assert.equal(explicitImagePrompt("make an image of a red bicycle")?.prompt, "a red bicycle");
  });
  it("still ignores non-picture renders", () => {
    assert.equal(explicitImagePrompt("render the model"), null);
    assert.equal(explicitImagePrompt("render a stress plot of the beam"), null);
  });
});

describe("relativeDateHint", () => {
  const sat = new Date(2026, 9, 17, 21, 0); // Sat Oct 17 2026, local
  it("resolves weekday names to real dates", () => {
    const h = relativeDateHint("create a task: call the machinist friday", sat);
    assert.match(h, /today is saturday 2026-10-17/);
    assert.match(h, /friday = friday 2026-10-23/);
    assert.match(relativeDateHint("meeting tomorrow at 3pm", sat), /tomorrow = 2026-10-18/);
    assert.match(relativeDateHint("next saturday", sat), /2026-10-24/);
    assert.equal(relativeDateHint("call the machinist", sat), "");
  });
  it("rides the action plan hint", () => {
    assert.match(conkayTurnPlan("create a task: call the machinist about the bracket quote friday").hint, /friday = friday \d{4}-\d{2}-\d{2}/);
  });
});
