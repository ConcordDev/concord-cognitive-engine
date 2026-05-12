/**
 * Sovereign Dev Console — Routes
 *
 * Word-is-law interface for the system sovereign (owner).
 * Every action creates a DTU audit trail in the lattice.
 * Locked to SOVEREIGN_USERNAME env var (default: "dutch").
 *
 * Additive only. One new file. Follows existing route patterns.
 */
import express from "express";
import crypto from "crypto";
import vm from "node:vm";
import { asyncHandler } from "../lib/async-handler.js";
import logger from '../logger.js';

// SECURITY: the sovereign role is god-mode (god decree, sovereign override,
// arbitrary state mutation). The username that maps to it MUST be set
// explicitly per deployment. A baked-in default would let any user who
// registers that username gain sovereign privileges. In dev we keep
// "dutch" as the historical default for convenience; in production the
// env var is required.
const _NODE_ENV = process.env.NODE_ENV || "development";
if (_NODE_ENV === "production" && !process.env.SOVEREIGN_USERNAME) {
  console.error("[Sovereign] FATAL: SOVEREIGN_USERNAME env var must be set in production. There is no default.");
  process.exit(1);
}
const SOVEREIGN_USERNAME = process.env.SOVEREIGN_USERNAME || "dutch";

/**
 * Get the global STATE object. Inspects known patterns in the codebase.
 */
function getSTATE() {
  // server.js exposes STATE on the context passed to routes,
  // but for direct access we check global patterns
  if (globalThis._concordSTATE) return globalThis._concordSTATE;
  if (globalThis.STATE) return globalThis.STATE;
  if (globalThis.concordState) return globalThis.concordState;
  return null;
}

/**
 * Generate a unique ID matching the codebase pattern.
 */
function uid(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

/**
 * Create a sovereign audit DTU in the lattice.
 */
function createSovereignDTU(STATE, action, input, output) {
  if (!STATE || !STATE.dtus) return null;

  const dtu = {
    id: uid("dtu"),
    type: "sovereign_action",
    title: `Sovereign: ${action}`,
    human: { summary: `Sovereign decree: ${action}` },
    machine: {
      kind: "sovereign_action",
      action,
      input: input || {},
      output: typeof output === "object" ? output : { result: output },
    },
    source: "sovereign",
    authority: { model: "sovereign", score: 1.0 },
    tags: ["sovereign", "dev-console", action],
    tier: "shadow",
    scope: "local",
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };

  STATE.dtus.set(dtu.id, dtu);

  // Best-effort: trigger state save
  try {
    if (typeof globalThis.saveStateDebounced === "function") globalThis.saveStateDebounced();
  } catch (_e) { logger.debug('sovereign', 'silent', { error: _e?.message }); }

  // Best-effort: emit realtime event
  try {
    if (typeof globalThis.realtimeEmit === "function") {
      globalThis.realtimeEmit("dtu:created", { dtu: { id: dtu.id, type: dtu.type, tags: dtu.tags } });
    }
  } catch (_e) { logger.debug('sovereign', 'silent', { error: _e?.message }); }

  return dtu;
}

export default function createSovereignRouter({ STATE, makeCtx, runMacro, saveStateDebounced: _saveDebounced }) {
  const router = express.Router();

  // Expose STATE globally so getSTATE() works from anywhere
  if (STATE && !globalThis._concordSTATE) {
    globalThis._concordSTATE = STATE;
  }

  // Expose saveStateDebounced globally if provided
  if (_saveDebounced && !globalThis.saveStateDebounced) {
    globalThis.saveStateDebounced = _saveDebounced;
  }

  /**
   * Sovereign auth middleware. Only SOVEREIGN_USERNAME can access.
   */
  function requireSovereign(req, res, next) {
    const user = req.user?.username || req.user?.handle || req.user?.id || req.session?.user?.username || "";
    const role = req.user?.role || "";

    // Allow owner/admin role even if username doesn't exactly match
    if (user === SOVEREIGN_USERNAME || role === "owner") {
      return next();
    }

    console.warn(`[sovereign] Access denied for user "${user}" (role: ${role}). Expected: "${SOVEREIGN_USERNAME}"`);
    return res.status(403).json({ ok: false, error: "sovereign access required" });
  }

  router.use(requireSovereign);

  // ════════════════════════════════════════════════════════════════════
  // GET /api/sovereign/pulse — Full system state from the inside
  // ════════════════════════════════════════════════════════════════════
  router.get("/pulse", (req, res) => {
    const S = STATE || getSTATE();
    if (!S) return res.json({ ok: false, error: "STATE not available" });

    // DTU breakdown by tier
    const tierCounts = { regular: 0, mega: 0, hyper: 0, shadow: 0, core: 0, other: 0 };
    let totalDTUs = 0;
    if (S.dtus) {
      for (const dtu of S.dtus.values()) {
        totalDTUs++;
        const t = String(dtu.tier || "regular").toLowerCase();
        if (tierCounts[t] !== undefined) tierCounts[t]++;
        else tierCounts.other++;
      }
    }

    // Emergents
    const emergents = [];
    const emergentStore = S.emergents || S.__emergents;
    if (emergentStore) {
      const entries = emergentStore instanceof Map
        ? Array.from(emergentStore.values())
        : Object.values(emergentStore);
      for (const e of entries) {
        emergents.push({
          id: e.id || e.name,
          name: e.name || e.role || e.id,
          role: e.role || "unknown",
          status: e.status || e.state || "active",
          lastActive: e.lastActiveAt || e.updatedAt || e.createdAt || null,
        });
      }
    }

    // Background jobs
    const jobs = {
      heartbeatEnabled: S.settings?.heartbeatEnabled ?? null,
      autogenEnabled: S.settings?.autogenEnabled ?? null,
      dreamEnabled: S.settings?.dreamEnabled ?? null,
      evolutionEnabled: S.settings?.evolutionEnabled ?? null,
      synthEnabled: S.settings?.synthEnabled ?? null,
    };

    // Process info
    const mem = process.memoryUsage();
    const processInfo = {
      rss: Math.round(mem.rss / 1024 / 1024) + "MB",
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + "MB",
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + "MB",
      uptime: Math.round(process.uptime()) + "s",
      uptimeHuman: formatUptime(process.uptime()),
    };

    // Qualia summary (if engine is active)
    let qualiaSummary = null;
    try {
      if (globalThis.qualiaEngine) {
        qualiaSummary = globalThis.qualiaEngine.getAllSummaries();
      }
    } catch (_e) { logger.debug('sovereign', 'silent', { error: _e?.message }); }

    return res.json({
      ok: true,
      dtus: { total: totalDTUs, ...tierCounts },
      emergents,
      jobs,
      process: processInfo,
      qualia: qualiaSummary,
      timestamp: nowISO(),
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // POST /api/sovereign/decree — The main command endpoint
  // ════════════════════════════════════════════════════════════════════
  router.post("/decree", asyncHandler(async (req, res) => {
    const S = STATE || getSTATE();
    if (!S) return res.json({ ok: false, error: "STATE not available" });

    const { action, target, data } = req.body || {};
    if (!action) return res.status(400).json({ ok: false, error: "action required" });

    let result;

    try {
      switch (action) {
        // ── DTU Operations ──────────────────────────────────────────
        case "create-dtu": {
          const content = data?.content;
          if (!content) return res.json({ ok: false, error: "data.content required" });

          const dtu = {
            id: uid("dtu"),
            type: "knowledge",
            title: String(content).slice(0, 100),
            human: { summary: String(content) },
            machine: { kind: "sovereign_created" },
            source: "sovereign",
            authority: { model: "sovereign", score: 1.0 },
            tier: data?.tier || "core",
            scope: data?.scope || "local",
            tags: ["sovereign", ...(data?.tags || [])],
            createdAt: nowISO(),
            updatedAt: nowISO(),
          };

          S.dtus.set(dtu.id, dtu);
          trySave();
          tryEmit("dtu:created", { dtu: { id: dtu.id, tier: dtu.tier, tags: dtu.tags } });

          result = { ok: true, dtu: { id: dtu.id, tier: dtu.tier, title: dtu.title } };
          break;
        }

        case "promote-dtu": {
          if (!target) return res.json({ ok: false, error: "target (DTU id) required" });
          const dtu = S.dtus.get(target);
          if (!dtu) return res.json({ ok: false, error: `DTU ${target} not found` });

          const prevTier = dtu.tier;
          dtu.tier = data?.tier || "core";
          dtu.authority = { model: "sovereign", score: 1.0 };
          dtu.tags = [...new Set([...(dtu.tags || []), "sovereign-promoted"])];
          dtu.updatedAt = nowISO();
          trySave();
          tryEmit("dtu:promoted", { dtu: { id: dtu.id, tier: dtu.tier, prevTier } });

          result = { ok: true, id: target, prevTier, newTier: dtu.tier };
          break;
        }

        case "modify-dtu": {
          if (!target) return res.json({ ok: false, error: "target (DTU id) required" });
          const dtu = S.dtus.get(target);
          if (!dtu) return res.json({ ok: false, error: `DTU ${target} not found` });

          // Deep merge data onto DTU, protecting id, lineage, and prototype keys.
          const protected_ = new Set(["id", "lineage", "__proto__", "constructor", "prototype"]);
          const incoming = data && typeof data === "object" ? data : {};
          for (const [k, v] of Object.entries(incoming)) {
            if (protected_.has(k)) continue;
            if (!Object.prototype.hasOwnProperty.call(incoming, k)) continue;
            if (typeof v === "object" && v !== null && typeof dtu[k] === "object" && dtu[k] !== null && !Array.isArray(v)) {
              dtu[k] = { ...dtu[k], ...v };
            } else {
              dtu[k] = v;
            }
          }
          dtu.tags = [...new Set([...(dtu.tags || []), "sovereign-modified"])];
          dtu.updatedAt = nowISO();
          trySave();

          result = { ok: true, id: target, modified: Object.keys(data || {}) };
          break;
        }

        case "delete-dtu": {
          if (!target) return res.json({ ok: false, error: "target (DTU id) required" });
          const existed = S.dtus.has(target);
          if (!existed) return res.json({ ok: false, error: `DTU ${target} not found` });

          S.dtus.delete(target);
          trySave();

          result = { ok: true, deleted: target };
          break;
        }

        case "inspect": {
          if (!target) return res.json({ ok: false, error: "target (DTU id) required" });
          const dtu = S.dtus.get(target);
          if (!dtu) return res.json({ ok: false, error: `DTU ${target} not found` });

          result = { ok: true, dtu };
          break;
        }

        case "search": {
          const query = String(data?.query || "").toLowerCase();
          if (!query) return res.json({ ok: false, error: "data.query required" });

          const limit = Math.min(Number(data?.limit) || 20, 100);
          const matches = [];

          for (const dtu of S.dtus.values()) {
            const str = JSON.stringify(dtu).toLowerCase();
            if (str.includes(query)) {
              matches.push({ id: dtu.id, title: dtu.title || dtu.human?.summary?.slice(0, 80), tier: dtu.tier, tags: dtu.tags });
              if (matches.length >= limit) break;
            }
          }

          result = { ok: true, matches, count: matches.length, query };
          break;
        }

        case "count": {
          result = { ok: true, total: S.dtus.size };
          break;
        }

        // ── System Operations ───────────────────────────────────────
        case "set-config": {
          const key = data?.key;
          const value = data?.value;
          if (!key) return res.json({ ok: false, error: "data.key required" });
          if (typeof key !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(key) || key === "__proto__" || key === "constructor" || key === "prototype") {
            return res.json({ ok: false, error: "data.key must be an alphanumeric/underscore identifier" });
          }

          if (!S.config) S.config = Object.create(null);
          const prev = S.config[key];
          S.config[key] = value;
          trySave();

          result = { ok: true, key, previous: prev, current: value };
          break;
        }

        case "toggle-job": {
          if (!target) return res.json({ ok: false, error: "target (job name) required" });
          if (typeof target !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(target) || target === "__proto__" || target === "constructor" || target === "prototype") {
            return res.json({ ok: false, error: "target must be an alphanumeric/underscore identifier" });
          }
          const enabled = data?.enabled !== undefined ? Boolean(data.enabled) : true;
          const jobKey = target.endsWith("Enabled") ? target : `${target}Enabled`;

          if (!S.settings) S.settings = Object.create(null);
          const prev = S.settings[jobKey];
          S.settings[jobKey] = enabled;
          trySave();

          result = { ok: true, job: jobKey, previous: prev, current: enabled };
          break;
        }

        case "freeze": {
          if (!S.settings) S.settings = {};
          const frozen = [];
          const jobKeys = ["heartbeatEnabled", "autogenEnabled", "dreamEnabled", "evolutionEnabled", "synthEnabled"];

          for (const key of jobKeys) {
            if (S.settings[key]) {
              S.settings[key] = false;
              S.settings[`_frozen_${key}`] = true;
              frozen.push(key);
            }
          }
          trySave();

          result = { ok: true, frozen, message: `Froze ${frozen.length} jobs` };
          break;
        }

        case "thaw": {
          if (!S.settings) S.settings = {};
          const thawed = [];
          const jobKeys = ["heartbeatEnabled", "autogenEnabled", "dreamEnabled", "evolutionEnabled", "synthEnabled"];

          for (const key of jobKeys) {
            if (S.settings[`_frozen_${key}`]) {
              S.settings[key] = true;
              delete S.settings[`_frozen_${key}`];
              thawed.push(key);
            }
          }
          trySave();

          result = { ok: true, thawed, message: `Thawed ${thawed.length} jobs` };
          break;
        }

        case "force-pipeline": {
          try {
            const ctx = makeCtx ? makeCtx(null) : { actor: { role: "owner", scopes: ["*"] }, state: S };
            if (makeCtx) ctx.actor = { role: "owner", scopes: ["*"] };
            const out = runMacro ? await runMacro("system", "autogen", {}, ctx) : { ok: false, error: "runMacro not available" };
            result = { ok: true, pipeline: out };
          } catch (e) {
            result = { ok: false, error: String(e?.message || e) };
          }
          break;
        }

        case "force-dream": {
          try {
            const ctx = makeCtx ? makeCtx(null) : { actor: { role: "owner", scopes: ["*"] }, state: S };
            if (makeCtx) ctx.actor = { role: "owner", scopes: ["*"] };
            const seed = data?.seed || "Sovereign dream invocation";
            const out = runMacro ? await runMacro("system", "dream", { seed }, ctx) : { ok: false, error: "runMacro not available" };
            result = { ok: true, dream: out };
          } catch (e) {
            result = { ok: false, error: String(e?.message || e) };
          }
          break;
        }

        case "gc": {
          if (typeof globalThis.gc === "function") {
            globalThis.gc();
            const mem = process.memoryUsage();
            result = { ok: true, message: "GC triggered", heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + "MB" };
          } else {
            result = { ok: false, error: "gc not exposed. Start node with --expose-gc" };
          }
          break;
        }

        // ── Communication ───────────────────────────────────────────
        case "broadcast": {
          const message = data?.message;
          if (!message) return res.json({ ok: false, error: "data.message required" });

          const dtu = {
            id: uid("dtu"),
            type: "broadcast",
            title: `Sovereign Broadcast: ${String(message).slice(0, 60)}`,
            human: { summary: String(message) },
            machine: { kind: "sovereign_broadcast" },
            source: "sovereign",
            authority: { model: "sovereign", score: 1.0 },
            tier: "core",
            scope: "local",
            tags: ["sovereign", "broadcast", "system-message"],
            createdAt: nowISO(),
            updatedAt: nowISO(),
          };

          S.dtus.set(dtu.id, dtu);
          trySave();
          tryEmit("dtu:created", { dtu: { id: dtu.id, type: dtu.type, tags: dtu.tags } });
          tryEmit("system:alert", { message, source: "sovereign", severity: "info" });

          result = { ok: true, dtu: { id: dtu.id }, message: "Broadcast sent" };
          break;
        }

        // ── Qualia Operations ───────────────────────────────────────
        case "qualia": {
          const engine = globalThis.qualiaEngine;
          if (!engine) return res.json({ ok: false, error: "qualia engine not initialized" });
          if (!target) return res.json({ ok: false, error: "target (entity id) required" });

          const state = engine.getQualiaState(target);
          if (!state) return res.json({ ok: false, error: `No qualia state for ${target}` });

          result = { ok: true, state };
          break;
        }

        case "qualia-summary": {
          const engine = globalThis.qualiaEngine;
          if (!engine) return res.json({ ok: false, error: "qualia engine not initialized" });

          result = { ok: true, summaries: engine.getAllSummaries() };
          break;
        }

        case "activate-os": {
          const engine = globalThis.qualiaEngine;
          if (!engine) return res.json({ ok: false, error: "qualia engine not initialized" });
          if (!target || !data?.osKey) return res.json({ ok: false, error: "target and data.osKey required" });

          result = engine.activateOS(target, data.osKey);
          break;
        }

        case "deactivate-os": {
          const engine = globalThis.qualiaEngine;
          if (!engine) return res.json({ ok: false, error: "qualia engine not initialized" });
          if (!target || !data?.osKey) return res.json({ ok: false, error: "target and data.osKey required" });

          result = engine.deactivateOS(target, data.osKey);
          break;
        }

        case "inject-qualia": {
          const engine = globalThis.qualiaEngine;
          if (!engine) return res.json({ ok: false, error: "qualia engine not initialized" });
          if (!target || !data?.channel || data?.value === undefined) {
            return res.json({ ok: false, error: "target, data.channel, and data.value required" });
          }

          const [osKey, ...channelParts] = data.channel.split(".");
          const channelName = channelParts.join(".");
          if (!osKey || !channelName) {
            return res.json({ ok: false, error: "channel must be in format 'osKey.channelName'" });
          }

          result = engine.updateChannel(target, osKey, channelName, Number(data.value));
          break;
        }

        // ── Reproduction Operations ─────────────────────────────────
        case "reproduce": {
          if (!target || !data?.entity2) {
            return res.json({ ok: false, error: "target (entity1) and data.entity2 required" });
          }
          try {
            const { attemptReproduction, enableReproduction, disableReproduction, isReproductionEnabled } = await import("../emergent/reproduction.js");
            const emergents = S.emergents || S.__emergents;
            const e1 = emergents instanceof Map ? emergents.get(target) : emergents?.[target];
            const e2 = emergents instanceof Map ? emergents.get(data.entity2) : emergents?.[data.entity2];
            if (!e1) return res.json({ ok: false, error: `Entity ${target} not found` });
            if (!e2) return res.json({ ok: false, error: `Entity ${data.entity2} not found` });
            // Temporarily enable for sovereign decree
            const wasEnabled = isReproductionEnabled();
            if (!wasEnabled) enableReproduction();
            result = await attemptReproduction(e1, e2, S, runMacro, makeCtx);
            if (!wasEnabled) disableReproduction();
          } catch (e) {
            result = { ok: false, error: String(e?.message || e) };
          }
          break;
        }

        case "reproduction-policy": {
          try {
            const { enableReproduction, disableReproduction, isReproductionEnabled } = await import("../emergent/reproduction.js");
            const enable = data?.enabled !== false && target !== "disable";
            if (enable) {
              enableReproduction();
              result = { ok: true, reproductionEnabled: true };
            } else {
              disableReproduction();
              result = { ok: true, reproductionEnabled: false };
            }
          } catch (e) {
            result = { ok: false, error: String(e?.message || e) };
          }
          break;
        }

        // ��─ Federation Toggle ───────────────────────────────────────
        case "federation-policy": {
          try {
            const enable = data?.enabled !== false && target !== "disable";
            if (S.__chicken3) {
              S.__chicken3.federationEnabled = enable;
              result = { ok: true, federationEnabled: enable };
            } else {
              result = { ok: false, error: "__chicken3 not initialized" };
            }
          } catch (e) {
            result = { ok: false, error: String(e?.message || e) };
          }
          break;
        }

        // ── Bulk Settings Update ───────────────────────────────────────
        case "settings": {
          try {
            // Strict allow-list keyed via Set so CodeQL's taint tracker sees
            // the membership check. Set.has() is recognized as a sanitizer.
            const ALLOWED_SETTINGS = new Set([
              "autogenEnabled", "dreamEnabled", "evolutionEnabled", "synthEnabled",
              "heartbeatEnabled", "speculativeGateEnabled", "canonicalOnly", "includeMegasInBase",
              "requireHypothesisLabels", "requireTestsWhenUncertain",
            ]);
            if (!S.settings) S.settings = Object.create(null);
            let updated = 0;
            const incoming = data && typeof data === "object" ? data : {};
            for (const [key, val] of Object.entries(incoming)) {
              if (ALLOWED_SETTINGS.has(key) && typeof val === "boolean") {
                S.settings[key] = val;
                updated++;
              }
            }
            result = { ok: true, updated, settings: S.settings };
          } catch (e) {
            result = { ok: false, error: String(e?.message || e) };
          }
          break;
        }

        case "lineage": {
          if (!target) return res.json({ ok: false, error: "target (entity id) required" });
          try {
            const { getLineage } = await import("../emergent/reproduction.js");
            result = { ok: true, lineage: getLineage(target, S) };
          } catch (e) {
            result = { ok: false, error: String(e?.message || e) };
          }
          break;
        }

        case "lineage-tree": {
          try {
            const { getLineageTree } = await import("../emergent/reproduction.js");
            const tree = getLineageTree(S);
            result = { ok: true, tree, count: tree.length };
          } catch (e) {
            result = { ok: false, error: String(e?.message || e) };
          }
          break;
        }

        // ── Species Operations ──────────────────────────────────────
        case "species": {
          try {
            const speciesMod = await import("../emergent/species.js");
            if (target) {
              const emergents = S.emergents || S.__emergents;
              const entity = emergents instanceof Map ? emergents.get(target) : emergents?.[target];
              if (!entity) return res.json({ ok: false, error: `Entity ${target} not found` });
              const sp = speciesMod.classifyEntity(entity);
              result = { ok: true, entityId: target, species: sp, info: speciesMod.getSpecies(sp) };
            } else {
              result = { ok: true, entities: speciesMod.classifyAllEntities(S) };
            }
          } catch (e) {
            result = { ok: false, error: String(e?.message || e) };
          }
          break;
        }

        case "species-all": {
          try {
            const speciesMod = await import("../emergent/species.js");
            result = { ok: true, entities: speciesMod.classifyAllEntities(S), census: speciesMod.getSpeciesCensus(S) };
          } catch (e) {
            result = { ok: false, error: String(e?.message || e) };
          }
          break;
        }

        // ── Council Voices ──────────────────────────────────────────
        case "council-voices": {
          try {
            const { runCouncilVoices } = await import("../emergent/council-voices.js");
            if (target) {
              // Evaluate specific DTU
              const dtu = S.dtus?.get(target);
              if (!dtu) return res.json({ ok: false, error: `DTU ${target} not found` });
              const qualiaState = globalThis.qualiaEngine?.getQualiaState("council");
              result = { ok: true, ...runCouncilVoices(dtu, qualiaState) };
            } else {
              const { getAllVoices } = await import("../emergent/council-voices.js");
              result = { ok: true, voices: getAllVoices() };
            }
          } catch (e) {
            result = { ok: false, error: String(e?.message || e) };
          }
          break;
        }

        // ── Dual-Path Simulation ────────────────────────────────────
        case "simulate": {
          try {
            const { runDualPathSimulation } = await import("../emergent/dual-path.js");
            const scenario = {
              scenarioId: target || data?.scenarioId,
              hypothesis: data?.hypothesis,
              params: data?.params || data || {},
              existentialOSChannels: data?.existentialOSChannels,
            };
            result = { ok: true, ...runDualPathSimulation(scenario) };
          } catch (e) {
            result = { ok: false, error: String(e?.message || e) };
          }
          break;
        }

        case "simulations": {
          try {
            const { listSimulations } = await import("../emergent/dual-path.js");
            const limit = Number(target) || Number(data?.limit) || 20;
            result = { ok: true, simulations: listSimulations(limit) };
          } catch (e) {
            result = { ok: false, error: String(e?.message || e) };
          }
          break;
        }

        case "sim-compare": {
          if (!target) return res.json({ ok: false, error: "target (simId) required" });
          try {
            const { getSimulation } = await import("../emergent/dual-path.js");
            const sim = getSimulation(target);
            if (!sim) return res.json({ ok: false, error: `Simulation ${target} not found` });
            result = { ok: true, comparison: sim.comparison, humanStability: sim.humanPath.stabilityScore, concordStability: sim.concordPath.stabilityScore };
          } catch (e) {
            result = { ok: false, error: String(e?.message || e) };
          }
          break;
        }

        // ── Vulnerability Detection ─────────────────────────────────
        case "vulnerability": {
          try {
            const { assessAndAdapt } = await import("../emergent/vulnerability-engine.js");
            const message = target || data?.message || "";
            if (!message) return res.json({ ok: false, error: "target or data.message required" });
            result = { ok: true, ...assessAndAdapt(message, data?.entityId) };
          } catch (e) {
            result = { ok: false, error: String(e?.message || e) };
          }
          break;
        }

        // ── Repair Cortex Operations ──────────────────────────────────
        case "repair-status":
        case "repair-memory":
        case "repair-history":
        case "repair-patterns":
        case "repair-guardian-status":
        case "repair-run-prophet":
        case "repair-threshold": {
          try {
            const repairMod = await import("../emergent/repair-cortex.js");
            const repairResult = repairMod.handleRepairCommand(action, target, data);
            // handleRepairCommand may return a promise (e.g. for repair-run-prophet)
            result = repairResult && typeof repairResult.then === "function"
              ? await repairResult
              : repairResult;
          } catch (e) {
            result = { ok: false, error: String(e?.message || e) };
          }
          break;
        }

        default:
          result = { ok: false, error: `Unknown action: ${action}` };
      }
    } catch (e) {
      result = { ok: false, error: String(e?.message || e) };
    }

    // Create sovereign audit DTU for every decree
    createSovereignDTU(S, action, { target, data }, result);

    return res.json(result);
  }));

  // ════════════════════════════════════════════════════════════════════
  // GET /api/sovereign/audit — Sovereign action audit trail
  // ════════════════════════════════════════════════════════════════════
  router.get("/audit", (req, res) => {
    const S = STATE || getSTATE();
    if (!S || !S.dtus) return res.json({ ok: true, actions: [], count: 0 });

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const actions = [];

    for (const dtu of S.dtus.values()) {
      if (dtu.source === "sovereign" && dtu.machine?.kind === "sovereign_action") {
        actions.push(dtu);
      }
    }

    // Sort newest first
    actions.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    return res.json({ ok: true, actions: actions.slice(0, limit), count: actions.length });
  });

  // ════════════════════════════════════════════════════════════════════
  // POST /api/sovereign/eval — Nuclear option
  // ════════════════════════════════════════════════════════════════════
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/eval", (req, res) => {
    const S = STATE || getSTATE();
    const code = String(req.body?.code || "").trim();
    if (!code) return res.status(400).json({ ok: false, error: "code required" });

    let output;
    try {
      const context = vm.createContext({ STATE: S, S, console });
      const raw = vm.runInNewContext(code, context, { timeout: 5000 });
      output = typeof raw === "object" ? JSON.stringify(raw, null, 2) : String(raw ?? "undefined");
    } catch (e) {
      output = `Error: ${e?.message || e}`;
    }

    // Truncate
    if (output.length > 5000) output = output.slice(0, 5000) + "\n... (truncated)";

    // Audit trail
    createSovereignDTU(S, "eval", { code: code.slice(0, 500) }, { output: output.slice(0, 1000) });

    return res.json({ ok: true, output });
  });

  // ── Helpers ────────────────────────────────────────────────────────
  function trySave() {
    try {
      if (_saveDebounced) _saveDebounced();
      else if (typeof globalThis.saveStateDebounced === "function") globalThis.saveStateDebounced();
    } catch (_e) { logger.debug('sovereign', 'silent', { error: _e?.message }); }
  }

  function tryEmit(event, payload) {
    try {
      if (typeof globalThis.realtimeEmit === "function") {
        globalThis.realtimeEmit(event, payload);
      }
    } catch (_e) { logger.debug('sovereign', 'silent', { error: _e?.message }); }
  }

  // GET /sovereign/dashboard — Sovereign dashboard overview
  router.get("/dashboard", (req, res) => {
    const S = STATE || getSTATE();
    if (!S) return res.json({ ok: false, error: "STATE not available" });

    const totalDTUs = S.dtus ? S.dtus.size : 0;
    const totalEdges = S.edges ? S.edges.size : 0;
    const uptime = S.uptime ? Date.now() - S.uptime : 0;

    return res.json({
      ok: true,
      dashboard: {
        totalDTUs,
        totalEdges,
        uptime,
        sovereign: SOVEREIGN_USERNAME,
        timestamp: new Date().toISOString(),
      },
    });
  });

  return router;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}
