// server/routes/world-orgs-extended.js
//
// Extended world-organizations endpoints. world-organizations.js exports
// 19 functions; routes/world.js wires only 8 (createOrganization,
// listOrganizations, etc). The other 11 — alliances, recruitment,
// mentorships, treasury contributions, member roles, party reads,
// org stats — were implemented but never routed. Pre-this-mount these
// features were dark code.
//
// Mount: /api/world-orgs

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

export default function createWorldOrgsExtendedRouter({ requireAuth }) {
  const router = Router();
  const auth = typeof requireAuth === "function" && requireAuth.length === 0 ? requireAuth() : requireAuth;

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

  return router;
}
