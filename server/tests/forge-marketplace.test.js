/**
 * Tier-2 contract tests for Phase 6a — Forge → Marketplace.
 *
 * Run: node --test tests/forge-marketplace.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  mintForgeAppAsDtu,
  listForgeAppOnMarketplace,
  listForgeAppsForUser,
} from "../lib/forge-marketplace.js";

function makeFakeDb({ schema = "creative_artifact_listings" } = {}) {
  const tables = { dtus: new Map(), creative_artifact_listings: new Map(), marketplace_listings: new Map(), economy_ledger: new Map() };
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return { run: (...a) => runStmt(s, a), get: (...a) => getStmt(s, a), all: (...a) => allStmt(s, a) };
  }
  function runStmt(sql, args) {
    if (sql.startsWith("INSERT INTO dtus")) {
      const [id, title, creator, meta] = args; // 'forge_app' literal
      tables.dtus.set(id, { id, kind: "forge_app", title, creator_id: creator, meta_json: meta, created_at: Math.floor(Date.now() / 1000) });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO creative_artifact_listings")) {
      if (schema !== "creative_artifact_listings") throw new Error("no such table: creative_artifact_listings");
      const [id, artifact, seller, price, currency] = args;
      tables.creative_artifact_listings.set(id, { id, artifact_id: artifact, seller_id: seller, price, currency, status: "active" });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO marketplace_listings")) {
      const [id, owner, title, description, priceCents, currency] = args;
      tables.marketplace_listings.set(id, { id, owner_user_id: owner, title, description, price_cents: priceCents, currency });
      return { changes: 1 };
    }
    return { changes: 0 };
  }
  function getStmt(sql, args) {
    if (sql.startsWith("SELECT id, creator_id, data AS meta_json FROM dtus WHERE id = ?")) {
      const r = tables.dtus.get(args[0]);
      return r ? { id: r.id, creator_id: r.creator_id, meta_json: r.meta_json } : null;
    }
    return null;
  }
  function allStmt(sql, args) {
    if (sql.startsWith("SELECT id, title, data AS meta_json, created_at FROM dtus WHERE type = 'forge_app' AND creator_id = ?")) {
      const [creator] = args;
      return Array.from(tables.dtus.values()).filter(d => d.creator_id === creator);
    }
    return [];
  }
  return { prepare, _tables: tables };
}

describe("mintForgeAppAsDtu", () => {
  it("inserts a kind='forge_app' DTU", async () => {
    const db = makeFakeDb();
    const r = await mintForgeAppAsDtu(db, {
      userId: "user:a",
      templateId: null,
      appName: "TODO",
      sourceCode: "console.log('hi');",
      manifest: { language: "javascript", sections: ["main"] },
      summary: "a tiny todo app",
    });
    assert.equal(r.ok, true);
    assert.ok(r.dtuId);
    const dtu = db._tables.dtus.get(r.dtuId);
    assert.equal(dtu.kind, "forge_app");
    assert.equal(dtu.title, "TODO");
    const meta = JSON.parse(dtu.meta_json);
    assert.equal(meta.author_kind, "player");
    assert.ok(meta.source_sha1);
  });

  it("rejects missing inputs", async () => {
    const db = makeFakeDb();
    const r = await mintForgeAppAsDtu(db, { userId: "user:a" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });
});

// Fixed (2026-07 grounding-audit continuation): listForgeAppOnMarketplace no
// longer writes into the dead-end `creative_artifact_listings` (never
// created by any migration) / `marketplace_listings` (real table, but no
// purchase path) schemas. It now calls the REAL `marketplace.list` macro via
// `ctx.macro.run` — same pattern as
// `server/lib/asset-gen/asset-marketplace.js#listGeneratedAssetOnMarketplace`.
// These unit tests stub `ctx.macro.run` to pin the call contract in
// isolation (no server boot); the real macro + real royalty-cascade purchase
// path is proven end-to-end in
// `server/tests/forge-marketplace-purchase-e2e.test.js`.
function makeFakeMacroCtx({ listResult } = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      actor: { userId: "user:a" },
      macro: {
        run: async (domain, name, input) => {
          calls.push({ domain, name, input });
          return listResult;
        },
      },
    },
  };
}

describe("listForgeAppOnMarketplace", () => {
  it("calls the real marketplace.list macro with a CC-unit price derived from priceCents", async () => {
    const { ctx, calls } = makeFakeMacroCtx({
      listResult: { ok: true, listing: { price: 9.99, currency: "USD" } },
    });
    const r = await listForgeAppOnMarketplace(ctx, {
      dtuId: "forge:user:abc",
      priceCents: 999,
      currency: "USD",
      title: "TODO",
    });
    assert.equal(r.ok, true);
    assert.equal(r.listingId, "forge:user:abc");
    assert.equal(r.dtuId, "forge:user:abc");
    assert.deepEqual(r.listing, { price: 9.99, currency: "USD" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].domain, "marketplace");
    assert.equal(calls[0].name, "list");
    assert.equal(calls[0].input.dtuId, "forge:user:abc");
    assert.equal(calls[0].input.price, 9.99); // 999 cents -> 9.99 CC/USD units
    assert.equal(calls[0].input.contentType, "forge_app");
  });

  it("accepts an explicit opts.price (CC units) in preference to priceCents", async () => {
    const { ctx, calls } = makeFakeMacroCtx({ listResult: { ok: true, listing: { price: 5 } } });
    const r = await listForgeAppOnMarketplace(ctx, { dtuId: "forge:user:abc", price: 5, priceCents: 999 });
    assert.equal(r.ok, true);
    assert.equal(calls[0].input.price, 5);
  });

  it("passes through a real macro failure (e.g. ownership gate) as a reason, no fabricated success", async () => {
    const { ctx } = makeFakeMacroCtx({ listResult: { ok: false, error: "not_your_dtu" } });
    const r = await listForgeAppOnMarketplace(ctx, { dtuId: "forge:user:abc", priceCents: 999 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_your_dtu");
  });

  it("rejects missing inputs", async () => {
    const { ctx } = makeFakeMacroCtx({});
    const r = await listForgeAppOnMarketplace(ctx, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });

  it("rejects when the ctx has no macro runtime", async () => {
    const r = await listForgeAppOnMarketplace({}, { dtuId: "x", priceCents: 100 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_macro_runtime");
  });
});

describe("listForgeAppsForUser", () => {
  it("returns user's minted apps only", async () => {
    const db = makeFakeDb();
    await mintForgeAppAsDtu(db, { userId: "u1", appName: "A", sourceCode: "x" });
    await mintForgeAppAsDtu(db, { userId: "u1", appName: "B", sourceCode: "y" });
    await mintForgeAppAsDtu(db, { userId: "u2", appName: "C", sourceCode: "z" });
    assert.equal(listForgeAppsForUser(db, "u1").length, 2);
    assert.equal(listForgeAppsForUser(db, "u2").length, 1);
  });
});
