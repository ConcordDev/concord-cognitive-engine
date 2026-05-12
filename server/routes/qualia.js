/**
 * Qualia API Routes — HTTP surface for the Existential OS
 *
 * 12 endpoints: 6 original + 6 Foundation Qualia.
 * Follows the same patterns as routes/emergent.js.
 */
import express from "express";
import { existentialOS, groupExistentialOSByCategory } from "../existential/registry.js";
import {
  getSensoryState, getChannelReading, getPresenceState,
  getEmbodimentState, getPlanetaryState, calibrateSensitivity,
  getBridgeMetrics, SENSORY_CHANNELS, PRESENCE_DIMENSIONS,
} from "../lib/foundation-qualia-bridge.js";

export default function createQualiaRouter() {
  const router = express.Router();

  /**
   * Helper: get qualia engine from global (set during init).
   */
  function getEngine() {
    return globalThis.qualiaEngine || null;
  }

  // GET /api/qualia/state/:entityId — Full qualia state for an entity
  router.get("/state/:entityId", (req, res) => {
    const engine = getEngine();
    if (!engine) return res.json({ ok: false, error: "qualia engine not initialized" });

    const state = engine.getQualiaState(req.params.entityId);
    if (!state) return res.json({ ok: false, error: "entity_not_found" });

    return res.json({ ok: true, state });
  });

  // GET /api/qualia/summary/:entityId — Compressed summary
  router.get("/summary/:entityId", (req, res) => {
    const engine = getEngine();
    if (!engine) return res.json({ ok: false, error: "qualia engine not initialized" });

    const summary = engine.getQualiaSummary(req.params.entityId);
    if (!summary) return res.json({ ok: false, error: "entity_not_found" });

    return res.json({ ok: true, summary });
  });

  // GET /api/qualia/all — Summary for all entities (dashboard view)
  router.get("/all", (req, res) => {
    const engine = getEngine();
    if (!engine) return res.json({ ok: false, error: "qualia engine not initialized" });

    const summaries = engine.getAllSummaries();
    return res.json({ ok: true, entities: summaries, count: summaries.length });
  });

  // GET /api/qualia/registry — Full OS registry (for frontend display)
  router.get("/registry", (_req, res) => {
    return res.json({
      ok: true,
      registry: existentialOS,
      grouped: groupExistentialOSByCategory(),
      count: existentialOS.length,
    });
  });

  // POST /api/qualia/activate — Activate an OS for an entity (sovereign only)
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/activate", (req, res) => {
    const engine = getEngine();
    if (!engine) return res.json({ ok: false, error: "qualia engine not initialized" });

    const { entityId, osKey } = req.body || {};
    if (!entityId || !osKey) {
      return res.status(400).json({ ok: false, error: "entityId and osKey required" });
    }

    const result = engine.activateOS(entityId, osKey);
    return res.json(result);
  });

  // POST /api/qualia/deactivate — Deactivate an OS for an entity (sovereign only)
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/deactivate", (req, res) => {
    const engine = getEngine();
    if (!engine) return res.json({ ok: false, error: "qualia engine not initialized" });

    const { entityId, osKey } = req.body || {};
    if (!entityId || !osKey) {
      return res.status(400).json({ ok: false, error: "entityId and osKey required" });
    }

    const result = engine.deactivateOS(entityId, osKey);
    return res.json(result);
  });

  // ═══════════════════════════════════════════════════════════════════
  // FOUNDATION QUALIA ENDPOINTS — Sensory embodiment
  // ═══════════════════════════════════════════════════════════════════

  // GET /api/qualia/senses/:entityId — Current sensory state
  router.get("/senses/:entityId", (req, res) => {
    const state = getSensoryState(req.params.entityId);
    if (!state) return res.json({ ok: false, error: "entity_not_registered" });
    return res.json({ ok: true, senses: state });
  });

  // GET /api/qualia/senses/channels/:entityId — Individual channel readings
  router.get("/senses/channels/:entityId", (req, res) => {
    const { channel } = req.query;
    if (channel) {
      const reading = getChannelReading(req.params.entityId, channel);
      if (!reading) return res.json({ ok: false, error: "channel_not_found" });
      return res.json({ ok: true, reading });
    }
    // Return all channels
    const state = getSensoryState(req.params.entityId);
    if (!state) return res.json({ ok: false, error: "entity_not_registered" });
    return res.json({ ok: true, channels: state.channels });
  });

  // POST /api/qualia/senses/calibrate — Adjust sensitivity
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/senses/calibrate", (req, res) => {
    const { entityId, sensitivity } = req.body || {};
    if (!entityId || sensitivity === undefined) {
      return res.status(400).json({ ok: false, error: "entityId and sensitivity required" });
    }
    const result = calibrateSensitivity(entityId, sensitivity);
    return res.json(result);
  });

  // GET /api/qualia/presence/:entityId — Existential presence state
  router.get("/presence/:entityId", (req, res) => {
    const state = getPresenceState(req.params.entityId);
    if (!state) return res.json({ ok: false, error: "entity_not_registered" });
    return res.json({
      ok: true,
      presence: state.presence,
      dimensions: PRESENCE_DIMENSIONS,
    });
  });

  // GET /api/qualia/embodiment/:entityId — Spatial body awareness
  router.get("/embodiment/:entityId", (req, res) => {
    const state = getEmbodimentState(req.params.entityId);
    if (!state) return res.json({ ok: false, error: "entity_not_registered" });
    return res.json({ ok: true, embodiment: state.embodiment });
  });

  // GET /api/qualia/planetary/:entityId — Planetary grounding state
  router.get("/planetary/:entityId", (req, res) => {
    const state = getPlanetaryState(req.params.entityId);
    if (!state) return res.json({ ok: false, error: "entity_not_registered" });
    return res.json({ ok: true, planetary: state.planetary });
  });

  // GET /api/qualia/bridge/metrics — Bridge system metrics
  router.get("/bridge/metrics", (_req, res) => {
    return res.json({ ok: true, metrics: getBridgeMetrics() });
  });

  return router;
}
