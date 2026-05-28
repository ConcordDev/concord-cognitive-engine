// server/lib/embodied/dream-engine.js
//
// Layer 9: dream-fragment gathering + composition.
//
// The dream cycle runs while the player is offline. It pulls a snapshot
// of the last `WINDOW_HOURS` of their activity from the canonical tables:
//   - damage_events (combat outcomes, both as attacker and target)
//   - player_inventory.acquired_at (what they gathered / crafted)
//   - world_visits (where they went)
//   - pain_signals (what hurt — Layer 8)
//   - dtus (what they created)
// folds it into a structured fragment list, hashes a signature so the
// same window doesn't double-compose, and produces a "dream" DTU.
//
// Two composers ship:
//   1. `deterministic` — stitches fragments into a structured prose dream
//      with no LLM call. Always available, used by tests, default
//      production composer for builds without a healthy subconscious brain.
//   2. `subconscious_llm` — opt-in via `process.env.CONCORD_DREAM_LLM=true`.
//      Builds the same fragment list and asks the subconscious brain
//      (port 11435, qwen2.5:7b) to elaborate. Falls back to deterministic
//      if the brain call fails.
//
// The composed DTU is `kind = 'dream'`, `scope = 'personal'` by default.
// Citation requires consent (existing economy invariant). The creator
// can promote it to `published` to allow citation; royalties cascade
// through the standard pipeline if they do.

import crypto from "node:crypto";
import logger from "../../logger.js";

export const WINDOW_HOURS = Number(process.env.CONCORD_DREAM_WINDOW_HOURS) || 12;
export const MIN_FRAGMENTS = Number(process.env.CONCORD_DREAM_MIN_FRAGMENTS) || 5;
export const MIN_COMPOSE_INTERVAL_S = Number(process.env.CONCORD_DREAM_MIN_INTERVAL_S) || 6 * 3600;

/**
 * Gather fragments for a user over the last WINDOW_HOURS.
 * Pure read — no writes.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {{ now?: number, windowHours?: number }} [opts]
 * @returns {{ fragments: object[], summary: object, signature: string }}
 */
export function gatherFragments(db, userId, opts = {}) {
  const now = Number(opts.now ?? Math.floor(Date.now() / 1000));
  const window = Number(opts.windowHours ?? WINDOW_HOURS);
  const since = now - window * 3600;

  const fragments = [];
  const summary = {
    combatHits: 0, combatTaken: 0, kills: 0,
    gathered: 0, painTotal: 0, painCount: 0,
    visited: 0, dtusCreated: 0,
  };

  // Combat as attacker
  try {
    const rows = db.prepare(`
      SELECT id, world_id, target_id, element, final_damage, kill, occurred_at
        FROM damage_events
       WHERE attacker_id = ? AND attacker_type = 'player' AND occurred_at >= ?
       ORDER BY occurred_at DESC LIMIT 50
    `).all(userId, since);
    for (const r of rows) {
      fragments.push({
        kind: 'combat_dealt',
        worldId: r.world_id, targetId: r.target_id,
        element: r.element, damage: r.final_damage, kill: !!r.kill,
        ts: r.occurred_at,
      });
      summary.combatHits++;
      if (r.kill) summary.kills++;
    }
  } catch { /* damage_events may not exist */ }

  // Combat as target
  try {
    const rows = db.prepare(`
      SELECT id, world_id, attacker_id, element, final_damage, occurred_at
        FROM damage_events
       WHERE target_id = ? AND target_type = 'player' AND occurred_at >= ?
       ORDER BY occurred_at DESC LIMIT 50
    `).all(userId, since);
    for (const r of rows) {
      fragments.push({
        kind: 'combat_taken',
        worldId: r.world_id, attackerId: r.attacker_id,
        element: r.element, damage: r.final_damage,
        ts: r.occurred_at,
      });
      summary.combatTaken++;
    }
  } catch { /* ignore */ }

  // Pain — what hurt enough to leave a trace (Layer 8)
  try {
    const rows = db.prepare(`
      SELECT id, world_id, region, intensity, source, element, recorded_at
        FROM pain_signals
       WHERE user_id = ? AND recorded_at >= ?
       ORDER BY recorded_at DESC LIMIT 50
    `).all(userId, since);
    for (const r of rows) {
      fragments.push({
        kind: 'pain',
        worldId: r.world_id, region: r.region, intensity: r.intensity,
        source: r.source, element: r.element, ts: r.recorded_at,
      });
      summary.painCount++;
      summary.painTotal += Number(r.intensity ?? 0);
    }
  } catch { /* ignore */ }

  // Gathered resources
  try {
    const rows = db.prepare(`
      SELECT id, item_id, item_name, quantity, world_id, acquired_at
        FROM player_inventory
       WHERE user_id = ? AND acquired_at >= ?
       ORDER BY acquired_at DESC LIMIT 50
    `).all(userId, since);
    for (const r of rows) {
      fragments.push({
        kind: 'gathered',
        worldId: r.world_id, itemId: r.item_id, itemName: r.item_name,
        quantity: r.quantity, ts: r.acquired_at,
      });
      summary.gathered++;
    }
  } catch { /* ignore */ }

  // World visits
  try {
    const rows = db.prepare(`
      SELECT world_id, entered_at FROM world_visits
       WHERE user_id = ? AND entered_at >= ?
       ORDER BY entered_at DESC LIMIT 25
    `).all(userId, since);
    for (const r of rows) {
      fragments.push({ kind: 'visited', worldId: r.world_id, ts: r.entered_at });
      summary.visited++;
    }
  } catch { /* ignore */ }

  // DTUs created — exclude kind='dream' so a previously composed dream
  // doesn't become a fragment on the next pass (would shift the signature
  // and break the duplicate-signature dedupe).
  try {
    const rows = db.prepare(`
      SELECT id, kind, created_at FROM dtus
       WHERE creator_id = ? AND created_at >= ?
         AND COALESCE(kind, '') != 'dream'
       ORDER BY created_at DESC LIMIT 25
    `).all(userId, since);
    for (const r of rows) {
      fragments.push({ kind: 'dtu_created', dtuId: r.id, dtuKind: r.kind, ts: r.created_at });
      summary.dtusCreated++;
    }
  } catch { /* ignore */ }

  // Signature: hash over fragment fingerprints — same window → same signature.
  const fingerprint = fragments
    .map(f => `${f.kind}:${f.ts}:${f.worldId ?? ''}:${f.targetId ?? f.attackerId ?? f.itemId ?? f.dtuId ?? f.region ?? ''}`)
    .sort()
    .join('|');
  const signature = crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);

  return { fragments, summary, signature };
}

/**
 * Deterministic dream composer. Stitches fragments into structured prose
 * with no LLM call. Returns DTU-shaped data ready to insert.
 *
 * The output is intentionally short, evocative, and grounded — never
 * invents events not in the fragment list.
 */
export function composeDeterministic({ fragments, summary }, userId) {
  if (fragments.length === 0) return null;

  const lines = [];
  // Combat headline
  if (summary.combatHits > 0 || summary.combatTaken > 0) {
    if (summary.kills > 0) {
      lines.push(`There was blood today. ${summary.kills} fell.`);
    } else if (summary.combatHits > 0) {
      lines.push(`You traded blows ${summary.combatHits} times.`);
    } else {
      lines.push(`You took ${summary.combatTaken} hits.`);
    }
  }
  // Pain
  if (summary.painCount > 0) {
    const intensity = summary.painTotal / Math.max(1, summary.painCount);
    if (intensity > 0.6) lines.push(`The body remembers. The body insists.`);
    else if (intensity > 0.3) lines.push(`Bruises asleep beneath the skin.`);
    else lines.push(`A faint hum of effort carried through.`);
  }
  // Gathering
  if (summary.gathered > 0) {
    lines.push(`Your hands worked the world ${summary.gathered} times — leaves, stone, water, ore.`);
  }
  // Movement
  if (summary.visited > 1) {
    lines.push(`The map widened. ${summary.visited} thresholds crossed.`);
  }
  // DTUs created
  if (summary.dtusCreated > 0) {
    lines.push(`Something formed in you that wasn't there before. ${summary.dtusCreated} thoughts solidified.`);
  }
  if (lines.length === 0) {
    lines.push(`A quiet day. The world held still long enough for you to notice it.`);
  }

  const fragmentRoll = fragments.slice(0, 8).map(f => f.kind).join(' / ');
  return {
    title: 'Dream',
    human: lines.join(' '),
    core: { fragments: fragments.slice(0, 50), summary },
    machine: { fragmentRoll, fragmentCount: fragments.length, composer: 'deterministic' },
    creatorId: userId,
    kind: 'dream',
    scope: 'personal',
  };
}

/**
 * Try to compose a dream for a user. Idempotent within
 * MIN_COMPOSE_INTERVAL_S — re-running won't double-compose.
 *
 * Returns the inserted dreams row + the dream DTU id, or
 * { ok: false, reason } when skipping.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {object} [opts]
 * @returns {object}
 */
export async function tryComposeForUser(db, userId, opts = {}) {
  const now = Number(opts.now ?? Math.floor(Date.now() / 1000));
  const minInterval = Number(opts.minInterval ?? MIN_COMPOSE_INTERVAL_S);
  const composer = opts.composer ?? (process.env.CONCORD_DREAM_LLM === 'true' ? 'subconscious_llm' : 'deterministic');

  // Throttle: skip if a dream was composed inside the cooldown.
  let last;
  try {
    last = db.prepare(`
      SELECT signature, composed_at FROM dreams
       WHERE user_id = ? ORDER BY composed_at DESC LIMIT 1
    `).get(userId);
  } catch {
    return { ok: false, reason: 'dreams_table_missing' };
  }
  if (last && now - Number(last.composed_at) < minInterval) {
    return { ok: false, reason: 'cooldown', secondsLeft: minInterval - (now - Number(last.composed_at)) };
  }

  // Gather + signature
  const { fragments, summary, signature } = gatherFragments(db, userId, opts);
  if (fragments.length < (opts.minFragments ?? MIN_FRAGMENTS)) {
    return { ok: false, reason: 'too_few_fragments', count: fragments.length };
  }
  if (last && last.signature === signature) {
    return { ok: false, reason: 'duplicate_signature' };
  }

  // Compose. LLM path is opt-in; on failure or absence we fall back deterministically.
  let dreamData = composeDeterministic({ fragments, summary }, userId);
  if (composer === 'subconscious_llm') {
    try {
      const enhanced = await _composeWithSubconsciousBrain({ fragments, summary, userId });
      if (enhanced) dreamData = { ...dreamData, ...enhanced, machine: { ...(dreamData?.machine || {}), composer: 'subconscious_llm' } };
    } catch (err) {
      try { logger.warn('dream-engine', 'llm_compose_failed', { userId, error: err?.message }); } catch { /* ignore */ }
    }
  }
  if (!dreamData) return { ok: false, reason: 'compose_returned_null' };

  // Insert DTU + dreams row in a single transaction.
  const dtuId = `dream_${crypto.randomUUID()}`;
  const dreamRowId = `drm_${crypto.randomUUID()}`;
  const tx = db.transaction(() => {
    try {
      db.prepare(`
        INSERT INTO dtus
          (id, creator_id, kind, type, title, scope, data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        dtuId, userId, 'dream', 'dream', dreamData.title || 'Dream',
        dreamData.scope || 'personal',
        JSON.stringify({ human: dreamData.human, core: dreamData.core, machine: dreamData.machine }),
        now,
      );
    } catch {
      // Schema may use 'data' column with different layout; try minimal
      // insert and let the caller's seeding decide the canonical shape.
      // If even the minimal shape fails the outer try/catch on the tx
      // call surfaces it as { ok: false, reason: 'insert_failed' }.
      db.prepare(`INSERT INTO dtus (id, creator_id, kind, data, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(dtuId, userId, 'dream', JSON.stringify(dreamData), now);
    }
    db.prepare(`
      INSERT INTO dreams
        (id, user_id, world_id, dream_dtu_id, fragment_count, signature, composer, composed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      dreamRowId, userId, fragments[0]?.worldId ?? null, dtuId,
      fragments.length, signature, dreamData?.machine?.composer || 'deterministic', now,
    );
  });

  try {
    tx();
  } catch (err) {
    return { ok: false, reason: 'insert_failed', error: err?.message };
  }

  // Phase F3.1 — surface dream composition to the player.
  try {
    const emitFn = globalThis._concordRealtimeEmit;
    if (typeof emitFn === "function") {
      emitFn("dream:composed", {
        userId, dreamRowId, dreamDtuId: dtuId,
        fragmentCount: fragments.length,
        worldId: fragments[0]?.worldId ?? null,
      });
    }
  } catch { /* never blocks composition */ }

  return {
    ok: true, dreamRowId, dreamDtuId: dtuId, fragments: fragments.length,
    signature, composer: dreamData?.machine?.composer || 'deterministic',
  };
}

/** Read-side helper for the HUD endpoint. */
export function getRecentDreams(db, userId, limit = 10) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, dream_dtu_id, fragment_count, composer, composed_at
        FROM dreams WHERE user_id = ? ORDER BY composed_at DESC LIMIT ?
    `).all(userId, Math.max(1, Math.min(100, Number(limit))));
  } catch {
    return [];
  }
}

/**
 * LLM-enhanced compose. Optional. Falls back silently on any failure.
 * Routes through the subconscious brain (qwen2.5:7b on port 11435).
 */
async function _composeWithSubconsciousBrain({ fragments, summary, userId: _userId }) {
  let chat;
  try {
    const router = await import("../brain-router.js");
    if (typeof router.callBrain === "function") {
      chat = (sys, user) => router.callBrain('subconscious', { system: sys, prompt: user });
    }
  } catch { /* router not available */ }
  if (!chat) return null;

  const sys = `You compose dream-fragments. The user has experienced the events listed. Write 2-4 sentences in second person, evocative but grounded — never invent events outside the list. No headers, no lists. Plain prose.`;
  const userMsg = `Today: ${JSON.stringify(summary)}\nFragments: ${fragments.slice(0, 12).map(f => f.kind).join(', ')}`;
  let result;
  try {
    const timeout = new Promise((_r, reject) => {
      setTimeout(() => reject(new Error('llm_timeout')), 8000);
    });
    result = await Promise.race([chat(sys, userMsg), timeout]);
  } catch {
    return null;
  }
  const text = typeof result === 'string' ? result
             : result?.content || result?.text || result?.message?.content;
  if (typeof text !== 'string' || text.length < 20) return null;
  return { human: text.trim().slice(0, 1000) };
}
