// A4 (saved-work-as-DTU) PR 1 — the export + search bridges.
// Leg A: collectLensExport includes the caller's own canonical DTUs.
// Leg B: searchDTUs unions the caller's own canonical DTUs (dtu_store)
//        for an authenticated caller — and no one else's, ever.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { collectLensExport, registerLensExportProvider, _clearLensExportProvidersForTests } from "../lib/lens-export.js";
import { searchDTUs } from "../economy/dtu-pipeline.js";

function runMacroStub(calls) {
  return async (domain, action, input) => {
    calls.push([domain, action, input]);
    if (domain === "lens" && action === "list") {
      return { ok: true, artifacts: [{ id: "art_1", type: "note", title: "Artifact one" }] };
    }
    if (domain === "dtu" && action === "list") {
      assert.equal(input.mine, true);
      assert.equal(input.domain, "transfer");
      return { ok: true, dtus: [
        { id: "dtu_own_1", title: "GitHub transfer — topic:file-transfer (25)", tags: ["transfer"], human: { summary: "mapping notes" }, createdAt: "2026-11-01T00:00:00Z" },
        { id: "art_1", title: "Duplicate id — must dedupe", tags: [] },
      ] };
    }
    return { ok: false, error: "unexpected" };
  };
}

describe("Leg A — the export bridge", () => {
  it("the caller's own canonical DTUs join the export bundle", async () => {
    _clearLensExportProvidersForTests();
    const calls = [];
    const out = await collectLensExport({ runMacro: runMacroStub(calls), domain: "transfer", ctx: { actor: { userId: "u1" } }, limit: 100 });
    assert.equal(out.ok, true);
    const ids = out.artifacts.map((r) => r.id);
    assert.ok(ids.includes("dtu_own_1"), "own DTU exported");
    assert.equal(ids.filter((i) => i === "art_1").length, 1, "dedupe by id");
    assert.equal(out.sources.ownDtus, 1);
    const row = out.artifacts.find((r) => r.id === "dtu_own_1");
    assert.equal(row.type, "dtu");
    assert.equal(row.data.summary, "mapping notes");
  });

  it("a failing dtu leg degrades honestly, never a false empty", async () => {
    _clearLensExportProvidersForTests();
    const failing = async (domain, action) => {
      if (domain === "lens") return { ok: true, artifacts: [] };
      throw new Error("dtu store down");
    };
    const out = await collectLensExport({ runMacro: failing, domain: "transfer", ctx: {}, limit: 10 });
    assert.equal(out.ok, true);
    assert.equal(out.sources.ownDtus, 0);
    assert.match(out.dtuError, /dtu store down/);
  });
});

function searchDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE dtus (id TEXT, creator_id TEXT, title TEXT, content TEXT,
    content_type TEXT, lens_id TEXT, tier TEXT, price REAL, creti_score REAL,
    tags_json TEXT, status TEXT, created_at TEXT)`);
  db.prepare(`INSERT INTO dtus VALUES ('pub_1','u9','Public transfer guide','body','guide','transfer','regular',0,10,'["transfer"]','published','2026-10-01')`).run();
  db.exec(`CREATE TABLE dtu_store (id TEXT PRIMARY KEY, data TEXT, tier TEXT, scope TEXT)`);
  const own = { id: "dtu_own_1", ownerId: "u1", title: "GitHub transfer — topic:file-transfer (25)", tags: ["transfer", "github"], meta: { lens: "transfer" }, human: { summary: "mapping" }, createdAt: "2026-11-01" };
  const theirs = { id: "dtu_their_1", ownerId: "u2", title: "Someone else transfer secret", tags: ["transfer"], meta: { lens: "transfer" } };
  db.prepare(`INSERT INTO dtu_store (id, data) VALUES (?, ?)`).run(own.id, JSON.stringify(own));
  db.prepare(`INSERT INTO dtu_store (id, data) VALUES (?, ?)`).run(theirs.id, JSON.stringify(theirs));
  return db;
}

describe("Leg B — the search bridge", () => {
  it("the owner finds their own saved DTU by its title word", () => {
    const db = searchDb();
    const out = searchDTUs(db, { query: "transfer", lensId: "transfer", callerId: "u1" });
    const ids = out.results.map((r) => r.id);
    assert.ok(ids.includes("dtu_own_1"), "own DTU found");
    assert.equal(out.results.find((r) => r.id === "dtu_own_1").own, true);
    assert.ok(!ids.includes("dtu_their_1"), "another user's DTU never surfaces");
    assert.ok(ids.includes("pub_1"), "the published corpus still reads");
  });

  it("anonymous search is unchanged: published only", () => {
    const db = searchDb();
    const out = searchDTUs(db, { query: "transfer", lensId: "transfer" });
    assert.deepEqual(out.results.map((r) => r.id), ["pub_1"]);
  });

  it("a different lens does not claim the DTU", () => {
    const db = searchDb();
    const out = searchDTUs(db, { query: "transfer", lensId: "hr", callerId: "u1" });
    assert.ok(!out.results.map((r) => r.id).includes("dtu_own_1"));
  });
});
