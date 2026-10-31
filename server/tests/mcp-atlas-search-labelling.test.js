/**
 * MCP atlas_search total labelling — behaviour tests (MCP Platform
 * lane follow-on spec, 2026-10-30; the lane's post-ship scoped sweep
 * is the live acceptance, these tests pin the same criteria in-repo).
 *
 * The defect: atlas_search returned {count, results} with count equal
 * to the PAGE SIZE and no label — the dtu_search defect class over a
 * DIFFERENT corpus: the DTU atlas is a distinct, smaller index than
 * the published-DTU corpus, so an agent comparing the two tools'
 * counts read two page sizes over two unstated, unequal denominators.
 * The fix, same discipline as dtu_search / reflect_search:
 *   - count is the TRUE match total within the atlas corpus;
 *   - returned (page size) and truncated join it;
 *   - totalKind: "search_hits", the same word as both precedents;
 *   - the description names the corpus and states the counts are
 *     not comparable across the two tools.
 * Corpus thinness itself is out of scope (the spec says so plainly).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { MCP_TOOLS, atlasSearch } from "../lib/mcp-tools.js";

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE dtus (id TEXT PRIMARY KEY, title TEXT)");
  const ins = db.prepare("INSERT INTO dtus (id, title) VALUES (?, ?)");
  for (let i = 1; i <= 12; i++) ins.run(`a-${i}`, `harbour chart ${i}`);
  ins.run("a-u", "zyzzyva atlas plate");
  ins.run("a-f1", "orbital mechanics");
  ins.run("a-f2", "sourdough diary");
  return db;
}

test("broad query: count is the true atlas total, not the page", async () => {
  const db = makeDb();
  const r = await atlasSearch(db, { query: "harbour" });
  assert.equal(r.ok, true);
  assert.equal(r.count, 12);
  assert.equal(r.returned, 10);
  assert.equal(r.results.length, 10);
  assert.equal(r.truncated, true);
  assert.equal(r.totalKind, "search_hits");
});

test("narrow query: count == returned, truncated false", async () => {
  const db = makeDb();
  const r = await atlasSearch(db, { query: "zyzzyva" });
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(r.returned, 1);
  assert.equal(r.results.length, 1);
  assert.equal(r.truncated, false);
  assert.equal(r.totalKind, "search_hits");
});

test("zero hits: count 0, returned 0, truncated false, label present", async () => {
  const db = makeDb();
  const r = await atlasSearch(db, { query: "nonexistentterm" });
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
  assert.equal(r.returned, 0);
  assert.equal(r.results.length, 0);
  assert.equal(r.truncated, false);
  assert.equal(r.totalKind, "search_hits");
});

test("description names the atlas corpus and the non-comparability", () => {
  const def = MCP_TOOLS.find((t) => t.name === "atlas_search");
  assert.ok(def, "atlas_search definition exists");
  assert.match(def.description, /search hits across the DTU atlas/);
  assert.match(def.description, /distinct and smaller index than the published DTU corpus/);
  assert.match(def.description, /not comparable/);
  assert.match(def.description, /not an ownership count/);
});
