// server/lib/combat/attack-cooldown.js
//
// T2.9 — per-action-class attack cooldown.
//
// The combat:attack socket handler used ONE shared 250ms gate (_lastAttackAt).
// But light/heavy/kick/grab all arrive as combat:attack, so a kick chained after
// a light within 250ms was silently DROPPED server-side — after the client had
// already predicted + animated it (G2.1), producing a visible desync.
//
// This replaces the single gate with independent per-class cooldowns plus a
// global anti-spam floor: a light→kick combo lands (separate tracks), but you
// can't dump every class on one frame. Pure + total so it unit-tests cleanly;
// the socket handler keeps one state object per connection.

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

// Per-class cooldowns (ms). Env-overridable for the future balance pass.
export const ATTACK_COOLDOWN_MS = Object.freeze({
  "attack-light": num(process.env.CONCORD_COMBAT_CD_LIGHT, 250),
  "attack-heavy": num(process.env.CONCORD_COMBAT_CD_HEAVY, 420),
  kick: num(process.env.CONCORD_COMBAT_CD_KICK, 300),
  grab: num(process.env.CONCORD_COMBAT_CD_GRAB, 320),
});
// Absolute floor between ANY two attacks regardless of class (anti-spam).
export const ATTACK_GLOBAL_FLOOR_MS = num(process.env.CONCORD_COMBAT_CD_FLOOR, 120);

/**
 * Map a client-reported style/actionOverride to a cooldown class.
 * @param {string} style  e.g. 'attack-light' | 'attack-heavy' | 'air-blast' |
 *                         'vehicle-ram' | 'kick' | 'dismount-kick' | 'grab' |
 *                         'aerial-grab' | 'hack-breach'
 */
export function attackClassFor(style) {
  const s = String(style || "").toLowerCase();
  if (s.includes("heavy") || s.includes("dive") || s.includes("ram")) return "attack-heavy";
  if (s.includes("kick") || s.includes("dismount")) return "kick";
  if (s.includes("grab") || s.includes("breach")) return "grab";
  return "attack-light";
}

/** Fresh per-connection state. */
export function newCooldownState() {
  return { lastByClass: Object.create(null), lastAny: 0 };
}

/**
 * Decide whether an attack of `style` may fire at `now` given prior `state`.
 * Returns { allowed, cls, retryInMs }. On allow, MUTATES state (stamps the
 * class + global timestamps) — the caller passes the same object each call.
 */
export function checkAttackCooldown(state, now, style) {
  if (!state) state = newCooldownState();
  const cls = attackClassFor(style);
  const t = Number(now) || 0;

  // Global anti-spam floor — can't fire any two attacks closer than the floor.
  const sinceAny = t - (state.lastAny || 0);
  if (sinceAny < ATTACK_GLOBAL_FLOOR_MS) {
    return { allowed: false, cls, retryInMs: ATTACK_GLOBAL_FLOOR_MS - sinceAny };
  }
  // Per-class cooldown — independent tracks, so a kick after a light lands.
  const cd = ATTACK_COOLDOWN_MS[cls] ?? ATTACK_COOLDOWN_MS["attack-light"];
  const sinceClass = t - (state.lastByClass[cls] || 0);
  if (sinceClass < cd) {
    return { allowed: false, cls, retryInMs: cd - sinceClass };
  }
  state.lastByClass[cls] = t;
  state.lastAny = t;
  return { allowed: true, cls, retryInMs: 0 };
}
