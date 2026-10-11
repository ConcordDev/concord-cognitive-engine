// Chat tool surface: catalog honesty + web_search routing.
//
// Does not boot server.js. The live chat.tools macro is covered by
// tests/depth/chat-behavior.test.js; this file pins the pure report and
// the dispatcher chat.respond calls, and checks those call sites still
// point here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CHAT_RESPOND_TOOLS,
  AGENT_LOOP_TOOLS,
  buildChatToolsReport,
  dispatchChatWebSearch,
  chatToolsInjected,
} from "../lib/chat-tool-surface.js";

const SERVER_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "../server.js");
const CHAT_AGENT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../lib/chat-agent.js");

function executeToolCallSource() {
  const src = readFileSync(CHAT_AGENT, "utf8");
  const start = src.indexOf("export async function executeToolCall");
  const end = src.indexOf("function _screenUntrusted");
  assert.ok(start > 0 && end > start);
  return src.slice(start, end);
}

function chatPromptToolBlock() {
  const src = readFileSync(SERVER_JS, "utf8");
  const start = src.indexOf("const _toolSystemPrompt");
  const end = src.indexOf("const _DOMAIN_KW");
  assert.ok(start > 0 && end > start);
  return src.slice(start, end);
}

function chatExecuteToolCallSource() {
  const src = readFileSync(SERVER_JS, "utf8");
  const start = src.indexOf("const _executeToolCall = async");
  const end = src.indexOf("const _executeToolCalls = async");
  assert.ok(start > 0 && end > start);
  return src.slice(start, end);
}

describe("chat tool catalog matches both live paths", () => {
  it("lists the tools chat.respond writes into the prompt, including operator-only", () => {
    const src = readFileSync(SERVER_JS, "utf8");
    const prompted = [...chatPromptToolBlock().matchAll(/^- ([a-z_]+):/gm)].map((m) => m[1]);
    assert.deepEqual(prompted, CHAT_RESPOND_TOOLS.filter((t) => !t.operatorOnly).map((t) => t.name));
    const opStart = src.indexOf("const _operatorToolLines");
    const opBlock = src.slice(opStart, src.indexOf("const _operatorV6Block"));
    for (const t of CHAT_RESPOND_TOOLS.filter((x) => x.operatorOnly)) {
      assert.match(opBlock, new RegExp(`- ${t.name}:`));
    }
  });

  it("lists every executeToolCall case and no extra names", () => {
    const cases = [...executeToolCallSource().matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(cases)].sort(), AGENT_LOOP_TOOLS.map((t) => t.name).sort());
    assert.ok(AGENT_LOOP_TOOLS.length >= 19);
  });

  it("chat path is available when toolsEnabled is not false, even without session opt-in", () => {
    assert.equal(chatToolsInjected(undefined), true);
    assert.equal(chatToolsInjected(true), true);
    assert.equal(chatToolsInjected(false), false);

    const on = buildChatToolsReport({ toolsEnabled: true, sessionOptIn: false, operator: false });
    assert.equal(on.available, true);
    assert.equal(on.sessionOptIn, false);
    assert.equal(on.sessionOptInGatesAvailability, false);
    assert.equal(on.paths.chat.available, true);
    assert.equal(on.paths.chat.gatedBySessionOptIn, false);
    assert.deepEqual(on.tools.map((t) => t.name), [
      "web_search", "run_compute", "browse_url", "create_dtu", "run_lens_action",
    ]);
    assert.equal(on.tools.every((t) => t.available === true && t.path === "chat"), true);
    assert.equal(on.tools.find((t) => t.name === "run_compute").requiresOptIn, false);
    assert.ok(on.computeKeys.includes("chemistry.balanceReaction"));
    assert.ok(on.computeKeys.includes("math.differentiate"));

    const off = buildChatToolsReport({ toolsEnabled: false, sessionOptIn: true, operator: false });
    assert.equal(off.available, false);
    assert.equal(off.globalEnabled, false);
    assert.equal(off.paths.chat.available, false);
    assert.equal(off.paths.chat.tools.every((t) => t.available === false), true);
    // The agent loop does not read the flag.
    assert.equal(off.paths.agent.available, true);
    assert.equal(off.paths.agent.gatedByToolsEnabled, false);
    assert.equal(off.paths.agent.tools.every((t) => t.available === true), true);
    assert.equal(off.paths.agent.tools.length, AGENT_LOOP_TOOLS.length);
  });

  it("undefined toolsEnabled still counts as injected, matching chat.respond", () => {
    const r = buildChatToolsReport({ sessionOptIn: false, operator: false });
    assert.equal(r.available, true);
    assert.equal(r.globalEnabled, false);
    assert.equal(r.paths.chat.reason.includes("not false"), true);
  });

  it("operator-only chat tools appear only for an operator", () => {
    const member = buildChatToolsReport({ toolsEnabled: true, operator: false });
    assert.equal(member.tools.some((t) => t.name === "invoke_capability"), false);
    const op = buildChatToolsReport({ toolsEnabled: true, operator: true });
    assert.ok(op.tools.some((t) => t.name === "list_capabilities" && t.operatorOnly && t.available));
    assert.ok(op.tools.some((t) => t.name === "invoke_capability" && t.available));
    const scoped = op.paths.agent.tools.find((t) => t.name === "invoke_capability");
    assert.equal(scoped.operatorScoped, true);
    assert.equal(scoped.available, true);
    assert.equal(scoped.memberEffect, "operator_only_for_private");
  });
});

describe("dispatchChatWebSearch routes to expert_mode.web_search", () => {
  it("does not call tools.web_search and shapes hits for the cite pass", async () => {
    const calls = [];
    const runMacro = async (domain, name, input, ctx) => {
      calls.push({ domain, name, input, ctx });
      return {
        ok: true,
        query: input.query,
        results: [
          { title: "Paris", url: "https://example.test/paris", snippet: "Capital of France." },
          { name: "Lyon", link: "https://example.test/lyon", description: "A city." },
        ],
      };
    };
    const ctx = { actor: { userId: "u1" } };
    const out = await dispatchChatWebSearch(runMacro, ctx, { query: "  capital of france  ", limit: 3 });
    assert.deepEqual(calls.map((c) => [c.domain, c.name]), [["expert_mode", "web_search"]]);
    assert.equal(calls[0].input.query, "capital of france");
    assert.equal(calls[0].input.limit, 3);
    assert.equal(calls[0].ctx, ctx);
    assert.equal(out.ok, true);
    assert.equal(out.source, "expert_mode.web_search");
    assert.match(out.result, /1\. title: Paris\n {3}url: https:\/\/example\.test\/paris\n {3}excerpt: Capital of France\./);
    assert.match(out.result, /2\. title: Lyon\n {3}url: https:\/\/example\.test\/lyon/);
  });

  it("reads sources when results is absent, and accepts q as the query", async () => {
    const runMacro = async () => ({
      ok: true,
      sources: [{ title: "A", href: "https://a.test", text: "body" }],
    });
    const out = await dispatchChatWebSearch(runMacro, {}, { q: "hello" });
    assert.equal(out.ok, true);
    assert.match(out.result, /title: A/);
    assert.match(out.result, /url: https:\/\/a\.test/);
    assert.match(out.result, /excerpt: body/);
  });

  it("rejects an empty query before calling the macro", async () => {
    let called = false;
    const out = await dispatchChatWebSearch(async () => { called = true; return { ok: true }; }, {}, {});
    assert.equal(called, false);
    assert.equal(out.ok, false);
    assert.equal(out.error, "query required");
  });

  it("surfaces a macro rejection and a thrown error", async () => {
    const rejected = await dispatchChatWebSearch(async () => ({ ok: false, reason: "missing_query" }), {}, { query: "x" });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, "missing_query");
    const thrown = await dispatchChatWebSearch(async () => { throw new Error("boom"); }, {}, { query: "x" });
    assert.equal(thrown.ok, false);
    assert.equal(thrown.error, "boom");
  });

  it("returns an empty result string when the search succeeds with no hits", async () => {
    const out = await dispatchChatWebSearch(async () => ({ ok: true, results: [] }), {}, { query: "nothing" });
    assert.equal(out.ok, true);
    assert.equal(out.result, "");
    assert.equal(out.source, "expert_mode.web_search");
  });

  it("chat.respond's tool switch calls this dispatcher and not tools.web_search", () => {
    const body = chatExecuteToolCallSource();
    assert.match(body, /dispatchChatWebSearch\(runMacro, ctx, call\.params/);
    assert.doesNotMatch(body, /runMacro\(\s*"tools"\s*,\s*"web_search"/);
  });
});

describe("ctx.llm.chat forwards think from the call object", () => {
  it("the Ollama fetch body reads arguments[0].think and does not name it in the signature", () => {
    const src = readFileSync(SERVER_JS, "utf8");
    const start = src.indexOf("async chat({ system, messages,");
    const end = src.indexOf("// ===== END BYO KEY ROUTING =====", start);
    assert.ok(start > 0 && end > start);
    const signature = src.slice(start, src.indexOf(") {", start));
    assert.doesNotMatch(signature, /\bthink\b/);
    const fetchAt = src.indexOf("const res = await fetch(`${brainUrl}/api/chat`", start);
    assert.ok(fetchAt > start);
    const fetchBody = src.slice(fetchAt, fetchAt + 900);
    // Boolean-gated spread so a non-boolean think is omitted, and the
    // destructured signature stays untouched (PR #1081 owns that line).
    assert.match(fetchBody, /typeof arguments\[0\]\?\.think === "boolean"/);
    assert.match(fetchBody, /think: arguments\[0\]\.think/);
  });
});
