/**
 * Content Seeder — Plants the authored world skeleton at startup.
 *
 * Reads JSON from content/ and seeds:
 *   - Lore events into the history engine timeline
 *   - Authored NPCs into the in-memory NPC registry (narrative_context attached)
 *   - Authored quests into the quest engine
 *
 * Idempotent: tracks seeded state in module-level flag. Call seedContent() once
 * after server init. Subsequent calls are no-ops.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import logger from "../logger.js";
import { createQuest } from "../emergent/quest-engine.js";
import { recordEvent, EVENT_TYPES } from "../emergent/history-engine.js";
import { registerWorldMeta } from "./cross-world-effectiveness.js";
import { seedAnchorsFromWorldMeta } from "./concord-link.js";
import { seedWalkersFromAuthored } from "./concord-link-walkers.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = join(__dir, "../../content");

/**
 * Find any sub-world content directories under content/world/. Each
 * subdirectory may contain its own factions.json + npcs.json + lore.json
 * for a distinct themed world (superhero, noir, cyberpunk, etc.). The
 * top-level content/world/{factions,npcs,lore}.json files belong to the
 * main Concordia walled-city setting.
 *
 * Returns an array of { id, path } where id is the subdirectory name and
 * path is the relative path to use with readJSON.
 */
function discoverSubWorlds() {
  const out = [];
  try {
    const worldDir = join(CONTENT_ROOT, "world");
    for (const entry of readdirSync(worldDir)) {
      // Skip underscore-prefixed entries (convention for shared / private dirs).
      if (entry.startsWith("_")) continue;
      const full = join(worldDir, entry);
      try {
        if (statSync(full).isDirectory()) out.push({ id: entry, path: `world/${entry}` });
      } catch { /* skip inaccessible entries */ }
    }
  } catch (err) {
    logger.warn({ err: err.message }, "content_seeder_world_scan_failed");
  }
  return out;
}

// Module-level seeded flag — prevents double-seeding on hot reload
let _seeded = false;

// In-memory registries populated by seeder, read by narrative-bridge
export const _authoredNPCs       = new Map();   // npcId → npc object
export const _authoredFactions   = new Map();   // factionId → faction object
export const _authoredQuests     = new Map();   // questId → { raw, engineId }
export const _authoredDialogues  = new Map();   // "npcId:questId:phase" → tree

// ── File Readers ─────────────────────────────────────────────────────────────

function readJSON(relPath) {
  const abs = join(CONTENT_ROOT, relPath);
  try {
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    // Quietly return null when the file simply doesn't exist — every
    // callsite is opt-in (factions.json / lore.json / dialogue trees are
    // optional per world). Only loud-warn on parse errors.
    if (err && err.code !== "ENOENT") {
      logger.warn({ err: err.message, relPath }, "content_seeder_read_failed");
    }
    return null;
  }
}

// ── Schema Validators ────────────────────────────────────────────────────────
//
// Plain runtime guards (no Zod dependency to keep startup lean). Each
// validator returns { ok: boolean, reason?: string }. Seeders skip
// invalid records with a structured warn rather than crashing — a single
// malformed JSON file should not stop every authored character / faction
// from loading.
//
// Exported so tests can exercise them directly with deliberately-malformed
// fixtures.

export function validateFaction(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, reason: "not_object" };
  if (typeof obj.id !== "string" || !obj.id) return { ok: false, reason: "missing_id" };
  if (typeof obj.name !== "string" || !obj.name) return { ok: false, reason: "missing_name" };
  // Sprint D / V1 — visual is optional but if present must include hex colours.
  if (obj.visual !== undefined) {
    const v = obj.visual;
    if (typeof v !== "object" || Array.isArray(v)) return { ok: false, reason: "invalid_visual_shape" };
    for (const k of ["primary_color", "secondary_color", "accent_color"]) {
      if (typeof v[k] !== "string" || !/^#[0-9a-fA-F]{6}$/.test(v[k])) {
        return { ok: false, reason: `invalid_visual_${k}` };
      }
    }
  }
  return { ok: true };
}

export function validateNpc(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, reason: "not_object" };
  if (typeof obj.id !== "string" || !obj.id) return { ok: false, reason: "missing_id" };
  if (typeof obj.name !== "string" || !obj.name) return { ok: false, reason: "missing_name" };
  if (obj.faction_id !== undefined && obj.faction_id !== null && typeof obj.faction_id !== "string") {
    return { ok: false, reason: "invalid_faction_id" };
  }
  if (obj.narrative_context !== undefined && (typeof obj.narrative_context !== "object" || Array.isArray(obj.narrative_context))) {
    return { ok: false, reason: "invalid_narrative_context" };
  }
  return { ok: true };
}

export function validateQuest(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, reason: "not_object" };
  if (typeof obj.id !== "string" || !obj.id) return { ok: false, reason: "missing_id" };
  if (typeof obj.title !== "string" || !obj.title) return { ok: false, reason: "missing_title" };
  if (obj.objectives !== undefined) {
    if (!Array.isArray(obj.objectives)) return { ok: false, reason: "objectives_not_array" };
    for (const o of obj.objectives) {
      if (typeof o?.id !== "string" || !o.id)   return { ok: false, reason: "objective_missing_id" };
      if (typeof o?.type !== "string" || !o.type) return { ok: false, reason: "objective_missing_type" };
    }
  }
  return { ok: true };
}

export function validateLoreEvent(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, reason: "not_object" };
  if (typeof obj.id !== "string" || !obj.id) return { ok: false, reason: "missing_id" };
  if (typeof obj.title !== "string" || !obj.title) return { ok: false, reason: "missing_title" };
  return { ok: true };
}

// ── Faction Seeding ──────────────────────────────────────────────────────────

function seedFactions(factions) {
  let count = 0;
  for (const faction of factions) {
    const v = validateFaction(faction);
    if (!v.ok) {
      logger.warn({ reason: v.reason, faction }, "content_seeder_faction_invalid_skipped");
      continue;
    }
    _authoredFactions.set(faction.id, faction);
    count++;
  }
  return count;
}

// ── NPC Seeding ──────────────────────────────────────────────────────────────

/**
 * Deterministic position from sha1(npc.id). Keeps the same NPC in the
 * same place across server restarts so the player can find them.
 */
function _deterministicPos(npcId, bounds = { minX: -400, maxX: 400, minZ: -400, maxZ: 400 }) {
  // Inline FNV-1a-ish double hash for stable coords without pulling
  // node:crypto (content-seeder is mixed-context ESM). Same id → same
  // coords across server restarts.
  let h1 = 2166136261, h2 = 4127613007;
  for (let i = 0; i < npcId.length; i++) {
    h1 = ((h1 ^ npcId.charCodeAt(i)) * 16777619) >>> 0;
    h2 = ((h2 ^ npcId.charCodeAt(i)) * 2246822507) >>> 0;
  }
  const u1 = h1 / 0xffffffff;
  const u2 = h2 / 0xffffffff;
  return {
    x: bounds.minX + u1 * (bounds.maxX - bounds.minX),
    z: bounds.minZ + u2 * (bounds.maxZ - bounds.minZ),
  };
}

/**
 * Insert (or update) one authored NPC row into world_npcs. Idempotent
 * on (id). Pulls archetype + faction + world_id from the authored
 * record; positions deterministically from sha-style hash. Failure is
 * logged but never throws — content-seeder is best-effort.
 */
function _persistAuthoredNpcToWorld(db, npc, defaultWorldId) {
  if (!db || !npc?.id) return false;
  const worldId = npc.world_id || defaultWorldId || "concordia-hub";
  const pos = (npc.spawn_location && typeof npc.spawn_location === "object")
    ? { x: Number(npc.spawn_location.x) || 0, z: Number(npc.spawn_location.z) || 0 }
    : _deterministicPos(npc.id);
  const archetype = npc.archetype || npc.role || "civilian";
  const factionId = npc.faction_id || npc.faction || null;
  const isImmortal = npc.is_immortal === true || npc.is_immortal === 1 ? 1 : 0;
  const isConscious = npc.is_conscious === false ? 0 : 1;
  const universeType = npc.universe_type || null;
  const npcType = npc.npc_type || (npc.role ? "role" : "generic");
  const spawnLoc = JSON.stringify({ x: pos.x, y: 0, z: pos.z });
  // Persist authored identity into world_npcs.state so npcNameFromRow() returns
  // the real name (not the archetype fallback) — this is what the relationship
  // name-index (seedAuthoredRelationships) + dialogue resolve against. On
  // conflict we json_patch so a re-seed refreshes name/title without clobbering
  // runtime state keys (intent_rung, combat_state mirror, etc.).
  const stateSeed = {};
  if (npc.name) stateSeed.name = String(npc.name);
  if (npc.title) stateSeed.title = String(npc.title);
  const stateJson = JSON.stringify(stateSeed);

  try {
    db.prepare(`
      INSERT INTO world_npcs (
        id, world_id, npc_type, archetype, faction, universe_type,
        spawn_location, current_location, state, x, y, z,
        is_dead, is_immortal, is_conscious, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        world_id      = excluded.world_id,
        archetype     = excluded.archetype,
        faction       = excluded.faction,
        universe_type = excluded.universe_type,
        state         = json_patch(COALESCE(world_npcs.state, '{}'), excluded.state),
        is_immortal   = excluded.is_immortal,
        is_conscious  = excluded.is_conscious,
        x             = COALESCE(world_npcs.x, excluded.x),
        z             = COALESCE(world_npcs.z, excluded.z)
    `).run(
      // bind params matching the ? above. Column order:
      // id, world_id, npc_type, archetype, faction, universe_type,
      // spawn_location, current_location, state, x, z, is_immortal, is_conscious
      // (y, is_dead, created_at are inlined as 0/0/unixepoch()).
      npc.id, worldId, npcType, archetype, factionId, universeType,
      spawnLoc, spawnLoc, stateJson, pos.x, pos.z,
      isImmortal, isConscious,
    );
    return true;
  } catch (err) {
    try { logger.warn({ npcId: npc.id, err: err?.message }, "content_seeder_world_npc_write_failed"); }
    catch { /* noop */ }
    return false;
  }
}

function seedNPCs(npcs, opts = {}) {
  const db = opts.db || null;
  const defaultWorldId = opts.defaultWorldId || null;
  let count = 0;
  let worldNpcs = 0;
  for (const npc of npcs) {
    const v = validateNpc(npc);
    if (!v.ok) {
      logger.warn({ reason: v.reason, npcId: npc?.id }, "content_seeder_npc_invalid_skipped");
      continue;
    }
    _authoredNPCs.set(npc.id, npc);
    // Persist the NPC into world_npcs so the player can actually find
    // them in the world — the in-memory registry alone makes them
    // invisible to /:worldId/npcs queries and the rendering pipeline.
    if (db && _persistAuthoredNpcToWorld(db, npc, defaultWorldId)) worldNpcs++;
    // Apply authored per-NPC schedule overrides via npc-schedules.
    // Surface failures: a hand-authored schedule that doesn't load means
    // the NPC silently falls back to the procedural archetype default,
    // which contradicts the authored-skeleton + LLM-muscle design.
    if (npc.schedule && typeof npc.schedule === "object") {
      // Lazy import — npc-schedules is ESM, top-level import would fight
      // content-seeder's mixed cjs/esm context.
      import("./npc-schedules.js")
        .then(m => m.setNPCSchedule(npc.id, npc.schedule))
        .catch(err => {
          if (typeof console !== "undefined") console.warn("[content-seeder] schedule apply failed", { npcId: npc.id, err: err?.message });
        });
    }
    count++;
  }
  if (db) {
    try { logger.info?.("content_seeder", "world_npcs_persisted", { count, worldNpcs, defaultWorldId }); }
    catch { /* noop */ }
  }
  return count;
}

// ── Lore Seeding ─────────────────────────────────────────────────────────────

function seedLore(loreData) {
  const events = loreData?.history ?? [];
  let count = 0;

  for (const event of events) {
    const v = validateLoreEvent(event);
    if (!v.ok) {
      logger.warn({ reason: v.reason, eventId: event?.id }, "content_seeder_lore_invalid_skipped");
      continue;
    }
    try {
      recordEvent(EVENT_TYPES.CUSTOM, {
        title:       event.title,
        description: event.description,
        type:        event.type,
        significance: event.significance,
        tags:        [
          "authored_lore",
          event.id,
          ...(event.factions_involved ?? []),
        ],
        actor:       "concordia_history",
        metadata:    {
          era:           event.era,
          hidden_truth:  event.hidden_truth ?? null,
          known_by:      event.known_by ?? [],
        },
      });
      count++;
    } catch (err) {
      logger.warn({ err: err.message, eventId: event.id }, "content_seeder_lore_event_failed");
    }
  }

  return count;
}

// ── Codex Seeding (cross-world worldbuilding → citable DTUs) ──────────────────

/**
 * Seed a cross-world codex (e.g. content/codex/eight-refusals.json) as citable
 * DTUs so the worldbuilding surfaces in lore/atlas lenses and grounds oracle
 * dialogue. Idempotent via INSERT OR IGNORE on a deterministic id (mirrors the
 * Phase Z2 trivia-answer-DTU mint). Each refusal is tagged with its world_id
 * (best-effort — column added by migration 225) so a world's lens can pull its
 * own entry. Returns the number of DTUs newly minted.
 */
export function seedCodex(db, codex, { slug = "codex" } = {}) {
  if (!db || !codex) return 0;
  let count = 0;

  const mint = (id, kind, title, summary, worldId) => {
    if (!id || !title) return;
    try {
      const r = db.prepare(`
        INSERT OR IGNORE INTO dtus (id, type, title, data, created_at, creator_id, visibility)
        VALUES (?, ?, ?, ?, unixepoch(), 'system', 'public')
      `).run(id, kind, title, JSON.stringify({ human_summary: summary || "", scope: "global" }));
      if (r.changes > 0) {
        count++;
        if (worldId) {
          // world_id added by migration 225; minimal builds simply skip the tag.
          try { db.prepare(`UPDATE dtus SET world_id = ? WHERE id = ?`).run(worldId, id); } catch { /* no world_id column */ }
        }
      }
    } catch (err) {
      try { logger.debug?.("content_seeder", "codex_mint_failed", { id, err: err?.message }); } catch { /* ignore */ }
    }
  };

  // Top-level codex entry.
  mint(`${slug}_index`, "codex", codex.codex_name || "Codex", codex.codex_description || "", null);

  // One DTU per refusal, tagged to its world.
  for (const r of (codex.refusals ?? [])) {
    if (!r?.id) continue;
    const summary = [r.the_no, r.incarnation, r.the_cost, r.thread].filter(Boolean).join("\n\n");
    mint(`${slug}_${r.id}`, "codex", r.name || r.id, summary, r.world_id || null);
  }

  // The ninth (the hub itself), if present.
  if (codex.the_ninth) {
    const n = codex.the_ninth;
    const summary = [n.the_no, n.explanation].filter(Boolean).join("\n\n");
    mint(`${slug}_the_ninth`, "codex", n.name || "The Ninth Refusal", summary, n.world_id || "concordia-hub");
  }

  return count;
}

// ── Grounding Packs (job b) ────────────────────────────────────────────────────
// Author-once domain knowledge for thin-but-shallow lenses. Each entry mints a
// kind='<domain>' DTU stamped with its owning lens_id (so the DTU→lens routing
// reaches it immediately) — real reasoning fuel that grounds the lens instead of
// leaving it to search a flat pool. Idempotent (INSERT OR IGNORE on a stable id).
function discoverGroundingPacks() {
  const out = [];
  try {
    const dir = join(CONTENT_ROOT, "grounding");
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".json")) out.push(`grounding/${f}`);
    }
  } catch { /* no grounding dir — fine */ }
  return out;
}

export function seedGroundingPack(db, pack) {
  if (!db || !pack || !Array.isArray(pack.entries)) return 0;
  let count = 0;
  const ins = db.prepare(`
    INSERT OR IGNORE INTO dtus (id, type, title, data, lens_id, created_at, creator_id, visibility)
    VALUES (?, ?, ?, ?, ?, unixepoch(), 'system', 'public')
  `);
  for (const e of pack.entries) {
    if (!e?.id || !e?.title) continue;
    const data = JSON.stringify({
      human_summary: e.summary || "",
      tags: Array.isArray(e.tags) ? e.tags : [],
      scope: "global",
      grounding_pack: pack.pack || null,
    });
    try {
      const r = ins.run(e.id, e.kind || "knowledge", e.title, data, e.lens || "knowledge");
      if (r.changes > 0) count++;
    } catch (err) {
      try { logger.debug?.("content_seeder", "grounding_mint_failed", { id: e.id, err: err?.message }); } catch { /* ignore */ }
    }
  }
  return count;
}

// ── Quest Seeding ─────────────────────────────────────────────────────────────

function buildQuestSteps(objectives = []) {
  return objectives.map(obj => ({
    id:    obj.id,
    title: obj.description,
    type:  mapObjectiveTypeToStepType(obj.type),
    content: {
      dtuIds:          [],
      prompt:          obj.description,
      hint:            "",
      successCriteria: `Complete: ${obj.description}`,
    },
    rewards:   { knowledgeUnlock: [], badge: "" },
    dependsOn: [],
    meta:      { objective_type: obj.type, target: obj.target, required_count: obj.required_count },
  }));
}

function mapObjectiveTypeToStepType(objType) {
  switch (objType) {
    case "reach_location": return "discover";
    case "gather":         return "challenge";
    case "deliver":        return "challenge";
    case "talk_to":        return "learn";
    case "kill":           return "challenge";
    default:               return "learn";
  }
}

function buildBreadcrumbs(breadcrumbs = []) {
  if (!breadcrumbs.length) return undefined;
  return {
    enabled:         true,
    releaseSchedule: "on_completion",
    pendingInsights: breadcrumbs.map(bc => ({
      id:           bc.id,
      content:      bc.content,
      unlocksAfter: bc.unlocks_after ?? null,
      dtuReward:    null,
    })),
  };
}

/**
 * Upsert a row into the `worlds` table from a meta.json. Idempotent —
 * uses INSERT OR IGNORE so previously-seeded worlds (e.g. from
 * world-seed.js) keep their existing universe_type / description. The
 * goal is to make `worlds.universe_type` queryable for canon worlds the
 * fauna-spawner / cross-world-effectiveness rely on.
 */
function upsertWorldRow(db, meta) {
  if (!meta?.world_id || !meta?.universe_type) return;
  const id = meta.world_id;
  const name = meta.world_name || meta.world_id;
  const universeType = meta.universe_type;
  const description = meta.description || "";
  // Persist per-world modulators from meta (the columns existed but were never
  // written). A `fiction` flag (e.g. "satire") rides inside rule_modulators so
  // the frontend can read it from the world row to show the in-world frame banner
  // and so provenance travels with the world.
  const physics = JSON.stringify(meta.physics_modulators || {});
  const rule = JSON.stringify({
    ...(meta.rule_modulators || {}),
    ...(meta.fiction ? { fiction: String(meta.fiction) } : {}),
  });
  db.prepare(`
    INSERT INTO worlds (id, name, universe_type, description, physics_modulators, rule_modulators)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      physics_modulators = excluded.physics_modulators,
      rule_modulators    = excluded.rule_modulators
  `).run(id, name, universeType, description, physics, rule);
}

function seedQuestFile(quests) {
  let count = 0;

  for (const quest of quests) {
    const v = validateQuest(quest);
    if (!v.ok) {
      logger.warn({ reason: v.reason, questId: quest?.id }, "content_seeder_quest_invalid_skipped");
      continue;
    }
    try {
      const steps       = buildQuestSteps(quest.objectives ?? []);
      const breadcrumbs = buildBreadcrumbs(quest.breadcrumbs ?? []);

      const result = createQuest(quest.title, {
        description:   quest.description,
        difficulty:    quest.difficulty ?? "intermediate",
        domain:        quest.domain ?? "concordia_main",
        estimatedTime: quest.estimated_time ?? null,
        steps,
        breadcrumbs,
        prerequisites: quest.prerequisites ?? [],
        followUp:      quest.follow_up_quest_ids ?? [],
        tags:          quest.tags ?? [],
        // Quest-level rewards block forwarded to the engine so the
        // completion handler can grant gold + named items + skill xp.
        rewards:       quest.rewards ?? {},
        authoredId:    quest.id,
      });

      if (result.ok) {
        _authoredQuests.set(quest.id, {
          raw:      quest,
          engineId: result.quest.id,
          npcId:    quest.giver_npc_id,
        });
        count++;
      } else {
        logger.warn({ questId: quest.id, error: result.error }, "content_seeder_quest_failed");
      }
    } catch (err) {
      logger.warn({ err: err.message, questId: quest.id }, "content_seeder_quest_exception");
    }
  }

  return count;
}

// ── Main Entry ───────────────────────────────────────────────────────────────

/**
 * Seed all authored content into the world. Idempotent — second call is a no-op.
 *
 * @returns {{ ok: boolean, counts?: object, error?: string }}
 */
export async function seedContent({ db = null } = {}) {
  // Operational skip: when CONCORD_SKIP_SEED=1, skip the (idempotent) boot
  // re-seed entirely. Useful for fast restarts on an already-seeded DB where
  // the heavy synchronous seed pass would otherwise block startup.
  if (process.env.CONCORD_SKIP_SEED === "1") {
    return { ok: true, skipped: true, reason: "CONCORD_SKIP_SEED" };
  }
  if (_seeded) {
    return { ok: true, counts: null, cached: true };
  }

  const results = { factions: 0, npcs: 0, lore: 0, quests: 0 };

  // Factions
  const factions = readJSON("world/factions.json");
  if (Array.isArray(factions)) {
    results.factions = seedFactions(factions);
  }

  // NPCs — content/world/npcs.json is the hub-scoped roster. Pass db so
  // each authored NPC also lands in world_npcs (the actual game-world
  // table the rendering pipeline reads from). Without db they stay in
  // the in-memory _authoredNPCs registry only.
  const npcs = readJSON("world/npcs.json");
  if (Array.isArray(npcs)) {
    results.npcs = seedNPCs(npcs, { db, defaultWorldId: "concordia-hub" });
    // Living Society Phase 1.5b — ingest authored relationships[] into
    // npc_relationships once the hub NPCs exist (name-resolved within the world).
    if (db) {
      try {
        const { seedAuthoredRelationships } = await import("./npc-family.js");
        results.relationships = (results.relationships || 0) + (seedAuthoredRelationships(db, "concordia-hub", npcs).seeded || 0);
      } catch { /* relationships best-effort */ }
      // Give the named hub characters a shallow skill lineage so their authored
      // recipes have ancestry to inherit/teach. Bounded + idempotent + kill-switched
      // (CONCORD_NAMED_LINEAGE=0 to skip); deterministic unless skill-evolution LLM is on.
      if (process.env.CONCORD_NAMED_LINEAGE !== "0") {
        try {
          const { seedNamedCharacterLineage } = await import("./npc-skill-author.js");
          const ids = db.prepare(`SELECT id FROM world_npcs WHERE world_id = ? LIMIT 12`).all("concordia-hub");
          let lineageSeeded = 0;
          for (const { id } of ids) {
            const r = seedNamedCharacterLineage(db, id, 2);
            if (r && r.seeded) lineageSeeded += r.seeded;
          }
          results.lineage = lineageSeeded;
        } catch { /* lineage best-effort */ }
      }
    }
  }

  // Lore events
  const lore = readJSON("world/lore.json");
  if (lore) {
    results.lore = seedLore(lore);
  }

  // World meta for Concordia (the hub) — stored at content/world/_meta.json
  // because Concordia's content lives at the top level.
  const concordiaMeta = readJSON("world/_meta.json");
  if (concordiaMeta?.world_id) {
    registerWorldMeta(concordiaMeta);
    results.worlds = (results.worlds || 0) + 1;
    try { if (db) results.anchors = (results.anchors || 0) + seedAnchorsFromWorldMeta(db, concordiaMeta); }
    catch { /* anchor seeding best-effort */ }
    try { if (db) upsertWorldRow(db, concordiaMeta); }
    catch { /* world row upsert best-effort */ }
  }

  // Sub-worlds — each subdirectory under content/world/ may carry its own
  // meta.json + factions.json + npcs.json + lore.json. Each entry should
  // already be tagged with `world_id` so emergent systems can scope by world.
  for (const sub of discoverSubWorlds()) {
    const meta = readJSON(`${sub.path}/meta.json`);
    if (meta?.world_id) {
      registerWorldMeta(meta);
      results.worlds = (results.worlds || 0) + 1;
      try { if (db) results.anchors = (results.anchors || 0) + seedAnchorsFromWorldMeta(db, meta); }
      catch { /* anchor seeding best-effort */ }
      try { if (db) upsertWorldRow(db, meta); }
      catch { /* world row upsert best-effort */ }
    }
    const subFactions = readJSON(`${sub.path}/factions.json`);
    if (Array.isArray(subFactions)) results.factions += seedFactions(subFactions);
    // factions-extra.json is the opt-in append slot for faction density bumps,
    // mirroring npcs-extra.json — so the rich primary factions.json isn't spliced.
    const subFactionsExtra = readJSON(`${sub.path}/factions-extra.json`);
    if (Array.isArray(subFactionsExtra)) results.factions += seedFactions(subFactionsExtra);
    const subNpcs = readJSON(`${sub.path}/npcs.json`);
    if (Array.isArray(subNpcs)) results.npcs += seedNPCs(subNpcs, { db, defaultWorldId: sub.id });
    // Phase E2 — npcs-extra.json is an opt-in append slot for density bumps,
    // so we don't have to splice into the rich primary file.
    const subNpcsExtra = readJSON(`${sub.path}/npcs-extra.json`);
    if (Array.isArray(subNpcsExtra)) results.npcs += seedNPCs(subNpcsExtra, { db, defaultWorldId: sub.id });
    // Living Society Phase 1.5b — ingest this sub-world's authored relationships
    // once its NPCs are persisted.
    if (db && (Array.isArray(subNpcs) || Array.isArray(subNpcsExtra))) {
      try {
        const { seedAuthoredRelationships } = await import("./npc-family.js");
        const authoredHere = [...(subNpcs || []), ...(subNpcsExtra || [])];
        results.relationships = (results.relationships || 0) + (seedAuthoredRelationships(db, sub.id, authoredHere).seeded || 0);
      } catch { /* relationships best-effort */ }
    }
    const subLore = readJSON(`${sub.path}/lore.json`);
    if (subLore) results.lore += seedLore(subLore);
    // Content pillar 1 — authored lore zones (safe plaza / pvp arena / hazard
    // ruins) → world_zones, so combatRuleFor consults them. Reuses upsertZone
    // (idempotent on (world_id, name)). Runs after default zones below too;
    // named authored zones coexist with the default spawn sanctuary.
    const subZones = readJSON(`${sub.path}/zones.json`);
    if (Array.isArray(subZones) && db) {
      try {
        const { seedZonesFromContent } = await import("./world-zones.js");
        results.worldZonesAuthored = (results.worldZonesAuthored || 0) + seedZonesFromContent(db, sub.id, subZones);
      } catch { /* zone seeding best-effort */ }
    }
  }

  // Phase F1.2 — boot-time asymmetric-traits seeding.
  // npc-asymmetry.js#seedNPCAsymmetry was previously called lazily on first
  // interaction. Walking every authored NPC at boot means grudges /
  // preoccupations / desires are populated before the player ever talks
  // to anyone. Idempotent at the row level — re-running is safe.
  if (db) {
    try {
      const { seedNPCAsymmetry } = await import("./npc-asymmetry.js");
      const authored = [..._authoredNPCs.values()];
      let asymPatched = 0;
      for (const npc of authored) {
        try {
          const r = await seedNPCAsymmetry(db, npc);
          if (r?.ok && r?.reason !== "already_seeded") asymPatched++;
        } catch { /* per-NPC best-effort */ }
      }
      results.npcAsymmetrySeeded = asymPatched;
    } catch (err) {
      logger.warn("content_seeder", "asymmetry_seed_skipped", { err: err?.message });
    }

    // T2.1 — weaponise_at consumption. Parse each authored NPC's
    // narrative_context.weaponise_at into a structured, once-firing trigger so
    // the authored payoff ("Befriend Kit; the pact surfaces") actually fires
    // when the player satisfies it. Idempotent on signature.
    try {
      const { seedAllWeaponiseTriggers } = await import("./embodied/weaponise-triggers.js");
      const authored = [..._authoredNPCs.values()];
      results.weaponiseTriggersSeeded = seedAllWeaponiseTriggers(db, authored);
    } catch (err) {
      logger.warn("content_seeder", "weaponise_seed_skipped", { err: err?.message });
    }

    // T3.3 — seed default world zones (hub sanctuary that agrees with the
    // hardcoded Concordant Law + a spawn sanctuary per authored world).
    try {
      const { seedDefaultZones } = await import("./world-zones.js");
      const worldIds = [...new Set([..._authoredNPCs.values()].map((n) => n.world_id).filter(Boolean))];
      if (!worldIds.includes("concordia-hub")) worldIds.push("concordia-hub");
      results.worldZonesSeeded = seedDefaultZones(db, worldIds);
    } catch (err) {
      logger.warn("content_seeder", "world_zones_seed_skipped", { err: err?.message });
    }

    // NPC purpose — the cold-start guarantee: build a coherent settlement
    // (homes + the workplaces its residents' jobs need) and give every settled
    // NPC a matched workplace + home + realm citizenship (or an explorer's roam
    // purpose). Reconcile pass per world; idempotent. Kill-switch
    // CONCORD_NPC_PURPOSE=0. Catches authored NPCs at boot; procgen + migrated
    // NPCs are picked up by the npc-routine-cycle reconcile (and on migration).
    try {
      const { assignPurposesForWorld, PURPOSE_ENABLED } = await import("./npc/purpose.js");
      if (PURPOSE_ENABLED()) {
        const worldIds = [...new Set([..._authoredNPCs.values()].map((n) => n.world_id).filter(Boolean))];
        if (!worldIds.includes("concordia-hub")) worldIds.push("concordia-hub");
        let assigned = 0;
        for (const wid of worldIds) {
          try { assigned += assignPurposesForWorld(db, wid).assigned || 0; } catch { /* per-world best-effort */ }
        }
        results.npcPurposesAssigned = assigned;
      }
    } catch (err) {
      logger.warn("content_seeder", "npc_purpose_seed_skipped", { err: err?.message });
    }
  }

  // Onboarding quest chain
  const onboarding = readJSON("quests/onboarding.json");
  if (Array.isArray(onboarding)) {
    results.quests += seedQuestFile(onboarding);
  }

  // Main narrative arc
  const mainArc = readJSON("quests/main-arc.json");
  if (Array.isArray(mainArc)) {
    results.quests += seedQuestFile(mainArc);
  }

  // Faction quests
  const factionQuests = readJSON("quests/faction-quests.json");
  if (Array.isArray(factionQuests)) {
    results.quests += seedQuestFile(factionQuests);
  }

  // Hand-authored side quests — each is its own file under content/quests/
  // and may have a paired authored dialogue tree under content/dialogues/.
  for (const sideFile of [
    "quests/kael-torchlight.json",
    "quests/first-day-arc.json",
    "quests/the-handshake-revelation.json",
    // Phase E6 — Phase D substrate-connecting quest chains.
    "quests/southern-arc-mystery.json",
    "quests/impossible-print.json",
    "quests/brackish-trust.json",
    "quests/nesha-old-seam.json",
    "quests/sealed-record.json",
    // Phase E8 — Phase D onboarding extension chained from first_cycle_commune.
    "quests/first_cycle_phase_d.json",
  ]) {
    const side = readJSON(sideFile);
    if (Array.isArray(side)) results.quests += seedQuestFile(side);
  }

  // Phase F2.1 — sub-world quest chains. Walk content/quests/sub-worlds/<world>/
  // and load every .json file as a chain. New worlds + new chains drop in
  // without editing the seeder.
  try {
    const subWorldDir = join(CONTENT_ROOT, "quests", "sub-worlds");
    for (const worldName of readdirSync(subWorldDir)) {
      const worldPath = join(subWorldDir, worldName);
      let isDir = false;
      try { isDir = statSync(worldPath).isDirectory(); } catch { /* skip */ }
      if (!isDir) continue;
      for (const fname of readdirSync(worldPath)) {
        if (!fname.endsWith(".json")) continue;
        const chain = readJSON(`quests/sub-worlds/${worldName}/${fname}`);
        if (Array.isArray(chain)) results.quests += seedQuestFile(chain);
      }
    }
  } catch { /* no sub-worlds dir — fine */ }

  // H1 — per-world authored quest chains. Some worlds (e.g. tunya) keep their
  // quest chains under content/world/<world>/quests/ alongside their npcs/
  // factions/lore rather than under content/quests/sub-worlds/. Walk those too
  // so authored-but-unloaded chains (tunya's 4 were stranded here) reach the
  // engine. seedQuestFile is idempotent on authoredId, so a chain that somehow
  // appears in both trees is seeded once.
  try {
    const worldRoot = join(CONTENT_ROOT, "world");
    for (const worldName of readdirSync(worldRoot)) {
      if (worldName.startsWith("_")) continue; // _shared, _meta
      const questsDir = join(worldRoot, worldName, "quests");
      let isDir = false;
      try { isDir = statSync(questsDir).isDirectory(); } catch { /* no quests dir */ }
      if (!isDir) continue;
      for (const fname of readdirSync(questsDir)) {
        if (!fname.endsWith(".json")) continue;
        const chain = readJSON(`world/${worldName}/quests/${fname}`);
        if (Array.isArray(chain)) results.quests += seedQuestFile(chain);
      }
    }
  } catch { /* no world quests — fine */ }

  // Authored dialogue trees — keyed by `npcId:questId:phase`. The narrative
  // bridge looks these up and short-circuits the LLM dialogue path when a
  // hand-authored tree exists for the requested context.
  results.dialogues = 0;
  try {
    const dialogueDir = join(CONTENT_ROOT, "dialogues");
    for (const entry of readdirSync(dialogueDir)) {
      if (!entry.endsWith(".json")) continue;
      const tree = readJSON(`dialogues/${entry}`);
      if (tree && typeof tree === "object" && !Array.isArray(tree)) {
        for (const [key, val] of Object.entries(tree)) {
          if (val && typeof val === "object") {
            _authoredDialogues.set(key, val);
            results.dialogues++;
          }
        }
      }
    }
  } catch { /* no dialogues directory — fine */ }

  // Walkers — promote any authored NPC with link_walker:true into the
  // concord_link_walkers table so the runtime can dispatch them. Idempotent.
  if (db) {
    try {
      const walkers = [..._authoredNPCs.values()].filter(n => n?.link_walker);
      if (walkers.length > 0) {
        const r = seedWalkersFromAuthored(db, walkers);
        results.walkers = r.inserted;
      }
    } catch (err) {
      logger.warn({ err: err.message }, "content_seeder_walkers_failed");
    }
  }

  // Sprint C / Track A3 — secrets seeding (idempotent).
  if (db) {
    try {
      const { seedFromAuthored: seedSecrets } = await import("./secrets.js");
      const r = await seedSecrets(db);
      if (r?.ok) results.secrets = r.inserted || 0;
    } catch (err) {
      logger.warn({ err: err.message }, "content_seeder_secrets_failed");
    }
  }

  // Sprint C / Track D1 — kingdoms seeding (idempotent). Reads
  // factions + their territory and creates a kingdom row per leader.
  if (db) {
    try {
      const { seedKingdomsFromFactions } = await import("./kingdoms.js");
      const factions = Array.from(_authoredFactions.values());
      const r = seedKingdomsFromFactions(db, factions);
      if (r?.ok) results.kingdoms = r.inserted || 0;
    } catch (err) {
      logger.warn({ err: err.message }, "content_seeder_kingdoms_failed");
    }
  }

  // T1.1 — faction strategy state seeding (idempotent). The Layer-11
  // faction-strategy cycle only advances faction_strategy_state rows that
  // already exist; nothing seeded them, so the EVE-style autonomy layer
  // booted dark (zero rows -> zero moves -> no wars ever). Seed a strategy
  // row + initial relations (from authored rival_factions/allied_factions)
  // for every authored faction so the cycle has something to advance.
  if (db) {
    try {
      const { seedFactionStrategyState } = await import("./embodied/faction-strategy.js");
      const factions = Array.from(_authoredFactions.values());
      const r = seedFactionStrategyState(db, factions);
      if (r?.ok) {
        results.factionStrategySeeded = r.seeded || 0;
        results.factionRelationsSeeded = r.relations || 0;
      }
    } catch (err) {
      logger.warn({ err: err.message }, "content_seeder_faction_strategy_failed");
    }

    // T3.2 — derive NPC↔NPC scheme edges from authored faction rivalries so
    // CK3 plots fire along the authored lines (no invented relationships).
    // Runs after NPCs are seeded so the live-NPC existence check passes.
    try {
      const { seedRivalryOpinionEdges } = await import("./faction-rivalry-schemes.js");
      const factions = Array.from(_authoredFactions.values());
      const r = seedRivalryOpinionEdges(db, factions);
      results.rivalrySchemeEdges = r?.edges || 0;
    } catch (err) {
      logger.warn({ err: err.message }, "content_seeder_rivalry_edges_failed");
    }

    // Sprint 1 — wire the built-but-unwired cross-world relationship seeder:
    // authored NPCs with a `concord_link_resonance` ref become cross-world
    // correspondents (feeds the cross-world relationship graph). Zero non-test
    // callers before this.
    try {
      const { seedRelationshipsFromAuthored } = await import("./cross-world-relationships.js");
      const npcRows = Array.from(_authoredNPCs.values())
        .filter((n) => n?.id && n?.world_id && n?.concord_link_resonance);
      if (npcRows.length) {
        const r = seedRelationshipsFromAuthored(db, npcRows);
        results.crossWorldRelationships = r?.created || 0;
      }
    } catch (err) {
      logger.warn({ err: err.message }, "content_seeder_cross_world_rel_failed");
    }
  }

  // T3.2 — cross-world codex seeding (idempotent). Mints the Eight Refusals
  // codex as citable DTUs so the worldbuilding surfaces in lore/atlas lenses
  // and grounds oracle dialogue, per-world-tagged. New content kind; harmless
  // (zero rows) on builds that don't ship the codex file.
  if (db) {
    try {
      const codex = readJSON("codex/eight-refusals.json");
      if (codex) results.codexSeeded = seedCodex(db, codex, { slug: "codex_eight_refusals" });
    } catch (err) {
      logger.warn({ err: err.message }, "content_seeder_codex_failed");
    }
  }

  // Phase Z2 — wire boot-time seeders for the 5 substrates that were
  // empty at launch (hacking puzzles, code puzzles, trivia questions,
  // glyph components, karaoke songs). Each is idempotent (gated by row
  // count or PK).
  if (db) {
    try {
      const { seedDefaultGlyphLibrary } = await import("./glyph-spells.js");
      const r = seedDefaultGlyphLibrary(db);
      results.glyphComponents = r?.seeded ?? r?.inserted ?? 0;
    } catch (err) {
      logger.warn("content_seeder", "glyph_seed_failed", { err: err?.message });
    }

    // Living Society P0 — seed the canonical resource_properties baseline so
    // DB-backed property lookups + the craft-resolve quality gradient have a
    // floor on a fresh install (idempotent upsert; guarded when mig 278 absent).
    try {
      const { seedResourceProperties } = await import("./resources.js");
      const r = seedResourceProperties(db);
      results.resourceProperties = r?.seeded ?? 0;
    } catch (err) {
      logger.warn("content_seeder", "resource_props_seed_failed", { err: err?.message });
    }

    // Living Society P0.5 — seed authored material profiles (effect tags +
    // props per drop kind) so cooking/crafting reads inheritable effects.
    try {
      const { seedMaterialProfiles } = await import("./ecosystem/material-profiles.js");
      const r = seedMaterialProfiles(db);
      results.materialProfiles = r?.seeded ?? 0;
    } catch (err) {
      logger.warn("content_seeder", "material_profiles_seed_failed", { err: err?.message });
    }

    try {
      const hpJson = readJSON("hacking-puzzles.json");
      if (Array.isArray(hpJson) && hpJson.length > 0) {
        const { authorPuzzle: authorHack } = await import("./hacking.js");
        let inserted = 0;
        // @sql-loop-ok: idempotent boot-time seed over a small authored puzzle set.
        for (const p of hpJson) {
          try {
            const existing = db.prepare(`SELECT id FROM hacking_puzzles WHERE name = ?`).get(p.name);
            if (existing) continue;
            const r = authorHack(db, p);
            if (r?.ok) inserted++;
          } catch { /* per-puzzle best-effort */ }
        }
        results.hackingPuzzles = inserted;
      }
    } catch (err) {
      logger.warn("content_seeder", "hacking_seed_failed", { err: err?.message });
    }

    try {
      const cpJson = readJSON("code-puzzles.json");
      if (Array.isArray(cpJson) && cpJson.length > 0) {
        const { authorPuzzle: authorCp } = await import("./programming-puzzle.js");
        let inserted = 0;
        for (const p of cpJson) {
          try {
            const existing = db.prepare(`SELECT id FROM programming_puzzles WHERE name = ?`).get(p.name);
            if (existing) continue;
            const r = authorCp(db, p);
            if (r?.ok) inserted++;
          } catch { /* per-puzzle best-effort */ }
        }
        results.codePuzzles = inserted;
      }
    } catch (err) {
      logger.warn("content_seeder", "code_seed_failed", { err: err?.message });
    }

    try {
      const tqJson = readJSON("trivia-questions.json");
      if (Array.isArray(tqJson) && tqJson.length > 0) {
        const { authorQuestion } = await import("./trivia.js");
        // Author DTUs for the answers first so the citation flow works.
        let inserted = 0;
        for (const q of tqJson) {
          try {
            const existing = db.prepare(`SELECT id FROM trivia_questions WHERE question_text = ?`).get(q.questionText);
            if (existing) continue;
            // Mint a lightweight answer-DTU.
            const dtuId = `trivia_answer_${q.id}`;
            try {
              db.prepare(`
                INSERT OR IGNORE INTO dtus (id, type, title, data, created_at, creator_id, visibility)
                VALUES (?, 'trivia_answer', ?, ?, unixepoch(), 'system', 'public')
              `).run(dtuId, `Trivia: ${q.questionText.slice(0, 60)}`, JSON.stringify({ human_summary: q.answerHumanSummary || "", scope: "global" }));
            } catch { /* DTU table shape may differ — best-effort */ }
            const r = authorQuestion(db, {
              dtuId,
              questionText: q.questionText,
              answerDtuId: dtuId,
              difficulty: q.difficulty || 1,
              createdBy: "system",
            });
            if (r?.ok) inserted++;
          } catch { /* per-question best-effort */ }
        }
        results.triviaQuestions = inserted;
      }
    } catch (err) {
      logger.warn("content_seeder", "trivia_seed_failed", { err: err?.message });
    }

    // Phase E3 — hidden-object scenes.
    try {
      const hoJson = readJSON("hidden-object-scenes.json");
      if (Array.isArray(hoJson) && hoJson.length > 0) {
        const { createScene: createHoScene } = await import("./hidden-object.js");
        let inserted = 0;
        for (const s of hoJson) {
          try {
            // Idempotent by sceneId — the lib uses random ids but we want
            // stable ones for authored content. Check first.
            const existing = db.prepare(`SELECT id FROM hidden_object_scenes WHERE id = ?`).get(s.sceneId);
            if (existing) continue;
            // The lib's createScene generates a fresh id; we insert
            // directly with the authored sceneId so the image-route URL
            // is stable.
            db.prepare(`
              INSERT INTO hidden_object_scenes
                (id, scene_dtu_id, host_user_id, title, target_objects_json)
              VALUES (?, ?, ?, ?, ?)
            `).run(s.sceneId, `authored:${s.sceneId}`, "system", s.title || "Untitled scene", JSON.stringify(s.targets || []));
            inserted++;
          } catch { /* per-scene best-effort */ }
        }
        results.hiddenObjectScenes = inserted;
      }
    } catch (err) {
      logger.warn("content_seeder", "hidden_object_seed_failed", { err: err?.message });
    }
  }

  // #S1 — dangling faction-reference audit. Every authored NPC that names a
  // faction (faction_id | faction) should point at a faction we actually seeded;
  // a typo or a deleted faction leaves the NPC orphaned (no faction-strategy
  // momentum, wrong narrative-bridge context). This is a SOFT warning — orphans
  // are seeded anyway (an NPC with a bad faction ref is still a valid NPC), but
  // the count + samples surface in the boot log so the content gap is visible.
  try {
    const dangling = reportDanglingFactionRefs();
    if (dangling.count > 0) {
      logger.warn("content_seeder", "dangling_faction_refs", {
        count: dangling.count,
        samples: dangling.samples.slice(0, 10),
        knownFactions: _authoredFactions.size,
      });
    }
    results.danglingFactionRefs = dangling.count;
  } catch (err) {
    logger.warn("content_seeder", "dangling_faction_audit_failed", { err: err?.message });
  }

  // Grounding packs (job b) — author-once domain knowledge for thin lenses.
  if (db) {
    for (const rel of discoverGroundingPacks()) {
      try {
        const pack = readJSON(rel);
        if (pack) { const n = seedGroundingPack(db, pack); results.grounding = (results.grounding || 0) + n; }
      } catch (err) { logger.warn("content_seeder", "grounding_pack_failed", { rel, err: err?.message }); }
    }
    if (results.grounding) logger.info("content_seeder", "grounding_packs_seeded", { count: results.grounding });
  }

  // DTU→lens routing: stamp lens_id on any DTU still 'unknown' (seeds + prior
  // gameplay rows) so each lens pulls its own grounding instead of the flat pool.
  // Idempotent + kill-switched (CONCORD_DTU_ROUTING=0 → no-op).
  if (db) {
    try {
      const { backfillLensIds } = await import("./dtu-lens-routing.js");
      const r = backfillLensIds(db);
      results.dtuLensStamped = r.stamped || 0;
      logger.info("content_seeder", "dtu_lens_routing_backfill", { scanned: r.scanned, stamped: r.stamped, byLens: r.byLens });
    } catch (err) { logger.warn("content_seeder", "dtu_lens_routing_failed", { err: err?.message }); }
  }

  _seeded = true;

  logger.info(
    "content_seeder",
    "content_seeded",
    { factions: results.factions, npcs: results.npcs, lore: results.lore, quests: results.quests, walkers: results.walkers || 0, dialogues: results.dialogues || 0, glyphComponents: results.glyphComponents || 0, hackingPuzzles: results.hackingPuzzles || 0, codePuzzles: results.codePuzzles || 0, triviaQuestions: results.triviaQuestions || 0, hiddenObjectScenes: results.hiddenObjectScenes || 0 }
  );

  return { ok: true, counts: results };
}

// ── Registry Accessors ────────────────────────────────────────────────────────

/**
 * Register a user-authored NPC at runtime.
 *
 * The platform ships ~24 authored NPCs at startup; this is the surface
 * that lets the community add more without restarting the server.
 *
 * Returns { ok, reason? } — the same shape as validateNpc.
 *
 * Importantly: narrative_context.secret stays server-side only. The
 * narrative-bridge omits secrets when it builds LLM prompts, and any
 * caller that later passes a secret-bearing context to an oracle
 * brain is treated as a bug. The composer surfaces this invariant in
 * the UI as a warning so authors don't put gameplay-sensitive info
 * into "secret" expecting it to drive dialogue — secrets are for
 * branch conditions and human authors only.
 */
export function addAuthoredNPC(npc) {
  const v = validateNpc(npc);
  if (!v.ok) return v;
  _authoredNPCs.set(npc.id, npc);
  if (npc.schedule && typeof npc.schedule === "object") {
    import("./npc-schedules.js")
      .then(m => m.setNPCSchedule(npc.id, npc.schedule))
      .catch(err => {
        if (typeof console !== "undefined") {
          console.warn("[content-seeder] schedule apply failed", { npcId: npc.id, err: err?.message });
        }
      });
  }
  return { ok: true };
}

/** Look up an authored NPC by id. Returns null if not found or not yet seeded. */
export function getAuthoredNPC(npcId) {
  return _authoredNPCs.get(npcId) ?? null;
}

/** Look up an authored faction by id. Returns null if not found or not yet seeded. */
export function getAuthoredFaction(factionId) {
  return _authoredFactions.get(factionId) ?? null;
}

/** Return all authored quests for a given NPC giver id. */
export function getQuestsForNPC(npcId) {
  const result = [];
  for (const entry of _authoredQuests.values()) {
    if (entry.npcId === npcId) result.push(entry);
  }
  return result;
}

/**
 * Look up a hand-authored dialogue tree.
 * Tries the most-specific key first then falls back to less-specific:
 *   1. `${npcId}:${questId}:${phase}`
 *   2. `${npcId}:${questId}` (no phase)
 *   3. `${npcId}:idle` (no quest)
 * Returns null when no authored tree exists for the requested context.
 */
export function getAuthoredDialogue(npcId, questId = null, phase = null) {
  if (!npcId) return null;
  if (questId && phase) {
    const a = _authoredDialogues.get(`${npcId}:${questId}:${phase}`);
    if (a) return a;
  }
  if (questId) {
    const b = _authoredDialogues.get(`${npcId}:${questId}`);
    if (b) return b;
  }
  // Idle fallback. Authored trees are keyed `npcId:questId:phase` (3-part, e.g.
  // `coalition_enforcer:idle:default`), so a bare 2-part `npcId:idle` lookup
  // never matched the real keys — the idle path was effectively dead. Try the
  // canonical 3-part idle key, then the legacy 2-part, then any `npcId:idle:*`.
  return (
    _authoredDialogues.get(`${npcId}:idle:default`) ??
    _authoredDialogues.get(`${npcId}:idle`) ??
    _firstIdleTree(npcId) ??
    null
  );
}

/** First authored tree whose key starts `${npcId}:idle` (any phase). */
function _firstIdleTree(npcId) {
  const prefix = `${npcId}:idle`;
  for (const [key, val] of _authoredDialogues) {
    if (key.startsWith(prefix)) return val;
  }
  return null;
}

/** Return all authored NPCs in a given faction. */
export function getNPCsForFaction(factionId) {
  const result = [];
  for (const npc of _authoredNPCs.values()) {
    if (npc.faction_id === factionId) result.push(npc);
  }
  return result;
}

/** Sprint C / A3 — return every authored NPC. Used by the secrets seeder. */
export function getAllAuthoredNPCs() {
  return Array.from(_authoredNPCs.values());
}

/** Sprint C / D1 — return every authored faction. */
export function getAllAuthoredFactions() {
  return Array.from(_authoredFactions.values());
}

/**
 * #S1 — audit authored NPCs for faction references that don't resolve to a
 * seeded faction. Pure read over the in-memory registries (call after seeding).
 * Returns { count, samples:[{ npcId, name, faction }] } — a soft report, never a
 * throw, so callers can log-and-continue. `faction` of null/absent is not dangling
 * (a factionless NPC is legitimate); only a NON-empty ref to an unknown id counts.
 */
export function reportDanglingFactionRefs() {
  const samples = [];
  let count = 0;
  // Resolve against both ids and names — most worlds key NPC.faction_id to
  // faction.id, but a name-based ref in another world is still legitimately wired.
  const known = new Set();
  for (const f of _authoredFactions.values()) {
    if (f?.id) known.add(f.id);
    if (f?.name) known.add(f.name);
  }
  for (const npc of _authoredNPCs.values()) {
    const ref = npc?.faction_id || npc?.faction || null;
    if (!ref) continue;
    if (!known.has(ref)) {
      count++;
      if (samples.length < 50) samples.push({ npcId: npc.id, name: npc.name, faction: ref });
    }
  }
  return { count, samples };
}
