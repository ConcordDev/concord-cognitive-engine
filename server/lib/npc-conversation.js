// NPC-to-NPC conversation: who talks, what they say, and the record.
//
// Rebuilt 2026-10-23. Live there had been 48 NPC conversations ever, all from
// one pass on Oct 11, and their text used raw ids ("0124a185-... pauses near
// 01ad48c1-... and asks about the day's omens"). Conversations now happen when
// an NPC chooses to socialize in its own tick: it turns to the nearest person
// and they exchange a few lines built from what is true about them — names,
// work, faction, the hour, what each is doing (including quests), and the
// speaker's authored backstory. No LLM is needed, so every world talks.

import crypto from "node:crypto";

export const CONVERSATION_COOLDOWN_S = Number(process.env.CONCORD_NPC_DIALOGUE_COOLDOWN_S || 30 * 60);
const TTL_S = Number(process.env.CONCORD_NPC_DIALOGUE_TTL_S || 15 * 60);

function pick(list, key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return list[(h >>> 0) % list.length];
}

const pretty = (s) => String(s || "").replace(/[_-]+/g, " ").trim();

const ACTIVITY_LINE = {
  gather_resource: "Been out gathering since first light.",
  build_structure: "Still putting up that frame by the road.",
  practice_skill: "I've been at my craft all day.",
  trade: "Trade's been steady, for once.",
  rest: "I'm only now off my feet.",
  travel: "Just back from the far side of the district.",
  create: "Working on something new. Not ready to show it.",
};

const GREETING = {
  dawn: ["Up early too?", "Morning comes fast."],
  morning: ["Good morning.", "Morning."],
  midday: ["Hot one today.", "Taking a break?"],
  afternoon: ["Afternoon.", "Long day, isn't it?"],
  dusk: ["Evening.", "Light's going."],
  night: ["Can't sleep either?", "Late to be out."],
};

/**
 * A short exchange between two NPCs. Pure: everything it says comes from
 * the inputs. `a` speaks first.
 * @param {{id:string,name:string,work:string,faction?:string,activity?:string,quest?:string,backstory?:string}} a
 * @param {{id:string,name:string,work:string,faction?:string}} b
 * @param {{segment?:string, seed?:string}} [ctx]
 * @returns {{from:string,to:string,text:string}[]}
 */
export function composeExchange(a, b, ctx = {}) {
  const seed = `${a.id}:${b.id}:${ctx.seed || ""}`;
  const segment = GREETING[ctx.segment] ? ctx.segment : "afternoon";
  const sameFaction = !!(a.faction && a.faction === b.faction && a.faction !== "neutral");
  const lines = [];
  const greet = pick(GREETING[segment], `${seed}:g`);
  lines.push({ from: a.id, to: b.id, text: sameFaction ? `${greet} ${b.name}.` : `${greet} You're ${b.name}, the ${pretty(b.work)}?` });

  // What A brings up: a quest beats work news.
  let topic;
  if (a.quest) topic = `I'm after help with something — "${a.quest}". Know anyone?`;
  else if (a.activity && ACTIVITY_LINE[a.activity]) topic = ACTIVITY_LINE[a.activity];
  if (topic) lines.push({ from: a.id, to: b.id, text: topic });

  // Authored backstories are subjectless third person ("Answered every call
  // for aid within..."). B can repeat one as hearsay when it opens with a
  // past-tense verb, which reads right after "People say you".
  const hearsay = /^[A-Z][a-z]+ed\b/.test(a.backstory || "") ? `People say you ${a.backstory.charAt(0).toLowerCase()}${a.backstory.slice(1)}` : "";

  let reply;
  if (a.quest) reply = sameFaction ? `I'll ask around the ${pretty(a.faction)} for you.` : "I'll keep an ear out.";
  else if (hearsay && !topic) reply = hearsay;
  else if (sameFaction) reply = pick([`Same here. The ${pretty(b.work)} work never stops.`, `Good to see you, ${a.name}.`, "Let's eat together when the day's done."], `${seed}:r`);
  else reply = pick([`Fair enough. I'm ${b.name} — I do ${pretty(b.work)} work.`, "Hm. Stay safe out there.", `Every ${pretty(a.work)} says that.`], `${seed}:r`);
  lines.push({ from: b.id, to: a.id, text: reply });
  return lines;
}

/** True when the pair talked within the cooldown. */
export function pairOnCooldown(db, worldId, idA, idB, nowS = Math.floor(Date.now() / 1000)) {
  const [x, y] = idA < idB ? [idA, idB] : [idB, idA];
  try {
    const r = db.prepare(`SELECT MAX(opened_at) AS t FROM npc_conversations WHERE world_id = ? AND npc_a = ? AND npc_b = ?`).get(worldId, x, y);
    return !!(r?.t && r.t > nowS - CONVERSATION_COOLDOWN_S);
  } catch {
    return true; // no table → don't try to write
  }
}

/** Store a conversation. Returns { id, expiresAt } or null. */
export function recordConversation(db, worldId, idA, idB, messages, seedContext = {}, composer = "deterministic") {
  const [x, y] = idA < idB ? [idA, idB] : [idB, idA];
  const now = Math.floor(Date.now() / 1000);
  const id = `conv_${crypto.randomBytes(10).toString("hex")}`;
  const stamped = messages.map((m) => ({ ...m, at: now }));
  try {
    db.prepare(`
      INSERT INTO npc_conversations
        (id, world_id, npc_a, npc_b, opened_at, last_msg_at, expires_at, status, composer, seed_context_json, messages_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(id, worldId, x, y, now, now, now + TTL_S, composer, JSON.stringify(seedContext), JSON.stringify(stamped));
    return { id, expiresAt: now + TTL_S };
  } catch {
    return null;
  }
}

/** First sentence of an authored backstory, for conversation. */
export function backstorySentence(narrativeContext) {
  let n = narrativeContext;
  if (typeof n === "string") { try { n = JSON.parse(n); } catch { n = null; } }
  const b = String(n?.backstory || "").trim();
  if (!b) return "";
  // Authored backstories carry faction ids ("scholars_guild"); speak them as words.
  const first = (b.split(/(?<=[.!?])\s+/)[0] || b).replace(/\b([a-z]+(?:_[a-z]+)+)\b/g, (m) => m.replace(/_/g, " "));
  return first.length > 160 ? `${first.slice(0, 157).trimEnd()}...` : first;
}
