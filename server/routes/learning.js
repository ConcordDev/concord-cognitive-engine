/**
 * Learning Routes — HTTP surface for the Concord Educational Engine.
 *
 * This file hosts endpoints for the Credential Genome (System 7) and
 * the Education Economics (System 10). All handlers are total: they
 * never throw. On error they respond with { ok: false, error: ... }.
 *
 * External dependencies (royaltyCascade, walletService) are loaded
 * via dynamic import inside handlers so the module is importable even
 * when the surrounding economy is not wired.
 */

import express from "express";
import { createCredentialGenome } from "../lib/credential-genome.js";
import { createEducationEconomics, EDUCATION_RATES } from "../lib/education-economics.js";
import { createProofByCitation } from "../lib/proof-by-citation.js";
import { createSTSVKAssessment } from "../lib/stsvk-assessment.js";
import { getKnowledgeGenome } from "../lib/knowledge-genome.js";
import { createFeasibilityNavigator } from "../lib/feasibility-navigator.js";
import * as embeddingsModule from "../embeddings.js";

// Module-level singletons so the in-memory ledger and credential store
// persist across requests within a single process.
let _economics = null;
let _credentials = null;

async function loadRoyaltyCascade() {
  try {
    const mod = await import("../economy/royalty-cascade.js");
    return (mod && (mod.royaltyCascade || mod.default || mod)) || null;
  } catch (_err) {
    return null;
  }
}

async function loadWalletService() {
  try {
    const mod = await import("../economy/coin-service.js");
    if (!mod) return null;
    const wallet = {};
    if (typeof mod.mintCoins === "function") {
      wallet.credit = async (uid, amt, m) => mod.mintCoins(uid, amt, m);
    }
    if (typeof mod.burnCoins === "function") {
      wallet.debit = async (uid, amt, m) => mod.burnCoins(uid, amt, m);
    }
    if (typeof mod.getBalance === "function") {
      wallet.balance = async (uid) => mod.getBalance(uid);
    }
    return Object.keys(wallet).length ? wallet : null;
  } catch (_err) {
    return null;
  }
}

async function getEconomics() {
  if (_economics) return _economics;
  const [royaltyCascade, walletService] = await Promise.all([
    loadRoyaltyCascade(),
    loadWalletService(),
  ]);
  _economics = createEducationEconomics({
    db: globalThis.concordDb || null,
    royaltyCascade,
    walletService,
  });
  return _economics;
}

function getCredentials() {
  if (_credentials) return _credentials;
  const dtuStore = globalThis.dtuStore || null;
  const knowledgeGenome =
    (globalThis.knowledgeGenome && typeof globalThis.knowledgeGenome === "function")
      ? globalThis.knowledgeGenome
      : async (_studentId) => ({});
  _credentials = createCredentialGenome({
    dtuStore,
    knowledgeGenome,
    db: globalThis.concordDb || null,
  });
  return _credentials;
}

function getCallerId(req) {
  if (!req) return "anonymous";
  return (
    (req.user && (req.user.id || req.user.userId)) ||
    req.query.studentId ||
    (req.body && req.body.studentId) ||
    "anonymous"
  );
}

export default function createLearningRouter(opts = {}) {
  const router = express.Router();

  // ------------------------------------------------------------------
  // Shared helpers for the learning-substrate endpoints (Systems 1+2).
  // These live inside the factory so they can close over `opts` /
  // globalThis fallbacks; they never throw.
  // ------------------------------------------------------------------
  const STATE = opts.STATE || globalThis.STATE || null;
  const injectedDtuStore = opts.dtuStore || null;
  const requireAuth =
    typeof opts.requireAuth === "function"
      ? opts.requireAuth
      : (_req, _res, next) => next();

  const resolveDtuStore = () =>
    injectedDtuStore ||
    (STATE && STATE.dtus) ||
    globalThis.dtuStore ||
    null;
  const resolveDb = () =>
    (STATE && STATE.db) || globalThis.concordDb || null;

  const substrateDeps = () => ({
    dtuStore: resolveDtuStore(),
    embeddings: embeddingsModule,
    db: resolveDb(),
  });

  let _navigator = null;
  const getNavigator = () => {
    if (_navigator) return _navigator;
    _navigator = createFeasibilityNavigator({
      dtuStore: resolveDtuStore(),
      embeddings: embeddingsModule,
    });
    return _navigator;
  };

  const userIdFor = (req) => {
    if (!req) return "anonymous";
    return String(
      (req.user && (req.user.id || req.user.userId)) ||
        (req.body && req.body.studentId) ||
        req.query.studentId ||
        "anonymous",
    );
  };

  // ------------------------------------------------------------------
  // SYSTEM 1: Knowledge Genome
  // ------------------------------------------------------------------

  // POST /api/learning/interaction — record a DTU interaction
  router.post("/interaction", requireAuth, async (req, res) => {
    try {
      const body = req.body || {};
      const { dtuId, type = "read" } = body;
      if (!dtuId || typeof dtuId !== "string") {
        return res.json({ ok: false, error: "dtuId_required" });
      }
      const genome = await getKnowledgeGenome(userIdFor(req), substrateDeps());
      const result = await genome.recordInteraction(dtuId, type);
      return res.json({ ok: true, result, summary: genome.toSummary() });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // GET /api/learning/genome — summary of the caller's knowledge genome
  router.get("/genome", requireAuth, async (req, res) => {
    try {
      const genome = await getKnowledgeGenome(userIdFor(req), substrateDeps());
      return res.json({
        ok: true,
        summary: genome.toSummary(),
        strongest: genome.getStrongestNodes(20),
      });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // GET /api/learning/genome/graph — visualization graph
  router.get("/genome/graph", requireAuth, async (req, res) => {
    try {
      const genome = await getKnowledgeGenome(userIdFor(req), substrateDeps());
      return res.json({ ok: true, graph: genome.toGraph() });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // GET /api/learning/gaps — knowledge gaps + domain strengths
  router.get("/gaps", requireAuth, async (req, res) => {
    try {
      const genome = await getKnowledgeGenome(userIdFor(req), substrateDeps());
      await genome.recalculateGaps();
      const store = resolveDtuStore();
      const gaps = Array.from(genome.gaps).map((id) => {
        let dtu = null;
        try {
          if (store && typeof store.get === "function") dtu = store.get(id);
        } catch (_e) { /* swallow */ }
        return {
          id,
          title: (dtu && dtu.title) || id,
          tier: (dtu && dtu.tier) || "regular",
          tags: (dtu && dtu.tags) || [],
          mastery: genome.nodes.get(id) || 0,
        };
      });
      return res.json({
        ok: true,
        gaps,
        strengths: Array.from(genome.strengths),
      });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // SYSTEM 2: Feasibility Navigator
  // ------------------------------------------------------------------

  // GET /api/learning/frontier — reachable frontier
  router.get("/frontier", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query && req.query.limit) || 20, 100);
      const maxDistance = Math.min(
        Number(req.query && req.query.maxDistance) || 0.4,
        1,
      );
      const genome = await getKnowledgeGenome(userIdFor(req), substrateDeps());
      const nav = getNavigator();
      const frontier = await nav.getReachableFrontier(genome, {
        limit,
        maxDistance,
      });
      return res.json({
        ok: true,
        frontier: frontier.map((f) => ({
          id: f.id,
          readiness: f.readiness,
          distance: f.distance,
          title: (f.dtu && f.dtu.title) || f.id,
          tier: (f.dtu && f.dtu.tier) || "regular",
          tags: (f.dtu && f.dtu.tags) || [],
        })),
      });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // POST /api/learning/path — find a learning path into a target domain
  router.post("/path", requireAuth, async (req, res) => {
    try {
      const body = req.body || {};
      const targetDomain = body.targetDomain;
      const targetDepth = Number(body.targetDepth) || 3;
      if (!targetDomain || typeof targetDomain !== "string") {
        return res.json({ ok: false, error: "targetDomain_required" });
      }
      const genome = await getKnowledgeGenome(userIdFor(req), substrateDeps());
      const nav = getNavigator();
      const plan = await nav.findPath(genome, targetDomain, targetDepth);
      return res.json({
        ok: true,
        plan: {
          cost: plan.cost,
          classification: plan.classification,
          branchingPoints: plan.branchingPoints,
          path: (plan.path || []).map((d) => ({
            id: d && d.id,
            title: (d && d.title) || (d && d.id),
            tier: (d && d.tier) || "regular",
            tags: (d && d.tags) || [],
            estimatedMinutes: genome.estimateTime(d),
            readiness: genome.calculateReadiness(d),
          })),
        },
      });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // GET /api/learning/credential/me/:domain
  // Shorthand — uses the authenticated caller's identity as studentId.
  // Must be declared BEFORE /:studentId/:domain so "me" isn't captured
  // as a param value.
  // ------------------------------------------------------------------
  router.get("/credential/me/:domain", async (req, res) => {
    try {
      const studentId = getCallerId(req);
      if (!studentId || studentId === "anonymous") {
        return res.json({ ok: false, error: "authentication_required" });
      }
      const { domain } = req.params;
      const creds = getCredentials();
      const economics = await getEconomics();
      let charge = null;
      try {
        charge = await economics.chargeCredentialGeneration(studentId);
      } catch (_err) {
        charge = { ok: false, error: "charge_failed" };
      }
      const credential = await creds.generateCredential(studentId, domain);
      return res.json({ ok: true, credential, charge });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // GET /api/learning/credential/:studentId/:domain
  // Generate a credential (charges credentialGeneration).
  // ------------------------------------------------------------------
  router.get("/credential/:studentId/:domain", async (req, res) => {
    try {
      const { studentId, domain } = req.params;
      const creds = getCredentials();
      const economics = await getEconomics();

      // Charge generation cost (0 if free)
      let charge = null;
      try {
        charge = await economics.chargeCredentialGeneration(studentId);
      } catch (_err) {
        charge = { ok: false, error: "charge_failed" };
      }

      const credential = await creds.generateCredential(studentId, domain);
      return res.json({ ok: true, credential, charge });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // POST /api/learning/credential/verify
  // Body: { studentId, domain, credential }
  // ------------------------------------------------------------------
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/credential/verify", async (req, res) => {
    try {
      const body = req.body || {};
      const { studentId, domain, credential } = body;
      if (!credential) {
        return res.json({ ok: false, error: "credential_required" });
      }
      const creds = getCredentials();
      const result = await creds.verify(
        studentId || credential.studentId,
        domain || credential.domain,
        credential,
      );
      return res.json({ ok: true, ...result });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // GET /api/learning/verify/:studentId/:domain
  // Companion read-only verification URL referenced by generated credentials.
  // ------------------------------------------------------------------
  router.get("/verify/:studentId/:domain", async (req, res) => {
    try {
      const { studentId, domain } = req.params;
      const creds = getCredentials();
      const list = await creds.listCredentials(studentId);
      const latest = (list || []).filter((c) => c.domain === domain).pop() || null;
      if (!latest) {
        return res.json({ ok: false, error: "no_credentials_found" });
      }
      const result = await creds.verify(studentId, domain, latest);
      return res.json({ ok: true, credential: latest, ...result });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // GET /api/learning/earnings/me
  // Returns education earnings for the calling user.
  // ------------------------------------------------------------------
  router.get("/earnings/me", async (req, res) => {
    try {
      const studentId = getCallerId(req);
      const since = req.query.since ? Number(req.query.since) : 0;
      const economics = await getEconomics();
      const earnings = await economics.getStudentEarnings(studentId, { since });
      return res.json(earnings);
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // GET /api/learning/leaderboard
  // ?domain=...&timeframe=day|week|month|year|all
  // ------------------------------------------------------------------
  router.get("/leaderboard", async (req, res) => {
    try {
      const domain = req.query.domain ? String(req.query.domain) : undefined;
      const timeframe = req.query.timeframe ? String(req.query.timeframe) : "month";
      const economics = await getEconomics();
      const board = await economics.getLeaderboard({ domain, timeframe });
      return res.json(board);
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // GET /api/learning/rates
  // Public rate card for the education economy.
  // ------------------------------------------------------------------
  router.get("/rates", async (_req, res) => {
    try {
      return res.json({ ok: true, rates: EDUCATION_RATES });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ==================================================================
  // SYSTEM 8: Lens Expansion Engine
  // ==================================================================
  // Routes for batch-registering 225+ new domain lenses via the Lens
  // Developer Kit. All handlers lazy-import their dependencies, never
  // throw, and respond with { ok, ... } envelopes.
  // ------------------------------------------------------------------

  /**
   * Lazy-load the LensExpansionEngine with whatever dependencies exist
   * in this process. Returns { engine, EXPANSION_DOMAINS, error? }.
   */
  async function loadExpansionEngine() {
    try {
      const expansion = await import("../lib/lens-expansion.js");
      const ldk = await import("../lib/lens-developer-kit.js").catch(() => null);
      const lensManifest = await import("../lib/lens-manifest.js").catch(() => null);
      const brainServiceMod = await import("../lib/brain-service.cjs").catch(() => null);
      const dtuStoreMod = await import("../lib/dtu-store.js").catch(() => null);
      const engine = expansion.createLensExpansionEngine({
        lensDeveloperKit: ldk || null,
        lensManifest: lensManifest || null,
        brainService: brainServiceMod ? (brainServiceMod.default || brainServiceMod) : null,
        dtuStore: globalThis.dtuStore || (dtuStoreMod ? (dtuStoreMod.default || dtuStoreMod) : null),
        entitySystem: globalThis.entitySystem || null,
        rateLimitMs: 25,
      });
      return { engine, EXPANSION_DOMAINS: expansion.EXPANSION_DOMAINS };
    } catch (err) {
      return { engine: null, error: String((err && err.message) || err) };
    }
  }

  /**
   * Lazy-load the HybridLensDiscovery engine.
   */
  async function loadHybridEngine() {
    try {
      const hybridMod = await import("../lib/hybrid-lens-discovery.js");
      const embeddingsMod = await import("../lib/embeddings.js").catch(() => null);
      const lensManifest = await import("../lib/lens-manifest.js").catch(() => null);
      const dtuStoreMod = await import("../lib/dtu-store.js").catch(() => null);
      const engine = hybridMod.createHybridLensDiscovery({
        dtuStore: globalThis.dtuStore || (dtuStoreMod ? (dtuStoreMod.default || dtuStoreMod) : null),
        embeddings: embeddingsMod ? (embeddingsMod.default || embeddingsMod) : null,
        lensManifest: lensManifest || null,
      });
      return { engine, MANUAL_HYBRIDS: hybridMod.MANUAL_HYBRIDS };
    } catch (err) {
      return { engine: null, error: String((err && err.message) || err) };
    }
  }

  // ------------------------------------------------------------------
  // POST /api/learning/expand/category
  // Body: { category }
  // Expand every lens in a single category.
  // ------------------------------------------------------------------
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/expand/category", async (req, res) => {
    try {
      const { category } = req.body || {};
      if (!category || typeof category !== "string") {
        return res.json({ ok: false, error: "'category' is required (string)." });
      }
      const { engine, error } = await loadExpansionEngine();
      if (!engine) {
        return res.json({ ok: false, error: error || "expansion_engine_unavailable" });
      }
      const result = await engine.expandCategory(category);
      return res.json({ ok: true, ...result });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // POST /api/learning/expand/all
  // Expand every category in sequence, rate-limited internally.
  // ------------------------------------------------------------------
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/expand/all", async (_req, res) => {
    try {
      const { engine, error } = await loadExpansionEngine();
      if (!engine) {
        return res.json({ ok: false, error: error || "expansion_engine_unavailable" });
      }
      const result = await engine.expandAll();
      return res.json({ ok: true, ...result });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // GET /api/learning/expand/domains
  // List the full expansion catalog: categories, domains, counts.
  // ------------------------------------------------------------------
  router.get("/expand/domains", async (_req, res) => {
    try {
      const { EXPANSION_DOMAINS, error } = await loadExpansionEngine();
      if (!EXPANSION_DOMAINS) {
        return res.json({ ok: false, error: error || "expansion_domains_unavailable" });
      }
      const counts = {};
      let total = 0;
      for (const [cat, domains] of Object.entries(EXPANSION_DOMAINS)) {
        counts[cat] = domains.length;
        total += domains.length;
      }
      return res.json({
        ok: true,
        total,
        categories: Object.keys(EXPANSION_DOMAINS),
        counts,
        domains: EXPANSION_DOMAINS,
      });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ==================================================================
  // SYSTEM 9: Hybrid Lens Discovery
  // ==================================================================

  // ------------------------------------------------------------------
  // POST /api/learning/hybrids/discover
  // Body: { minDTUCount? }
  // Run a cross-domain DTU scan and propose new hybrids.
  // ------------------------------------------------------------------
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/hybrids/discover", async (req, res) => {
    try {
      const { minDTUCount } = req.body || {};
      const { engine, error } = await loadHybridEngine();
      if (!engine) {
        return res.json({ ok: false, error: error || "hybrid_engine_unavailable" });
      }
      const result = await engine.discoverHybrids({
        minDTUCount: typeof minDTUCount === "number" ? minDTUCount : 5,
      });
      return res.json(result);
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // GET /api/learning/hybrids
  // Return manual + most-recently-discovered hybrids. No scan.
  // ------------------------------------------------------------------
  router.get("/hybrids", async (_req, res) => {
    try {
      const { engine, MANUAL_HYBRIDS, error } = await loadHybridEngine();
      if (!engine) {
        return res.json({ ok: false, error: error || "hybrid_engine_unavailable" });
      }
      return res.json({
        ok: true,
        manual: MANUAL_HYBRIDS || engine.getManualHybrids(),
        discovered: engine.getDiscovered(),
      });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // POST /api/learning/hybrids/register
  // Body: { name, domains:[d1,d2,...], description? }
  // Register a new hybrid lens with the lens manifest.
  // ------------------------------------------------------------------
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/hybrids/register", async (req, res) => {
    try {
      const hybrid = req.body || {};
      if (!hybrid.name || !Array.isArray(hybrid.domains) || hybrid.domains.length < 2) {
        return res.json({
          ok: false,
          error: "body_requires_name_and_domains_array_of_two_or_more",
        });
      }
      const { engine, error } = await loadHybridEngine();
      if (!engine) {
        return res.json({ ok: false, error: error || "hybrid_engine_unavailable" });
      }
      const result = await engine.registerHybrid(hybrid);
      return res.json(result);
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ==================================================================
  // SYSTEM 3: Proof by Citation — assignments as DTU creation
  // SYSTEM 6: STSVK Assessment — ungameable tests
  // ==================================================================

  // Lazily-instantiated singletons for the PBC and assessment services.
  let _pbc = null;
  let _assess = null;
  let _assessmentStore = null;

  const getAssessmentStore = () => {
    if (_assessmentStore) return _assessmentStore;
    const globalState = globalThis.STATE || null;
    if (
      globalState &&
      globalState.assessments &&
      typeof globalState.assessments.set === "function"
    ) {
      _assessmentStore = globalState.assessments;
      return _assessmentStore;
    }
    const m = new Map();
    if (globalState) globalState.assessments = m;
    _assessmentStore = m;
    return _assessmentStore;
  };

  const getPBC = () => {
    if (_pbc) return _pbc;
    _pbc = createProofByCitation({
      dtuStore: globalThis.dtuStore || null,
      brainService: globalThis.brainService || null,
      chicken2Gate: globalThis.chicken2Gate || null,
      embeddings: globalThis.embeddings || null,
      economy: globalThis.economy || null,
    });
    return _pbc;
  };

  // Default genome resolver: scans the DTU store for DTUs credited to
  // the student (either creatorId or tagged student:<id>).
  const defaultGenome = async (studentId) => {
    const out = { studentId, claimed: [], byDomain: {} };
    const store = globalThis.dtuStore || null;
    if (!store || typeof store.values !== "function") return out;
    try {
      for (const dtu of store.values()) {
        if (!dtu || typeof dtu !== "object") continue;
        const creator = dtu.creatorId || (dtu.core && dtu.core.studentId) || null;
        const tags = Array.isArray(dtu.tags) ? dtu.tags : [];
        const taggedForStudent = tags.some(
          (t) => typeof t === "string" && t === `student:${studentId}`,
        );
        if (creator === studentId || taggedForStudent) {
          out.claimed.push(dtu.id);
          const dom =
            dtu.domain || dtu.lens || (dtu.core && dtu.core.domain) || "general";
          (out.byDomain[dom] = out.byDomain[dom] || []).push(dtu.id);
        }
      }
    } catch (_e) {
      // noop
    }
    return out;
  };

  const getAssessment = () => {
    if (_assess) return _assess;
    const genome =
      globalThis.knowledgeGenome &&
      typeof globalThis.knowledgeGenome === "function"
        ? globalThis.knowledgeGenome
        : defaultGenome;
    _assess = createSTSVKAssessment({
      dtuStore: globalThis.dtuStore || null,
      brainService: globalThis.brainService || null,
      chicken2Gate: globalThis.chicken2Gate || null,
      embeddings: globalThis.embeddings || null,
      knowledgeGenome: genome,
      assessmentStore: getAssessmentStore(),
    });
    return _assess;
  };

  // ------------------------------------------------------------------
  // POST /api/learning/submit
  // Body: { studentId?, claim, citations: [dtuId], domain?, type?, title? }
  // Proof-by-Citation submission.
  // ------------------------------------------------------------------
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/submit", async (req, res) => {
    try {
      const body = req.body || {};
      const studentId = String(body.studentId || getCallerId(req));
      const submission = {
        claim: body.claim,
        citations: body.citations,
        domain: body.domain,
        type: body.type,
        title: body.title,
      };
      if (!submission.claim) {
        return res.json({ ok: false, error: "claim_required" });
      }
      if (
        !Array.isArray(submission.citations) ||
        submission.citations.length === 0
      ) {
        return res.json({ ok: false, error: "citations_required" });
      }
      const pbc = getPBC();
      const evaluation = await pbc.evaluateSubmission(studentId, submission);
      return res.json({ ok: true, evaluation });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // POST /api/learning/assessment/generate
  // Body: { studentId?, domain, difficulty? }
  // Generate a STSVK assessment.
  // ------------------------------------------------------------------
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/assessment/generate", async (req, res) => {
    try {
      const body = req.body || {};
      const studentId = String(body.studentId || getCallerId(req));
      const domain = String(body.domain || "general");
      const difficulty = String(body.difficulty || "medium");
      const svc = getAssessment();
      const assessment = await svc.generateAssessment(
        studentId,
        domain,
        difficulty,
      );
      return res.json({ ok: true, assessment });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // POST /api/learning/assessment/grade
  // Body: { studentId?, assessmentId, responses: [{questionId, claim, citations[]}] }
  // Grade a student's assessment responses.
  // ------------------------------------------------------------------
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/assessment/grade", async (req, res) => {
    try {
      const body = req.body || {};
      const studentId = String(body.studentId || getCallerId(req));
      const assessmentId = String(body.assessmentId || "");
      const responses = Array.isArray(body.responses) ? body.responses : [];
      if (!assessmentId) {
        return res.json({ ok: false, error: "assessmentId_required" });
      }
      const svc = getAssessment();
      const result = await svc.gradeAssessment(
        studentId,
        assessmentId,
        responses,
      );
      return res.json({ ok: true, result });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // GET /api/learning/assessments/:studentId
  // History of assessments for a student.
  // ------------------------------------------------------------------
  router.get("/assessments/:studentId", async (req, res) => {
    try {
      const studentId = String(req.params.studentId || "");
      if (!studentId) {
        return res.json({ ok: false, error: "studentId_required" });
      }
      const svc = getAssessment();
      const assessments = svc.listAssessmentsForStudent(studentId);
      return res.json({
        ok: true,
        studentId,
        count: assessments.length,
        assessments,
      });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // GET /api/learning/proof-stats
  // Combined PBC + assessment service statistics.
  // ------------------------------------------------------------------
  router.get("/proof-stats", async (_req, res) => {
    try {
      const pbc = getPBC();
      const svc = getAssessment();
      return res.json({
        ok: true,
        proofByCitation: pbc.getStats(),
        assessments: svc.getStats(),
      });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ==================================================================
  // SYSTEM 4: Entity Tutors
  // ==================================================================
  // Lazy loader for the entity-tutor module. Never throws.
  let _entityTutorMod = null;
  async function loadTutorMod() {
    if (_entityTutorMod) return _entityTutorMod;
    try {
      _entityTutorMod = await import("../lib/entity-tutor.js");
    } catch (_err) {
      _entityTutorMod = null;
    }
    return _entityTutorMod;
  }

  /**
   * POST /api/learning/tutor/ask
   * Body: { studentId?, domain, query }
   * Ask a domain-specialized entity tutor for help. Never throws;
   * falls back to a heuristic response when brains are unavailable.
   */
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/tutor/ask", async (req, res) => {
    try {
      const body = req.body || {};
      const { domain, query } = body;
      const studentId = getCallerId(req);
      if (!studentId || !domain || !query) {
        return res.json({
          ok: false,
          error: "studentId, domain, and query are required",
        });
      }
      const mod = await loadTutorMod();
      if (!mod || typeof mod.getTutorForDomain !== "function") {
        return res.json({
          ok: true,
          fallback: true,
          response:
            "Tutor subsystem is offline. Try reviewing DTUs in this domain while I reconnect.",
          citations: [],
          gapsAddressed: [],
          nextRecommendation: null,
          checkQuestion: "What part of this topic would you like to explore first?",
        });
      }
      const tutor = await mod.getTutorForDomain(String(domain).toLowerCase());
      const out = await tutor.teach(studentId, query);
      return res.json(out);
    } catch (err) {
      return res.json({
        ok: true,
        fallback: true,
        response: "I was unable to process that right now.",
        citations: [],
        gapsAddressed: [],
        nextRecommendation: null,
        checkQuestion: "Can you rephrase your question?",
        error: String((err && err.message) || err),
      });
    }
  });

  /**
   * POST /api/learning/tutor/socratic
   * Body: { studentId?, domain, claim }
   * Generate Socratic questions that challenge a student's claim.
   */
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/tutor/socratic", async (req, res) => {
    try {
      const body = req.body || {};
      const { domain, claim } = body;
      const studentId = getCallerId(req);
      if (!studentId || !domain || !claim) {
        return res.json({
          ok: false,
          error: "studentId, domain, and claim are required",
        });
      }
      const mod = await loadTutorMod();
      if (!mod || typeof mod.getTutorForDomain !== "function") {
        return res.json({
          ok: true,
          fallback: true,
          questions: [
            "What evidence would you expect to see if your claim were true?",
            "What evidence would make you reconsider it?",
            "If your claim is correct, what are its limits?",
          ],
          supportingDTUs: [],
          contradictingDTUs: [],
        });
      }
      const tutor = await mod.getTutorForDomain(String(domain).toLowerCase());
      const out = await tutor.socraticChallenge(studentId, claim);
      return res.json(out);
    } catch (err) {
      return res.json({
        ok: true,
        fallback: true,
        questions: [
          "What evidence would you expect to see if your claim were true?",
          "What evidence would make you reconsider it?",
          "If your claim is correct, what are its limits?",
        ],
        supportingDTUs: [],
        contradictingDTUs: [],
        error: String((err && err.message) || err),
      });
    }
  });

  // ==================================================================
  // SYSTEM 5: Learning Cohorts
  // ==================================================================
  // Lazy loader for the learning-cohorts module. Never throws.
  let _cohortMod = null;
  async function loadCohortMod() {
    if (_cohortMod) return _cohortMod;
    try {
      _cohortMod = await import("../lib/learning-cohorts.js");
    } catch (_err) {
      _cohortMod = null;
    }
    return _cohortMod;
  }

  // ------------------------------------------------------------------
  // GET /api/learning/submissions/mine
  // List proof-by-citation submissions made by the calling user.
  // ------------------------------------------------------------------
  router.get("/submissions/mine", async (req, res) => {
    try {
      const studentId = getCallerId(req);
      if (!studentId || studentId === "anonymous") {
        return res.json({ ok: false, error: "authentication_required" });
      }
      const pbc = getPBC();
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      let submissions = [];
      try {
        if (typeof pbc.listSubmissions === "function") {
          submissions = await pbc.listSubmissions(studentId, { limit, offset });
        } else if (typeof pbc.getStats === "function") {
          const stats = pbc.getStats();
          submissions = (stats?.recentSubmissions || []).filter(
            (s) => s.studentId === studentId
          ).slice(offset, offset + limit);
        }
      } catch (_err) { /* non-fatal */ }
      return res.json({ ok: true, studentId, submissions, count: submissions.length });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  // ------------------------------------------------------------------
  // GET /api/learning/dtus/search
  // Query: { q, domain?, limit? }
  // Full-text search across DTU titles and descriptions.
  // ------------------------------------------------------------------
  router.get("/dtus/search", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (!q || q.length < 2) {
        return res.json({ ok: false, error: "q must be at least 2 characters" });
      }
      const domain = req.query.domain ? String(req.query.domain).toLowerCase() : null;
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

      const store = resolveDtuStore();
      const results = [];
      const qLower = q.toLowerCase();

      if (store && typeof store.values === "function") {
        for (const dtu of store.values()) {
          if (!dtu || typeof dtu !== "object") continue;
          if (domain) {
            const dtuDomain = (dtu.domain || dtu.lens || (dtu.core && dtu.core.domain) || "").toLowerCase();
            if (dtuDomain !== domain) continue;
          }
          const title = String(dtu.title || (dtu.core && dtu.core.title) || dtu.id || "").toLowerCase();
          const desc = String(dtu.description || (dtu.core && dtu.core.description) || "").toLowerCase();
          const tags = (Array.isArray(dtu.tags) ? dtu.tags : []).join(" ").toLowerCase();
          if (title.includes(qLower) || desc.includes(qLower) || tags.includes(qLower)) {
            results.push({
              id: dtu.id,
              title: dtu.title || (dtu.core && dtu.core.title) || dtu.id,
              domain: dtu.domain || dtu.lens || (dtu.core && dtu.core.domain) || null,
              tags: Array.isArray(dtu.tags) ? dtu.tags : [],
            });
            if (results.length >= limit) break;
          }
        }
      }

      return res.json({ ok: true, q, results, count: results.length });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  /**
   * GET /api/learning/cohort/match
   * Finds a suitable existing cohort for the calling student, or suggests
   * forming one, based on the caller's knowledge genome and domain interests.
   * Declared BEFORE /cohort/:id so "match" is not captured as an id param.
   */
  router.get("/cohort/match", async (req, res) => {
    try {
      const studentId = getCallerId(req);
      if (!studentId || studentId === "anonymous") {
        return res.json({ ok: false, error: "authentication_required" });
      }
      const domain = req.query.domain ? String(req.query.domain).toLowerCase() : null;

      const mod = await loadCohortMod();
      if (!mod || typeof mod.getDefaultLearningCohorts !== "function") {
        return res.json({
          ok: true,
          fallback: true,
          match: null,
          suggestion: { action: "form", studentIds: [studentId], domain: domain || "general" },
        });
      }

      const cohorts = await mod.getDefaultLearningCohorts();

      // If the cohort module exposes matchStudent, use it
      if (typeof cohorts.matchStudent === "function") {
        const out = await cohorts.matchStudent(studentId, { domain });
        return res.json(out);
      }

      // Fallback: find cohorts the student is already in for this domain
      const mine = await cohorts.listCohortsForStudent(studentId);
      const domainMatch = domain
        ? (mine.cohorts || []).find((c) => c.domain === domain)
        : (mine.cohorts || [])[0] || null;

      return res.json({
        ok: true,
        match: domainMatch || null,
        suggestion: domainMatch
          ? null
          : { action: "form", studentIds: [studentId], domain: domain || "general" },
      });
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  /**
   * POST /api/learning/cohort/teach
   * Alias for /cohort/peer-teach — same semantics, matches the frontend
   * route name. Body: { teacherId?, learnerId, dtuId }
   */
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/cohort/teach", async (req, res) => {
    try {
      const body = req.body || {};
      const { learnerId, dtuId } = body;
      const teacherId = body.teacherId || getCallerId(req);
      if (!teacherId || !learnerId || !dtuId) {
        return res.json({
          ok: false,
          error: "teacherId, learnerId, and dtuId are required",
        });
      }
      const mod = await loadCohortMod();
      if (!mod || typeof mod.getDefaultLearningCohorts !== "function") {
        return res.json({
          ok: true,
          fallback: true,
          teacherMasteryDelta: 0.6,
          learnerMasteryDelta: 0.1,
          creditsPaid: 0,
        });
      }
      const cohorts = await mod.getDefaultLearningCohorts();
      const out = await cohorts.peerTeach(teacherId, learnerId, dtuId);
      return res.json(out);
    } catch (err) {
      return res.json({
        ok: false,
        teacherMasteryDelta: 0,
        learnerMasteryDelta: 0,
        creditsPaid: 0,
        error: String((err && err.message) || err),
      });
    }
  });

  /**
   * POST /api/learning/cohort/form
   * Body: { studentIds:[...], domain, maxSize? }
   * Match students into peer-learning cohorts based on genome similarity
   * and complementarity (complementarity weighted higher).
   */
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/cohort/form", async (req, res) => {
    try {
      const body = req.body || {};
      const { studentIds, domain, maxSize } = body;
      if (!Array.isArray(studentIds) || studentIds.length < 2 || !domain) {
        return res.json({
          ok: false,
          error: "studentIds (>=2) and domain are required",
        });
      }
      const mod = await loadCohortMod();
      if (!mod || typeof mod.getDefaultLearningCohorts !== "function") {
        return res.json({
          ok: true,
          fallback: true,
          cohorts: [
            {
              id: `cohort-fallback-${Date.now().toString(36)}`,
              students: studentIds.slice(0, Number(maxSize) || 5),
              domain,
              formed: Date.now(),
              meta: { fallback: true },
            },
          ],
        });
      }
      const cohorts = await mod.getDefaultLearningCohorts();
      const out = await cohorts.formCohort(
        studentIds,
        String(domain).toLowerCase(),
        Number(maxSize) || 5,
      );
      return res.json(out);
    } catch (err) {
      return res.json({
        ok: false,
        cohorts: [],
        error: String((err && err.message) || err),
      });
    }
  });

  /**
   * POST /api/learning/cohort/peer-teach
   * Body: { teacherId?, learnerId, dtuId }
   * Record a peer-teaching event. Teacher earns +0.6 mastery and CC
   * credits; learner earns +0.1 mastery.
   */
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/cohort/peer-teach", async (req, res) => {
    try {
      const body = req.body || {};
      const { learnerId, dtuId } = body;
      const teacherId = body.teacherId || getCallerId(req);
      if (!teacherId || !learnerId || !dtuId) {
        return res.json({
          ok: false,
          error: "teacherId, learnerId, and dtuId are required",
        });
      }
      const mod = await loadCohortMod();
      if (!mod || typeof mod.getDefaultLearningCohorts !== "function") {
        return res.json({
          ok: true,
          fallback: true,
          teacherMasteryDelta: 0.6,
          learnerMasteryDelta: 0.1,
          creditsPaid: 0,
        });
      }
      const cohorts = await mod.getDefaultLearningCohorts();
      const out = await cohorts.peerTeach(teacherId, learnerId, dtuId);
      return res.json(out);
    } catch (err) {
      return res.json({
        ok: false,
        teacherMasteryDelta: 0,
        learnerMasteryDelta: 0,
        creditsPaid: 0,
        error: String((err && err.message) || err),
      });
    }
  });

  /**
   * GET /api/learning/cohort/mine
   * Returns cohorts the calling student belongs to.
   * Declared BEFORE /cohort/:id so the literal "mine" is not captured
   * as an id parameter.
   */
  router.get("/cohort/mine", async (req, res) => {
    try {
      const studentId = getCallerId(req);
      if (!studentId || studentId === "anonymous") {
        return res.json({ ok: false, error: "studentId is required" });
      }
      const mod = await loadCohortMod();
      if (!mod || typeof mod.getDefaultLearningCohorts !== "function") {
        return res.json({ ok: true, fallback: true, cohorts: [] });
      }
      const cohorts = await mod.getDefaultLearningCohorts();
      const out = await cohorts.listCohortsForStudent(studentId);
      return res.json(out);
    } catch (err) {
      return res.json({
        ok: true,
        cohorts: [],
        error: String((err && err.message) || err),
      });
    }
  });

  /**
   * GET /api/learning/cohort/:id
   * Retrieve a specific cohort by id.
   */
  router.get("/cohort/:id", async (req, res) => {
    try {
      const id = req.params.id;
      if (!id) return res.json({ ok: false, error: "id required" });
      const mod = await loadCohortMod();
      if (!mod || typeof mod.getDefaultLearningCohorts !== "function") {
        return res.json({ ok: false, error: "cohort subsystem unavailable" });
      }
      const cohorts = await mod.getDefaultLearningCohorts();
      const out = await cohorts.getCohort(id);
      return res.json(out);
    } catch (err) {
      return res.json({ ok: false, error: String((err && err.message) || err) });
    }
  });

  return router;
}
