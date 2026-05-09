// server/lib/npc-asymmetry.js
//
// Phase 2 — NPC asymmetry. Three structured fields auto-prepended to every
// LLM dialogue prompt:
//   - persistent grudge        (one per NPC, the most severe unresolved one)
//   - current preoccupation    (one per NPC, the freshest non-faded one)
//   - asymmetric desire        (only set when the NPC has an open desire
//                                whose target_archetype regex matches THIS
//                                player's metric profile)
//
// The cheapest structural win in the whole plan: NPCs stop sounding
// generic because the LLM is forced to thread specific events through
// every reply.
//
// Generation:
//   - seedNPCAsymmetry(npcId): deterministic from sha1(npc_id), pulls 1
//     grudge + 1 preoccupation + 1 desire from authored content templates.
//   - refreshFactionPreoccupations(factionId): called from
//     faction-strategy-cycle when a faction's phase changes. Updates
//     kind='faction_phase' rows for all NPCs in that faction.
//   - recordPlayerImpactEvent(npcId, userId, eventKind, magnitude): called
//     from combat death / quest betrayal / economic cheat paths. Adds a
//     grudge row when severity threshold crossed.
//   - findOfferedDesire(npcId, userId, playerMetrics): called from the
//     dialogue endpoint. Picks an open desire whose archetype matches.

import crypto from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import logger from "../logger.js";

const REPO_ROOT = path.resolve(import.meta.dirname || ".", "..", "..");

// Severity thresholds — events below the threshold don't generate a
// grudge row, just a contextual signal. Combat-kill is severe; cheat is
// medium; insult is light.
const IMPACT_SEVERITY = {
  killed_by_player:     8,
  betrayed_in_quest:    7,
  cheated_economically: 5,
  insulted:             3,
  saved_by_player:     -7,   // negative — REMOVES grudges
  defended_in_combat:  -5,
  honored_publicly:    -4,
};

// ── Template loaders ─────────────────────────────────────────────────────────

const _templateCache = new Map();

async function loadTemplate(name) {
  if (_templateCache.has(name)) return _templateCache.get(name);
  const candidates = [
    path.join(REPO_ROOT, "content", "world", `${name}.json`),
  ];
  for (const p of candidates) {
    try {
      const raw = await readFile(p, "utf-8");
      const parsed = JSON.parse(raw);
      _templateCache.set(name, parsed);
      return parsed;
    } catch { /* try next */ }
  }
  // Fallback: in-code defaults so the system works even before content
  // authors fill out the JSON files.
  const fallback = DEFAULT_TEMPLATES[name] || [];
  _templateCache.set(name, fallback);
  return fallback;
}

// Minimal in-code fallbacks. Content authors override these via
// content/world/*.json.
const DEFAULT_TEMPLATES = {
  grudge_templates: [
    { archetype: "warrior", template: "{target_name} cheated at the salt market two summers past. {severity_word}." },
    { archetype: "scholar", template: "{target_name} dismissed my research before the council. The slight remains." },
    { archetype: "trader",  template: "{target_name} undercut me on a deal worth {magnitude} sparks. I do not forget." },
    { archetype: "mystic",  template: "{target_name} walked out of my circle uninitiated. The thread between us is frayed." },
    { archetype: "default", template: "{target_name} crossed me. {severity_word}." },
  ],
  desire_templates: [
    { target_archetype: "concord_alignment_high", template: "Vouch for my brother in the upcoming council vote.", reward_kind: "opinion_shift" },
    { target_archetype: "concordia_alignment_high", template: "Plant a sapling at the southern grove, in my mother's name.", reward_kind: "opinion_shift" },
    { target_archetype: "ecosystem_low",          template: "Find the runoff source poisoning the Thornwood stream.", reward_kind: "quest_unlock" },
    { target_archetype: "refusal_debt_high",      template: "Speak the Sovereign's refusal at the western gate before sundown.", reward_kind: "alignment_shift" },
    { target_archetype: "default",                template: "Bring me a token from beyond this district.", reward_kind: "opinion_shift" },
  ],
  preoccupation_templates: [
    { phase: "expand",      template: "My faction is pushing east; we expect new territory before the next moon." },
    { phase: "war",         template: "My faction is at war. Half my kin are wounded; the rest are sharpening blades." },
    { phase: "rebuild",     template: "We lost the last skirmish. I'm rationing my own training to feed the rebuild." },
    { phase: "alliance",    template: "We're courting the Pinewood Coalition; my cousin is an envoy now." },
    { phase: "consolidate", template: "We're holding what we have. No new fronts until the elders agree." },
    { phase: "isolation",   template: "We've withdrawn from the field. The silence is by choice." },
    { phase: "default",     template: "My faction is between phases. I keep my eyes open." },
  ],
};

// ── Deterministic selection ──────────────────────────────────────────────────

function seedFor(npcId, suffix) {
  return crypto.createHash("sha1").update(`${npcId}|${suffix}`).digest();
}

function pickFromSeed(seedBuf, idx, arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[seedBuf[idx % seedBuf.length] % arr.length];
}

function fillTemplate(template, vars) {
  let out = String(template || "");
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, "g"), v == null ? "" : String(v));
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Idempotent seed at NPC spawn. Inserts one grudge + one preoccupation +
 * one desire deterministically from sha1(npcId). Skips if the NPC already
 * has rows (allows replay-safe re-seeding).
 */
export async function seedNPCAsymmetry(db, npc) {
  if (!db || !npc?.id) return { ok: false, reason: "no_npc" };

  // Skip if already seeded.
  const existing = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM npc_grudges        WHERE npc_id = ?) AS g,
      (SELECT COUNT(*) FROM npc_preoccupations WHERE npc_id = ?) AS p,
      (SELECT COUNT(*) FROM npc_desires        WHERE npc_id = ?) AS d
  `).get(npc.id, npc.id, npc.id);
  if (existing && (existing.g > 0 || existing.p > 0 || existing.d > 0)) {
    return { ok: true, reason: "already_seeded" };
  }

  const archetype = String(npc.archetype || "default").toLowerCase();
  const grudgeTemplates = await loadTemplate("grudge_templates");
  const desireTemplates = await loadTemplate("desire_templates");
  const preoccTemplates = await loadTemplate("preoccupation_templates");

  // Grudge — pick the archetype-matching template (or default).
  const grudgePool = grudgeTemplates.filter(t => t.archetype === archetype);
  const grudgePick = pickFromSeed(seedFor(npc.id, "grudge"), 0, grudgePool.length ? grudgePool : grudgeTemplates);
  if (grudgePick) {
    insertGrudge(db, npc.id, {
      target_kind: "npc",
      target_id: deterministicTargetNpcId(npc, "grudge"),
      narrative: fillTemplate(grudgePick.template, {
        target_name: deterministicTargetNpcId(npc, "grudge"),
        severity_word: "It festers still",
        magnitude: 18,
      }),
      severity: 5,
    });
  }

  // Preoccupation — initial state is "default" until faction-strategy-cycle
  // refreshes it.
  const preoccPick = pickFromSeed(seedFor(npc.id, "preocc"), 0, preoccTemplates) || preoccTemplates[preoccTemplates.length - 1];
  if (preoccPick) {
    insertPreoccupation(db, npc.id, {
      kind: "personal_loss",
      narrative: fillTemplate(preoccPick.template, {}),
    });
  }

  // Desire — picks one whose target_archetype is compatible with this NPC's
  // own archetype + faction. This row sits in 'open' status until a player
  // who matches the archetype regex triggers offerDesire().
  const desirePick = pickFromSeed(seedFor(npc.id, "desire"), 0, desireTemplates);
  if (desirePick) {
    insertDesire(db, npc.id, {
      target_archetype: desirePick.target_archetype,
      narrative: fillTemplate(desirePick.template, {}),
      reward_kind: desirePick.reward_kind || "opinion_shift",
    });
  }

  return { ok: true };
}

function deterministicTargetNpcId(npc, suffix) {
  const seed = seedFor(npc.id, suffix);
  // Fabricate a plausible name token; real targets resolve via target_id
  // when content/world authoring connects them.
  return `${npc.faction || "stranger"}_neighbor_${seed.toString("hex").slice(0, 4)}`;
}

function insertGrudge(db, npcId, opts) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO npc_grudges (id, npc_id, target_kind, target_id, narrative, severity, event_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
  `).run(id, npcId, opts.target_kind, opts.target_id, opts.narrative, opts.severity || 5);
  return id;
}

function insertPreoccupation(db, npcId, opts) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO npc_preoccupations (id, npc_id, kind, source_id, narrative, established_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
  `).run(id, npcId, opts.kind, opts.source_id || null, opts.narrative);
  return id;
}

function insertDesire(db, npcId, opts) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO npc_desires (id, npc_id, target_archetype, narrative, completion_predicate_json, reward_kind, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', unixepoch())
  `).run(id, npcId, opts.target_archetype, opts.narrative,
         opts.completion_predicate_json || null,
         opts.reward_kind || "opinion_shift");
  return id;
}

/**
 * Refresh faction-driven preoccupations for all NPCs in a faction when
 * the faction's strategy phase changes. Existing 'faction_phase' rows
 * are faded; a new row is inserted per NPC.
 */
export async function refreshFactionPreoccupations(db, factionId, newPhase) {
  if (!db || !factionId || !newPhase) return { ok: false, reason: "missing_inputs" };

  // Fade prior faction-phase preoccupations.
  db.prepare(`
    UPDATE npc_preoccupations SET fades_at = unixepoch()
    WHERE kind = 'faction_phase' AND fades_at IS NULL
      AND npc_id IN (SELECT id FROM world_npcs WHERE faction = ?)
  `).run(factionId);

  // Insert fresh ones.
  const templates = await loadTemplate("preoccupation_templates");
  const picked = templates.find(t => t.phase === newPhase) || templates.find(t => t.phase === "default") || templates[0];
  if (!picked) return { ok: true, refreshed: 0 };

  const npcs = db.prepare(`SELECT id FROM world_npcs WHERE faction = ? AND COALESCE(is_dead, 0) = 0 LIMIT 200`).all(factionId);
  let refreshed = 0;
  for (const n of npcs) {
    insertPreoccupation(db, n.id, {
      kind: "faction_phase",
      source_id: factionId,
      narrative: fillTemplate(picked.template, { faction: factionId, phase: newPhase }),
    });
    refreshed++;
  }

  // Phase 4a — cascade into NPC routines: a phase change visibly reshapes
  // every NPC's daily schedule. Best-effort, never blocks.
  try {
    const routines = await import("./npc-routines.js");
    if (routines?.regenerateSchedulesForFaction) {
      routines.regenerateSchedulesForFaction(db, factionId, {
        kind: "faction_phase",
        narrative: picked.template,
      });
    }
  } catch { /* npc_schedules table may be absent on minimal builds */ }

  return { ok: true, refreshed };
}

/**
 * Record a player → NPC impact event. Adds a grudge if magnitude crosses
 * threshold; cancels existing grudges if magnitude is negative
 * (positive impact).
 */
export function recordPlayerImpactEvent(db, npcId, userId, eventKind, magnitudeOverride = null) {
  if (!db || !npcId || !userId || !eventKind) return { ok: false, reason: "missing_inputs" };
  const severity = magnitudeOverride != null ? magnitudeOverride : (IMPACT_SEVERITY[eventKind] ?? 0);
  if (severity === 0) return { ok: true, action: "noop" };

  if (severity < 0) {
    // Positive impact — soften / resolve grudges.
    const r = db.prepare(`
      UPDATE npc_grudges SET resolved_at = unixepoch(), severity = MAX(1, severity + ?)
      WHERE npc_id = ? AND target_kind = 'player' AND target_id = ? AND resolved_at IS NULL
    `).run(severity, npcId, userId);
    return { ok: true, action: "softened", touched: r.changes };
  }

  // Negative impact — generate a grudge.
  const id = insertGrudge(db, npcId, {
    target_kind: "player",
    target_id: userId,
    narrative: `${eventKind.replace(/_/g, " ")} — the memory burns.`,
    severity: Math.min(10, severity),
  });
  return { ok: true, action: "added", id, severity };
}

/**
 * Find an open desire on an NPC whose target_archetype matches the player's
 * metrics. If found, return + mark it offered. Otherwise return null.
 *
 * playerMetrics shape:
 *   { ecosystem_score, concord_alignment, concordia_alignment, refusal_debt }
 */
export function findOfferedDesire(db, npcId, userId, playerMetrics) {
  if (!db || !npcId || !userId) return null;
  const archetypeKey = derivePlayerArchetype(playerMetrics);

  // Already offered? Return the existing one.
  const offered = db.prepare(`
    SELECT id, narrative, target_archetype, reward_kind FROM npc_desires
    WHERE npc_id = ? AND status = 'offered' AND offered_to_user_id = ?
    LIMIT 1
  `).get(npcId, userId);
  if (offered) return offered;

  // Open desire matching this archetype OR defaulting.
  const candidates = db.prepare(`
    SELECT id, narrative, target_archetype, reward_kind FROM npc_desires
    WHERE npc_id = ? AND status = 'open'
    ORDER BY
      CASE WHEN target_archetype = ? THEN 0 ELSE 1 END,
      created_at ASC
    LIMIT 1
  `).all(npcId, archetypeKey);
  const pick = candidates[0];
  if (!pick) return null;

  // Offer it.
  db.prepare(`
    UPDATE npc_desires SET status = 'offered', offered_to_user_id = ?, offered_at = unixepoch()
    WHERE id = ?
  `).run(userId, pick.id);
  return pick;
}

function derivePlayerArchetype(metrics) {
  if (!metrics) return "default";
  if (Number(metrics.concord_alignment) >= 0.7) return "concord_alignment_high";
  if (Number(metrics.concordia_alignment) >= 0.7) return "concordia_alignment_high";
  if (Number(metrics.refusal_debt) >= 0.6) return "refusal_debt_high";
  if (Number(metrics.ecosystem_score) <= 0.3) return "ecosystem_low";
  return "default";
}

/**
 * Pull the structured asymmetry context for an NPC + player. Returns
 * { persistent_grudge, current_preoccupation, desire_for_this_player }
 * where each field is null when the NPC has nothing to surface.
 */
export function composeAsymmetryContext(db, npcId, userId, playerMetrics) {
  if (!db || !npcId) return { persistent_grudge: null, current_preoccupation: null, desire_for_this_player: null };

  let grudge = null;
  try {
    const row = db.prepare(`
      SELECT narrative, severity, target_kind, target_id FROM npc_grudges
      WHERE npc_id = ? AND resolved_at IS NULL
      ORDER BY severity DESC, event_at DESC
      LIMIT 1
    `).get(npcId);
    if (row) grudge = row;
  } catch (err) {
    try { logger.debug?.("npc-asymmetry", "grudge_read_failed", { error: err?.message }); }
    catch { /* ignore */ }
  }

  let preocc = null;
  try {
    const row = db.prepare(`
      SELECT narrative, kind, established_at FROM npc_preoccupations
      WHERE npc_id = ? AND fades_at IS NULL
      ORDER BY established_at DESC
      LIMIT 1
    `).get(npcId);
    if (row) preocc = row;
  } catch { /* preoccupation table may be absent on minimal builds */ }

  let desire = null;
  if (userId) {
    try {
      desire = findOfferedDesire(db, npcId, userId, playerMetrics);
    } catch { /* ignore */ }
  }

  return {
    persistent_grudge: grudge ? grudge.narrative : null,
    current_preoccupation: preocc ? preocc.narrative : null,
    desire_for_this_player: desire ? desire.narrative : null,
  };
}

export const _internal = {
  IMPACT_SEVERITY,
  DEFAULT_TEMPLATES,
  derivePlayerArchetype,
  fillTemplate,
  pickFromSeed,
  seedFor,
  insertGrudge,
  insertPreoccupation,
  insertDesire,
};
