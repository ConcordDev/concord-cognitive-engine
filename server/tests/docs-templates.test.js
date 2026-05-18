// server/tests/docs-templates.test.js
//
// Tier-2 contract tests for Docs Sprint C templates: CRUD + seed
// defaults + apply (instantiates a new doc + bumps usage_count) +
// save_from_doc round-trip + visibility gating.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerDocsMacros from "../domains/docs.js";
import registerDocsTemplatesMacros from "../domains/docs-templates.js";

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
  registerDocsTemplatesMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId = "u_tpl") { return { db, actor: { userId } }; }

describe("docs-templates: seed defaults + list", () => {
  it("template_list seeds 6 defaults on first call", async () => {
    const r = await MACROS.get("template_list")(ctx());
    assert.equal(r.ok, true);
    assert.ok(r.templates.length >= 6, `expected ≥6 seed templates, got ${r.templates.length}`);
    const names = r.templates.map((t) => t.name);
    assert.ok(names.includes("Meeting notes"));
    assert.ok(names.includes("Spec doc"));
    assert.ok(names.includes("RFC"));
  });

  it("seed is idempotent — second call doesn't duplicate", async () => {
    const r1 = await MACROS.get("template_list")(ctx());
    const r2 = await MACROS.get("template_list")(ctx());
    assert.equal(r1.templates.length, r2.templates.length);
  });

  it("category filter narrows the list", async () => {
    const all = await MACROS.get("template_list")(ctx());
    const meeting = await MACROS.get("template_list")(ctx(), { category: "meeting" });
    assert.ok(meeting.templates.length < all.templates.length);
    assert.ok(meeting.templates.every((t) => t.category === "meeting"));
  });
});

describe("docs-templates: CRUD", () => {
  it("template_create + template_get round-trip", async () => {
    const c = await MACROS.get("template_create")(ctx("u_a"), {
      name: "My template", prompt: "x", category: "spec",
      contentHtml: "<h1>Title</h1><p>Body</p>",
    });
    assert.equal(c.ok, true);
    const g = await MACROS.get("template_get")(ctx("u_a"), { id: c.id });
    assert.equal(g.template.name, "My template");
    assert.equal(g.template.content_html, "<h1>Title</h1><p>Body</p>");
  });

  it("template_delete only owner", async () => {
    const c = await MACROS.get("template_create")(ctx("u_owner"), { name: "X", contentHtml: "" });
    const denied = await MACROS.get("template_delete")(ctx("u_other"), { id: c.id });
    assert.equal(denied.deleted, 0);
    const okR = await MACROS.get("template_delete")(ctx("u_owner"), { id: c.id });
    assert.equal(okR.deleted, 1);
  });

  it("seed template visible across users (system_seed owner)", async () => {
    const r = await MACROS.get("template_list")(ctx("u_anybody"));
    assert.ok(r.templates.find((t) => t.owner_id === "system_seed"));
  });

  it("private template not visible to non-owners", async () => {
    const c = await MACROS.get("template_create")(ctx("u_priv"), {
      name: "Locked", contentHtml: "x", visibility: "private",
    });
    const get = await MACROS.get("template_get")(ctx("u_other"), { id: c.id });
    assert.equal(get.ok, false); assert.equal(get.reason, "forbidden");
  });
});

describe("docs-templates: apply", () => {
  it("template_apply creates a new doc + bumps usage_count", async () => {
    const list = await MACROS.get("template_list")(ctx("u_apply"));
    const tpl = list.templates.find((t) => t.owner_id === "system_seed");
    const before = tpl.usage_count;
    const r = await MACROS.get("template_apply")(ctx("u_apply"), { id: tpl.id });
    assert.equal(r.ok, true);
    assert.ok(r.id.startsWith("doc:"));
    // Verify usage count bumped
    const after = (await MACROS.get("template_get")(ctx("u_apply"), { id: tpl.id })).template.usage_count;
    assert.equal(after, before + 1);
  });

  it("template_apply forbidden for non-readable private", async () => {
    const c = await MACROS.get("template_create")(ctx("u_priv2"), { name: "X", contentHtml: "" });
    const r = await MACROS.get("template_apply")(ctx("u_other"), { id: c.id });
    assert.equal(r.ok, false); assert.equal(r.reason, "forbidden");
  });
});

describe("docs-templates: save_from_doc", () => {
  it("snapshots a doc's structure into a new template", async () => {
    const doc = await MACROS.get("create")(ctx("u_save"), { title: "Source", contentHtml: "<h1>Spec</h1><p>Body</p>" });
    const r = await MACROS.get("template_save_from_doc")(ctx("u_save"), {
      documentId: doc.id, name: "Saved from Source", category: "spec",
    });
    assert.equal(r.ok, true);
    const g = await MACROS.get("template_get")(ctx("u_save"), { id: r.id });
    assert.ok(g.template.content_html.includes("Spec"));
  });
});
