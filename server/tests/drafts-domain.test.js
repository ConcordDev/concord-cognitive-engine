/**
 * Tier-2 contract test for the Phase 1 drafts domain.
 *
 * Pins:
 *   - save → load round-trip preserves payload + bumps updated_at
 *   - UPSERT idempotency on (user_id, lens_id, draft_key)
 *   - list_mine ordering (most recent first) + lens-filter + global modes
 *   - delete idempotency (returns ok=true even if row absent)
 *   - anonymous callers (no userId) are rejected on all four macros
 *   - payload size cap (256 KiB) is enforced
 *   - GC cutoff at 30d (and env override CONCORD_DRAFT_TTL_DAYS)
 *
 * Run: node --test server/tests/drafts-domain.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerDraftsMacros from "../domains/drafts.js";
import { up as up194 } from "../migrations/194_lens_drafts.js";
import { sweepExpiredDrafts, DEFAULT_DRAFT_TTL_DAYS, getDraftTtlDays } from "../lib/draft-gc.js";
import { runDraftGcCycle } from "../emergent/draft-gc-cycle.js";

function makeRegistry() {
  const map = new Map();
  const register = (domain, name, handler) => {
    map.set(`${domain}.${name}`, handler);
  };
  return { register, call: (key, ctx, input) => map.get(key)(ctx, input), keys: () => [...map.keys()] };
}

function setupDb() {
  const db = new Database(":memory:");
  up194(db);
  return db;
}

describe("drafts domain — registration", () => {
  it("registers four macros", () => {
    const r = makeRegistry();
    registerDraftsMacros(r.register);
    const keys = r.keys().sort();
    assert.deepEqual(keys, [
      "drafts.delete", "drafts.list_mine", "drafts.load", "drafts.save",
    ]);
  });
});

describe("drafts.save", () => {
  let db, r;
  beforeEach(() => {
    db = setupDb();
    r = makeRegistry();
    registerDraftsMacros(r.register);
  });

  it("rejects when ctx.db is missing", async () => {
    const res = await r.call("drafts.save", { actor: { userId: "u1" } }, { lensId: "x", draftKey: "k", payload: {} });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "no_db");
  });

  it("rejects anonymous callers", async () => {
    const res = await r.call("drafts.save", { db }, { lensId: "x", draftKey: "k", payload: {} });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "no_user");
  });

  it("rejects missing keys", async () => {
    const res = await r.call("drafts.save", { db, actor: { userId: "u1" } }, { payload: {} });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_key");
  });

  it("rejects payload >256KiB", async () => {
    const huge = "x".repeat(300 * 1024);
    const res = await r.call("drafts.save", { db, actor: { userId: "u1" } }, {
      lensId: "pharmacy", draftKey: "rxNote", payload: { body: huge },
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "payload_too_large");
  });

  it("persists a draft and returns savedAt", async () => {
    const res = await r.call("drafts.save", { db, actor: { userId: "u1" } }, {
      lensId: "pharmacy", draftKey: "rxNote", payload: { body: "amox 500mg" },
    });
    assert.equal(res.ok, true);
    assert.ok(typeof res.savedAt === "number");

    const row = db.prepare("SELECT * FROM lens_drafts WHERE user_id = ? AND lens_id = ? AND draft_key = ?")
      .get("u1", "pharmacy", "rxNote");
    assert.ok(row);
    assert.deepEqual(JSON.parse(row.payload_json), { body: "amox 500mg" });
    assert.equal(row.schema_version, 1);
  });

  it("UPSERT: re-save by same triple replaces payload and bumps updated_at", async () => {
    const ctx = { db, actor: { userId: "u1" } };
    await r.call("drafts.save", ctx, { lensId: "pharmacy", draftKey: "rxNote", payload: { body: "v1" } });
    // Force a different timestamp.
    db.prepare("UPDATE lens_drafts SET updated_at = 1000, created_at = 1000 WHERE user_id = 'u1'").run();
    await r.call("drafts.save", ctx, { lensId: "pharmacy", draftKey: "rxNote", payload: { body: "v2" } });

    const rows = db.prepare("SELECT * FROM lens_drafts WHERE user_id = 'u1' AND lens_id = 'pharmacy' AND draft_key = 'rxNote'").all();
    assert.equal(rows.length, 1, "UNIQUE constraint should keep this at 1 row");
    assert.equal(JSON.parse(rows[0].payload_json).body, "v2");
    assert.ok(rows[0].updated_at > 1000);
    assert.equal(rows[0].created_at, 1000, "created_at preserved on UPSERT");
  });

  it("honours schemaVersion", async () => {
    const ctx = { db, actor: { userId: "u1" } };
    await r.call("drafts.save", ctx, {
      lensId: "x", draftKey: "k", payload: {}, schemaVersion: 7,
    });
    const row = db.prepare("SELECT schema_version FROM lens_drafts").get();
    assert.equal(row.schema_version, 7);
  });
});

describe("drafts.load", () => {
  let db, r;
  beforeEach(() => {
    db = setupDb();
    r = makeRegistry();
    registerDraftsMacros(r.register);
  });

  it("returns {draft:null} when no row exists (not an error)", async () => {
    const res = await r.call("drafts.load", { db, actor: { userId: "u1" } }, { lensId: "x", draftKey: "k" });
    assert.equal(res.ok, true);
    assert.equal(res.draft, null);
  });

  it("round-trips save → load", async () => {
    const ctx = { db, actor: { userId: "u1" } };
    const payload = { medications: [{ name: "amox", dose: "500mg" }], notes: "BID" };
    await r.call("drafts.save", ctx, { lensId: "pharmacy", draftKey: "rxNote", payload });
    const res = await r.call("drafts.load", ctx, { lensId: "pharmacy", draftKey: "rxNote" });
    assert.equal(res.ok, true);
    assert.deepEqual(res.draft.payload, payload);
    assert.equal(res.draft.schemaVersion, 1);
    assert.ok(typeof res.draft.updatedAt === "number");
  });

  it("scopes to caller (one user cannot read another's draft)", async () => {
    await r.call("drafts.save", { db, actor: { userId: "alice" } }, { lensId: "x", draftKey: "k", payload: { secret: "hi" } });
    const res = await r.call("drafts.load", { db, actor: { userId: "bob" } }, { lensId: "x", draftKey: "k" });
    assert.equal(res.ok, true);
    assert.equal(res.draft, null, "bob must not see alice's draft");
  });
});

describe("drafts.list_mine", () => {
  let db, r;
  beforeEach(() => {
    db = setupDb();
    r = makeRegistry();
    registerDraftsMacros(r.register);
  });

  it("returns empty list for a fresh user", async () => {
    const res = await r.call("drafts.list_mine", { db, actor: { userId: "u1" } }, {});
    assert.equal(res.ok, true);
    assert.deepEqual(res.items, []);
    assert.equal(res.total, 0);
  });

  it("orders most-recent-first across the whole fleet", async () => {
    const ctx = { db, actor: { userId: "u1" } };
    await r.call("drafts.save", ctx, { lensId: "pharmacy", draftKey: "a", payload: {} });
    // Force first row to be older.
    db.prepare("UPDATE lens_drafts SET updated_at = updated_at - 1000").run();
    await r.call("drafts.save", ctx, { lensId: "wallet", draftKey: "b", payload: {} });
    const res = await r.call("drafts.list_mine", ctx, {});
    assert.equal(res.items.length, 2);
    assert.equal(res.items[0].lensId, "wallet", "newer wallet draft first");
    assert.equal(res.items[1].lensId, "pharmacy");
    assert.equal(res.total, 2);
  });

  it("filters to one lens when lensId provided", async () => {
    const ctx = { db, actor: { userId: "u1" } };
    await r.call("drafts.save", ctx, { lensId: "pharmacy", draftKey: "a", payload: {} });
    await r.call("drafts.save", ctx, { lensId: "wallet", draftKey: "b", payload: {} });
    const res = await r.call("drafts.list_mine", ctx, { lensId: "wallet" });
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].lensId, "wallet");
    assert.equal(res.total, 1);
  });

  it("respects limit (default 20, max 100)", async () => {
    const ctx = { db, actor: { userId: "u1" } };
    for (let i = 0; i < 25; i++) {
      await r.call("drafts.save", ctx, { lensId: "x", draftKey: `k${i}`, payload: {} });
    }
    const def = await r.call("drafts.list_mine", ctx, {});
    assert.equal(def.items.length, 20);
    const cap = await r.call("drafts.list_mine", ctx, { limit: 9999 });
    assert.equal(cap.items.length, 25);
    assert.ok(cap.total === 25);
  });
});

describe("drafts.delete", () => {
  let db, r;
  beforeEach(() => {
    db = setupDb();
    r = makeRegistry();
    registerDraftsMacros(r.register);
  });

  it("is idempotent (returns ok:true even when row absent)", async () => {
    const res = await r.call("drafts.delete", { db, actor: { userId: "u1" } }, {
      lensId: "x", draftKey: "k",
    });
    assert.equal(res.ok, true);
    assert.equal(res.removed, 0);
  });

  it("removes the row and reports removed:1", async () => {
    const ctx = { db, actor: { userId: "u1" } };
    await r.call("drafts.save", ctx, { lensId: "x", draftKey: "k", payload: {} });
    const res = await r.call("drafts.delete", ctx, { lensId: "x", draftKey: "k" });
    assert.equal(res.removed, 1);
    const after = db.prepare("SELECT COUNT(*) AS n FROM lens_drafts").get();
    assert.equal(after.n, 0);
  });
});

describe("draft-gc sweep + heartbeat", () => {
  it("sweepExpiredDrafts deletes only rows older than TTL", () => {
    const db = setupDb();
    const now = 10_000_000;
    const old = now - 31 * 86400;
    const recent = now - 5 * 86400;
    db.prepare(`INSERT INTO lens_drafts (user_id,lens_id,draft_key,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run("u", "x", "old", "{}", old, old);
    db.prepare(`INSERT INTO lens_drafts (user_id,lens_id,draft_key,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run("u", "x", "recent", "{}", recent, recent);
    const res = sweepExpiredDrafts(db, { now });
    assert.equal(res.ok, true);
    assert.equal(res.removed, 1);
    assert.equal(res.ttlDays, DEFAULT_DRAFT_TTL_DAYS);
    const remaining = db.prepare("SELECT draft_key FROM lens_drafts").all().map(r => r.draft_key);
    assert.deepEqual(remaining, ["recent"]);
  });

  it("CONCORD_DRAFT_TTL_DAYS overrides the cutoff", () => {
    process.env.CONCORD_DRAFT_TTL_DAYS = "7";
    try {
      assert.equal(getDraftTtlDays(), 7);
    } finally {
      delete process.env.CONCORD_DRAFT_TTL_DAYS;
    }
  });

  it("runDraftGcCycle never throws (heartbeat contract)", async () => {
    const res1 = await runDraftGcCycle({}); // no db
    assert.equal(res1.ok, false);
    assert.equal(res1.reason, "no_db");

    const db = setupDb();
    const res2 = await runDraftGcCycle({ db });
    assert.equal(res2.ok, true);
    assert.equal(typeof res2.removed, "number");
  });

  it("CONCORD_DRAFT_GC=0 disables the heartbeat", async () => {
    process.env.CONCORD_DRAFT_GC = "0";
    try {
      const res = await runDraftGcCycle({ db: setupDb() });
      assert.equal(res.ok, false);
      assert.equal(res.reason, "disabled");
    } finally {
      delete process.env.CONCORD_DRAFT_GC;
    }
  });
});
