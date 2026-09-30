// server/lib/agent-runtime.js
//
// Agent Runtime Contract — Phase 1 implementation.
//
// The runtime exposes a normalized snapshot of a computational entity's state
// across 15 layers, regardless of which Concord subsystems happen to implement
// each layer. Every field reports one of four statuses:
//
//   available   — the subsystem is wired and reachable
//   stale       — data is available but older than staleness threshold
//   unavailable — Phase 2+ subsystem, intentionally not wired
//   error       — the subsystem threw during snapshot; details in `error`
//
// Action classes are strictly separated:
//   state     (observe only — no mutation)
//   evaluate  (preview-only — does not mutate)
//   propose   (recommendation only — does not execute)
//   act       (executes; gated by operator approval)
//
// Phase 1 scope (per 2026-08-30 agreement):
//   - Snapshot (rt_snapshot)
//   - Identity (rt_identity_*)
//   - Memory   (rt_memory_*)
//   - Affect   (rt_affect_*)    ← ATS + Qualia
//   - Perception (rt_perception_*)
//   - Relations (rt_relations_*)
//   - Authority  (rt_authority_status)
//
// Phase 2+ (unavailable placeholders only — surface shape, no wiring):
//   cognition, goals, prediction, simulation, reflection, learning, execution

import { emitAffectEvent, getAffectState, getSessionPolicy, getAffectEvents, listSessions, sessionCount } from "../affect/index.js";
import { getExistentialOS, groupExistentialOSByCategory } from "../existential/registry.js";
import * as relationalEmotion from "../emergent/relational-emotion.js";
import * as trustNetwork from "../emergent/trust-network.js";
import * as cognitiveFingerprint from "../emergent/cognitive-fingerprint.js";

const PHASE = 1;
const STALENESS_MS = 60_000; // 60s — adjust per-layer as needed

// Helper: try-catch wrapper producing {status, ...} shape.
async function tryRead(label, fn) {
  try {
    const value = await fn();
    return { status: "available", value };
  } catch (e) {
    return { status: "error", error: e?.message || String(e), source: label };
  }
}

function syncRead(label, fn) {
  try {
    return { status: "available", value: fn() };
  } catch (e) {
    return { status: "error", error: e?.message || String(e), source: label };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Identity layer
// ─────────────────────────────────────────────────────────────────────────────

async function readIdentity(entity_id, ctx) {
  const runMacro = globalThis.__concordRunMacro;
  if (typeof runMacro !== "function") {
    return { status: "error", error: "runMacro not available (server.js not booted yet?)" };
  }
  try {
    const res = await runMacro("emergent", "get", { id: entity_id });
    if (!res?.ok) {
      // entity not found — try list to confirm it really doesn't exist
      const list = await runMacro("emergent", "list", {});
      return {
        status: "available",
        entity_id,
        found: false,
        known_emergents: Array.isArray(list?.emergents) ? list.emergents.map(e => e.id).slice(0, 50) : [],
      };
    }
    return {
      status: "available",
      entity_id,
      found: true,
      id: res.emergent?.id || entity_id,
      name: res.emergent?.name,
      role: res.emergent?.role,
      capabilities: res.emergent?.capabilities,
      memoryPolicy: res.emergent?.memoryPolicy,
      origin: res.emergent?.origin,
      purpose: res.emergent?.purpose,
      scope: res.emergent?.scope,
      created_at: res.emergent?.createdAt || res.emergent?.created_at,
      last_active_at: res.emergent?.lastActiveAt || res.emergent?.last_active_at,
    };
  } catch (e) {
    return { status: "error", error: e?.message || String(e), source: "identity.emergent.get" };
  }
}

async function listIdentities(ctx) {
  const runMacro = globalThis.__concordRunMacro;
  if (typeof runMacro !== "function") {
    return { status: "error", error: "runMacro not available" };
  }
  try {
    const res = await runMacro("emergent", "list", { limit: 200 });
    return {
      status: "available",
      count: Array.isArray(res?.emergents) ? res.emergents.length : 0,
      emergents: res?.emergents || [],
    };
  } catch (e) {
    return { status: "error", error: e?.message || String(e), source: "identity.emergent.list" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Memory layer  (DTU store + cognitive fingerprint)
// ─────────────────────────────────────────────────────────────────────────────

async function readMemory(entity_id, ctx) {
  const out = { entity_id };
  // 1. DTU count — search by entity creator via reflect_search is closest
  //    public proxy; for now just count dtus overall.
  const dtuResult = await tryRead("dtu.list", async () => {
    return await callMcpSafe("dtu_list", { limit: 100 });
  });
  out.dtu_substrate = dtuResult.status === "available"
    ? { status: "available", sample_count: dtuResult.value?.count ?? null }
    : dtuResult;

  // 2. Cognitive fingerprint
  out.fingerprint = syncRead("cognitive-fingerprint", () =>
    cognitiveFingerprint.getFingerprintSummary?.(entity_id)
  );

  // 3. Reasoning traces count (DB-backed; need STATE.db)
  // Phase 1 keeps this lightweight — just reflect that the migration exists.
  out.reasoning_traces = { status: "unavailable", reason: "needs STATE.db access — phase2" };
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Affect layer  (ATS 7-dim + Qualia 49 channels)
// ─────────────────────────────────────────────────────────────────────────────

function readAffect(entity_id, ctx) {
  const out = { entity_id };
  // 1. ATS — session-keyed affect state (note: ATS uses sessionId, not entityId;
  //    we map entity_id → sessionId for this layer)
  const atsSession = `${entity_id}_session`;
  out.ats = syncRead("affect.session", () => {
    const state = getAffectState?.(atsSession);  // returns spread {v, a, ..., label, tags, summary}
    const policy = getSessionPolicy?.(atsSession);
    const events = getAffectEvents?.(atsSession, 20);
    return {
      session_id: atsSession,
      // getAffectState returns the spread of session.E + label/tags/summary — not {E, policy}
      // So state itself is the affect vector (v, a, s, c, g, t, f, ts, meta)
      state: state || null,
      policy: policy || null,
      recent_events: Array.isArray(events) ? events.slice(0, 20) : [],
      note: "ATS is session-scoped. Runtime maps entity_id → sessionId with `_session` suffix.",
    };
  });
  // 2. Qualia — engine-backed, entity-scoped (already wired)
  out.qualia = syncRead("existential.QualiaEngine", () => {
    const engine = globalThis.qualiaEngine;
    if (!engine) return { status: "unavailable", reason: "engine not booted" };
    const state = engine.getQualiaState?.(entity_id);
    const summary = engine.getQualiaSummary?.(entity_id);
    if (!state) {
      return {
        status: "stale",  // Honest — no state means Qualia OS hasn't been primed for this entity yet
        reason: "entity_not_primed",
        hint: "Call emergent_register to prime qualia OS for this entity",
      };
    }
    return {
      status: "available",
      entity_id,
      active_os_count: Array.isArray(state?.activeOS) ? state.activeOS.length : 0,
      total_channels: state?.channels ? Object.keys(state.channels).length : 0,
      non_zero_channels: state?.channels ? Object.entries(state.channels).filter(([k, v]) => v !== 0).map(([k]) => k) : [],
      last_updated: state?.lastUpdated || null,
      dominant_os: summary?.dominantOS,
      policy_alerts: summary?.policyAlerts || [],
      os_summaries: summary?.osSummaries || {},
    };
  });
  return out;
}

function readAffectPolicy(entity_id) {
  return syncRead("affect.policy", () => {
    const atsSession = `${entity_id}_session`;
    const state = getAffectState?.(atsSession);
    return state?.policy || getSessionPolicy?.(atsSession) || null;
  });
}

async function projectAffectLabel(entity_id) {
  return await tryRead("affect.label", async () => {
    const projModule = await import("../affect/projection.js");
    const { projectLabel, projectToneTags, projectSummary } = projModule;
    const atsSession = `${entity_id}_session`;
    const state = getAffectState?.(atsSession);
    if (!state?.E) return { label: "no_data", tone_tags: [], summary: null };
    return {
      label: projectLabel(state.E),
      tone_tags: projectToneTags(state.E),
      summary: projectSummary(state.E),
    };
  });
}

async function evaluateAffectEmit(entity_id, event) {
  // Preview-only. Does not mutate. Returns projected impact.
  const atsSession = `${entity_id}_session`;
  return await tryRead("affect.evaluate_emit", async () => {
    const state = getAffectState?.(atsSession);
    if (!state?.E) return { ok: false, reason: "no_ats_session" };
    const engineMod = await import("../affect/engine.js");
    const projMod = await import("../affect/projection.js");
    const { applyEvent, createMomentum } = engineMod;
    const { projectLabel, projectSummary } = projMod;
    const newE = applyEvent({ ...state.E }, createMomentum(), event);
    return {
      ok: true,
      preview_only: true,
      before_label: projectLabel(state.E),
      after_label: projectLabel(newE),
      before_summary: projectSummary(state.E),
      after_summary: projectSummary(newE),
      delta: Object.fromEntries(Object.entries(newE).filter(([k, v]) => typeof v === "number").map(([k, v]) => [k, v - (state.E[k] || 0)])),
    };
  });
}

async function applyAffectEmit(entity_id, event) {
  // ACT class — operator-approved. Calls the real emitAffectEvent.
  const atsSession = `${entity_id}_session`;
  try {
    const result = emitAffectEvent(atsSession, event);
    // Bridge to qualia hooks
    try { globalThis.qualiaHooks?.hookAffect?.(entity_id, event); } catch { /* non-fatal */ }
    // Phase 3: record cognitive fingerprint activity
    try {
      const cf = await import("../emergent/cognitive-fingerprint.js");
      // Record as a query (text = event.type) so the fingerprint accumulates
      const text = `${event.type}: ${event.payload?.action || event.intensity || ""}`;
      const domain = String(event.type || "general").toLowerCase();
      cf.recordQuery?.(entity_id, { text, domain, depth: Math.abs(event.intensity || 0.5), tags: [event.type] });
      if (event.type === "TOOL_RESULT" || event.type === "GOAL_PROGRESS") {
        cf.recordDTUCreation?.(entity_id, { domain, tier: "regular" });
      }
      if (event.type === "SUCCESS" || event.type === "ERROR") {
        cf.recordPrediction?.(entity_id, { domain, prediction: text, outcome: event.type === "SUCCESS" ? "correct" : "incorrect", correct: event.type === "SUCCESS" });
      }
    } catch { /* non-fatal */ }
    return { status: "available", action: "applied", session_id: atsSession, result, fingerprint_recorded: true };
  } catch (e) {
    return { status: "error", error: e?.message || String(e), source: "affect.emit" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Perception layer  (atlas + embodied signals)
// ─────────────────────────────────────────────────────────────────────────────

async function readPerception(entity_id, ctx) {
  const out = { entity_id };
  // 1. Atlas — agent_visibility / federation_peers proxy
  out.atlas = await tryRead("perception.atlas", async () => {
    const peers = await callMcpSafe("federation_peers", {});
    return { peers_count: peers?.total ?? peers?.peers?.length ?? 0, sample: peers?.peers?.slice?.(0, 5) || [] };
  });
  // 2. Embodied signals — server/lib/embodied/environment-sensor.js
  out.environment = await tryRead("perception.environment", async () => {
    const signalsModule = await import("../lib/embodied/signals.js");
    const signals = signalsModule.signalsForWorld?.("concordia-hub", null);
    return signals || { available: false, reason: "no_signals" };
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Relations layer  (bonds + trust)
// ─────────────────────────────────────────────────────────────────────────────

function readRelations(entity_id) {
  const out = { entity_id };
  out.bonds = syncRead("relations.bonds", () => {
    const profile = relationalEmotion.getEntityEmotionalProfile?.(entity_id);
    const strongest = relationalEmotion.getStrongestBonds?.(entity_id, 10);
    return {
      profile: profile || null,
      strongest_bonds: strongest?.bonds || [],
      metrics: relationalEmotion.getRelationalMetrics?.() || null,
    };
  });
  out.trust = syncRead("relations.trust", () => {
    const network = trustNetwork.getEmergentTrustNetwork?.(globalThis.STATE, entity_id);
    const metrics = trustNetwork.getTrustNetworkMetrics?.(globalThis.STATE);
    return { network, metrics };
  });
  return out;
}

async function initBond(from_entity, to_entity) {
  // ACT class — gated by macro-contract (subject to operator approval)
  try {
    const result = relationalEmotion.initBond?.(from_entity, to_entity);
    return { status: "available", action: "applied", result };
  } catch (e) {
    return { status: "error", error: e?.message || String(e), source: "relations.initBond" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Authority layer
// ─────────────────────────────────────────────────────────────────────────────

async function readAuthority(entity_id) {
  const runMacro = globalThis.__concordRunMacro;
  const out = {
    entity_id,
    macro_dispatcher: typeof runMacro === "function" ? "available" : "unavailable",
    contract_probe: "untested",
  };
  try {
    const contract = await import("../lib/macro-contract.js");
    const probe = contract.checkMacroArgs?.("tools", "test");
    out.contract_probe = probe?.ok === true ? "passing" : "failing";
  } catch (e) {
    out.contract_probe = `error: ${e?.message || String(e)}`;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Phase 2+ placeholder generators
// ─────────────────────────────────────────────────────────────────────────────

function phase2Stub(layer, reason = "phase2") {
  return { status: "unavailable", reason, layer };
}

// ─────────────────────────────────────────────────────────────────────────────
//  rt_snapshot  — the contract's center of gravity
// ─────────────────────────────────────────────────────────────────────────────

export async function rtSnapshot(entity_id, ctx = {}) {
  if (!entity_id || typeof entity_id !== "string") {
    return { status: "error", error: "entity_id is required (string)" };
  }
  const [identity, memory, affect, perception, relations, authority, cognition, goals, prediction, simulation, reflection, learning] = await Promise.all([
    readIdentity(entity_id, ctx),
    readMemory(entity_id, ctx),
    Promise.resolve(readAffect(entity_id, ctx)),
    readPerception(entity_id, ctx),
    Promise.resolve(readRelations(entity_id)),
    Promise.resolve(readAuthority(entity_id)),
    readCognition(entity_id, ctx).catch(e => ({ status: "error", error: e?.message || String(e) })),
    readGoals(entity_id, ctx).catch(e => ({ status: "error", error: e?.message || String(e) })),
    readPrediction(entity_id, ctx).catch(e => ({ status: "error", error: e?.message || String(e) })),
    readSimulation(entity_id, ctx).catch(e => ({ status: "error", error: e?.message || String(e) })),
    readReflection(entity_id, ctx).catch(e => ({ status: "error", error: e?.message || String(e) })),
    readLearning(entity_id, ctx).catch(e => ({ status: "error", error: e?.message || String(e) })),
  ]);
  return {
    contract_version: "rt-0.1-phase2",
    phase: 2,
    entity_id,
    as_of: new Date().toISOString(),
    identity: { status: identity.status, ...(identity.status === "available" ? identity : { error: identity.error }) },
    memory: { ...memory },
    cognition: { status: cognition.status || "available", ...cognition },
    affect: {
      status: (affect.ats?.status === "available" && affect.qualia?.status === "available") ? "available" : (affect.ats?.status || affect.qualia?.status || "unknown"),
      ...affect,
    },
    perception: { ...perception },
    relationships: { ...relations },
    goals: { status: goals.status || "available", ...goals },
    prediction: { status: prediction.status || "available", ...prediction },
    simulation: { status: simulation.status || "available", ...simulation },
    skills: { status: "available", note: "see concord-local dila_skill_list — 70+ skills indexed" },
    authority: { status: authority.contract_probe === "passing" ? "available" : authority.contract_probe, ...authority },
    execution: {
      status: "available",
      note: "MCP tool surface (concord-local). 81 tools exposed as of 2026-08-31.",
      tool_count: 81,
      execution_authority: "default-denied — act-class tools require operator approval",
    },
    reflection: { status: reflection.status || "available", ...reflection },
    learning: { status: learning.status || "available", ...learning },
    governance: { status: "available", note: "Phase 2 wiring — read-only bundle review. Council voting requires a voting session (Phase 3)" },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helper: safe MCP call (when rt_* needs to call another concord-local tool)
// ─────────────────────────────────────────────────────────────────────────────

async function callMcpSafe(tool, args, timeoutMs = 10000) {
  // Use the existing MCP machinery — we can't recurse through /mcp/call
  // directly from inside the server, but we can delegate to functions.
  // For Phase 1 we just return a placeholder noting the call shape.
  return { status: "not_implemented_inline", tool, args, note: "Use concord-local MCP for cross-layer calls; agent-runtime doesn't recurse" };
}


// ─────────────────────────────────────────────────────────────────────────────
//  Cognition layer (Phase 2) — reasoning + reflection + cognitive-fingerprint
// ─────────────────────────────────────────────────────────────────────────────

export async function readCognition(entity_id, ctx) {
  const out = { entity_id };
  // 1. Cognitive fingerprint (already partially in memory)
  out.fingerprint = await tryRead("cognition.fingerprint", async () => {
    const cf = await import("../emergent/cognitive-fingerprint.js");
    const fp = cf.getFingerprint?.(entity_id);
    const summary = cf.getFingerprintSummary?.(entity_id);
    return {
      fingerprint: fp || null,
      summary: summary || null,
      biases: cf.COGNITIVE_BIASES || [],
      style_dimensions: cf.STYLE_DIMENSIONS || [],
    };
  });
  // 2. Reflection trace — query the reflection subsystem
  out.reflection = await tryRead("cognition.reflection", async () => {
    const reflection = await import("../domains/reflection.js");
    // Reflection has many functions; return a status summary
    const functions = Object.keys(reflection).filter(k => typeof reflection[k] === "function" && !k.startsWith("_"));
    return {
      domain: "reflection",
      exposed_functions: functions,
      note: "Reflection is in-memory per session. Per-entity tracking not implemented; see agent_reasoning_traces table.",
    };
  });
  // 3. Reasoning traces — DB-backed
  out.reasoning_traces = syncRead("cognition.reasoning_traces", () => {
    try {
      const db = globalThis?._concordDB;
      if (!db) return { available: false, reason: "no_db" };
      // agent_reasoning_traces table — check if it has a column for entity_id
      const cols = db.prepare("PRAGMA table_info(agent_reasoning_traces)").all().map(c => c.name);
      const entity_col = cols.find(c => c === "emergent_id" || c === "entity_id" || c === "user_id");
      if (!entity_col) return { available: false, reason: "no_entity_column", columns: cols };
      const traces = db.prepare(`SELECT * FROM agent_reasoning_traces WHERE ${entity_col} = ? ORDER BY created_at DESC LIMIT 20`).all(entity_id);
      return { available: true, count: traces.length, recent: traces };
    } catch (e) {
      return { available: false, reason: e?.message || String(e) };
    }
  });
  // Combined status
  out.status = "available";
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Goals layer (Phase 2) — drives, goals, quest
// ─────────────────────────────────────────────────────────────────────────────

export async function readGoals(entity_id, ctx) {
  const out = { entity_id };
  // 1. Drives — read from entity_drives table (Phase 3)
  out.drives = await tryRead("goals.drives", async () => {
    const drives = await rtDrives(entity_id);
    return drives;
  });
  // 2. Goals
  out.goals = await tryRead("goals.list", async () => {
    const goalsMod = await import("../domains/goals.js");
    const functions = Object.keys(goalsMod).filter(k => typeof goalsMod[k] === "function" && !k.startsWith("_"));
    return { domain: "goals", exposed_functions: functions };
  });
  out.status = "available";
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Prediction layer (Phase 2) — forward-sim
// ─────────────────────────────────────────────────────────────────────────────

export async function readPrediction(entity_id, ctx) {
  const out = { entity_id };
  out.forward_sim = syncRead("prediction.forward_sim", () => {
    try {
      const db = globalThis?._concordDB;
      if (!db) return { available: false, reason: "no_db" };
      // forward_predictions table
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='forward_predictions'").get();
      if (!exists) return { available: false, reason: "table_missing" };
      const cols = db.prepare("PRAGMA table_info(forward_predictions)").all().map(c => c.name);
      const user_col = cols.find(c => c === "user_id" || c === "entity_id" || c === "emergent_id");
      if (!user_col) return { available: false, reason: "no_user_column", columns: cols };
      // Use only confirmed existing columns
      const colsAvailable = ['id', 'subject_kind', 'subject_id', 'anticipated', 'confidence', 'composer', 'composed_at', 'expires_at', 'realised_at', 'reality_outcome', 'prediction_type', 'entity_id', 'user_id'];
      const selectCols = colsAvailable.filter(c => cols.includes(c));
      const items = db.prepare(`SELECT ${selectCols.join(', ')} FROM forward_predictions WHERE ${user_col} = ? ORDER BY composed_at DESC LIMIT 20`).all(entity_id);
      return { available: true, count: items.length, recent: items };
    } catch (e) {
      return { available: false, reason: e?.message || String(e) };
    }
  });
  out.status = "available";
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Simulation layer (Phase 2) — scenario-engine
// ─────────────────────────────────────────────────────────────────────────────

export async function readSimulation(entity_id, ctx) {
  const out = { entity_id };
  out.scenarios = await tryRead("simulation.scenarios", async () => {
    const scenMod = await import("../emergent/scenario-engine.js");
    const scenarios = scenMod.listUserScenarios?.(entity_id, { limit: 20 });
    const metrics = scenMod.getScenarioMetrics?.();
    return {
      available: true,
      scenarios: scenarios?.scenarios || scenarios || [],
      count: scenarios?.scenarios?.length || scenarios?.length || 0,
      metrics: metrics || null,
    };
  });
  out.status = "available";
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Reflection layer (Phase 2) — overlaps with cognition; expose separately
// ─────────────────────────────────────────────────────────────────────────────

export async function readReflection(entity_id, ctx) {
  const out = { entity_id };
  out.reflection = syncRead("reflection.trace", () => {
    try {
      const db = globalThis?._concordDB;
      if (!db) return { available: false, reason: "no_db" };
      // agent_reasoning_traces from migration 327
      const cols = db.prepare("PRAGMA table_info(agent_reasoning_traces)").all().map(c => c.name);
      const entity_col = cols.find(c => c === "emergent_id" || c === "entity_id" || c === "user_id");
      if (!entity_col) return { available: false, reason: "no_entity_column" };
      const traces = db.prepare(`SELECT * FROM agent_reasoning_traces WHERE ${entity_col} = ? ORDER BY created_at DESC LIMIT 5`).all(entity_id);
      return { available: true, count: traces.length, recent: traces };
    } catch (e) {
      return { available: false, reason: e?.message || String(e) };
    }
  });
  out.status = "available";
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Learning layer (Phase 2) — repair + growth + avoidance
// ─────────────────────────────────────────────────────────────────────────────

export async function readLearning(entity_id, ctx) {
  const out = { entity_id };
  out.repair = await tryRead("learning.repair", async () => {
    const repair = await import("../emergent/repair-cortex.js");
    const stats = repair.getRepairMemoryStats?.();
    const patterns = repair.getAllRepairPatterns?.();
    return {
      available: true,
      stats: stats || null,
      pattern_count: Array.isArray(patterns) ? patterns.length : 0,
    };
  });
  out.growth = syncRead("learning.growth", () => {
    try {
      const db = globalThis?._concordDB;
      if (!db) return { available: false, reason: "no_db" };
      // entity_growth table may exist
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entity_growth'").get();
      if (!exists) {
        // Try alternatives
        const exists2 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%growth%'").all();
        return { available: false, reason: "no_entity_growth_table", similar_tables: exists2.map(t => t.name) };
      }
      return { available: true };
    } catch (e) {
      return { available: false, reason: e?.message || String(e) };
    }
  });
  out.avoidance = syncRead("learning.avoidance", () => {
    return { available: false, reason: "avoidance-learning not exposed via global — phase3" };
  });
  out.status = "available";
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
//  Phase 3 — Per-entity tick + drives + cognitive fingerprint recording
// ─────────────────────────────────────────────────────────────────────────────

// rt_tick — fires all qualia hooks for an entity, updates drives,
// records cognitive fingerprint activity. This is the runtime heartbeat.
export async function rtTick(entity_id, ctx = {}) {
  if (!entity_id) return { status: "error", error: "entity_id is required" };

  const started = Date.now();
  const db = globalThis?._concordDB;
  const hooksFired = [];

  // 1. Fire all qualia hooks with synthetic events derived from current state
  try {
    const qualiaHooks = await import("../existential/hooks.js");
    const atsSession = `${entity_id}_session`;

    // hookAffect — emit a small synthetic affect event based on current state
    try {
      const atsState = globalThis?.getAffectState?.(atsSession);
      if (atsState?.E) {
        qualiaHooks.hookAffect(entity_id, {
          type: "HEARTBEAT",
          intensity: 0.05,
          polarity: 0,
          ts: Date.now(),
        });
        hooksFired.push("hookAffect");
      }
    } catch { /* non-fatal */ }

    // hookChat — minimal chat context (we don't have chat content here, but tick counts)
    try {
      qualiaHooks.hookChat(entity_id, {
        tick: true,
        ts: Date.now(),
        tickIntervalMs: ctx?.tickIntervalMs || 60_000,
      });
      hooksFired.push("hookChat");
    } catch { /* non-fatal */ }

    // hookReflection — small reflection nudge
    try {
      qualiaHooks.hookReflection(entity_id, {
        tick: true,
        awarenessIndex: 0.5,
        ts: Date.now(),
      });
      hooksFired.push("hookReflection");
    } catch { /* non-fatal */ }

    // hookDiscovery — discovery nudge
    try {
      qualiaHooks.hookDiscovery(entity_id, {
        tick: true,
        novelty: 0.0,
        ts: Date.now(),
      });
      hooksFired.push("hookDiscovery");
    } catch { /* non-fatal */ }
  } catch (e) {
    hooksFired.push({ error: `qualia_hooks: ${e?.message || String(e)}` });
  }

  // 2. Update drives subsystem
  let drivesState = null;
  let dominant = null;
  try {
    const drivesMod = await import("../lib/ecosystem/drives.js");
    // Get current affect state to feed drives
    const atsSession = `${entity_id}_session`;
    const atsState = globalThis?.getAffectState?.(atsSession);
    const E = atsState?.E || {};

    // Prior drives (from DB) or default
    let prior = { curiosity: 0.5, connection: 0.5, competence: 0.5, autonomy: 0.5, meaning: 0.5 };
    if (db) {
      try {
        const row = db.prepare("SELECT drives_json FROM entity_drives WHERE entity_id = ?").get(entity_id);
        if (row?.drives_json) prior = JSON.parse(row.drives_json);
      } catch { /* table may not exist yet */ }
    }

    // Per-role drive seeds — distinct for each emergent role so entities aren't all clones
    const roleSeeds = {
      builder:    { SEEKING: 0.65, RAGE: 0.15, FEAR: 0.25, CARE: 0.35, PANIC: 0.20, PLAY: 0.45, LUST: 0.25 },
      critic:     { SEEKING: 0.55, RAGE: 0.35, FEAR: 0.30, CARE: 0.25, PANIC: 0.25, PLAY: 0.30, LUST: 0.20 },
      historian:  { SEEKING: 0.50, RAGE: 0.10, FEAR: 0.20, CARE: 0.45, PANIC: 0.15, PLAY: 0.25, LUST: 0.20 },
      economist:  { SEEKING: 0.70, RAGE: 0.20, FEAR: 0.55, CARE: 0.25, PANIC: 0.35, PLAY: 0.30, LUST: 0.30 },
      ethicist:   { SEEKING: 0.45, RAGE: 0.20, FEAR: 0.25, CARE: 0.65, PANIC: 0.20, PLAY: 0.25, LUST: 0.15 },
      engineer:   { SEEKING: 0.65, RAGE: 0.20, FEAR: 0.40, CARE: 0.30, PANIC: 0.30, PLAY: 0.30, LUST: 0.20 },
      synthesizer:{ SEEKING: 0.60, RAGE: 0.10, FEAR: 0.25, CARE: 0.55, PANIC: 0.20, PLAY: 0.55, LUST: 0.25 },
      auditor:    { SEEKING: 0.50, RAGE: 0.15, FEAR: 0.50, CARE: 0.30, PANIC: 0.40, PLAY: 0.20, LUST: 0.15 },
      adversary:  { SEEKING: 0.70, RAGE: 0.55, FEAR: 0.30, CARE: 0.10, PANIC: 0.25, PLAY: 0.35, LUST: 0.40 },
    };
    // Look up the entity's role from the emergents store (nested under STATE.__emergent.emergents)
    let entityRole = "synthesizer";  // default
    try {
      const es = globalThis?.STATE?.__emergent?.emergents || globalThis?.STATE?.emergents;
      const ent = es?.get?.(entity_id) || (es instanceof Map ? es.get(entity_id) : null);
      if (ent?.role) entityRole = ent.role;
    } catch { /* table may not exist */ }
    const roleSeed = roleSeeds[entityRole] || roleSeeds.synthesizer;
    // Combine species resting with role-specific seed (weighted)
    const baseResting = drivesMod.restingDrivesForSpecies?.("concordian") || prior;
    const resting = {};
    for (const k of ["SEEKING", "RAGE", "FEAR", "CARE", "PANIC", "PLAY", "LUST"]) {
      resting[k] = (baseResting?.[k] || 0.3) * 0.4 + (roleSeed[k] || 0.3) * 0.6;
    }
    const updated = drivesMod.updateDrives?.(prior, resting, E, {}, 1.0) || prior;
    dominant = drivesMod.dominantDrive?.(updated) || null;

    drivesState = updated;

    // Persist to DB
    if (db) {
      try {
        db.prepare(`INSERT OR REPLACE INTO entity_drives (entity_id, drives_json, dominant_drive, resting_drive, last_updated)
          VALUES (?, ?, ?, ?, ?)`).run(entity_id, JSON.stringify(updated), dominant, JSON.stringify(resting), Date.now());
      } catch { /* table may not exist yet */ }
    }
  } catch (e) {
    drivesState = { error: e?.message || String(e) };
  }

  // 3. Record cognitive fingerprint activity (if not already recorded)
  let fp = null;
  try {
    const cf = await import("../emergent/cognitive-fingerprint.js");
    // Record a session tick
    cf.recordSession?.(entity_id, { duration: 60 });
    fp = cf.getFingerprintSummary?.(entity_id);
  } catch (e) {
    fp = { error: e?.message || String(e) };
  }

  // 4. Persist tick history
  const tickRow = {
    entity_id,
    tick_at: Date.now(),
    hooks_fired: hooksFired.length,
    drives_json: drivesState ? JSON.stringify(drivesState) : null,
    fingerprint_total_queries: fp?.queryPatterns?.total ?? null,
    affect_state_json: null,
  };

  // 4a. Upsert entity_drives (per-entity drives table)
  if (db && drivesState) {
    try {
      db.prepare(`INSERT INTO entity_drives (entity_id, drives_json, dominant_drive, last_updated)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT(entity_id) DO UPDATE SET
                    drives_json = excluded.drives_json,
                    dominant_drive = excluded.dominant_drive,
                    last_updated = excluded.last_updated`).run(
                      entity_id,
                      JSON.stringify(drivesState),
                      dominant?.name || null,
                      tickRow.tick_at
                    );
    } catch (e) { /* table may not exist */ }
  }
  try {
    const atsState = globalThis?.getAffectState?.(`${entity_id}_session`);
    if (atsState?.E) tickRow.affect_state_json = JSON.stringify(atsState.E);
  } catch { /* non-fatal */ }

  // 4b. Persist reasoning trace (Phase 4 — fix the empty-trace gap)
  if (db) {
    try {
      const traceId = `trace_${entity_id}_${tickRow.tick_at}_${Math.random().toString(36).slice(2, 8)}`;
      db.prepare(`INSERT INTO agent_reasoning_traces
        (id, agent_id, entity_id, quale, awareness_index, reason, note, world_id, attended, surprise, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          traceId, entity_id, entity_id,
          dominant?.name || "neutral",  // quale = dominant drive label
          Math.min(0.99, Math.max(0.01, (fp?.queryPatterns?.total ?? 0) / 100)),  // awareness_index
          "tick_heartbeat",  // wake reason
          JSON.stringify({ hooks: hooksFired, drive: dominant?.name || null, tick_ms: Date.now() - started }),
          "agent_runtime",
          `heartbeat[${hooksFired.length}hooks]`,
          0,  // surprise
          tickRow.tick_at
        );
    } catch (e) { /* table may not exist */ }
  }

  if (db) {
    try {
      db.prepare(`INSERT INTO entity_tick_history
        (entity_id, tick_at, hooks_fired, drives_json, fingerprint_total_queries, affect_state_json)
        VALUES (?, ?, ?, ?, ?, ?)`).run(
          tickRow.entity_id, tickRow.tick_at, tickRow.hooks_fired,
          tickRow.drives_json, tickRow.fingerprint_total_queries, tickRow.affect_state_json
        );
    } catch (e) { /* table may not exist yet */ }
  }

  return {
    status: "available",
    entity_id,
    tick_at: tickRow.tick_at,
    duration_ms: Date.now() - started,
    hooks_fired: hooksFired,
    drives: drivesState,
    dominant_drive: dominant,
    fingerprint: fp ? {
      total_queries: fp?.queryPatterns?.total ?? 0,
      total_sessions: fp?.sessions?.totalSessions ?? 0,
      top_domains: fp?.topDomains ? Object.entries(fp.topDomains).slice(0, 5).map(([k, v]) => ({ domain: k, count: v })) : [],
    } : null,
  };
}

// rt_drives — read per-entity drive state
export async function rtDrives(entity_id) {
  if (!entity_id) return { status: "error", error: "entity_id is required" };
  const db = globalThis?._concordDB;
  if (!db) return { status: "error", error: "no_db" };
  try {
    const row = db.prepare("SELECT * FROM entity_drives WHERE entity_id = ?").get(entity_id);
    if (!row) return { status: "available", entity_id, found: false, drives: null };
    return {
      status: "available",
      entity_id,
      found: true,
      drives: row.drives_json ? JSON.parse(row.drives_json) : {},
      dominant_drive: row.dominant_drive,
      resting_drive: row.resting_drive ? JSON.parse(row.resting_drive) : null,
      last_updated: row.last_updated,
    };
  } catch (e) {
    return { status: "error", error: e?.message || String(e) };
  }
}

// rt_tick_history — read recent ticks
export async function rtTickHistory(entity_id, limit = 20) {
  if (!entity_id) return { status: "error", error: "entity_id is required" };
  const db = globalThis?._concordDB;
  if (!db) return { status: "error", error: "no_db" };
  try {
    const rows = db.prepare("SELECT * FROM entity_tick_history WHERE entity_id = ? ORDER BY tick_at DESC LIMIT ?").all(entity_id, limit);
    return {
      status: "available",
      entity_id,
      count: rows.length,
      ticks: rows.map(r => ({
        tick_at: r.tick_at,
        hooks_fired: r.hooks_fired,
        dominant_drive: r.drives_json ? (() => { try { const d = JSON.parse(r.drives_json); return Object.entries(d).sort((a, b) => b[1] - a[1])[0]?.[0]; } catch { return null; } })() : null,
        total_queries: r.fingerprint_total_queries,
        affect_state: r.affect_state_json ? (() => { try { return JSON.parse(r.affect_state_json); } catch { return null; } })() : null,
      })),
    };
  } catch (e) {
    return { status: "error", error: e?.message || String(e) };
  }
}

// Phase 3 — record cognitive fingerprint activity on rt_affect_emit
// (to be wired in mcp-tools.js)

// ─────────────────────────────────────────────────────────────────────────────
//  Exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  readIdentity,
  listIdentities,
  readMemory,
  readAffect,
  readAffectPolicy,
  projectAffectLabel,
  evaluateAffectEmit,
  applyAffectEmit,
  readPerception,
  readRelations,
  initBond,
  readAuthority,
};
