// Slice-of-Life SL1 — daily-living verbs. Pins: each verb raises courtship
// affinity AND records the NPC's opinion of the player (feeds the consequence
// engine), the cooldown gates a rapid re-fire, and the macro kill-switch off →
// disabled. The webtoon "everyday" beat, routed through the existing engine.
//
// Run: node --test tests/daily-life.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { performDailyVerb, getCooldown } from "../lib/social/daily-life.js";
import registerDailyLifeMacros from "../domains/daily-life.js";

function mkUser(db, id) {
  db.prepare(`INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,'x',?)`)
    .run(id, id, `${id}@t.local`, new Date().toISOString());
}
function mkNpc(db, id) {
  db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, is_dead) VALUES (?,?,?,0)`).run(id, "concordia-hub", "trader");
}

describe("daily-life verbs", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); mkUser(db, "u1"); mkNpc(db, "npc1"); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("hang_out raises affinity AND records the NPC's opinion of the player", () => {
    const r = performDailyVerb(db, { userId: "u1", verb: "hang_out", partnerKind: "npc", partnerId: "npc1" });
    assert.equal(r.ok, true);
    assert.ok(r.affinity > 0);           // courtship affinity moved
    assert.equal(r.opinion, 3);          // opinion delta applied
    // it actually wrote to character_opinions (the consequence engine)
    const op = db.prepare(`SELECT score FROM character_opinions WHERE npc_id='npc1' AND target_kind='player' AND target_id='u1'`).get();
    assert.ok(op && op.score > 0);
    assert.ok(r.vignette && r.vignette.length > 0);
  });

  it("the cooldown gates a rapid re-fire", () => {
    performDailyVerb(db, { userId: "u1", verb: "hang_out", partnerId: "npc1" });
    const cd = getCooldown(db, "u1", "hang_out", "npc", "npc1");
    assert.ok(cd > 0);
    const again = performDailyVerb(db, { userId: "u1", verb: "hang_out", partnerId: "npc1" });
    assert.equal(again.ok, false);
    assert.equal(again.reason, "on_cooldown");
  });

  it("different verbs have independent cooldowns + each feeds opinion", () => {
    assert.equal(performDailyVerb(db, { userId: "u1", verb: "hang_out", partnerId: "npc1" }).ok, true);
    assert.equal(performDailyVerb(db, { userId: "u1", verb: "share_meal", partnerId: "npc1" }).ok, true);
    const op = db.prepare(`SELECT score FROM character_opinions WHERE npc_id='npc1' AND target_id='u1'`).get();
    assert.ok(op.score >= 7); // +3 hang_out + +4 share_meal
  });

  it("rejects an unknown verb + missing inputs", () => {
    assert.equal(performDailyVerb(db, { userId: "u1", verb: "nope", partnerId: "npc1" }).reason, "unknown_verb");
    assert.equal(performDailyVerb(db, { userId: "u1", verb: "hang_out" }).reason, "missing_inputs");
  });

  it("macro gates on the kill-switch (off → disabled)", async () => {
    const M = new Map();
    registerDailyLifeMacros((d, n, fn) => M.set(`${d}.${n}`, fn));
    process.env.CONCORD_SOCIAL_LIFE = "0";
    const off = await M.get("daily_life.hang_out")({ db, actor: { userId: "u1" } }, { partnerId: "npc1" });
    assert.equal(off.reason, "disabled");
    process.env.CONCORD_SOCIAL_LIFE = "1";
    const on = await M.get("daily_life.hang_out")({ db, actor: { userId: "u1" } }, { partnerId: "npc1" });
    assert.equal(on.ok, true);
    delete process.env.CONCORD_SOCIAL_LIFE;
  });
});
