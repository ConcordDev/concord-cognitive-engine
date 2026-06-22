/**
 * Narrative Bridge — Enriches oracle-brain LLM calls with authored context.
 *
 * The bridge takes authored NPC backstories, faction motivations, and quest
 * narrative stakes from the content seeder and passes them as rich context to
 * oracle-brain's generateQuestChain and writeDialogueTree. The result is
 * LLM-generated dialogue and quest content that is grounded in the authored world
 * rather than thin procedural descriptions.
 *
 * This is the thesis in code: authored skeleton + LLM muscle.
 *
 * Cache: in-memory LRU by (npcId, questId, relationship) with 5-min TTL.
 * Falls back to direct oracle-brain calls for non-authored NPCs.
 */

import logger from "../logger.js";
import { synthesizeLore, generateQuestChain, writeDialogueTree } from "./oracle-brain.js";
import { getTimeline } from "../emergent/history-engine.js";
import { getAuthoredNPC, getAuthoredFaction, getQuestsForNPC, getAuthoredDialogue } from "./content-seeder.js";
import { getFactionPolicyState } from "./council-world-bridge.js";
import { getKnowledgeForRole } from "./npc-knowledge-bridge.js";
import { recentFacts as _recentWorldFacts } from "./world-facts.js";
// Phase 2 — NPC asymmetry. Direct top-level import is fine: asymmetry
// doesn't import narrative-bridge, so no cycle. composeAsymmetryContext
// is a pure read against the npc_grudges/preoccupations/desires tables;
// it tolerates missing tables and returns nulls.
import { composeAsymmetryContext as _composeAsymmetryContext } from "./npc-asymmetry.js";
import { copingTraitLine as _copingTraitLine } from "./npc-stress.js";

const DIALOGUE_TTL_MS   = 5 * 60 * 1000;   // 5 minutes
const QUEST_TTL_MS      = 10 * 60 * 1000;  // 10 minutes
const LORE_TTL_MS       = 10 * 60 * 1000;

// ── In-Memory Caches ─────────────────────────────────────────────────────────

const _dialogueCache = new Map();   // key → { result, generatedAt }
const _questCache    = new Map();   // key → { result, generatedAt }
const _loreCache     = new Map();   // worldId → { result, generatedAt }

function cacheGet(map, key, ttlMs) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.generatedAt > ttlMs) {
    map.delete(key);
    return null;
  }
  return entry.result;
}

function cacheSet(map, key, result) {
  map.set(key, { result, generatedAt: Date.now() });
}

// ── Context Builders ──────────────────────────────────────────────────────────

/**
 * Build enriched npcTraits from authored NPC data.
 * Falls back to the raw npcId string if no authored NPC found.
 */
/**
 * Pull recent "social_awareness" shadows for an NPC's world/faction.
 * Cap on size keeps oracle prompts from blowing out (default 1024 bytes).
 * Returns a short array of { author, summary } strings; empty array if
 * the social-npc-bridge hasn't run yet or STATE is missing.
 */
function buildSocialSignals(npcId, _db = null, maxBytes = 1024, maxItems = 5) {
  // STATE.shadowDtus is populated by the shadow-graph + social-npc-bridge.
  const state = globalThis._concordSTATE;
  if (!state?.shadowDtus || state.shadowDtus.size === 0) return [];

  const npc = getAuthoredNPC(npcId);
  const npcWorld = npc?.world_id ?? null;
  const npcFaction = npc?.faction_id ?? null;

  // Newest first.
  const all = Array.from(state.shadowDtus.values())
    .filter((s) => Array.isArray(s.tags) && s.tags.includes("social_awareness"))
    .filter((s) => {
      // If the shadow names a target world or faction, it must match the NPC's.
      // Untargeted (global) shadows reach every NPC.
      if (s.targetWorldId && npcWorld && s.targetWorldId !== npcWorld) return false;
      if (s.targetFactionId && npcFaction && s.targetFactionId !== npcFaction) return false;
      return true;
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  const out = [];
  let bytes = 0;
  for (const s of all) {
    if (out.length >= maxItems) break;
    const summary = (s.core?.summary ?? s.summary ?? "").toString().slice(0, 280);
    if (!summary) continue;
    const item = { author: s.authorHandle ?? "anon", summary };
    const itemSize = Buffer.byteLength(JSON.stringify(item), "utf-8");
    if (bytes + itemSize > maxBytes) break;
    out.push(item);
    bytes += itemSize;
  }
  return out;
}

/**
 * Build the npcTraits object that gets passed to oracle-brain LLM calls.
 *
 * INVARIANT: `npc.narrative_context.secret` MUST NEVER appear in the
 * returned object. Secrets are for human authors and quest-branch
 * conditions; the LLM has no business knowing them. The structural guard
 * below explicitly omits the field; the strict-mode canary scan at the
 * end is defense-in-depth so a future field-list mistake gets caught
 * before it ships.
 *
 * Exported so the secret-leakage contract test can call it directly
 * with a fixture NPC instead of having to seed the authored registry.
 */
// Wave 8b — the Three Pillars + their shared cosmology line (secret-safe; the
// order/triangle is the locked canon, hidden_truth deliberately excluded).
const GOD_NPC_IDS = new Set([
  "concordia_first_breath", "concord_first_thought", "sovereign_first_refusal",
]);
const GOD_COSMOLOGY_LINE =
  "You are one of the Three Pillars. Order of being: the Sovereign refused his own nonexistence " +
  "(the First Refusal, and so invented Refusal itself); his refusal of being alone stirred Concordia " +
  "into being (the First Breath, abundant life); Concord sparked third as her cold contrast (the First Law, " +
  "'not like this'). Concord loves Concordia and hates what she makes so carelessly, and from that " +
  "contradiction built the Concord Link to catalog and bind her worlds; the Sovereign keeps its gates open. " +
  "Concordia is, quietly and despite the Great Refusal, fond of the Sovereign. The Sovereign — careless, " +
  "proud, amused — will permit only one thing: never to lose either of them. Speak from your own place in " +
  "this triangle; never narrate it like a lecture.";

/**
 * NPC-purpose awareness: the NPC's assigned job + workplace, as a short,
 * secret-safe summary so dialogue knows "I keep the tavern for the Pinewood
 * Coalition" instead of being place-blind. Public facts only (job + building) —
 * never secrets. db-guarded; returns null when the purpose tables are absent.
 */
function buildVocation(npcId, db) {
  if (!db || !npcId) return null;
  try {
    const job = db.prepare(`SELECT job_type, work_building_id FROM npc_jobs WHERE npc_id = ?`).get(npcId);
    if (!job?.job_type) return null;
    if (job.job_type === "roamer") {
      return { job: "roamer", workplace: null, summary: "a wandering adventurer with no fixed post" };
    }
    let where = null;
    if (job.work_building_id) {
      const b = db.prepare(`SELECT building_type, name FROM world_buildings WHERE id = ?`).get(job.work_building_id);
      where = b?.name || b?.building_type || null;
    }
    return {
      job: job.job_type,
      workplace: where,
      summary: where ? `works as a ${job.job_type} at the ${where}` : `works as a ${job.job_type}`,
    };
  } catch {
    return null;
  }
}

// LRL-as-hub (#30): a resonant public-domain literary passage that echoes this
// NPC's goal/theme so dialogue can be grounded in humanity's canon (the spec's
// "literary grounding for lore"). Best-effort + SECRET-SAFE — the literary corpus
// is public-domain and carries no NPC secrets; returns null when no corpus exists.
export function buildLiteraryEcho(npc, db) {
  if (!db || !npc) return null;
  const theme = String(
    npc.narrative_context?.current_goal || npc.backstory || (npc.personality_traits || []).join(" ") || ""
  ).toLowerCase();
  const toks = theme.match(/[a-z]{4,}/g);
  if (!toks || !toks.length) return null;
  const match = [...new Set(toks)].slice(0, 6).map((t) => `"${t}"`).join(" OR ");
  try {
    const row = db.prepare(`
      SELECT c.content, s.title, s.author
      FROM literary_chunks_fts f
      JOIN literary_chunks c ON c.id = f.chunk_id
      JOIN literary_sources s ON s.id = c.source_id
      WHERE literary_chunks_fts MATCH ?
      ORDER BY bm25(literary_chunks_fts) LIMIT 1
    `).get(match);
    if (!row) return null;
    return {
      quote: String(row.content || "").replace(/\s+/g, " ").trim().slice(0, 200),
      source: row.title,
      author: row.author || null,
    };
  } catch {
    return null; // literary corpus tables not present in this build
  }
}

export function buildNPCTraits(npcId, db = null, opts = {}) {
  const npc = getAuthoredNPC(npcId);
  if (!npc) {
    return {
      id: npcId,
      name: npcId,
      personality: "reserved",
      role: "resident",
      socialSignals: buildSocialSignals(npcId, db),
    };
  }

  const faction = npc.faction_id ? getAuthoredFaction(npc.faction_id) : null;

  // Pull the most recent council referendum outcome for the NPC's faction so
  // dialogue can visibly shift after a Phase A summit. Best-effort: a missing
  // db, missing table, or missing faction simply leaves recentPolicy null.
  let recentPolicy = null;
  if (db && npc.faction_id) {
    try {
      const history = getFactionPolicyState(db, npc.faction_id);
      if (history?.length > 0) recentPolicy = history[0].outcome;
    } catch { /* policy is best-effort context, never blocks dialogue */ }
  }

  const traits = {
    id:          npc.id,
    name:        npc.name,
    alias:       npc.alias ?? null,
    homeWorld:   npc.home_world ?? null,
    role:        npc.role,
    personality: npc.personality_traits?.join(", ") ?? "reserved",
    speechStyle: npc.speech_patterns ?? "",
    backstory:   npc.backstory ?? "",
    factionName: faction?.name ?? "Independent",
    factionGoal: faction?.goal ?? "",
    currentGoal: npc.narrative_context?.current_goal ?? "",
    fears:       npc.narrative_context?.fear ?? "",
    recentPolicy,
    // v2.0 bidirectional awareness: recent public Social Lens posts that
    // reached this NPC's world/faction via the social-npc-bridge. Capped
    // at 1KB total + 5 items so the LLM prompt stays tight.
    socialSignals: buildSocialSignals(npcId, db),
    // v2.0 instantiation: recent medical/research/engineering DTUs mapped
    // to this NPC's role. Doctors/scholars/engineers reference real human
    // research in their dialogue.
    professionalKnowledge: buildProfessionalKnowledge(npc, db),
    // NPC-purpose: the NPC's assigned job + workplace building (secret-safe,
    // public facts) so dialogue is place-aware — "I forge blades here", "I keep
    // the tavern". Null when the purpose substrate isn't populated.
    vocation: buildVocation(npc.id, db),
    // Concordant Web: this NPC's view of every other major character —
    // resolved to short summaries so the oracle prompt can answer
    // "what do you think of X?" in-character without the LLM inventing
    // a stance. Capped at 8 entries to keep prompts tight.
    relationshipWeb: buildRelationshipWeb(npc),
    // Cross-NPC shared facts: recent world_facts (migration 102) so
    // every NPC's dialogue is rooted in the same truth about what
    // happened recently. Pre-this, NPC A and NPC B could independently
    // generate contradictory claims about the same event.
    worldFacts: buildWorldFacts(npc, db),
    // LRL-as-hub (#30): a resonant public-domain literary passage echoing this
    // NPC's goal — grounds dialogue in humanity's canon. Null without a corpus.
    literaryEcho: buildLiteraryEcho(npc, db),
    // Phase 2: NPC asymmetry. Three structured fields injected into the
    // dialogue prompt so the LLM physically cannot drift into
    // generic-NPC mode. opts.userId + opts.playerMetrics let the desire
    // be tailored to THIS player; without them only grudge + preoccupation
    // are populated.
    persistent_grudge:        null,
    current_preoccupation:    null,
    desire_for_this_player:   null,
    // Sprint C / A1 — coping trait line when the NPC is mid-mental-break.
    coping_state:             null,
    // Sprint C / A2 — current opinion of this player (kind + score).
    current_opinion:          null,
    // Deliberately exclude secrets from LLM context — those are for human authors only
  };

  // Wave 8b — the Three Pillars carry the cosmology so the goddess (and her two
  // counterparts) can speak the triangle as lived truth, not exposition. This is
  // a hand-tuned, secret-safe summary (NO hidden_truth) — the gods previously had
  // the cosmology only implicitly. Gated to the three god NPC ids.
  if (GOD_NPC_IDS.has(npc.id)) {
    traits.cosmology = GOD_COSMOLOGY_LINE;
  }

  // Compose asymmetry context if the substrate is wired (Phase 2 migration).
  if (db) {
    try {
      const ctx = _composeAsymmetryContext(db, npcId, opts.userId, opts.playerMetrics);
      if (ctx) {
        if (ctx.persistent_grudge)        traits.persistent_grudge = ctx.persistent_grudge;
        if (ctx.current_preoccupation)    traits.current_preoccupation = ctx.current_preoccupation;
        if (ctx.desire_for_this_player)   traits.desire_for_this_player = ctx.desire_for_this_player;
        if (ctx.current_opinion)          traits.current_opinion = ctx.current_opinion;
      }
    } catch { /* asymmetry tables may not exist on minimal builds */ }

    // Sprint C / Track A1 — coping line. Read npc_stress + emit a short
    // trait line when the NPC is currently inside its coping window. The
    // line is appended to personality but stays separate so prompt
    // inspection tools can distinguish "trait" vs "transient state".
    try {
      const stressRow = db.prepare(`
        SELECT stress, coping_trait, coping_until FROM npc_stress WHERE npc_id = ?
      `).get(npcId);
      if (stressRow) {
        const line = _copingTraitLine(stressRow);
        if (line) traits.coping_state = line;
      }
    } catch { /* stress table absent on minimal builds */ }

    // Concordia Phase 2 — bloodline ancestry line. Sanguire fire-bloodline
    // characters carry "fire-bloodline of the Sangree founders" etc. Pure
    // (dilution < 0.30) reads stronger; faded barely registers.
    try {
      const anc = db.prepare(`SELECT primary_bloodline, dilution FROM npc_ancestry WHERE npc_id = ?`).get(npcId);
      if (anc?.primary_bloodline) {
        const bld = String(anc.primary_bloodline);
        const dil = Number(anc.dilution) || 1;
        let line;
        if (dil < 0.30)       line = `Pure ${bld} bloodline — the lineage marks them visibly.`;
        else if (dil < 0.60)  line = `Of the ${bld} bloodline, marks visible in features.`;
        else if (dil < 0.90)  line = `Faintly of ${bld} ancestry; mostly mixed.`;
        else                  line = `Ancestry too faded to read; ${bld} only by record.`;
        traits.bloodline_ancestry = line;
      }
    } catch { /* npc_ancestry table absent on minimal builds */ }

    // Concordia Phase 13 — culture line.
    try {
      const cul = db.prepare(`SELECT culture_id, faith_id FROM actor_culture WHERE actor_kind = 'npc' AND actor_id = ?`).get(npcId);
      if (cul?.culture_id) {
        traits.culture_id = cul.culture_id;
        if (cul.faith_id) traits.faith_id = cul.faith_id;
      }
    } catch { /* actor_culture absent on minimal builds */ }

    // Concordia Phase 3 — body type line for visual identity.
    try {
      const phy = db.prepare(`SELECT body_type, mass_kg, height_m FROM actor_physique WHERE actor_kind = 'npc' AND actor_id = ?`).get(npcId);
      if (phy?.body_type) {
        const h = phy.height_m ? `${phy.height_m.toFixed(2)}m` : "";
        const m = phy.mass_kg ? `${Math.round(phy.mass_kg)}kg` : "";
        traits.physical_build = [phy.body_type, h, m].filter(Boolean).join(" / ");
      }
    } catch { /* actor_physique absent on minimal builds */ }
  }

  // Defense-in-depth: scan the materialized traits for the secret canary.
  // If the secret string ever sneaks into the output (via a future field
  // change, a relationship note, or an LLM-vetted backstory that quoted
  // it), log a structured warn so the leak is observable. We intentionally
  // run this check in all environments — the cost (one stringify per
  // dialogue call) is negligible vs. the cost of leaking authored secrets.
  const secret = npc.narrative_context?.secret;
  if (secret && typeof secret === "string" && secret.length > 4) {
    try {
      const serialized = JSON.stringify(traits);
      if (serialized.includes(secret)) {
        logger?.warn?.({ npcId, secretPreview: secret.slice(0, 8) + "..." },
                      "narrative_bridge_secret_leak_detected");
      }
    } catch { /* stringify can fail on cycles — never block dialogue */ }
  }

  return traits;
}

/**
 * Resolve this NPC's `relationships[]` array against the authored NPC
 * registry. Each entry becomes a short string the oracle can read like
 * a personal cheat-sheet.
 *
 * Output shape: [{ id, name, alias, homeWorld, type, notes }]
 */
function buildRelationshipWeb(npc) {
  if (!npc?.relationships || !Array.isArray(npc.relationships)) return [];
  const out = [];
  for (const rel of npc.relationships.slice(0, 8)) {
    if (!rel?.npc_id || !rel?.type) continue;
    const target = getAuthoredNPC(rel.npc_id);
    out.push({
      id:        rel.npc_id,
      name:      target?.name ?? rel.npc_id,
      alias:     target?.alias ?? null,
      homeWorld: target?.home_world ?? null,
      type:      rel.type,
      notes:     (rel.notes ?? "").slice(0, 200),
    });
  }
  return out;
}

/**
 * Pull recent world_facts (migration 102) for this NPC's world / faction
 * so the oracle prompt grounds dialogue in shared truth. Best-effort: a
 * missing world_facts table or query failure returns an empty array.
 */
function buildWorldFacts(npc, db) {
  if (!db || !npc) return [];
  try {
    const worldId = npc.home_world ?? "concordia-hub";
    const rows = _recentWorldFacts(db, worldId, {
      limit: 5,
      factionId: npc.faction_id ?? null,
    });
    return rows.map((r) => ({
      kind: r.fact_kind,
      text: String(r.fact_text || "").slice(0, 200),
      district: r.district_id ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * Pull npc_knowledge entries scoped to this NPC's role (doctor / scholar /
 * engineer / etc.). Returns an empty array if the role doesn't have
 * mapped knowledge or the bridge hasn't run yet.
 */
function buildProfessionalKnowledge(npc, db) {
  if (!db || !npc) return [];
  // Map authored NPC roles to npc_knowledge roles. Authored roles vary
  // wildly ("court physician", "armorer-apprentice"), so we substring-match.
  const roleStr = (npc.role || "").toLowerCase();
  let role = null;
  if (/doctor|physician|surgeon|medic|healer/.test(roleStr)) role = "doctor";
  else if (/scholar|scientist|researcher|sage/.test(roleStr)) role = "scholar";
  else if (/engineer|smith|craftsman|builder|architect/.test(roleStr)) role = "engineer";
  if (!role) return [];

  try {
    return getKnowledgeForRole(db, { worldId: npc.world_id ?? "concordia-hub", role, limit: 3 });
  } catch {
    // Knowledge query failed (e.g. table not yet migrated). Fall back to
    // empty — dialogue still generates, just without role-specific signal.
    return [];
  }
}

/**
 * Build enriched factionState from authored faction data.
 */
function buildFactionState(npcId, db = null) {
  const npc = getAuthoredNPC(npcId);
  if (!npc?.faction_id) {
    return { factionName: "Independent", reputation: 50, tensions: "", recentPolicy: null };
  }

  const faction = getAuthoredFaction(npc.faction_id);
  if (!faction) {
    return { factionName: "Independent", reputation: 50, tensions: "", recentPolicy: null };
  }

  // Phase A bridge: pull the most recent referendum outcome so quest chains
  // reflect council decisions. Failure is silent — we never block on policy.
  let recentPolicy = null;
  let policyTimestamp = null;
  if (db) {
    try {
      const history = getFactionPolicyState(db, npc.faction_id);
      if (history?.length > 0) {
        recentPolicy    = history[0].outcome;
        policyTimestamp = history[0].ts;
      }
    } catch { /* best-effort */ }
  }

  return {
    factionName:  faction.name,
    reputation:   faction.faction_state?.reputation ?? 50,
    tensions:     faction.faction_state?.tensions ?? "",
    rivalFactions: faction.rival_factions?.join(", ") ?? "",
    motto:        faction.motto ?? "",
    recentPolicy,
    policyTimestamp,
  };
}

/**
 * Build quest context from authored quest data for an NPC.
 */
function buildQuestContext(npcId, questId) {
  if (!questId) {
    const quests = getQuestsForNPC(npcId);
    if (quests.length === 0) return { questTitle: "none", currentStep: 0 };
    const first = quests[0];
    return {
      questTitle:   first.raw?.title ?? "none",
      questSummary: first.raw?.description ?? "",
      currentStep:  0,
    };
  }

  // Try to find authored quest by authored id
  const npcQuests = getQuestsForNPC(npcId);
  const match = npcQuests.find(q => q.raw?.id === questId || q.engineId === questId);
  if (!match) return { questTitle: questId, currentStep: 0 };

  return {
    questTitle:   match.raw?.title ?? questId,
    questSummary: match.raw?.description ?? "",
    currentStep:  0,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate dialogue for an authored NPC, enriched with their backstory and
 * faction context. Falls back gracefully to procedural generation for non-authored NPCs.
 *
 * @param {string} npcId
 * @param {string|null} questId
 * @param {string} playerRelationship  - "stranger" | "ally" | "enemy" | "neutral"
 * @returns {Promise<{ ok: boolean, dialogueTree?: object, authored: boolean, error?: string }>}
 */
export async function generateAuthoredDialogue(npcId, questId = null, playerRelationship = "neutral", db = null, phase = null) {
  // Hand-authored dialogue takes precedence over LLM generation. The seeder
  // loads trees from content/dialogues/ keyed by `${npcId}:${questId}:${phase}`.
  // Returning the authored tree directly bypasses the LLM and any caching —
  // these trees are immutable per release and don't need TTL invalidation.
  const authoredTree = getAuthoredDialogue(npcId, questId, phase);
  if (authoredTree) {
    return {
      ok: true,
      authored: true,
      handAuthored: true,
      dialogueTree: {
        npcId,
        generatedAt: new Date().toISOString(),
        ...authoredTree,
      },
    };
  }

  // Cache-bust on policy timestamp so a fresh referendum invalidates stale dialogue.
  const npcForKey = getAuthoredNPC(npcId);
  let policyKey = "0";
  if (db && npcForKey?.faction_id) {
    try {
      const h = getFactionPolicyState(db, npcForKey.faction_id);
      if (h?.length > 0) policyKey = String(h[0].ts);
    } catch { /* default 0 */ }
  }
  const cacheKey = `${npcId}:${questId ?? "none"}:${playerRelationship}:p${policyKey}`;
  const cached = cacheGet(_dialogueCache, cacheKey, DIALOGUE_TTL_MS);
  if (cached) return { ...cached, cached: true };

  const npcTraits    = buildNPCTraits(npcId, db);
  const questContext = buildQuestContext(npcId, questId);
  const authored     = getAuthoredNPC(npcId) !== null;

  // Repair-brain pre-flight on the seed text we're about to feed the LLM.
  // We check the backstory + speech_patterns since those are the strings most
  // likely to have been authored or user-supplied. NPC `secret` is intentionally
  // excluded from the prompt entirely; we only vet what we send.
  try {
    const rb = await import("./repair-brain.js");
    const seedText = [
      npcTraits?.role,
      npcTraits?.backstory,
      npcTraits?.personality_traits?.join?.(", "),
      npcTraits?.speech_patterns,
    ].filter(Boolean).join(" \n ").slice(0, 3000);
    if (seedText) {
      const vet = await rb.vetNPCDialogue(seedText, npcTraits);
      if (vet?.score !== null && vet?.score < rb.REPAIR_DEFAULT_FLOOR.dialogue) {
        logger.warn({ npcId, score: vet.score, flags: vet.flags },
                    "narrative_bridge_dialogue_blocked_by_repair");
        return {
          ok: false,
          error: "repair_brain_blocked",
          repair: vet,
          authored,
        };
      }
    }
  } catch { /* repair brain unavailable — fail open */ }

  const result = await writeDialogueTree(npcTraits, questContext, playerRelationship);

  if (result.ok) {
    // H2 — the LLM path is the IMPROVISED fallback, not canon. Label it so the
    // client can badge improvised lines distinctly from hand-authored trees
    // (which carry handAuthored:true above). Authored trees always win when
    // one exists; this only fires when no tree is on disk for the context.
    const enriched = { ...result, authored, handAuthored: false, improvised: true };
    cacheSet(_dialogueCache, cacheKey, enriched);
    return enriched;
  }

  logger.warn({ npcId, questId, error: result.error }, "narrative_bridge_dialogue_failed");
  return { ...result, authored, handAuthored: false, improvised: true };
}

/**
 * Generate a quest chain for an authored NPC, enriched with faction state and narrative stakes.
 * Falls back to procedural generation for non-authored NPCs.
 *
 * @param {string} npcId
 * @param {number} playerLevel
 * @returns {Promise<{ ok: boolean, questChain?: object, authored: boolean, error?: string }>}
 */
export async function generateArcQuestChain(npcId, playerLevel = 1, db = null) {
  const factionState = buildFactionState(npcId, db);
  // Quest chain caches separately per policy so a referendum forks the chain.
  const policyKey = factionState.policyTimestamp ?? "0";
  const cacheKey = `${npcId}:${playerLevel}:p${policyKey}`;
  const cached = cacheGet(_questCache, cacheKey, QUEST_TTL_MS);
  if (cached) return { ...cached, cached: true };

  const authored     = getAuthoredNPC(npcId) !== null;

  // For authored NPCs, enrich the factionState with the NPC's narrative context
  if (authored) {
    const npc = getAuthoredNPC(npcId);
    factionState.npcBackstory  = npc.backstory ?? "";
    factionState.npcCurrentGoal = npc.narrative_context?.current_goal ?? "";
  }

  const result = await generateQuestChain(npcId, factionState, playerLevel);

  if (result.ok) {
    const enriched = { ...result, authored };
    cacheSet(_questCache, cacheKey, enriched);
    return enriched;
  }

  logger.warn({ npcId, playerLevel, error: result.error }, "narrative_bridge_quest_chain_failed");
  return { ...result, authored };
}

/**
 * Synthesize world lore, seeding the history engine with authored events first.
 * The authored lore events (Founding Compact, Purge, etc.) flow into synthesizeLore
 * as the world event history, giving the LLM rich authored context to write from.
 *
 * @param {string} worldId
 * @returns {Promise<{ ok: boolean, lore?: object, error?: string }>}
 */
export async function synthesizeArcLore(worldId = "concordia-hub") {
  const cached = cacheGet(_loreCache, worldId, LORE_TTL_MS);
  if (cached) return { ...cached, cached: true };

  // Pull timeline including authored lore events (tagged "authored_lore")
  const timelineResult = getTimeline({ limit: 20, granularity: "major" });
  const worldEvents    = timelineResult?.events ?? [];

  const result = await synthesizeLore(worldEvents, []);

  if (result.ok) {
    cacheSet(_loreCache, worldId, result);
    logger.info({ worldId, eventCount: worldEvents.length }, "narrative_bridge_lore_synthesized");
    return result;
  }

  logger.warn({ worldId, error: result.error }, "narrative_bridge_lore_failed");
  return result;
}

/**
 * Invalidate cached dialogue for an NPC (call when player relationship changes).
 *
 * @param {string} npcId
 */
export function invalidateNPCDialogue(npcId) {
  for (const key of _dialogueCache.keys()) {
    if (key.startsWith(`${npcId}:`)) {
      _dialogueCache.delete(key);
    }
  }
}

/**
 * Expose cache stats for health monitoring.
 */
export function getBridgeStats() {
  return {
    dialogueCacheSize: _dialogueCache.size,
    questCacheSize:    _questCache.size,
    loreCacheSize:     _loreCache.size,
  };
}
