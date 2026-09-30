// server/tests/repo-graph-index.test.js — lib/runtime/repo-graph.js indexRepo.
// Pins what the index contains (imports, exports, test/route/migration edges)
// and that indexing never holds the event loop in one long block — profiled
// 2026-09-27, the old single-transaction pass with a table lookup + prepare
// per edge stalled live traffic for ~1 s.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { up as up424 } from "../migrations/424_runtime_phases.js";
import { up as up427 } from "../migrations/427_dila_runtime_v2.js";
import { indexRepo, findSymbol, allowedRepoRoot, defaultRepoRoot } from "../lib/runtime/repo-graph.js";

function repo(nFiller = 0) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-graph-"));
  const w = (rel, body) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); };
  w("server/lib/math.js", `import { x } from "./util.js";\nexport function addTwo(a) { return a + 2; }\nexport const PI2 = 6.28;\n`);
  w("server/lib/util.js", `export const x = 1;\n`);
  w("server/tests/math.test.js", `import { addTwo } from "../lib/math.js";\nimport assert from "node:assert";\n`);
  w("server/server.js", `app.get("/api/health", h);\nrouter.post("/api/items", h);\n`);
  w("server/migrations/001_core.js", `export function up() {}\n`);
  w("server/migrations/002_more.js", `export function up() {}\n`);
  for (let i = 0; i < nFiller; i++) w(`server/lib/gen/f${i}.js`, `import { x } from "../util.js";\nimport { y } from "./f${(i + 1) % nFiller}.js";\nexport function fn${i}() { return ${i}; }\n`);
  // indexRepo only reads allowlisted roots.
  process.env.CONCORD_REPO_GRAPH_ROOTS = [process.env.CONCORD_REPO_GRAPH_ROOTS, root].filter(Boolean).join(":");
  return root;
}
function db() { const d = new Database(":memory:"); up424(d); up427(d); return d; }

test("indexes imports, exports and test/route/migration edges", async () => {
  const d = db(), root = repo();
  const r = await indexRepo(d, root);
  assert.equal(r.ok, true);
  assert.equal(r.filesIndexed, 6); // 4 source + 2 migration files
  assert.deepEqual(findSymbol(d, root, "addTwo").map((x) => x.file_path), ["server/lib/math.js"]);
  const kinds = Object.fromEntries(d.prepare("SELECT edge_kind k, COUNT(*) c FROM runtime_repo_edges WHERE repo_root=? GROUP BY edge_kind").all(root).map((x) => [x.k, x.c]));
  assert.equal(kinds.test, 1);        // ../lib/math.js (node:assert is not a repo edge)
  assert.equal(kinds.route, 2);
  assert.equal(kinds.migration, 3);   // schema→001, schema→002, 001→002
  assert.ok(kinds.import >= 3);
  // re-index replaces, never duplicates
  const again = await indexRepo(d, root);
  assert.equal(again.edgeCount, r.edgeCount);
});

test("maxFiles is honored", async () => {
  const d = db(), root = repo(20);
  const r = await indexRepo(d, root, { maxFiles: 7 });
  assert.equal(r.filesIndexed, 7);
});

test("a large index keeps the event loop responsive", async () => {
  const d = db(), root = repo(1500);
  let last = Date.now(), maxGap = 0;
  const tick = setInterval(() => { const n = Date.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 5);
  const r = await indexRepo(d, root);
  maxGap = Math.max(maxGap, Date.now() - last);
  clearInterval(tick);
  assert.equal(r.filesIndexed, 1506);
  assert.ok(maxGap < 150, `event loop blocked ${maxGap} ms`);
});

test("allowedRepoRoot: only the workspace root or configured roots, never an arbitrary path", () => {
  const prev = process.env.CONCORD_REPO_GRAPH_ROOTS;
  try {
    delete process.env.CONCORD_REPO_GRAPH_ROOTS;
    assert.equal(allowedRepoRoot(undefined), path.resolve(defaultRepoRoot()));
    assert.equal(allowedRepoRoot(defaultRepoRoot() + "/"), path.resolve(defaultRepoRoot()));
    assert.equal(allowedRepoRoot("/etc"), null);
    assert.equal(allowedRepoRoot(defaultRepoRoot() + "/../.."), null);
    assert.equal(allowedRepoRoot({ toString: () => "/" }), null);
    const extra = fs.mkdtempSync(path.join(os.tmpdir(), "repo-graph-allowed-"));
    process.env.CONCORD_REPO_GRAPH_ROOTS = extra;
    assert.equal(allowedRepoRoot(extra), path.resolve(extra));
  } finally {
    if (prev === undefined) delete process.env.CONCORD_REPO_GRAPH_ROOTS; else process.env.CONCORD_REPO_GRAPH_ROOTS = prev;
  }
});

test("indexRepo refuses a root that is not allowlisted, without reading it", async () => {
  const d = db();
  const r = await indexRepo(d, "/etc");
  assert.deepEqual(r, { ok: false, reason: "repo_root_not_allowed" });
});
