// server/lib/quest-emergence.js
// NPC needs that a player can help with become quests.
//
// Rebuilt 2026-10-23. The old version posted a new LLM-written quest every
// time an NPC's need dipped, with no limit; the LLM call always timed out, so
// every quest was the template "Help <archetype> with social" (live: 53,962
// open, ~180 distinct titles, none ever accepted), and 1 in 5 spawned a new
// NPC named after the last word of the title (9,813 identical "social"
// traders). A quest is now a plan built from real world state:
//
//   - only named people give quests (no creatures, monsters or clones), one
//     open quest per giver, a cap per world, and only in worlds a player has
//     been in recently;
//   - every objective is one the game tracks (talk_to / gather / defeat), and
//     every target exists: a real friend NPC, a resource with nodes in this
//     world, a hostile archetype alive in this world;
//   - the text comes from the giver's name, work and authored backstory;
//   - unaccepted quests expire.

import crypto from "crypto";
import { addQuestObjectives, addQuestRewards } from "./quests/quest-engine.js";
import { isPeopleArchetype, isHostileArchetype } from "./npc-kind.js";

const URGENCY_THRESHOLD = 0.5;

// Needs a player can genuinely help with, in the order they are considered.
const PLAYER_DEPENDENT_NEEDS = ["safety", "purpose", "social"];

const num = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
export const QUEST_LIMITS = {
  openPerWorld: num("CONCORD_QUEST_OPEN_PER_WORLD", 40),
  playerWindowHours: num("CONCORD_QUEST_PLAYER_WINDOW_H", 72),
  ttlHours: num("CONCORD_QUEST_TTL_H", 72),
};

// Resources each kind of worker asks for, most wanted first. The first one
// that actually has nodes in the giver's world is used.
const ARCHETYPE_RESOURCES = {
  blacksmith: ["iron-ore", "copper-ore", "coal", "titanium-ore", "scrap-metal"],
  builder: ["stone", "wood", "pine-wood", "clay", "rubble", "dead-wood"],
  laborer: ["stone", "wood", "clay", "rubble"],
  miner: ["iron-ore", "copper-ore", "coal", "titanium-ore"],
  logger: ["wood", "pine-wood", "enchanted-wood", "dead-wood"],
  farmer: ["herbs", "clay", "wood", "mutant-herb"],
  miller: ["herbs", "wood", "stone"],
  healer: ["herbs", "rare-herb", "moonbloom", "mutant-herb", "bioenhancer"],
  cook: ["herbs", "wood", "coal"],
  scholar: ["runestone", "ley-essence", "rare-herb", "plasma-cell"],
  mystic: ["ley-essence", "moonbloom", "runestone", "rare-herb"],
  cyber: ["plasma-cell", "titanium-scrap", "scrap-metal", "fuel-canister"],
  trader: ["iron-ore", "herbs", "wood", "scrap-metal"],
};

function parse(v, fallback) {
  if (v == null || v === "") return fallback;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

function stableIndex(key, n) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return n > 0 ? (h >>> 0) % n : 0;
}

/** First sentence of an authored backstory, trimmed for a quest blurb. */
function backstoryLine(narrative) {
  const b = String(parse(narrative, {})?.backstory || "").trim();
  if (!b) return "";
  const first = b.split(/(?<=[.!?])\s+/)[0] || b;
  return first.length > 180 ? `${first.slice(0, 177).trimEnd()}...` : first;
}

function realName(row) {
  const name = String(parse(row?.state, {})?.name || "").trim();
  if (!name || name === row.archetype || name === "social" || name === row.npc_type) return null;
  return name;
}

function loadGiver(db, npcId) {
  return db.prepare(`
    SELECT id, world_id, archetype, npc_type, faction, level, state, narrative_context, spawn_method
      FROM world_npcs WHERE id = ? AND COALESCE(is_dead, 0) = 0
  `).get(npcId) || null;
}

function playerRecentlyIn(db, worldId) {
  try {
    return !!db.prepare(`
      SELECT 1 FROM player_world_state
       WHERE world_id = ? AND last_seen_at >= datetime('now', ?)
       LIMIT 1
    `).get(worldId, `-${QUEST_LIMITS.playerWindowHours} hours`);
  } catch {
    return false;
  }
}

let _lastExpireAt = 0;
/** Unaccepted quests past their TTL become 'expired'. Returns rows changed. */
export function expireStaleQuests(db, { now = Date.now(), force = false } = {}) {
  if (!force && now - _lastExpireAt < 10 * 60_000) return 0;
  _lastExpireAt = now;
  try {
    const cutoff = Math.floor(now / 1000) - QUEST_LIMITS.ttlHours * 3600;
    return db.prepare(`UPDATE world_quests SET status = 'expired' WHERE status = 'available' AND created_at < ?`).run(cutoff).changes;
  } catch {
    return 0;
  }
}

/**
 * Should this NPC post a quest now? Returns a reason string when not.
 * @returns {null|string}
 */
export function questGate(db, giver) {
  if (!giver) return "no_giver";
  if (!isPeopleArchetype(giver.archetype)) return "not_a_person";
  if (giver.spawn_method === "quest") return "quest_spawned_npc";
  if (!realName(giver)) return "unnamed";
  const open = db.prepare(`
    SELECT 1 FROM world_quests WHERE giver_npc_id = ? AND status IN ('available', 'active') LIMIT 1
  `).get(giver.id);
  if (open) return "already_has_open_quest";
  if (!playerRecentlyIn(db, giver.world_id)) return "no_recent_player";
  const { n } = db.prepare(`SELECT count(*) AS n FROM world_quests WHERE world_id = ? AND status = 'available'`).get(giver.world_id);
  if (n >= QUEST_LIMITS.openPerWorld) return "world_quest_board_full";
  return null;
}

function pickFriend(db, giver) {
  const rows = db.prepare(`
    SELECT id, archetype, npc_type, faction, state FROM world_npcs
     WHERE world_id = ? AND id <> ? AND COALESCE(is_dead, 0) = 0
       AND spawn_method IN ('world_seed', 'recruited')
     ORDER BY (faction = ?) DESC, id
     LIMIT 60
  `).all(giver.world_id, giver.id, giver.faction || "");
  const people = rows.filter((r) => isPeopleArchetype(r.archetype) && realName(r));
  if (people.length === 0) return null;
  const sameFaction = people.filter((r) => r.faction && r.faction === giver.faction);
  const pool = sameFaction.length ? sameFaction : people;
  return pool[stableIndex(`${giver.id}:${new Date().toISOString().slice(0, 10)}`, pool.length)];
}

function pickResource(db, giver) {
  const have = db.prepare(`
    SELECT resource_id, count(*) AS n FROM world_resource_nodes
     WHERE world_id = ? AND is_depleted = 0
     GROUP BY resource_id ORDER BY n DESC
  `).all(giver.world_id);
  if (have.length === 0) return null;
  const present = new Set(have.map((r) => r.resource_id));
  for (const r of ARCHETYPE_RESOURCES[giver.archetype] || []) if (present.has(r)) return r;
  return have[0].resource_id;
}

function pickHostile(db, giver) {
  const rows = db.prepare(`
    SELECT archetype, count(*) AS n FROM world_npcs
     WHERE world_id = ? AND COALESCE(is_dead, 0) = 0
     GROUP BY archetype ORDER BY n DESC
  `).all(giver.world_id);
  const hostile = rows.find((r) => isHostileArchetype(r.archetype));
  return hostile ? hostile.archetype : null;
}

const pretty = (s) => String(s || "").replace(/[_-]+/g, " ").trim();
const plural = (s) => (/(^|\s)undead$/.test(s) ? s : /(s|x|ch|sh)$/.test(s) ? `${s}es` : /[^aeiou]y$/.test(s) ? `${s.slice(0, -1)}ies` : `${s}s`);

/**
 * Build a quest for a need from real world state, or null when the world has
 * nothing that would make the quest true (no friend, no resource, no foe).
 * Pure with respect to the DB: reads only.
 */
export function planQuest(db, giver, need) {
  const name = realName(giver);
  if (!name) return null;
  const work = pretty(giver.npc_type && giver.npc_type !== "generic" ? giver.npc_type : giver.archetype);
  const story = backstoryLine(giver.narrative_context);
  const level = Math.max(1, Number(giver.level) || 1);
  const back = { type: "talk_to", target: giver.id, requiredCount: 1, description: `Return to ${name}` };
  let plan = null;

  if (need === "social") {
    const friend = pickFriend(db, giver);
    if (!friend) return null;
    const fname = realName(friend);
    const fwork = pretty(friend.archetype);
    plan = {
      kind: "carry_word",
      title: `Word for ${fname}`,
      description: `${name} the ${work} hasn't spoken with ${fname} the ${fwork} in too long and asks you to carry word, then come back with the answer.${story ? ` ${story}` : ""}`,
      objectives: [
        { type: "talk_to", target: friend.id, requiredCount: 1, description: `Speak with ${fname}` },
        back,
      ],
    };
  } else if (need === "purpose") {
    const resource = pickResource(db, giver);
    if (!resource) return null;
    const n = 3 + (level % 4);
    plan = {
      kind: "supply_run",
      title: `${pretty(resource).replace(/^./, (c) => c.toUpperCase())} for ${name}`,
      description: `${name} the ${work} is short of ${pretty(resource)} for the work and needs ${n} brought in.${story ? ` ${story}` : ""}`,
      objectives: [
        { type: "gather", target: resource, requiredCount: n, description: `Gather ${n} ${pretty(resource)}` },
        back,
      ],
    };
  } else if (need === "safety") {
    const foe = pickHostile(db, giver);
    if (!foe) return null;
    const n = 2 + (level % 3);
    plan = {
      kind: "clear_threat",
      title: `Trouble near ${name}`,
      description: `${name} the ${work} has seen ${plural(pretty(foe))} too close for comfort. Drive off ${n} of them.${story ? ` ${story}` : ""}`,
      objectives: [
        { type: "defeat", target: foe, requiredCount: n, description: `Defeat ${n} ${plural(pretty(foe))}` },
        back,
      ],
    };
  }
  if (!plan) return null;
  const xp = Math.min(150, 15 + 10 * plan.objectives.length + 3 * level + (plan.kind === "clear_threat" ? 20 : 0));
  plan.reward = { xp, items: [], narrative: `${name}'s thanks.` };
  return plan;
}

/**
 * Scan one NPC's needs and post at most one quest. Returns the created rows.
 * @param {object} npc  { id, worldId, needs, ... } — the DB row is the source of truth
 * @param {import('better-sqlite3').Database} db
 */
export async function detectQuestOpportunities(npc, db, _selectBrain) {
  if (!db || !npc?.id) return [];
  expireStaleQuests(db);
  // The NPC's most pressing player-facing need, not a fixed order (safety
  // first made every quest "Trouble near ...").
  const need = PLAYER_DEPENDENT_NEEDS
    .filter((n) => (npc.needs?.[n] ?? 1) < URGENCY_THRESHOLD)
    .sort((x, y) => (npc.needs[x] ?? 1) - (npc.needs[y] ?? 1))[0];
  if (!need) return [];
  const quest = await createQuestFromNeed(npc, need, db, _selectBrain);
  return quest ? [quest] : [];
}

/**
 * Post a quest for one need, if the gates pass and the world supports one.
 * @returns {Promise<object|null>} the world_quests row
 */
export async function createQuestFromNeed(npc, need, db, _selectBrain) {
  let giver;
  try { giver = loadGiver(db, npc.id); } catch { return null; }
  if (questGate(db, giver)) return null;
  const plan = planQuest(db, giver, need);
  if (!plan) return null;

  const id = crypto.randomUUID();
  const objectivesJson = plan.objectives.map((o) => ({ id: crypto.randomUUID(), description: o.description, completed: false, type: o.type, target: o.target, requiredCount: o.requiredCount }));
  db.prepare(`
    INSERT INTO world_quests (id, world_id, giver_npc_id, title, description, objectives_json, reward_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, giver.world_id, giver.id, plan.title, plan.description, JSON.stringify(objectivesJson), JSON.stringify(plan.reward));
  try {
    addQuestObjectives(db, id, plan.objectives);
    addQuestRewards(db, id, [{ rewardType: "xp", amount: plan.reward.xp }]);
  } catch { /* typed tables are best-effort; the world_quests row stands */ }
  return db.prepare("SELECT * FROM world_quests WHERE id = ?").get(id);
}

/**
 * Return available and active quests for a world.
 * @param {string} worldId
 * @param {string} status  'available' | 'active' | 'completed' | 'all'
 * @param {import('better-sqlite3').Database} db
 * @returns {object[]}
 */
export function getWorldQuests(worldId, status, db) {
  const q = status === "all"
    ? db.prepare("SELECT * FROM world_quests WHERE world_id = ? ORDER BY created_at DESC").all(worldId)
    : db.prepare("SELECT * FROM world_quests WHERE world_id = ? AND status = ? ORDER BY created_at DESC").all(worldId, status);

  return q.map(row => ({
    ...row,
    objectives: _tryParseJSON(row.objectives_json, []),
    reward:     _tryParseJSON(row.reward_json,     {}),
  }));
}

/**
 * Map an incoming event to objective progress and check completion.
 * @param {string} questId
 * @param {object} event  { objectiveId?, type, payload? }
 * @param {import('better-sqlite3').Database} db
 * @returns {{ updated: boolean, completed: boolean }}
 */
export function updateQuestProgress(questId, event, db) {
  const row = db.prepare("SELECT * FROM world_quests WHERE id = ?").get(questId);
  if (!row || row.status !== "active") return { updated: false, completed: false };

  const objectives = _tryParseJSON(row.objectives_json, []);
  let changed = false;

  if (event.objectiveId) {
    const obj = objectives.find(o => o.id === event.objectiveId);
    if (obj && !obj.completed) {
      obj.completed = true;
      changed = true;
    }
  }

  const allDone = objectives.every(o => o.completed);

  if (changed || allDone) {
    db.prepare(`
      UPDATE world_quests
      SET objectives_json = ?,
          status = ?,
          completed_at = CASE WHEN ? THEN unixepoch() ELSE completed_at END
      WHERE id = ?
    `).run(JSON.stringify(objectives), allDone ? "completed" : "active", allDone ? 1 : 0, questId);
  }

  return { updated: changed, completed: allDone };
}

function _tryParseJSON(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}
