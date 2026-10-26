// NPC growth: XP and levels from real work, a trade skill that improves with
// use, and NPCs taking and finishing the quests other NPCs post.
//
// Before 2026-10-23 none of this ran: world_npcs.level was rolled 1-5 at spawn
// and never changed, npc_skills had 0 rows, npc_active_quests had 0 rows
// (the runner only read lattice_born_quests, which is empty, and nothing ever
// advanced an accepted quest), and the npc:level-up / npc:quest-accepted /
// npc:quest-completed events the Unity client listens for were never sent.
//
// Everything here is driven by what the NPC actually does in its tick: a
// gather action advances a gather step, a walk or a conversation advances a
// talk_to step. No timers stand in for work.

import crypto from "crypto";
import { isPeopleArchetype } from "./npc-kind.js";
import { hasAuthoredColumn } from "./quests/authored.js";

// The trade skill each archetype improves by working.
const TRADE_SKILL = {
  farmer: "farming", miller: "milling", logger: "woodcutting", miner: "mining",
  fisher: "fishing", hunter: "hunting", laborer: "labor", builder: "construction",
  blacksmith: "smithing", engineer: "engineering", trader: "trading", merchant: "trading",
  cook: "cooking", innkeeper: "hospitality", bard: "performance", scholar: "scholarship",
  healer: "healing", medic: "healing", mystic: "mysticism", mage: "arcana",
  cyber: "netrunning", elder: "lore", scientist: "research", warrior: "combat",
  guard: "watch", soldier: "combat", wanderer: "travel", citizen: "labor",
};
export function tradeSkillFor(archetype) {
  return TRADE_SKILL[archetype] || "labor";
}

// XP an action earns. Rest, idle and plain travel earn nothing.
const ACTION_XP = { gather_resource: 2, build_structure: 3, practice_skill: 3, trade: 2, create: 3, socialize: 1 };
export function actionXp(action) {
  return ACTION_XP[action] || 0;
}

/** Total XP needed to reach `level` (level 1 = 0). Quadratic: slow, steady. */
export function xpForNpcLevel(level) {
  const l = Math.max(1, Math.floor(level));
  return 40 * (l - 1) * l;
}

/** Level after earning XP. Never lowers a level (seeded NPCs start at 1-5 with 0 XP). */
export function levelAfterXp(level, xp, cap = 60) {
  let l = Math.max(1, Math.floor(level || 1));
  while (l < cap && xp >= xpForNpcLevel(l + 1)) l++;
  return l;
}

// ── NPC quests ───────────────────────────────────────────────────────────────
// Which objective each action moves forward.
const STEP_FOR_ACTION = {
  gather_resource: "gather",
  socialize: "talk_to",
  travel: "talk_to",
  trade: "talk_to",
};

// Who takes which kind of posted quest when no player has.
function canTake(archetype, firstStepType) {
  if (!isPeopleArchetype(archetype)) return false;
  if (firstStepType === "gather") return ["laborer", "farmer", "miner", "logger", "hunter", "fisher", "builder", "blacksmith", "wanderer"].includes(archetype);
  if (firstStepType === "talk_to") return true;
  return false; // "defeat" quests stay for players: NPC combat is a separate system
}

const _active = new Map(); // npcId -> { id, questId, worldId, giverId, steps, step, count }

/** Load NPC quests in progress (call once when a world simulator starts). */
export function loadActiveNpcQuests(db, worldId) {
  try {
    const rows = db.prepare(`
      SELECT a.id, a.npc_id, a.quest_id, a.current_step, a.payload_json, q.giver_npc_id, q.world_id
        FROM npc_active_quests a JOIN world_quests q ON q.id = a.quest_id
       WHERE a.status = 'active' AND q.world_id = ?
    `).all(worldId);
    for (const r of rows) {
      let p = {};
      try { p = JSON.parse(r.payload_json || "{}"); } catch { /* keep {} */ }
      if (!Array.isArray(p.steps) || p.steps.length === 0) continue;
      _active.set(r.npc_id, { id: r.id, questId: r.quest_id, worldId: r.world_id, giverId: r.giver_npc_id, steps: p.steps, step: r.current_step, count: p.count || 0 });
    }
    return rows.length;
  } catch {
    return 0;
  }
}

export function activeNpcQuest(npcId) {
  return _active.get(npcId) || null;
}

/**
 * NPCs take quests that have waited `takeAfterHours` with no player taker.
 * @param {object[]} agents  this world's NPC agents ({ id, archetype, level })
 * @returns {{npcId:string, questId:string}[]}
 */
export function npcTakeOpenQuests(db, worldId, agents, { now = Date.now(), takeAfterHours = 24, max = 5 } = {}) {
  const cutoff = Math.floor(now / 1000) - takeAfterHours * 3600;
  let open;
  try {
    open = db.prepare(`
      SELECT q.id, q.giver_npc_id
        FROM world_quests q
       WHERE q.world_id = ? AND q.status = 'available' AND q.created_at <= ?${hasAuthoredColumn(db) ? " AND q.authored = 0" : ""}
       ORDER BY q.created_at
       LIMIT ?
    `).all(worldId, cutoff, max * 4);
  } catch {
    return [];
  }
  const objStmt = db.prepare("SELECT type, target, required_count FROM quest_objectives WHERE quest_id = ? ORDER BY order_index");
  const busy = new Set(_active.keys());
  const taken = [];
  for (const q of open) {
    if (taken.length >= max) break;
    const steps = objStmt.all(q.id).map((o) => ({ type: o.type, target: o.target, requiredCount: o.required_count || 1 }));
    if (steps.length === 0) continue;
    const candidates = agents
      .filter((a) => a.id !== q.giver_npc_id && !busy.has(a.id) && !a.isConscious && canTake(a.archetype, steps[0].type))
      .sort((a, b) => (b.level || 1) - (a.level || 1) || String(a.id).localeCompare(String(b.id)));
    const taker = candidates[0];
    if (!taker) continue;
    const id = crypto.randomUUID();
    const ok = db.transaction(() => {
      const claimed = db.prepare(`UPDATE world_quests SET status = 'active', accepted_by = ? WHERE id = ? AND status = 'available'`).run(`npc:${taker.id}`, q.id).changes;
      if (!claimed) return false;
      db.prepare(`INSERT INTO npc_active_quests (id, npc_id, quest_id, current_step, status, origin_world_id, payload_json) VALUES (?, ?, ?, 0, 'active', ?, ?)`)
        .run(id, taker.id, q.id, worldId, JSON.stringify({ steps, count: 0 }));
      return true;
    })();
    if (!ok) continue;
    _active.set(taker.id, { id, questId: q.id, worldId, giverId: q.giver_npc_id, steps, step: 0, count: 0 });
    busy.add(taker.id);
    taken.push({ npcId: taker.id, questId: q.id });
  }
  return taken;
}

/**
 * Move an NPC's quest forward after it performed `action`.
 * @returns {null | {advanced:true, completed:boolean, questId:string, giverId:string, xp:number, need:string|null}}
 */
export function progressNpcQuest(db, npcId, action) {
  const aq = _active.get(npcId);
  if (!aq) return null;
  const step = aq.steps[aq.step];
  if (!step || STEP_FOR_ACTION[action] !== step.type) return null;
  aq.count += 1;
  if (aq.count >= (step.requiredCount || 1)) { aq.step += 1; aq.count = 0; }
  const completed = aq.step >= aq.steps.length;
  let xp = 0;
  try {
    if (completed) {
      const q = db.prepare("SELECT reward_json FROM world_quests WHERE id = ?").get(aq.questId);
      try { xp = Math.max(0, Number(JSON.parse(q?.reward_json || "{}").xp) || 0); } catch { xp = 0; }
      db.transaction(() => {
        db.prepare(`UPDATE npc_active_quests SET status = 'completed', current_step = ? WHERE id = ?`).run(aq.step, aq.id);
        db.prepare(`UPDATE world_quests SET status = 'completed', completed_at = unixepoch() WHERE id = ? AND status = 'active'`).run(aq.questId);
      })();
      _active.delete(npcId);
    } else {
      db.prepare(`UPDATE npc_active_quests SET current_step = ?, payload_json = ? WHERE id = ?`)
        .run(aq.step, JSON.stringify({ steps: aq.steps, count: aq.count }), aq.id);
    }
  } catch {
    return null;
  }
  const first = aq.steps[0]?.type;
  const need = first === "gather" ? "purpose" : first === "talk_to" ? "social" : first === "defeat" ? "safety" : null;
  return { advanced: true, completed, questId: aq.questId, giverId: aq.giverId, xp, need };
}

/** Test hook. */
export function _resetNpcLifeForTest() {
  _active.clear();
}
