// server/lib/npc-barks.js
//
// Wave G2 — NPC procedural barks. When the player walks within ~8m of
// an NPC, the bark cycle picks a topic + tone (asymmetry + appearance
// aware) and either pulls a deterministic templated line or routes
// through the subconscious brain (opt-in via CONCORD_NPC_BARKS_LLM=true).
//
// API:
//   composeBarkContext(db, npc, playerId)   → { appearance, asymmetry, memory, profile, tone }
//   pickBarkTopic(ctx, recentTopics)        → string
//   composeBarkLine(ctx, topic)             → { line, tone, topic }
//   composeBarkLineLLM(ctx, topic, brain)   → Promise<{ line, tone, topic, llm: true }> | null
//   recordBark(db, { npcId, playerId, topic, line })

import crypto from "crypto";
import logger from "../logger.js";

// Cooldown floor: never bark more than once per 90s for the same pair.
const BARK_COOLDOWN_S = 90;
const RECENT_TOPICS_KEEP = 5;

// Tone derived from asymmetry (opinion + grudge) — three buckets.
function deriveTone({ opinion, grudge }) {
  if (grudge && grudge.severity != null && grudge.severity >= 6) return "hostile";
  if (typeof opinion === "number") {
    if (opinion >= 25) return "friendly";
    if (opinion <= -25) return "wary";
  }
  return "neutral";
}

function _seed(npcId, playerId, salt = "") {
  return crypto.createHash("sha1").update(`${npcId}|${playerId}|${salt}`).digest();
}

function _pick(seedStr, salt, list) {
  if (!list || list.length === 0) return null;
  const h = crypto.createHash("sha1").update(`${seedStr}|${salt}`).digest();
  return list[h.readUInt32BE(0) % list.length];
}

// ── Templated bark catalog ───────────────────────────────────────
//
// Keyed by topic; each topic has tone-keyed lines. Catalog is short
// enough to read; lines per topic are 6–10 so the seeded RNG can
// resample once per 30-min bucket without immediate repeats.

const BARK_TEMPLATES = Object.freeze({
  greeting: {
    friendly: [
      "Good to see ye on yer feet.",
      "Welcome back, traveler.",
      "Glad you came round.",
      "Always good t'see a familiar face.",
      "Eh — there you are.",
      "Took you long enough.",
    ],
    neutral: [
      "Hm. Passin' through?",
      "Watch yer step.",
      "Mornin'.",
      "Eyes open out there.",
      "Don't be a stranger.",
      "Mind yer business.",
    ],
    wary: [
      "Move along.",
      "What're you wantin'?",
      "I'm watchin' you.",
      "Don't try anythin'.",
      "Keep yer distance.",
      "I know yer kind.",
    ],
    hostile: [
      "You've some nerve showin' yer face.",
      "Walk past quick or I swing first.",
      "I haven't forgotten.",
      "Don't think I won't.",
      "One more step.",
      "Not today, blood.",
    ],
  },
  bloody: {
    friendly: [
      "Gods — you're soaked in red. Sit down a moment.",
      "That's a lot of blood. Hope it isn't yours.",
      "You alright? Looks like ye saw a fight.",
    ],
    neutral: [
      "Got some blood on ye.",
      "Looks like a rough morning.",
      "Whose blood is that?",
    ],
    wary: [
      "Don't track that in here.",
      "Blood-stained and back in town. Convenient.",
      "Whose throat did ye cut?",
    ],
    hostile: [
      "You bring death like a calling card.",
      "Reek of slaughter, you do.",
    ],
  },
  soaked: {
    friendly: [
      "Bless the rain — come in by the fire.",
      "Yer soaked through. Tea's on.",
      "Caught in the storm? Inside, quick.",
    ],
    neutral: [
      "Caught the rain, eh?",
      "Dry off before ye catch fever.",
      "Bit damp out there.",
    ],
    wary: ["Standin' out in the rain like a fool."],
    hostile: ["Drown then for all I care."],
  },
  glowing: {
    friendly: [
      "That glow — show me the working.",
      "By the gates, what magic is that?",
      "Yer aura's beautiful. Trained where?",
    ],
    neutral: [
      "Glyphwork's still on ye.",
      "Bit of magic clingin' to yer skin.",
      "Yer aura's leakin'.",
    ],
    wary: [
      "Keep yer magic to yerself.",
      "Don't bring that glow near me.",
      "We don't truck with sorcery here.",
    ],
    hostile: [
      "Witch! Get out!",
      "I'll burn that magic out of ye.",
    ],
  },
  wealthy: {
    friendly: [
      "Spendin' well today?",
      "Coin in yer purse — wares for sale.",
      "Yer purse looks heavy. Drinks on you?",
    ],
    neutral: [
      "Lookin' flush.",
      "Heavy purse, careful step.",
      "Pockets jingle.",
    ],
    wary: [
      "Don't flash that coin here.",
      "Cutpurse'll have ye if yer not careful.",
    ],
    hostile: ["I'll take yer coin and yer teeth, both."],
  },
  armed: {
    friendly: [
      "Fine blade ye carry.",
      "Yer steel's well-kept.",
      "That weapon's seen real work.",
    ],
    neutral: [
      "Mind yer weapon in town.",
      "Sword stays sheathed here.",
      "Not lookin' for trouble, are ye?",
    ],
    wary: [
      "Keep that blade where I can see it.",
      "One twitch and I call the guard.",
    ],
    hostile: [
      "Draw it. Go on. Draw it.",
      "I've killed bigger than you with less.",
    ],
  },
  memory: {
    friendly: [
      "Been thinkin' on what we talked about.",
      "Still owe ye for last time.",
      "Yer last visit's not forgotten.",
    ],
    neutral: [
      "Long time, friend.",
      "Where ye been?",
      "Thought ye'd vanished.",
    ],
    wary: [
      "Yer back. Hm.",
      "I half-thought ye dead.",
    ],
    hostile: [
      "Should've stayed gone.",
      "I knew ye'd crawl back.",
    ],
  },
  routine: {
    // Topic that references the NPC's current routine activity.
    friendly: [
      "Just makin' the rounds.",
      "Mind if I work while we talk?",
      "Busy day. Pull up a stool.",
    ],
    neutral: [
      "Workin'.",
      "Got my hands full.",
      "Not now, busy.",
    ],
    wary: [
      "Move on, I'm workin'.",
      "Got no time for ye.",
    ],
    hostile: [
      "Get out from underfoot.",
      "Touch my work, lose a finger.",
    ],
  },
  parting: {
    friendly: [
      "Safe road.",
      "Watch yerself out there.",
      "Come back soon.",
    ],
    neutral: [
      "Mind yerself.",
      "Walk safe.",
    ],
    wary: [
      "Good. Keep walkin'.",
      "And stay gone.",
    ],
    hostile: [
      "Out. Now.",
      "Don't come back.",
    ],
  },
});

/**
 * Compose the context bundle the topic picker + line composer need.
 * Best-effort — every missing table is silently skipped.
 */
export function composeBarkContext(db, npc, playerId, opts = {}) {
  if (!db || !npc || !playerId) return null;
  const ctx = { npcId: npc.id, playerId, appearance: null, asymmetry: null, memory: null };
  // Player appearance (joins to inventory, signals, effects, wallet).
  try {
    const { _composePlayerAppearance } = opts;
    // Allow injection for tests; otherwise import lazily.
    if (typeof _composePlayerAppearance === "function") {
      ctx.appearance = _composePlayerAppearance(db, playerId);
    } else {
      // Inline fallback that doesn't require narrative-bridge.
      ctx.appearance = _inlineAppearance(db, playerId);
    }
  } catch { /* ok */ }

  // Asymmetry (grudge/desire/preoccupation + current opinion).
  try {
    const grudge = db.prepare(`
      SELECT severity, what FROM npc_grudges
      WHERE npc_id = ? AND target_player_id = ? ORDER BY severity DESC LIMIT 1
    `).get(npc.id, playerId);
    const opinion = db.prepare(`
      SELECT score FROM character_opinions
      WHERE npc_id = ? AND target_user_id = ?
    `).get(npc.id, playerId);
    if (grudge || opinion) ctx.asymmetry = { grudge: grudge ?? null, opinion: opinion?.score ?? null };
  } catch { /* ok */ }

  // Memory (last topic).
  try {
    const m = db.prepare(`
      SELECT summary_json FROM npc_player_memories WHERE npc_id = ? AND player_id = ?
    `).get(npc.id, playerId);
    if (m?.summary_json) {
      try {
        const s = JSON.parse(m.summary_json);
        if (s?.lastTopic) ctx.memory = { lastTopic: s.lastTopic };
      } catch { /* malformed */ }
    }
  } catch { /* ok */ }

  ctx.tone = deriveTone({
    opinion: ctx.asymmetry?.opinion ?? null,
    grudge: ctx.asymmetry?.grudge ?? null,
  });
  return ctx;
}

function _inlineAppearance(db, userId) {
  const out = {};
  try {
    const r = db.prepare(`
      SELECT COUNT(*) AS n FROM damage_events
      WHERE target_id = ? AND occurred_at > unixepoch() - 30
    `).get(userId);
    if ((r?.n ?? 0) > 0) out.bloody = true;
  } catch { /* ok */ }
  try {
    const r = db.prepare(`
      SELECT COUNT(*) AS n FROM user_active_effects
      WHERE user_id = ? AND (kind LIKE '%glow%' OR kind LIKE '%aura%')
        AND (expires_at IS NULL OR expires_at > unixepoch())
    `).get(userId);
    if ((r?.n ?? 0) > 0) out.glowing = true;
  } catch { /* ok */ }
  try {
    const w = db.prepare(`SELECT balance FROM user_wallets WHERE user_id = ?`).get(userId);
    if ((w?.balance ?? 0) >= 5000) out.wealthy = true;
  } catch { /* ok */ }
  try {
    const w = db.prepare(`
      SELECT weapon_class FROM player_inventory
      WHERE user_id = ? AND weapon_class IS NOT NULL ORDER BY id DESC LIMIT 1
    `).get(userId);
    if (w?.weapon_class) out.armed_with = String(w.weapon_class);
  } catch { /* ok */ }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Pick a topic given context. Favours appearance-driven topics when
 * present (so a bloody / soaked / glowing player gets remarked on).
 * Falls back to asymmetry (memory) then greeting. Seeded RNG keyed by
 * (npc, player, 30-min bucket) so the same player gets a stable bark
 * for a short window before resampling.
 */
export function pickBarkTopic(ctx, recentTopics = []) {
  if (!ctx) return "greeting";
  const bucket = Math.floor(Date.now() / 1000 / 1800); // 30 min
  const seedStr = `${ctx.npcId}|${ctx.playerId}|${bucket}`;
  // Candidate pool weighted by signals present.
  const pool = [];
  if (ctx.appearance?.bloody) pool.push("bloody", "bloody");
  if (ctx.appearance?.soaked) pool.push("soaked");
  if (ctx.appearance?.glowing) pool.push("glowing");
  if (ctx.appearance?.wealthy) pool.push("wealthy");
  if (ctx.appearance?.armed_with) pool.push("armed");
  if (ctx.memory?.lastTopic) pool.push("memory");
  pool.push("greeting", "routine");
  // Drop topics already in recent set to encourage variety.
  const filtered = pool.filter((t) => !recentTopics.includes(t));
  const chooseFrom = filtered.length > 0 ? filtered : pool;
  return _pick(seedStr, "topic", chooseFrom);
}

/**
 * Pick a line from the templated catalog. Always succeeds (greeting
 * fallback is always populated).
 */
export function composeBarkLine(ctx, topic) {
  const tone = ctx?.tone || "neutral";
  const byTone = BARK_TEMPLATES[topic] || BARK_TEMPLATES.greeting;
  const lines = byTone[tone] || byTone.neutral || BARK_TEMPLATES.greeting.neutral;
  const bucket = Math.floor(Date.now() / 1000 / 1800);
  const seedStr = `${ctx?.npcId || "npc"}|${ctx?.playerId || "p"}|${bucket}|line`;
  const line = _pick(seedStr, topic, lines);
  return { line, tone, topic };
}

/**
 * Opt-in LLM-driven line composer. Returns null on any failure;
 * caller should fall back to composeBarkLine.
 */
export async function composeBarkLineLLM(ctx, topic, brain, npc) {
  if (process.env.CONCORD_NPC_BARKS_LLM !== "true") return null;
  if (!brain || !ctx) return null;
  try {
    const { TASK_PROMPTS } = await import("./prompt-registry.js");
    const prompt = TASK_PROMPTS.npcBark({
      npcName: npc?.name,
      npcArchetype: npc?.archetype,
      tone: ctx.tone,
      topic,
      appearance: ctx.appearance,
      asymmetry: ctx.asymmetry,
      lastTopic: ctx.memory?.lastTopic,
    });
    const timeoutMs = 6000;
    const text = await Promise.race([
      brain.chat?.({ messages: [{ role: "user", content: prompt }], maxTokens: 40 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("bark_llm_timeout")), timeoutMs)),
    ]);
    const cleaned = String(text || "").trim().replace(/^["'`]|["'`]$/g, "").split("\n")[0];
    if (!cleaned || cleaned.length > 140) return null;
    return { line: cleaned, tone: ctx.tone, topic, llm: true };
  } catch (err) {
    logger?.warn?.("npc-barks", "llm_failed", { error: err?.message });
    return null;
  }
}

/**
 * Record a bark on the npc_player_memories row (extends migration 214).
 * Updates last_bark_at + appends topic to recent_bark_topics_json (keeps
 * the most-recent N).
 */
export function recordBark(db, { npcId, playerId, topic }) {
  if (!db || !npcId || !playerId) return { ok: false, reason: "missing_args" };
  try {
    // Read current recent list.
    const row = db.prepare(`
      SELECT recent_bark_topics_json FROM npc_player_memories
      WHERE npc_id = ? AND player_id = ?
    `).get(npcId, playerId);
    let recent = [];
    try { recent = row?.recent_bark_topics_json ? JSON.parse(row.recent_bark_topics_json) : []; }
    catch { recent = []; }
    if (!Array.isArray(recent)) recent = [];
    recent.unshift(topic);
    if (recent.length > RECENT_TOPICS_KEEP) recent.length = RECENT_TOPICS_KEEP;
    const nowS = Math.floor(Date.now() / 1000);
    // Upsert: try INSERT first, fall back to UPDATE.
    try {
      db.prepare(`
        INSERT INTO npc_player_memories
          (npc_id, player_id, last_bark_at, recent_bark_topics_json, first_met_at, last_interaction_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(npcId, playerId, nowS, JSON.stringify(recent), nowS, nowS);
    } catch {
      db.prepare(`
        UPDATE npc_player_memories
        SET last_bark_at = ?, recent_bark_topics_json = ?, last_interaction_at = ?
        WHERE npc_id = ? AND player_id = ?
      `).run(nowS, JSON.stringify(recent), nowS, npcId, playerId);
    }
    return { ok: true, recent };
  } catch (err) {
    return { ok: false, reason: "persist_failed", error: err?.message };
  }
}

/**
 * Cooldown check — true if the pair has barked in the last BARK_COOLDOWN_S.
 */
export function isOnCooldown(db, npcId, playerId) {
  if (!db || !npcId || !playerId) return true;
  try {
    const row = db.prepare(`
      SELECT last_bark_at FROM npc_player_memories
      WHERE npc_id = ? AND player_id = ?
    `).get(npcId, playerId);
    if (!row?.last_bark_at) return false;
    return (Math.floor(Date.now() / 1000) - row.last_bark_at) < BARK_COOLDOWN_S;
  } catch { return false; }
}

export const _internal = { BARK_TEMPLATES, BARK_COOLDOWN_S, RECENT_TOPICS_KEEP, deriveTone };
