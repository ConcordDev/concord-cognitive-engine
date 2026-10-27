import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { packDtuData } from "../lib/dtu-at-rest.js";
import { runArchiveEmbedSlice, readProgress, archiveCoverage } from "../lib/archive-embed-backfill.js";

function fixture() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE dtu_store (id TEXT PRIMARY KEY, data TEXT)");
  db.exec("CREATE TABLE dtu_store_archive (id TEXT PRIMARY KEY, tier TEXT, data BLOB)");
  db.exec("CREATE TABLE archived_dtus (id TEXT PRIMARY KEY, data BLOB)");
  db.exec("CREATE TABLE emb (dtu_id TEXT PRIMARY KEY, embedding BLOB)");
  const ins = db.prepare("INSERT INTO dtu_store_archive VALUES (?, ?, ?)");
  ins.run("r1", "regular", packDtuData(JSON.stringify({ id: "r1", tier: "regular", title: "r1" })));
  ins.run("m1", "mega", packDtuData(JSON.stringify({ id: "m1", tier: "mega", title: "m1" })));
  ins.run("r2", "regular", JSON.stringify({ id: "r2", tier: "regular", title: "r2" }));
  // Older cold rows keep id/tier only in the columns.
  ins.run("m0", "mega", packDtuData(JSON.stringify({ human: { summary: "old mega body" } })));
  ins.run("s1", "shadow", JSON.stringify({ id: "s1", tier: "shadow" }));
  db.prepare("INSERT INTO archived_dtus VALUES (?, ?)").run("c1", JSON.stringify({ id: "c1", tier: "regular", title: "c1" }));
  return db;
}

describe("archive embed backfill", () => {
  it("embeds megas first, then consolidated members, then the rest; resumes from the cursor; skips embedded", async () => {
    const db = fixture();
    const have = new Set(["r2"]);
    const order = [];
    const embedDTU = async (d) => { order.push(d.id); have.add(d.id); db.prepare("INSERT INTO emb VALUES (?, x'00')").run(d.id); };
    const opts = { db, embedDTU, hasEmbedding: (id) => have.has(id), batch: 1, budgetMs: 10_000, swapFreeMb: async () => 4000 };
    for (let i = 0; i < 12; i++) {
      const r = await runArchiveEmbedSlice(opts);
      if (r.done) break;
    }
    assert.deepEqual(order, ["m1", "m0", "c1", "r1"]);
    const p = readProgress(db);
    assert.equal(p.done, 1);
    assert.equal(p.embedded, 4);
    const again = await runArchiveEmbedSlice(opts);
    assert.equal(again.done, true);
    const cov = archiveCoverage(db, "emb");
    assert.equal(cov.archiveEmbedded, 3); // m1, m0, r1 (r2 pre-embedded elsewhere)
    assert.equal(cov.archivedDtusEmbedded, 1);
  });

  it("pauses when swap is low and leaves the cursor alone", async () => {
    const db = fixture();
    let called = 0;
    const r = await runArchiveEmbedSlice({ db, embedDTU: async () => { called++; }, hasEmbedding: () => false, swapFreeMb: async () => 300 });
    assert.equal(r.paused, "swap_low");
    assert.equal(called, 0);
    assert.equal(readProgress(db).last_rowid, 0);
  });

  it("stops inside the time budget", async () => {
    const db = fixture();
    let t = 0;
    let called = 0;
    const r = await runArchiveEmbedSlice({
      db, batch: 10, budgetMs: 5, now: () => t, swapFreeMb: async () => null,
      embedDTU: async () => { called++; t += 10; }, hasEmbedding: () => false,
    });
    assert.equal(called, 1);
    assert.equal(r.done, false);
  });
});
