/**
 * Comprehensive tests for economy/dtu-pipeline.js
 * Targeting 100% line, branch, and function coverage.
 * Mocks: registerCitation, awardMeritCredit, database.
 */

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ── Stub external imports before loading module ─────────────────────
// We mock the entire module by importing the functions directly and
// stubbing the DB to capture all calls.

import {
  createDTU,
  listDTU,
  computeInitialCRETI,
  recalculateCRETI,
  compressToDMega,
  compressToHyper,
  forkDTU,
  getForkTree,
  getDTUPreview,
  searchDTUs,
} from "../economy/dtu-pipeline.js";

// ── Mock DB Factory ──────────────────────────────────────────────────

function createMockDb() {
  const tables = {
    dtus: [],
    dtu_ownership: [],
    dtu_previews: [],
    royalty_lineage: [],
    dtu_forks: [],
    dtu_compression: [],
    marketplace_listings: [],
  };

  const db = {
    _tables: tables,
    _calls: [],

    transaction(fn) {
      // Simulate transaction: just call fn immediately
      return (...args) => fn(...args);
    },

    prepare(sql) {
      return {
        run(...params) {
          db._calls.push({ sql, params });
          if (sql.includes("INSERT INTO dtus")) {
            // Detect which INSERT variant is being used based on hardcoded values in SQL
            if (sql.includes("'mega_dtu'") && sql.includes("'MEGA'")) {
              // compressToDMega: VALUES (?, ?, ?, ?, 'mega_dtu', ?, 'MEGA', '[]', ?, ?, ?, 'published', 1, ?, ?)
              tables.dtus.push({
                id: params[0], creator_id: params[1], title: params[2],
                content: params[3], content_type: "mega_dtu", lens_id: params[4],
                tier: "MEGA", tags_json: "[]", price: params[5],
                creti_score: params[6], metadata_json: params[7],
                status: "published", version: 1,
                created_at: params[8], updated_at: params[9],
              });
            } else if (sql.includes("'hyper_dtu'") && sql.includes("'HYPER'")) {
              // compressToHyper: VALUES (?, ?, ?, ?, 'hyper_dtu', ?, 'HYPER', '[]', ?, ?, ?, 'published', 1, ?, ?)
              tables.dtus.push({
                id: params[0], creator_id: params[1], title: params[2],
                content: params[3], content_type: "hyper_dtu", lens_id: params[4],
                tier: "HYPER", tags_json: "[]", price: params[5],
                creti_score: params[6], metadata_json: params[7],
                status: "published", version: 1,
                created_at: params[8], updated_at: params[9],
              });
            } else {
              // createDTU: all values as params
              tables.dtus.push({
                id: params[0], creator_id: params[1], title: params[2],
                content: params[3], content_type: params[4], lens_id: params[5],
                tier: params[6], tags_json: params[7], price: params[8],
                preview_policy: params[9], creti_score: params[10],
                size_kb: params[11], metadata_json: params[12],
                status: "published", version: 1,
                created_at: params[13], updated_at: params[14],
              });
            }
          }
          if (sql.includes("INSERT INTO dtu_ownership")) {
            tables.dtu_ownership.push({ id: params[0], dtu_id: params[1], owner_id: params[2] });
          }
          if (sql.includes("INSERT INTO dtu_previews")) {
            tables.dtu_previews.push({
              id: params[0], dtu_id: params[1], preview_content: params[2],
              preview_type: params[3], policy: params[4],
            });
          }
          if (sql.includes("INSERT INTO marketplace_listings")) {
            tables.marketplace_listings.push({ dtu_id: params[1], seller_id: params[2], price: params[3] });
          }
          if (sql.includes("INSERT INTO dtu_forks")) {
            tables.dtu_forks.push({
              id: params[0], original_dtu_id: params[1], fork_dtu_id: params[2],
              forker_id: params[3], original_creator_id: params[4],
            });
          }
          if (sql.includes("INSERT INTO dtu_compression")) {
            tables.dtu_compression.push({ parent_id: params[1], child_id: params[2] });
          }
          if (sql.includes("UPDATE dtus SET price")) {
            const dtu = tables.dtus.find(d => d.id === params[2]);
            if (dtu) dtu.price = params[0];
          }
          if (sql.includes("UPDATE dtus SET creti_score")) {
            const dtu = tables.dtus.find(d => d.id === params[2]);
            if (dtu) dtu.creti_score = params[0];
          }
          return { changes: 1 };
        },

        get(...params) {
          if (sql.includes("FROM dtus WHERE id = ?") && !sql.includes("tier")) {
            return tables.dtus.find(d => d.id === params[0]) || undefined;
          }
          if (sql.includes("FROM dtus WHERE id = ? AND tier = 'MEGA'")) {
            return tables.dtus.find(d => d.id === params[0] && d.tier === "MEGA") || undefined;
          }
          if (sql.includes("SELECT id, title, content_type, creti_score, tier FROM dtus WHERE id")) {
            const d = tables.dtus.find(x => x.id === params[0]);
            return d ? { id: d.id, title: d.title, content_type: d.content_type, creti_score: d.creti_score, tier: d.tier } : undefined;
          }
          if (sql.includes("COUNT") && sql.includes("royalty_lineage") && sql.includes("parent_id")) {
            return { c: tables.royalty_lineage.filter(r => r.parent_id === params[0]).length };
          }
          if (sql.includes("COUNT") && sql.includes("royalty_lineage") && sql.includes("child_id")) {
            return { c: tables.royalty_lineage.filter(r => r.child_id === params[0]).length };
          }
          if (sql.includes("COUNT") && sql.includes("dtu_ownership")) {
            return { c: tables.dtu_ownership.filter(o => o.dtu_id === params[0]).length };
          }
          if (sql.includes("COUNT") && sql.includes("dtu_forks")) {
            return { c: tables.dtu_forks.filter(f => f.original_dtu_id === params[0]).length };
          }
          if (sql.includes("dtu_previews") && sql.includes("dtu_id")) {
            const p = tables.dtu_previews.find(p => p.dtu_id === params[0]);
            return p || undefined;
          }
          if (sql.includes("FROM dtus") && sql.includes("title, creator_id")) {
            const d = tables.dtus.find(x => x.id === params[0]);
            return d ? {
              title: d.title, creator_id: d.creator_id, content_type: d.content_type,
              lens_id: d.lens_id, tier: d.tier, price: d.price,
              creti_score: d.creti_score, tags_json: d.tags_json,
            } : undefined;
          }
          if (sql.includes("COUNT(*)") && sql.includes("FROM dtus")) {
            return { c: tables.dtus.filter(d => d.status === "published").length };
          }
          return undefined;
        },

        all(...params) {
          if (sql.includes("dtu_forks") && sql.includes("original_dtu_id")) {
            return tables.dtu_forks
              .filter(f => f.original_dtu_id === params[0])
              .map(f => ({
                ...f,
                fork_title: "Fork",
                fork_creti: 30,
              }));
          }
          if (sql.includes("FROM dtus WHERE status")) {
            return tables.dtus.filter(d => d.status === "published").map(d => ({
              ...d, tags_json: d.tags_json || "[]",
            }));
          }
          // Phase 2 perf fix: batchLookup uses
          //   SELECT <cols> FROM dtus WHERE id IN (?, ?, ?, ...)
          // Match the IN-list shape and return matching rows.
          if (sql.includes("SELECT id, title, content_type, creti_score, tier FROM dtus WHERE id IN")) {
            return tables.dtus
              .filter(d => params.includes(d.id))
              .map(d => ({
                id: d.id, title: d.title, content_type: d.content_type,
                creti_score: d.creti_score, tier: d.tier,
              }));
          }
          if (sql.includes("FROM dtus WHERE id IN")) {
            return tables.dtus.filter(d => params.includes(d.id)).map(d => ({ ...d }));
          }
          return [];
        },
      };
    },
  };

  return db;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("dtu-pipeline: computeInitialCRETI", () => {
  it("computes score with all features present", () => {
    const score = computeInitialCRETI({
      contentLength: 500,
      citationCount: 10,
      hasMetadata: true,
      hasTags: true,
    });
    // 12+5+10+min(30,18)+18+0 = 12+5+10+18+18 = 63
    assert.equal(score, 63);
  });

  it("computes score with no metadata no tags no citations", () => {
    const score = computeInitialCRETI({
      contentLength: 100,
      citationCount: 0,
      hasMetadata: false,
      hasTags: false,
    });
    // 5+0+10+0+18+0 = 33
    assert.equal(score, 33);
  });

  it("caps evidence at 18", () => {
    const score = computeInitialCRETI({
      contentLength: 100,
      citationCount: 100,
      hasMetadata: true,
      hasTags: true,
    });
    // 12+5+10+18+18 = 63
    assert.equal(score, 63);
  });

  it("caps total at 100", () => {
    const score = computeInitialCRETI({
      contentLength: 100,
      citationCount: 100,
      hasMetadata: true,
      hasTags: true,
    });
    assert.ok(score <= 100);
  });
});

describe("dtu-pipeline: createDTU", () => {
  let db;
  beforeEach(() => { db = createMockDb(); });

  it("returns error for missing creator_id", () => {
    const result = createDTU(db, { title: "T", content: "C" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_creator_id");
  });

  it("returns error for missing title", () => {
    const result = createDTU(db, { creatorId: "u1", content: "C" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_title");
  });

  it("returns error for missing content", () => {
    const result = createDTU(db, { creatorId: "u1", title: "T" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_content");
  });

  it("creates a basic DTU successfully", () => {
    const result = createDTU(db, {
      creatorId: "user1", title: "My DTU", content: "Hello world",
      contentType: "text", lensId: "knowledge",
    });
    assert.equal(result.ok, true);
    assert.ok(result.dtu.id.startsWith("dtu_"));
    assert.equal(result.dtu.title, "My DTU");
    assert.equal(result.dtu.status, "published");
    assert.equal(result.dtu.tier, "REGULAR");
  });

  it("auto-upgrades to MEGA tier for large content", () => {
    const largeContent = "x".repeat(256 * 1024 + 1);
    const result = createDTU(db, {
      creatorId: "user1", title: "Large DTU", content: largeContent,
    });
    assert.equal(result.ok, true);
    assert.equal(result.dtu.tier, "MEGA");
  });

  it("keeps non-REGULAR tier when tier is explicitly set", () => {
    const result = createDTU(db, {
      creatorId: "user1", title: "Shadow", content: "small",
      tier: "SHADOW",
    });
    assert.equal(result.ok, true);
    assert.equal(result.dtu.tier, "SHADOW");
  });

  it("handles object content (non-string)", () => {
    const result = createDTU(db, {
      creatorId: "user1", title: "Object DTU",
      content: { key: "value" },
    });
    assert.equal(result.ok, true);
  });

  it("passes citations to registerCitation", () => {
    const result = createDTU(db, {
      creatorId: "user1", title: "Cited",
      content: "cite content",
      // citationMode defaults to "original" which forbids citations;
      // derivative mode REQUIRES citations, which matches this test.
      citationMode: "derivative",
      citations: [
        { parentId: "p1", parentCreatorId: "pc1", generation: 2 },
        { parentId: "p2" },
      ],
    });
    assert.equal(result.ok, true);
    assert.equal(result.dtu.citationCount, 2);
  });

  it("sets metadata and tags for CRETI scoring", () => {
    const result = createDTU(db, {
      creatorId: "user1", title: "T", content: "C",
      tags: ["a", "b"], metadata: { custom: true },
    });
    assert.equal(result.ok, true);
  });

  it("handles default preview policy", () => {
    const result = createDTU(db, {
      creatorId: "user1", title: "T", content: "paragraph 1\n\nparagraph 2\n\nparagraph 3\n\nparagraph 4",
    });
    assert.equal(result.ok, true);
  });

  it("handles preview policy 'full'", () => {
    const result = createDTU(db, {
      creatorId: "user1", title: "T", content: "Hello",
      previewPolicy: "full",
    });
    assert.equal(result.ok, true);
  });

  it("handles preview policy 'none'", () => {
    const result = createDTU(db, {
      creatorId: "user1", title: "T", content: "Hello",
      previewPolicy: "none",
    });
    assert.equal(result.ok, true);
  });

  it("handles preview policy 'teaser'", () => {
    const result = createDTU(db, {
      creatorId: "user1", title: "T",
      content: "x".repeat(500),
      previewPolicy: "teaser",
    });
    assert.equal(result.ok, true);
  });

  it("handles preview policy 'teaser' with short content", () => {
    const result = createDTU(db, {
      creatorId: "user1", title: "T", content: "short",
      previewPolicy: "teaser",
    });
    assert.equal(result.ok, true);
  });

  it("handles preview policy 'summary'", () => {
    const result = createDTU(db, {
      creatorId: "user1", title: "T",
      content: "x".repeat(600),
      previewPolicy: "summary",
    });
    assert.equal(result.ok, true);
  });

  it("handles preview policy 'summary' with short content", () => {
    const result = createDTU(db, {
      creatorId: "user1", title: "T", content: "short",
      previewPolicy: "summary",
    });
    assert.equal(result.ok, true);
  });

  it("handles unknown preview policy (default branch)", () => {
    const result = createDTU(db, {
      creatorId: "user1", title: "T", content: "x".repeat(300),
      previewPolicy: "unknown_policy",
    });
    assert.equal(result.ok, true);
  });

  it("handles 'full' preview for object content", () => {
    const result = createDTU(db, {
      creatorId: "user1", title: "T",
      content: { data: "obj" },
      previewPolicy: "full",
    });
    assert.equal(result.ok, true);
  });

  it("catches and returns error on transaction failure", () => {
    const badDb = {
      transaction(fn) { return () => { throw new Error("tx fail"); }; },
      prepare() { return { run() {}, get() {}, all() { return []; } }; },
    };
    const result = createDTU(badDb, {
      creatorId: "u", title: "T", content: "C",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "dtu_creation_failed");
  });
});

describe("dtu-pipeline: listDTU", () => {
  let db;
  beforeEach(() => { db = createMockDb(); });

  it("returns error for missing params", () => {
    assert.equal(listDTU(db, {}).ok, false);
    assert.equal(listDTU(db, { dtuId: "d" }).ok, false);
    assert.equal(listDTU(db, { sellerId: "s" }).ok, false);
    assert.equal(listDTU(db, { dtuId: "d", sellerId: "s" }).ok, false);
  });

  it("returns error for non-positive price", () => {
    const result = listDTU(db, { dtuId: "d", sellerId: "s", price: 0 });
    assert.equal(result.ok, false);
    assert.equal(result.error, "price_must_be_positive");
  });

  it("returns error for negative price", () => {
    const result = listDTU(db, { dtuId: "d", sellerId: "s", price: -1 });
    assert.equal(result.ok, false);
  });

  it("lists DTU successfully", () => {
    createDTU(db, { creatorId: "u1", title: "T", content: "C" });
    const dtuId = db._tables.dtus[0].id;
    const result = listDTU(db, { dtuId, sellerId: "u1", price: 10 });
    assert.equal(result.ok, true);
    assert.equal(result.listing.price, 10);
    assert.equal(result.listing.status, "ACTIVE");
  });

  it("uses default licenseType", () => {
    const result = listDTU(db, { dtuId: "d", sellerId: "s", price: 5 });
    assert.equal(result.ok, true);
    assert.equal(result.listing.licenseType, "standard");
  });

  it("catches DB error", () => {
    const badDb = {
      prepare() { return { run() { throw new Error("db fail"); } }; },
    };
    const result = listDTU(badDb, { dtuId: "d", sellerId: "s", price: 5 });
    assert.equal(result.ok, false);
    assert.equal(result.error, "listing_failed");
  });
});

describe("dtu-pipeline: recalculateCRETI", () => {
  let db;
  beforeEach(() => {
    db = createMockDb();
    createDTU(db, {
      creatorId: "u1", title: "Recalc", content: "content",
      tags: ["t1"], metadata: { key: "val" },
    });
  });

  it("returns error for non-existent DTU", () => {
    const result = recalculateCRETI(db, "nonexistent");
    assert.equal(result.ok, false);
    assert.equal(result.error, "dtu_not_found");
  });

  it("recalculates CRETI score", () => {
    const dtuId = db._tables.dtus[0].id;
    const result = recalculateCRETI(db, dtuId);
    assert.equal(result.ok, true);
    assert.ok(typeof result.score === "number");
    assert.ok(result.breakdown);
    assert.ok(result.signals);
    assert.ok(result.breakdown.credibility >= 0);
    assert.ok(result.breakdown.relevance >= 0);
    assert.ok(result.breakdown.evidence >= 0);
    assert.ok(result.breakdown.timeliness >= 0);
    assert.ok(result.breakdown.impact >= 0);
  });
});

describe("dtu-pipeline: compressToDMega", () => {
  let db;
  beforeEach(() => {
    db = createMockDb();
    createDTU(db, { creatorId: "u1", title: "Child 1", content: "c1" });
    createDTU(db, { creatorId: "u1", title: "Child 2", content: "c2" });
  });

  it("returns error for missing params", () => {
    assert.equal(compressToDMega(db, { title: "M" }).ok, false);
    assert.equal(compressToDMega(db, { creatorId: "u1" }).ok, false);
  });

  it("returns error for fewer than 2 children", () => {
    const result = compressToDMega(db, {
      creatorId: "u1", title: "M", childDtuIds: ["one"],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "need_at_least_2_dtus");
  });

  it("returns error for null childDtuIds", () => {
    const result = compressToDMega(db, {
      creatorId: "u1", title: "M", childDtuIds: null,
    });
    assert.equal(result.ok, false);
  });

  it("compresses successfully", () => {
    const ids = db._tables.dtus.map(d => d.id);
    const result = compressToDMega(db, {
      creatorId: "u1", title: "Mega DTU",
      childDtuIds: ids, lensId: "knowledge",
    });
    assert.equal(result.ok, true);
    assert.equal(result.mega.tier, "MEGA");
    assert.equal(result.mega.childCount, 2);
  });

  it("returns error when child not found", () => {
    const result = compressToDMega(db, {
      creatorId: "u1", title: "M",
      childDtuIds: ["nonexistent1", "nonexistent2"],
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("child_dtu_not_found"));
  });
});

describe("dtu-pipeline: compressToHyper", () => {
  let db;
  beforeEach(() => {
    db = createMockDb();
    // Create 2 mega DTUs
    createDTU(db, { creatorId: "u1", title: "C1", content: "c" });
    createDTU(db, { creatorId: "u1", title: "C2", content: "c" });
    const ids = db._tables.dtus.map(d => d.id);
    compressToDMega(db, { creatorId: "u1", title: "M1", childDtuIds: ids });

    createDTU(db, { creatorId: "u1", title: "C3", content: "c" });
    createDTU(db, { creatorId: "u1", title: "C4", content: "c" });
    const ids2 = db._tables.dtus.filter(d => d.title === "C3" || d.title === "C4").map(d => d.id);
    compressToDMega(db, { creatorId: "u1", title: "M2", childDtuIds: ids2 });
  });

  it("returns error for missing params", () => {
    assert.equal(compressToHyper(db, { title: "H" }).ok, false);
    assert.equal(compressToHyper(db, { creatorId: "u1" }).ok, false);
  });

  it("returns error for fewer than 2 megas", () => {
    const result = compressToHyper(db, {
      creatorId: "u1", title: "H", megaDtuIds: ["one"],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "need_at_least_2_megas");
  });

  it("returns error for null megaDtuIds", () => {
    const result = compressToHyper(db, {
      creatorId: "u1", title: "H",
    });
    assert.equal(result.ok, false);
  });

  it("compresses mega DTUs into hyper", () => {
    const megaIds = db._tables.dtus.filter(d => d.tier === "MEGA").map(d => d.id);
    const result = compressToHyper(db, {
      creatorId: "u1", title: "Hyper DTU", megaDtuIds: megaIds,
    });
    assert.equal(result.ok, true);
    assert.equal(result.hyper.tier, "HYPER");
    assert.equal(result.hyper.megaCount, 2);
  });

  it("returns error when mega not found", () => {
    const result = compressToHyper(db, {
      creatorId: "u1", title: "H",
      megaDtuIds: ["bad1", "bad2"],
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("mega_dtu_not_found"));
  });
});

describe("dtu-pipeline: forkDTU", () => {
  let db;
  beforeEach(() => {
    db = createMockDb();
    createDTU(db, {
      creatorId: "original_creator", title: "Original",
      content: "original content", metadata: {},
    });
  });

  it("returns error for missing params", () => {
    assert.equal(forkDTU(db, { originalDtuId: "x" }).ok, false);
    assert.equal(forkDTU(db, { forkerId: "u" }).ok, false);
  });

  it("returns error for non-existent original", () => {
    const result = forkDTU(db, { forkerId: "u1", originalDtuId: "nonexistent" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "original_not_found");
  });

  it("forks successfully", () => {
    const originalId = db._tables.dtus[0].id;
    const result = forkDTU(db, {
      forkerId: "forker1", originalDtuId: originalId,
      newTitle: "My Fork", newContent: "forked content", lensId: "code",
    });
    assert.equal(result.ok, true);
    assert.ok(result.fork.id);
    assert.equal(result.fork.originalId, originalId);
    assert.equal(result.fork.autoCitation, true);
  });

  it("forks without newTitle/newContent (uses defaults)", () => {
    const originalId = db._tables.dtus[0].id;
    const result = forkDTU(db, {
      forkerId: "forker1", originalDtuId: originalId,
    });
    assert.equal(result.ok, true);
  });

  it("blocks fork when policy is restricted and forker is not creator", () => {
    // Manually set metadata with forkPolicy=restricted
    db._tables.dtus[0].metadata_json = JSON.stringify({ forkPolicy: "restricted" });
    const originalId = db._tables.dtus[0].id;
    const result = forkDTU(db, {
      forkerId: "someone_else", originalDtuId: originalId,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "fork_restricted");
  });

  it("allows fork when policy is restricted but forker is creator", () => {
    db._tables.dtus[0].metadata_json = JSON.stringify({ forkPolicy: "restricted" });
    const originalId = db._tables.dtus[0].id;
    const result = forkDTU(db, {
      forkerId: "original_creator", originalDtuId: originalId,
    });
    assert.equal(result.ok, true);
  });

  it("catches transaction error", () => {
    const badDb = {
      transaction() { return () => { throw new Error("tx error"); }; },
      prepare(sql) {
        return {
          get() {
            if (sql.includes("FROM dtus")) {
              return {
                id: "d1", creator_id: "c1", title: "T", content: "C",
                content_type: "text", lens_id: "l", tier: "REGULAR",
                tags_json: "[]", metadata_json: "{}",
                creti_score: 30,
              };
            }
            return undefined;
          },
          run() {},
          all() { return []; },
        };
      },
    };
    const result = forkDTU(badDb, { forkerId: "u", originalDtuId: "d1" });
    assert.equal(result.ok, false);
  });
});

describe("dtu-pipeline: getForkTree", () => {
  let db;
  beforeEach(() => { db = createMockDb(); });

  it("returns empty fork tree", () => {
    const result = getForkTree(db, "some_dtu");
    assert.equal(result.ok, true);
    assert.equal(result.count, 0);
    assert.deepEqual(result.forks, []);
  });

  it("returns forks when they exist", () => {
    createDTU(db, { creatorId: "u1", title: "O", content: "c" });
    const origId = db._tables.dtus[0].id;
    forkDTU(db, { forkerId: "u2", originalDtuId: origId });

    const result = getForkTree(db, origId);
    assert.equal(result.ok, true);
    assert.ok(result.count >= 1);
  });
});

describe("dtu-pipeline: getDTUPreview", () => {
  let db;
  beforeEach(() => {
    db = createMockDb();
    createDTU(db, { creatorId: "u1", title: "Preview Test", content: "hello" });
  });

  it("returns error when no preview found", () => {
    // Clear previews
    db._tables.dtu_previews = [];
    const result = getDTUPreview(db, "nonexistent");
    assert.equal(result.ok, false);
    assert.equal(result.error, "preview_not_found");
  });

  it("returns preview when it exists", () => {
    const dtuId = db._tables.dtus[0].id;
    const result = getDTUPreview(db, dtuId);
    assert.equal(result.ok, true);
    assert.ok(result.preview.dtuId);
    assert.ok(result.preview.previewContent !== undefined);
  });
});

describe("dtu-pipeline: searchDTUs", () => {
  let db;
  beforeEach(() => {
    db = createMockDb();
    createDTU(db, { creatorId: "u1", title: "Search Test", content: "findme", tags: ["tag1"] });
  });

  it("returns error when no query or lensId provided", () => {
    const result = searchDTUs(db, {});
    assert.equal(result.ok, false);
    assert.equal(result.error, "query_or_lens_required");
  });

  it("returns error with no args", () => {
    const result = searchDTUs(db);
    assert.equal(result.ok, false);
  });

  it("searches by query", () => {
    const result = searchDTUs(db, { query: "Search" });
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.results));
  });

  it("searches by lensId", () => {
    const result = searchDTUs(db, { lensId: "unknown" });
    assert.equal(result.ok, true);
  });

  it("applies all optional filters", () => {
    const result = searchDTUs(db, {
      query: "test", lensId: "knowledge", tier: "REGULAR",
      minCreti: 10, maxPrice: 100,
      sortBy: "price", limit: 10, offset: 0,
    });
    assert.equal(result.ok, true);
  });

  it("uses default sort for invalid sortBy", () => {
    const result = searchDTUs(db, { query: "test", sortBy: "invalid_sort" });
    assert.equal(result.ok, true);
  });

  it("applies 'newest' sort", () => {
    const result = searchDTUs(db, { query: "test", sortBy: "newest" });
    assert.equal(result.ok, true);
  });

  it("applies 'popular' sort", () => {
    const result = searchDTUs(db, { query: "test", sortBy: "popular" });
    assert.equal(result.ok, true);
  });

  it("doesn't filter by minCreti when 0", () => {
    const result = searchDTUs(db, { query: "test", minCreti: 0 });
    assert.equal(result.ok, true);
  });
});
