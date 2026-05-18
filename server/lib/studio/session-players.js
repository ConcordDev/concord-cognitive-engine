// server/lib/studio/session-players.js
//
// Studio Sprint B — Item #1: AI Session Players (Logic Pro 11 parity).
//
// Producers summon a virtual Drummer / Bass / Keys / Synth player to
// fill a track. Each player is a small persona + generation function +
// mentorship history. Players are MENTORABLE — feedback the producer
// gives ("more snare", "play behind the beat", "swing the hats")
// accumulates into the player's mentorship_log and biases the next
// generation. Players are also PUBLISHABLE — a producer can wrap any
// player as a kind='agent_spec' DTU and list it on the agent
// marketplace so other producers can hire them.
//
// Storage model: each summoned player is a kind='session_player' DTU.
// kind is unconstrained TEXT per migration 202 so no schema change
// is needed. meta_json carries:
//   {
//     role,                  // 'drummer' | 'bass_player' | 'keys_player' | 'synth_player'
//     persona_prompt,        // per-role system prompt
//     mentorship_log,        // [{ feedback, given_at, applied_in_generation }]
//     generation_count,
//     skill_level,           // increments on positive mentor feedback
//   }

import crypto from "node:crypto";

const TIMEOUT_MS = 12_000;
const MAX_NOTES = 512;
const MAX_MENTORSHIP_ENTRIES = 50;

export const ROLES = ["drummer", "bass_player", "keys_player", "synth_player"];

const ROLE_PERSONAS = {
  drummer: {
    title: "Session Drummer",
    persona: "You are a session drummer. You compose GM-MIDI drum patterns: kick=36 snare=38 closed_hat=42 open_hat=46 ride=51 crash=49. Tight pocket. Respond with ONLY a JSON array of {tick,pitch,velocity,duration} note objects.",
    pitchHints: { kick: 36, snare: 38, closed_hat: 42, open_hat: 46, ride: 51, crash: 49 },
    velocityFloor: 60,
    velocityCeiling: 120,
  },
  bass_player: {
    title: "Session Bass Player",
    persona: "You are a session bass player. You compose monophonic bass lines that lock with the kick. Pitches between MIDI 28 and 55. Mix root notes with passing tones. Respond with ONLY a JSON array of {tick,pitch,velocity,duration}.",
    pitchHints: { root_low: 36, root_high: 48, range_lo: 28, range_hi: 55 },
    velocityFloor: 70,
    velocityCeiling: 110,
  },
  keys_player: {
    title: "Session Keys Player",
    persona: "You are a session keys player. Comping voicings between MIDI 48 and 80. Three to five voices per chord. Vary inversions for smooth voice leading. Respond with ONLY a JSON array.",
    pitchHints: { range_lo: 48, range_hi: 80 },
    velocityFloor: 55,
    velocityCeiling: 95,
  },
  synth_player: {
    title: "Session Synth Player",
    persona: "You are a session synth player. Composes lead/pad lines between MIDI 50 and 90. Sustained pads or rhythmic stabs depending on context. Respond with ONLY a JSON array.",
    pitchHints: { range_lo: 50, range_hi: 90 },
    velocityFloor: 60,
    velocityCeiling: 110,
  },
};

function validRole(r) { return ROLES.includes(r); }

function validateNoteArray(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const n of raw.slice(0, MAX_NOTES)) {
    if (!n || typeof n !== "object") continue;
    const tick = Number(n.tick), pitch = Number(n.pitch), vel = Number(n.velocity), dur = Number(n.duration);
    if (!Number.isFinite(tick) || tick < 0) continue;
    if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) continue;
    if (!Number.isFinite(vel) || vel < 0 || vel > 127) continue;
    if (!Number.isFinite(dur) || dur <= 0) continue;
    out.push({ tick: Math.round(tick), pitch, velocity: Math.round(vel), duration: Math.round(dur) });
  }
  return out.length > 0 ? out : null;
}

function parseJsonFromText(text) {
  if (typeof text !== "string") return null;
  const cleaned = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const arr = cleaned.match(/\[[\s\S]*\]/);
  if (arr) { try { return JSON.parse(arr[0]); } catch { /* fall through */ } }
  return null;
}

/* ─── Deterministic per-role fallbacks ────────────────────────── */

function deterministicForRole(role, { bars, ticksPerBeat = 480, beatsPerBar = 4 }) {
  const barTicks = beatsPerBar * ticksPerBeat;
  const totalTicks = bars * barTicks;
  const out = [];
  if (role === "drummer") {
    const stepTicks = ticksPerBeat / 4; // 16th
    let cursor = 0; let step = 0;
    while (cursor < totalTicks) {
      const beatPos = step % 16;
      if (beatPos === 0 || beatPos === 8) out.push({ tick: cursor, pitch: 36, velocity: 110, duration: stepTicks });
      if (beatPos === 4 || beatPos === 12) out.push({ tick: cursor, pitch: 38, velocity: 100, duration: stepTicks });
      out.push({ tick: cursor, pitch: 42, velocity: 70, duration: Math.round(stepTicks * 0.5) });
      cursor += stepTicks; step += 1;
    }
  } else if (role === "bass_player") {
    // Root + fifth walking line.
    const rootCycle = [36, 36, 43, 36, 41, 41, 36, 38];
    for (let b = 0; b < bars; b++) {
      for (let beat = 0; beat < beatsPerBar; beat++) {
        const pitch = rootCycle[(b * beatsPerBar + beat) % rootCycle.length];
        out.push({ tick: b * barTicks + beat * ticksPerBeat, pitch, velocity: 95, duration: ticksPerBeat });
      }
    }
  } else if (role === "keys_player") {
    // Quarter-note chord stabs on the I chord — keeps Sprint B usable
    // even with no LLM. Producer can mentor for variation.
    const chordVoices = [60, 64, 67];
    for (let b = 0; b < bars; b++) {
      for (let beat = 0; beat < beatsPerBar; beat++) {
        for (const v of chordVoices) {
          out.push({ tick: b * barTicks + beat * ticksPerBeat, pitch: v, velocity: 80, duration: ticksPerBeat });
        }
      }
    }
  } else if (role === "synth_player") {
    // Held pad on the I chord.
    const pad = [60, 64, 67, 72];
    for (const p of pad) {
      out.push({ tick: 0, pitch: p, velocity: 75, duration: totalTicks });
    }
  }
  return out;
}

/* ─── Brain call ──────────────────────────────────────────────── */

async function callSubconscious(systemPrompt, userPrompt) {
  let chat;
  try {
    const router = await import("../brain-router.js");
    if (typeof router.callBrain === "function") {
      chat = (sys, user) => router.callBrain("subconscious", { system: sys, prompt: user });
    }
  } catch { /* router missing */ }
  if (!chat) return null;
  try {
    const timeout = new Promise((_r, rj) => setTimeout(() => rj(new Error("llm_timeout")), TIMEOUT_MS));
    const result = await Promise.race([chat(systemPrompt, userPrompt), timeout]);
    const text = typeof result === "string" ? result : result?.content || result?.text || result?.message?.content;
    return parseJsonFromText(text);
  } catch {
    return null;
  }
}

/* ─── Helpers ──────────────────────────────────────────────────── */

function readPlayer(db, playerId) {
  if (!db || !playerId) return null;
  try {
    const row = db.prepare(`SELECT id, kind, title, creator_id, meta_json FROM dtus WHERE id = ? AND kind = 'session_player'`).get(playerId);
    if (!row) return null;
    let meta = {};
    try { meta = JSON.parse(row.meta_json || "{}"); } catch { /* meta optional */ }
    return { ...row, meta };
  } catch { return null; }
}

function writePlayerMeta(db, playerId, meta) {
  try {
    db.prepare(`UPDATE dtus SET meta_json = ? WHERE id = ?`).run(JSON.stringify(meta), playerId);
    return true;
  } catch { return false; }
}

function composeMentorshipBias(mentorship_log) {
  if (!Array.isArray(mentorship_log) || mentorship_log.length === 0) return "";
  const last = mentorship_log.slice(-8); // last 8 feedback items
  const bullets = last.map(m => `- ${m.feedback}`).join("\n");
  return `\n\nMentorship history (apply these adjustments):\n${bullets}`;
}

/* ─── Public API ──────────────────────────────────────────────── */

/** Summon a session player for a user. Creates a kind='session_player' DTU. */
export function summonPlayer(db, { userId, role, name }) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!userId) return { ok: false, reason: "no_actor" };
  if (!validRole(role)) return { ok: false, reason: "invalid_role", roles: ROLES };
  const persona = ROLE_PERSONAS[role];
  const playerId = `sp_${crypto.randomUUID()}`;
  const meta = {
    type: "session_player",
    role,
    persona_prompt: persona.persona,
    role_hints: persona.pitchHints,
    velocity_floor: persona.velocityFloor,
    velocity_ceiling: persona.velocityCeiling,
    mentorship_log: [],
    generation_count: 0,
    skill_level: 1,
  };
  const title = String(name || persona.title).slice(0, 120);
  try {
    db.prepare(`
      INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
      VALUES (?, 'session_player', ?, ?, ?, 1, 0, unixepoch())
    `).run(playerId, title, userId, JSON.stringify(meta));
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
  return { ok: true, playerId, role, title, meta };
}

/** Generate a pattern via the player. Reads the player's persona +
 *  mentorship_log, calls the subconscious brain, falls back to the
 *  per-role deterministic pattern, increments generation_count. */
export async function generatePattern(db, { userId, playerId, bars = 4, context = {}, deterministic = false }) {
  if (!db) return { ok: false, reason: "no_db" };
  const player = readPlayer(db, playerId);
  if (!player) return { ok: false, reason: "player_not_found" };
  if (player.creator_id !== userId && context.allowAcrossUsers !== true) {
    return { ok: false, reason: "not_owner" };
  }
  const role = player.meta.role;
  if (!validRole(role)) return { ok: false, reason: "invalid_player_role" };
  const persona = ROLE_PERSONAS[role];
  const ticksPerBeat = Number.isInteger(context.ticksPerBeat) ? Math.max(24, Math.min(1920, context.ticksPerBeat)) : 480;
  const beatsPerBar = Number.isInteger(context.beatsPerBar) ? Math.max(1, Math.min(16, context.beatsPerBar)) : 4;

  let notes = null;
  if (!deterministic) {
    const sys = persona.persona + composeMentorshipBias(player.meta.mentorship_log) +
      `\nUse ticks where one beat = ${ticksPerBeat}. One bar = ${ticksPerBeat * beatsPerBar} ticks.`;
    const promptParts = [
      `Compose a ${role} pattern for ${bars} bars (${bars * beatsPerBar * ticksPerBeat} total ticks).`,
    ];
    if (context.key) promptParts.push(`Key: ${context.key}.`);
    if (context.mood) promptParts.push(`Mood: ${context.mood}.`);
    if (context.genre) promptParts.push(`Genre: ${context.genre}.`);
    if (context.bpm) promptParts.push(`BPM: ${context.bpm}.`);
    promptParts.push("Return the JSON array now.");
    const raw = await callSubconscious(sys, promptParts.join(" "));
    notes = validateNoteArray(raw);
  }
  if (!notes) {
    notes = deterministicForRole(role, { bars, ticksPerBeat, beatsPerBar });
  }

  // Increment generation count. Best-effort.
  player.meta.generation_count = (player.meta.generation_count || 0) + 1;
  writePlayerMeta(db, playerId, player.meta);

  return {
    ok: true, playerId, role,
    generation: player.meta.generation_count,
    composer: notes && !deterministic ? "subconscious_brain_or_fallback" : "deterministic",
    notes,
  };
}

/** Append a mentorship feedback entry to the player. */
export function mentorPlayer(db, { userId, playerId, feedback }) {
  if (!db) return { ok: false, reason: "no_db" };
  const player = readPlayer(db, playerId);
  if (!player) return { ok: false, reason: "player_not_found" };
  if (player.creator_id !== userId) return { ok: false, reason: "not_owner" };
  const trimmed = String(feedback || "").trim().slice(0, 280);
  if (!trimmed) return { ok: false, reason: "empty_feedback" };
  const log = Array.isArray(player.meta.mentorship_log) ? player.meta.mentorship_log : [];
  log.push({ feedback: trimmed, given_at: Math.floor(Date.now() / 1000) });
  if (log.length > MAX_MENTORSHIP_ENTRIES) log.splice(0, log.length - MAX_MENTORSHIP_ENTRIES);
  player.meta.mentorship_log = log;
  // Each accepted mentorship entry nudges skill_level upward.
  player.meta.skill_level = (player.meta.skill_level || 1) + 0.05;
  const ok = writePlayerMeta(db, playerId, player.meta);
  if (!ok) return { ok: false, reason: "write_failed" };
  return { ok: true, playerId, log_size: log.length, skill_level: player.meta.skill_level };
}

/** Publish a player as an agent_spec DTU + (optionally) list on the
 *  agent marketplace. Capabilities: ["_llm", "studio.player_generate"]. */
export async function publishPlayer(db, { userId, playerId, priceCents = 0, license = "CC-BY-SA-4.0", summary = "" }) {
  if (!db) return { ok: false, reason: "no_db" };
  const player = readPlayer(db, playerId);
  if (!player) return { ok: false, reason: "player_not_found" };
  if (player.creator_id !== userId) return { ok: false, reason: "not_owner" };
  const manifest = {
    id: `agent.studio.session_player.${player.id.slice(-12)}`,
    name: `${player.title} (Session Player)`,
    version: "1.0.0",
    creator_id: userId,
    license,
    summary: String(summary || `${player.meta.role} session player — ${player.meta.generation_count} generations, ${(player.meta.mentorship_log || []).length} mentor sessions`).slice(0, 500),
    capabilities: [
      { domain: "_llm", macros: [] },
      { domain: "studio", macros: ["player_generate"] },
    ],
    parent_dtu_ids: [player.id],
  };
  try {
    const market = await import("../agent-marketplace.js");
    if (typeof market.mintAgentAsDtu !== "function") return { ok: false, reason: "marketplace_unavailable" };
    const mintResult = await market.mintAgentAsDtu(db, {
      userId, agentManifest: manifest, summary: manifest.summary,
    });
    if (!mintResult.ok) return mintResult;
    let listing = null;
    if (priceCents > 0 && typeof market.listAgentOnMarketplace === "function") {
      listing = market.listAgentOnMarketplace(db, {
        dtuId: mintResult.dtuId, sellerId: userId,
        priceCents, currency: "USD",
        title: manifest.name, description: manifest.summary,
      });
    }
    return { ok: true, agentDtuId: mintResult.dtuId, playerId, listing };
  } catch (err) {
    return { ok: false, reason: "publish_failed", error: err?.message };
  }
}

/** List a user's summoned players. */
export function listPlayersForUser(db, userId, limit = 50) {
  if (!db || !userId) return [];
  try {
    const rows = db.prepare(`
      SELECT id, title, meta_json, created_at FROM dtus
      WHERE kind = 'session_player' AND creator_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(userId, limit);
    return rows.map(r => {
      let meta = {};
      try { meta = JSON.parse(r.meta_json || "{}"); } catch { /* meta optional */ }
      return { id: r.id, title: r.title, meta, created_at: r.created_at };
    });
  } catch { return []; }
}

// Exported for tests.
export const _internal = {
  validateNoteArray, parseJsonFromText, deterministicForRole, composeMentorshipBias,
  ROLE_PERSONAS,
};
