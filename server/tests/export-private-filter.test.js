// Export private filter — security regression tests (HANDOFF-SEC-2 Fix 8b).
//
// Pins the fix for: every export surface (GET /api/export/json|markdown,
// the export.json/markdown/obsidian macros and their REST wrappers)
// returned EVERY DTU in STATE — including other users' private DTUs and
// hidden system bookkeeping rows — to any caller.
//
// Two layers:
//   1. Unit tests for lib/export-filter.js (exportableDtus +
//      exportBulkDenial) against member/anon/admin/internal callers.
//   2. Source assertions that all five surfaces in server.js route
//      through the filter (and that the GET routes enforce the bulk
//      sign-in rule with a real 401).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { exportableDtus, exportBulkDenial } from "../lib/export-filter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

// Stand-in for the server's _isHiddenSystemDtu: internal-visibility and
// system-scope rows are hidden; mega/hyper system rows are exempt from
// the source half (modeled here by the `hidden` flag the server's
// predicate computes — the stub keeps this suite about the FILTER).
const isHidden = (d) => d.__hidden === true;

const MEMBER_A = { actor: { id: "user-a", userId: "user-a", role: "member" } };
const ANON = { actor: { userId: "anon" } };
const INTERNAL = { internal: true, actor: { userId: "anon" } };

const PUBLIC_SYSTEM = { id: "pub", visibility: "public", source: "system", title: "Public system" };
const PRIVATE_A = { id: "pa", privacy: "private", author: "user-a", title: "A private" };
const PRIVATE_B = { id: "pb", privacy: "private", author: "user-b", title: "B private" };
const HIDDEN_ROW = { id: "hid", visibility: "public", source: "system", title: "bookkeeping", __hidden: true };
const INTERNAL_ROW = { id: "int", visibility: "internal", title: "oracle row" };
const ALL = [PUBLIC_SYSTEM, PRIVATE_A, PRIVATE_B, HIDDEN_ROW, INTERNAL_ROW];
const ids = (list) => list.map((d) => d.id);

describe("export-filter — exportableDtus unit", () => {
  it("a member's export holds public + own private, never another's private", () => {
    assert.deepEqual(ids(exportableDtus(MEMBER_A, ALL, isHidden)), ["pub", "pa"]);
  });

  it("hidden system rows are dropped even when readable", () => {
    assert.ok(!ids(exportableDtus(MEMBER_A, ALL, isHidden)).includes("hid"));
  });

  it("visibility:internal rows are dropped for members", () => {
    assert.ok(!ids(exportableDtus(MEMBER_A, ALL, isHidden)).includes("int"));
  });

  it("an explicit unreadable id is silently dropped (no existence leak)", () => {
    assert.deepEqual(ids(exportableDtus(MEMBER_A, [PRIVATE_B], isHidden)), []);
    assert.deepEqual(ids(exportableDtus(MEMBER_A, [PRIVATE_B, PRIVATE_A], isHidden)), ["pa"]);
  });

  it("internal callers and a null ctx (server CLI) get the unfiltered set", () => {
    assert.deepEqual(ids(exportableDtus(INTERNAL, ALL, isHidden)), ids(ALL));
    assert.deepEqual(ids(exportableDtus(null, ALL, isHidden)), ids(ALL));
    assert.deepEqual(ids(exportableDtus(undefined, ALL, isHidden)), ids(ALL));
  });

  it("the input array is not mutated and the result is a copy", () => {
    const out = exportableDtus(INTERNAL, ALL, isHidden);
    out.pop();
    assert.equal(ALL.length, 5);
  });

  it("non-array input yields an empty export, never a throw", () => {
    assert.deepEqual(exportableDtus(MEMBER_A, null, isHidden), []);
    assert.deepEqual(exportableDtus(MEMBER_A, undefined, isHidden), []);
  });
});

describe("export-filter — exportBulkDenial unit", () => {
  const DENIED = { ok: false, status: 401, code: "AUTH_REQUIRED", error: "sign in required" };

  it("anonymous bulk export (no ids) is denied 401", () => {
    assert.deepEqual(exportBulkDenial(ANON, false), DENIED);
    assert.deepEqual(exportBulkDenial({}, false), DENIED);
  });

  it("anonymous export with explicit ids is not bulk-denied (ids are filtered instead)", () => {
    assert.equal(exportBulkDenial(ANON, true), null);
  });

  it("a signed-in member may bulk export (their readable set)", () => {
    assert.equal(exportBulkDenial(MEMBER_A, false), null);
  });

  it("internal callers and null ctx are never bulk-denied", () => {
    assert.equal(exportBulkDenial(INTERNAL, false), null);
    assert.equal(exportBulkDenial(null, false), null);
  });

  it("returns fresh objects", () => {
    const first = exportBulkDenial(ANON, false);
    first.error = "tampered";
    assert.equal(exportBulkDenial(ANON, false).error, "sign in required");
  });
});

describe("export-filter — server.js surface wiring (source assertions)", () => {
  function block(startMarker, endMarker) {
    const start = SERVER_JS.indexOf(startMarker);
    assert.ok(start > 0, `found: ${startMarker}`);
    const end = SERVER_JS.indexOf(endMarker, start + 1);
    assert.ok(end > start, `found end: ${endMarker}`);
    return SERVER_JS.slice(start, end);
  }

  it("server.js imports the filter from lib/export-filter.js", () => {
    assert.ok(SERVER_JS.includes('from "./lib/export-filter.js"'), "import present");
  });

  it("exportDTUsToMarkdown filters through exportableDtus with the server predicate", () => {
    const body = block("function exportDTUsToMarkdown", "function exportDTUsToJSON");
    assert.ok(body.includes("exportableDtus(ctx,"), "filter applied");
    assert.ok(body.includes("_isHiddenSystemDtu"), "server predicate injected");
  });

  it("exportDTUsToJSON filters through exportableDtus with the server predicate", () => {
    const body = block("function exportDTUsToJSON", "function importFromObsidian");
    assert.ok(body.includes("exportableDtus(ctx,"), "filter applied");
    assert.ok(body.includes("_isHiddenSystemDtu"), "server predicate injected");
  });

  it("GET /api/export/markdown enforces the bulk 401 and passes makeCtx(req)", () => {
    const body = block('app.get("/api/export/markdown"', 'app.get("/api/export/json"');
    assert.ok(body.includes("exportBulkDenial(ctx, !!ids)"), "bulk denial checked");
    assert.ok(body.includes("res.status(401)"), "real 401 status");
    assert.ok(body.includes("exportDTUsToMarkdown(ids, {}, ctx)"), "ctx passed into the export");
  });

  it("GET /api/export/json enforces the bulk 401 and passes makeCtx(req)", () => {
    const body = block('app.get("/api/export/json"', "// ---- Wave 2: Query Endpoint ----");
    assert.ok(body.includes("exportBulkDenial(ctx, !!ids)"), "bulk denial checked");
    assert.ok(body.includes("res.status(401)"), "real 401 status");
    assert.ok(body.includes("exportDTUsToJSON(ids, ctx)"), "ctx passed into the export");
  });

  for (const [macro, end] of [
    ["markdown", 'register("export", "obsidian"'],
    ["obsidian", 'register("export", "json"'],
    ["json", '// SECURITY: import.json'],
  ]) {
    it(`export.${macro} macro enforces the bulk denial and filters its DTU set`, () => {
      const body = block(`register("export", "${macro}"`, end);
      assert.ok(body.includes("exportBulkDenial(ctx, Array.isArray(input.ids))"), "bulk denial checked");
      assert.ok(body.includes("exportableDtus(ctx,"), "filter applied");
      assert.ok(body.includes("_isHiddenSystemDtu"), "server predicate injected");
    });
  }
});
