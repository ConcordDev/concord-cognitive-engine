// server/lib/conkay-affect.js
//
// ConKay Voice + Affect fusion (#15) — gives the ConKay assistant a PERSISTENT
// affect state derived from real VAD (valence/arousal/dominance) analysis of the
// user's words, EMA-blended across turns with a decay toward neutral, then mapped
// to real TTS prosody parameters and a one-line persona note. Deterministic
// lexicon-based sentiment (the same approach as domains/affect.js) — every value
// traces to analyzed input; nothing is fabricated. The STT/TTS device I/O is the
// existing real voice adapter; this module produces the prosody it consumes.

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const round = (v) => Math.round(v * 1000) / 1000;

// Compact real VAD lexicon (valence, arousal, dominance), 0..1.
const LEX = {
  happy: [0.9, 0.6, 0.7], joy: [0.95, 0.7, 0.7], love: [0.95, 0.7, 0.5], great: [0.85, 0.5, 0.6],
  excellent: [0.9, 0.5, 0.7], wonderful: [0.9, 0.6, 0.6], amazing: [0.9, 0.75, 0.6], good: [0.7, 0.4, 0.55],
  nice: [0.7, 0.3, 0.5], like: [0.6, 0.3, 0.5], thanks: [0.75, 0.35, 0.5], excited: [0.8, 0.85, 0.6],
  calm: [0.6, 0.15, 0.6], okay: [0.5, 0.2, 0.5], fine: [0.5, 0.2, 0.5],
  sad: [0.12, 0.3, 0.25], unhappy: [0.15, 0.35, 0.3], angry: [0.15, 0.85, 0.7], furious: [0.05, 0.95, 0.8],
  hate: [0.05, 0.8, 0.7], terrible: [0.1, 0.7, 0.3], awful: [0.1, 0.6, 0.3], bad: [0.25, 0.5, 0.4],
  frustrated: [0.2, 0.7, 0.45], anxious: [0.25, 0.75, 0.3], worried: [0.25, 0.6, 0.3], afraid: [0.15, 0.8, 0.2],
  confused: [0.35, 0.5, 0.35], tired: [0.35, 0.2, 0.35], stressed: [0.2, 0.75, 0.35], broken: [0.15, 0.5, 0.3],
};
const NEUTRAL = { valence: 0.5, arousal: 0.3, dominance: 0.5 };

/** Real lexicon VAD over a string, with simple negation handling. Pure. */
export function analyzeAffect(text) {
  const toks = String(text || "").toLowerCase().match(/[a-z']+/g) || [];
  let n = 0, v = 0, a = 0, d = 0, neg = false;
  for (const t of toks) {
    if (t === "not" || t === "no" || t === "never" || t === "n't") { neg = true; continue; }
    const e = LEX[t];
    if (e) {
      const vv = neg ? 1 - e[0] : e[0];
      v += vv; a += e[1]; d += neg ? 1 - e[2] : e[2]; n++;
    }
    neg = false;
  }
  if (!n) return { ...NEUTRAL, hits: 0 };
  return { valence: round(v / n), arousal: round(a / n), dominance: round(d / n), hits: n };
}

/** Read the stored state (or the neutral default). */
export function getAffectState(db, userId) {
  if (!db || !userId) return { ...NEUTRAL, turns: 0 };
  try {
    const r = db.prepare(`SELECT valence, arousal, dominance, turns FROM conkay_affect_state WHERE user_id = ?`).get(String(userId));
    return r || { ...NEUTRAL, turns: 0 };
  } catch {
    return { ...NEUTRAL, turns: 0 };
  }
}

/**
 * Observe a user turn: analyze its affect and EMA-blend it into the stored state
 * (alpha new, plus a small pull back toward neutral so old moods fade). Returns
 * the new persisted state. Deterministic.
 */
export function observeTurn(db, userId, text, { alpha = 0.4, decay = 0.1 } = {}) {
  if (!db || !userId) return { ...NEUTRAL, turns: 0 };
  const cur = getAffectState(db, userId);
  const m = analyzeAffect(text);
  // Only move toward measured affect when the text actually carried signal.
  const w = m.hits > 0 ? alpha : 0;
  // new = lerp(cur, measured, w), then ease toward neutral by decay (old moods fade).
  const lerp = (c, x) => c + w * (x - c);
  const ease = (c, neutral) => c + decay * (neutral - c);
  const valence = round(ease(lerp(cur.valence, m.valence), NEUTRAL.valence));
  const arousal = round(ease(lerp(cur.arousal, m.arousal), NEUTRAL.arousal));
  const dominance = round(ease(lerp(cur.dominance, m.dominance), NEUTRAL.dominance));
  const turns = (cur.turns || 0) + 1;
  try {
    db.prepare(`
      INSERT INTO conkay_affect_state (user_id, valence, arousal, dominance, turns, updated_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(user_id) DO UPDATE SET valence = excluded.valence, arousal = excluded.arousal,
        dominance = excluded.dominance, turns = excluded.turns, updated_at = unixepoch()
    `).run(String(userId), valence, arousal, dominance, turns);
  } catch { /* persist best-effort */ }
  return { valence, arousal, dominance, turns, measured: m };
}

/**
 * Map affect → real ElevenLabs prosody parameters. High arousal lowers stability
 * (more expressive/variable); strong valence (either way) raises style; high
 * dominance firms similarity_boost. All clamped to ElevenLabs' 0..1 ranges.
 */
export function prosodyParams(state) {
  const s = state || NEUTRAL;
  const intensity = Math.abs((s.valence ?? 0.5) - 0.5) * 2; // 0 neutral .. 1 strong
  return {
    stability: round(clamp01(0.75 - (s.arousal ?? 0.3) * 0.5)),
    similarity_boost: round(clamp01(0.6 + (s.dominance ?? 0.5) * 0.3)),
    style: round(clamp01(intensity * 0.6 + (s.arousal ?? 0.3) * 0.2)),
  };
}

/** A one-line mood note for the persona context (composeSystemPrompt). */
export function affectNote(state) {
  const s = state || NEUTRAL;
  const v = s.valence ?? 0.5, a = s.arousal ?? 0.3;
  const tone = v >= 0.66 ? "upbeat" : v <= 0.34 ? "subdued" : "even";
  const energy = a >= 0.66 ? "energized" : a <= 0.25 ? "calm" : "steady";
  return `The user currently reads ${tone} and ${energy}; match that register without overplaying it.`;
}

export default { analyzeAffect, getAffectState, observeTurn, prosodyParams, affectNote };
