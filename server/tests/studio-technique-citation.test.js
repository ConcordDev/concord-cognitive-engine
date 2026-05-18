// Tier-2 contract test — Studio Sprint B #12: technique citation lineage.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerStudioTechniqueMacros from "../domains/studio-techniques.js";

function makeFakeDb() {
  const dtus = new Map();
  const lineage = [];
  return {
    prepare(sql) {
      const s = sql.replace(/\s+/g, " ").trim();
      return {
        run: (...args) => {
          if (s.startsWith("INSERT INTO dtus")) {
            const [id, title, creator, meta] = args;
            const kind = s.includes("'production_technique'") ? "production_technique" : "unknown";
            dtus.set(id, { id, kind, title, creator_id: creator, meta_json: meta });
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        get: (...args) => {
          if (s.startsWith("SELECT id, creator_id FROM dtus WHERE id = ?")) {
            const [id] = args;
            const r = dtus.get(id);
            return r ? { id: r.id, creator_id: r.creator_id } : undefined;
          }
          return undefined;
        },
        all: (...args) => {
          if (s.includes("kind = 'production_technique'") && s.includes("creator_id = ?")) {
            const [creator] = args;
            return [...dtus.values()].filter(d => d.kind === "production_technique" && d.creator_id === creator);
          }
          if (s.includes("kind = 'production_technique'")) {
            return [...dtus.values()].filter(d => d.kind === "production_technique");
          }
          return [];
        },
      };
    },
    _tables: { dtus, lineage },
  };
}

function makeRegistry() {
  const macros = new Map();
  registerStudioTechniqueMacros((domain, name, handler, opts) => {
    macros.set(`${domain}.${name}`, { handler, opts });
  });
  return macros;
}

describe("studio.mint_technique", () => {
  it("requires a title", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.mint_technique").handler(
      { db: makeFakeDb(), actor: { userId: "u1" } },
      {},
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "title_required");
  });

  it("requires actor", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.mint_technique").handler(
      { db: makeFakeDb() }, { title: "x" },
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_actor");
  });

  it("mints kind='production_technique' DTU with captured metadata", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    const out = await macros.get("studio.mint_technique").handler(
      { db, actor: { userId: "u1" } },
      {
        title: "Sidechain bass to kick on the and-of-3",
        description: "Subtle pump that locks the low end together.",
        tags: ["sidechain", "compression", "lowend"],
        recipe_data: { compressor: { threshold: -18, ratio: 4, attack: 5, release: 80 } },
      },
    );
    assert.equal(out.ok, true);
    assert.equal(out.kind, "production_technique");
    const stored = db._tables.dtus.get(out.dtuId);
    assert.equal(stored.kind, "production_technique");
    const meta = JSON.parse(stored.meta_json);
    assert.equal(meta.tags.length, 3);
    assert.equal(meta.recipe_data.compressor.ratio, 4);
  });

  it("rejects recipe_data larger than 16KB", async () => {
    const macros = makeRegistry();
    const big = "x".repeat(20 * 1024);
    const out = await macros.get("studio.mint_technique").handler(
      { db: makeFakeDb(), actor: { userId: "u1" } },
      { title: "Heavy", recipe_data: { blob: big } },
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "recipe_too_large");
  });

  it("clamps tags to 20", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    const out = await macros.get("studio.mint_technique").handler(
      { db, actor: { userId: "u1" } },
      { title: "T", tags: Array.from({ length: 100 }, (_, i) => `t${i}`) },
    );
    assert.equal(out.ok, true);
    const meta = JSON.parse(db._tables.dtus.get(out.dtuId).meta_json);
    assert.equal(meta.tags.length, 20);
  });
});

describe("studio.cite_technique", () => {
  it("rejects missing ids", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.cite_technique").handler(
      { db: makeFakeDb(), actor: { userId: "u1" } }, {},
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "missing_ids");
  });

  it("rejects if technique DTU does not exist", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.cite_technique").handler(
      { db: makeFakeDb(), actor: { userId: "u1" } },
      { track_dtuId: "trk_1", technique_dtuId: "missing" },
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "technique_not_found");
  });
});

describe("studio.list_techniques", () => {
  it("returns the caller's techniques in 'mine' scope", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    await macros.get("studio.mint_technique").handler(
      { db, actor: { userId: "alice" } }, { title: "alice T1" },
    );
    await macros.get("studio.mint_technique").handler(
      { db, actor: { userId: "bob" } }, { title: "bob T1" },
    );
    const mine = await macros.get("studio.list_techniques").handler(
      { db, actor: { userId: "alice" } }, { scope: "mine" },
    );
    assert.equal(mine.techniques.length, 1);
    assert.equal(mine.techniques[0].title, "alice T1");
  });

  it("returns all techniques in 'all' scope", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    await macros.get("studio.mint_technique").handler(
      { db, actor: { userId: "alice" } }, { title: "alice T1" },
    );
    await macros.get("studio.mint_technique").handler(
      { db, actor: { userId: "bob" } }, { title: "bob T1" },
    );
    const all = await macros.get("studio.list_techniques").handler(
      { db, actor: { userId: "alice" } }, { scope: "all" },
    );
    assert.equal(all.techniques.length, 2);
  });
});
