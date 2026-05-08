/**
 * Tier-2 contract tests for Phase 1.5 — Knowledge Trade.
 *
 * Three flows under test:
 *   1. NPC marketplace participation (listings + intra-NPC purchases)
 *   2. Mentorship — NPC teaches player + session cap at mentor depth - 1
 *   3. Demonstration — player teaches NPC; bias propagates to next revision
 *
 * Run: node --test tests/knowledge-trade.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  listNpcRecipesPass,
  intraNpcPurchasePass,
  _internal as marketInternal,
} from "../lib/npc-marketplace.js";
import {
  requestMentorship,
  completeMentorshipSession,
  recordDemonstration,
  consumeDemonstrationsForNpc,
  listMentorshipsForStudent,
} from "../lib/mentorship.js";
import { runNpcMarketplaceCycle } from "../emergent/npc-marketplace-cycle.js";

// ── In-memory fake DB harness ────────────────────────────────────────────────

function makeFakeDb() {
  const tables = {
    dtus: new Map(),
    world_npcs: new Map(),
    mentorships: new Map(),
    npc_skill_acquisitions: new Map(),
    skill_demonstration_log: new Map(),
    marketplace_listings: new Map(),
    skill_revisions: new Map(),
    skill_evolution_unlocks: new Map(),
  };

  function prepare(sql) {
    const trimmed = sql.replace(/\s+/g, " ").trim();
    return {
      run: (...a) => runStmt(trimmed, a),
      get: (...a) => getStmt(trimmed, a),
      all: (...a) => allStmt(trimmed, a),
    };
  }
  function transaction(fn) { return (...args) => fn(...args); }

  function runStmt(sql, args) {
    if (sql.startsWith("INSERT INTO mentorships")) {
      // mentor_kind='npc' and student_kind='player' are SQL literals in
      // the production query — not bind params. Map by position: the 7
      // bound args are (id, mentorId, studentId, recipeId, sessionsTotal,
      // sessionsRemaining, price).
      const [id, mentorId, studentId, recipeId, sessionsTotal, sessionsRemaining, pricePaid] = args;
      tables.mentorships.set(id, {
        id, mentor_kind: "npc", mentor_id: mentorId,
        student_kind: "player", student_id: studentId,
        recipe_dtu_id: recipeId, sessions_total: sessionsTotal,
        sessions_remaining: sessionsRemaining, price_paid: pricePaid,
        status: "active", started_at: Math.floor(Date.now() / 1000),
        completed_at: null,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE world_npcs SET wealth_sparks = wealth_sparks - ?")) {
      const [amount, id] = args;
      const n = tables.world_npcs.get(id);
      if (n) n.wealth_sparks = (n.wealth_sparks || 0) - amount;
      return { changes: n ? 1 : 0 };
    }
    if (sql.startsWith("UPDATE world_npcs SET wealth_sparks = wealth_sparks + ?")) {
      const [amount, id] = args;
      const n = tables.world_npcs.get(id);
      if (n) n.wealth_sparks = (n.wealth_sparks || 0) + amount;
      return { changes: n ? 1 : 0 };
    }
    if (sql.startsWith("UPDATE world_npcs SET wealth_sparks = COALESCE(wealth_sparks, 0) + ?")) {
      const [amount, id] = args;
      const n = tables.world_npcs.get(id);
      if (n) n.wealth_sparks = (n.wealth_sparks || 0) + amount;
      return { changes: n ? 1 : 0 };
    }
    if (sql.startsWith("INSERT INTO npc_skill_acquisitions")) {
      const [id, buyer, seller, recipeId, price] = args;
      tables.npc_skill_acquisitions.set(id, { id, buyer_npc_id: buyer, seller_npc_id: seller, recipe_dtu_id: recipeId, price });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO marketplace_listings")) {
      const [id, artifactId, sellerId, price] = args;
      tables.marketplace_listings.set(id, { id, artifact_id: artifactId, seller_id: sellerId, price, status: "active" });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO skill_demonstration_log")) {
      const [id, witnessedNpcId, casterUserId, casterNpcId, recipeId, revisionNum, element, worldId] = args;
      tables.skill_demonstration_log.set(id, {
        id, witnessed_npc_id: witnessedNpcId, caster_user_id: casterUserId, caster_npc_id: casterNpcId,
        recipe_dtu_id: recipeId, revision_num: revisionNum, element, world_id: worldId,
        consumed_at: null, witnessed_at: Math.floor(Date.now() / 1000),
      });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE skill_demonstration_log SET consumed_at")) {
      const ids = args;
      let n = 0;
      for (const id of ids) {
        const r = tables.skill_demonstration_log.get(id);
        if (r) { r.consumed_at = Math.floor(Date.now() / 1000); n++; }
      }
      return { changes: n };
    }
    if (sql.startsWith("INSERT INTO dtus")) {
      const [id, kind, title, creatorId, metaJson, skillLevel, totalExp] = args;
      tables.dtus.set(id, { id, kind, title, creator_id: creatorId, meta_json: metaJson, skill_level: skillLevel, total_experience: totalExp });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE mentorships")) {
      // Decrement sessions_remaining; mark completed if zero.
      const [id] = args;
      const m = tables.mentorships.get(id);
      if (m) {
        m.sessions_remaining = (m.sessions_remaining || 1) - 1;
        if (m.sessions_remaining <= 0) {
          m.status = "completed";
          m.completed_at = Math.floor(Date.now() / 1000);
        }
      }
      return { changes: m ? 1 : 0 };
    }
    if (sql.startsWith("INSERT INTO skill_revisions")) {
      const id = args[0];
      tables.skill_revisions.set(id, { id, recipe_dtu_id: args[1], status: "applied", revision_num: args[2] });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE dtus SET meta_json")) {
      const [meta, id] = args;
      const r = tables.dtus.get(id);
      if (r) r.meta_json = meta;
      return { changes: r ? 1 : 0 };
    }
    if (sql.startsWith("UPDATE skill_evolution_unlocks SET completed_at")) {
      return { changes: 0 };
    }
    return { changes: 0 };
  }

  function getStmt(sql, args) {
    if (sql.startsWith("SELECT * FROM dtus WHERE id = ?")) {
      return tables.dtus.get(args[0]) || null;
    }
    if (sql.startsWith("SELECT id FROM marketplace_listings")) {
      const [recipeId] = args;
      for (const r of tables.marketplace_listings.values()) {
        if (r.artifact_id === recipeId && r.status === "active") return { id: r.id };
      }
      return null;
    }
    if (sql.startsWith("SELECT id FROM mentorships")) {
      const [mentorId, studentId, recipeId] = args;
      for (const m of tables.mentorships.values()) {
        if (m.mentor_id === mentorId && m.student_id === studentId
            && m.recipe_dtu_id === recipeId && m.status === "active") return { id: m.id };
      }
      return null;
    }
    if (sql.startsWith("SELECT * FROM mentorships WHERE id = ?")) {
      const m = tables.mentorships.get(args[0]);
      return m && m.status === "active" ? m : null;
    }
    if (sql.startsWith("SELECT wealth_sparks FROM world_npcs WHERE id = ?")) {
      const n = tables.world_npcs.get(args[0]);
      return n ? { wealth_sparks: n.wealth_sparks || 0 } : null;
    }
    return null;
  }

  function allStmt(sql, args) {
    if (sql.startsWith("SELECT d.id AS recipe_id, d.creator_id AS npc_id, d.title, d.skill_level, d.meta_json, n.archetype, n.faction, n.level AS npc_level, n.wealth_sparks FROM dtus d JOIN world_npcs n ON n.id = d.creator_id")) {
      const minLevel = args[0];
      const out = [];
      for (const d of tables.dtus.values()) {
        const n = tables.world_npcs.get(d.creator_id);
        if (!n) continue;
        if ((n.level || 1) < minLevel) continue;
        if (n.is_dead) continue;
        if (!(d.meta_json || "").includes('"author_kind":"npc"')) continue;
        out.push({ ...d, recipe_id: d.id, npc_id: d.creator_id, npc_level: n.level, archetype: n.archetype, faction: n.faction, wealth_sparks: n.wealth_sparks });
      }
      return out;
    }
    if (sql.startsWith("SELECT id, archetype, faction, level, wealth_sparks FROM world_npcs")) {
      const [minLevel, minWealth] = args;
      const out = [];
      for (const n of tables.world_npcs.values()) {
        if ((n.level || 1) < minLevel) continue;
        if ((n.wealth_sparks || 0) <= minWealth) continue;
        if (n.is_dead) continue;
        out.push(n);
      }
      out.sort((a, b) => (b.wealth_sparks || 0) - (a.wealth_sparks || 0));
      return out;
    }
    if (sql.startsWith("SELECT d.id AS recipe_id, d.creator_id AS seller_id, d.meta_json, n.faction AS seller_faction FROM dtus d")) {
      const [buyerId, buyerFaction] = args;
      const out = [];
      for (const d of tables.dtus.values()) {
        if (d.creator_id === buyerId) continue;
        const n = tables.world_npcs.get(d.creator_id);
        if (!n) continue;
        if ((n.faction || "") === (buyerFaction || "")) continue;
        if (!(d.meta_json || "").includes('"author_kind":"npc"')) continue;
        out.push({ recipe_id: d.id, seller_id: d.creator_id, meta_json: d.meta_json, seller_faction: n.faction });
      }
      return out;
    }
    if (sql.startsWith("SELECT id, recipe_dtu_id, revision_num, element, caster_user_id, caster_npc_id, witnessed_at FROM skill_demonstration_log")) {
      const [npcId] = args;
      return Array.from(tables.skill_demonstration_log.values())
        .filter(r => r.witnessed_npc_id === npcId && r.consumed_at == null)
        .sort((a, b) => b.witnessed_at - a.witnessed_at)
        .slice(0, 5);
    }
    if (sql.startsWith("SELECT * FROM mentorships WHERE student_kind = ?")) {
      const [kind, id] = args;
      return Array.from(tables.mentorships.values())
        .filter(m => m.student_kind === kind && m.student_id === id);
    }
    if (sql.startsWith("SELECT * FROM mentorships WHERE mentor_kind = ?")) {
      const [kind, id] = args;
      return Array.from(tables.mentorships.values())
        .filter(m => m.mentor_kind === kind && m.mentor_id === id);
    }
    return [];
  }

  return { prepare, transaction, _tables: tables };
}

function makeNpcRecipe(db, opts = {}) {
  const npcId = opts.npcId || "npc:k1";
  const recipeId = opts.recipeId || `npcskill:${npcId}:rev`;
  const archetype = opts.archetype || "warrior";
  const faction = opts.faction ?? "pinewood_coalition";
  const meta = {
    author_kind: "npc",
    skill_kind: opts.skillKind || "fighting_style",
    element: opts.element || "water",
    name: opts.name || "kael_water_strike",
    current_name: opts.currentName || opts.name || "kael_water_strike",
    revision_num: opts.revisionNum ?? 5,
    revision_history: opts.history || [{ revision_num: 1, name_after: "kael_water_strike_tide" }],
    max_damage: opts.maxDamage || 35,
    range_m: 3,
    costs: { stamina: 4, mana: 0, cooldown_s: 6 },
  };
  db._tables.world_npcs.set(npcId, {
    id: npcId, name: opts.npcName || "Kael Torchlight",
    archetype, faction, level: opts.npcLevel || 50,
    wealth_sparks: opts.wealthSparks ?? 500, is_dead: 0,
  });
  db._tables.dtus.set(recipeId, {
    id: recipeId, kind: "fighting_style_recipe", title: meta.name, creator_id: npcId,
    meta_json: JSON.stringify(meta), skill_level: opts.skillLevel || 50, total_experience: 0,
  });
  return { recipeId, npcId };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("listNpcRecipesPass", () => {
  it("lists recipes with revision_num ≥ 3", () => {
    const db = makeFakeDb();
    makeNpcRecipe(db, { revisionNum: 5 });
    const r = listNpcRecipesPass(db);
    assert.equal(r.ok, true);
    assert.equal(r.listed, 1);
  });

  it("skips recipes with revision_num < 3", () => {
    const db = makeFakeDb();
    makeNpcRecipe(db, { revisionNum: 2 });
    const r = listNpcRecipesPass(db);
    assert.equal(r.listed, 0);
  });

  it("skips listing twice for the same recipe", () => {
    const db = makeFakeDb();
    makeNpcRecipe(db, { revisionNum: 5 });
    listNpcRecipesPass(db);
    const r = listNpcRecipesPass(db);
    assert.equal(r.listed, 0);
  });

  it("price scales with revision_num (1.10^n)", () => {
    assert.equal(marketInternal.priceForRecipe(0), 50);
    assert.equal(marketInternal.priceForRecipe(5), Math.round(50 * Math.pow(1.10, 5)));
    assert.ok(marketInternal.priceForRecipe(10) > marketInternal.priceForRecipe(5));
  });
});

describe("intraNpcPurchasePass", () => {
  it("warrior NPC buys spell from a different faction's NPC", () => {
    const db = makeFakeDb();
    makeNpcRecipe(db, { npcId: "npc:warrior", archetype: "warrior", faction: "pinewood", wealthSparks: 1000, recipeId: "wr1", revisionNum: 2 });
    makeNpcRecipe(db, { npcId: "npc:mystic", archetype: "mystic", faction: "ember_keepers", recipeId: "ms1", revisionNum: 2, skillKind: "spell" });
    const r = intraNpcPurchasePass(db);
    assert.ok(r.purchased >= 1, `expected at least 1 purchase, got ${r.purchased}`);
    const buyerWealth = db._tables.world_npcs.get("npc:warrior").wealth_sparks;
    assert.ok(buyerWealth < 1000, "buyer wealth should have decreased");
    const sellerWealth = db._tables.world_npcs.get("npc:mystic").wealth_sparks;
    assert.ok(sellerWealth > 500, "seller wealth should have increased");
  });

  it("does not buy from same-faction NPCs", () => {
    const db = makeFakeDb();
    makeNpcRecipe(db, { npcId: "npc:warrior", archetype: "warrior", faction: "pinewood", wealthSparks: 1000, recipeId: "wr1", revisionNum: 2 });
    makeNpcRecipe(db, { npcId: "npc:mystic", archetype: "mystic", faction: "pinewood", recipeId: "ms1", revisionNum: 2, skillKind: "spell" });
    const r = intraNpcPurchasePass(db);
    assert.equal(r.purchased, 0);
  });

  it("respects budget cap (recipe price > buyer.wealth/4)", () => {
    const db = makeFakeDb();
    makeNpcRecipe(db, { npcId: "npc:warrior", archetype: "warrior", faction: "pinewood", wealthSparks: 200, recipeId: "wr1", revisionNum: 2 });
    // Recipe at revision 50 will price way above 200/4 = 50 budget.
    makeNpcRecipe(db, { npcId: "npc:mystic", archetype: "mystic", faction: "ember_keepers", recipeId: "ms1", revisionNum: 50, skillKind: "spell" });
    const r = intraNpcPurchasePass(db);
    assert.equal(r.purchased, 0);
  });
});

describe("requestMentorship + completeMentorshipSession", () => {
  it("creates a mentorship row + charges price proportional to depth", () => {
    const db = makeFakeDb();
    makeNpcRecipe(db, { npcId: "npc:mentor", revisionNum: 10, recipeId: "rcp:teach" });
    const r = requestMentorship(db, {
      mentorNpcId: "npc:mentor",
      studentUserId: "user:alice",
      recipeDtuId: "rcp:teach",
    });
    assert.equal(r.ok, true);
    assert.ok(r.mentorshipId);
    assert.ok(r.price > 25, "price should reflect mentor depth");
    assert.equal(r.sessionsRemaining, 3);
    // NPC wealth should have grown by the price.
    assert.equal(db._tables.world_npcs.get("npc:mentor").wealth_sparks, 500 + r.price);
  });

  it("caps student depth at mentor depth - 1", () => {
    const db = makeFakeDb();
    makeNpcRecipe(db, { npcId: "npc:mentor", revisionNum: 2, recipeId: "rcp:short" });
    const r = requestMentorship(db, {
      mentorNpcId: "npc:mentor", studentUserId: "user:b", recipeDtuId: "rcp:short",
    });
    assert.equal(r.ok, true);
    // Session 1 should work (cap = 1)
    const s1 = completeMentorshipSession(db, { mentorshipId: r.mentorshipId });
    assert.equal(s1.ok, true);
    // Session 2 — student now at depth 1 = cap, should reject
    const s2 = completeMentorshipSession(db, { mentorshipId: r.mentorshipId, studentRecipeId: s1.studentRecipeId });
    assert.equal(s2.ok, false);
    assert.equal(s2.reason, "student_at_cap");
  });

  it("rejects mentorship request with depth < 1", () => {
    const db = makeFakeDb();
    makeNpcRecipe(db, { npcId: "npc:novice", revisionNum: 0, recipeId: "rcp:novice" });
    const r = requestMentorship(db, {
      mentorNpcId: "npc:novice", studentUserId: "user:c", recipeDtuId: "rcp:novice",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "mentor_depth_insufficient");
  });

  it("rejects duplicate active mentorship", () => {
    const db = makeFakeDb();
    makeNpcRecipe(db, { npcId: "npc:mentor", revisionNum: 5, recipeId: "rcp:dup" });
    requestMentorship(db, { mentorNpcId: "npc:mentor", studentUserId: "user:d", recipeDtuId: "rcp:dup" });
    const r2 = requestMentorship(db, { mentorNpcId: "npc:mentor", studentUserId: "user:d", recipeDtuId: "rcp:dup" });
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, "already_active");
  });
});

describe("recordDemonstration + consumeDemonstrationsForNpc", () => {
  it("records a demonstration row + consume marks it consumed", () => {
    const db = makeFakeDb();
    const r1 = recordDemonstration(db, {
      witnessedNpcId: "npc:k1", casterUserId: "user:a",
      recipeDtuId: "rcp:demo", revisionNum: 3, element: "water", worldId: "concordia-hub",
    });
    assert.equal(r1.ok, true);

    const consumed = consumeDemonstrationsForNpc(db, "npc:k1");
    assert.equal(consumed.length, 1);
    assert.equal(consumed[0].revision_num, 3);
    // Second consume returns nothing (already marked).
    const second = consumeDemonstrationsForNpc(db, "npc:k1");
    assert.equal(second.length, 0);
  });

  it("never throws on missing inputs", () => {
    const db = makeFakeDb();
    const r1 = recordDemonstration(db, {});
    assert.equal(r1.ok, false);
    const r2 = consumeDemonstrationsForNpc(db, null);
    assert.deepEqual(r2, []);
  });
});

describe("npc-marketplace-cycle heartbeat", () => {
  it("returns ok:false reason 'no_db' with no DB", async () => {
    const r = await runNpcMarketplaceCycle({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("respects CONCORD_KNOWLEDGE_TRADE=0", async () => {
    const prev = process.env.CONCORD_KNOWLEDGE_TRADE;
    process.env.CONCORD_KNOWLEDGE_TRADE = "0";
    try {
      const r = await runNpcMarketplaceCycle({ db: makeFakeDb() });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "disabled");
    } finally {
      if (prev === undefined) delete process.env.CONCORD_KNOWLEDGE_TRADE;
      else process.env.CONCORD_KNOWLEDGE_TRADE = prev;
    }
  });

  it("returns ok with listing + purchase counts", async () => {
    const db = makeFakeDb();
    makeNpcRecipe(db, { npcId: "npc:s1", archetype: "warrior", faction: "pinewood", revisionNum: 5, recipeId: "rcps1" });
    makeNpcRecipe(db, { npcId: "npc:s2", archetype: "mystic", faction: "ember_keepers", revisionNum: 5, recipeId: "rcps2", skillKind: "spell", wealthSparks: 1000 });
    const r = await runNpcMarketplaceCycle({ db });
    assert.equal(r.ok, true);
    assert.ok(r.listed >= 1);
  });
});

describe("listMentorshipsForStudent", () => {
  it("returns student's own mentorship rows", () => {
    const db = makeFakeDb();
    makeNpcRecipe(db, { npcId: "npc:m", revisionNum: 5, recipeId: "rcp:m" });
    requestMentorship(db, { mentorNpcId: "npc:m", studentUserId: "user:e", recipeDtuId: "rcp:m" });
    const list = listMentorshipsForStudent(db, "player", "user:e");
    assert.equal(list.length, 1);
    assert.equal(list[0].mentor_id, "npc:m");
  });
});
