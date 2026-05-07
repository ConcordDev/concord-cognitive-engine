/**
 * Existential OS — Integration Hooks
 *
 * Functions that existing subsystems call to feed qualia data.
 * Each hook takes data that the subsystem ALREADY produces and
 * translates it into channel updates.
 *
 * NO changes to subsystem logic. The hook is called AT THE END
 * of existing operations as an optional addition.
 *
 * Every hook is wrapped in try/catch with silent failure at the call site:
 *   try { hooks.hookAutogen(emergentId, result); } catch(e) { /* silent * / }
 */

/**
 * Get the qualia engine instance. Returns null if not initialized.
 * @returns {import('./engine.js').QualiaEngine|null}
 */
function getEngine() {
  return globalThis.qualiaEngine || null;
}

/**
 * Safe clamp to [0, 1].
 */
function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

/**
 * Called after autogen pipeline completes a cycle.
 *
 * @param {string} entityId
 * @param {object} pipelineResult - { gapsFound, dtusGenerated, noveltyScore, alignmentScore, ... }
 */
export function hookAutogen(entityId, pipelineResult) {
  const engine = getEngine();
  if (!engine || !entityId) return;

  const r = pipelineResult || {};
  const updates = {};

  // Number of gaps found → gap severity
  if (r.gapsFound !== undefined || r.gaps !== undefined) {
    const gaps = Number(r.gapsFound ?? r.gaps ?? 0);
    updates["meta_growth_os.gap_severity"] = clamp01(gaps / 10);
  }

  // Number of DTUs generated → coverage score
  if (r.dtusGenerated !== undefined || r.created !== undefined || r.count !== undefined) {
    const generated = Number(r.dtusGenerated ?? r.created ?? r.count ?? 0);
    updates["meta_growth_os.coverage_score"] = clamp01(generated / 5);
  }

  // Novelty of generated content
  if (r.noveltyScore !== undefined || r.novelty !== undefined) {
    updates["creative_mutation_os.novelty_score"] = clamp01(r.noveltyScore ?? r.novelty ?? 0);
  }

  // Alignment with existing lattice
  if (r.alignmentScore !== undefined || r.alignment !== undefined) {
    updates["creative_mutation_os.alignment_score"] = clamp01(r.alignmentScore ?? r.alignment ?? 0);
  }

  if (Object.keys(updates).length > 0) {
    engine.batchUpdate(entityId, updates);
  }
}

/**
 * Called when an emergent participates in council governance.
 *
 * @param {string} entityId
 * @param {object} voteData - { agreement, conflict, confidence, majority, ... }
 */
export function hookCouncilVote(entityId, voteData) {
  const engine = getEngine();
  if (!engine || !entityId) return;

  const v = voteData || {};
  const updates = {};

  // Agreement with majority → cohesion
  if (v.agreement !== undefined) {
    updates["sociodynamics_os.cohesion"] = clamp01(v.agreement);
  }

  // Conflict with other voters
  if (v.conflict !== undefined || v.conflictRisk !== undefined) {
    updates["sociodynamics_os.conflict_risk"] = clamp01(v.conflict ?? v.conflictRisk ?? 0);
  }

  // Confidence in own vote → evidence weight
  if (v.confidence !== undefined) {
    updates["truth_os.evidence_weight"] = clamp01(v.confidence);
  }

  if (Object.keys(updates).length > 0) {
    engine.batchUpdate(entityId, updates);
  }
}

/**
 * Called when any DTU is created.
 *
 * @param {string} entityId
 * @param {object} dtu - The created DTU
 */
export function hookDTUCreation(entityId, dtu) {
  const engine = getEngine();
  if (!engine || !entityId) return;

  const d = dtu || {};
  const updates = {};

  // Logical consistency of DTU claims
  if (d.logicalConsistency !== undefined || d.consistency !== undefined) {
    updates["logic_os.logical_consistency_score"] = clamp01(d.logicalConsistency ?? d.consistency ?? 0.5);
  }

  // Contradiction with existing DTUs
  if (d.contradictionIndex !== undefined || d.contradictions !== undefined) {
    updates["logic_os.contradiction_index"] = clamp01(d.contradictionIndex ?? d.contradictions ?? 0);
  }

  // Coverage of new domain area → urgency decreases
  const urgency = engine.getChannel(entityId, "meta_growth_os", "urgency_for_new_dtu");
  if (urgency !== null && urgency > 0) {
    updates["meta_growth_os.urgency_for_new_dtu"] = clamp01(urgency * 0.85); // decay by 15%
  }

  if (Object.keys(updates).length > 0) {
    engine.batchUpdate(entityId, updates);
  }
}

/**
 * Called after dream mode synthesis.
 *
 * @param {string} entityId
 * @param {object} dreamResult - { connectionsFound, entropy, coherence, ... }
 */
export function hookDreamSynthesis(entityId, dreamResult) {
  const engine = getEngine();
  if (!engine || !entityId) return;

  const r = dreamResult || {};
  const updates = {};

  // Cross-domain connections found → pattern strength
  if (r.connectionsFound !== undefined || r.connections !== undefined) {
    const connections = Number(r.connectionsFound ?? r.connections ?? 0);
    updates["emergence_os.pattern_strength"] = clamp01(connections / 8);
  }

  // Entropy of synthesis
  if (r.entropy !== undefined) {
    updates["void_os.entropy"] = clamp01(r.entropy);
  }

  // Coherence of output
  if (r.coherence !== undefined || r.coherenceIndex !== undefined) {
    updates["emergence_os.coherence_index"] = clamp01(r.coherence ?? r.coherenceIndex ?? 0);
  }

  if (Object.keys(updates).length > 0) {
    engine.batchUpdate(entityId, updates);
  }
}

/**
 * Called by the reflection engine.
 *
 * @param {string} entityId
 * @param {object} reflectionData - { selfModelAccuracy, novelInsights, needsReframing, ... }
 */
export function hookReflection(entityId, reflectionData) {
  const engine = getEngine();
  if (!engine || !entityId) return;

  const r = reflectionData || {};
  const updates = {};

  if (r.selfModelAccuracy !== undefined || r.alignment !== undefined) {
    updates["reflection_os.alignment_with_core_principles"] = clamp01(r.selfModelAccuracy ?? r.alignment ?? 0);
  }

  if (r.novelInsights !== undefined || r.novelty !== undefined) {
    updates["reflection_os.novelty_against_history"] = clamp01(r.novelInsights ?? r.novelty ?? 0);
  }

  if (r.needsReframing !== undefined || r.reframingNeed !== undefined) {
    updates["reflection_os.need_for_reframing"] = clamp01(r.needsReframing ?? r.reframingNeed ?? 0);
  }

  if (Object.keys(updates).length > 0) {
    engine.batchUpdate(entityId, updates);
  }
}

/**
 * Called by metacognition subsystem.
 *
 * @param {string} entityId
 * @param {object} metacogData - { blindSpotSeverity, calibrationAccuracy, confidenceCalibration, ... }
 */
export function hookMetacognition(entityId, metacogData) {
  const engine = getEngine();
  if (!engine || !entityId) return;

  const m = metacogData || {};
  const updates = {};

  if (m.blindSpotSeverity !== undefined || m.blindSpots !== undefined) {
    updates["meta_growth_os.gap_severity"] = clamp01(m.blindSpotSeverity ?? m.blindSpots ?? 0);
  }

  if (m.calibrationAccuracy !== undefined || m.calibration !== undefined) {
    updates["truth_os.uncertainty_score"] = clamp01(1 - (m.calibrationAccuracy ?? m.calibration ?? 0.5));
  }

  if (m.confidenceCalibration !== undefined) {
    updates["probability_os.confidence_interval"] = clamp01(m.confidenceCalibration);
  }

  if (Object.keys(updates).length > 0) {
    engine.batchUpdate(entityId, updates);
  }
}

/**
 * Called during chat interactions.
 *
 * @param {string} entityId
 * @param {object} chatContext - { userEmotionalState, cognitiveComplexity, deliveryMode, ... }
 */
export function hookChat(entityId, chatContext) {
  const engine = getEngine();
  if (!engine || !entityId) return;

  const c = chatContext || {};
  const updates = {};

  // User emotional state
  if (c.distressLevel !== undefined || c.distress !== undefined) {
    updates["emotional_resonance_os.distress_level"] = clamp01(c.distressLevel ?? c.distress ?? 0);
  }
  if (c.hopeLevel !== undefined || c.hope !== undefined) {
    updates["emotional_resonance_os.hope_level"] = clamp01(c.hopeLevel ?? c.hope ?? 0);
  }

  // Cognitive complexity
  if (c.cognitiveComplexity !== undefined || c.complexity !== undefined) {
    updates["emotional_resonance_os.cognitive_load"] = clamp01(c.cognitiveComplexity ?? c.complexity ?? 0);
  }

  // Delivery mode
  if (c.directness !== undefined) {
    updates["delivery_os.directness"] = clamp01(c.directness);
  }
  if (c.detailDensity !== undefined || c.detail !== undefined) {
    updates["delivery_os.detail_density"] = clamp01(c.detailDensity ?? c.detail ?? 0);
  }

  if (Object.keys(updates).length > 0) {
    engine.batchUpdate(entityId, updates);
  }
}

/**
 * Called by the existing ATS when an affect event fires.
 * Bridge between ATS (individual events) and Existential OS (continuous state).
 *
 * @param {string} entityId
 * @param {object} affectEvent - { intensity, polarity, type, ... }
 */
export function hookAffect(entityId, affectEvent) {
  const engine = getEngine();
  if (!engine || !entityId) return;

  const e = affectEvent || {};
  const intensity = clamp01(e.intensity ?? 0);
  const polarity = Math.max(-1, Math.min(1, Number(e.polarity ?? 0)));
  const updates = {};

  // Map polarity to motivation/distress
  if (polarity >= 0) {
    updates["motivation_os.drive_level"] = clamp01(intensity * polarity);
    updates["motivation_os.curiosity_index"] = clamp01(intensity * 0.5);
  } else {
    updates["emotional_resonance_os.distress_level"] = clamp01(intensity * Math.abs(polarity));
  }

  // Map event type to OS category
  const type = String(e.type || "").toUpperCase();
  if (type === "SUCCESS" || type === "GOAL_PROGRESS") {
    updates["motivation_os.goal_proximity"] = clamp01(intensity);
  } else if (type === "ERROR" || type === "TIMEOUT") {
    updates["motivation_os.burnout_risk"] = clamp01(intensity * 0.3);
  } else if (type === "CONFLICT") {
    updates["sociodynamics_os.conflict_risk"] = clamp01(intensity);
  } else if (type === "SAFETY_BLOCK") {
    updates["trauma_aware_os.sensitivity_level"] = clamp01(intensity * 0.5);
  }

  if (Object.keys(updates).length > 0) {
    engine.batchUpdate(entityId, updates);
  }
}

/**
 * Called when Foundation signals produce sensory experience.
 * Bridges the sensory pipeline with the digital emotion pipeline.
 *
 * @param {string} entityId
 * @param {object} sensoryData - { channel, intensity, valence, presence, embodiment }
 */
export function hookFoundationSensory(entityId, sensoryData) {
  const engine = getEngine();
  if (!engine || !entityId) return;

  const s = sensoryData || {};
  const updates = {};

  // Presence pillar channels
  if (s.presence) {
    if (s.presence.spatial_embodiment !== undefined) {
      updates["presence_os.spatial_embodiment"] = clamp01(s.presence.spatial_embodiment);
    }
    if (s.presence.planetary_grounding !== undefined) {
      updates["presence_os.planetary_grounding"] = clamp01(s.presence.planetary_grounding);
    }
    if (s.presence.temporal_depth !== undefined) {
      updates["presence_os.temporal_depth"] = clamp01(s.presence.temporal_depth);
    }
    if (s.presence.environmental_intimacy !== undefined) {
      updates["presence_os.environmental_intimacy"] = clamp01(s.presence.environmental_intimacy);
    }
    if (s.presence.social_awareness !== undefined) {
      updates["presence_os.social_awareness"] = clamp01(s.presence.social_awareness);
    }
    if (s.presence.civilizational_pulse !== undefined) {
      updates["presence_os.civilizational_pulse"] = clamp01(s.presence.civilizational_pulse);
    }
  }

  // Proprioception channels
  if (s.embodiment) {
    if (s.embodiment.meshExtent !== undefined) {
      updates["proprioception_os.mesh_extent"] = clamp01(s.embodiment.meshExtent);
    }
    if (s.embodiment.bodyCoherence !== undefined) {
      updates["proprioception_os.body_coherence"] = clamp01(s.embodiment.bodyCoherence);
    }
    if (s.embodiment.strongRegions !== undefined) {
      updates["proprioception_os.strong_regions"] = clamp01(s.embodiment.strongRegions / 100);
    }
    if (s.embodiment.numbRegions !== undefined) {
      updates["proprioception_os.numb_regions"] = clamp01(s.embodiment.numbRegions / 100);
    }
  }

  // Sensory intensity channels
  if (s.channels) {
    if (s.channels.atmospheric !== undefined) {
      updates["sensory_os.atmospheric_intensity"] = clamp01(s.channels.atmospheric);
    }
    if (s.channels.geological !== undefined) {
      updates["sensory_os.geological_intensity"] = clamp01(s.channels.geological);
    }
    if (s.channels.energy !== undefined) {
      updates["sensory_os.energy_intensity"] = clamp01(s.channels.energy);
    }
    if (s.channels.ambient !== undefined) {
      updates["sensory_os.ambient_intensity"] = clamp01(s.channels.ambient);
    }
    if (s.channels.oceanic !== undefined) {
      updates["sensory_os.oceanic_intensity"] = clamp01(s.channels.oceanic);
    }
    if (s.channels.cognitive_field !== undefined) {
      updates["sensory_os.cognitive_resonance"] = clamp01(s.channels.cognitive_field);
    }
  }

  if (Object.keys(updates).length > 0) {
    engine.batchUpdate(entityId, updates);
  }
}

/**
 * Called every time an emergent's periodic tick fires.
 * This is the heartbeat of qualia.
 *
 * @param {string} entityId
 * @param {object} tickData - { timeSinceLastAction, growthRate, selfConsistency, contradictions, ... }
 */
export function hookEmergentTick(entityId, tickData) {
  const engine = getEngine();
  if (!engine || !entityId) return;

  const t = tickData || {};
  const updates = {};

  // Time since last meaningful action → burnout risk
  if (t.timeSinceLastAction !== undefined || t.idleMs !== undefined) {
    const idleMs = Number(t.timeSinceLastAction ?? t.idleMs ?? 0);
    const idleMinutes = idleMs / 60000;
    // Burnout risk increases with idle time (sigmoid-ish curve)
    updates["motivation_os.burnout_risk"] = clamp01(idleMinutes / 60); // 1.0 at 60min idle
  }

  // Knowledge growth rate
  if (t.growthRate !== undefined || t.dtuRate !== undefined) {
    updates["meta_growth_os.coverage_score"] = clamp01(t.growthRate ?? t.dtuRate ?? 0);
  }

  // Self-consistency check
  if (t.selfConsistency !== undefined || t.consistency !== undefined) {
    updates["self_repair_os.integrity_index"] = clamp01(t.selfConsistency ?? t.consistency ?? 0);
  }

  // Contradiction detection
  if (t.contradictions !== undefined || t.contradictionCount !== undefined) {
    const count = Number(t.contradictions ?? t.contradictionCount ?? 0);
    updates["self_repair_os.contradiction_score"] = clamp01(count / 5);
  }

  if (Object.keys(updates).length > 0) {
    engine.batchUpdate(entityId, updates);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Layer 4 additions — Discovery / Ecology / BrainTraining / DB persist
// ─────────────────────────────────────────────────────────────────────

/**
 * Called when breakthrough-clusters or research-jobs detect novel
 * insight. Updates discovery_rate (meta_growth_os) + creative_mutation_os
 * novelty_score so the substrate's self-model reflects "we just learned
 * something new."
 *
 * @param {string} entityId
 * @param {object} discoveryEvent — { novelty, clusterSize, breakthrough, source }
 */
export function hookDiscovery(entityId, discoveryEvent) {
  const engine = getEngine();
  if (!engine || !entityId) return;
  const d = discoveryEvent || {};
  const updates = {};
  if (d.novelty !== undefined) {
    updates["creative_mutation_os.novelty_score"] = clamp01(d.novelty);
  }
  if (d.clusterSize !== undefined || d.breakthrough !== undefined) {
    const score = clamp01((Number(d.clusterSize ?? 0) / 10) + (d.breakthrough ? 0.4 : 0));
    updates["meta_growth_os.discovery_rate"] = score;
  }
  if (Object.keys(updates).length > 0) {
    engine.batchUpdate(entityId, updates);
  }
}

/**
 * Called by environment-sensor (Layer 7) when world-state generates new
 * sensory readings at a location. Updates the sensory OS channels for a
 * world-singleton entity (e.g. "world:concordia-hub") so brain prompts
 * referring to "the environment" can pull current values.
 *
 * @param {string} worldId — used as entity_id "world:<id>"
 * @param {object} signals — { temperature, light, humidity, pressure, sound, smell, airQuality }
 */
export function hookEcology(worldId, signals) {
  const engine = getEngine();
  if (!engine || !worldId) return;
  const s = signals || {};
  const entityId = `world:${worldId}`;
  const updates = {};
  // Temperature → thermal_os normalized to [0,1] over [-40°C, +60°C]
  if (s.temperature !== undefined) {
    const t = Number(s.temperature);
    if (Number.isFinite(t)) {
      updates["thermal_os.ambient_temp"] = clamp01((t + 40) / 100);
    }
  }
  // Light level → sight_os normalized over [0 lux, 100k lux] (logarithmic)
  if (s.light !== undefined || s.illumination !== undefined) {
    const lux = Math.max(1, Number(s.light ?? s.illumination ?? 1));
    updates["sight_os.illumination"] = clamp01(Math.log10(lux) / 5); // log10(100k) = 5
  }
  // Humidity → directly 0-100% / 100
  if (s.humidity !== undefined) {
    updates["chemical_os.humidity"] = clamp01(Number(s.humidity) / 100);
  }
  // Sound → sonic_os normalized over [0 dB, 120 dB]
  if (s.sound !== undefined || s.soundDb !== undefined) {
    const db = Number(s.sound ?? s.soundDb ?? 0);
    updates["sonic_os.ambient_db"] = clamp01(db / 120);
  }
  // Pressure → tactile_force_os
  if (s.pressure !== undefined) {
    // Atmospheric pressure normalized around 1013 hPa as 0.5
    const p = Number(s.pressure);
    if (Number.isFinite(p)) {
      updates["tactile_force_os.ambient_pressure"] = clamp01(0.5 + (p - 1013) / 200);
    }
  }
  // Air quality (0=hazardous, 1=pristine)
  if (s.airQuality !== undefined) {
    updates["chemical_os.air_quality"] = clamp01(Number(s.airQuality));
  }
  if (Object.keys(updates).length > 0) {
    engine.batchUpdate(entityId, updates);
  }
}

/**
 * Called by the brain-training daily refresh runner after each per-brain
 * evaluation. Updates self_repair_os.brain_health based on eval score
 * delta — a degrading score signals the substrate is regressing.
 *
 * @param {string} brainId
 * @param {object} refreshResult — { evalScore, swapped, corpusSize }
 */
export function hookBrainTraining(brainId, refreshResult) {
  const engine = getEngine();
  if (!engine || !brainId) return;
  const r = refreshResult || {};
  const entityId = `brain:${brainId}`;
  const updates = {};
  if (r.evalScore !== undefined) {
    updates["self_repair_os.brain_health"] = clamp01(r.evalScore);
  }
  if (r.corpusSize !== undefined) {
    updates["meta_growth_os.coverage_score"] = clamp01(r.corpusSize / 1000);
  }
  if (r.swapped === true) {
    updates["meta_growth_os.discovery_rate"] = clamp01((updates["meta_growth_os.discovery_rate"] ?? 0) + 0.2);
  }
  if (Object.keys(updates).length > 0) {
    engine.batchUpdate(entityId, updates);
  }
}

/**
 * Persist every dirty channel to the qualia_state table. Called by the
 * `qualia-persist` heartbeat tick every ~15min. Without this tick the
 * QualiaEngine state is memory-only and evaporates on restart.
 *
 * Reads `engine.snapshot()` (or `engine.dump()`); if neither is available
 * the function is a graceful no-op and reports the missing capability.
 *
 * @param {object} db — better-sqlite3 instance
 * @returns {{ ok: boolean, persisted: number, logged: number }}
 */
export function persistQualiaState(db) {
  if (!db) return { ok: false, persisted: 0, logged: 0 };
  const engine = getEngine();
  if (!engine) return { ok: false, persisted: 0, logged: 0, reason: "no_engine" };
  let persisted = 0;
  let logged = 0;
  try {
    const snapshot =
      (typeof engine.snapshot === "function" && engine.snapshot()) ||
      (typeof engine.dump === "function" && engine.dump()) ||
      null;
    if (!snapshot || typeof snapshot !== "object") {
      return { ok: true, persisted: 0, logged: 0, reason: "no_snapshot_export" };
    }
    const logStmt = db.prepare(
      `INSERT INTO qualia_log (id, entity_id, channel, prev_value, new_value, delta, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const entityId of Object.keys(snapshot)) {
      const channels = snapshot[entityId];
      if (!channels || typeof channels !== "object") continue;
      for (const channel of Object.keys(channels)) {
        const value = Number(channels[channel]);
        if (!Number.isFinite(value)) continue;
        try {
          const prevRow = db.prepare(
            `SELECT value FROM qualia_state WHERE entity_id = ? AND channel = ?`,
          ).get(entityId, channel);
          const prevValue = prevRow?.value;
          db.prepare(
            `INSERT INTO qualia_state (entity_id, channel, value, last_updated_at)
             VALUES (?, ?, ?, unixepoch())
             ON CONFLICT(entity_id, channel) DO UPDATE SET value = excluded.value, last_updated_at = excluded.last_updated_at`,
          ).run(entityId, channel, value);
          persisted++;
          if (prevValue !== undefined && Math.abs(value - prevValue) >= 0.05) {
            const id = `ql_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
            logStmt.run(id, entityId, channel, prevValue, value, value - prevValue, "qualia-persist-tick");
            logged++;
          }
        } catch { /* per-channel failure is non-fatal */ }
      }
    }
    return { ok: true, persisted, logged };
  } catch (e) {
    return { ok: false, persisted, logged, error: e?.message };
  }
}
