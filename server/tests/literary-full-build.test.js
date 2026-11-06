// server/tests/literary-full-build.test.js
//
// build(literary) — the resonance graph's literary scope. The unscoped
// resonance_graph read composes the PLATFORM's royalty_lineage whole, so the
// Lattice headlined every lens's citation history under Literary's name
// ("236 nodes · 120 bridges" over a corpus of 0 works). scope:"literary"
// restricts citation edges to those touching a literary-chunk DTU; resonance
// edges are literary-anchored by construction and pass either way. The
// unscoped default is unchanged for other callers.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { createDTU } from "../economy/dtu-pipeline.js";
import { ingestWork } from "../lib/literary-ingest.js";
import { computeResonanceForDtu } from "../lib/literary-resonance.js";
import registerLiteraryMacros from "../domains/literary.js";

const SAMPLE = `
CHAPTER I. Power
To be, or not to be — power and conscience.
${"Crowns rise and fall on the will of those who grasp them. ".repeat(30)}
`;

describe("build(literary) — resonance_graph scope", () => {
  let db, macros, litDtu, gameDtu, otherA, otherB;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    db.exec(`CREATE TABLE IF NOT EXISTS embedding_cache (dtu_id TEXT PRIMARY KEY, embedding BLOB NOT NULL, created_at TEXT)`);
    await ingestWork(db, { gutenbergId: "1232", title: "The Prince", author: "Machiavelli", pdVerified: 1 }, SAMPLE, { doEmbed: false });
    litDtu = db.prepare("SELECT dtu_id FROM literary_chunks WHERE source_id='gut_1232' LIMIT 1").get().dtu_id;
    gameDtu = createDTU(db, { creatorId: "system", title: "Faction power sim", content: "power", contentType: "text", lensId: "game", citationMode: "original" }).dtu.id;
    otherA = createDTU(db, { creatorId: "system", title: "Unrelated A", content: "alpha", contentType: "text", lensId: "code", citationMode: "original" }).dtu.id;
    otherB = createDTU(db, { creatorId: "system", title: "Unrelated B", content: "beta", contentType: "text", lensId: "code", citationMode: "original" }).dtu.id;

    const buf = (v) => Buffer.from(new Float32Array(v).buffer);
    db.prepare("INSERT OR REPLACE INTO embedding_cache (dtu_id, embedding, created_at) VALUES (?,?,?)").run(litDtu, buf([1, 0, 0, 0]), "now");
    db.prepare("INSERT OR REPLACE INTO embedding_cache (dtu_id, embedding, created_at) VALUES (?,?,?)").run(gameDtu, buf([0.95, 0.05, 0, 0]), "now");
    computeResonanceForDtu(db, litDtu, { minScore: 0.5 }); // resonance edge litDtu→gameDtu

    const lineage = db.prepare(`INSERT OR IGNORE INTO royalty_lineage (id, child_id, parent_id, generation, creator_id, parent_creator, created_at) VALUES (?, ?, ?, 1, 'u1', 'system', datetime('now'))`);
    lineage.run("rl-lit", gameDtu, litDtu);     // citation touching the literary DTU
    lineage.run("rl-noise", otherB, otherA);   // citation between two non-literary DTUs

    macros = new Map();
    registerLiteraryMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("the UNSCOPED read still composes the platform lineage whole (default unchanged)", async () => {
    const r = await macros.get("literary.resonance_graph")({ db }, { limit: 50 });
    assert.equal(r.ok, true);
    const ids = new Set(r.nodes.map((n) => n.id));
    assert.ok(ids.has(otherA) && ids.has(otherB), "unscoped graph carries the unrelated citation pair — the walked defect, kept as the default for other callers");
  });

  it("scope:'literary' drops citations that touch no literary chunk, keeps the anchored edges", async () => {
    const r = await macros.get("literary.resonance_graph")({ db }, { limit: 50, scope: "literary" });
    assert.equal(r.ok, true);
    const ids = new Set(r.nodes.map((n) => n.id));
    assert.ok(!ids.has(otherA) && !ids.has(otherB), "unrelated platform citations are not this corpus's lattice");
    assert.ok(ids.has(litDtu) && ids.has(gameDtu), "the literary passage and its bridge target remain");
    const kinds = new Set(r.edges.map((e) => e.kind));
    assert.ok(kinds.has("resonance") && kinds.has("citation"), "both anchored edge kinds survive the scope");
    for (const e of r.edges) {
      assert.ok(e.source === litDtu || e.target === litDtu || (ids.has(e.source) && ids.has(e.target)), "every scoped edge touches the anchored set");
    }
  });
});
