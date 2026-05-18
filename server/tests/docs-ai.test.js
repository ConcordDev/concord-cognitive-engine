// server/tests/docs-ai.test.js
//
// Tier-2 contract tests for the Docs Sprint B AI macros. We test
// the deterministic fallback paths + the structural contract (correct
// envelope shape, ledger row written, source label correct) without
// requiring an actual Ollama backend.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerDocsAiMacros from "../domains/docs-ai.js";
import registerDocsMacros from "../domains/docs.js";
import { plainTextToHtml, htmlToContext } from "../lib/docs/ai-compose.js";

const MACROS = new Map();
function register(_domain, name, handler) { MACROS.set(name, handler); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const n of ["211_documents", "212_doc_ai"]) {
    const m = await import(`../migrations/${n}.js`);
    m.up(db);
  }
  registerDocsMacros(register);
  registerDocsAiMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId = "u_ai", llm = null) { return { db, actor: { userId }, llm }; }

async function makeDoc(userId, title = "Doc") {
  const r = await MACROS.get("create")(ctx(userId), { title, contentHtml: "<p>Body text here</p>" });
  return r.id;
}

describe("docs-ai: fallback envelope shapes", () => {
  it("ai_compose returns html + text with source=fallback when no LLM", async () => {
    const r = await MACROS.get("ai_compose")(ctx(), { prompt: "Write something" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    assert.ok(typeof r.html === "string" && r.html.length > 0);
    assert.ok(typeof r.text === "string");
  });

  it("ai_inline_edit returns selection unchanged when no LLM", async () => {
    const r = await MACROS.get("ai_inline_edit")(ctx(), { selection: "hello world", instruction: "shorten" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    assert.equal(r.edited, "hello world");
  });

  it("ai_continue returns empty continuation when no LLM", async () => {
    const r = await MACROS.get("ai_continue")(ctx(), { context: "Once upon a time" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    assert.equal(r.continuation, "");
  });

  it("ai_image returns a deterministic SVG data URI", async () => {
    const r = await MACROS.get("ai_image")(ctx(), { prompt: "minimal cover" });
    assert.equal(r.ok, true);
    assert.ok(r.url.startsWith("data:image/svg+xml;base64,"));
    assert.ok(r.svg.includes("<svg"));
    // determinism — same prompt twice → identical output
    const r2 = await MACROS.get("ai_image")(ctx(), { prompt: "minimal cover" });
    assert.equal(r2.url, r.url);
  });

  it("voice_transcribe persists transcript without LLM (passthrough)", async () => {
    const r = await MACROS.get("voice_transcribe")(ctx(), { transcript: "hello world" });
    assert.equal(r.ok, true);
    assert.equal(r.text, "hello world");
    assert.equal(r.source, "passthrough");
    assert.ok(r.html.includes("hello world"));
  });
});

describe("docs-ai: required-field validation", () => {
  it("ai_compose requires prompt", async () => {
    const r = await MACROS.get("ai_compose")(ctx(), {});
    assert.equal(r.ok, false); assert.equal(r.reason, "prompt_required");
  });

  it("ai_inline_edit requires selection + instruction", async () => {
    const a = await MACROS.get("ai_inline_edit")(ctx(), { instruction: "x" });
    assert.equal(a.reason, "selection_required");
    const b = await MACROS.get("ai_inline_edit")(ctx(), { selection: "x" });
    assert.equal(b.reason, "instruction_required");
  });

  it("ai_continue requires context", async () => {
    const r = await MACROS.get("ai_continue")(ctx(), {});
    assert.equal(r.reason, "context_required");
  });

  it("ai_qa requires question", async () => {
    const r = await MACROS.get("ai_qa")(ctx(), {});
    assert.equal(r.reason, "question_required");
  });

  it("ai_match_style requires both sourceText and targetDocId", async () => {
    const a = await MACROS.get("ai_match_style")(ctx(), { sourceText: "x" });
    assert.equal(a.reason, "targetDocId_required");
    const b = await MACROS.get("ai_match_style")(ctx(), { targetDocId: "x" });
    assert.equal(b.reason, "sourceText_required");
  });

  it("voice_transcribe requires transcript", async () => {
    const r = await MACROS.get("voice_transcribe")(ctx(), {});
    assert.equal(r.reason, "transcript_required");
  });
});

describe("docs-ai: ledger writes", () => {
  it("every successful AI macro writes a doc_ai_runs row", async () => {
    const userId = "u_ledger2";
    const docId = await makeDoc(userId);
    await MACROS.get("ai_compose")(ctx(userId), { documentId: docId, prompt: "compose this" });
    await MACROS.get("ai_inline_edit")(ctx(userId), { documentId: docId, selection: "x", instruction: "y" });
    await MACROS.get("ai_image")(ctx(userId), { documentId: docId, prompt: "p" });
    const rows = db.prepare(`SELECT kind FROM doc_ai_runs WHERE user_id = ? ORDER BY id`).all(userId);
    const kinds = rows.map((r) => r.kind);
    assert.ok(kinds.includes("compose"));
    assert.ok(kinds.includes("inline_edit"));
    assert.ok(kinds.includes("image"));
  });

  it("documentId-scoped run rows respect FK", async () => {
    const userId = "u_fk";
    const docId = await makeDoc(userId);
    await MACROS.get("ai_compose")(ctx(userId), { documentId: docId, prompt: "x" });
    const row = db.prepare(`SELECT document_id FROM doc_ai_runs WHERE user_id = ? ORDER BY id DESC LIMIT 1`).get(userId);
    assert.equal(row.document_id, docId);
  });
});

describe("docs-ai: permission gates", () => {
  it("ai_inline_edit on a doc the user lacks editor on returns forbidden", async () => {
    const ownerDocId = await makeDoc("u_owner_x");
    const r = await MACROS.get("ai_inline_edit")(ctx("u_outsider"), {
      documentId: ownerDocId, selection: "x", instruction: "y",
    });
    assert.equal(r.ok, false); assert.equal(r.reason, "forbidden");
  });

  it("ai_qa without any sources returns helpful fallback", async () => {
    const r = await MACROS.get("ai_qa")(ctx("u_qa_empty"), { question: "Who am I?" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    assert.ok(r.answer.includes("workspace") || r.answer.includes("sources"));
  });
});

describe("docs-ai: LLM-path happy case (mock brain)", () => {
  it("ai_compose with mock LLM returns source=llm + html derived from text", async () => {
    const llm = { chat: async () => ({ content: "# Title\n\nFirst paragraph.\n\nSecond paragraph." }) };
    const r = await MACROS.get("ai_compose")({ db, actor: { userId: "u_llm" }, llm }, { prompt: "x" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "llm");
    assert.ok(r.html.includes("<h1>"));
    assert.ok(r.html.includes("<p>"));
  });

  it("ai_inline_edit with mock LLM returns rewritten text", async () => {
    const llm = { chat: async () => ({ content: "shorter version" }) };
    const r = await MACROS.get("ai_inline_edit")(
      { db, actor: { userId: "u_llm2" }, llm },
      { selection: "this is the original long version", instruction: "shorten" },
    );
    assert.equal(r.ok, true);
    assert.equal(r.edited, "shorter version");
  });
});

describe("ai-compose helpers", () => {
  it("plainTextToHtml: headings/lists/paragraphs/fences", () => {
    const html = plainTextToHtml(
      `# Heading\n\nFirst para.\n\n- bullet a\n- bullet b\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n\nLast para.`
    );
    assert.ok(html.includes("<h1>Heading</h1>"));
    assert.ok(html.includes("<ul>"));
    assert.ok(html.includes("<li><p>bullet a</p></li>"));
    assert.ok(html.includes("<pre><code>"));
    assert.ok(html.includes("Last para"));
  });

  it("htmlToContext strips tags and clamps length", () => {
    const t = htmlToContext("<h1>Title</h1><p>body</p>", 100);
    assert.equal(t, "Title body");
    const big = htmlToContext("<p>" + "x".repeat(2000) + "</p>", 50);
    assert.ok(big.endsWith("…"));
    assert.ok(big.length <= 51);
  });
});
