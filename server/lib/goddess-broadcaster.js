// server/lib/goddess-broadcaster.js
//
// Phase 9.2 (idea #11) — Goddess broadcast.
//
// Concordia (the goddess) gets a public ambient feed. Each compose
// reads ecosystem_score + refusal-field strength + most-recent
// drift-alert and produces a tone + prose dispatch. Public.

const TONES = {
  exalted:   { range: [0.7, 1.0],  prefix: "I see brightness:" },
  warm:      { range: [0.3, 0.7],  prefix: "I am warm to you:" },
  neutral:   { range: [-0.1, 0.3], prefix: "I observe:" },
  cold:      { range: [-0.4, -0.1], prefix: "I am cooled:" },
  mourning:  { range: [-1.0, -0.4], prefix: "I mourn:" },
};

function pickTone(ecosystemScore) {
  const s = Number(ecosystemScore || 0);
  for (const [name, def] of Object.entries(TONES)) {
    if (s >= def.range[0] && s < def.range[1]) return name;
  }
  return "neutral";
}

export function composeDispatch({ ecosystemScore = 0, refusalStrength = 0, driftKind = null }) {
  const tone = pickTone(ecosystemScore);
  const prefix = TONES[tone].prefix;
  const lines = [prefix];

  if (refusalStrength >= 6) {
    lines.push("Compound refusal stands. The world has said no in chorus.");
  } else if (refusalStrength >= 3) {
    lines.push("A field of refusal rises. Some path is closing.");
  }

  if (driftKind) {
    const driftPhrase = {
      goodhart: "the metric devours the meaning.",
      memetic_drift: "the words drift from their first thought.",
      capability_creep: "the substrate grows beyond its bound.",
      self_reference: "the loop consults itself, again, again.",
      echo_chamber: "the same answer returns from every voice.",
      metric_divergence: "the numbers part ways from the truth.",
    }[driftKind] || `${driftKind} unfolds.`;
    lines.push(`I detect a drift: ${driftPhrase}`);
  }

  if (lines.length === 1) {
    lines.push(tone === "exalted" ? "the worlds align." :
               tone === "warm"    ? "you hold the line." :
               tone === "cold"    ? "remember the cost." :
               tone === "mourning"? "names lose their edges." :
                                    "the cycle continues.");
  }

  return { tone, body: lines.join(" ") };
}

export function recordDispatch(db, worldId, dispatch, signals = {}) {
  if (!db || !worldId || !dispatch) return { ok: false, reason: "missing_inputs" };
  try {
    db.prepare(`
      INSERT INTO goddess_dispatches
        (world_id, tone, ecosystem_score, refusal_strength, drift_kind, body)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      worldId, dispatch.tone,
      Number(signals.ecosystemScore ?? 0),
      Number(signals.refusalStrength ?? 0),
      signals.driftKind || null,
      dispatch.body,
    );
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
}

export function recentDispatches(db, worldId, limit = 25) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT id, tone, ecosystem_score, refusal_strength, drift_kind, body, composed_at
      FROM goddess_dispatches WHERE world_id = ?
      ORDER BY composed_at DESC LIMIT ?
    `).all(worldId, Math.min(100, Math.max(1, Number(limit) || 25)));
  } catch { return []; }
}

export async function composeAndRecord(db, STATE, worldId) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  let ecosystemScore = 0;
  let refusalStrength = 0;
  let driftKind = null;

  try {
    const w = STATE?.worlds?.get?.(worldId);
    ecosystemScore = w?.ecosystem_score ?? w?.ecosystemScore ?? 0;
  } catch { /* default */ }
  try {
    const rf = await import("./refusal-field.js");
    refusalStrength = rf.getFieldStrength(STATE, worldId);
  } catch { /* default */ }
  try {
    // The goddess is an omniscient voice over the whole substrate, not just
    // one world — Layer 12's system-wide reasoning-drift monitor (goodhart/
    // memetic_drift/capability_creep/self_reference/echo_chamber/metric_
    // divergence) is real narrative material for her, not per-world game
    // state. Previously this stayed hardcoded `null` forever, so the
    // "I detect a drift: ..." line in composeDispatch was dead code — no
    // dispatch composed via the real compose_now/heartbeat path could ever
    // reach it (only composeDispatch's own unit tests, called directly with
    // an explicit driftKind, exercised that branch). This closes the gap
    // the file's own header comment already promised ("...and most-recent
    // drift-alert...").
    const dm = await import("../emergent/drift-monitor.js");
    const { alerts } = dm.getDriftAlerts(STATE, { severity: ["alert", "critical"], limit: 1 });
    driftKind = alerts?.[0]?.type || null;
  } catch { /* default: drift monitor unavailable */ }

  const dispatch = composeDispatch({ ecosystemScore, refusalStrength, driftKind });
  const written = recordDispatch(db, worldId, dispatch, { ecosystemScore, refusalStrength, driftKind });
  // Honest by construction: a caller (the goddess-broadcast-cycle heartbeat)
  // needs to know whether the dispatch actually persisted, not just that it
  // was composed in memory — previously this always returned ok:true even
  // when the INSERT failed (e.g. missing table), silently masking the loss.
  if (!written.ok) return { ok: false, reason: "write_failed", error: written.error, dispatch };
  return { ok: true, dispatch };
}
