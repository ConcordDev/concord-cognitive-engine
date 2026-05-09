/**
 * Tier-2 contract tests for Phase 5a — Player Settlements + Land Claims.
 *
 * Run: node --test tests/land-claims.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  claimLand,
  inviteToClaim,
  tickMaintenance,
  topUpBond,
  claimAt,
  canActIn,
  listClaimsForUser,
} from "../lib/land-claims.js";
import { runLandClaimsCycle } from "../emergent/land-claims-cycle.js";

function makeFakeDb() {
  const tables = { land_claims: new Map(), land_claim_invites: new Map(), land_claim_events: new Map() };
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return { run: (...a) => runStmt(s, a), get: (...a) => getStmt(s, a), all: (...a) => allStmt(s, a) };
  }
  function runStmt(sql, args) {
    if (sql.startsWith("INSERT INTO land_claims")) {
      const [id, ownerId, worldId, ax, az, r, bond, mpd] = args;
      tables.land_claims.set(id, {
        id, owner_user_id: ownerId, world_id: worldId,
        anchor_x: ax, anchor_z: az, radius_m: r,
        bond_sparks: bond, maintenance_per_day: mpd,
        claimed_at: Math.floor(Date.now() / 1000),
        last_maintained_at: Math.floor(Date.now() / 1000),
        status: "active",
      });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO land_claim_invites")) {
      const [claimId, userId, role] = args;
      tables.land_claim_invites.set(`${claimId}|${userId}`, { claim_id: claimId, user_id: userId, role });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO land_claim_events")) {
      const [id, claimId, kind, actor, detail] = args;
      tables.land_claim_events.set(id, { id, claim_id: claimId, kind, actor_id: actor, detail_json: detail });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE land_claims SET status = 'expired'")) {
      const [id] = args;
      const c = tables.land_claims.get(id);
      if (c) { c.status = "expired"; c.bond_sparks = 0; return { changes: 1 }; }
      return { changes: 0 };
    }
    if (sql.startsWith("UPDATE land_claims SET bond_sparks = ?, last_maintained_at = ?")) {
      const [bond, lm, id] = args;
      const c = tables.land_claims.get(id);
      if (c) { c.bond_sparks = bond; c.last_maintained_at = lm; return { changes: 1 }; }
      return { changes: 0 };
    }
    if (sql.startsWith("UPDATE land_claims SET bond_sparks = bond_sparks + ?")) {
      const [delta, id] = args;
      const c = tables.land_claims.get(id);
      if (c) { c.bond_sparks = (c.bond_sparks || 0) + delta; return { changes: 1 }; }
      return { changes: 0 };
    }
    return { changes: 0 };
  }
  function getStmt(sql, args) {
    if (sql.startsWith("SELECT * FROM land_claims WHERE id = ?")) {
      return tables.land_claims.get(args[0]) || null;
    }
    if (sql.startsWith("SELECT owner_user_id, status FROM land_claims WHERE id = ?")) {
      const c = tables.land_claims.get(args[0]);
      return c ? { owner_user_id: c.owner_user_id, status: c.status } : null;
    }
    if (sql.startsWith("SELECT role FROM land_claim_invites WHERE claim_id = ? AND user_id = ?")) {
      const [claimId, userId] = args;
      const r = tables.land_claim_invites.get(`${claimId}|${userId}`);
      return r ? { role: r.role } : null;
    }
    return null;
  }
  function allStmt(sql, args) {
    if (sql.startsWith("SELECT id, anchor_x, anchor_z, radius_m FROM land_claims")) {
      const [worldId] = args;
      return Array.from(tables.land_claims.values())
        .filter(c => c.world_id === worldId && c.status === "active")
        .map(c => ({ id: c.id, anchor_x: c.anchor_x, anchor_z: c.anchor_z, radius_m: c.radius_m }));
    }
    if (sql.startsWith("SELECT id, owner_user_id, anchor_x, anchor_z, radius_m FROM land_claims")) {
      const [worldId] = args;
      return Array.from(tables.land_claims.values())
        .filter(c => c.world_id === worldId && c.status === "active");
    }
    if (sql.startsWith("SELECT id FROM land_claims WHERE status = 'active'")) {
      return Array.from(tables.land_claims.values())
        .filter(c => c.status === "active").map(c => ({ id: c.id }));
    }
    if (sql.startsWith("SELECT * FROM land_claims WHERE owner_user_id = ?")) {
      const [userId] = args;
      return Array.from(tables.land_claims.values()).filter(c => c.owner_user_id === userId);
    }
    if (sql.startsWith("SELECT lc.*, lci.role AS invite_role FROM land_claims lc")) {
      const [userId] = args;
      const out = [];
      for (const inv of tables.land_claim_invites.values()) {
        if (inv.user_id !== userId) continue;
        const c = tables.land_claims.get(inv.claim_id);
        if (c && c.status === "active") out.push({ ...c, invite_role: inv.role });
      }
      return out;
    }
    return [];
  }
  return { prepare, _tables: tables };
}

describe("claimLand", () => {
  it("creates a claim with bond proportional to radius", () => {
    const db = makeFakeDb();
    const r = claimLand(db, { userId: "u1", worldId: "w", x: 100, z: 50, radiusM: 30 });
    assert.equal(r.ok, true);
    assert.ok(r.bond >= 50);
    assert.equal(r.radius, 30);
    assert.equal(db._tables.land_claims.size, 1);
  });

  it("clamps radius to [5, 200]", () => {
    const db = makeFakeDb();
    const r1 = claimLand(db, { userId: "u1", worldId: "w", x: 0, z: 0, radiusM: 1 });
    assert.equal(r1.radius, 5);
    const r2 = claimLand(db, { userId: "u2", worldId: "w", x: 1000, z: 1000, radiusM: 999 });
    assert.equal(r2.radius, 200);
  });

  it("rejects overlapping claims", () => {
    const db = makeFakeDb();
    claimLand(db, { userId: "u1", worldId: "w", x: 0, z: 0, radiusM: 30 });
    const r = claimLand(db, { userId: "u2", worldId: "w", x: 20, z: 0, radiusM: 30 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "overlap");
  });

  it("supports walletDebit guard", () => {
    const db = makeFakeDb();
    const debit = () => ({ ok: false });
    const r = claimLand(db, { userId: "u1", worldId: "w", x: 0, z: 0, radiusM: 30, walletDebit: debit });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "wallet_insufficient");
  });
});

describe("inviteToClaim + canActIn", () => {
  it("only owner can invite", () => {
    const db = makeFakeDb();
    const c = claimLand(db, { userId: "u1", worldId: "w", x: 0, z: 0, radiusM: 20 });
    const bad = inviteToClaim(db, { claimId: c.claimId, userId: "u3", invitedBy: "u2" });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "not_owner");
    const good = inviteToClaim(db, { claimId: c.claimId, userId: "u3", invitedBy: "u1" });
    assert.equal(good.ok, true);
  });

  it("canActIn allows owner; rejects others; allows invited co_owners", () => {
    const db = makeFakeDb();
    const c = claimLand(db, { userId: "u1", worldId: "w", x: 0, z: 0, radiusM: 20 });
    assert.equal(canActIn(db, "w", 5, 5, "u1", "build"), true);
    assert.equal(canActIn(db, "w", 5, 5, "u2", "build"), false);
    inviteToClaim(db, { claimId: c.claimId, userId: "u3", role: "co_owner", invitedBy: "u1" });
    assert.equal(canActIn(db, "w", 5, 5, "u3", "build"), true);
  });

  it("guests can't build but can act for non-build actions", () => {
    const db = makeFakeDb();
    const c = claimLand(db, { userId: "u1", worldId: "w", x: 0, z: 0, radiusM: 20 });
    inviteToClaim(db, { claimId: c.claimId, userId: "u3", role: "guest", invitedBy: "u1" });
    assert.equal(canActIn(db, "w", 5, 5, "u3", "build"), false);
    assert.equal(canActIn(db, "w", 5, 5, "u3", "look"), true);
  });

  it("trespass_check action emits event when blocked", () => {
    const db = makeFakeDb();
    claimLand(db, { userId: "u1", worldId: "w", x: 0, z: 0, radiusM: 20 });
    canActIn(db, "w", 5, 5, "u_intruder", "trespass_check");
    const events = Array.from(db._tables.land_claim_events.values());
    assert.ok(events.some(e => e.kind === "trespass"));
  });

  it("open territory permits everyone", () => {
    const db = makeFakeDb();
    assert.equal(canActIn(db, "w", 1000, 1000, "anyone", "build"), true);
  });
});

describe("tickMaintenance + topUpBond", () => {
  it("noop within same day", () => {
    const db = makeFakeDb();
    const c = claimLand(db, { userId: "u1", worldId: "w", x: 0, z: 0, radiusM: 30 });
    const r = tickMaintenance(db, c.claimId);
    assert.equal(r.action, "noop");
  });

  it("paid when 1+ days elapsed and bond covers", () => {
    const db = makeFakeDb();
    const c = claimLand(db, { userId: "u1", worldId: "w", x: 0, z: 0, radiusM: 30 });
    const future = Math.floor(Date.now() / 1000) + 2 * 86400;
    const r = tickMaintenance(db, c.claimId, { now: future });
    assert.equal(r.action, "paid");
    assert.ok(r.bondAfter > 0);
  });

  it("expires when bond is exhausted", () => {
    const db = makeFakeDb();
    const c = claimLand(db, { userId: "u1", worldId: "w", x: 0, z: 0, radiusM: 5 });
    // Tiny bond = 50 sparks @ 5/day → ~10 days to deplete.
    const future = Math.floor(Date.now() / 1000) + 30 * 86400;
    const r = tickMaintenance(db, c.claimId, { now: future });
    assert.equal(r.action, "expired");
    assert.equal(r.bondAfter, 0);
  });

  it("topUpBond rejects non-owner", () => {
    const db = makeFakeDb();
    const c = claimLand(db, { userId: "u1", worldId: "w", x: 0, z: 0, radiusM: 30 });
    const r = topUpBond(db, { claimId: c.claimId, userId: "u2", amount: 100 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner");
  });

  it("topUpBond increases bond", () => {
    const db = makeFakeDb();
    const c = claimLand(db, { userId: "u1", worldId: "w", x: 0, z: 0, radiusM: 30 });
    const before = db._tables.land_claims.get(c.claimId).bond_sparks;
    topUpBond(db, { claimId: c.claimId, userId: "u1", amount: 200 });
    assert.equal(db._tables.land_claims.get(c.claimId).bond_sparks, before + 200);
  });
});

describe("claimAt + listClaimsForUser", () => {
  it("claimAt returns the covering claim", () => {
    const db = makeFakeDb();
    const c = claimLand(db, { userId: "u1", worldId: "w", x: 100, z: 50, radiusM: 20 });
    const r = claimAt(db, "w", 105, 55);
    assert.ok(r);
    assert.equal(r.id, c.claimId);
  });

  it("claimAt returns null outside any claim", () => {
    const db = makeFakeDb();
    claimLand(db, { userId: "u1", worldId: "w", x: 0, z: 0, radiusM: 10 });
    const r = claimAt(db, "w", 100, 100);
    assert.equal(r, null);
  });

  it("listClaimsForUser lists owned + invited", () => {
    const db = makeFakeDb();
    const c1 = claimLand(db, { userId: "u1", worldId: "w", x: 0, z: 0, radiusM: 20 });
    const c2 = claimLand(db, { userId: "u2", worldId: "w", x: 200, z: 200, radiusM: 20 });
    inviteToClaim(db, { claimId: c2.claimId, userId: "u1", invitedBy: "u2" });
    const list = listClaimsForUser(db, "u1");
    assert.equal(list.length, 2);
  });
});

describe("land-claims-cycle heartbeat", () => {
  it("returns no_db with no DB", async () => {
    const r = await runLandClaimsCycle({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("respects CONCORD_LAND_CLAIMS=0", async () => {
    const prev = process.env.CONCORD_LAND_CLAIMS;
    process.env.CONCORD_LAND_CLAIMS = "0";
    try {
      const r = await runLandClaimsCycle({ db: makeFakeDb() });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "disabled");
    } finally {
      if (prev === undefined) delete process.env.CONCORD_LAND_CLAIMS;
      else process.env.CONCORD_LAND_CLAIMS = prev;
    }
  });
});
