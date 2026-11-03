// server/lib/fishing.js
//
// Fishing minigame engine. Cast → wait for bite → reel with tension
// timing → resolve catch quality.
//
// Cast registers a "session" tied to userId + worldId + position. The
// scheduler (or a per-call setTimeout) emits a `fishing:bite` event
// 3-8s later. Player POSTs `/reel` with reactionMs + tensionAccuracy
// and the server resolves to a fish from the world's fauna pool,
// weighted by player's fishing skill + the fish's rarity.
//
// Caught fish go into player_inventory tagged 'raw_fish' so the existing
// cooking pipeline can pick them up.

import crypto from "crypto";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { LruMap, LruSet } from "./lru-map.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = join(__dir, "../../content");

const _sessions = new Map();          // sessionId → session
const SESSION_TIMEOUT_MS = 60_000;    // session expires after 60s if untouched
const BITE_MIN_MS = 3000;
const BITE_MAX_MS = 8000;
const TENSION_PERFECT = 0.85;         // accuracy >= 0.85 = perfect catch
const TENSION_GOOD    = 0.55;
const TENSION_POOR    = 0.20;
// Client tension is only a hint. 0.85+ would be a perfect tier on accuracy
// alone (0.8*0.6 + 0.2 base = 0.68, still under perfect unless skill and
// reaction, measured here, also justify it). Cap below the perfect cutoff.
const TENSION_HINT_CAP = 0.8;

const RARITY_WEIGHTS = {
  common:    1.0,
  uncommon:  0.5,
  rare:      0.15,
  legendary: 0.03,
};

const _faunaCache = new LruMap(); // worldId → fish[]

function loadFishForWorld(worldId) {
  if (_faunaCache.has(worldId)) return _faunaCache.get(worldId);
  let fish = [];
  try {
    const p = join(CONTENT_ROOT, "world", worldId, "fauna", "fish.json");
    fish = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    // Fall back to hub's fish if the world has no fauna authored yet.
    if (worldId !== "concordia-hub") {
      try {
        const p = join(CONTENT_ROOT, "world", "concordia-hub", "fauna", "fish.json");
        fish = JSON.parse(readFileSync(p, "utf8"));
      } catch { /* nothing */ }
    }
  }
  _faunaCache.set(worldId, fish);
  return fish;
}

export function listFishForWorld(worldId, biome = null) {
  const all = loadFishForWorld(worldId);
  if (!biome) return all;
  return all.filter((f) => f.biome === biome || f.subBiome === biome);
}

/**
 * Cast a line. Returns a sessionId; the client polls for bite or
 * subscribes to the `fishing:bite` socket event. The session expires
 * after 60s.
 *
 * @returns {{ ok, sessionId, biteAtEpochMs?, fishOptions: object[] }}
 */
export function castLine({ userId, worldId = "concordia-hub", x = 0, z = 0, biome = "water" } = {}) {
  if (!userId) return { ok: false, error: "userId_required" };
  const fishOptions = listFishForWorld(worldId, biome);
  if (fishOptions.length === 0) return { ok: false, error: "no_fish_in_biome" };
  // Cryptographically secure session id — Math.random fallback was
  // CodeQL-flagged as insecure randomness in a security context.
  // crypto.randomUUID is in Node 18+ stdlib so the conditional fallback
  // was unreachable in practice; the explicit randomBytes covers any
  // exotic runtime that lacks randomUUID.
  const sessionId = `fish_${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString("hex")}`;
  // Bite delay range — non-security randomness, but use crypto for
  // consistency and to avoid CodeQL false-positive on this file.
  const biteRange = BITE_MAX_MS - BITE_MIN_MS;
  const biteAt = Date.now() + BITE_MIN_MS + Math.floor((crypto.randomBytes(2).readUInt16BE(0) / 0xffff) * biteRange);
  _sessions.set(sessionId, {
    userId, worldId, x, z, biome,
    castAt: Date.now(),
    biteAt,
    expiresAt: Date.now() + SESSION_TIMEOUT_MS,
    candidatePool: fishOptions,
    biteEmitted: false,
    resolved: false,
  });
  return { ok: true, sessionId, biteAtEpochMs: biteAt, candidateCount: fishOptions.length };
}

export function getSession(sessionId) {
  return _sessions.get(sessionId) || null;
}

/**
 * F5 fix (fishing lens review, 2026-11-01): the review found the catalog's
 * rarity/behaviour columns were "decorative at the point of play" — no
 * species identity or behaviour verb (dart/leap/pull/thrash/evade/vanish)
 * ever appeared during the fight, because the species was previously only
 * chosen at REEL time (resolveFishCatch), after the fight was already over.
 * This picks the candidate species at BITE time instead — using only the
 * skill bias (tensionAccuracy isn't known yet) — and stores it on the
 * session so the bite event can tell the client what it's fighting, and so
 * the fight itself can honestly reflect that species' real abilities.
 * Idempotent: a session only ever gets one bite-time pick.
 *
 * @returns {{ ok, fish }}
 */
export function pickBiteFish(sessionId, { fishingSkill = 0 } = {}) {
  const s = _sessions.get(sessionId);
  if (!s) return { ok: false, error: "session_not_found" };
  if (s.fish) return { ok: true, fish: s.fish };
  const skillBias = Math.max(0, Math.min(1.5, Number(fishingSkill) / 100));
  const weights = s.candidatePool.map((f) => {
    const base = RARITY_WEIGHTS[f.rarity] ?? 0.4;
    const rarityFactor = f.rarity === "legendary" ? (1 + skillBias) :
                          f.rarity === "rare"      ? (1 + skillBias * 0.8) :
                          f.rarity === "uncommon"  ? (1 + skillBias * 0.4) :
                          1.0;
    return base * rarityFactor;
  });
  const totalWeight = weights.reduce((s2, w) => s2 + w, 0);
  if (totalWeight <= 0) return { ok: false, error: "weights_zero" };
  let pick = Math.random() * totalWeight;
  let chosen = s.candidatePool[s.candidatePool.length - 1];
  for (let i = 0; i < s.candidatePool.length; i++) {
    pick -= weights[i];
    if (pick <= 0) { chosen = s.candidatePool[i]; break; }
  }
  s.fish = chosen;
  return { ok: true, fish: chosen };
}

/**
 * Fishing skill is a server record, never a client field. Missing table or
 * missing row clamps to 0 so a caller cannot force a perfect catch.
 */
export function readFishingSkill(db, userId) {
  if (!db || !userId) return 0;
  try {
    const row = db.prepare(
      `SELECT level FROM player_skill_levels
        WHERE user_id = ? AND skill_type = 'fishing'
        ORDER BY level DESC LIMIT 1`
    ).get(userId);
    const level = Number(row?.level);
    if (!Number.isFinite(level) || level < 0) return 0;
    return Math.min(100, level);
  } catch {
    return 0;
  }
}

/** Tension from the client is a bounded hint, never a perfect-catch lever. */
export function clampTensionHint(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(TENSION_HINT_CAP, n));
}

/** Reaction is reel-time minus the session's bite timestamp. */
export function measureReactionMs(session, now = Date.now()) {
  const biteAt = Number(session?.biteAt);
  if (!Number.isFinite(biteAt)) return 1000;
  return Math.max(0, now - biteAt);
}

/**
 * Periodic cleanup; can be called from heartbeat tick.
 */
export function sweepExpiredSessions(now = Date.now()) {
  let pruned = 0;
  for (const [id, s] of _sessions.entries()) {
    if (s.expiresAt < now) { _sessions.delete(id); pruned += 1; }
  }
  return pruned;
}

/**
 * Resolve a reel attempt. tensionAccuracy ∈ [0..1]: how well the player
 * kept the tension bar in the green zone. reactionMs: how long after
 * `bite` the player reacted (lower is better).
 *
 * @returns {{ ok, fish, qualityScore, reason? }}
 */
export function resolveFishCatch({ sessionId, reactionMs = 1000, tensionAccuracy = 0.5, fishingSkill = 0 } = {}) {
  const s = _sessions.get(sessionId);
  if (!s) return { ok: false, error: "session_not_found" };
  if (s.resolved) return { ok: false, error: "already_resolved" };
  s.resolved = true;
  if (Date.now() < s.biteAt) return { ok: false, error: "no_bite_yet" };
  if (Date.now() > s.biteAt + 8000) return { ok: false, error: "missed_window" };

  // Skill-weighted pick from candidate pool. Player skill biases toward
  // rarer fish at higher levels; tensionAccuracy adjusts both pick
  // weight and final quality score.
  //
  // F5 fix: if `pickBiteFish` already chose a species for this session (the
  // normal path — the bite event picks it so the client can show the real
  // species mid-fight), honor that pick instead of re-rolling here. Direct
  // callers that skip the bite-time pick (older tests, any future caller
  // that resolves without going through the route) still get a same-tick
  // roll as a fallback, unaffected.
  const skillBias = Math.max(0, Math.min(1.5, Number(fishingSkill) / 100));
  const accuracyBias = Math.max(0, Math.min(1, Number(tensionAccuracy) || 0));
  const reactionBias = reactionMs < 600 ? 0.2 : reactionMs < 1200 ? 0.0 : -0.2;

  let chosen = s.fish;
  if (!chosen) {
    // Build weighted cumulative
    const weights = s.candidatePool.map((f) => {
      const base = RARITY_WEIGHTS[f.rarity] ?? 0.4;
      // Higher skill + accuracy nudges weight toward rare. Common fish
      // weight is reduced; rare fish weight is amplified.
      const rarityFactor = f.rarity === "legendary" ? (1 + skillBias + accuracyBias) :
                            f.rarity === "rare"      ? (1 + skillBias * 0.8) :
                            f.rarity === "uncommon"  ? (1 + skillBias * 0.4) :
                            1.0;
      return base * rarityFactor;
    });
    const totalWeight = weights.reduce((s2, w) => s2 + w, 0);
    if (totalWeight <= 0) return { ok: false, error: "weights_zero" };
    let pick = Math.random() * totalWeight;
    chosen = s.candidatePool[s.candidatePool.length - 1];
    for (let i = 0; i < s.candidatePool.length; i++) {
      pick -= weights[i];
      if (pick <= 0) { chosen = s.candidatePool[i]; break; }
    }
  }

  const qualityScore = Math.max(0, Math.min(1,
    accuracyBias * 0.6 + skillBias * 0.2 + reactionBias * 0.2 + 0.2,
  ));
  const tier = qualityScore >= TENSION_PERFECT ? "perfect" :
               qualityScore >= TENSION_GOOD    ? "good" :
               qualityScore >= TENSION_POOR    ? "fair" : "poor";

  return { ok: true, fish: chosen, qualityScore, tier };
}

const CATCH_HISTORY_CAP = 10;

/**
 * Mint the catch into player_inventory.
 *
 * F2 fix (fishing lens review, 2026-11-01): player_inventory's PRIMARY KEY is
 * (user_id, item_id) — set by migration 035 and never changed (migration 294
 * only patched missing COLUMNS onto that same table; it did not touch the
 * key). A bare INSERT with a fixed `item_id = raw_fish:<speciesId>` throws a
 * UNIQUE-constraint error on the player's SECOND catch of the same species —
 * the exact "10 'Caught' dialogs, 6 log rows" symptom the review measured.
 * The fallback INSERT hit the identical PK, so it failed too; both failures
 * were silently swallowed, and the caller never learned the mint had failed.
 *
 * The fix follows the SAME select-existing-then-stack idiom every other
 * item-granting path in this codebase already uses (see
 * `lib/loot-generator.js#claimLootBagToInventory`): a repeat catch of a
 * species increments that row's quantity instead of colliding. Each catch's
 * quality is preserved (capped history, not just the latest overwrite) so no
 * data is lost — the row holds `history: [{qualityScore, sessionId, at}]` for
 * the session-local detail view, and `quantity` for the honest total count.
 */
export function mintFishCatch(db, { userId, worldId = "concordia-hub", fish, qualityScore = 0.5, sessionId }) {
  if (!db || !userId || !fish) return { ok: false, error: "missing_args" };
  const itemId = `raw_fish:${fish.id}`;
  const historyEntry = { qualityScore, sessionId, at: Math.floor(Date.now() / 1000) };
  try {
    const existing = db.prepare(
      "SELECT id, metadata FROM player_inventory WHERE user_id = ? AND item_id = ?",
    ).get(userId, itemId);
    if (existing) {
      let meta = {};
      try { meta = existing.metadata ? JSON.parse(existing.metadata) : {}; } catch { meta = {}; }
      const history = Array.isArray(meta.history) ? meta.history : [];
      history.push(historyEntry);
      while (history.length > CATCH_HISTORY_CAP) history.shift();
      db.prepare(`
        UPDATE player_inventory
        SET quantity = quantity + 1,
            item_name = ?,
            acquired_at = unixepoch(),
            metadata = ?
        WHERE id = ?
      `).run(
        `${fish.name} (${(qualityScore * 100).toFixed(0)}%)`,
        JSON.stringify({ qualityScore, sessionId, buffOnCook: fish.buffOnCook || null, history }),
        existing.id,
      );
      return { ok: true, inventoryId: existing.id, fish: fish.id, qualityScore, stacked: true };
    }
    const id = `inv_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12)}`;
    db.prepare(`
      INSERT INTO player_inventory
        (id, user_id, world_id, item_type, item_id, item_name, quantity, schema_id, acquired_at, metadata)
      VALUES (?, ?, ?, 'raw_fish', ?, ?, 1, ?, unixepoch(), ?)
    `).run(
      id, userId, worldId, itemId,
      `${fish.name} (${(qualityScore * 100).toFixed(0)}%)`,
      fish.id,
      JSON.stringify({ qualityScore, sessionId, buffOnCook: fish.buffOnCook || null, history: [historyEntry] }),
    );
    return { ok: true, inventoryId: id, fish: fish.id, qualityScore, stacked: false };
  } catch (e) {
    // If the schema is mismatched (item_name column missing etc on a
    // partially-migrated DB), fall back to a minimal insert/update so the
    // catch still lands rather than vanishing.
    try {
      const existing = db.prepare(
        "SELECT id FROM player_inventory WHERE user_id = ? AND item_id = ?",
      ).get(userId, itemId);
      if (existing) {
        db.prepare("UPDATE player_inventory SET quantity = quantity + 1, acquired_at = unixepoch() WHERE id = ?")
          .run(existing.id);
        return { ok: true, inventoryId: existing.id, fish: fish.id, qualityScore, stacked: true, fallback: true };
      }
      const id = `inv_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12)}`;
      db.prepare(`
        INSERT INTO player_inventory (id, user_id, world_id, item_id, quantity, acquired_at)
        VALUES (?, ?, ?, ?, 1, unixepoch())
      `).run(id, userId, worldId, itemId);
      return { ok: true, inventoryId: id, fish: fish.id, qualityScore, stacked: false, fallback: true };
    } catch (e2) {
      return { ok: false, error: e2.message };
    }
  }
}

export {
  RARITY_WEIGHTS,
  BITE_MIN_MS,
  BITE_MAX_MS,
  TENSION_PERFECT,
  TENSION_GOOD,
  TENSION_HINT_CAP,
};
