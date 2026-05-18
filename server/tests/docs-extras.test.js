// server/tests/docs-extras.test.js
//
// Tier-2 contract tests for Sprint C semantic search + embed
// validation. Semantic search exercises the bigram scoring on real
// SQLite; embeds exercise the allowlist + kind validation.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerDocsMacros from "../domains/docs.js";
import registerDocsExtrasMacros from "../domains/docs-extras.js";
import { semanticSearch } from "../lib/docs/semantic.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const n of ["211_documents", "212_doc_ai", "213_doc_extensions"]) {
    const m = await import(`../migrations/${n}.js`);
    m.up(db);
  }
  registerDocsMacros(register);
  registerDocsExtrasMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId = "u_extra") { return { db, actor: { userId } }; }

describe("docs semantic search", () => {
  before(async () => {
    await MACROS.get("create")(ctx("u_sem"), { title: "Web performance notes", contentHtml: "<p>Critical rendering path matters for fast page loads. Reduce render-blocking JavaScript.</p>" });
    await MACROS.get("create")(ctx("u_sem"), { title: "Cooking recipes", contentHtml: "<p>Bread requires flour water yeast salt. Long fermentation improves flavor.</p>" });
    await MACROS.get("create")(ctx("u_sem"), { title: "Database design", contentHtml: "<p>Normalization reduces data duplication. Indexes speed lookups.</p>" });
  });

  it("bigram match outranks token-only match", () => {
    const r = semanticSearch(db, { ownerId: "u_sem", query: "render blocking", limit: 5 });
    assert.ok(r.length >= 1);
    assert.equal(r[0].title, "Web performance notes");
  });

  it("returns snippet pinned to the match span", () => {
    const r = semanticSearch(db, { ownerId: "u_sem", query: "fermentation", limit: 5 });
    assert.ok(r.length >= 1);
    assert.ok(r[0].snippet.toLowerCase().includes("fermentation"));
  });

  it("returns [] for queries with no hits", () => {
    const r = semanticSearch(db, { ownerId: "u_sem", query: "xyzkalimba neverword", limit: 5 });
    assert.equal(r.length, 0);
  });

  it("macro envelope shape matches", async () => {
    const r = await MACROS.get("semantic_search")(ctx("u_sem"), { query: "fast page loads" });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.results));
    assert.ok(r.results.find((x) => x.title === "Web performance notes"));
  });

  it("short queries return empty results", async () => {
    const r = await MACROS.get("semantic_search")(ctx("u_sem"), { query: "x" });
    assert.equal(r.results.length, 0);
  });
});

describe("docs embed_validate", () => {
  it("youtube iframe accepted", async () => {
    const r = await MACROS.get("embed_validate")(ctx(), { kind: "iframe", content: "https://www.youtube.com/embed/abc123" });
    assert.equal(r.ok, true);
    assert.equal(r.host, "www.youtube.com");
  });

  it("non-allowlisted host rejected", async () => {
    const r = await MACROS.get("embed_validate")(ctx(), { kind: "iframe", content: "https://evil.example.com/embed" });
    assert.equal(r.ok, false); assert.equal(r.reason, "host_not_allowlisted");
  });

  it("math content rejects script injection", async () => {
    const r = await MACROS.get("embed_validate")(ctx(), {
      kind: "math",
      content: "<script>alert(1)</script>x^2 + y^2 = z^2",
    });
    assert.equal(r.ok, false); assert.equal(r.reason, "unsafe_content");
  });

  it("math content with clean LaTeX accepted", async () => {
    const r = await MACROS.get("embed_validate")(ctx(), { kind: "math", content: "\\frac{a}{b} = c" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "\\frac{a}{b} = c");
  });

  it("mermaid with known diagram type accepted", async () => {
    const r = await MACROS.get("embed_validate")(ctx(), {
      kind: "mermaid", content: "graph TD\n  A --> B\n  B --> C",
    });
    assert.equal(r.ok, true);
    assert.equal(r.diagramType, "graph");
  });

  it("mermaid with unknown type rejected", async () => {
    const r = await MACROS.get("embed_validate")(ctx(), {
      kind: "mermaid", content: "notADiagram\n  bogus syntax",
    });
    assert.equal(r.ok, false); assert.equal(r.reason, "unknown_diagram_type");
  });

  it("video/audio URLs accepted with http(s) prefix", async () => {
    const a = await MACROS.get("embed_validate")(ctx(), { kind: "video", content: "https://cdn.example.com/v.mp4" });
    assert.equal(a.ok, true);
    const b = await MACROS.get("embed_validate")(ctx(), { kind: "audio", content: "/api/docs-asset/dimg_x" });
    assert.equal(b.ok, true);
    const c = await MACROS.get("embed_validate")(ctx(), { kind: "video", content: "javascript:alert(1)" });
    assert.equal(c.ok, false);
  });

  it("oversized content rejected", async () => {
    const r = await MACROS.get("embed_validate")(ctx(), {
      kind: "math", content: "x".repeat(200_000),
    });
    assert.equal(r.ok, false); assert.equal(r.reason, "content_too_large");
  });
});

describe("docs embed_render_svg", () => {
  it("math placeholder is deterministic", async () => {
    const a = await MACROS.get("embed_render_svg")(ctx(), { kind: "math", content: "x^2 + y^2 = z^2" });
    const b = await MACROS.get("embed_render_svg")(ctx(), { kind: "math", content: "x^2 + y^2 = z^2" });
    assert.equal(a.url, b.url);
  });

  it("rejects non-svg kinds", async () => {
    const r = await MACROS.get("embed_render_svg")(ctx(), { kind: "audio", content: "x" });
    assert.equal(r.ok, false); assert.equal(r.reason, "kind_not_svg_renderable");
  });
});
