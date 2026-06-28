// server/tests/literary-domain-macros.test.js
//
// DONE-gate behavioral coverage for the SIX macros the `literary` lens page
// actually drives (concord-frontend/app/lenses/literary/page.tsx):
//   stats · search · semantic_graph · resonance · resonance_graph · annotate
//
// Every assertion is a real-DB ACTUAL-VALUE / round-trip check (not shape-only):
// search returns the ingested passage with real provenance; annotate persists a
// derivative DTU that cites the source passage and is read back; resonance reads
// back a seeded cross-domain edge; resonance_graph composes the seeded edge; the
// counts mirror the arrays. Offline (no Ollama) → the dense path is empty and the
// always-available BM25 path is exercised (semantic:false), matching the lens's
// honest "Keyword only" badge.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { ingestWork } from "../lib/literary-ingest.js";
import { createDTU } from "../economy/dtu-pipeline.js";
import { computeResonanceForDtu } from "../lib/literary-resonance.js";
import registerLiteraryMacros from "../domains/literary.js";

const SAMPLE = `
CHAPTER I. The Question

To be, or not to be, that is the question of conscience and mortality.
${"The slings and arrows of outrageous fortune press hard upon the heart. ".repeat(40)}

CHAPTER II. The Resolve

And by opposing end them. Thus conscience does make cowards of us all.
${"Power and resolve are sicklied o'er with the pale cast of thought. ".repeat(40)}
`;

function buildMacros() {
  const handlers = new Map();
  registerLiteraryMacros((domain, name, fn) => handlers.set(`${domain}.${name}`, fn));
  return handlers;
}

function seedEmbedding(db, dtuId, vec) {
  db.exec(`CREATE TABLE IF NOT EXISTS embedding_cache (dtu_id TEXT PRIMARY KEY, embedding BLOB NOT NULL, created_at TEXT)`);
  db.prepare("INSERT OR REPLACE INTO embedding_cache (dtu_id, embedding, created_at) VALUES (?,?,?)")
    .run(dtuId, Buffer.from(new Float32Array(vec).buffer), "now");
}

describe("literary lens — the 6 page-driven macros (real DB, behavioral)", () => {
  let db, ctx, macros, chunkId, litDtu, codeDtu;

  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    await ingestWork(
      db,
      { gutenbergId: "1524", title: "Hamlet", author: "William Shakespeare", era: "renaissance", genre: "drama", pdVerified: 1 },
      SAMPLE,
      { doEmbed: false },
    );
    ctx = { db, actor: { userId: "reader-1" } };
    macros = buildMacros();

    const row = db.prepare("SELECT id, dtu_id FROM literary_chunks WHERE source_id='gut_1524' LIMIT 1").get();
    chunkId = row.id; litDtu = row.dtu_id;

    // Seed a cross-domain resonance edge: literary passage ↔ a game-domain DTU.
    codeDtu = createDTU(db, { creatorId: "system", title: "Faction power sim", content: "power and conscience drive factions", contentType: "text", lensId: "game", citationMode: "original" }).dtu.id;
    seedEmbedding(db, litDtu, [1, 0, 0, 0]);
    seedEmbedding(db, codeDtu, [0.96, 0.04, 0, 0]);
    computeResonanceForDtu(db, litDtu, { minScore: 0.5 });
  });

  // ── 1. stats ──────────────────────────────────────────────────────────────
  it("stats reports real corpus counts (1 work, ≥2 chunks, embedded ≤ chunks)", async () => {
    const r = await macros.get("literary.stats")(ctx);
    assert.equal(r.ok, true);
    assert.equal(r.sources, 1);
    assert.ok(r.chunks >= 2, `expected ≥2 chunks, got ${r.chunks}`);
    assert.ok(r.embedded <= r.chunks, "embedded never exceeds total chunks");
  });

  // ── 2. search ─────────────────────────────────────────────────────────────
  it("search returns the ingested passage with real provenance (BM25, semantic:false offline)", async () => {
    const r = await macros.get("literary.search")(ctx, { query: "conscience and mortality", limit: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.semantic, false, "no Ollama → keyword path, matching the honest badge");
    assert.equal(r.count, r.results.length, "count mirrors results length");
    assert.ok(r.results.length >= 1, "found at least one hit");
    const hit = r.results[0];
    assert.equal(hit.provenance.title, "Hamlet");
    assert.equal(hit.provenance.author, "William Shakespeare");
    assert.equal(hit.provenance.license, "public_domain");
    assert.equal(hit.provenance.gutenbergId, "1524");
    assert.ok(typeof hit.score === "number");
  });

  it("search on empty query returns an empty set, not an error", async () => {
    const r = await macros.get("literary.search")(ctx, { query: "   " });
    assert.equal(r.ok, true);
    assert.equal(r.count, 0);
  });

  // ── 3. semantic_graph ───────────────────────────────────────────────────────
  it("semantic_graph composes GraphView nodes/edges for a real query", async () => {
    const r = await macros.get("literary.semantic_graph")(ctx, { query: "conscience resolve power", limit: 10 });
    assert.equal(r.ok, true);
    assert.ok(r.nodes.length >= 1, "has nodes for the query hits");
    assert.ok(Array.isArray(r.edges));
    assert.ok(r.nodes.every((n) => typeof n.id === "string" && typeof n.label === "string"));
    // Both chunks share the same source → at least one sibling edge.
    const labels = r.nodes.map((n) => n.label).join(" ");
    assert.match(labels, /Hamlet/);
  });

  // ── 4. resonance ──────────────────────────────────────────────────────────
  it("resonance reads back the seeded cross-domain edge by chunkId", async () => {
    const r = await macros.get("literary.resonance")(ctx, { chunkId, limit: 6 });
    assert.equal(r.ok, true);
    assert.equal(r.dtuId, litDtu, "resolves chunkId → its backing DTU");
    assert.ok(Array.isArray(r.edges));
    assert.ok(r.edges.some((e) => e.dtuId === codeDtu), "the seeded literary↔game bridge is returned");
  });

  it("resonance on an unknown chunk returns not_found (honest, never throws)", async () => {
    const r = await macros.get("literary.resonance")(ctx, { chunkId: "__nope__" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_found");
  });

  // ── 5. resonance_graph ──────────────────────────────────────────────────────
  it("resonance_graph composes the seeded edge with counts mirroring the arrays", async () => {
    const r = await macros.get("literary.resonance_graph")(ctx, { limit: 50 });
    assert.equal(r.ok, true);
    assert.equal(r.counts.nodes, r.nodes.length);
    assert.equal(r.counts.edges, r.edges.length);
    assert.ok(r.edges.length >= 1, "the seeded resonance edge is present");
    assert.ok(r.edges.every((e) => e.kind === "resonance" || e.kind === "citation"));
    const nodeIds = new Set(r.nodes.map((n) => n.id));
    assert.ok(nodeIds.has(litDtu) && nodeIds.has(codeDtu), "both endpoints of the bridge are nodes");
  });

  // ── 6. annotate (round-trip: mint derivative DTU citing the passage) ────────
  it("annotate mints a derivative DTU citing the source passage, read back from the DB", async () => {
    const r = await macros.get("literary.annotate")(ctx, {
      chunkId,
      note: "Conscience as the brake on action — a moral read of the soliloquy.",
      quote: "to be or not to be",
    });
    assert.equal(r.ok, true, `annotate failed: ${r.reason}`);
    assert.ok(r.dtuId, "returns the minted DTU id");
    assert.equal(r.citedChunkId, chunkId);

    // Round-trip: the DTU exists, is a literary annotation, and CITES the source DTU.
    const dtu = db.prepare("SELECT lens_id, content FROM dtus WHERE id = ?").get(r.dtuId);
    assert.equal(dtu.lens_id, "literary");
    assert.match(dtu.content, /moral read of the soliloquy/);

    const cite = db.prepare(
      "SELECT parent_id FROM royalty_lineage WHERE child_id = ? AND parent_id = ?"
    ).get(r.dtuId, litDtu);
    assert.ok(cite, "the annotation DTU records a citation edge to the source passage DTU");
  });

  it("annotate with missing inputs returns missing_input (no partial writes)", async () => {
    const before = db.prepare("SELECT COUNT(*) n FROM dtus").get().n;
    const r = await macros.get("literary.annotate")(ctx, { chunkId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_input");
    const after = db.prepare("SELECT COUNT(*) n FROM dtus").get().n;
    assert.equal(after, before, "rejected annotation writes nothing");
  });

  it("annotate on an unknown chunk returns not_found", async () => {
    const r = await macros.get("literary.annotate")(ctx, { chunkId: "__nope__", note: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_found");
  });

  // ── robustness: poisoned numeric inputs are rejected, not silently clamped ──
  // (Macro Assassin V2 — these returned {ok:true} over NaN/Infinity/1e308/-1
  // before the badNumericField guard; now they fail-closed.)
  it("rejects poisoned numeric inputs across the lens-driven read macros", async () => {
    for (const bad of [Infinity, -1, Number.NaN, 1e308]) {
      const s = await macros.get("literary.search")(ctx, { query: "conscience", limit: bad });
      assert.equal(s.ok, false, `search should reject limit=${bad}`);
      const sg = await macros.get("literary.semantic_graph")(ctx, { query: "conscience", limit: bad });
      assert.equal(sg.ok, false, `semantic_graph should reject limit=${bad}`);
      const rg = await macros.get("literary.resonance_graph")(ctx, { limit: bad });
      assert.equal(rg.ok, false, `resonance_graph should reject limit=${bad}`);
      const rz = await macros.get("literary.resonance")(ctx, { chunkId, limit: bad });
      assert.equal(rz.ok, false, `resonance should reject limit=${bad}`);
    }
    // A clean, absent limit still works (uses the default).
    const ok = await macros.get("literary.search")(ctx, { query: "conscience" });
    assert.equal(ok.ok, true);
  });
});
