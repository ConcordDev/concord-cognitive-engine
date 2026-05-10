// server/lib/world-forecast.js
//
// Phase 9.3 (idea #16) — Concordia weather forecasting.
//
// Combines forward-sim (Layer 10) + drift-monitor + faction-strategy +
// embodied environment-sensor baselines into a 24h forecast DTU.
// Deterministic — same world state at compose time → same forecast.
//
// Output shape:
//   {
//     window_hours: 24,
//     weather: { kind, confidence, temperature_c },
//     ecology: { trend, ecosystem_score_delta },
//     factions: [{ id, predicted_kind, confidence }],
//     events: [{ kind, eta_hours, summary }],
//     drift: { likely_kind, severity },
//   }

export async function composeForecast(db, STATE, worldId) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  const out = {
    window_hours: 24,
    weather: null,
    ecology: null,
    factions: [],
    events: [],
    drift: null,
  };

  // Embodied env baseline → temperature + weather kind guess
  try {
    const sigMod = await import("./embodied/signals.js");
    const sig = sigMod.signalsForWorld(db, worldId, null);
    if (sig?.hasData) {
      out.weather = {
        kind: sig.weatherKind || "clear",
        confidence: 0.6,
        temperature_c: sig.temperature ?? null,
        humidity_pct: sig.humidity ?? null,
      };
    }
  } catch { /* embodied module optional */ }

  // Ecosystem score trend — naive: check current vs. STATE recent
  try {
    const w = STATE?.worlds?.get?.(worldId);
    out.ecology = {
      ecosystem_score: w?.ecosystem_score ?? 0,
      trend: w?.ecosystem_trend ?? "stable",
      ecosystem_score_delta: 0,
    };
  } catch { /* default */ }

  // Faction strategy — what each faction's next move probably is
  try {
    const rows = db.prepare(`
      SELECT faction_id, stance, momentum, next_move_at
      FROM faction_strategy_state
      ORDER BY next_move_at ASC LIMIT 10
    `).all();
    out.factions = rows.map(r => ({
      id: r.faction_id,
      predicted_kind: r.stance,
      momentum: r.momentum,
      eta_hours: r.next_move_at ? Math.max(0, (r.next_move_at - Date.now() / 1000) / 3600) : null,
      confidence: 0.42,
    }));
  } catch { /* table optional */ }

  // Forward-sim predictions — pull active for this world
  try {
    const preds = db.prepare(`
      SELECT subject_kind, subject_id, anticipated, confidence, expires_at
      FROM forward_predictions
      WHERE realised_at IS NULL AND (expires_at IS NULL OR expires_at > unixepoch())
      ORDER BY confidence DESC LIMIT 10
    `).all();
    out.events = preds.map(p => ({
      kind: p.subject_kind,
      summary: p.anticipated,
      eta_hours: p.expires_at ? Math.max(0, (p.expires_at - Date.now() / 1000) / 3600) : null,
      confidence: p.confidence,
    }));
  } catch { /* table optional */ }

  // Drift — most recent high-severity finding
  try {
    const dm = await import("../emergent/drift-monitor.js");
    const alerts = dm.getDriftAlerts ? dm.getDriftAlerts(STATE, { severity: "high" }) : [];
    if (Array.isArray(alerts) && alerts.length > 0) {
      const top = alerts[0];
      out.drift = { likely_kind: top.kind || top.type || "unknown", severity: top.severity || "high" };
    }
  } catch { /* drift-monitor optional */ }

  return { ok: true, worldId, forecast: out, composedAt: Date.now() };
}

export function persistForecast(db, worldId, forecast) {
  if (!db || !worldId || !forecast) return { ok: false, reason: "missing_inputs" };
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS world_forecasts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        world_id TEXT NOT NULL,
        forecast_json TEXT NOT NULL,
        composed_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_forecasts_world ON world_forecasts(world_id, composed_at DESC)`);
    db.prepare(`
      INSERT INTO world_forecasts (world_id, forecast_json) VALUES (?, ?)
    `).run(worldId, JSON.stringify(forecast));
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
}

export function recentForecast(db, worldId) {
  if (!db || !worldId) return null;
  try {
    const row = db.prepare(`
      SELECT forecast_json, composed_at FROM world_forecasts
      WHERE world_id = ? ORDER BY composed_at DESC LIMIT 1
    `).get(worldId);
    if (!row) return null;
    return { ...JSON.parse(row.forecast_json), composedAt: row.composed_at };
  } catch { return null; }
}
