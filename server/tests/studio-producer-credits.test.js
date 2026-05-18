// Tier-2 contract test — Studio Sprint B #11: producer credits.
//
// Mocks the DB but exercises real validation logic in the macros.
// Also verifies migration 204 creates the expected table shape via
// a real better-sqlite3 in-memory DB so the migration is exercised.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerStudioCreditMacros from "../domains/studio-credits.js";
import { up as up204 } from "../migrations/204_producer_credits.js";

let Database;
try {
  Database = (await import("better-sqlite3")).default;
} catch { /* better-sqlite3 optional; skip migration check */ }

function makeFakeDb({ withCreditsTable = true } = {}) {
  const dtus = new Map();
  const credits = new Map();
  return {
    prepare(sql) {
      const s = sql.replace(/\s+/g, " ").trim();
      return {
        run: (...args) => {
          if (s.startsWith("INSERT INTO dtus")) {
            const [id, title, creator, meta] = args;
            dtus.set(id, { id, creator_id: creator, title, meta_json: meta });
            return { changes: 1 };
          }
          if (s.startsWith("INSERT INTO producer_credits")) {
            if (!withCreditsTable) {
              const e = new Error("no such table: producer_credits");
              throw e;
            }
            const [id, prodId, prodUserId, role, skill, ratio, cc, notes] = args;
            const key = `${prodId}::${prodUserId}::${role}`;
            if ([...credits.values()].find(c =>
              c.production_dtu_id === prodId &&
              c.producer_user_id === prodUserId &&
              c.role === role,
            )) {
              const e = new Error("UNIQUE constraint failed: producer_credits.production_dtu_id");
              throw e;
            }
            credits.set(key, {
              id, production_dtu_id: prodId, producer_user_id: prodUserId, role,
              skill_level_at_credit: skill, contribution_ratio: ratio,
              cc_payment_at_credit: cc, notes,
              created_at: Math.floor(Date.now() / 1000),
            });
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
          if (s.includes("FROM producer_credits") && s.includes("production_dtu_id = ?")) {
            const [trackId] = args;
            return [...credits.values()].filter(c => c.production_dtu_id === trackId);
          }
          if (s.includes("FROM producer_credits") && s.includes("producer_user_id = ?")) {
            const [userId] = args;
            return [...credits.values()].filter(c => c.producer_user_id === userId);
          }
          return [];
        },
      };
    },
    _tables: { dtus, credits },
    _addTrack(id, creator) {
      dtus.set(id, { id, creator_id: creator });
    },
  };
}

function makeRegistry() {
  const macros = new Map();
  registerStudioCreditMacros((domain, name, handler, opts) => {
    macros.set(`${domain}.${name}`, { handler, opts });
  });
  return macros;
}

describe("studio.credit_producer", () => {
  it("requires actor", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.credit_producer").handler({ db: makeFakeDb() }, {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_actor");
  });

  it("requires both ids", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.credit_producer").handler(
      { db: makeFakeDb(), actor: { userId: "u1" } },
      { role: "mixer", contribution_ratio: 0.2 },
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "missing_ids");
  });

  it("rejects unknown roles", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    db._addTrack("trk_1", "u_owner");
    const out = await macros.get("studio.credit_producer").handler(
      { db, actor: { userId: "u_owner" } },
      { track_dtuId: "trk_1", producer_user_id: "u_helper", role: "intern", contribution_ratio: 0.1 },
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "invalid_role");
  });

  it("rejects self-credit", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    db._addTrack("trk_1", "u_owner");
    const out = await macros.get("studio.credit_producer").handler(
      { db, actor: { userId: "u_owner" } },
      { track_dtuId: "trk_1", producer_user_id: "u_owner", role: "mixer", contribution_ratio: 0.5 },
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "cannot_self_credit");
  });

  it("rejects non-owner credits", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    db._addTrack("trk_1", "u_owner");
    const out = await macros.get("studio.credit_producer").handler(
      { db, actor: { userId: "u_stranger" } },
      { track_dtuId: "trk_1", producer_user_id: "u_helper", role: "mixer", contribution_ratio: 0.3 },
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "not_track_owner");
  });

  it("rejects missing track", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.credit_producer").handler(
      { db: makeFakeDb(), actor: { userId: "u1" } },
      { track_dtuId: "missing", producer_user_id: "u2", role: "mixer", contribution_ratio: 0.5 },
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "track_not_found");
  });

  it("clamps contribution_ratio into (0, 1]", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    db._addTrack("trk_1", "u_owner");
    const huge = await macros.get("studio.credit_producer").handler(
      { db, actor: { userId: "u_owner" } },
      { track_dtuId: "trk_1", producer_user_id: "u_h1", role: "mixer", contribution_ratio: 99 },
    );
    assert.equal(huge.ok, true);
    assert.equal(huge.credit.contribution_ratio, 1);
    // Negatives are clamped to the positive minimum (0.0001) so the
    // call goes through with a tiny share rather than being rejected
    // outright. This protects credits from silent loss when the
    // sender passes a malformed slider value.
    const neg = await macros.get("studio.credit_producer").handler(
      { db, actor: { userId: "u_owner" } },
      { track_dtuId: "trk_1", producer_user_id: "u_h2", role: "arranger", contribution_ratio: -5 },
    );
    assert.equal(neg.ok, true);
    assert.ok(neg.credit.contribution_ratio > 0 && neg.credit.contribution_ratio < 0.01);
  });

  it("writes credit row when valid", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    db._addTrack("trk_1", "u_owner");
    const out = await macros.get("studio.credit_producer").handler(
      { db, actor: { userId: "u_owner" } },
      {
        track_dtuId: "trk_1", producer_user_id: "u_mixer",
        role: "mixer", contribution_ratio: 0.3,
        skill_level_at_credit: 7, cc_payment_at_credit: 25,
        notes: "Brought the kick forward",
      },
    );
    assert.equal(out.ok, true);
    assert.equal(out.credit.role, "mixer");
    assert.equal(out.credit.skill_level_at_credit, 7);
    assert.equal(db._tables.credits.size, 1);
  });

  it("rejects duplicate (track, producer, role) credit", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    db._addTrack("trk_1", "u_owner");
    await macros.get("studio.credit_producer").handler(
      { db, actor: { userId: "u_owner" } },
      { track_dtuId: "trk_1", producer_user_id: "u_m", role: "mixer", contribution_ratio: 0.3 },
    );
    const dup = await macros.get("studio.credit_producer").handler(
      { db, actor: { userId: "u_owner" } },
      { track_dtuId: "trk_1", producer_user_id: "u_m", role: "mixer", contribution_ratio: 0.4 },
    );
    assert.equal(dup.ok, false);
    assert.equal(dup.reason, "duplicate_credit");
  });

  it("returns credits_table_missing when migration 204 hasn't run", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb({ withCreditsTable: false });
    db._addTrack("trk_1", "u_owner");
    const out = await macros.get("studio.credit_producer").handler(
      { db, actor: { userId: "u_owner" } },
      { track_dtuId: "trk_1", producer_user_id: "u_h", role: "mixer", contribution_ratio: 0.3 },
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "credits_table_missing");
  });
});

describe("studio.list_credits", () => {
  it("requires either track or producer id", async () => {
    const macros = makeRegistry();
    const out = await macros.get("studio.list_credits").handler({ db: makeFakeDb() }, {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, "track_dtuId_or_producer_required");
  });

  it("lists by track DTU", async () => {
    const macros = makeRegistry();
    const db = makeFakeDb();
    db._addTrack("trk_1", "u_owner");
    await macros.get("studio.credit_producer").handler(
      { db, actor: { userId: "u_owner" } },
      { track_dtuId: "trk_1", producer_user_id: "u_a", role: "mixer", contribution_ratio: 0.3 },
    );
    await macros.get("studio.credit_producer").handler(
      { db, actor: { userId: "u_owner" } },
      { track_dtuId: "trk_1", producer_user_id: "u_b", role: "mastering", contribution_ratio: 0.1 },
    );
    const out = await macros.get("studio.list_credits").handler(
      { db }, { track_dtuId: "trk_1" },
    );
    assert.equal(out.ok, true);
    assert.equal(out.credits.length, 2);
  });
});

if (Database) {
  describe("migration 204 — producer_credits table shape", () => {
    it("creates the table with the expected columns + indexes", () => {
      const db = new Database(":memory:");
      up204(db);
      const cols = db.prepare("PRAGMA table_info(producer_credits)").all().map(r => r.name).sort();
      for (const required of [
        "id", "production_dtu_id", "producer_user_id", "role",
        "skill_level_at_credit", "contribution_ratio", "cc_payment_at_credit",
        "notes", "created_at",
      ]) {
        assert.ok(cols.includes(required), `missing column ${required}`);
      }
      const idx = db.prepare("PRAGMA index_list(producer_credits)").all().map(r => r.name);
      assert.ok(idx.includes("idx_producer_credits_dtu"));
      assert.ok(idx.includes("idx_producer_credits_user"));
    });

    it("CHECK contribution_ratio rejects 0 and >1", () => {
      const db = new Database(":memory:");
      up204(db);
      assert.throws(() => {
        db.prepare(`INSERT INTO producer_credits
          (id, production_dtu_id, producer_user_id, role, contribution_ratio)
          VALUES ('p1','t1','u1','mixer',0)`).run();
      });
      assert.throws(() => {
        db.prepare(`INSERT INTO producer_credits
          (id, production_dtu_id, producer_user_id, role, contribution_ratio)
          VALUES ('p2','t2','u2','mixer',1.5)`).run();
      });
    });

    it("UNIQUE rejects duplicate (track, producer, role)", () => {
      const db = new Database(":memory:");
      up204(db);
      db.prepare(`INSERT INTO producer_credits
        (id, production_dtu_id, producer_user_id, role, contribution_ratio)
        VALUES ('p1','t1','u1','mixer',0.3)`).run();
      assert.throws(() => {
        db.prepare(`INSERT INTO producer_credits
          (id, production_dtu_id, producer_user_id, role, contribution_ratio)
          VALUES ('p2','t1','u1','mixer',0.4)`).run();
      });
    });
  });
}
