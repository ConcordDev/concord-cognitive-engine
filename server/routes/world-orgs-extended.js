// server/routes/world-orgs-extended.js
//
// Extended world-organizations endpoints. world-organizations.js exports
// 19 functions; routes/world.js wires only 8 (createOrganization,
// listOrganizations, etc). The other 11 — alliances, recruitment,
// mentorships, treasury contributions, member roles, party reads,
// org stats — were implemented but never routed. Pre-this-mount these
// features were dark code.
//
// Wave 4 gap-closure (docs/concordia-specs/runmodes-endgame-social-capability-map.md):
// lib/guild-substrate.js (Phase BC1 — org_progression XP/level, org_inventory
// bank, hall claim) had ZERO callers outside its own test files — every
// function was fully built and tested in isolation but unreachable from any
// route, macro, or heartbeat, so a guild's level/bank/hall could never move
// in the live game. The routes below are the missing connection: real
// player_inventory items flow into/out of the DB-backed org bank (which
// itself already awards org XP per deposit — see guild-substrate.js), a
// guild leader can donate a building they own as the guild hall (200 XP
// milestone), and org_level now grants a real benefit — the officer
// per-transaction bank withdrawal cap scales with guild level
// (previously org_level had zero downstream consumers anywhere).
//
// Mount: /api/world-orgs

import crypto from "node:crypto";
import { Router } from "express";
import {
  createAlliance,
  joinAlliance,
  contributeToTreasury,
  setMemberRole,
  getOrgMembers,
  getOrganizationStats,
  getParty,
  getUserParty,
  getMentorships,
  registerMentor,
  postRecruitment,
  getRecruitmentBoard,
  applyToRecruitment,
} from "../lib/world-organizations.js";
import {
  getOrgProgression,
  depositToOrgInventory,
  withdrawFromOrgInventory,
  listOrgInventory,
  getOrgInventoryLog,
  claimHallBuilding,
} from "../lib/guild-substrate.js";

// Guild-level benefit: officers can withdraw more per transaction as the
// guild levels up. Level 1 (default, freshly-created guild) = 50/tx;
// scales linearly so a level-10 guild trusts officers with 500/tx. This is
// the first real consumer of org_level anywhere in the codebase.
const WITHDRAW_CAP_PER_LEVEL = 50;

export default function createWorldOrgsExtendedRouter({ requireAuth, db }) {
  const router = Router();
  const auth = typeof requireAuth === "function" && requireAuth.length === 0 ? requireAuth() : requireAuth;

  const _isMemberOf = (orgId) => {
    const members = getOrgMembers(orgId);
    return (userId) => members.some(m => m.userId === userId);
  };
  const _isOfficerOf = (orgId) => {
    const members = getOrgMembers(orgId);
    return (userId) => members.some(m => m.userId === userId && (m.role === "officer" || m.role === "leader"));
  };
  const _isLeaderOf = (orgId) => {
    const members = getOrgMembers(orgId);
    return (userId) => members.some(m => m.userId === userId && m.role === "leader");
  };

  // ─── Org reads ─────────────────────────────────────────────────────────────
  router.get("/stats", (_req, res) => {
    res.json({ ok: true, ...getOrganizationStats() });
  });

  router.get("/:orgId/members", (req, res) => {
    res.json({ ok: true, orgId: req.params.orgId, ...getOrgMembers(req.params.orgId) });
  });

  // ─── Member-role admin ─────────────────────────────────────────────────────
  router.post("/:orgId/role", auth, (req, res) => {
    const actorId = req.user?.id;
    const { targetUserId, role } = req.body || {};
    if (!actorId || !targetUserId || !role) {
      return res.status(400).json({ ok: false, error: "targetUserId+role required" });
    }
    res.json({ ok: true, ...setMemberRole(req.params.orgId, targetUserId, role, actorId) });
  });

  // ─── Treasury ──────────────────────────────────────────────────────────────
  router.post("/:orgId/treasury/contribute", auth, (req, res) => {
    const userId = req.user?.id;
    const amount = Number(req.body?.amount);
    if (!userId || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: "amount must be a positive number" });
    }
    res.json({ ok: true, ...contributeToTreasury(req.params.orgId, amount, userId) });
  });

  // ─── Alliances ─────────────────────────────────────────────────────────────
  router.post("/alliances", auth, (req, res) => {
    const { name, founderOrgId, description } = req.body || {};
    if (!name || !founderOrgId) return res.status(400).json({ ok: false, error: "name+founderOrgId required" });
    res.json({ ok: true, ...createAlliance({ name, founderOrgId, description }) });
  });

  router.post("/alliances/:allianceId/join", auth, (req, res) => {
    const { orgId } = req.body || {};
    if (!orgId) return res.status(400).json({ ok: false, error: "orgId required" });
    res.json({ ok: true, ...joinAlliance(req.params.allianceId, orgId) });
  });

  // ─── Parties ───────────────────────────────────────────────────────────────
  router.get("/parties/:partyId", (req, res) => {
    res.json({ ok: true, ...getParty(req.params.partyId) });
  });

  router.get("/parties/user/:userId", (req, res) => {
    res.json({ ok: true, userId: req.params.userId, ...getUserParty(req.params.userId) });
  });

  // ─── Recruitment ───────────────────────────────────────────────────────────
  router.get("/recruitment", (req, res) => {
    const districtId = req.query.districtId || null;
    const type = req.query.type || null;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    res.json({ ok: true, ...getRecruitmentBoard({ districtId, type, limit }) });
  });

  router.post("/recruitment", auth, (req, res) => {
    const { orgId, type, title, description, requirements, benefits, districtId } = req.body || {};
    if (!orgId || !type || !title) {
      return res.status(400).json({ ok: false, error: "orgId+type+title required" });
    }
    res.json({ ok: true, ...postRecruitment({ orgId, type, title, description, requirements, benefits, districtId }) });
  });

  router.post("/recruitment/:listingId/apply", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const { message, portfolio } = req.body || {};
    res.json({ ok: true, ...applyToRecruitment(req.params.listingId, userId, { message, portfolio }) });
  });

  // ─── Mentorships ───────────────────────────────────────────────────────────
  router.get("/mentorships/:userId", (req, res) => {
    res.json({ ok: true, userId: req.params.userId, ...getMentorships(req.params.userId) });
  });

  router.post("/mentor/register", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const { domain, maxMentees } = req.body || {};
    if (!domain) return res.status(400).json({ ok: false, error: "domain required" });
    res.json({ ok: true, ...registerMentor(userId, { domain, maxMentees }) });
  });

  // ─── Guild progression (Phase BC1 substrate — now reachable) ──────────────

  router.get("/:orgId/progression", (req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "db_unavailable" });
    const prog = getOrgProgression(db, req.params.orgId);
    res.json({
      ok: true,
      orgId: req.params.orgId,
      progression: prog || { org_id: req.params.orgId, org_xp: 0, org_level: 1, hall_building_id: null },
      withdrawCapPerTx: WITHDRAW_CAP_PER_LEVEL * (prog?.org_level || 1),
    });
  });

  router.get("/:orgId/bank", (req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "db_unavailable" });
    res.json({ ok: true, orgId: req.params.orgId, items: listOrgInventory(db, req.params.orgId) });
  });

  router.get("/:orgId/bank/log", (req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "db_unavailable" });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    res.json({ ok: true, orgId: req.params.orgId, log: getOrgInventoryLog(db, req.params.orgId, limit) });
  });

  // Deposit a real player_inventory item into the guild bank. Consumes the
  // item from the caller's inventory (matches the "use" pattern in
  // routes/player-inventory.js) and credits the org bank + org XP in the
  // same request via guild-substrate.js#depositToOrgInventory. Guild
  // membership is enforced server-side from the live world-organizations.js
  // member map, not trusted from the client.
  router.post("/:orgId/bank/deposit", auth, (req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "db_unavailable" });
    const userId = req.user?.id;
    const { inventoryItemId } = req.body || {};
    const quantity = Number(req.body?.quantity);
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    if (!inventoryItemId || !Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ ok: false, error: "inventoryItemId+quantity required" });
    }
    try {
      const item = db.prepare(
        `SELECT id, item_type, item_id, item_name, quantity FROM player_inventory WHERE id = ? AND user_id = ?`
      ).get(inventoryItemId, userId);
      if (!item) return res.status(404).json({ ok: false, error: "item_not_found" });
      if (item.quantity < quantity) return res.status(400).json({ ok: false, error: "insufficient_quantity" });

      const descriptor = item.item_id || item.item_name || item.item_type;
      const result = depositToOrgInventory(db, userId, req.params.orgId, {
        itemDescriptor: descriptor, quantity, itemKind: "inventory",
        isMember: _isMemberOf(req.params.orgId),
      });
      if (!result.ok) return res.status(403).json(result);

      // Real consumption — the item actually leaves the player's inventory,
      // it isn't just referenced.
      if (item.quantity - quantity <= 0) {
        db.prepare(`DELETE FROM player_inventory WHERE id = ?`).run(item.id);
      } else {
        db.prepare(`UPDATE player_inventory SET quantity = quantity - ? WHERE id = ?`).run(quantity, item.id);
      }

      res.json({ ok: true, itemDescriptor: descriptor, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Withdraw from the guild bank back into the caller's player_inventory.
  // Officer+ only (world-organizations.js role map). The per-transaction
  // cap scales with org_level — the first real gameplay consequence of
  // guild leveling.
  router.post("/:orgId/bank/withdraw", auth, (req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "db_unavailable" });
    const userId = req.user?.id;
    const { itemDescriptor } = req.body || {};
    const quantity = Number(req.body?.quantity);
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    if (!itemDescriptor || !Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ ok: false, error: "itemDescriptor+quantity required" });
    }
    const prog = getOrgProgression(db, req.params.orgId);
    const cap = WITHDRAW_CAP_PER_LEVEL * (prog?.org_level || 1);
    if (quantity > cap) {
      return res.status(403).json({ ok: false, error: "over_withdraw_cap", cap, orgLevel: prog?.org_level || 1 });
    }
    try {
      const result = withdrawFromOrgInventory(db, userId, req.params.orgId, {
        itemDescriptor, quantity, isOfficer: _isOfficerOf(req.params.orgId),
      });
      if (!result.ok) return res.status(403).json(result);

      const id = `pi_${crypto.randomBytes(8).toString("hex")}`;
      db.prepare(`
        INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity)
        VALUES (?, ?, 'material', ?, ?, ?)
      `).run(id, userId, itemDescriptor, itemDescriptor, quantity);

      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Claim a building the caller personally owns (e.g. a player house — see
  // player-housing.js#claimHouse) as the guild hall. Leader-only. Requires
  // real ownership of the building being donated so a random building can't
  // be seized as a hall.
  router.post("/:orgId/hall/claim", auth, (req, res) => {
    if (!db) return res.status(503).json({ ok: false, error: "db_unavailable" });
    const userId = req.user?.id;
    const { buildingId } = req.body || {};
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    if (!buildingId) return res.status(400).json({ ok: false, error: "buildingId required" });
    try {
      const building = db.prepare(
        `SELECT id, owner_type, owner_id FROM world_buildings WHERE id = ?`
      ).get(buildingId);
      if (!building) return res.status(404).json({ ok: false, error: "no_building" });
      if (building.owner_type !== "player" || building.owner_id !== userId) {
        return res.status(403).json({ ok: false, error: "must_own_building" });
      }
      const result = claimHallBuilding(db, userId, req.params.orgId, buildingId, {
        isLeader: _isLeaderOf(req.params.orgId),
      });
      if (!result.ok) return res.status(403).json(result);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
