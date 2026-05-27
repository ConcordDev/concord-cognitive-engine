// server/lib/user-player-profile.js
//
// Wave A / A3 — compiles per-user playstyle profiles. Read by
// narrative-bridge.js to inject `player_profile` into NPC dialogue
// prompts so the LLM doesn't need to re-derive "who is this player"
// every turn.
//
// Public API:
//   compileProfile(db, userId, opts?) -> { ok, profile }
//   getProfile(db, userId)            -> profile row | null
//   activitySignature(db, userId)     -> sha1 (used to skip no-op recompiles)
//
// The dialogue_signature is intentionally short (≤ 240 chars). Long
// LLM-friendly prose belongs in summary_json / lineage_summary.

import crypto from "crypto";

export function getProfile(db, userId) {
  if (!db || !userId) return null;
  try {
    const row = db.prepare(`SELECT * FROM user_player_profiles WHERE user_id = ?`).get(userId);
    if (!row) return null;
    return _decode(row);
  } catch { return null; }
}

/** Cheap input hash so we only recompile when the player has done something new. */
export function activitySignature(db, userId) {
  if (!db || !userId) return null;
  try {
    const skillSig = db.prepare(`
      SELECT COUNT(*) AS n, MAX(level) AS lv, MAX(xp) AS xp FROM player_skill_levels WHERE user_id = ?
    `).get(userId);
    const invSig = db.prepare(`
      SELECT COUNT(*) AS n, MAX(quality) AS q FROM player_inventory WHERE user_id = ?
    `).get(userId);
    let spellSig = { n: 0, dmg: 0 };
    try {
      spellSig = db.prepare(`
        SELECT COUNT(*) AS n, MAX(max_damage) AS dmg FROM player_glyph_spells WHERE user_id = ?
      `).get(userId) || spellSig;
    } catch { /* table absent on minimal builds */ }
    const payload = JSON.stringify({ s: skillSig, i: invSig, g: spellSig });
    return crypto.createHash("sha1").update(payload).digest("hex");
  } catch { return null; }
}

/**
 * Compile and persist a profile for `userId`. Pure deterministic
 * compilation — no LLM call. (LLM-flavored prose can layer on top in
 * a later prompt-registry pass; we keep the substrate deterministic
 * for testability.)
 */
export function compileProfile(db, userId, _opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!userId) return { ok: false, reason: "no_user" };

  try {
    const skills = _topSkills(db, userId);
    const inv = _inventoryAffinities(db, userId);
    const spells = _spellSignature(db, userId);
    const demos = _demonstrationCount(db, userId);

    const playstyle = {
      topSkills: skills,
      dominantElement: spells.dominantElement,
      spellSchool: spells.dominantSchool,
      weaponAffinity: inv.weaponCategoryTop,
      weaponClassTop: inv.weaponClassTop,
      rarityHistogram: inv.rarityHistogram,
      demonstrations: demos,
    };

    const giftPrefs = _giftPreferences(playstyle, inv);
    const lineageSummary = _composeLineageSummary(playstyle);
    const dialogueSignature = _composeDialogueSignature(playstyle);
    const sig = activitySignature(db, userId);

    db.prepare(`
      INSERT INTO user_player_profiles
        (user_id, dialogue_signature, lineage_summary, playstyle_json, gift_preferences_json,
         last_compiled_at, activity_signature)
      VALUES (?, ?, ?, ?, ?, unixepoch(), ?)
      ON CONFLICT(user_id) DO UPDATE SET
        dialogue_signature   = excluded.dialogue_signature,
        lineage_summary      = excluded.lineage_summary,
        playstyle_json       = excluded.playstyle_json,
        gift_preferences_json= excluded.gift_preferences_json,
        last_compiled_at     = excluded.last_compiled_at,
        activity_signature   = excluded.activity_signature
    `).run(
      userId, dialogueSignature, lineageSummary,
      JSON.stringify(playstyle), JSON.stringify(giftPrefs), sig,
    );

    return {
      ok: true,
      profile: { userId, dialogueSignature, lineageSummary, playstyle, giftPrefs, activitySignature: sig },
    };
  } catch (err) {
    return { ok: false, reason: "compile_failed", message: err?.message };
  }
}

function _topSkills(db, userId) {
  try {
    return db.prepare(`
      SELECT skill_type, level, xp
      FROM player_skill_levels
      WHERE user_id = ?
      ORDER BY level DESC, xp DESC
      LIMIT 3
    `).all(userId);
  } catch { return []; }
}

function _inventoryAffinities(db, userId) {
  try {
    const rows = db.prepare(`
      SELECT weapon_class, quality, item_type
      FROM player_inventory
      WHERE user_id = ?
      LIMIT 200
    `).all(userId);
    const classCounts = {};
    const rarityBuckets = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
    for (const r of rows) {
      if (r.weapon_class) classCounts[r.weapon_class] = (classCounts[r.weapon_class] || 0) + 1;
      const q = Number(r.quality) || 0;
      if (q >= 91) rarityBuckets.legendary++;
      else if (q >= 71) rarityBuckets.epic++;
      else if (q >= 51) rarityBuckets.rare++;
      else if (q >= 31) rarityBuckets.uncommon++;
      else              rarityBuckets.common++;
    }
    const sortedClasses = Object.entries(classCounts).sort((a, b) => b[1] - a[1]);
    const weaponClassTop = sortedClasses[0]?.[0] ?? null;
    // Resolve to category via WEAPON_CLASS_INFO if available.
    let weaponCategoryTop = null;
    if (weaponClassTop) {
      try {
        const lo = require_loadout();
        weaponCategoryTop = lo?.WEAPON_CLASS_INFO?.[weaponClassTop]?.category ?? null;
      } catch { /* loadout optional */ }
    }
    return { weaponClassTop, weaponCategoryTop, rarityHistogram: rarityBuckets };
  } catch {
    return { weaponClassTop: null, weaponCategoryTop: null, rarityHistogram: {} };
  }
}

function require_loadout() {
  // Best-effort sync wrapper — we expect this module loaded earlier in the
  // boot path. If not, return null and the caller degrades gracefully.
  try {
    // ESM requires dynamic import normally; this module path is stable.
    // We use require here only for sync access; fallback to null on failure.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return { WEAPON_CLASS_INFO: globalThis.__concordWeaponClassInfo || null };
  } catch { return null; }
}

function _spellSignature(db, userId) {
  try {
    const rows = db.prepare(`
      SELECT element, max_damage FROM player_glyph_spells WHERE user_id = ? LIMIT 100
    `).all(userId);
    const counts = {};
    for (const r of rows) if (r.element) counts[r.element] = (counts[r.element] || 0) + 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return { dominantElement: sorted[0]?.[0] ?? null, dominantSchool: null, total: rows.length };
  } catch {
    return { dominantElement: null, dominantSchool: null, total: 0 };
  }
}

function _demonstrationCount(db, userId) {
  try {
    return db.prepare(`
      SELECT COUNT(*) AS n FROM skill_demonstration_log WHERE caster_user_id = ?
    `).get(userId)?.n ?? 0;
  } catch { return 0; }
}

function _composeLineageSummary(p) {
  const parts = [];
  if (p.dominantElement) parts.push(`${p.dominantElement}-aligned`);
  if (p.weaponClassTop)  parts.push(`${p.weaponClassTop}-wielder`);
  const lvSum = (p.topSkills || []).reduce((s, x) => s + x.level, 0);
  if (lvSum >= 20)       parts.push("seasoned");
  else if (lvSum >= 8)   parts.push("competent");
  else                   parts.push("novice");
  if ((p.rarityHistogram?.legendary ?? 0) >= 1) parts.push("hoards legendary gear");
  else if ((p.rarityHistogram?.epic ?? 0) >= 2) parts.push("epic-rarity collector");
  if ((p.demonstrations ?? 0) >= 5) parts.push("teaches via demonstration");
  return parts.length === 0 ? "uncharted character" : parts.join("; ");
}

function _composeDialogueSignature(p) {
  // Short prompt-friendly line. Used in the LLM context window.
  const lineage = _composeLineageSummary(p);
  const top = (p.topSkills || []).slice(0, 2).map((s) => `${s.skill_type} Lv${s.level}`).join(" + ");
  return top ? `${lineage}. Currently: ${top}.` : `${lineage}.`;
}

function _giftPreferences(playstyle, inv) {
  const preferredCategories = [];
  if (playstyle.weaponAffinity) preferredCategories.push(playstyle.weaponAffinity);
  if (playstyle.dominantElement) preferredCategories.push("focus");   // mages like focus items
  const preferredRarity = (inv.rarityHistogram?.legendary ?? 0) >= 1 ? "legendary"
                        : (inv.rarityHistogram?.epic ?? 0) >= 2 ? "epic"
                        : "rare";
  return {
    preferredCategories,
    preferredElements: playstyle.dominantElement ? [playstyle.dominantElement] : [],
    preferredRarity,
    avoidsKinds: [],
  };
}

function _decode(r) {
  return {
    userId: r.user_id,
    dialogueSignature: r.dialogue_signature,
    lineageSummary: r.lineage_summary,
    playstyle: _tryJSON(r.playstyle_json),
    giftPrefs: _tryJSON(r.gift_preferences_json),
    lastCompiledAt: r.last_compiled_at,
    activitySignature: r.activity_signature,
  };
}

function _tryJSON(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

export const _internal = { _composeLineageSummary, _composeDialogueSignature, _giftPreferences };
