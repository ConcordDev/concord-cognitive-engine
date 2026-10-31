/**
 * MCP dtu_search total labelling — behaviour tests (MCP Platform lane
 * judgement 2026-10-30; the lane's post-ship scoped sweep is the live
 * acceptance, these tests pin the same criteria in-repo).
 *
 * The defect: dtu_search returned {count, fts5, results} with count
 * equal to the PAGE SIZE and no label of any kind — an external agent
 * could quote a 10-item slice as a total (the family's founding
 * defect class; cf. reflect_search pre-#1810). The fix, following the
 * reflect ruling and B9's chat-surface A19 label (#1899):
 *   - count is the TRUE match total (matches before the slice);
 *   - returned (page size) and truncated join it, reflect's names;
 *   - totalKind: "search_hits", the same word as the chat surface;
 *   - the discovery description carries the scope sentence.
 * Both query paths (FTS5 and the LIKE fallback) are pinned, plus the
 * tier filter, the zero-hit shape, and the description.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { MCP_TOOLS, dtuSearch } from "../lib/mcp-tools.js";

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      title TEXT, content TEXT, body_json TEXT, tags_json TEXT,
      lens_id TEXT, tier TEXT, type TEXT, created_at TEXT
    );
    CREATE VIRTUAL TABLE dtus_fts USING fts5(
      title, body_json, tags_json, lens_id,
      content='dtus', content_rowid='rowid'
    );
    CREATE TRIGGER dtus_fts_insert AFTER INSERT ON dtus
    BEGIN
      INSERT INTO dtus_fts(rowid, title, body_json, tags_json, lens_id)
      VALUES (new.rowid, new.title, new.body_json, new.tags_json, new.lens_id);
    END;
  `);
  const ins = db.prepare(
    "INSERT INTO dtus (id, title, content, body_json, tags_json, lens_id, tier, type, created_at) VALUES (?, ?, ?, ?, '[]', 'core', ?, 'essay', ?)"
  );
  // 12 provenance hits: 3 of them tier "mega", 9 "regular".
  for (let i = 1; i <= 12; i++) {
    const tier = i <= 3 ? "mega" : "regular";
    ins.run(`dtu-${i}`, `provenance note ${i}`, `a study of provenance ${i}`, `provenance body ${i}`, tier, `2026-01-${String(i).padStart(2, "0")}`);
  }
  // One unique-term row and three fillers with no shared terms.
  ins.run("dtu-u", "zyzzyva field log", "the zyzzyva observation", "zyzzyva body", "regular", "2026-02-01");
  ins.run("dtu-f1", "harbour maintenance", "dock schedules", "harbour body", "regular", "2026-02-02");
  ins.run("dtu-f2", "orbital mechanics", "delta-v budgets", "orbital body", "mega", "2026-02-03");
  ins.run("dtu-f3", "sourdough diary", "starter feedings", "sourdough body", "regular", "2026-02-04");
  return db;
}

test("broad query: count is the true total, not the page (FTS5 path)", async () => {
  const db = makeDb();
  const r = await dtuSearch(db, { query: "provenance" });
  assert.equal(r.ok, true);
  assert.equal(r.fts5, true);
  assert.equal(r.count, 12);
  assert.equal(r.returned, 10);
  assert.equal(r.results.length, 10);
  assert.equal(r.truncated, true);
  assert.equal(r.totalKind, "search_hits");
});

test("narrow query: count == returned, truncated false", async () => {
  const db = makeDb();
  const r = await dtuSearch(db, { query: "zyzzyva" });
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(r.returned, 1);
  assert.equal(r.results.length, 1);
  assert.equal(r.truncated, false);
  assert.equal(r.totalKind, "search_hits");
});

test("substring query rides the LIKE fallback and still totals truly", async () => {
  const db = makeDb();
  // "ovenance" is a mid-word substring: FTS5 token match misses it,
  // the LIKE fallback finds all 12 — and must label its total the same.
  const r = await dtuSearch(db, { query: "ovenance" });
  assert.equal(r.ok, true);
  assert.equal(r.fts5, false);
  assert.equal(r.count, 12);
  assert.equal(r.returned, 10);
  assert.equal(r.truncated, true);
  assert.equal(r.totalKind, "search_hits");
});

test("tier filter: count is the total within the tier", async () => {
  const db = makeDb();
  const r = await dtuSearch(db, { query: "provenance", tier: "mega", limit: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.count, 3);
  assert.equal(r.returned, 2);
  assert.equal(r.truncated, true);
  assert.equal(r.totalKind, "search_hits");
  for (const row of r.results) assert.equal(row.tier, "mega");
});

test("zero hits: count 0, returned 0, truncated false, label present", async () => {
  const db = makeDb();
  const r = await dtuSearch(db, { query: "nonexistentterm" });
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
  assert.equal(r.returned, 0);
  assert.equal(r.results.length, 0);
  assert.equal(r.truncated, false);
  assert.equal(r.totalKind, "search_hits");
});

test("discovery description carries the scope sentence", () => {
  const def = MCP_TOOLS.find((t) => t.name === "dtu_search");
  assert.ok(def, "dtu_search definition exists");
  assert.match(def.description, /search hits across the published DTU corpus/);
  assert.match(def.description, /does not report any user's owned DTUs/);
  assert.match(def.description, /not an ownership count/);
});
