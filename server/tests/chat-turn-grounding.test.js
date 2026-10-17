// Live chat test (A40 brains, 2026-10-17) on /api/chat and /api/chat/stream:
//   * turn 3 "What does my Concord substrate (DTUs) know about heat pumps?"
//     re-answered turn 2's integral — the session working set carries the
//     previous query's DTUs into the next prompt;
//   * the DTU question in a fresh session got five invented DTUs;
//   * no chat turn ever called a tool (toolCallCount 0), so web questions
//     got invented links.
// Pins the carry-over filter + current-turn anchor, the DTU citation guard,
// and the route from chat.respond into the agent tool loop.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chatAgentRoute, answerViaAgent, sourcesFromToolCalls, routeHint } from "../lib/chat/agent-route.js";
import { collectRetrievedDtus, guardDtuCitations, asksAboutOwnDtus } from "../lib/chat/dtu-citation-guard.js";
import { filterCarryOverDtus, currentTurnAnchor, isBackReference } from "../lib/chat/turn-context.js";

const HEAT_PROMPT = "What does my Concord substrate (DTUs) know about heat pumps? Cite the DTUs you used.";
const INVENTED_REPLY = `You're asking about what your Concord substrate knows about heat pumps.

Here's what's in your DTU history:

- **DTU: Heat Pump Efficiency Metrics** — This DTU details the Coefficient of Performance.
  It includes real-world data from 2020–2023.

- **DTU: Heat Pump Lifecycle & Maintenance** — Covers long-term reliability.

These DTUs are part of your personal knowledge lattice.`;

afterEach(() => { delete process.env.CONCORD_CHAT_AGENT_ROUTE; });

describe("chatAgentRoute", () => {
  const cases = [
    ["Search the web for the current price trend of copper this month and cite your sources with links.", "web"],
    ["What is the latest news today about copper prices? Search the web and cite sources.", "web"],
    [HEAT_PROMPT, "dtu"],
    ["Compute the exact value of the integral of x^2 from 0 to 3, and verify it.", "compute"],
    ["Use ConKay to design a steel cantilever bracket for 500 N with a safety factor of 2.", "design"],
    ["Design a cantilever beam 1 m long for a 2 kN tip load", "design"],
    ["My test codeword is GREEN-OTTER-5. Just say noted.", null],
    ["Say hi.", null],
    ["How do I solve conflicts with my coworker?", null],
    ["Save this as a DTU about my substrate notes", null],
  ];
  for (const [p, want] of cases) {
    it(`${want ?? "none"} ← ${p.slice(0, 50)}`, () => assert.equal(chatAgentRoute(p), want));
  }
  it("CONCORD_CHAT_AGENT_ROUTE=0 turns it off", () => {
    process.env.CONCORD_CHAT_AGENT_ROUTE = "0";
    assert.equal(chatAgentRoute(HEAT_PROMPT), null);
  });
  it("has a tool hint for every route", () => {
    for (const r of ["web", "dtu", "compute", "design"]) assert.ok(routeHint(r).length > 20);
  });
});

describe("guardDtuCitations", () => {
  it("replaces an all-invented DTU answer with an honest one", () => {
    const g = guardDtuCitations(INVENTED_REPLY, collectRetrievedDtus([{ id: "dtu_aaa111", title: "Integral of x squared" }]), { prompt: HEAT_PROMPT });
    assert.deepEqual(g.removed, ["Heat Pump Efficiency Metrics", "Heat Pump Lifecycle & Maintenance"]);
    assert.match(g.text, /^I didn't find any DTUs about heat pumps/);
    assert.doesNotMatch(g.text, /Efficiency Metrics/);
    assert.match(g.text, /"Integral of x squared"/);
  });
  it("keeps a DTU that was retrieved and drops the invented one with its continuation", () => {
    const g = guardDtuCitations(INVENTED_REPLY, collectRetrievedDtus([{ id: "dtu_hp1", title: "Heat pump efficiency metrics (COP) by climate" }]), { prompt: HEAT_PROMPT });
    assert.match(g.text, /Heat Pump Efficiency Metrics/);
    assert.match(g.text, /real-world data/);
    assert.doesNotMatch(g.text, /Lifecycle/);
    assert.deepEqual(g.removed, ["Heat Pump Lifecycle & Maintenance"]);
    assert.match(g.text, /Removed 1 DTU reference/);
  });
  it("replaces unknown dtu ids and quoted titles, leaves known ones", () => {
    const retrieved = collectRetrievedDtus(JSON.stringify({ results: [{ id: "dtu_63e9120a2f05", title: "Copper market notes" }] }));
    const g = guardDtuCitations('See dtu_63e9120a2f05 and dtu_deadbeef0000, and the DTU titled "Quantum Copper Theory".', retrieved, { prompt: "copper?" });
    assert.match(g.text, /dtu_63e9120a2f05/);
    assert.match(g.text, /\[unknown DTU\]/);
    assert.match(g.text, /a DTU I could not find/);
  });
  it("leaves a reply with no DTU references untouched", () => {
    const g = guardDtuCitations("Paris is the capital of France.", collectRetrievedDtus([]), { prompt: "capital of France" });
    assert.equal(g.text, "Paris is the capital of France.");
    assert.equal(g.removed.length, 0);
  });
  it("detects questions about the user's own DTUs", () => {
    assert.equal(asksAboutOwnDtus(HEAT_PROMPT), true);
    assert.equal(asksAboutOwnDtus("what is a heat pump"), false);
  });
});

describe("turn context", () => {
  const integralDtus = [
    { id: "a", title: "AI: The integral of x^2 from 0 to 3 is 9", tags: ["math"] },
    { id: "b", title: "Power rule for integration", tags: ["calculus"] },
    { id: "c", title: "Heat pump COP notes", tags: ["hvac"] },
  ];
  it("drops carried-over DTUs unrelated to the current message", () => {
    assert.deepEqual(filterCarryOverDtus(integralDtus, HEAT_PROMPT).map((d) => d.id), ["c"]);
  });
  it("keeps them for a back-reference follow-up", () => {
    assert.equal(isBackReference("what about the second one?"), true);
    assert.equal(filterCarryOverDtus(integralDtus, "and verify that?").length, 3);
  });
  it("anchors the system prompt on the current message", () => {
    const a = currentTurnAnchor(HEAT_PROMPT);
    assert.match(a, /CURRENT MESSAGE/);
    assert.ok(a.includes("heat pumps"));
    assert.match(a, /never re-answer them/);
  });
});

describe("answerViaAgent", () => {
  it("runs chat_agent.do with history + route hint and returns grounded output", async () => {
    let seen = null;
    const runMacro = async (domain, name, input, ctx) => {
      seen = { domain, name, input, ctx };
      return {
        ok: true,
        answer: "- **DTU: Heat pump COP notes** — real.\n- **DTU: Geothermal Myths** — invented.",
        toolCalls: [
          { tool: "run_lens_action", ok: true, result: { results: [{ id: "dtu_hp", title: "Heat pump COP notes" }] } },
          { tool: "web_search", ok: true, result: JSON.stringify({ results: [{ title: "Kitco copper", url: "https://www.kitco.com/x", snippet: "s" }] }) },
        ],
        contextDtus: [],
        provider: "concord_default", model: "qwen3",
      };
    };
    const out = await answerViaAgent({
      runMacro, ctx: { db: {}, actor: { userId: "u1" } },
      history: [{ role: "user", content: "earlier" }, { role: "assistant", content: "ok" }],
      prompt: HEAT_PROMPT, route: "dtu",
    });
    assert.equal(seen.domain, "chat_agent");
    assert.equal(seen.name, "do");
    assert.equal(seen.input.message, HEAT_PROMPT);
    assert.equal(seen.input.history.length, 2);
    assert.match(seen.input.routeHint, /dtu\.search/);
    assert.match(out.reply, /Heat pump COP notes/);
    assert.doesNotMatch(out.reply, /Geothermal Myths/);
    assert.deepEqual(out.dtuRefsRemoved, ["Geothermal Myths"]);
    assert.deepEqual(out.sources, [{ type: "web", title: "Kitco copper", url: "https://www.kitco.com/x", snippet: "s" }]);
  });
  it("declines without a signed-in actor or db (anonymous chat keeps the old path)", async () => {
    const runMacro = async () => { throw new Error("must not run"); };
    assert.equal(await answerViaAgent({ runMacro, ctx: { db: {}, actor: {} }, prompt: "x", route: "web" }), null);
    assert.equal(await answerViaAgent({ runMacro, ctx: { actor: { userId: "u" } }, prompt: "x", route: "web" }), null);
  });
  it("returns null when the loop fails so chat falls through", async () => {
    const out = await answerViaAgent({ runMacro: async () => ({ ok: false, error: "brain_failed" }), ctx: { db: {}, actor: { userId: "u" } }, prompt: "x", route: "web" });
    assert.equal(out, null);
  });
  it("sourcesFromToolCalls ignores failed and non-web calls", () => {
    assert.deepEqual(sourcesFromToolCalls([{ tool: "web_search", ok: false, result: "{}" }, { tool: "run_compute", ok: true }]), []);
  });
});

describe("chat.respond wiring (server.js)", () => {
  const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const impl = src.slice(src.indexOf("async function __chatRespondImpl("), src.indexOf('register("chat", "respond"'));
  it("routes tool-worthy prompts to the agent loop before the conversational brain call", () => {
    const route = impl.indexOf("_ar.chatAgentRoute(prompt)");
    const brain = impl.indexOf("const r = await ctx.llm.chat({");
    assert.ok(route > 0 && brain > 0 && route < brain);
    assert.ok(impl.indexOf("sess.messages.push({ role: \"user\", content: prompt") < route, "user turn is recorded first");
    assert.match(impl, /_persistDeterministicTurn\(_agentReply, _agentMeta\)/);
  });
  it("filters carried-over DTUs, anchors the current turn and guards DTU citations", () => {
    assert.match(impl, /filterCarryOverDtus\(_extraUnifiedDtus, prompt\)/);
    assert.match(impl, /_lensHintSuffix \+ \(_identityContextNote \? \("\\n\\n" \+ _identityContextNote\) : ""\) \+ _currentTurnAnchor/);
    assert.match(impl, /guardDtuCitations\(finalReply, _retrievedDtus, \{ prompt \}\)/);
  });
  it("chat_agent.do forwards the route hint as a system addendum", () => {
    const dom = readFileSync(new URL("../domains/chat-agent.js", import.meta.url), "utf8");
    assert.match(dom, /input\.routeHint/);
    assert.match(dom, /extraSystemBlock/);
  });
});
