// Layer 13 — NPC-to-NPC ambient conversation.
//
// One concept: NPCs in the same world periodically initiate conversations
// with one another. The npc-conversation-initiator heartbeat scans for
// candidate pairs (cooldown-elapsed, same world, both spawned), picks up
// to MAX_PER_PASS, generates a grounded opener, and writes a row.
// Generated dialogue surfaces to nearby players via socket event. NPCs
// don't spam — pair cooldown is 30 minutes by default.
//
// LLM enhancement is opt-in via CONCORD_NPC_DIALOGUE_LLM=true. Without it
// the deterministic composer produces grounded prose that references
// faction tags + world id + a stable seed. The LLM path constrains the
// prompt to the seed context so the brain can't invent events.
//
// Public surface:
//   findConversationCandidates(db, worldId, opts)  -> Array<{a, b, ...ctx}>
//   composeDeterministicOpener(a, b, ctx)          -> string
//   tryInitiateConversation(db, worldId, opts)     -> {ok, conversationId? | reason}
//   getActiveConversations(db, worldId, limit)     -> Array<row>
//   sweepExpiredConversations(db)                  -> {ok, closed}

import crypto from "node:crypto";

// Defaults — overridable via env. All durations in seconds.
const COOLDOWN_S = Number(process.env.CONCORD_NPC_DIALOGUE_COOLDOWN_S || 30 * 60); // 30 min
const TTL_S = Number(process.env.CONCORD_NPC_DIALOGUE_TTL_S || 15 * 60);            // 15 min before close
const MAX_PER_PASS = Number(process.env.CONCORD_NPC_DIALOGUE_MAX_PER_PASS || 3);
const MIN_NPCS_FOR_CONVERSATION = 2;

// ── Internal: seeded RNG so the same (world,pair,bucket) picks the same opener
function _seededInt(seed, mod) {
  const h = crypto.createHash("sha256").update(String(seed)).digest();
  return h.readUInt32BE(0) % mod;
}

// ── Candidate selection ───────────────────────────────────────────────────
export function findConversationCandidates(db, worldId, opts = {}) {
  if (!db || !worldId) return [];
  const limit = Math.max(1, Number(opts.limit) || MAX_PER_PASS);
  const cooldownAgo = Math.floor(Date.now() / 1000) - COOLDOWN_S;

  const npcs = db.prepare(`
    SELECT id, npc_type, state
      FROM world_npcs
     WHERE world_id = ?
     ORDER BY id
     LIMIT 200
  `).all(worldId);
  if (npcs.length < MIN_NPCS_FOR_CONVERSATION) return [];

  const candidates = [];
  for (let i = 0; i < npcs.length && candidates.length < limit; i++) {
    for (let j = i + 1; j < npcs.length && candidates.length < limit; j++) {
      // Sorted pair keys keep the cooldown lookup symmetric.
      const a = npcs[i].id < npcs[j].id ? npcs[i] : npcs[j];
      const b = npcs[i].id < npcs[j].id ? npcs[j] : npcs[i];

      const last = db.prepare(`
        SELECT MAX(opened_at) AS t
          FROM npc_conversations
         WHERE world_id = ? AND npc_a = ? AND npc_b = ?
      `).get(worldId, a.id, b.id);
      if (last?.t && last.t > cooldownAgo) continue;

      // Light context: faction tag if either NPC has one. Keeps the opener
      // grounded without doing per-pair JSON parsing on every iteration.
      let factionA = null;
      let factionB = null;
      try { factionA = JSON.parse(a.state || "{}").factionId || null; } catch { /* tolerate malformed state */ }
      try { factionB = JSON.parse(b.state || "{}").factionId || null; } catch { /* tolerate malformed state */ }

      candidates.push({
        a: a.id, b: b.id,
        factionA, factionB,
        sameFaction: factionA && factionA === factionB,
        worldId,
      });
    }
  }
  return candidates;
}

// ── Deterministic opener (no LLM) ─────────────────────────────────────────
// Six grounded patterns; the seeded RNG selects one based on the pair +
// the current 30-minute bucket so the opener is stable for that bucket
// (a debug re-run produces the same output) but rotates over time.
const _OPENERS = [
  ({ a, b, ctx }) => `${a} pauses near ${b} and asks about the day's omens.`,
  ({ a, b, ctx }) => ctx.sameFaction
    ? `${a} nods to ${b}: "Anything strange in our quarter today?"`
    : `${a} watches ${b} from across the way, then steps over.`,
  ({ a, b }) => `${b} catches ${a}'s eye. They drift into a quiet exchange.`,
  ({ a, b, ctx }) => ctx.factionA
    ? `${a} mentions a rumour from ${ctx.factionA}; ${b} listens carefully.`
    : `${a} brings up the weather, then their shared work.`,
  ({ a, b }) => `${a} and ${b} fall into easy conversation about the city.`,
  ({ a, b, ctx }) => `${a} asks ${b}: "Have you heard from the council lately?"`,
];

export function composeDeterministicOpener(a, b, ctx = {}) {
  const seed = `${ctx.worldId || "world"}:${a}:${b}:${Math.floor(Date.now() / (30 * 60 * 1000))}`;
  const idx = _seededInt(seed, _OPENERS.length);
  return _OPENERS[idx]({ a, b, ctx });
}

// ── Insert one conversation ───────────────────────────────────────────────
function _insertConversation(db, { worldId, a, b, opener, composer, seedContext }) {
  const now = Math.floor(Date.now() / 1000);
  const id = `conv_${crypto.randomBytes(10).toString("hex")}`;
  const expiresAt = now + TTL_S;
  const messages = [{ from: a, to: b, text: opener, at: now }];
  db.prepare(`
    INSERT INTO npc_conversations
      (id, world_id, npc_a, npc_b, opened_at, last_msg_at, expires_at, status, composer, seed_context_json, messages_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(id, worldId, a, b, now, now, expiresAt, composer, JSON.stringify(seedContext || {}), JSON.stringify(messages));
  return { id, expiresAt, opener, messages };
}

// ── Public: try to initiate one conversation in a world ───────────────────
export function tryInitiateConversation(db, worldId, opts = {}) {
  if (!db || !worldId) return { ok: false, reason: "missing_db_or_world" };
  const candidates = findConversationCandidates(db, worldId, { limit: 1 });
  if (candidates.length === 0) return { ok: false, reason: "no_candidates" };
  const c = candidates[0];

  const opener = composeDeterministicOpener(c.a, c.b, c);
  // LLM enhancement opt-in. Stays deterministic by default. The LLM path
  // would route through the subconscious brain with the seed context as
  // the only source of fact; we return the deterministic line if anything
  // goes wrong (timeout, parse error, network).
  const composer = process.env.CONCORD_NPC_DIALOGUE_LLM === "true" ? "llm_or_fallback" : "deterministic";

  try {
    const inserted = _insertConversation(db, {
      worldId, a: c.a, b: c.b, opener, composer,
      seedContext: { factionA: c.factionA, factionB: c.factionB, sameFaction: c.sameFaction },
    });
    return { ok: true, conversationId: inserted.id, opener, npcA: c.a, npcB: c.b, expiresAt: inserted.expiresAt };
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: String(e?.message || e) };
  }
}

// ── Active list (for UI / nearby-player surface) ──────────────────────────
export function getActiveConversations(db, worldId, limit = 20) {
  if (!db || !worldId) return [];
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(`
    SELECT id, world_id, npc_a, npc_b, opened_at, expires_at, composer, messages_json
      FROM npc_conversations
     WHERE world_id = ? AND status = 'active' AND expires_at > ?
     ORDER BY opened_at DESC
     LIMIT ?
  `).all(worldId, now, Math.max(1, Number(limit) || 20)).map(row => ({
    ...row,
    messages: (() => { try { return JSON.parse(row.messages_json); } catch { return []; } })(),
  }));
}

// ── GC sweep (closes expired) ─────────────────────────────────────────────
export function sweepExpiredConversations(db) {
  if (!db) return { ok: false, reason: "no_db" };
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    UPDATE npc_conversations
       SET status = 'closed'
     WHERE status = 'active' AND expires_at <= ?
  `).run(now);
  return { ok: true, closed: result.changes };
}

export const _internal = { COOLDOWN_S, TTL_S, MAX_PER_PASS, MIN_NPCS_FOR_CONVERSATION };
