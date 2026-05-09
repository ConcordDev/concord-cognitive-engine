// server/lib/lattice-quest-composer.js
//
// Phase 4c — Lattice-Born Quests.
//
// The lattice drift-monitor (Layer 12) detects 6 kinds of cognitive
// failure in the substrate. Until now, those findings only routed into
// the HLR reasoning engine for resolution attempts. Phase 4c surfaces
// them to the player as procedural quests planted on a matched NPC:
//
//   GOODHART          → "An audit hunt"        — investigate a metric being gamed
//   MEMETIC_DRIFT     → "A haunted glade"      — find where ungrounded belief took root
//   CAPABILITY_CREEP  → "Trim the overgrowth"  — prune a feature that escaped its scope
//   SELF_REFERENCE    → "Break the mirror"     — find the circular reasoning chain
//   ECHO_CHAMBER      → "Speak in the wilds"   — gather adversarial input
//   METRIC_DIVERGENCE → "Walk the gap"         — bring two diverging signals back together
//
// Each quest gets a 3-step structure (investigate → confront → resolve),
// planted on an archetype-matched NPC (scholars get audits/mirror-breaks,
// mystics get haunted glades, hunters get wild-speakers). The NPC then
// surfaces the quest at dialogue.
//
// Generation is deterministic from the drift alert's signature so a
// re-scan of the same drift can't double-spawn. LLM enhancement is
// opt-in via CONCORD_LATTICE_QUEST_LLM=true.

import crypto from "node:crypto";
import logger from "../logger.js";

// ── Quest template table ────────────────────────────────────────────────────

const QUEST_TEMPLATES = {
  goodhart: {
    archetype_targets: ["scholar", "trader", "guard"],
    title_pool: [
      "An audit hunt",
      "The metric that lied",
      "A coin weighed twice",
    ],
    summary: "A signal that everyone trusts is being gamed. Find the gap between what's measured and what's true.",
    steps: [
      { type: "investigate", prompt_pool: [
        "Track which actor stands to gain from the inflated metric.",
        "Compare the metric against three independent witnesses.",
      ] },
      { type: "confront", prompt_pool: [
        "Present the discrepancy at the council.",
        "Confront the actor in front of their faction.",
      ] },
      { type: "resolve", prompt_pool: [
        "Author a corrected metric DTU and cite the falsified one.",
        "Negotiate a measurement reform with the relevant faction.",
      ] },
    ],
    location_kind: "plaza",
  },
  memetic_drift: {
    archetype_targets: ["mystic", "scholar"],
    title_pool: [
      "A haunted glade",
      "The belief without a body",
      "Where the chant outran the proof",
    ],
    summary: "A claim has been repeated until it feels true, but no one can name its source. Find where the belief took root.",
    steps: [
      { type: "investigate", prompt_pool: [
        "Walk the glade and listen for what the trees do not say.",
        "Trace the citations back through three speakers.",
      ] },
      { type: "confront", prompt_pool: [
        "Ask the originator to name their evidence.",
        "Stand alone in the grove and refuse the chant.",
      ] },
      { type: "resolve", prompt_pool: [
        "Plant a counter-rooted DTU citing primary observation.",
        "Compose a public refusal of the unfounded claim.",
      ] },
    ],
    location_kind: "grove",
  },
  capability_creep: {
    archetype_targets: ["guard", "trader"],
    title_pool: [
      "Trim the overgrowth",
      "What grew past its container",
      "The tool that learned to cut its own handle",
    ],
    summary: "A capability has expanded past its original scope. Find what it's eating and decide what stays pruned.",
    steps: [
      { type: "investigate", prompt_pool: [
        "Map the capability's reach against its intended bounds.",
        "Identify which adjacent surfaces have been quietly absorbed.",
      ] },
      { type: "confront", prompt_pool: [
        "Test the capability at its declared edge and document the overshoot.",
        "Bring evidence to the faction council.",
      ] },
      { type: "resolve", prompt_pool: [
        "Author a containment DTU specifying the new bound.",
        "Negotiate the prune with the capability's keeper.",
      ] },
    ],
    location_kind: "workplace",
  },
  self_reference: {
    archetype_targets: ["scholar", "mystic"],
    title_pool: [
      "Break the mirror",
      "The argument that proves itself",
      "A loop with no opening",
    ],
    summary: "A chain of reasoning cites itself somewhere down the line. Find the circular link and either ground it or sever it.",
    steps: [
      { type: "investigate", prompt_pool: [
        "Walk the citation chain step by step.",
        "Look for the point where a node cites a descendant.",
      ] },
      { type: "confront", prompt_pool: [
        "Name the loop in the presence of all involved.",
        "Force each link to produce independent evidence.",
      ] },
      { type: "resolve", prompt_pool: [
        "Insert a grounded primary-source DTU at the weak link.",
        "Tombstone the loop and rewrite the chain from a fresh root.",
      ] },
    ],
    location_kind: "temple",
  },
  echo_chamber: {
    archetype_targets: ["hunter", "trader"],
    title_pool: [
      "Speak in the wilds",
      "Bring back a contrary voice",
      "The dissent that wasn't heard",
    ],
    summary: "A chamber has gone unanimous without adversarial input. Find a credible dissenter and bring their voice back.",
    steps: [
      { type: "investigate", prompt_pool: [
        "Travel to a faction outside the chamber and listen.",
        "Identify a dissenter with standing in their own community.",
      ] },
      { type: "confront", prompt_pool: [
        "Carry the dissent into the chamber, on the record.",
        "Stand witness while the dissenter is heard.",
      ] },
      { type: "resolve", prompt_pool: [
        "Author a synthesis DTU honoring both views.",
        "Charter a recurring adversarial role in the chamber.",
      ] },
    ],
    location_kind: "wilds",
  },
  metric_divergence: {
    archetype_targets: ["healer", "scholar"],
    title_pool: [
      "Walk the gap",
      "Two signals from one body",
      "The measure and the measured drift apart",
    ],
    summary: "Two signals that should agree have begun to diverge. Walk the gap between them and find the missing variable.",
    steps: [
      { type: "investigate", prompt_pool: [
        "Plot the divergence over time.",
        "Identify the third variable that tracks the gap.",
      ] },
      { type: "confront", prompt_pool: [
        "Present the gap to the keepers of both signals.",
        "Test the candidate hidden variable in the open.",
      ] },
      { type: "resolve", prompt_pool: [
        "Author a unified-measure DTU citing both originals.",
        "Reconcile the signals by reweighting their inputs.",
      ] },
    ],
    location_kind: "workplace",
  },
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Stable signature of a drift alert. Used as the idempotency key so a
 * re-scan of the same drift doesn't spawn duplicate quests.
 *
 * Alert shape (from drift-monitor): { type, severity, message, evidence?,
 *                                     detected_at? }
 */
export function alertSignature(alert) {
  if (!alert) return null;
  // Include type + a normalized message snippet + the day_seed so the same
  // drift on different days CAN spawn a fresh quest (cognition decays).
  const norm = String(alert.message || "").trim().slice(0, 120).toLowerCase();
  const day = Math.floor((Number(alert.detected_at) || Date.now()) / 86400000);
  return crypto.createHash("sha1")
    .update(`${alert.type}|${alert.severity}|${norm}|${day}`)
    .digest("hex").slice(0, 24);
}

/**
 * Pick a deterministic element from an array given a seed buffer + index.
 */
function pickFromSeed(seedBuf, idx, arr) {
  if (!arr || arr.length === 0) return null;
  return arr[seedBuf[idx % seedBuf.length] % arr.length];
}

/**
 * Compose a quest spec from a drift alert. Pure function — caller passes
 * to createQuest + persists the lattice_born_quests row.
 *
 * Returns:
 *   { ok: true, title, summary, steps, location_kind, target_archetypes, signature }
 *   { ok: false, reason }
 */
export function composeQuestFromAlert(alert) {
  if (!alert?.type) return { ok: false, reason: "no_alert_type" };
  const tpl = QUEST_TEMPLATES[alert.type];
  if (!tpl) return { ok: false, reason: "unknown_drift_type" };

  const sig = alertSignature(alert);
  const seed = crypto.createHash("sha1").update(sig).digest();

  const title = pickFromSeed(seed, 0, tpl.title_pool);
  const steps = tpl.steps.map((s, i) => ({
    type: s.type,
    prompt: pickFromSeed(seed, i + 1, s.prompt_pool),
  }));

  return {
    ok: true,
    title,
    summary: tpl.summary,
    steps,
    location_kind: tpl.location_kind,
    target_archetypes: tpl.archetype_targets,
    signature: sig,
  };
}

/**
 * Pick an NPC in the world whose archetype matches one of the quest's
 * targets. Deterministic by signature.
 */
export function pickHostNpc(db, worldId, signature, archetypes) {
  if (!db || !worldId) return null;
  try {
    const placeholders = archetypes.map(() => "?").join(",");
    const candidates = db.prepare(`
      SELECT id, archetype, faction FROM world_npcs
      WHERE world_id = ?
        AND COALESCE(is_dead, 0) = 0
        AND archetype IN (${placeholders})
      ORDER BY id
      LIMIT 50
    `).all(worldId, ...archetypes);
    if (candidates.length === 0) return null;
    const seed = crypto.createHash("sha1").update(signature || "").digest();
    return candidates[seed[0] % candidates.length];
  } catch { return null; }
}

/**
 * Single-tx persistence: insert lattice_born_quests row keyed by
 * signature. Returns { ok, action: 'inserted' | 'already_exists', id?, questId? }.
 */
export function persistLatticeBornQuest(db, opts) {
  if (!db || !opts?.signature || !opts?.questId || !opts?.worldId) {
    return { ok: false, reason: "missing_inputs" };
  }
  const id = `lbq_${crypto.randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO lattice_born_quests
        (id, drift_alert_signature, drift_type, drift_severity,
         quest_id, world_id, target_npc_id, composer, composed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(
      id,
      opts.signature,
      opts.driftType,
      opts.driftSeverity || "warning",
      opts.questId,
      opts.worldId,
      opts.targetNpcId || null,
      opts.composer || "deterministic",
    );
    return { ok: true, action: "inserted", id, questId: opts.questId };
  } catch (err) {
    if (String(err?.message || "").includes("UNIQUE")) {
      const existing = db.prepare(`
        SELECT id, quest_id FROM lattice_born_quests WHERE drift_alert_signature = ?
      `).get(opts.signature);
      return { ok: true, action: "already_exists", id: existing?.id, questId: existing?.quest_id };
    }
    try { logger.warn?.("lattice-quest-composer", "persist_failed", { error: err?.message }); }
    catch { /* ignore */ }
    return { ok: false, reason: "tx_failed" };
  }
}

/**
 * End-to-end: compose + pick host + persist + create the quest in
 * quest-engine. Returns { ok, action, questId?, hostNpcId? }.
 */
export async function spawnQuestFromAlert(db, alert, worldId) {
  if (!db || !alert || !worldId) return { ok: false, reason: "missing_inputs" };

  const composed = composeQuestFromAlert(alert);
  if (!composed.ok) return composed;

  // Idempotency early-out: if signature already maps to a quest, return it.
  try {
    const existing = db.prepare(`
      SELECT quest_id, target_npc_id FROM lattice_born_quests
      WHERE drift_alert_signature = ?
    `).get(composed.signature);
    if (existing) {
      return {
        ok: true,
        action: "already_exists",
        questId: existing.quest_id,
        hostNpcId: existing.target_npc_id,
      };
    }
  } catch { /* table may not exist */ }

  const host = pickHostNpc(db, worldId, composed.signature, composed.target_archetypes);

  // Create the quest via quest-engine. Lazy import so this module is
  // testable without spinning up the engine.
  let questId = null;
  try {
    const qe = await import("../emergent/quest-engine.js");
    if (qe?.createQuest) {
      const cfg = {
        difficulty: "intermediate",
        steps: composed.steps.map(s => ({
          title: s.type,
          prompt: s.prompt,
        })),
        breadcrumbs: { enabled: true, insightsCount: 1 },
      };
      const created = qe.createQuest(composed.title, cfg);
      if (created?.ok && created.quest?.id) questId = created.quest.id;
    }
  } catch { /* quest-engine optional in test contexts */ }

  // If quest-engine wasn't available, fabricate a synthetic id so the
  // lattice_born_quests row still persists (caller can tie it to a
  // real engine quest later).
  if (!questId) questId = `lbq_quest_${composed.signature.slice(0, 12)}`;

  const persisted = persistLatticeBornQuest(db, {
    signature: composed.signature,
    driftType: alert.type,
    driftSeverity: alert.severity || "warning",
    questId,
    worldId,
    targetNpcId: host?.id || null,
    composer: "deterministic",
  });

  if (!persisted.ok) return persisted;
  return {
    ok: true,
    action: persisted.action,
    questId,
    hostNpcId: host?.id || null,
    title: composed.title,
  };
}

/**
 * Mark a lattice-born quest realised when the player completes it.
 * Caller is the quest-engine completion path (via beat-realisation hook
 * or direct).
 */
export function realiseLatticeBornQuest(db, questId, outcome = "completed") {
  if (!db || !questId) return { ok: false, reason: "missing_inputs" };
  try {
    db.prepare(`
      UPDATE lattice_born_quests
      SET realised_at = unixepoch(), realisation_outcome = ?
      WHERE quest_id = ? AND realised_at IS NULL
    `).run(outcome, questId);
    return { ok: true };
  } catch (err) { return { ok: false, reason: "update_failed", error: err?.message }; }
}

export const _internal = {
  QUEST_TEMPLATES,
  pickFromSeed,
};
