// server/tests/docs-domain-wired.test.js
//
// Smoking-gun fix test. Before Docs Sprint A, server/domains/docs.js
// existed but used the legacy `registerLensAction` pattern and was
// never imported into server.js — every `docs.*` macro the frontend
// tried to call returned "unknown_macro" from the AI catch-all. This
// pins the new register()-style domain in place: importing
// domains/docs.js with a stub register function must register at
// least the core CRUD + version + comment + collaborator + search
// + import/export + presence + outline + readability macros.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerDocsMacros from "../domains/docs.js";

describe("docs.* macros are wired (smoking-gun)", () => {
  it("registerDocsMacros registers the canonical macro list", async () => {
    const registered = new Set();
    const register = (domain, name) => {
      assert.equal(domain, "docs");
      registered.add(name);
    };
    registerDocsMacros(register);

    const expected = [
      // CRUD
      "create", "get", "get_by_slug", "update", "delete", "restore",
      "list", "list_collaborated", "list_children", "move",
      // Versions
      "snapshot", "versions", "get_version", "restore_version",
      // Comments
      "comment_add", "comments_list", "comment_resolve",
      // Collaborators / sharing
      "invite", "revoke", "collaborators", "publish", "unpublish",
      // Backlinks
      "backlinks_in", "backlinks_out",
      // Attachments
      "attachments_list",
      // Search
      "search",
      // Markdown
      "export_md", "export_html", "import_md",
      // Presence
      "presence_update", "presence_list",
      // Outline + legacy
      "outline", "readability",
    ];
    for (const name of expected) {
      assert.ok(registered.has(name), `missing macro: docs.${name}`);
    }
    // Spot-check the count: enough to catch a regression that drops a category.
    assert.ok(registered.size >= expected.length,
      `expected at least ${expected.length} macros, got ${registered.size}`);
  });

  it("readability macro is callable without a db", async () => {
    const macros = new Map();
    const register = (_domain, name, handler) => { macros.set(name, handler); };
    registerDocsMacros(register);
    const r = await macros.get("readability")({}, { text: "This is a short sentence. Another one follows." });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.fleschReadingEase === "number");
    assert.ok(r.result.wordCount > 0);
  });
});
