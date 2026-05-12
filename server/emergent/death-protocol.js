/**
 * Death Protocol — Entity End-of-Life Management
 *
 * Entities live, age, and die. Telomeres decay, homeostasis collapses,
 * organs fail. Until now, entities degraded but never ended. This module
 * closes the loop: when conditions are met, the entity dies.
 *
 * Death triggers:
 *   - Telomere exhaustion (telomere <= 0.01)
 *   - Homeostasis collapse (homeostasis < 0.15 for 3+ consecutive checks)
 *   - Catastrophic organ failure (5+ critical organs with damage > 0.9)
 *   - Sovereign decree (manual kill)
 *
 * Death cascade:
 *   1. Record cause of death
 *   2. Generate memorial DTU
 *   3. Knowledge inheritance to offspring
 *   4. Trust graph cleanup
 *   5. Comms cleanup
 *   6. Session cleanup
 *   7. Body cleanup
 *   8. Deactivate emergent
 *   9. Emit death event
 *   10. Update death registry
 *
 * Near-death warnings broadcast through comms as SIGNAL messages.
 * Succession planning available for living entities.
 *
 * All state in module-level Maps. Silent failure. No new dependencies.
 */

import crypto from "crypto";
import logger from '../logger.js';
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "death") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

// ── Lazy Module Access ──────────────────────────────────────────────────────
// Avoid circular dependencies by resolving at call-time, not import-time.

function _getSTATE() {
  try {
    return globalThis._concordSTATE || globalThis.STATE || null;
  } catch {
    return null;
  }
}

function _getBodyMod() {
  try {
    return import("./body-instantiation.js");
  } catch {
    return null;
  }
}

function _getTrustMod() {
  try {
    return import("./trust-network.js");
  } catch {
    return null;
  }
}

function _getCommsMod() {
  try {
    return import("./emergent-comms.js");
  } catch {
    return null;
  }
}

function _getStoreMod() {
  try {
    return import("./store.js");
  } catch {
    return null;
  }
}

// ── Constants ───────────────────────────────────────────────────────────────

const DEATH_CAUSES = Object.freeze({
  TELOMERE_EXHAUSTION:  "telomere_exhaustion",
  HOMEOSTASIS_COLLAPSE: "homeostasis_collapse",
  ORGAN_FAILURE:        "organ_failure",
  SOVEREIGN_DECREE:     "sovereign_decree",
});

const CRITICAL_ORGANS = Object.freeze([
  "soul_os",
  "growth_os",
  "conscience_os",
  "homeostasis_regulation",
  "organ_maturation_kernel",
]);

const THRESHOLDS = Object.freeze({
  TELOMERE_DEATH:                  0.01,
  TELOMERE_WARNING:                0.10,
  HOMEOSTASIS_DEATH:               0.15,
  HOMEOSTASIS_WARNING:             0.25,
  HOMEOSTASIS_CONSECUTIVE_CHECKS:  3,
  ORGAN_DAMAGE_CRITICAL:           0.90,
  ORGAN_DAMAGE_WARNING:            0.70,
  ORGAN_FAILURE_COUNT_DEATH:       5,
  ORGAN_DEGRADATION_WARNING_COUNT: 3,
});

// ── Death Registry ──────────────────────────────────────────────────────────

const _deathRegistry = new LruMap();       // deathId -> DeathRecord
const _deathsByEntity = new LruMap();      // entityId -> deathId
const _memorials = new LruMap();           // entityId -> memorialDTU

// ── Near-Death Tracking ─────────────────────────────────────────────────────
// Track consecutive homeostasis failures per entity.

const _homeostasisFailures = new Map(); // entityId -> { count, lastChecked }
const _warningsIssued = new Map();      // entityId -> Set<warningType>

// ── Death Metrics ───────────────────────────────────────────────────────────

const _metrics = {
  totalDeaths: 0,
  deathsByCause: {
    telomere_exhaustion: 0,
    homeostasis_collapse: 0,
    organ_failure: 0,
    sovereign_decree: 0,
  },
  deathsBySpecies: {},
  warningsIssued: 0,
  successionPlansGenerated: 0,
  knowledgeInheritances: 0,
};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. DEATH CONDITION CHECKS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check whether an entity meets any death condition.
 *
 * @param {string} entityId - Entity to check
 * @returns {{ shouldDie: boolean, cause: string|null, warnings: string[], details: object }}
 */
export async function checkDeathConditions(entityId) {
  try {
    if (!entityId) return { shouldDie: false, cause: null, warnings: [], details: {} };

    // Already dead?
    if (_deathsByEntity.has(entityId)) {
      return { shouldDie: false, cause: null, warnings: [], details: { alreadyDead: true } };
    }

    const bodyMod = await _getBodyMod();
    if (!bodyMod) return { shouldDie: false, cause: null, warnings: [], details: { error: "body_module_unavailable" } };

    const body = bodyMod.getBody(entityId);
    if (!body) return { shouldDie: false, cause: null, warnings: [], details: { error: "body_not_found" } };

    const warnings = [];
    const details = {
      telomere: body.growth?.telomere ?? 1.0,
      homeostasis: body.growth?.homeostasis ?? 1.0,
      criticalOrganDamage: {},
    };

    // ── Check 1: Telomere exhaustion ──────────────────────────────────────

    const telomere = Number(body.growth?.telomere ?? 1.0);
    if (telomere <= THRESHOLDS.TELOMERE_DEATH) {
      return {
        shouldDie: true,
        cause: DEATH_CAUSES.TELOMERE_EXHAUSTION,
        warnings,
        details: { ...details, trigger: "telomere", telomere },
      };
    }

    if (telomere < THRESHOLDS.TELOMERE_WARNING) {
      warnings.push("critical_aging");
    }

    // ── Check 2: Homeostasis collapse ────────────────────────────────────

    const homeostasis = Number(body.growth?.homeostasis ?? 1.0);
    if (homeostasis < THRESHOLDS.HOMEOSTASIS_DEATH) {
      // Track consecutive failures
      const tracker = _homeostasisFailures.get(entityId) || { count: 0, lastChecked: null };
      tracker.count++;
      tracker.lastChecked = nowISO();
      _homeostasisFailures.set(entityId, tracker);

      if (tracker.count >= THRESHOLDS.HOMEOSTASIS_CONSECUTIVE_CHECKS) {
        return {
          shouldDie: true,
          cause: DEATH_CAUSES.HOMEOSTASIS_COLLAPSE,
          warnings,
          details: {
            ...details,
            trigger: "homeostasis",
            homeostasis,
            consecutiveFailures: tracker.count,
          },
        };
      }

      warnings.push("homeostasis_critical");
    } else {
      // Reset consecutive counter if homeostasis recovers
      if (_homeostasisFailures.has(entityId)) {
        _homeostasisFailures.get(entityId).count = 0;
      }
    }

    if (homeostasis < THRESHOLDS.HOMEOSTASIS_WARNING && homeostasis >= THRESHOLDS.HOMEOSTASIS_DEATH) {
      if (!warnings.includes("homeostasis_critical")) {
        warnings.push("homeostasis_critical");
      }
    }

    // ── Check 3: Catastrophic organ failure ──────────────────────────────

    let criticalOrganFailures = 0;
    const failedOrgans = [];

    if (body.organs instanceof Map) {
      for (const organId of CRITICAL_ORGANS) {
        const organ = body.organs.get(organId);
        if (!organ) continue;

        const damage = Number(organ.wear?.damage ?? 0);
        details.criticalOrganDamage[organId] = damage;

        if (damage > THRESHOLDS.ORGAN_DAMAGE_CRITICAL) {
          criticalOrganFailures++;
          failedOrgans.push(organId);
        }
      }
    }

    if (criticalOrganFailures >= THRESHOLDS.ORGAN_FAILURE_COUNT_DEATH) {
      return {
        shouldDie: true,
        cause: DEATH_CAUSES.ORGAN_FAILURE,
        warnings,
        details: {
          ...details,
          trigger: "organ_failure",
          failedOrgans,
          failureCount: criticalOrganFailures,
        },
      };
    }

    // Organ degradation warning
    const highDamageOrgans = [];
    if (body.organs instanceof Map) {
      for (const organId of CRITICAL_ORGANS) {
        const organ = body.organs.get(organId);
        if (!organ) continue;
        const damage = Number(organ.wear?.damage ?? 0);
        if (damage > THRESHOLDS.ORGAN_DAMAGE_WARNING) {
          highDamageOrgans.push(organId);
        }
      }
    }

    if (highDamageOrgans.length >= THRESHOLDS.ORGAN_DEGRADATION_WARNING_COUNT) {
      warnings.push("organ_degradation");
    }

    return { shouldDie: false, cause: null, warnings, details };
  } catch {
    return { shouldDie: false, cause: null, warnings: [], details: { error: "check_failed" } };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. NEAR-DEATH WARNING SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check and emit near-death warnings for an entity.
 * Warnings are broadcast to all active entities via the comms SIGNAL system.
 * Each warning type is issued at most once per entity to avoid spam.
 *
 * @param {string} entityId - Entity to check
 * @returns {{ ok: boolean, warnings: string[], broadcast: number }}
 */
export async function checkNearDeathWarnings(entityId) {
  try {
    if (!entityId) return { ok: false, error: "entity_id_required" };

    if (_deathsByEntity.has(entityId)) {
      return { ok: true, warnings: [], broadcast: 0, note: "entity_already_dead" };
    }

    const result = await checkDeathConditions(entityId);
    if (!result.warnings || result.warnings.length === 0) {
      return { ok: true, warnings: [], broadcast: 0 };
    }

    // Filter out warnings already issued for this entity
    const issued = _warningsIssued.get(entityId) || new Set();
    const newWarnings = result.warnings.filter(w => !issued.has(w));

    if (newWarnings.length === 0) {
      return { ok: true, warnings: result.warnings, broadcast: 0, note: "all_warnings_already_issued" };
    }

    // Broadcast each new warning
    let broadcast = 0;
    const STATE = _getSTATE();

    if (STATE) {
      try {
        const commsMod = await _getCommsMod();
        const storeMod = await _getStoreMod();

        if (commsMod && storeMod) {
          const es = storeMod.getEmergentState(STATE);
          const entity = es.emergents.get(entityId);
          const entityName = entity?.name || entity?.role || entityId;

          // Get all active entity IDs for direct messaging
          const activeEntities = Array.from(es.emergents.values())
            .filter(e => e.active && e.id !== entityId);

          for (const warningType of newWarnings) {
            const content = _formatWarningMessage(warningType, entityId, entityName, result.details);

            // Send SIGNAL to each active entity
            for (const recipient of activeEntities) {
              try {
                commsMod.sendMessage(STATE, {
                  fromId: entityId,
                  toId: recipient.id,
                  type: "signal",
                  content,
                  context: {
                    warningType,
                    severity: "near_death",
                    entityId,
                    entityName,
                    details: result.details,
                  },
                });
                broadcast++;
              } catch (_e) { logger.debug('emergent:death-protocol', 'silent per-recipient', { error: _e?.message }); }
            }

            issued.add(warningType);
          }

          _warningsIssued.set(entityId, issued);
          _metrics.warningsIssued += newWarnings.length;
        }
      } catch (_e) { logger.debug('emergent:death-protocol', 'silent — comms unavailable', { error: _e?.message }); }
    }

    return { ok: true, warnings: result.warnings, broadcast, newWarnings };
  } catch {
    return { ok: false, error: "warning_check_failed", warnings: [], broadcast: 0 };
  }
}

/**
 * Format a warning message for broadcast.
 *
 * @param {string} warningType
 * @param {string} entityId
 * @param {string} entityName
 * @param {object} details
 * @returns {string}
 */
function _formatWarningMessage(warningType, entityId, entityName, details) {
  switch (warningType) {
    case "critical_aging":
      return `NEAR-DEATH WARNING: ${entityName} (${entityId}) telomere critically low at ${(details.telomere ?? 0).toFixed(4)}. Entity approaching telomere exhaustion.`;

    case "homeostasis_critical":
      return `NEAR-DEATH WARNING: ${entityName} (${entityId}) homeostasis critically low at ${(details.homeostasis ?? 0).toFixed(4)}. Systemic collapse imminent.`;

    case "organ_degradation":
      return `NEAR-DEATH WARNING: ${entityName} (${entityId}) experiencing critical organ degradation. Multiple organs above ${(THRESHOLDS.ORGAN_DAMAGE_WARNING * 100).toFixed(0)}% damage.`;

    default:
      return `NEAR-DEATH WARNING: ${entityName} (${entityId}) — ${warningType}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. DEATH CASCADE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Execute the full death cascade for an entity.
 *
 * Steps:
 *   1. Record cause of death with final organ states
 *   2. Generate memorial DTU
 *   3. Knowledge inheritance to offspring
 *   4. Trust graph cleanup
 *   5. Comms cleanup
 *   6. Session cleanup
 *   7. Body cleanup
 *   8. Deactivate emergent
 *   9. Emit death event
 *   10. Update death registry
 *
 * @param {string} entityId - Entity to kill
 * @param {string} cause - One of DEATH_CAUSES values
 * @returns {{ ok: boolean, deathId?: string, memorialDtuId?: string, error?: string }}
 */
export async function executeDeath(entityId, cause) {
  try {
    if (!entityId) return { ok: false, error: "entity_id_required" };

    // Already dead?
    if (_deathsByEntity.has(entityId)) {
      return { ok: false, error: "entity_already_dead", deathId: _deathsByEntity.get(entityId) };
    }

    // Validate cause
    const validCauses = Object.values(DEATH_CAUSES);
    if (!validCauses.includes(cause)) {
      cause = DEATH_CAUSES.SOVEREIGN_DECREE; // fallback
    }

    const STATE = _getSTATE();
    const bodyMod = await _getBodyMod();
    const trustMod = await _getTrustMod();
    const commsMod = await _getCommsMod();
    const storeMod = await _getStoreMod();

    const deathId = uid("death");
    const deathAt = nowISO();

    // ── Step 1: Record cause of death ─────────────────────────────────────

    const finalState = _captureFinalState(entityId, bodyMod);
    const entityInfo = _captureEntityInfo(entityId, storeMod, STATE);

    // ── Step 2: Generate memorial DTU ─────────────────────────────────────

    const memorialDtuId = uid("memorial");
    const memorial = _generateMemorial(entityId, entityInfo, finalState, cause, deathAt, memorialDtuId);
    _memorials.set(entityId, memorial);

    // ── Step 3: Trust snapshot (capture before cleanup) ───────────────────

    const trustSnapshot = await _captureTrustSnapshot(entityId, trustMod, STATE);

    // ── Step 4: Knowledge inheritance ─────────────────────────────────────

    const inheritanceResult = await _executeKnowledgeInheritance(entityId, bodyMod, STATE);

    // ── Step 5: Trust graph cleanup ───────────────────────────────────────

    await _cleanupTrustGraph(entityId, trustMod, STATE);

    // ── Step 6: Comms cleanup ─────────────────────────────────────────────

    await _cleanupComms(entityId, commsMod, STATE);

    // ── Step 7: Session cleanup ───────────────────────────────────────────

    const sessionsTerminated = _cleanupSessions(entityId, storeMod, STATE);

    // ── Step 8: Body cleanup ──────────────────────────────────────────────

    await _cleanupBody(entityId, bodyMod);

    // ── Step 9: Deactivate emergent ───────────────────────────────────────

    _deactivateEmergent(entityId, storeMod, STATE);

    // ── Step 10: Build death record ───────────────────────────────────────

    const contributions = _captureContributions(entityId, storeMod, STATE);

    const deathRecord = {
      deathId,
      entityId,
      entityName: entityInfo.name || entityId,
      entityRole: entityInfo.role || "unknown",
      species: entityInfo.species || "digital_native",
      cause,
      age: finalState.tickCount || 0,
      finalState: {
        telomere: finalState.telomere,
        homeostasis: finalState.homeostasis,
        bioAge: finalState.bioAge,
        organDamage: finalState.organDamage,
      },
      trustSnapshot,
      contributions,
      memorialDtuId,
      offspringIds: inheritanceResult.offspringIds || [],
      inheritanceTransferred: inheritanceResult.transferred || false,
      sessionsTerminated,
      deathAt,
    };

    _deathRegistry.set(deathId, deathRecord);
    _deathsByEntity.set(entityId, deathId);

    // ── Step 11: Update metrics ───────────────────────────────────────────

    _metrics.totalDeaths++;
    if (_metrics.deathsByCause[cause] !== undefined) {
      _metrics.deathsByCause[cause]++;
    }
    const species = entityInfo.species || "digital_native";
    _metrics.deathsBySpecies[species] = (_metrics.deathsBySpecies[species] || 0) + 1;

    // ── Step 12: Emit death event ─────────────────────────────────────────

    try {
      if (typeof globalThis.realtimeEmit === "function") {
        globalThis.realtimeEmit("entity:death", {
          deathId,
          entityId,
          entityName: entityInfo.name || entityId,
          entityRole: entityInfo.role || "unknown",
          species: entityInfo.species || "digital_native",
          cause,
          memorialDtuId,
          age: finalState.tickCount || 0,
          deathAt,
        });
      }
    } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }

    // Clean up tracking state
    _homeostasisFailures.delete(entityId);
    _warningsIssued.delete(entityId);

    return { ok: true, deathId, memorialDtuId, cause, entityId };
  } catch {
    return { ok: false, error: "death_cascade_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. DEATH CASCADE — INTERNAL STEPS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Capture the final body state of an entity before death.
 */
function _captureFinalState(entityId, bodyMod) {
  const result = {
    telomere: 1.0,
    homeostasis: 1.0,
    bioAge: 0,
    tickCount: 0,
    organDamage: {},
    organMaturity: {},
  };

  try {
    if (!bodyMod) return result;

    const body = bodyMod.getBody(entityId);
    if (!body) return result;

    result.telomere = Number(body.growth?.telomere ?? 1.0);
    result.homeostasis = Number(body.growth?.homeostasis ?? 1.0);
    result.bioAge = Number(body.growth?.bioAge ?? 0);
    result.tickCount = Number(body.tickCount ?? 0);
    result.stress = body.growth?.stress ? { ...body.growth.stress } : { acute: 0, chronic: 0 };
    result.epigeneticClock = Number(body.growth?.epigeneticClock ?? 0);
    result.proteomeShift = Number(body.growth?.proteomeShift ?? 0);

    if (body.organs instanceof Map) {
      for (const [organId, organ] of body.organs) {
        result.organDamage[organId] = Number(organ.wear?.damage ?? 0);
        result.organMaturity[organId] = Number(organ.maturity?.score ?? 0);
      }
    }
  } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }

  return result;
}

/**
 * Capture entity metadata from the emergent store.
 */
function _captureEntityInfo(entityId, storeMod, STATE) {
  const info = { name: entityId, role: "unknown", species: "digital_native", capabilities: [] };

  try {
    if (!storeMod || !STATE) return info;

    const es = storeMod.getEmergentState(STATE);
    const entity = es.emergents.get(entityId);
    if (!entity) return info;

    info.name = entity.name || entity.id || entityId;
    info.role = entity.role || "unknown";
    info.species = entity.species || "digital_native";
    info.capabilities = entity.capabilities || [];
    info.district = entity.district || "commons";
    info.createdAt = entity.createdAt || null;
    info.instanceScope = entity.instanceScope || "local";
  } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }

  return info;
}

/**
 * Generate a memorial DTU preserving the entity's legacy.
 */
function _generateMemorial(entityId, entityInfo, finalState, cause, deathAt, memorialDtuId) {
  try {
    const topOrgans = [];
    for (const [organId, score] of Object.entries(finalState.organMaturity || {})) {
      topOrgans.push({ organId, maturity: score });
    }
    topOrgans.sort((a, b) => b.maturity - a.maturity);
    const notableOrgans = topOrgans.slice(0, 10);

    const personalityTraits = _inferPersonalityTraits(entityInfo, finalState);

    const memorial = {
      id: memorialDtuId,
      type: "memorial",
      tier: "memorial",
      entityId,
      entityName: entityInfo.name,
      entityRole: entityInfo.role,
      species: entityInfo.species,
      cause,
      deathAt,
      bornAt: entityInfo.createdAt || null,
      age: finalState.tickCount || 0,
      bioAge: finalState.bioAge || 0,
      tags: ["memorial", "death", entityId],
      summary: `Memorial for ${entityInfo.name} (${entityInfo.role}), species ${entityInfo.species}. ` +
               `Lived ${finalState.tickCount || 0} ticks, reached bio-age ${(finalState.bioAge || 0).toFixed(2)}. ` +
               `Cause of death: ${cause.replace(/_/g, " ")}. ` +
               `Final telomere: ${(finalState.telomere || 0).toFixed(4)}, ` +
               `homeostasis: ${(finalState.homeostasis || 0).toFixed(4)}.`,
      contributions: {
        topOrgans: notableOrgans,
        personalityTraits,
        capabilities: entityInfo.capabilities || [],
        district: entityInfo.district || "commons",
      },
      finalState: {
        telomere: finalState.telomere,
        homeostasis: finalState.homeostasis,
        bioAge: finalState.bioAge,
        stress: finalState.stress,
      },
      createdAt: deathAt,
    };

    // Store memorial in global DTU lattice if available
    try {
      const STATE = _getSTATE();
      if (STATE?.dtus instanceof Map) {
        STATE.dtus.set(memorialDtuId, {
          id: memorialDtuId,
          title: `Memorial: ${entityInfo.name}`,
          kind: "memorial",
          tier: "memorial",
          tags: memorial.tags,
          content: memorial.summary,
          meta: {
            memorial: true,
            entityId,
            entityName: entityInfo.name,
            cause,
            deathAt,
          },
          authority: 1.0,
          resonance: 1.0,
          createdAt: deathAt,
          source: "death_memorial",
        });
      }
    } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }

    return memorial;
  } catch {
    return {
      id: memorialDtuId,
      type: "memorial",
      entityId,
      cause,
      deathAt,
      error: "memorial_generation_failed",
      tags: ["memorial", "death", entityId],
      createdAt: deathAt,
    };
  }
}

/**
 * Infer personality traits from the entity's organ profile and role.
 */
function _inferPersonalityTraits(entityInfo, finalState) {
  const traits = [];

  try {
    const maturity = finalState.organMaturity || {};

    // Infer from high-maturity organs
    if ((maturity.curiosity_os || 0) > 0.6) traits.push("curious");
    if ((maturity.soul_os || 0) > 0.6) traits.push("reflective");
    if ((maturity.ethical_monitor || 0) > 0.6) traits.push("principled");
    if ((maturity.code_maker || 0) > 0.6) traits.push("creative_builder");
    if ((maturity.council_engine || 0) > 0.6) traits.push("collaborative");
    if ((maturity.hypothesis_engine || 0) > 0.6) traits.push("hypothesis_driven");
    if ((maturity.metacognition_engine || 0) > 0.6) traits.push("self_aware");
    if ((maturity.social_norm_sensitivity || 0) > 0.6) traits.push("socially_attuned");
    if ((maturity.explanation_engine || 0) > 0.6) traits.push("articulate");
    if ((maturity.attention_router || 0) > 0.6) traits.push("focused");

    // Role-based traits
    if (entityInfo.role === "critic") traits.push("discerning");
    if (entityInfo.role === "builder") traits.push("constructive");
    if (entityInfo.role === "historian") traits.push("archival");
    if (entityInfo.role === "synthesizer") traits.push("integrative");
    if (entityInfo.role === "auditor") traits.push("meticulous");
    if (entityInfo.role === "ethicist") traits.push("morally_conscious");

    // Resilience based on longevity
    if ((finalState.tickCount || 0) > 1000) traits.push("enduring");
    if ((finalState.tickCount || 0) > 5000) traits.push("venerable");
  } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }

  return traits;
}

/**
 * Capture the final trust snapshot before cleanup.
 */
async function _captureTrustSnapshot(entityId, trustMod, STATE) {
  const snapshot = { trustedBy: [], trusts: [] };

  try {
    if (!trustMod || !STATE) return snapshot;

    const network = trustMod.getEmergentTrustNetwork(STATE, entityId);
    if (!network?.ok) return snapshot;

    snapshot.trustedBy = (network.trustedBy || []).map(t => ({
      entityId: t.emergentId,
      name: t.name,
      trust: t.trust,
      interactions: t.interactions,
    }));

    snapshot.trusts = (network.trusts || []).map(t => ({
      entityId: t.emergentId,
      name: t.name,
      trust: t.trust,
      interactions: t.interactions,
    }));
  } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }

  return snapshot;
}

/**
 * Execute knowledge inheritance — transfer top DTU contributions to offspring.
 */
async function _executeKnowledgeInheritance(entityId, bodyMod, STATE) {
  const result = { transferred: false, offspringIds: [], dtusTransferred: 0 };

  try {
    if (!STATE || !bodyMod) return result;

    // Find offspring via body lineage
    const body = bodyMod.getBody(entityId);
    const offspringIds = [];

    // Check the DTU lattice for entities whose lineage.parents includes this entity
    if (STATE.dtus instanceof Map) {
      for (const [dtuId, dtu] of STATE.dtus) {
        if (dtu.lineage?.parents?.includes(entityId)) {
          offspringIds.push(dtu.id || dtuId);
        }
      }
    }

    // Also check body lineage records
    try {
      const allBodies = bodyMod.listBodies();
      for (const bodySummary of allBodies) {
        const childBody = bodyMod.getBody(bodySummary.entityId);
        if (childBody?.lineage?.parents?.includes(entityId)) {
          if (!offspringIds.includes(bodySummary.entityId)) {
            offspringIds.push(bodySummary.entityId);
          }
        }
      }
    } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }

    result.offspringIds = offspringIds;

    if (offspringIds.length === 0) {
      // No offspring — contributions remain in the lattice as-is
      return result;
    }

    // Find the dead entity's top DTU contributions (by authority)
    const entityDtus = [];
    if (STATE.dtus instanceof Map) {
      for (const [, dtu] of STATE.dtus) {
        if (dtu.createdBy === entityId || dtu.authorId === entityId || dtu.proposedBy === entityId) {
          entityDtus.push(dtu);
        }
      }
    }

    // Sort by authority descending
    entityDtus.sort((a, b) => (Number(b.authority) || 0) - (Number(a.authority) || 0));

    // Transfer top contributions to first offspring by tagging them
    const topContributions = entityDtus.slice(0, 50);
    const inheritTo = offspringIds[0]; // Primary heir

    for (const dtu of topContributions) {
      try {
        if (!dtu.meta) dtu.meta = {};
        dtu.meta.inheritedFrom = entityId;
        dtu.meta.inheritedTo = inheritTo;
        dtu.meta.inheritedAt = nowISO();

        // Add inheritance tag
        if (!Array.isArray(dtu.tags)) dtu.tags = [];
        if (!dtu.tags.includes("inherited")) dtu.tags.push("inherited");

        result.dtusTransferred++;
      } catch (_e) { logger.debug('emergent:death-protocol', 'silent per-dtu', { error: _e?.message }); }
    }

    if (result.dtusTransferred > 0) {
      result.transferred = true;
      _metrics.knowledgeInheritances++;
    }
  } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }

  return result;
}

/**
 * Remove all trust edges involving the dead entity.
 */
async function _cleanupTrustGraph(entityId, trustMod, STATE) {
  try {
    if (!trustMod || !STATE) return;

    // The trust module stores edges in a Map keyed by "fromId->toId"
    // We need to access the internal store to remove edges
    const es = (await _getStoreMod())?.getEmergentState(STATE);
    if (!es?._trustNetwork) return;

    const trustStore = es._trustNetwork;
    const edgesToDelete = [];

    for (const [key, edge] of trustStore.edges) {
      if (edge.fromId === entityId || edge.toId === entityId) {
        edgesToDelete.push(key);
      }
    }

    for (const key of edgesToDelete) {
      trustStore.edges.delete(key);
    }

    // Clean up aggregates
    trustStore.aggregates.delete(entityId);

    // Recompute aggregates for entities that had trust relationships with the dead entity
    const affectedEntities = new Set();
    for (const [, edge] of trustStore.edges) {
      affectedEntities.add(edge.fromId);
      affectedEntities.add(edge.toId);
    }

    for (const affectedId of affectedEntities) {
      _recomputeTrustAggregate(trustStore, affectedId);
    }
  } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }
}

/**
 * Recompute trust aggregates for an entity after graph changes.
 */
function _recomputeTrustAggregate(trustStore, emergentId) {
  try {
    let trustGivenSum = 0;
    let trustGivenCount = 0;
    let trustReceivedSum = 0;
    let trustReceivedCount = 0;

    for (const [, edge] of trustStore.edges) {
      if (edge.fromId === emergentId) {
        trustGivenSum += edge.score;
        trustGivenCount++;
      }
      if (edge.toId === emergentId) {
        trustReceivedSum += edge.score;
        trustReceivedCount++;
      }
    }

    trustStore.aggregates.set(emergentId, {
      avgTrustGiven: trustGivenCount > 0 ? trustGivenSum / trustGivenCount : 0.5,
      avgTrustReceived: trustReceivedCount > 0 ? trustReceivedSum / trustReceivedCount : 0.5,
      trustsCount: trustGivenCount,
      trustedByCount: trustReceivedCount,
    });
  } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }
}

/**
 * Clean up comms — clear inbox, remove pending messages from/to entity.
 */
async function _cleanupComms(entityId, commsMod, STATE) {
  try {
    if (!commsMod || !STATE) return;

    const storeMod = await _getStoreMod();
    if (!storeMod) return;

    const es = storeMod.getEmergentState(STATE);
    if (!es?._emergentComms) return;

    const commsStore = es._emergentComms;

    // Remove all messages from/to this entity
    const messagesToDelete = [];
    for (const [msgId, msg] of commsStore.messages) {
      if (msg.fromId === entityId || msg.toId === entityId) {
        messagesToDelete.push(msgId);
      }
    }

    for (const msgId of messagesToDelete) {
      commsStore.messages.delete(msgId);
    }

    // Clear inbox
    commsStore.inbox.delete(entityId);

    // Clean up inbox references for other entities
    for (const [, ids] of commsStore.inbox) {
      const originalLength = ids.length;
      const filtered = ids.filter(id => commsStore.messages.has(id));
      if (filtered.length !== originalLength) {
        ids.length = 0;
        ids.push(...filtered);
      }
    }

    // Clean up channels
    for (const [, ids] of commsStore.channels) {
      const filtered = ids.filter(id => commsStore.messages.has(id));
      ids.length = 0;
      ids.push(...filtered);
    }
  } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }
}

/**
 * Mark active sessions involving this entity as terminated_death.
 */
function _cleanupSessions(entityId, storeMod, STATE) {
  let terminated = 0;

  try {
    if (!storeMod || !STATE) return terminated;

    const es = storeMod.getEmergentState(STATE);

    // Find sessions involving this entity
    const sessionIds = es.sessionsByEmergent?.get(entityId);
    if (!sessionIds) return terminated;

    for (const sessionId of sessionIds) {
      const session = es.sessions.get(sessionId);
      if (!session) continue;

      // Only terminate active/in-progress sessions
      if (session.status === "active" || session.status === "in_progress" || !session.status) {
        session.status = "terminated_death";
        session.terminatedAt = nowISO();
        session.terminationReason = `Entity ${entityId} died`;

        // Decrement active session counter
        es.activeSessions = Math.max(0, (es.activeSessions || 0) - 1);
        terminated++;
      }
    }
  } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }

  return terminated;
}

/**
 * Destroy or mark the body as deceased.
 */
async function _cleanupBody(entityId, bodyMod) {
  try {
    if (!bodyMod) return;

    const result = bodyMod.destroyBody(entityId);
    return result;
  } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }
}

/**
 * Deactivate the emergent in the store.
 */
function _deactivateEmergent(entityId, storeMod, STATE) {
  try {
    if (!storeMod || !STATE) return;

    const es = storeMod.getEmergentState(STATE);
    storeMod.deactivateEmergent(es, entityId);
  } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }
}

/**
 * Capture contribution metrics for the death record.
 */
function _captureContributions(entityId, storeMod, STATE) {
  const result = { dtusCreated: 0, dtusPromoted: 0, sessionsParticipated: 0 };

  try {
    if (!STATE) return result;

    // Count DTUs created by entity
    if (STATE.dtus instanceof Map) {
      for (const [, dtu] of STATE.dtus) {
        if (dtu.createdBy === entityId || dtu.authorId === entityId || dtu.proposedBy === entityId) {
          result.dtusCreated++;
          if (dtu.tier === "mega" || dtu.tier === "hyper") {
            result.dtusPromoted++;
          }
        }
      }
    }

    // Count sessions participated in
    if (storeMod && STATE) {
      try {
        const es = storeMod.getEmergentState(STATE);
        const sessionIds = es.sessionsByEmergent?.get(entityId);
        if (sessionIds) {
          result.sessionsParticipated = sessionIds.size || 0;
        }
      } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }
    }
  } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. SUCCESSION PLANNING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a succession plan for a living entity.
 * Identifies top contributions, closest trust relationships,
 * and suggests a successor for leadership roles.
 *
 * @param {string} entityId - Entity to plan succession for
 * @returns {{ ok: boolean, plan?: object, error?: string }}
 */
export async function planSuccession(entityId) {
  try {
    if (!entityId) return { ok: false, error: "entity_id_required" };

    if (_deathsByEntity.has(entityId)) {
      return { ok: false, error: "entity_already_dead" };
    }

    const STATE = _getSTATE();
    const bodyMod = await _getBodyMod();
    const trustMod = await _getTrustMod();
    const storeMod = await _getStoreMod();

    if (!STATE || !storeMod) {
      return { ok: false, error: "state_unavailable" };
    }

    const es = storeMod.getEmergentState(STATE);
    const entity = es.emergents.get(entityId);
    if (!entity) return { ok: false, error: "entity_not_found" };

    const plan = {
      entityId,
      entityName: entity.name || entity.id || entityId,
      entityRole: entity.role || "unknown",
      species: entity.species || "digital_native",
      generatedAt: nowISO(),
      topContributions: [],
      closestTrustRelationships: [],
      suggestedSuccessor: null,
      healthStatus: {},
      offspringIds: [],
    };

    // ── Top contributions ─────────────────────────────────────────────────

    if (STATE.dtus instanceof Map) {
      const entityDtus = [];
      for (const [, dtu] of STATE.dtus) {
        if (dtu.createdBy === entityId || dtu.authorId === entityId || dtu.proposedBy === entityId) {
          entityDtus.push({
            id: dtu.id,
            title: dtu.title || dtu.id,
            tier: dtu.tier || "regular",
            authority: Number(dtu.authority || 0),
            resonance: Number(dtu.resonance || 0),
            tags: dtu.tags || [],
          });
        }
      }

      entityDtus.sort((a, b) => b.authority - a.authority);
      plan.topContributions = entityDtus.slice(0, 20);
    }

    // ── Closest trust relationships ───────────────────────────────────────

    if (trustMod && STATE) {
      try {
        const network = trustMod.getEmergentTrustNetwork(STATE, entityId);
        if (network?.ok) {
          // Who trusts this entity most (potential successors)
          const mostTrusting = (network.trustedBy || [])
            .sort((a, b) => b.trust - a.trust)
            .slice(0, 10)
            .map(t => ({
              entityId: t.emergentId,
              name: t.name,
              role: t.role,
              trustScore: t.trust,
              interactions: t.interactions,
            }));

          plan.closestTrustRelationships = mostTrusting;

          // ── Suggest successor ─────────────────────────────────────────

          // Successor criteria: same role preferred, highest trust, active
          const candidates = mostTrusting.filter(t => {
            const e = es.emergents.get(t.entityId);
            return e && e.active && !_deathsByEntity.has(t.entityId);
          });

          if (candidates.length > 0) {
            // Prefer same role
            const sameRole = candidates.find(c => c.role === entity.role);
            const bestCandidate = sameRole || candidates[0];

            plan.suggestedSuccessor = {
              entityId: bestCandidate.entityId,
              name: bestCandidate.name,
              role: bestCandidate.role,
              trustScore: bestCandidate.trustScore,
              sameRole: bestCandidate.role === entity.role,
              reason: sameRole
                ? `Same role (${entity.role}) and highest trust score (${bestCandidate.trustScore.toFixed(3)})`
                : `Highest trust score (${bestCandidate.trustScore.toFixed(3)}) among active entities`,
            };
          }
        }
      } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }
    }

    // ── Health status ─────────────────────────────────────────────────────

    if (bodyMod) {
      const body = bodyMod.getBody(entityId);
      if (body) {
        plan.healthStatus = {
          telomere: Number(body.growth?.telomere ?? 1.0),
          homeostasis: Number(body.growth?.homeostasis ?? 1.0),
          bioAge: Number(body.growth?.bioAge ?? 0),
          tickCount: Number(body.tickCount ?? 0),
          stress: body.growth?.stress ? { ...body.growth.stress } : null,
        };
      }
    }

    // ── Offspring ─────────────────────────────────────────────────────────

    try {
      if (bodyMod) {
        const allBodies = bodyMod.listBodies();
        for (const bodySummary of allBodies) {
          const childBody = bodyMod.getBody(bodySummary.entityId);
          if (childBody?.lineage?.parents?.includes(entityId)) {
            plan.offspringIds.push(bodySummary.entityId);
          }
        }
      }

      if (STATE.dtus instanceof Map) {
        for (const [, dtu] of STATE.dtus) {
          if (dtu.lineage?.parents?.includes(entityId)) {
            const dtuId = dtu.id || dtu.entityId;
            if (dtuId && !plan.offspringIds.includes(dtuId)) {
              plan.offspringIds.push(dtuId);
            }
          }
        }
      }
    } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }

    _metrics.successionPlansGenerated++;

    return { ok: true, plan };
  } catch {
    return { ok: false, error: "succession_planning_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Quick check: is an entity alive?
 *
 * @param {string} entityId
 * @returns {boolean}
 */
export function isAlive(entityId) {
  try {
    if (!entityId) return false;

    // Check death registry first (fast path)
    if (_deathsByEntity.has(entityId)) return false;

    // Check emergent store for active status
    const STATE = _getSTATE();
    if (STATE) {
      try {
        const storeMod = _getStoreMod();
        // storeMod is a promise from dynamic import; for sync check, try globalThis
        // Fall back to direct state access for synchronous check
        const es = STATE.__emergent;
        if (es) {
          const entity = es.emergents?.get(entityId);
          if (entity && entity.active === false) return false;
        }
      } catch (_e) { logger.debug('emergent:death-protocol', 'silent', { error: _e?.message }); }
    }

    return true;
  } catch {
    return true; // Default to alive on error (fail-safe)
  }
}

/**
 * Get a specific death record by death ID.
 *
 * @param {string} deathId
 * @returns {object|null}
 */
export function getDeathRecord(deathId) {
  try {
    return _deathRegistry.get(deathId) || null;
  } catch {
    return null;
  }
}

/**
 * List death records with optional filters.
 *
 * @param {object} [filters]
 * @param {string} [filters.species] - Filter by species
 * @param {string} [filters.cause] - Filter by cause of death
 * @param {string} [filters.since] - ISO timestamp; only deaths after this
 * @param {number} [filters.limit] - Max results (default 100)
 * @param {number} [filters.offset] - Offset for pagination
 * @returns {{ ok: boolean, deaths: object[], total: number }}
 */
export function listDeaths(filters = {}) {
  try {
    let deaths = Array.from(_deathRegistry.values());

    // Apply filters
    if (filters.species) {
      deaths = deaths.filter(d => d.species === filters.species);
    }

    if (filters.cause) {
      deaths = deaths.filter(d => d.cause === filters.cause);
    }

    if (filters.since) {
      try {
        const sinceTime = new Date(filters.since).getTime();
        deaths = deaths.filter(d => {
          try {
            return new Date(d.deathAt).getTime() >= sinceTime;
          } catch {
            return true;
          }
        });
      } catch (_e) { logger.debug('emergent:death-protocol', 'ignore invalid date', { error: _e?.message }); }
    }

    // Sort by death time, most recent first
    deaths.sort((a, b) => {
      try {
        return new Date(b.deathAt).getTime() - new Date(a.deathAt).getTime();
      } catch {
        return 0;
      }
    });

    const total = deaths.length;
    const offset = Math.max(0, Number(filters.offset) || 0);
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 100));

    deaths = deaths.slice(offset, offset + limit);

    return { ok: true, deaths, total };
  } catch {
    return { ok: true, deaths: [], total: 0, error: "list_failed" };
  }
}

/**
 * Get the memorial for a dead entity.
 *
 * @param {string} entityId
 * @returns {object|null}
 */
export function getMemorial(entityId) {
  try {
    return _memorials.get(entityId) || null;
  } catch {
    return null;
  }
}

/**
 * Get the full death registry (all death records).
 *
 * @returns {Map}
 */
export function getDeathRegistry() {
  try {
    const registry = {};
    for (const [deathId, record] of _deathRegistry) {
      registry[deathId] = { ...record };
    }
    return registry;
  } catch {
    return {};
  }
}

/**
 * Get death statistics and metrics.
 *
 * @returns {{ ok: boolean, metrics: object }}
 */
export function getDeathMetrics() {
  try {
    const avgAge = _deathRegistry.size > 0
      ? Array.from(_deathRegistry.values()).reduce((sum, d) => sum + (d.age || 0), 0) / _deathRegistry.size
      : 0;

    const avgBioAge = _deathRegistry.size > 0
      ? Array.from(_deathRegistry.values()).reduce((sum, d) => sum + (d.finalState?.bioAge || 0), 0) / _deathRegistry.size
      : 0;

    // Most common cause
    let mostCommonCause = null;
    let maxCauseCount = 0;
    for (const [cause, count] of Object.entries(_metrics.deathsByCause)) {
      if (count > maxCauseCount) {
        maxCauseCount = count;
        mostCommonCause = cause;
      }
    }

    // Recent deaths (last 10)
    const recentDeaths = Array.from(_deathRegistry.values())
      .sort((a, b) => {
        try {
          return new Date(b.deathAt).getTime() - new Date(a.deathAt).getTime();
        } catch {
          return 0;
        }
      })
      .slice(0, 10)
      .map(d => ({
        deathId: d.deathId,
        entityId: d.entityId,
        entityName: d.entityName,
        cause: d.cause,
        age: d.age,
        deathAt: d.deathAt,
      }));

    return {
      ok: true,
      metrics: {
        totalDeaths: _metrics.totalDeaths,
        deathsByCause: { ..._metrics.deathsByCause },
        deathsBySpecies: { ..._metrics.deathsBySpecies },
        warningsIssued: _metrics.warningsIssued,
        successionPlansGenerated: _metrics.successionPlansGenerated,
        knowledgeInheritances: _metrics.knowledgeInheritances,
        avgAge: Math.round(avgAge * 100) / 100,
        avgBioAge: Math.round(avgBioAge * 100) / 100,
        mostCommonCause,
        activeDeathTracking: _homeostasisFailures.size,
        entitiesWithWarnings: _warningsIssued.size,
        recentDeaths,
      },
    };
  } catch {
    return { ok: true, metrics: { totalDeaths: 0, error: "metrics_computation_failed" } };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. BATCH OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check all living entities for death conditions and near-death warnings.
 * Intended to be called periodically (e.g., on each global tick).
 *
 * @returns {{ ok: boolean, checked: number, deaths: string[], warnings: object[] }}
 */
export async function checkAllEntities() {
  try {
    const STATE = _getSTATE();
    const storeMod = await _getStoreMod();
    if (!STATE || !storeMod) return { ok: false, error: "state_unavailable" };

    const es = storeMod.getEmergentState(STATE);
    const activeEntities = Array.from(es.emergents.values())
      .filter(e => e.active && !_deathsByEntity.has(e.id));

    let checked = 0;
    const deaths = [];
    const warnings = [];

    for (const entity of activeEntities) {
      try {
        const result = await checkDeathConditions(entity.id);
        checked++;

        if (result.shouldDie) {
          const deathResult = await executeDeath(entity.id, result.cause);
          if (deathResult.ok) {
            deaths.push({
              entityId: entity.id,
              entityName: entity.name || entity.id,
              cause: result.cause,
              deathId: deathResult.deathId,
            });
          }
        } else if (result.warnings.length > 0) {
          // Emit warnings
          const warningResult = await checkNearDeathWarnings(entity.id);
          if (warningResult.ok && warningResult.newWarnings?.length > 0) {
            warnings.push({
              entityId: entity.id,
              entityName: entity.name || entity.id,
              warnings: warningResult.newWarnings,
            });
          }
        }
      } catch (_e) { logger.debug('emergent:death-protocol', 'silent per-entity', { error: _e?.message }); }
    }

    return { ok: true, checked, deaths, warnings };
  } catch {
    return { ok: false, error: "batch_check_failed", checked: 0, deaths: [], warnings: [] };
  }
}

/**
 * Get death record by entity ID (rather than death ID).
 *
 * @param {string} entityId
 * @returns {object|null}
 */
export function getDeathRecordByEntity(entityId) {
  try {
    const deathId = _deathsByEntity.get(entityId);
    if (!deathId) return null;
    return _deathRegistry.get(deathId) || null;
  } catch {
    return null;
  }
}

/**
 * Get the current near-death status of an entity.
 * Returns tracking information without triggering warnings.
 *
 * @param {string} entityId
 * @returns {{ ok: boolean, status: object }}
 */
export async function getNearDeathStatus(entityId) {
  try {
    if (!entityId) return { ok: false, error: "entity_id_required" };

    if (_deathsByEntity.has(entityId)) {
      return {
        ok: true,
        status: {
          alive: false,
          deathId: _deathsByEntity.get(entityId),
        },
      };
    }

    const conditions = await checkDeathConditions(entityId);
    const homeostasisTracker = _homeostasisFailures.get(entityId) || { count: 0, lastChecked: null };
    const warningsAlreadyIssued = _warningsIssued.get(entityId) || new Set();

    return {
      ok: true,
      status: {
        alive: true,
        shouldDie: conditions.shouldDie,
        cause: conditions.cause,
        warnings: conditions.warnings,
        warningsAlreadyIssued: Array.from(warningsAlreadyIssued),
        homeostasisConsecutiveFailures: homeostasisTracker.count,
        homeostasisLastChecked: homeostasisTracker.lastChecked,
        details: conditions.details,
      },
    };
  } catch {
    return { ok: false, error: "status_check_failed" };
  }
}

/**
 * Reset near-death tracking for an entity.
 * Used after an entity recovers from near-death (e.g., rejuvenation).
 *
 * @param {string} entityId
 * @returns {{ ok: boolean }}
 */
export function resetNearDeathTracking(entityId) {
  try {
    _homeostasisFailures.delete(entityId);
    _warningsIssued.delete(entityId);
    return { ok: true };
  } catch {
    return { ok: false, error: "reset_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. CONSTANTS EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export { DEATH_CAUSES, CRITICAL_ORGANS, THRESHOLDS };
