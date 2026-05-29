// server/lib/faction-strength.js
//
// WS5 — kingdom/faction STRUCTURAL strength.
//
// "A faction is only as strong as its leaders and how they train it." Layer 11
// gave factions a behavioural state machine (stance/momentum) but no structural
// power: a military-tax kingdom that conscripts and trains should field a
// genuinely stronger force than an economy-focused one. This module computes a
// faction's strength from real substrate:
//   - its leader's level (rulers matter most),
//   - its members' levels + headcount (how well it's trained / how many),
//   - its realm setup (conscription decrees, tax→treasury, legitimacy).
//
// resolveFactionClash turns two strengths into a winner + momentum swing, which
// the strategy cycle uses to make wars and raids actually decisive and to fire
// organic hot-events. All reads are guarded so minimal builds (no world_npcs /
// realms) degrade to a neutral strength of 0 instead of crashing.

function envNum(name, dflt, { min = -Infinity, max = Infinity } = {}) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= min && v <= max ? v : dflt;
}

export const STRENGTH_DIALS = Object.freeze({
  leaderWeight: envNum("CONCORD_FACTION_LEADER_WEIGHT", 3, { min: 0 }),
  memberWeight: envNum("CONCORD_FACTION_MEMBER_WEIGHT", 1, { min: 0 }),
  countWeight: envNum("CONCORD_FACTION_COUNT_WEIGHT", 2, { min: 0 }),
  conscriptionBonus: envNum("CONCORD_FACTION_CONSCRIPTION_BONUS", 0.3, { min: 0 }),
});

function tableExists(db, name) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name); }
  catch { return false; }
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * Compute a faction's structural combat strength. Returns a breakdown so callers
 * (and tests) can see what drove it. Crash-safe; 0 for an unknown/empty faction.
 */
export function computeFactionStrength(db, factionId) {
  const empty = { factionId, strength: 0, members: 0, leaderLevel: 0, base: 0, realmMult: 1, realm: null };
  if (!db || !factionId || !tableExists(db, "world_npcs")) return empty;

  let rows = [];
  try {
    rows = db.prepare(`
      SELECT level FROM world_npcs
      WHERE faction = ? AND COALESCE(is_dead, 0) = 0
      LIMIT 1000
    `).all(factionId);
  } catch { return empty; }
  if (!rows.length) return empty;

  let leaderLevel = 0, sum = 0;
  for (const r of rows) { const l = Number(r.level) || 1; sum += l; if (l > leaderLevel) leaderLevel = l; }
  const count = rows.length;
  const d = STRENGTH_DIALS;
  const base = leaderLevel * d.leaderWeight + sum * d.memberWeight + count * d.countWeight;

  // Realm setup multiplier — the "how it's run" axis.
  let realm = null;
  let realmMult = 1;
  if (tableExists(db, "realms")) {
    try {
      const rl = db.prepare(`
        SELECT id, tax_rate, treasury, legitimacy, ruler_id FROM realms WHERE faction_id = ? LIMIT 1
      `).get(factionId);
      if (rl) {
        let conscription = 0;
        if (tableExists(db, "realm_decrees")) {
          try {
            conscription = db.prepare(`
              SELECT COUNT(*) AS n FROM realm_decrees
              WHERE kingdom_id = ? AND kind = 'conscription' AND effect_state = 'active'
            `).get(rl.id)?.n || 0;
          } catch { /* ignore */ }
        }
        realmMult = 1
          + (conscription > 0 ? d.conscriptionBonus : 0)
          + clamp((Number(rl.tax_rate ?? 0.1) - 0.1) * 1.0, -0.05, 0.4)   // tax funds the army
          + clamp((Number(rl.legitimacy ?? 50) - 50) / 200, -0.25, 0.25)  // legitimacy → cohesion
          + Math.min(0.3, (Number(rl.treasury ?? 0)) / 10000);            // war chest
        realmMult = clamp(realmMult, 0.5, 2.5);
        realm = { id: rl.id, taxRate: rl.tax_rate, treasury: rl.treasury, legitimacy: rl.legitimacy, conscription, rulerId: rl.ruler_id };
      }
    } catch { /* realm optional */ }
  }

  return {
    factionId,
    strength: Math.round(base * realmMult),
    members: count,
    leaderLevel,
    base: Math.round(base),
    realmMult: Math.round(realmMult * 1000) / 1000,
    realm,
  };
}

/**
 * Resolve a clash between two factions by structural strength. Returns the
 * winner/loser + a momentum swing proportional to the margin (decisive blowouts
 * swing harder than close fights). Pure given the two strength reads.
 */
export function resolveFactionClash(db, aId, bId) {
  const a = computeFactionStrength(db, aId);
  const b = computeFactionStrength(db, bId);
  const total = a.strength + b.strength;
  if (total <= 0) {
    return { draw: true, aStrength: 0, bStrength: 0, winner: null, loser: null, margin: 0, winnerMomentum: 0, loserMomentum: 0 };
  }
  const margin = Math.abs(a.strength - b.strength) / total; // 0 (even) .. 1 (blowout)
  const swing = Math.round((0.05 + margin * 0.15) * 1000) / 1000; // 0.05 .. 0.20
  const aWins = a.strength >= b.strength;
  return {
    draw: false,
    aStrength: a.strength,
    bStrength: b.strength,
    winner: aWins ? aId : bId,
    loser: aWins ? bId : aId,
    margin: Math.round(margin * 1000) / 1000,
    winnerMomentum: swing,
    loserMomentum: -swing,
    breakdown: { a, b },
  };
}
