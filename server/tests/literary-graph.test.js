// server/tests/literary-graph.test.js
//
// Tier-1 LRL-as-hub — literary.resonance_graph composes the unified resonance +
// citation force-graph (GraphView shape) from literary_resonance_edges ∪
// royalty_lineage. Offline; seeds one of each edge kind.

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

describe("LRL hub — resonance_graph", () => {
  let db, macros, litDtu, codeDtu;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    db.exec(`CREATE TABLE IF NOT EXISTS embedding_cache (dtu_id TEXT PRIMARY KEY, embedding BLOB NOT NULL, created_at TEXT)`);
    await ingestWork(db, { gutenbergId: "1232", title: "The Prince", author: "Machiavelli", pdVerified: 1 }, SAMPLE, { doEmbed: false });
    litDtu = db.prepare("SELECT dtu_id FROM literary_chunks WHERE source_id='gut_1232' LIMIT 1").get().dtu_id;
    codeDtu = createDTU(db, { creatorId: "system", title: "Faction power sim", content: "power", contentType: "text", lensId: "game", citationMode: "original" }).dtu.id;

    const buf = (v) => Buffer.from(new Float32Array(v).buffer);
    db.prepare("INSERT OR REPLACE INTO embedding_cache (dtu_id, embedding, created_at) VALUES (?,?,?)").run(litDtu, buf([1, 0, 0, 0]), "now");
    db.prepare("INSERT OR REPLACE INTO embedding_cache (dtu_id, embedding, created_at) VALUES (?,?,?)").run(codeDtu, buf([0.95, 0.05, 0, 0]), "now");
    computeResonanceForDtu(db, litDtu, { minScore: 0.5 }); // → resonance edge litDtu→codeDtu

    // A citation edge (royalty lineage).
    db.prepare(`INSERT OR IGNORE INTO royalty_lineage (id, child_id, parent_id, generation, creator_id, parent_creator, created_at)
                VALUES ('rl1', ?, ?, 1, 'u1', 'system', datetime('now'))`).run(codeDtu, litDtu);

    macros = new Map();
    registerLiteraryMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("composes nodes + both edge kinds for GraphView", async () => {
    const r = await macros.get("literary.resonance_graph")({ db }, { limit: 50 });
    assert.equal(r.ok, true);
    assert.ok(r.nodes.length >= 2, "has nodes");
    const nodeIds = new Set(r.nodes.map((n) => n.id));
    assert.ok(nodeIds.has(litDtu) && nodeIds.has(codeDtu));
    const kinds = new Set(r.edges.map((e) => e.kind));
    assert.ok(kinds.has("resonance"), "resonance edge present");
    assert.ok(kinds.has("citation"), "citation edge present");
    // GraphView shape
    for (const n of r.nodes) { assert.ok(typeof n.id === "string" && typeof n.label === "string" && typeof n.group === "string"); }
    for (const e of r.edges) { assert.ok(e.source && e.target && e.kind); }
  });

  it("focus mode narrows to a node's neighbourhood", async () => {
    const r = await macros.get("literary.resonance_graph")({ db }, { dtuId: litDtu });
    assert.equal(r.ok, true);
    assert.equal(r.focus, litDtu);
    assert.ok(r.nodes.find((n) => n.id === litDtu && n.weight === 1), "focused node weighted 1");
  });

  it("resonance_stats counts both edge tables", async () => {
    const r = await macros.get("literary.resonance_stats")({ db });
    assert.equal(r.ok, true);
    assert.ok(r.resonance >= 1);
    assert.ok(r.citations >= 1);
  });
});
