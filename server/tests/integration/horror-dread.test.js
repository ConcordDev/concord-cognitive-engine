/**
 * E1 — horror dread substrate.
 *
 * Pins:
 *   - dreadFromDistance: 0 beyond terror radius, spikes near contact
 *   - tickSessionDread: proximity raises dread, distance decays it, chase flips
 *   - the health ladder: healthy → wounded → downed (with bleed-out) + rally
 *   - sweepBleedOuts surfaces expired downed investigators
 *
 * Run: node --test tests/integration/horror-dread.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up256 } from "../../migrations/256_asymmetric_horror.js";
import { up as up273 } from "../../migrations/273_horror_dread.js";
import {
  dreadFromDistance, tensionBand, tickSessionDread, advanceDread,
  woundInvestigator, rallyInvestigator, sweepBleedOuts, getDreadState,
  TERROR_RADIUS_M, CHASE_RADIUS_M, BLEED_OUT_S,
} from "../../lib/horror-dread.js";
import { startSession, joinAsInvestigator } from "../../lib/horror.js";

function freshSession() {
  const db = new Database(":memory:");
  up256(db); up273(db);
  const s = startSession(db, "ghost1", { worldId: "w1" });
  joinAsInvestigator(db, s.sessionId, "inv1");
  return { db, sessionId: s.sessionId };
}

describe("E1 — proximity dread", () => {
  it("is 0 beyond the terror radius and spikes near contact", () => {
    assert.equal(dreadFromDistance(TERROR_RADIUS_M + 1), 0);
    assert.equal(dreadFromDistance(TERROR_RADIUS_M), 0);
    const near = dreadFromDistance(2);
    const mid = dreadFromDistance(TERROR_RADIUS_M / 2);
    assert.ok(near > mid, "closer = more dread");
    assert.ok(near > 0.8, "point-blank dread is high");
  });

  it("tension bands map calm/tension/terror", () => {
    assert.equal(tensionBand(0.1, false), "calm");
    assert.equal(tensionBand(0.5, false), "tension");
    assert.equal(tensionBand(0.1, true), "terror");      // chase forces terror
    assert.equal(tensionBand(0.9, false), "terror");
  });
});

describe("E1 — session dread tick", () => {
  it("raises dread when the ghost is close + flips chase inside chase radius", () => {
    const { db, sessionId } = freshSession();
    // ghost 4m from investigator → inside chase radius
    const close = { ghost: { x: 0, y: 0, z: 0 }, investigators: { inv1: { x: 4, y: 0, z: 0 } } };
    let payload;
    for (let i = 0; i < 5; i++) payload = tickSessionDread(db, sessionId, close)[0];
    assert.ok(payload.dread > 0.3, "dread accrued");
    assert.equal(payload.inChase, true);
    assert.equal(payload.band, "terror");
    // ghost flees far away → dread decays over ticks
    const far = { ghost: { x: 0, y: 0, z: 0 }, investigators: { inv1: { x: 200, y: 0, z: 0 } } };
    let decayed;
    for (let i = 0; i < 10; i++) decayed = tickSessionDread(db, sessionId, far)[0];
    assert.ok(decayed.dread < payload.dread, "dread decays when safe");
    assert.equal(decayed.inChase, false);
    db.close();
  });

  it("CHASE_RADIUS_M < TERROR_RADIUS_M (chase is the inner band)", () => {
    assert.ok(CHASE_RADIUS_M < TERROR_RADIUS_M);
  });
});

describe("E1 — health ladder + rally", () => {
  it("climbs healthy → wounded → downed with a bleed-out timer", () => {
    const { db, sessionId } = freshSession();
    const now = Date.now();
    const w1 = woundInvestigator(db, sessionId, "inv1", now);
    assert.equal(w1.healthTier, "wounded");
    assert.equal(w1.downed, false);
    const w2 = woundInvestigator(db, sessionId, "inv1", now);
    assert.equal(w2.healthTier, "downed");
    assert.equal(w2.downed, true);
    assert.ok(w2.bleedOutAt > Math.floor(now / 1000));
    db.close();
  });

  it("rally revives a downed investigator before bleed-out, rejects after", () => {
    const { db, sessionId } = freshSession();
    const t0 = Date.now();
    woundInvestigator(db, sessionId, "inv1", t0); // wounded
    woundInvestigator(db, sessionId, "inv1", t0); // downed
    // rally in time
    const r = rallyInvestigator(db, sessionId, "inv1", t0 + 1000);
    assert.equal(r.ok, true);
    assert.equal(r.healthTier, "rallied");
    // down again and let it bleed out
    woundInvestigator(db, sessionId, "inv1", t0); // rallied → wounded
    woundInvestigator(db, sessionId, "inv1", t0); // wounded → downed
    const tooLate = t0 + (BLEED_OUT_S + 5) * 1000;
    assert.equal(rallyInvestigator(db, sessionId, "inv1", tooLate).reason, "bled_out");
    db.close();
  });

  it("sweepBleedOuts surfaces only expired downed investigators", () => {
    const { db, sessionId } = freshSession();
    const t0 = Date.now();
    woundInvestigator(db, sessionId, "inv1", t0);
    woundInvestigator(db, sessionId, "inv1", t0); // downed, bleed_out = t0+BLEED_OUT_S
    assert.deepEqual(sweepBleedOuts(db, sessionId, t0 + 1000), []); // not yet
    assert.deepEqual(sweepBleedOuts(db, sessionId, t0 + (BLEED_OUT_S + 5) * 1000), ["inv1"]);
    db.close();
  });

  it("downed investigators don't accrue dread + getDreadState reads it back", () => {
    const { db, sessionId } = freshSession();
    const t0 = Date.now();
    woundInvestigator(db, sessionId, "inv1", t0);
    woundInvestigator(db, sessionId, "inv1", t0); // downed, dread pinned to 1
    const r = advanceDread(db, sessionId, "inv1", 200, t0); // far away
    assert.equal(r.healthTier, "downed");
    assert.equal(r.dread, 1); // stays pinned
    const state = getDreadState(db, sessionId);
    assert.equal(state[0].userId, "inv1");
    assert.equal(state[0].healthTier, "downed");
    db.close();
  });
});
