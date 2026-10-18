// textbook_lookup that doesn't state the fact → web_search in the same turn
// (live 2026-10-17: "Young's modulus of steel per a textbook" got three
// passages without "steel" and the model answered "≈200 GPa" from memory).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { textbookNeedsWeb, keyTerms } from "../lib/chat/textbook-fallback.js";
import { runAgentLoop } from "../lib/chat-agent.js";

const tb = (query, results, ok = true) => ({ tool: "textbook_lookup", ok, query, results });

describe("textbookNeedsWeb", () => {
  it("keeps a passage that carries every key term", () => {
    assert.deepEqual(keyTerms("what is the Young's modulus of steel per a textbook"), ["young", "modulus", "steel"]);
    assert.equal(textbookNeedsWeb(tb("Young's modulus of steel", [{ section: "12.3 Elastic Modulus", passage: "Steel has a Young's modulus of 200 GPa" }])), false);
  });
  it("falls back when no passage states it, when empty, or on failure", () => {
    assert.equal(textbookNeedsWeb(tb("Young's modulus of steel", [{ section: "12.3 Stress, Strain, and Elastic Modulus", passage: "a large value of elastic modulus" }])), true);
    assert.equal(textbookNeedsWeb(tb("critical buckling load column", [])), true);
    assert.equal(textbookNeedsWeb(tb("x", [], false)), true);
    assert.equal(textbookNeedsWeb({ tool: "web_search", ok: true }), false);
  });
});

describe("runAgentLoop textbook → web_search", () => {
  it("runs web_search in the same turn when the textbook lookup has nothing", async () => {
    const db = new Database(":memory:");
    const texts = ['[TOOL_CALL: {"tool":"textbook_lookup","params":{"query":"Young\'s modulus of steel per a textbook"}}]', "Steel: 200 GPa (https://e.com/steel)."];
    const brain = async () => ({ ok: true, text: texts.shift() ?? "done", provider: "test", model: "test" });
    const seen = [];
    const runMacro = async (d, a, input) => {
      if (d === "expert_mode" && a === "web_search") { seen.push(input.query); return { ok: true, results: [{ title: "Steel modulus", url: "https://e.com/steel", snippet: "Young's modulus of steel 200 GPa" }] }; }
      return { ok: true };
    };
    const out = await runAgentLoop({ db, userId: "u1", message: "Young's modulus of steel per a textbook?", runMacro, lensActions: new Map(), opts: { brainChat: brain, shadowContext: false, actionMemory: false } });
    const tools = out.toolCalls.map((t) => t.tool);
    assert.deepEqual(tools, ["textbook_lookup", "web_search"]);
    assert.equal(seen[0], "Young's modulus of steel");
    assert.match(out.answer, /200 GPa/);
    db.close();
  });
});
