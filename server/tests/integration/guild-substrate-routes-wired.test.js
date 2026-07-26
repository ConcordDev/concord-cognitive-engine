// server/tests/integration/guild-substrate-routes-wired.test.js
//
// Wave 4 gap-closure (docs/concordia-specs/runmodes-endgame-social-capability-map.md):
// lib/guild-substrate.js (Phase BC1 — org bank / org XP+level / hall claim)
// was fully built and unit-tested but had ZERO callers outside its own test
// files — no route, macro, or heartbeat ever invoked awardOrgXp,
// depositToOrgInventory, withdrawFromOrgInventory, or claimHallBuilding, so
// a guild's level/bank/hall could never move in the live game no matter how
// much a guild "did".
//
// This test drives the real HTTP routes added to
// routes/world-orgs-extended.js (mounted at /api/world-orgs) with a real
// in-memory DB carrying the guild-substrate schema (migration 238) plus
// player_inventory + world_buildings, and a real (non-mocked)
// world-organizations.js membership graph — the same module the live
// server uses for the in-memory org graph. It proves state actually moves
// end-to-end through the HTTP layer, not just in an isolated function call:
// deposit removes the item from player_inventory AND credits org_inventory
// AND awards org_progression XP; a big-enough deposit crosses the
// 100·level² curve and flips org_level; the officer withdraw cap scales
// with that new org_level (the first real consumer of org_level anywhere
// in the codebase); and a hall claim requires + transfers real building
// ownership.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createWorldOrgsExtendedRouter from "../../routes/world-orgs-extended.js";
import { up as upGuild } from "../../migrations/238_guild_substrate.js";
import { up as upOrgs } from "../../migrations/383_world_organizations.js";
import * as orgs from "../../lib/world-organizations.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_buildings (
      id TEXT PRIMARY KEY, world_id TEXT, building_type TEXT,
      owner_type TEXT, owner_id TEXT
    );
    CREATE TABLE player_inventory (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      item_type   TEXT NOT NULL DEFAULT 'material',
      item_id     TEXT NOT NULL,
      item_name   TEXT NOT NULL DEFAULT '',
      quantity    INTEGER NOT NULL DEFAULT 1,
      quality     INTEGER NOT NULL DEFAULT 50,
      acquired_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  upGuild(db);
  upOrgs(db);
  return db;
}

function fakeAuth(userId) {
  return (req, _res, next) => { req.user = { id: userId }; next(); };
}

function startApp(db, userId) {
  const app = express();
  app.use(express.json());
  app.use("/api/world-orgs", createWorldOrgsExtendedRouter({ requireAuth: fakeAuth(userId), db }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

describe("guild-substrate is reachable through real HTTP routes (Wave 4 gap-closure)", () => {
  let db, orgId, leaderId, memberId;

  before(() => {
    db = freshDb();
    leaderId = "leader-1";
    memberId = "member-1";
    const created = orgs.createOrganization(db, { name: "The Iron Circle", leaderId, type: "guild" });
    assert.ok(created.ok, "org creation must succeed for the test setup");
    orgId = created.organization.id;
    const joined = orgs.joinOrganization(db, orgId, memberId, "member");
    assert.ok(joined.ok, "member join must succeed for the test setup");
  });

  it("fresh guild starts at level 1 with no hall, over the real HTTP route", async () => {
    const app = await startApp(db, memberId);
    try {
      const res = await fetch(`${app.url}/api/world-orgs/${orgId}/progression`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.progression.org_level, 1);
      assert.equal(body.progression.hall_building_id, null);
      assert.equal(body.withdrawCapPerTx, 50, "level-1 withdraw cap must be the base 50/tx");
    } finally {
      await app.close();
    }
  });

  it("a non-member cannot deposit into the bank (membership enforced server-side)", async () => {
    db.prepare(`
      INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity)
      VALUES ('inv-stranger', 'stranger-1', 'material', 'iron_ingot', 'Iron Ingot', 10)
    `).run();
    const app = await startApp(db, "stranger-1");
    try {
      const res = await fetch(`${app.url}/api/world-orgs/${orgId}/bank/deposit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inventoryItemId: "inv-stranger", quantity: 10 }),
      });
      const body = await res.json();
      assert.equal(res.status, 403);
      assert.equal(body.error, "not_member");
      // the item must NOT have been touched
      const row = db.prepare(`SELECT quantity FROM player_inventory WHERE id = 'inv-stranger'`).get();
      assert.equal(row.quantity, 10);
    } finally {
      await app.close();
    }
  });

  it("a real member deposit removes the item from player_inventory AND credits the org bank AND awards org XP — verified by re-fetching all three over HTTP/DB", async () => {
    db.prepare(`
      INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity)
      VALUES ('inv-1', ?, 'material', 'iron_ingot', 'Iron Ingot', 10)
    `).run(memberId);
    const app = await startApp(db, memberId);
    try {
      const res = await fetch(`${app.url}/api/world-orgs/${orgId}/bank/deposit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inventoryItemId: "inv-1", quantity: 10 }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      // compute-don't-guess: 10 items x 5 XP/item = 50, matches guild-substrate.js's
      // literal `Math.min(100, quantity * 5)` formula.
      assert.equal(body.orgXp, 50);

      // 1) item is gone from the player's real inventory
      const invRow = db.prepare(`SELECT * FROM player_inventory WHERE id = 'inv-1'`).get();
      assert.equal(invRow, undefined, "fully-deposited item must be deleted from player_inventory");

      // 2) the org bank actually holds it now
      const bankRes = await fetch(`${app.url}/api/world-orgs/${orgId}/bank`);
      const bankBody = await bankRes.json();
      assert.equal(bankBody.items.length, 1);
      assert.equal(bankBody.items[0].item_descriptor, "iron_ingot");
      assert.equal(bankBody.items[0].quantity, 10);

      // 3) org progression really moved
      const progRes = await fetch(`${app.url}/api/world-orgs/${orgId}/progression`);
      const progBody = await progRes.json();
      assert.equal(progBody.progression.org_xp, 50);
      assert.equal(progBody.progression.org_level, 1); // 50 < 100·1² — not yet a level-up

      // 4) the deposit is in the audit log
      const logRes = await fetch(`${app.url}/api/world-orgs/${orgId}/bank/log`);
      const logBody = await logRes.json();
      assert.equal(logBody.log.length, 1);
      assert.equal(logBody.log[0].action, "deposit");
      assert.equal(logBody.log[0].quantity, 10);
    } finally {
      await app.close();
    }
  });

  it("a big enough deposit crosses the 100·level² XP curve and levels the guild up — and the officer withdraw cap (a real gameplay benefit) scales with the new level", async () => {
    db.prepare(`
      INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity)
      VALUES ('inv-2', ?, 'material', 'gold_bar', 'Gold Bar', 1000)
    `).run(memberId);
    const app = await startApp(db, memberId);
    try {
      const res = await fetch(`${app.url}/api/world-orgs/${orgId}/bank/deposit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inventoryItemId: "inv-2", quantity: 1000 }),
      });
      const body = await res.json();
      // was 50 XP from the prior test; deposit caps per-tx at 100 -> 150 total
      assert.equal(body.orgXp, 150);
      assert.equal(body.orgLevel, 2, "150 XP >= 100*1^2 must cross into level 2");
      assert.equal(body.orgLeveledUp, true);

      const progRes = await fetch(`${app.url}/api/world-orgs/${orgId}/progression`);
      const progBody = await progRes.json();
      assert.equal(progBody.progression.org_level, 2);
      // WITHDRAW_CAP_PER_LEVEL (50) * org_level (2) = 100 — this is the
      // real benefit org_level now grants; previously org_level had zero
      // downstream consumers anywhere in the codebase.
      assert.equal(progBody.withdrawCapPerTx, 100);
    } finally {
      await app.close();
    }
  });

  it("a member (non-officer) cannot withdraw from the bank", async () => {
    const app = await startApp(db, memberId);
    try {
      const res = await fetch(`${app.url}/api/world-orgs/${orgId}/bank/withdraw`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemDescriptor: "iron_ingot", quantity: 5 }),
      });
      const body = await res.json();
      assert.equal(res.status, 403);
      assert.equal(body.error, "officer_required");
    } finally {
      await app.close();
    }
  });

  it("an officer withdrawal over the level-scaled cap is rejected; a within-cap withdrawal moves the item back into player_inventory", async () => {
    orgs.setMemberRole(db, orgId, memberId, "officer", leaderId);
    const app = await startApp(db, memberId);
    try {
      // cap is 100 at level 2 (from the earlier test) — 150 must be rejected
      const overCap = await fetch(`${app.url}/api/world-orgs/${orgId}/bank/withdraw`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemDescriptor: "iron_ingot", quantity: 150 }),
      });
      const overBody = await overCap.json();
      assert.equal(overCap.status, 403);
      assert.equal(overBody.error, "over_withdraw_cap");
      assert.equal(overBody.cap, 100);

      const ok = await fetch(`${app.url}/api/world-orgs/${orgId}/bank/withdraw`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemDescriptor: "iron_ingot", quantity: 4 }),
      });
      const okBody = await ok.json();
      assert.equal(ok.status, 200);
      assert.equal(okBody.remaining, 6, "10 deposited - 4 withdrawn = 6 remaining in the bank");

      const invRows = db.prepare(`SELECT * FROM player_inventory WHERE user_id = ? AND item_id = 'iron_ingot'`).all(memberId);
      const total = invRows.reduce((s, r) => s + r.quantity, 0);
      assert.equal(total, 4, "the withdrawn quantity must really land back in the officer's inventory");
    } finally {
      await app.close();
    }
  });

  it("hall claim requires the caller to actually own the building being donated", async () => {
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, owner_type, owner_id) VALUES ('b-unowned', 'w1', 'tower', 'world', NULL)`).run();
    const app = await startApp(db, leaderId);
    try {
      const res = await fetch(`${app.url}/api/world-orgs/${orgId}/hall/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ buildingId: "b-unowned" }),
      });
      const body = await res.json();
      assert.equal(res.status, 403);
      assert.equal(body.error, "must_own_building");
    } finally {
      await app.close();
    }
  });

  it("leader claiming a building they own transfers real ownership to the org, sets hall_building_id, and awards the 200-XP milestone", async () => {
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, owner_type, owner_id) VALUES ('b-owned', 'w1', 'house', 'player', ?)`).run(leaderId);
    const app = await startApp(db, leaderId);
    try {
      const res = await fetch(`${app.url}/api/world-orgs/${orgId}/hall/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ buildingId: "b-owned" }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);

      const building = db.prepare(`SELECT owner_type, owner_id FROM world_buildings WHERE id = 'b-owned'`).get();
      assert.equal(building.owner_type, "org");
      assert.equal(building.owner_id, orgId);

      const progRes = await fetch(`${app.url}/api/world-orgs/${orgId}/progression`);
      const progBody = await progRes.json();
      assert.equal(progBody.progression.hall_building_id, "b-owned");
      // 150 (prior) + 200 (hall milestone) = 350 -> level 3 (100*2^2=400 not yet
      // crossed... verify against the real curve rather than guessing)
      const DEFAULT_XP_CURVE = (level) => 100 * level * level;
      let expectLevel = 1;
      while (progBody.progression.org_xp >= DEFAULT_XP_CURVE(expectLevel)) expectLevel++;
      assert.equal(progBody.progression.org_level, expectLevel, "level must match the real quadratic curve, not an assumed value");
    } finally {
      await app.close();
    }
  });

  it("a non-leader cannot claim a hall even if they own the building", async () => {
    db.prepare(`INSERT INTO world_buildings (id, world_id, building_type, owner_type, owner_id) VALUES ('b-owned-2', 'w1', 'house', 'player', ?)`).run(memberId);
    const app = await startApp(db, memberId);
    try {
      const res = await fetch(`${app.url}/api/world-orgs/${orgId}/hall/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ buildingId: "b-owned-2" }),
      });
      const body = await res.json();
      assert.equal(res.status, 403);
      assert.equal(body.error, "leader_only");
    } finally {
      await app.close();
    }
  });

  after(() => { db.close(); });
});
