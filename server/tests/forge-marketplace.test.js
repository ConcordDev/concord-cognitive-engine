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

describe("listForgeAppOnMarketplace", () => {
  it("inserts via creative_artifact_listings when present", () => {
    const db = makeFakeDb({ schema: "creative_artifact_listings" });
    const r = listForgeAppOnMarketplace(db, {
      dtuId: "forge:user:abc",
      sellerId: "user:a",
      priceCents: 999,
      currency: "USD",
      title: "TODO",
    });
    assert.equal(r.ok, true);
    assert.equal(r.schema, "creative_artifact_listings");
    assert.equal(db._tables.creative_artifact_listings.size, 1);
  });

  it("falls back to marketplace_listings when v2 schema is missing", () => {
    const db = makeFakeDb({ schema: "marketplace_listings" });
    const r = listForgeAppOnMarketplace(db, {
      dtuId: "forge:user:abc",
      sellerId: "user:a",
      priceCents: 999,
      currency: "USD",
      title: "TODO",
    });
    assert.equal(r.ok, true);
    assert.equal(r.schema, "marketplace_listings");
    assert.equal(db._tables.marketplace_listings.size, 1);
  });

  it("rejects missing inputs", () => {
    const db = makeFakeDb();
    const r = listForgeAppOnMarketplace(db, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
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
