/**
 * Tier-2 contract tests for Phase 13 Stage C — agent marketplace.
 *
 * Pins:
 *   - validateAgentManifest accepts a well-formed spec; rejects invalid shapes
 *   - capabilitySet builds the right "<domain>.<macro>" set incl. _llm
 *   - mintAgentAsDtu writes kind='agent_spec' DTU + registers citations
 *   - listAgentOnMarketplace targets v2 then falls back to v1
 *   - getAgentEarnings aggregates royalty_payouts correctly
 *   - loadAgent re-validates manifest (drift detection)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  validateAgentManifest,
  capabilitySet,
} from "../lib/agent-spec-validator.js";
import {
  mintAgentAsDtu,
  listAgentOnMarketplace,
  listAgentsForUser,
  getAgentEarnings,
  loadAgent,
} from "../lib/agent-marketplace.js";

function goodManifest(overrides = {}) {
  return {
    id: "agent:spec:translator",
    name: "Document Translator",
    version: "1.0.0",
    creator_id: "user:alice",
    license: "MIT",
    capabilities: [
      { domain: "translation", macros: ["translate", "batch_translate"] },
    ],
    constraints: {
      max_concurrent_tasks: 10,
      memory_required_mb: 2048,
      execution_timeout_s: 300,
    },
    parent_dtu_ids: [],
    description: "Translates documents",
    summary: "fast doc translator",
    ...overrides,
  };
}

function setupAgentDb() {
  const db = new Database(":memory:");
  // Minimal dtus + creative_artifact_listings + royalty_payouts schema
  // sufficient for marketplace tests. Mirrors migrations 001 + 008 + 202.
  db.exec(`
    CREATE TABLE dtus (
      id              TEXT PRIMARY KEY,
      kind            TEXT NOT NULL,
      title           TEXT,
      creator_id      TEXT,
      meta_json       TEXT,
      skill_level     INTEGER DEFAULT 1,
      total_experience REAL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX idx_dtus_agent_spec_by_creator
      ON dtus(creator_id, created_at DESC) WHERE kind = 'agent_spec';
    CREATE TABLE creative_artifact_listings (
      id          TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      seller_id   TEXT NOT NULL,
      price       INTEGER NOT NULL,
      currency    TEXT NOT NULL DEFAULT 'USD',
      status      TEXT NOT NULL,
      listed_at   INTEGER NOT NULL
    );
    CREATE TABLE royalty_payouts (
      id              TEXT PRIMARY KEY,
      transaction_id  TEXT NOT NULL,
      content_id      TEXT NOT NULL,
      recipient_id    TEXT NOT NULL,
      amount          REAL NOT NULL,
      generation      INTEGER NOT NULL DEFAULT 1,
      royalty_rate    REAL NOT NULL DEFAULT 0.21,
      source_tx_id    TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

// ── validateAgentManifest ──────────────────────────────────────────────────

describe("validateAgentManifest — accepts well-formed spec", () => {
  it("accepts the canonical example", () => {
    const r = validateAgentManifest(goodManifest());
    assert.equal(r.ok, true);
    assert.equal(r.normalized.id, "agent:spec:translator");
    assert.equal(r.normalized.capabilities.length, 1);
    assert.equal(r.normalized.constraints.execution_timeout_s, 300);
  });

  it("stamps defaults onto missing constraints", () => {
    const m = goodManifest();
    delete m.constraints;
    const r = validateAgentManifest(m);
    assert.equal(r.ok, true);
    assert.equal(r.normalized.constraints.max_concurrent_tasks, 1);
    assert.equal(r.normalized.constraints.execution_timeout_s, 60);
  });

  it("accepts _llm reserved capability with empty macros", () => {
    const m = goodManifest({
      capabilities: [
        { domain: "_llm", macros: [] },
        { domain: "translation", macros: ["translate"] },
      ],
    });
    const r = validateAgentManifest(m);
    assert.equal(r.ok, true);
  });
});

describe("validateAgentManifest — rejects invalid shapes", () => {
  it("rejects missing id", () => {
    const m = goodManifest(); delete m.id;
    assert.equal(validateAgentManifest(m).ok, false);
  });
  it("rejects bad license", () => {
    const m = goodManifest({ license: "GPL" });
    assert.equal(validateAgentManifest(m).reason, "invalid_license");
  });
  it("rejects empty capabilities", () => {
    const m = goodManifest({ capabilities: [] });
    assert.equal(validateAgentManifest(m).reason, "missing_capabilities");
  });
  it("rejects capability domain with bad chars", () => {
    const m = goodManifest({ capabilities: [{ domain: "../bad", macros: ["x"] }] });
    assert.equal(validateAgentManifest(m).reason, "invalid_capability_domain");
  });
  it("rejects macro name with bad chars", () => {
    const m = goodManifest({ capabilities: [{ domain: "x", macros: ["bad/macro"] }] });
    assert.equal(validateAgentManifest(m).reason, "invalid_capability_macro_name");
  });
  it("rejects insane timeout", () => {
    const m = goodManifest({ constraints: { execution_timeout_s: 999999 } });
    assert.equal(validateAgentManifest(m).reason, "invalid_execution_timeout_s");
  });
});

// ── capabilitySet ──────────────────────────────────────────────────────────

describe("capabilitySet — builds correct allow-list", () => {
  it("emits 'domain.macro' entries", () => {
    const m = validateAgentManifest(goodManifest()).normalized;
    const s = capabilitySet(m);
    assert.equal(s.has("translation.translate"), true);
    assert.equal(s.has("translation.batch_translate"), true);
    assert.equal(s.has("finance.transfer"), false);
  });
  it("emits literal '_llm' for the reserved capability", () => {
    const m = validateAgentManifest(goodManifest({
      capabilities: [{ domain: "_llm", macros: [] }, { domain: "x", macros: ["y"] }],
    })).normalized;
    const s = capabilitySet(m);
    assert.equal(s.has("_llm"), true);
    assert.equal(s.has("x.y"), true);
  });
});

// ── mintAgentAsDtu ─────────────────────────────────────────────────────────

describe("mintAgentAsDtu — persistence + citation", () => {
  it("writes kind='agent_spec' DTU with capabilities in meta", async () => {
    const db = setupAgentDb();
    const r = await mintAgentAsDtu(db, {
      userId: "user:alice",
      agentManifest: goodManifest(),
    });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT kind, title, creator_id, meta_json FROM dtus WHERE id = ?`).get(r.dtuId);
    assert.equal(row.kind, "agent_spec");
    assert.equal(row.title, "Document Translator");
    assert.equal(row.creator_id, "user:alice");
    const meta = JSON.parse(row.meta_json);
    assert.deepEqual(meta.capabilities, ["translation.translate", "translation.batch_translate"]);
    assert.equal(meta.scope, "public");
    assert.ok(meta.source_sha1);
  });

  it("rejects malformed manifest with invalid_manifest", async () => {
    const db = setupAgentDb();
    const r = await mintAgentAsDtu(db, {
      userId: "user:alice",
      agentManifest: goodManifest({ license: "BSD-99" }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_manifest");
  });

  it("requires userId", async () => {
    const db = setupAgentDb();
    const r = await mintAgentAsDtu(db, { agentManifest: goodManifest() });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_user");
  });
});

// ── listAgentOnMarketplace ─────────────────────────────────────────────────

describe("listAgentOnMarketplace — v2 path", () => {
  it("inserts a creative_artifact_listings row", () => {
    const db = setupAgentDb();
    const r = listAgentOnMarketplace(db, {
      dtuId: "dtu:agent:test",
      sellerId: "user:alice",
      priceCents: 1500,
      title: "Translator",
    });
    assert.equal(r.ok, true);
    assert.equal(r.schema, "creative_artifact_listings");
    const row = db.prepare(`SELECT artifact_id, seller_id, price, status FROM creative_artifact_listings WHERE id = ?`).get(r.listingId);
    assert.equal(row.artifact_id, "dtu:agent:test");
    assert.equal(row.seller_id, "user:alice");
    assert.equal(row.price, 1500);
    assert.equal(row.status, "active");
  });

  it("rejects 0 or negative price", () => {
    const db = setupAgentDb();
    const r = listAgentOnMarketplace(db, {
      dtuId: "dtu:x", sellerId: "user:x", priceCents: 0,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });
});

// ── listAgentsForUser ──────────────────────────────────────────────────────

describe("listAgentsForUser", () => {
  it("returns only agent_spec DTUs by creator, newest first", async () => {
    const db = setupAgentDb();
    await mintAgentAsDtu(db, { userId: "user:alice", agentManifest: goodManifest({ id: "agent:a", name: "A" }) });
    await mintAgentAsDtu(db, { userId: "user:alice", agentManifest: goodManifest({ id: "agent:b", name: "B" }) });
    // an unrelated DTU shouldn't surface
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json) VALUES ('dtu:other', 'forge_app', 'X', 'user:alice', '{}')`).run();
    const rows = listAgentsForUser(db, "user:alice");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.title).sort(), ["A", "B"]);
  });
});

// ── getAgentEarnings ───────────────────────────────────────────────────────

describe("getAgentEarnings", () => {
  it("aggregates royalty_payouts whose content_id is one of the user's agents", async () => {
    const db = setupAgentDb();
    const mint = await mintAgentAsDtu(db, { userId: "user:alice", agentManifest: goodManifest() });
    db.prepare(`INSERT INTO royalty_payouts (id, transaction_id, content_id, recipient_id, amount, generation, royalty_rate, source_tx_id) VALUES (?, ?, ?, ?, ?, 1, 0.21, ?)`)
      .run("p1", "tx1", mint.dtuId, "user:alice", 12.5, "tx1");
    db.prepare(`INSERT INTO royalty_payouts (id, transaction_id, content_id, recipient_id, amount, generation, royalty_rate, source_tx_id) VALUES (?, ?, ?, ?, ?, 1, 0.21, ?)`)
      .run("p2", "tx2", mint.dtuId, "user:alice", 7.5, "tx2");
    // A payout to someone else for the same content should not count.
    db.prepare(`INSERT INTO royalty_payouts (id, transaction_id, content_id, recipient_id, amount, generation, royalty_rate, source_tx_id) VALUES (?, ?, ?, ?, ?, 1, 0.21, ?)`)
      .run("p3", "tx3", mint.dtuId, "user:bob", 5.0, "tx3");
    const r = getAgentEarnings(db, "user:alice");
    assert.equal(r.ok, true);
    assert.equal(r.totalEarned, 20);
    assert.equal(r.byContent.length, 1);
    assert.equal(r.byContent[0].dtuId, mint.dtuId);
    assert.equal(r.byContent[0].total, 20);
  });

  it("returns empty totals when the user has no agents", () => {
    const db = setupAgentDb();
    const r = getAgentEarnings(db, "user:alice");
    assert.equal(r.ok, true);
    assert.equal(r.totalEarned, 0);
    assert.equal(r.byContent.length, 0);
  });
});

// ── loadAgent ──────────────────────────────────────────────────────────────

describe("loadAgent — re-validates manifest at load time", () => {
  it("succeeds on a freshly minted agent", async () => {
    const db = setupAgentDb();
    const mint = await mintAgentAsDtu(db, { userId: "user:alice", agentManifest: goodManifest() });
    const r = loadAgent(db, mint.dtuId);
    assert.equal(r.ok, true);
    assert.equal(r.manifest.id, "agent:spec:translator");
  });

  it("returns wrong_kind for non-agent DTUs", () => {
    const db = setupAgentDb();
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json) VALUES ('dtu:x', 'forge_app', 'X', 'user:x', '{}')`).run();
    const r = loadAgent(db, "dtu:x");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "wrong_kind");
  });

  it("returns manifest_drift when persisted manifest no longer validates", () => {
    const db = setupAgentDb();
    // Insert a DTU with deliberately-bad agent_manifest meta
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json) VALUES ('dtu:drift', 'agent_spec', 'X', 'user:x', ?)`)
      .run(JSON.stringify({ agent_manifest: { id: "x", name: "X" } })); // missing many required fields
    const r = loadAgent(db, "dtu:drift");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "manifest_drift");
  });
});
