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
export const _authoredNPCs     = new Map();   // npcId → npc object
export const _authoredFactions = new Map();   // factionId → faction object
export const _authoredQuests   = new Map();   // questId → { raw, engineId }

// ── File Readers ─────────────────────────────────────────────────────────────

function readJSON(relPath) {
  try {
    const abs = join(CONTENT_ROOT, relPath);
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    logger.warn({ err: err.message, relPath }, "content_seeder_read_failed");
    return null;
  }
}

// ── Faction Seeding ──────────────────────────────────────────────────────────

function seedFactions(factions) {
  let count = 0;
  for (const faction of factions) {
    _authoredFactions.set(faction.id, faction);
    count++;
  }
  return count;
}

// ── NPC Seeding ──────────────────────────────────────────────────────────────

function seedNPCs(npcs) {
  let count = 0;
  for (const npc of npcs) {
    _authoredNPCs.set(npc.id, npc);
    count++;
  }
  return count;
}

// ── Lore Seeding ─────────────────────────────────────────────────────────────

function seedLore(loreData) {
  const events = loreData?.history ?? [];
  let count = 0;

  for (const event of events) {
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

function seedQuestFile(quests) {
  let count = 0;

  for (const quest of quests) {
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
export function seedContent() {
  if (_seeded) {
    return { ok: true, counts: null, cached: true };
  }

  const results = { factions: 0, npcs: 0, lore: 0, quests: 0 };

  // Factions
  const factions = readJSON("world/factions.json");
  if (Array.isArray(factions)) {
    results.factions = seedFactions(factions);
  }

  // NPCs
  const npcs = readJSON("world/npcs.json");
  if (Array.isArray(npcs)) {
    results.npcs = seedNPCs(npcs);
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
  }

  // Sub-worlds — each subdirectory under content/world/ may carry its own
  // meta.json + factions.json + npcs.json + lore.json. Each entry should
  // already be tagged with `world_id` so emergent systems can scope by world.
  for (const sub of discoverSubWorlds()) {
    const meta = readJSON(`${sub.path}/meta.json`);
    if (meta?.world_id) {
      registerWorldMeta(meta);
      results.worlds = (results.worlds || 0) + 1;
    }
    const subFactions = readJSON(`${sub.path}/factions.json`);
    if (Array.isArray(subFactions)) results.factions += seedFactions(subFactions);
    const subNpcs = readJSON(`${sub.path}/npcs.json`);
    if (Array.isArray(subNpcs)) results.npcs += seedNPCs(subNpcs);
    const subLore = readJSON(`${sub.path}/lore.json`);
    if (subLore) results.lore += seedLore(subLore);
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

  _seeded = true;

  logger.info(
    { factions: results.factions, npcs: results.npcs, lore: results.lore, quests: results.quests },
    "content_seeded"
  );

  return { ok: true, counts: results };
}

// ── Registry Accessors ────────────────────────────────────────────────────────

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

/** Return all authored NPCs in a given faction. */
export function getNPCsForFaction(factionId) {
  const result = [];
  for (const npc of _authoredNPCs.values()) {
    if (npc.faction_id === factionId) result.push(npc);
  }
  return result;
}
