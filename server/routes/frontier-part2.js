/**
 * Frontier API Routes — Part 2
 *
 * REST endpoints for the Concord Frontier platform (features 5–8):
 *
 * Notebooks:
 *   POST   /api/frontier/notebooks                        — create notebook
 *   GET    /api/frontier/notebooks/user/:userId            — list user notebooks
 *   GET    /api/frontier/notebooks/:id                     — get notebook
 *   PUT    /api/frontier/notebooks/:id                     — update notebook
 *   POST   /api/frontier/notebooks/:id/cells/:cellIndex/run — run cell
 *
 * Service Marketplace:
 *   GET    /api/frontier/marketplace/listings              — list listings
 *   POST   /api/frontier/marketplace/listings              — create listing
 *   GET    /api/frontier/marketplace/listings/:id          — get listing
 *   POST   /api/frontier/marketplace/orders                — create order
 *   GET    /api/frontier/marketplace/orders/:userId        — list user orders
 *   POST   /api/frontier/marketplace/reviews               — create review
 *
 * Education/Certificates:
 *   GET    /api/frontier/certificates/paths                — list learning paths
 *   GET    /api/frontier/certificates/paths/:id            — get path with modules
 *   POST   /api/frontier/certificates/enroll               — enroll in path
 *   POST   /api/frontier/certificates/progress             — update progress
 *   GET    /api/frontier/certificates/user/:userId         — user enrollments
 *
 * Federation:
 *   GET    /api/frontier/federation/instances              — list instances
 *   POST   /api/frontier/federation/connect                — connect to instance
 *   POST   /api/frontier/federation/sync                   — trigger sync
 *   GET    /api/frontier/federation/sync-log/:instanceId   — sync history
 */

import { Router } from "express";
import crypto from "crypto";
import { LruMap, LruSet } from "../lib/lru-map.js";
const logger = console;

// ── In-memory stores ──────────────────────────────────────────────────────────

const notebooks = new LruMap();

const marketplaceListings = new LruMap();
const marketplaceOrders = new LruMap();
const marketplaceReviews = new LruMap();

const learningPaths = new LruMap();
const enrollments = new LruMap();     // key: `${userId}:${pathId}`
const certificates = new LruMap();    // key: `${userId}:${pathId}`

const federationInstances = new LruMap();
const syncLogs = new LruMap();        // key: instanceId -> array of log entries

// ── Seed data ─────────────────────────────────────────────────────────────────

function seedMarketplace() {
  const seeds = [
    { title: "DTU Validator Pro", description: "Enterprise-grade DTU validation service", category: "validation", price: 29, tier: "standard" },
    { title: "NPC Dialog Engine", description: "AI-powered NPC dialog generation", category: "ai", price: 49, tier: "professional" },
    { title: "Terrain Generator HD", description: "High-definition procedural terrain generation", category: "procgen", price: 19, tier: "basic" },
    { title: "Real-time Sync Plus", description: "Low-latency real-time synchronization infrastructure", category: "infrastructure", price: 39, tier: "professional" },
    { title: "Physics Sandbox Pro", description: "Advanced physics simulation sandbox", category: "simulation", price: 59, tier: "enterprise" },
  ];
  for (const s of seeds) {
    const id = crypto.randomUUID();
    marketplaceListings.set(id, {
      id,
      userId: "system",
      ...s,
      rating: 0,
      reviewCount: 0,
      createdAt: new Date().toISOString(),
    });
  }
}

function seedLearningPaths() {
  const seeds = [
    { title: "DTU Fundamentals", description: "Master the basics of DTU creation and management", moduleCount: 8 },
    { title: "World Building Mastery", description: "Advanced techniques for building immersive worlds", moduleCount: 12 },
    { title: "Brain Architecture", description: "Deep dive into cognitive engine brain architecture", moduleCount: 6 },
    { title: "Physics Engine Deep Dive", description: "Comprehensive physics engine internals", moduleCount: 10 },
    { title: "Citation Economy", description: "Understanding the citation and attribution economy", moduleCount: 5 },
  ];
  for (const s of seeds) {
    const id = crypto.randomUUID();
    const modules = Array.from({ length: s.moduleCount }, (_, i) => ({
      index: i,
      title: `Module ${i + 1}`,
      description: `${s.title} — module ${i + 1}`,
    }));
    learningPaths.set(id, {
      id,
      title: s.title,
      description: s.description,
      moduleCount: s.moduleCount,
      modules,
      createdAt: new Date().toISOString(),
    });
  }
}

function seedFederation() {
  const seeds = [
    { name: "concordia-east", status: "online", region: "us-east" },
    { name: "concordia-eu", status: "online", region: "eu-west" },
    { name: "concordia-asia", status: "online", region: "ap-southeast" },
  ];
  for (const s of seeds) {
    const id = crypto.randomUUID();
    federationInstances.set(id, {
      id,
      ...s,
      connectedAt: null,
      createdAt: new Date().toISOString(),
    });
    syncLogs.set(id, []);
  }
}

seedMarketplace();
seedLearningPaths();
seedFederation();

// ── Route factory ─────────────────────────────────────────────────────────────

/**
 * @param {object} [opts]
 * @param {Function} [opts.requireAuth] - Auth middleware
 * @returns {Router}
 */
export default function createFrontierRoutesPart2({ requireAuth } = {}) {
  const router = Router();

  function _userId(req) {
     
    // eslint-disable-next-line no-restricted-syntax
    return req.user?.userId ?? req.actor?.userId ?? req.body?.userId ?? null; // safe: target-identifier
  }

  const auth = (req, res, next) => {
    if (requireAuth) return requireAuth(req, res, next);
    next();
  };

  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      logger.warn?.("[frontier-part2-route] error:", err.message);
      const status = err.message.includes("not found") ? 404
        : err.message.includes("required") || err.message.includes("Invalid") ? 400
        : err.message.includes("owner") || err.message.includes("Only") ? 403
        : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  };

  // ── 5. Notebooks ──────────────────────────────────────────────────────────

  router.post("/notebooks", auth, wrap((req, res) => {
    const { userId, title, description } = req.body;
    if (!userId || !title) throw new Error("userId and title are required");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const notebook = { id, userId, title, description: description || "", cells: [], createdAt: now, updatedAt: now };
    notebooks.set(id, notebook);
    res.status(201).json({ ok: true, notebook });
  }));

  router.get("/notebooks/user/:userId", auth, wrap((req, res) => {
    const { userId } = req.params;
    const userNotebooks = [...notebooks.values()].filter(n => n.userId === userId);
    res.json({ ok: true, notebooks: userNotebooks });
  }));

  router.get("/notebooks/:id", auth, wrap((req, res) => {
    const notebook = notebooks.get(req.params.id);
    if (!notebook) throw new Error("Notebook not found");
    res.json({ ok: true, notebook });
  }));

  router.put("/notebooks/:id", auth, wrap((req, res) => {
    const notebook = notebooks.get(req.params.id);
    if (!notebook) throw new Error("Notebook not found");
    const { cells, title } = req.body;
    if (cells !== undefined) notebook.cells = cells;
    if (title !== undefined) notebook.title = title;
    notebook.updatedAt = new Date().toISOString();
    res.json({ ok: true, notebook });
  }));

  router.post("/notebooks/:id/cells/:cellIndex/run", auth, wrap((req, res) => {
    const notebook = notebooks.get(req.params.id);
    if (!notebook) throw new Error("Notebook not found");
    const cellIndex = parseInt(req.params.cellIndex, 10);
    if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
      throw new Error("Invalid cell index");
    }
    const cell = notebook.cells[cellIndex];
    let output;
    if (cell.type === "code") {
      output = { result: "Executed in 42ms", status: "success", executedAt: new Date().toISOString() };
    } else if (cell.type === "query") {
      output = {
        result: [
          { id: 1, name: "Sample Row 1", value: 100 },
          { id: 2, name: "Sample Row 2", value: 200 },
          { id: 3, name: "Sample Row 3", value: 300 },
        ],
        rowCount: 3,
        status: "success",
        executedAt: new Date().toISOString(),
      };
    } else if (cell.type === "visualization") {
      output = {
        result: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#eee"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" font-size="14">Visualization Placeholder</text></svg>',
        status: "success",
        executedAt: new Date().toISOString(),
      };
    } else {
      output = { result: null, status: "unsupported", message: `Unsupported cell type: ${cell.type}` };
    }
    cell.output = output;
    notebook.updatedAt = new Date().toISOString();
    res.json({ ok: true, cellIndex, output });
  }));

  // ── 6. Service Marketplace ────────────────────────────────────────────────

  router.get("/marketplace/listings", wrap((req, res) => {
    const { category } = req.query;
    let listings = [...marketplaceListings.values()];
    if (category) {
      listings = listings.filter(l => l.category === category);
    }
    res.json({ ok: true, listings });
  }));

  router.post("/marketplace/listings", auth, wrap((req, res) => {
    const { userId, title, description, category, price, tier } = req.body;
    if (!userId || !title || !category || price === undefined) {
      throw new Error("userId, title, category, and price are required");
    }
    const id = crypto.randomUUID();
    const listing = {
      id,
      userId,
      title,
      description: description || "",
      category,
      price,
      tier: tier || "standard",
      rating: 0,
      reviewCount: 0,
      createdAt: new Date().toISOString(),
    };
    marketplaceListings.set(id, listing);
    res.status(201).json({ ok: true, listing });
  }));

  router.get("/marketplace/listings/:id", wrap((req, res) => {
    const listing = marketplaceListings.get(req.params.id);
    if (!listing) throw new Error("Listing not found");
    const reviews = [...marketplaceReviews.values()].filter(r => r.listingId === listing.id);
    res.json({ ok: true, listing, reviews });
  }));

  router.post("/marketplace/orders", auth, wrap((req, res) => {
    const { userId, listingId } = req.body;
    if (!userId || !listingId) throw new Error("userId and listingId are required");
    const listing = marketplaceListings.get(listingId);
    if (!listing) throw new Error("Listing not found");
    const id = crypto.randomUUID();
    const order = {
      id,
      userId,
      listingId,
      status: "pending",
      escrow: listing.price,
      createdAt: new Date().toISOString(),
    };
    marketplaceOrders.set(id, order);
    res.status(201).json({ ok: true, order });
  }));

  router.get("/marketplace/orders/:userId", auth, wrap((req, res) => {
    const { userId } = req.params;
    const orders = [...marketplaceOrders.values()].filter(o => o.userId === userId);
    res.json({ ok: true, orders });
  }));

  router.post("/marketplace/reviews", auth, wrap((req, res) => {
    const { userId, listingId, rating, comment } = req.body;
    if (!userId || !listingId || rating === undefined) {
      throw new Error("userId, listingId, and rating are required");
    }
    if (rating < 1 || rating > 5) throw new Error("Invalid rating — must be 1-5");
    const listing = marketplaceListings.get(listingId);
    if (!listing) throw new Error("Listing not found");
    const id = crypto.randomUUID();
    const review = {
      id,
      userId,
      listingId,
      rating,
      comment: comment || "",
      createdAt: new Date().toISOString(),
    };
    marketplaceReviews.set(id, review);

    // Update listing average rating
    const allReviews = [...marketplaceReviews.values()].filter(r => r.listingId === listingId);
    listing.reviewCount = allReviews.length;
    listing.rating = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;

    res.status(201).json({ ok: true, review, listing });
  }));

  // ── 7. Education / Certificates ───────────────────────────────────────────

  router.get("/certificates/paths", wrap((req, res) => {
    const paths = [...learningPaths.values()].map(({ modules, ...rest }) => rest);
    res.json({ ok: true, paths });
  }));

  router.get("/certificates/paths/:id", wrap((req, res) => {
    const path = learningPaths.get(req.params.id);
    if (!path) throw new Error("Learning path not found");
    res.json({ ok: true, path });
  }));

  router.post("/certificates/enroll", auth, wrap((req, res) => {
    const { userId, pathId } = req.body;
    if (!userId || !pathId) throw new Error("userId and pathId are required");
    const path = learningPaths.get(pathId);
    if (!path) throw new Error("Learning path not found");
    const key = `${userId}:${pathId}`;
    if (enrollments.has(key)) throw new Error("Already enrolled in this path");
    const enrollment = {
      userId,
      pathId,
      pathTitle: path.title,
      progress: 0,
      completedModules: [],
      enrolledAt: new Date().toISOString(),
    };
    enrollments.set(key, enrollment);
    res.status(201).json({ ok: true, enrollment });
  }));

  router.post("/certificates/progress", auth, wrap((req, res) => {
    const { userId, pathId, moduleIndex, score } = req.body;
    if (!userId || !pathId || moduleIndex === undefined || score === undefined) {
      throw new Error("userId, pathId, moduleIndex, and score are required");
    }
    const path = learningPaths.get(pathId);
    if (!path) throw new Error("Learning path not found");
    const key = `${userId}:${pathId}`;
    const enrollment = enrollments.get(key);
    if (!enrollment) throw new Error("Not enrolled in this path");

    if (!enrollment.completedModules.includes(moduleIndex)) {
      enrollment.completedModules.push(moduleIndex);
    }
    enrollment.progress = Math.round((enrollment.completedModules.length / path.moduleCount) * 100);

    let certificate = null;
    if (enrollment.completedModules.length >= path.moduleCount) {
      const certKey = `${userId}:${pathId}`;
      if (!certificates.has(certKey)) {
        certificate = {
          id: crypto.randomUUID(),
          userId,
          pathId,
          pathTitle: path.title,
          issuedAt: new Date().toISOString(),
          hash: crypto.createHash("sha256").update(`${userId}:${pathId}:${Date.now()}`).digest("hex"),
        };
        certificates.set(certKey, certificate);
      } else {
        certificate = certificates.get(certKey);
      }
    }

    res.json({ ok: true, enrollment, certificate });
  }));

  router.get("/certificates/user/:userId", auth, wrap((req, res) => {
    const { userId } = req.params;
    const userEnrollments = [...enrollments.values()].filter(e => e.userId === userId);
    const userCertificates = [...certificates.values()].filter(c => c.userId === userId);
    res.json({ ok: true, enrollments: userEnrollments, certificates: userCertificates });
  }));

  // ── 8. Federation ─────────────────────────────────────────────────────────

  router.get("/federation/instances", wrap((req, res) => {
    const instances = [...federationInstances.values()];
    res.json({ ok: true, instances });
  }));

  router.post("/federation/connect", auth, wrap((req, res) => {
    const { instanceId } = req.body;
    if (!instanceId) throw new Error("instanceId is required");
    const instance = federationInstances.get(instanceId);
    if (!instance) throw new Error("Instance not found");
    instance.connectedAt = new Date().toISOString();
    instance.status = "connected";
    res.json({ ok: true, instance });
  }));

  router.post("/federation/sync", auth, wrap((req, res) => {
    const { instanceId, dtuIds } = req.body;
    if (!instanceId || !dtuIds || !Array.isArray(dtuIds)) {
      throw new Error("instanceId and dtuIds[] are required");
    }
    const instance = federationInstances.get(instanceId);
    if (!instance) throw new Error("Instance not found");

    const logs = syncLogs.get(instanceId) || [];
    const entries = dtuIds.map(dtuId => {
      const entry = {
        id: crypto.randomUUID(),
        instanceId,
        dtuId,
        status: "synced",
        syncedAt: new Date().toISOString(),
      };
      logs.push(entry);
      return entry;
    });
    syncLogs.set(instanceId, logs);

    const summary = {
      instanceId,
      instanceName: instance.name,
      totalSynced: entries.length,
      syncedAt: new Date().toISOString(),
      entries,
    };
    res.json({ ok: true, summary });
  }));

  router.get("/federation/sync-log/:instanceId", wrap((req, res) => {
    const { instanceId } = req.params;
    const instance = federationInstances.get(instanceId);
    if (!instance) throw new Error("Instance not found");
    const logs = syncLogs.get(instanceId) || [];
    res.json({ ok: true, instanceId, instanceName: instance.name, logs });
  }));

  return router;
}
