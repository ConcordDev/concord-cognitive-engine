/**
 * Connective Tissue Routes
 *
 * Unified API surface that wires the economy engine into every lens.
 * Covers: tipping, bounties, merit credit, DTU creation/publish/list,
 * CRETI scoring, DTU compression, fork mechanism, preview system,
 * cross-lens search, emergent/bot auth, and loan eligibility.
 */

import { Router } from "express";
import {
  tipContent, postBounty, claimBounty,
  awardMeritCredit, getMeritCredit, checkLoanEligibility,
  purchaseDTU,
} from "../economy/lens-economy-wiring.js";
import {
  createDTU, listDTU, recalculateCRETI,
  compressToDMega, compressToHyper,
  forkDTU, getForkTree, getDTUPreview,
  searchDTUs,
} from "../economy/dtu-pipeline.js";
import {
  registerEmergent, registerBot, authenticateBot,
  checkLensAccess, listEntities,
} from "../economy/emergent-auth.js";
import { validateBody, tipSchema, bountyCreateSchema, bountyClaimSchema, purchaseSchema } from "../lib/validators/mutation-schemas.js";

export default function connectiveTissueRoutes({ db, requireAuth }) {
  const router = Router();

  // ── TIPPING ────────────────────────────────────────────────────────

  router.post("/tip", requireAuth(), validateBody(tipSchema), async (req, res) => {
    try {
      const { tipperId, creatorId, contentId, contentType, lensId, amount } = req.body;
      if (!tipperId || !creatorId || !contentId || !contentType || !lensId || amount == null) {
        return res.status(400).json({ error: "Missing required fields: tipperId, creatorId, contentId, contentType, lensId, amount" });
      }
      const result = await tipContent(db, {
        tipperId, creatorId, contentId, contentType, lensId, amount,
        requestId: req.requestId, ip: req.ip,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── BOUNTIES ───────────────────────────────────────────────────────

  router.post("/bounties", requireAuth(), validateBody(bountyCreateSchema), async (req, res) => {
    try {
      const { posterId, title, description, lensId, amount, tags, expiresAt } = req.body;
      if (!posterId || !title || !lensId || amount == null) {
        return res.status(400).json({ error: "Missing required fields: posterId, title, lensId, amount" });
      }
      const result = await postBounty(db, {
        posterId, title, description, lensId, amount, tags, expiresAt,
        requestId: req.requestId, ip: req.ip,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/bounties/:bountyId/claim", requireAuth(), validateBody(bountyClaimSchema), async (req, res) => {
    try {
      const { claimerId, posterId, solutionDtuId } = req.body;
      if (!claimerId || !posterId || !solutionDtuId) {
        return res.status(400).json({ error: "Missing required fields: claimerId, posterId, solutionDtuId" });
      }
      const result = await claimBounty(db, {
        bountyId: req.params.bountyId, claimerId, posterId, solutionDtuId,
        requestId: req.requestId, ip: req.ip,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/bounties", (req, res) => {
    try {
      const { lensId, status, limit, offset } = req.query;
      let sql = "SELECT * FROM bounties WHERE 1=1";
      const params = [];
      if (lensId) { sql += " AND lens_id = ?"; params.push(lensId); }
      if (status) { sql += " AND status = ?"; params.push(status); }
      else { sql += " AND status = 'OPEN'"; }
      sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
      params.push(parseInt(limit) || 50, parseInt(offset) || 0);
      const bounties = db.prepare(sql).all(...params);
      res.json({ ok: true, bounties, count: bounties.length });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── MERIT CREDIT ───────────────────────────────────────────────────

  router.get("/merit/:userId", (req, res) => {
    try {
      const result = getMeritCredit(db, req.params.userId);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/loan-eligibility/:userId", (req, res) => {
    try {
      const result = checkLoanEligibility(db, req.params.userId);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── DTU CREATION & PUBLICATION ─────────────────────────────────────

  router.post("/dtu/create", requireAuth(), async (req, res) => {
    try {
      const result = await createDTU(db, req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/dtu/list", requireAuth(), async (req, res) => {
    try {
      const result = await listDTU(db, req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/dtu/purchase", requireAuth(), validateBody(purchaseSchema), async (req, res) => {
    try {
      const { buyerId, dtuId, sellerId, amount, lensId } = req.body;
      if (!buyerId || !dtuId || !sellerId || amount == null || !lensId) {
        return res.status(400).json({ error: "Missing required fields: buyerId, dtuId, sellerId, amount, lensId" });
      }
      const result = await purchaseDTU(db, {
        buyerId, dtuId, sellerId, amount, lensId,
        requestId: req.requestId, ip: req.ip,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── CRETI SCORING ──────────────────────────────────────────────────

  router.get("/dtu/:dtuId/creti", async (req, res) => {
    try {
      const result = await recalculateCRETI(db, req.params.dtuId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/dtu/:dtuId/creti/recalculate", requireAuth(), async (req, res) => {
    try {
      const result = await recalculateCRETI(db, req.params.dtuId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── DTU COMPRESSION ────────────────────────────────────────────────

  router.post("/dtu/compress/mega", requireAuth(), async (req, res) => {
    try {
      const result = await compressToDMega(db, req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/dtu/compress/hyper", requireAuth(), async (req, res) => {
    try {
      const result = await compressToHyper(db, req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── FORK MECHANISM ─────────────────────────────────────────────────

  router.post("/dtu/fork", requireAuth(), async (req, res) => {
    try {
      const result = await forkDTU(db, req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/dtu/:dtuId/forks", async (req, res) => {
    try {
      const result = await getForkTree(db, req.params.dtuId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── PREVIEW SYSTEM ─────────────────────────────────────────────────

  router.get("/dtu/:dtuId/preview", async (req, res) => {
    try {
      const result = await getDTUPreview(db, req.params.dtuId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── CROSS-LENS SEARCH ─────────────────────────────────────────────

  router.get("/search", async (req, res) => {
    try {
      const { q, lensId, tier, minCreti, maxPrice, sortBy, limit, offset } = req.query;
      const result = await searchDTUs(db, {
        query: q, lensId, tier,
        minCreti: minCreti ? parseInt(minCreti) : 0,
        maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
        sortBy: sortBy || "creti_score",
        limit: parseInt(limit) || 50,
        offset: parseInt(offset) || 0,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Phase Z4 — POST alias for the feed + social lenses which call
  // POST /search with a JSON body instead of GET with query params.
  // AUTH: public — read-only search; /api/connective-tissue is on publicReadPaths (mirrors the public GET /search).
  router.post("/search", async (req, res) => {
    try {
      const { q, query, lensId, tier, minCreti, maxPrice, sortBy, limit, offset } = req.body || {};
      const result = await searchDTUs(db, {
        query: query ?? q,
        lensId, tier,
        minCreti: minCreti != null ? parseInt(minCreti) : 0,
        maxPrice: maxPrice != null ? parseFloat(maxPrice) : undefined,
        sortBy: sortBy || "creti_score",
        limit: limit != null ? parseInt(limit) : 50,
        offset: offset != null ? parseInt(offset) : 0,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── EMERGENT / BOT AUTH ────────────────────────────────────────────

  router.post("/emergent/register", requireAuth(), async (req, res) => {
    try {
      const result = await registerEmergent(db, req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/bot/register", requireAuth(), async (req, res) => {
    try {
      const result = await registerBot(db, req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/bot/auth", requireAuth(), async (req, res) => {
    try {
      if (!req.body.apiKey) {
        return res.status(400).json({ error: "Missing required field: apiKey" });
      }
      const result = await authenticateBot(db, req.body.apiKey);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/entity/:entityId/access/:lensId", async (req, res) => {
    try {
      const result = await checkLensAccess(db, req.params.entityId, req.params.lensId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/entities", async (req, res) => {
    try {
      const { substrate, status, limit, offset } = req.query;
      const result = await listEntities(db, {
        substrate, status,
        limit: parseInt(limit) || 50,
        offset: parseInt(offset) || 0,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
