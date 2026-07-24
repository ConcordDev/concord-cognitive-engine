/**
 * Tier-2 contract tests for the sovereign-ruins bespoke mechanic:
 * "Still-Running Spells".
 *
 * Grounded in content/world/sovereign-ruins/{factions,npcs,meta}.json
 * (see the citation header in migration 392 and lib/sovereign-spells.js).
 *
 * Pins:
 *   - the mechanic's real effect: reading a site is gated by a genuine
 *     refusal_glyph_reading skill check against user_skills, and a
 *     successful read actually decays the site's stability
 *   - the honest failure path: no fabricated reveal on insufficient
 *     skill, no fabricated shard grant without a genuine prior read,
 *     no fabricated completion while a summons site is still stable
 *   - scoping: the mechanic never leaks to (or accepts writes tagged
 *     for) any world other than sovereign-ruins
 *   - cataloguing awards memory_shards and permanently closes the site
 *   - completing a summons site either requires stability decay or an
 *     explicit acknowledgement — never both required, never neither
 *
 * Run: node --test --test-force-exit --test-timeout=100000 server/tests/sovereign-spells.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runMigrations } from "../migrate.js";
import {
  seedSite,
  listSites,
  readSite,
  catalogueSite,
  completeSite,
  totalShardsEarned,
  SOVEREIGN_RUINS_WORLD_ID,
  SPELL_KINDS,
} from "../lib/sovereign-spells.js";

// Migration 392 assumes earlier migrations already ran (user_skills
// comes from migration 315). The established pattern in this codebase
// (see server/tests/crucible-observer-drift.test.js) is to run the FULL
// migration chain against a fresh in-memory db rather than hand-picking
// files — hand-picking broke an earlier agent's test this session with
// "no such table: player_world_state".
async function setupDb() {
  const db = new Database(":memory:");
  await runMigrations(db);
  db.prepare(`INSERT OR IGNORE INTO worlds (id, name, universe_type) VALUES (?, ?, 'sovereign_ruins')`)
    .run(SOVEREIGN_RUINS_WORLD_ID, SOVEREIGN_RUINS_WORLD_ID);
  return db;
}

function setSkill(db, userId, skillId, level) {
  db.prepare(`
    INSERT INTO user_skills (user_id, skill_id, level) VALUES (?, ?, ?)
    ON CONFLICT(user_id, skill_id) DO UPDATE SET level = excluded.level
  `).run(userId, skillId, level);
}

describe("sovereign-spells: seedSite", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); });

  it("persists a real site with default full stability + active status", () => {
    const r = seedSite(db, { district: "the_still_casting_quarter", spellKind: "binding", ageAnnums: 180, difficulty: 5 });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT * FROM sovereign_spell_sites WHERE id = ?`).get(r.siteId);
    assert.ok(row, "the site row must actually exist");
    assert.equal(row.stability, 1);
    assert.equal(row.status, "active");
    assert.equal(row.spell_kind, "binding");
  });

  it("HONEST FAILURE: rejects a bad spell_kind, never fabricating a site", () => {
    const before = db.prepare(`SELECT COUNT(*) c FROM sovereign_spell_sites`).get().c;
    const r = seedSite(db, { district: "x", spellKind: "not_a_real_kind" });
    assert.deepEqual(r, { ok: false, reason: "bad_spell_kind" });
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM sovereign_spell_sites`).get().c, before);
  });

  it("SCOPING: refuses to seed for any world other than sovereign-ruins", () => {
    const r = seedSite(db, { worldId: "concordia-hub", district: "x", spellKind: "binding" });
    assert.deepEqual(r, { ok: false, reason: "not_sovereign_ruins" });
  });

  it("SCOPING: the underlying CHECK constraint rejects a direct insert for another world", () => {
    assert.throws(() => {
      db.prepare(`
        INSERT INTO sovereign_spell_sites (id, world_id, district, spell_kind, age_annums, difficulty, stability, status, x, z)
        VALUES ('x', 'concordia-hub', 'd', 'binding', 0, 1, 1.0, 'active', 0, 0)
      `).run();
    }, /CHECK constraint failed/);
  });

  it("every declared spell kind is actually acceptable to the schema", () => {
    for (const kind of SPELL_KINDS) {
      const r = seedSite(db, { district: "d", spellKind: kind });
      assert.equal(r.ok, true, `${kind} must be a valid spell_kind`);
    }
  });
});

describe("sovereign-spells: listSites withholds the gated fields", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); });

  it("never reveals spell_kind/stability/difficulty via listing alone", () => {
    seedSite(db, { district: "the_long_summons", spellKind: "summons", ageAnnums: 187, difficulty: 8 });
    const r = listSites(db, {});
    assert.equal(r.ok, true);
    assert.equal(r.sites.length, 1);
    assert.equal(r.sites[0].spell_kind, undefined, "listing must not leak spell_kind — that's Iby's whole profession");
    assert.equal(r.sites[0].difficulty, undefined);
    assert.equal(r.sites[0].stability, undefined);
    assert.equal(r.sites[0].district, "the_long_summons");
  });
});

describe("sovereign-spells: readSite (real skill gate + honest failure)", () => {
  let db, siteId;
  beforeEach(async () => {
    db = await setupDb();
    siteId = seedSite(db, { district: "the_still_casting_quarter", spellKind: "binding", ageAnnums: 200, difficulty: 6 }).siteId;
  });

  it("HONEST FAILURE: insufficient skill never fabricates a reveal", () => {
    setSkill(db, "u1", "refusal_glyph_reading", 2);
    const r = readSite(db, { userId: "u1", siteId });
    assert.equal(r.ok, true, "the attempt itself is a real, logged event");
    assert.equal(r.revealed, false);
    assert.equal(r.reason, "insufficient_skill");
    assert.equal(r.requiredLevel, 6);
    assert.equal(r.yourLevel, 2);

    // stability must be untouched by a failed read
    const site = db.prepare(`SELECT stability FROM sovereign_spell_sites WHERE id = ?`).get(siteId);
    assert.equal(site.stability, 1);
  });

  it("REAL EFFECT: sufficient skill reveals the site's true nature and decays stability", () => {
    setSkill(db, "u1", "refusal_glyph_reading", 6);
    const r = readSite(db, { userId: "u1", siteId });
    assert.equal(r.ok, true);
    assert.equal(r.revealed, true);
    assert.equal(r.spellKind, "binding");
    assert.equal(r.ageAnnums, 200);
    assert.equal(r.stability, 0.95);

    const site = db.prepare(`SELECT stability FROM sovereign_spell_sites WHERE id = ?`).get(siteId);
    assert.equal(site.stability, 0.95, "the decay must actually persist in the DB, not just the return value");

    const log = db.prepare(`SELECT * FROM sovereign_spell_reads WHERE site_id = ? AND user_id = ?`).get(siteId, "u1");
    assert.ok(log, "a real read log row must exist");
    assert.equal(log.revealed, 1);
  });

  it("repeated reads keep decaying stability toward the completion floor", () => {
    setSkill(db, "u1", "refusal_glyph_reading", 6);
    for (let i = 0; i < 5; i++) readSite(db, { userId: "u1", siteId });
    const site = db.prepare(`SELECT stability FROM sovereign_spell_sites WHERE id = ?`).get(siteId);
    assert.ok(site.stability < 1 - 5 * 0.05 + 1e-9, "five reads must have decayed stability by roughly 5x the per-read amount");
  });

  it("HONEST FAILURE: unknown site never fabricates success", () => {
    setSkill(db, "u1", "refusal_glyph_reading", 99);
    const r = readSite(db, { userId: "u1", siteId: "not-a-real-site" });
    assert.deepEqual(r, { ok: false, reason: "site_not_found" });
  });

  it("HONEST FAILURE: no actor never silently succeeds", () => {
    const r = readSite(db, { userId: undefined, siteId });
    assert.deepEqual(r, { ok: false, reason: "no_actor" });
  });

  it("HONEST FAILURE: a catalogued site can no longer be read", () => {
    setSkill(db, "u1", "refusal_glyph_reading", 6);
    readSite(db, { userId: "u1", siteId });
    catalogueSite(db, { userId: "u1", siteId });
    const r = readSite(db, { userId: "u1", siteId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "site_not_active");
    assert.equal(r.status, "catalogued");
  });
});

describe("sovereign-spells: catalogueSite (the Archivists' goal)", () => {
  let db, siteId;
  beforeEach(async () => {
    db = await setupDb();
    siteId = seedSite(db, { district: "the_still_casting_quarter", spellKind: "curse", ageAnnums: 100, difficulty: 3 }).siteId;
  });

  it("HONEST FAILURE: cannot catalogue without a genuine prior read", () => {
    const r = catalogueSite(db, { userId: "u1", siteId });
    assert.deepEqual(r, { ok: false, reason: "not_yet_read" });
  });

  it("HONEST FAILURE: a failed (insufficient-skill) attempt does not count as having read it", () => {
    setSkill(db, "u1", "refusal_glyph_reading", 0);
    readSite(db, { userId: "u1", siteId });
    const r = catalogueSite(db, { userId: "u1", siteId });
    assert.deepEqual(r, { ok: false, reason: "not_yet_read" });
  });

  it("REAL EFFECT: awards memory_shards and permanently closes the site after a genuine read", () => {
    setSkill(db, "u1", "refusal_glyph_reading", 3);
    readSite(db, { userId: "u1", siteId });
    const r = catalogueSite(db, { userId: "u1", siteId });
    assert.equal(r.ok, true);
    assert.equal(r.status, "catalogued");
    assert.equal(r.shardsAwarded, 10 + Math.round(100 / 20)); // base + age bonus = 15

    const site = db.prepare(`SELECT status FROM sovereign_spell_sites WHERE id = ?`).get(siteId);
    assert.equal(site.status, "catalogued");
    assert.equal(totalShardsEarned(db, { userId: "u1" }), 15);
  });

  it("HONEST FAILURE: cannot catalogue an already-catalogued site twice (no double-dip reward)", () => {
    setSkill(db, "u1", "refusal_glyph_reading", 3);
    readSite(db, { userId: "u1", siteId });
    catalogueSite(db, { userId: "u1", siteId });
    const r = catalogueSite(db, { userId: "u1", siteId });
    assert.deepEqual(r, { ok: false, reason: "already_catalogued" });
    assert.equal(totalShardsEarned(db, { userId: "u1" }), 15, "reward must not double-count");
  });

  it("SCOPING: honest failure for a non-sovereign-ruins world", () => {
    const r = catalogueSite(db, { worldId: "concordia-hub", userId: "u1", siteId });
    assert.deepEqual(r, { ok: false, reason: "not_sovereign_ruins" });
  });
});

describe("sovereign-spells: completeSite (the Long Summons mechanic)", () => {
  let db, siteId;
  beforeEach(async () => {
    db = await setupDb();
    siteId = seedSite(db, { district: "the_long_summons", spellKind: "summons", ageAnnums: 187, difficulty: 1 }).siteId;
    setSkill(db, "u1", "refusal_glyph_reading", 5);
    readSite(db, { userId: "u1", siteId }); // stability now 0.95, and the read precondition is satisfied
  });

  it("HONEST FAILURE: a still-stable summons cannot be completed without acknowledgement", () => {
    const r = completeSite(db, { userId: "u1", siteId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "still_stable");
    assert.equal(r.stability, 0.95);
  });

  it("REAL EFFECT: explicit acknowledgement completes it immediately per the lore's own mechanic", () => {
    const r = completeSite(db, { userId: "u1", siteId, acknowledgeRecipientDead: true });
    assert.equal(r.ok, true);
    assert.equal(r.status, "dissipated");
    assert.equal(r.acceleratedByAcknowledgement, true);
    assert.equal(r.shardsAwarded, 20 + Math.round(187 / 10)); // 20 + 19 = 39

    const site = db.prepare(`SELECT status, stability, dissipated_at FROM sovereign_spell_sites WHERE id = ?`).get(siteId);
    assert.equal(site.status, "dissipated");
    assert.equal(site.stability, 0);
    assert.ok(site.dissipated_at, "dissipated_at must actually be stamped");
  });

  it("REAL EFFECT: repeated observation alone can decay stability under the floor without acknowledgement", () => {
    // stability starts at 0.95 after the beforeEach read; needs to drop
    // to <= 0.15, i.e. 17 more reads at 0.05 decay each.
    for (let i = 0; i < 17; i++) readSite(db, { userId: "u1", siteId });
    const r = completeSite(db, { userId: "u1", siteId });
    assert.equal(r.ok, true);
    assert.equal(r.acceleratedByAcknowledgement, false);
  });

  it("HONEST FAILURE: non-summons sites can never be completed this way", () => {
    const bindingId = seedSite(db, { district: "d", spellKind: "binding", difficulty: 1 }).siteId;
    readSite(db, { userId: "u1", siteId: bindingId });
    const r = completeSite(db, { userId: "u1", siteId: bindingId, acknowledgeRecipientDead: true });
    assert.deepEqual(r, { ok: false, reason: "not_a_summons" });
  });

  it("HONEST FAILURE: cannot complete without having read it first", () => {
    const freshId = seedSite(db, { district: "d", spellKind: "summons", difficulty: 1 }).siteId;
    const r = completeSite(db, { userId: "u2", siteId: freshId, acknowledgeRecipientDead: true });
    assert.deepEqual(r, { ok: false, reason: "not_yet_read" });
  });

  it("HONEST FAILURE: a dissipated site cannot be completed twice", () => {
    completeSite(db, { userId: "u1", siteId, acknowledgeRecipientDead: true });
    const r = completeSite(db, { userId: "u1", siteId, acknowledgeRecipientDead: true });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "site_not_active");
    assert.equal(r.status, "dissipated");
  });
});

describe("sovereign-spells: totalShardsEarned", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); });

  it("reports zero honestly before anything has been earned", () => {
    assert.equal(totalShardsEarned(db, { userId: "nobody" }), 0);
  });

  it("accumulates across multiple sites and actions for the same user", () => {
    setSkill(db, "u1", "refusal_glyph_reading", 5);
    const s1 = seedSite(db, { district: "d1", spellKind: "blessing", ageAnnums: 40, difficulty: 1 }).siteId;
    const s2 = seedSite(db, { district: "d2", spellKind: "curse", ageAnnums: 60, difficulty: 1 }).siteId;
    readSite(db, { userId: "u1", siteId: s1 });
    readSite(db, { userId: "u1", siteId: s2 });
    const r1 = catalogueSite(db, { userId: "u1", siteId: s1 }); // 10 + 2 = 12
    const r2 = catalogueSite(db, { userId: "u1", siteId: s2 }); // 10 + 3 = 13
    assert.equal(totalShardsEarned(db, { userId: "u1" }), r1.shardsAwarded + r2.shardsAwarded);
  });
});
