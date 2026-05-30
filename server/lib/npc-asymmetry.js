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
import { bumpStress as _bumpStress } from "./npc-stress.js";
import { recordOpinionEvent } from "./npc-opinions.js";
import { LruMap, LruSet } from "./lru-map.js";

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

// Living Society Phase 4 — grievance against AUTHORITY (ruler/faction/enforcer),
// not just the player. These are the measurable unpaid/abused-flow events.
const AUTHORITY_IMPACT_SEVERITY = {
  unpaid_wages:           4,  // Phase 3 unpaid-flow
  repeated_unpaid_wages:  6,
  harsh_decree:           5,  // tax hike / embargo
  conscripted:            4,
  kin_killed_by_enforcer: 7,
  treasury_embezzled:     6,
  authored_tyranny:       5,  // lore.json standing grievance
};

// ── Template loaders ─────────────────────────────────────────────────────────

const _templateCache = new LruMap();

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

// ── T1.3 — authored interiority → scheme-engine substrate ────────────────────
//
// The scheme cycle (server/emergent/npc-scheme-cycle.js) only proposes plots
// for NPCs whose npc_stress.stress >= 60 AND who hold a character_opinions row
// with score <= -50 toward a target. Those rows accrue from *gameplay*, never
// from authored content — so on a fresh boot the CK3 scheme layer is dormant
// and the marquee "overhear a scheme resolve nearby" moment never fires for a
// cold-booted stranger. This pass derives the two numbers the gate reads from
// the interiority authors already wrote (narrative_context + relationships),
// so authored rivalries (Zero↔fork, warlord↔nemesis) become live schemes at
// boot instead of inert flavor.
//
// Determinism: pure function of the authored npc object — same boot → same
// numbers. The secret TEXT never leaves this module (it only contributes a
// stress weight); the narrative-bridge secret-omission invariant is untouched.

// Stress contribution per present narrative_context field (delta over the 30
// baseline). A secret with an active weaponise_at trigger is the strongest
// signal — those NPCs ("ability to lead is contingent on the secret holding")
// are exactly the ones who should be scheming.
const NARRATIVE_STRESS_CONTRIB = {
  secret:       12,
  weaponise_at: 24,
  fear:         14,
  current_goal:  8,
};
const SEEDED_STRESS_CAP = 95;
const SEEDED_COPING_DAYS = 30;          // outlast the cold-start demo window
const SECONDS_PER_DAY = 86400;

// Archetypes whose authored temperament implies a scheming disposition. A
// coping_trait of paranoid|cruel is itself a scheme-gate wildcard, and drives
// pickSchemeKind (cruel→assassinate, paranoid→blackmail).
const CRUEL_ARCHETYPES = new Set([
  "warlord", "raider", "enforcer", "assassin", "killer", "tyrant",
  "executioner", "reaver", "butcher", "inquisitor",
]);
const PARANOID_ARCHETYPES = new Set([
  "spy", "curator", "schemer", "broker", "smuggler", "informant",
  "fugitive", "fixer", "handler", "spymaster", "conspirator",
]);

// Relationship-type → opinion score. Hostile types land <= -50 so they become
// scheme-eligible targets; wary types are negative-but-not-murderous; allied
// types seed positive edges (accomplice recruitment reads opinion >= +30).
const REL_TYPE_OPINION = {
  ideological_nemesis:       -62,
  blood_target:              -70,
  deliberate_threat:         -60,
  old_adversary:             -58,
  former_creator_now_threat: -60,
  former_client_now_threat:  -56,
  estranged_fork:            -52,
  wary_respect:              -34,
  wary_truce:                -30,
  wary_recognition:          -30,
  wary_curiosity:            -24,
  respectful_distance:       -20,
  doubting_lieutenant:       -40,
  former_mentor_now_warden:  -38,
  reluctant_apprentice:      -28,
  watched_curiosity:         -14,
  fascinated_observer:        10,
  polite_recognition:         12,
  professional_respect:       30,
  philosophical_kinship:      45,
  moral_compass:              50,
  natural_ally:               55,
  potential_ally:             38,
  transactional_ally:         34,
  transactional_back_channel: 18,
  trusted_organizer:          50,
  trusted_fixer:              48,
  chosen_heir:                60,
};

// Keyword fallback for relationship types not in the table above, so new
// authored types classify sensibly without a code edit.
function opinionForRelType(type) {
  if (type == null) return 0;
  const t = String(type).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(REL_TYPE_OPINION, t)) return REL_TYPE_OPINION[t];
  if (/(nemesis|adversary|enemy|threat|blood_target|vengeance|feud|hatred|betray|rival)/.test(t)) return -60;
  if (/(wary|doubting|warden|reluctant|distrust|tension|estranged|suspicion)/.test(t)) return -38;
  if (/(ally|trusted|kinship|heir|friend|mentor|respect|compass|kin)/.test(t)) return 45;
  return 0;
}

function copingTraitFor(npc) {
  const arch = String(npc.archetype || "").toLowerCase();
  if (CRUEL_ARCHETYPES.has(arch)) return "cruel";
  if (PARANOID_ARCHETYPES.has(arch)) return "paranoid";
  // A secret with an explicit weaponisation trigger = a secret-bearer under
  // chronic threat → paranoid.
  const nc = npc.narrative_context;
  if (nc && typeof nc === "object" && nc.weaponise_at) return "paranoid";
  return null;
}

/**
 * Derive npc_stress + character_opinions edges from one authored NPC's
 * narrative_context + relationships. Idempotent in practice because its only
 * caller (seedNPCAsymmetry) early-returns once the NPC has been seeded. Never
 * lowers gameplay-accrued stress and never overwrites a gameplay coping trait.
 */
export function deriveSchemeSubstrateFromNarrative(db, npc) {
  if (!db || !npc?.id) return { ok: false, reason: "no_npc" };
  const nc = (npc.narrative_context && typeof npc.narrative_context === "object" && !Array.isArray(npc.narrative_context))
    ? npc.narrative_context : {};

  let stressDelta = 0;
  for (const [field, contrib] of Object.entries(NARRATIVE_STRESS_CONTRIB)) {
    if (nc[field]) stressDelta += contrib;
  }
  const seededStress = Math.min(SEEDED_STRESS_CAP, 30 + stressDelta);
  const coping = copingTraitFor(npc);
  const now = Math.floor(Date.now() / 1000);
  const copingUntil = coping ? now + SEEDED_COPING_DAYS * SECONDS_PER_DAY : null;

  let stressSet = 0, opinionEdges = 0;

  // Stress + coping: raise stress (never lower), keep any existing gameplay
  // coping trait, otherwise apply the derived one.
  if (stressDelta > 0 || coping) {
    try {
      db.prepare(`
        INSERT INTO npc_stress (npc_id, stress, coping_trait, coping_until, last_decay_at, updated_at)
        VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
        ON CONFLICT(npc_id) DO UPDATE SET
          stress       = MAX(npc_stress.stress, excluded.stress),
          coping_trait = COALESCE(npc_stress.coping_trait, excluded.coping_trait),
          coping_until = COALESCE(npc_stress.coping_until, excluded.coping_until),
          updated_at   = unixepoch()
      `).run(npc.id, seededStress, coping, copingUntil);
      stressSet = seededStress;
    } catch { /* npc_stress table optional on minimal builds */ }
  }

  // Opinion edges from authored relationships → the hate-edges schemes fire
  // along. recordOpinionEvent applies a delta; at seed time the row is absent
  // (score 0) so the delta lands as the absolute score.
  const rels = Array.isArray(npc.relationships) ? npc.relationships : [];
  for (const rel of rels) {
    const targetId = rel?.npc_id;
    if (!targetId || targetId === npc.id) continue;
    const score = opinionForRelType(rel.type);
    if (score === 0) continue;
    try {
      recordOpinionEvent(
        db,
        { npcId: npc.id, targetKind: "npc", targetId },
        score,
        rel.notes ? String(rel.notes).slice(0, 160) : `authored:${rel.type || "relationship"}`,
      );
      opinionEdges++;
    } catch { /* character_opinions table optional */ }
  }

  return { ok: true, stress: stressSet, coping, opinionEdges };
}

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

  // T1.3 — translate the NPC's authored interiority (narrative_context +
  // relationships) into the npc_stress + character_opinions rows the scheme
  // engine gates on, so authored rivalries become live schemes at cold boot.
  // Best-effort: a failure here must never block the rest of asymmetry seeding.
  let schemeSubstrate = null;
  try {
    schemeSubstrate = deriveSchemeSubstrateFromNarrative(db, npc);
  } catch (err) {
    logger.debug?.("npc_asymmetry", "scheme_substrate_failed", { npcId: npc.id, err: err?.message });
  }

  return { ok: true, schemeSubstrate };
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
  // Sprint C / Track A1 — severity ≥ 6 grudges feed into npc_stress.
  // Migration 152 created the table; older builds skip silently.
  if (severity >= 6) {
    try { _bumpStress(db, npcId, "grudge_severe"); } catch { /* table absent on minimal builds */ }
  }
  return { ok: true, action: "added", id, severity };
}

/**
 * Living Society Phase 4 — record a grievance held by an NPC against an
 * AUTHORITY (a faction, a ruler, an enforcer-NPC), not the player. This is the
 * measurable unpaid/abused-flow signal the movement engine (Phase 5) recruits
 * on. Grudges accumulate on the SAME (npc_id, target) edge — a repeat unpaid
 * wage deepens an existing grievance rather than spamming rows.
 *
 * @param db
 * @param npcId       the aggrieved NPC
 * @param opts        { targetKind:'faction'|'ruler'|'npc'|'realm', targetId, eventKind, severity?, narrative? }
 */
export function recordAuthorityGrievance(db, npcId, opts = {}) {
  if (!db || !npcId || !opts.targetKind || !opts.targetId || !opts.eventKind) {
    return { ok: false, reason: "missing_inputs" };
  }
  // Normalise authority kinds onto the npc_grudges CHECK (player|npc|faction):
  // a realm/kingdom/faction authority → 'faction'; a ruler/enforcer NPC → 'npc';
  // a player ruler → 'player'. (migration 128's constraint is unchanged.)
  const targetKind = normalizeAuthorityKind(opts.targetKind);
  const targetId = opts.targetId;
  const severity = opts.severity != null
    ? opts.severity
    : (AUTHORITY_IMPACT_SEVERITY[opts.eventKind] ?? 4);
  if (severity <= 0) return { ok: true, action: "noop" };

  // Deepen an existing open grievance on the same edge (capped at 10) so the
  // grievance MEASURES accumulated unpaid/abused flow.
  let existing = null;
  try {
    existing = db.prepare(`
      SELECT id, severity FROM npc_grudges
      WHERE npc_id = ? AND target_kind = ? AND target_id = ? AND resolved_at IS NULL
      ORDER BY event_at DESC LIMIT 1
    `).get(npcId, targetKind, targetId);
  } catch { existing = null; }

  if (existing) {
    const newSev = Math.min(10, existing.severity + Math.ceil(severity / 2));
    try {
      db.prepare(`UPDATE npc_grudges SET severity = ?, event_at = unixepoch() WHERE id = ?`).run(newSev, existing.id);
    } catch { /* best-effort */ }
    if (newSev >= 6) { try { _bumpStress(db, npcId, "grievance_authority"); } catch { /* optional */ } }
    return { ok: true, action: "deepened", id: existing.id, severity: newSev };
  }

  const id = insertGrudge(db, npcId, {
    target_kind: targetKind,
    target_id: targetId,
    narrative: opts.narrative || `${opts.eventKind.replace(/_/g, " ")} — they owe me, and they know it.`,
    severity: Math.min(10, severity),
  });
  if (severity >= 6) { try { _bumpStress(db, npcId, "grievance_authority"); } catch { /* optional */ } }
  return { ok: true, action: "added", id, severity: Math.min(10, severity) };
}

function normalizeAuthorityKind(kind) {
  const k = String(kind || "").toLowerCase();
  if (k === "player") return "player";
  if (["ruler", "enforcer", "npc", "lord"].includes(k)) return "npc";
  // realm / kingdom / faction / guild / org → faction
  return "faction";
}

/** Sum of open grievance severity held against a given authority (per world optional). */
export function grievanceAgainstAuthority(db, targetKind, targetId) {
  if (!db || !targetKind || !targetId) return { total: 0, count: 0 };
  try {
    const r = db.prepare(`
      SELECT COALESCE(SUM(severity),0) AS total, COUNT(*) AS count
      FROM npc_grudges
      WHERE target_kind = ? AND target_id = ? AND resolved_at IS NULL
    `).get(normalizeAuthorityKind(targetKind), targetId);
    return { total: r?.total || 0, count: r?.count || 0 };
  } catch { return { total: 0, count: 0 }; }
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

  // Sprint C / Track A2 — current opinion shifts how the NPC reads the
  // player. Compose returns it so the dialogue prompt knows e.g. "this NPC
  // respects you despite an old grudge".
  let currentOpinion = null;
  if (userId) {
    try {
      const r = db.prepare(`
        SELECT score, kind FROM character_opinions
        WHERE npc_id = ? AND target_kind = 'player' AND target_id = ?
      `).get(npcId, userId);
      if (r) currentOpinion = `${r.kind} (${r.score >= 0 ? '+' : ''}${r.score})`;
    } catch { /* character_opinions may be absent */ }
  }

  return {
    persistent_grudge: grudge ? grudge.narrative : null,
    current_preoccupation: preocc ? preocc.narrative : null,
    desire_for_this_player: desire ? desire.narrative : null,
    current_opinion: currentOpinion,
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
