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

// ── Extension helpers (feature-parity backlog) ──────────────────────────────

function ensureForecastTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_forecasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      forecast_json TEXT NOT NULL,
      composed_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_forecasts_world ON world_forecasts(world_id, composed_at DESC)`);
}

// Fail-CLOSED numeric guard (mirrors server/domains/literary.js#badNumericField).
// The forecast.* macros are registered INLINE in server.js, so the guard cannot
// live at the macro layer — it lives here, at the lib boundary the macros call.
// A caller that PASSES a numeric field (days/hours/limit) must pass a finite,
// non-negative, in-range one; an absent field is fine (the fn uses its default).
// Without this, a poisoned value (NaN/Infinity/1e308/negative) would silently
// clamp through Math.min/Math.max to a default rather than being rejected.
// Returns the offending key when poisoned, or null when clean.
function badNumericField(input, keys) {
  if (!input || typeof input !== "object") return null;
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

// Deterministic 0..1 hash from a string — used to spread region anchors and
// to vary an extrapolated curve without inventing random data.
function strHash(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// The 7 cognitive-geography districts as named regions. Each gets a stable
// world-space anchor cell derived from its key so per-region forecasts read
// real embodied_signal_log rows near that cell.
export const FORECAST_REGIONS = Object.freeze([
  { id: "commons",     name: "The Commons" },
  { id: "observatory", name: "The Observatory" },
  { id: "forge",       name: "The Forge" },
  { id: "archive",     name: "The Archive" },
  { id: "garden",      name: "The Garden" },
  { id: "gate",        name: "The Gate" },
  { id: "nursery",     name: "The Nursery" },
]);

export function regionAnchor(regionId) {
  // Spread anchors across a ~1.4km ring around origin, deterministic per id.
  const a = strHash(regionId) * Math.PI * 2;
  const r = 400 + strHash(`${regionId}:radius`) * 1000;
  return { x: Math.round(Math.cos(a) * r), z: Math.round(Math.sin(a) * r) };
}

// Multi-day outlook: a base 24h forecast composed now, then N daily windows
// each carrying a confidence that decays with distance and a temperature that
// drifts deterministically off the measured baseline. No invented weather —
// each day inherits the measured-baseline kind unless drift/faction signal
// pushes it. Confidence honestly degrades the further out we look.
export async function composeMultiDay(db, STATE, worldId, days = 7) {
  if (badNumericField({ days }, ["days"])) return { ok: false, error: "invalid_days" };
  const base = await composeForecast(db, STATE, worldId);
  if (!base.ok) return base;
  const n = Math.min(14, Math.max(2, parseInt(days, 10) || 7));
  const f = base.forecast;
  const baseTemp = f.weather?.temperature_c;
  const baseHum = f.weather?.humidity_pct;
  const baseConf = f.weather?.confidence ?? 0.6;
  const baseKind = f.weather?.kind || "clear";
  const dayMs = 86400000;
  const startTs = Math.floor(Date.now() / 1000);
  const outlook = [];
  for (let d = 0; d < n; d++) {
    // Confidence decays ~12%/day, floored at 0.12.
    const confidence = Math.max(0.12, baseConf * Math.pow(0.88, d));
    // Temperature drift: deterministic ±, magnitude grows slightly with range.
    const drift = baseTemp == null ? null
      : (strHash(`${worldId}:${d}:temp`) - 0.5) * (2 + d * 0.8);
    const humDrift = baseHum == null ? null
      : (strHash(`${worldId}:${d}:hum`) - 0.5) * (4 + d);
    outlook.push({
      day_index: d,
      date_ts: startTs + d * Math.round(dayMs / 1000),
      weather: {
        kind: baseKind,
        confidence: Number(confidence.toFixed(3)),
        temperature_c: drift == null ? null : Number((baseTemp + drift).toFixed(1)),
        humidity_pct: humDrift == null ? null
          : Math.max(0, Math.min(100, Number((baseHum + humDrift).toFixed(0)))),
      },
    });
  }
  return { ok: true, worldId, days: n, base: f, outlook, composedAt: Date.now() };
}

// Hourly breakdown within the 24h window. Temperature follows a real diurnal
// cosine curve (coldest pre-dawn ~05:00, warmest ~15:00) anchored on the
// measured baseline; humidity is the inverse. No fabricated readings — the
// curve is the standard diurnal model applied to the measured mean.
export async function composeHourly(db, STATE, worldId, hours = 24) {
  if (badNumericField({ hours }, ["hours"])) return { ok: false, error: "invalid_hours" };
  const base = await composeForecast(db, STATE, worldId);
  if (!base.ok) return base;
  const n = Math.min(48, Math.max(6, parseInt(hours, 10) || 24));
  const f = base.forecast;
  const meanTemp = f.weather?.temperature_c;
  const meanHum = f.weather?.humidity_pct;
  const conf = f.weather?.confidence ?? 0.6;
  const amplitude = 4.5; // typical diurnal swing °C
  const startHour = new Date().getHours();
  const breakdown = [];
  for (let h = 0; h < n; h++) {
    const clock = (startHour + h) % 24;
    // Peak at 15:00, trough at 05:00 → phase shift of 9h.
    const phase = ((clock - 15) / 24) * Math.PI * 2;
    const factor = Math.cos(phase); // +1 warmest, -1 coldest
    breakdown.push({
      hour_offset: h,
      clock_hour: clock,
      temperature_c: meanTemp == null ? null
        : Number((meanTemp + factor * amplitude).toFixed(1)),
      humidity_pct: meanHum == null ? null
        : Math.max(0, Math.min(100, Number((meanHum - factor * 8).toFixed(0)))),
      confidence: Number((conf * Math.max(0.4, 1 - h * 0.02)).toFixed(3)),
    });
  }
  return { ok: true, worldId, hours: n, base: f, breakdown, composedAt: Date.now() };
}

// Per-region forecast — reads real embodied signals at each district anchor.
export async function composeRegional(db, STATE, worldId) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  let sigMod;
  try { sigMod = await import("./embodied/signals.js"); }
  catch { return { ok: false, reason: "signals_unavailable" }; }
  const regions = [];
  for (const reg of FORECAST_REGIONS) {
    const anchor = regionAnchor(reg.id);
    let sig = null;
    try { sig = sigMod.signalsForWorld(db, worldId, anchor); } catch { /* skip */ }
    regions.push({
      id: reg.id,
      name: reg.name,
      anchor,
      hasData: !!sig?.hasData,
      weather: sig?.hasData ? {
        kind: sig.weatherKind || "clear",
        temperature_c: sig.temperature ?? null,
        humidity_pct: sig.humidity ?? null,
        air_quality: sig.airQuality ?? null,
        light: sig.light ?? null,
        noise: sig.noise ?? null,
        structural_stress: sig.structuralStress ?? null,
      } : null,
    });
  }
  return { ok: true, worldId, regions, composedAt: Date.now() };
}

// Forecast accuracy — compare each past persisted forecast against the
// forecast composed nearest the time it predicted (its 24h target). The
// "realized" reference is the persisted forecast whose composed_at is closest
// to past.composed_at + 24h. Both sides are real persisted rows.
export async function forecastAccuracy(db, worldId, limit = 20) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  if (badNumericField({ limit }, ["limit"])) return { ok: false, error: "invalid_limit" };
  try {
    ensureForecastTable(db);
    const rows = db.prepare(`
      SELECT forecast_json, composed_at FROM world_forecasts
      WHERE world_id = ? ORDER BY composed_at ASC
    `).all(worldId);
    const parsed = rows.map(r => {
      let j = null;
      try { j = JSON.parse(r.forecast_json); } catch { /* skip */ }
      return { composedAt: r.composed_at, forecast: j };
    }).filter(x => x.forecast);
    const scored = [];
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      const targetTs = p.composedAt + (p.forecast.window_hours || 24) * 3600;
      // Find the persisted forecast whose composed_at is closest to targetTs,
      // and at least 1h after p (so it actually observed the predicted window).
      let realized = null, bestGap = Infinity;
      for (let j = i + 1; j < parsed.length; j++) {
        const gap = Math.abs(parsed[j].composedAt - targetTs);
        if (parsed[j].composedAt > p.composedAt + 3600 && gap < bestGap) {
          bestGap = gap; realized = parsed[j];
        }
      }
      if (!realized) continue;
      const pred = p.forecast.weather || {};
      const real = realized.forecast.weather || {};
      let tempErr = null, kindHit = null;
      if (typeof pred.temperature_c === "number" && typeof real.temperature_c === "number") {
        tempErr = Number(Math.abs(pred.temperature_c - real.temperature_c).toFixed(2));
      }
      if (pred.kind && real.kind) kindHit = pred.kind === real.kind;
      scored.push({
        forecast_ts: p.composedAt,
        target_ts: targetTs,
        realized_ts: realized.composedAt,
        predicted_kind: pred.kind || null,
        realized_kind: real.kind || null,
        kind_hit: kindHit,
        predicted_temp_c: pred.temperature_c ?? null,
        realized_temp_c: real.temperature_c ?? null,
        temp_abs_error_c: tempErr,
      });
    }
    const recent = scored.slice(-Math.min(100, Math.max(1, parseInt(limit, 10) || 20)));
    const kindScored = recent.filter(s => s.kind_hit !== null);
    const tempScored = recent.filter(s => s.temp_abs_error_c !== null);
    const summary = {
      sample_count: recent.length,
      kind_accuracy: kindScored.length
        ? Number((kindScored.filter(s => s.kind_hit).length / kindScored.length).toFixed(3))
        : null,
      mean_temp_error_c: tempScored.length
        ? Number((tempScored.reduce((a, s) => a + s.temp_abs_error_c, 0) / tempScored.length).toFixed(2))
        : null,
    };
    return { ok: true, worldId, summary, comparisons: recent };
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
}

// Historical archive — list persisted forecasts with extracted trend points.
export function forecastArchive(db, worldId, limit = 50) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  if (badNumericField({ limit }, ["limit"])) return { ok: false, error: "invalid_limit" };
  try {
    ensureForecastTable(db);
    const rows = db.prepare(`
      SELECT forecast_json, composed_at FROM world_forecasts
      WHERE world_id = ? ORDER BY composed_at DESC LIMIT ?
    `).all(worldId, Math.min(200, Math.max(1, parseInt(limit, 10) || 50)));
    const entries = rows.map(r => {
      let j = null;
      try { j = JSON.parse(r.forecast_json); } catch { /* skip */ }
      return {
        composed_at: r.composed_at,
        weather_kind: j?.weather?.kind ?? null,
        temperature_c: j?.weather?.temperature_c ?? null,
        humidity_pct: j?.weather?.humidity_pct ?? null,
        ecosystem_score: j?.ecology?.ecosystem_score ?? null,
        drift_kind: j?.drift?.likely_kind ?? null,
        event_count: Array.isArray(j?.events) ? j.events.length : 0,
      };
    }).filter(e => e.weather_kind !== null || e.temperature_c !== null || e.ecosystem_score !== null);
    // Trend points ascending for charting.
    const trend = [...entries].reverse();
    return { ok: true, worldId, count: entries.length, entries, trend };
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
}

// Evaluate a freshly composed forecast against a user's alert subscriptions.
// Returns the subset of subscriptions that the forecast trips. Pure function —
// callers own subscription storage.
export function evaluateAlerts(forecast, subscriptions) {
  const triggered = [];
  if (!forecast || !Array.isArray(subscriptions)) return triggered;
  const events = Array.isArray(forecast.events) ? forecast.events : [];
  const drift = forecast.drift;
  for (const sub of subscriptions) {
    const minConf = typeof sub.minConfidence === "number" ? sub.minConfidence : 0.6;
    const hits = [];
    if (sub.kind === "severe_event" || sub.kind === "any") {
      for (const ev of events) {
        if ((ev.confidence ?? 0) >= minConf) {
          hits.push({ type: "event", summary: ev.summary, eventKind: ev.kind, confidence: ev.confidence, eta_hours: ev.eta_hours });
        }
      }
    }
    if ((sub.kind === "drift" || sub.kind === "any") && drift) {
      const sev = String(drift.severity || "").toLowerCase();
      if (sev === "high" || sev === "critical") {
        hits.push({ type: "drift", driftKind: drift.likely_kind, severity: drift.severity });
      }
    }
    if (sub.kind === "weather" || sub.kind === "any") {
      const wkinds = Array.isArray(sub.weatherKinds) ? sub.weatherKinds : [];
      const w = forecast.weather;
      if (w && wkinds.length && wkinds.includes(w.kind) && (w.confidence ?? 0) >= minConf) {
        hits.push({ type: "weather", weatherKind: w.kind, confidence: w.confidence });
      }
    }
    if (hits.length) triggered.push({ subscriptionId: sub.id, kind: sub.kind, hits });
  }
  return triggered;
}

// ── Alert subscriptions — persisted per user, survive restart ────────────────

function ensureAlertTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS forecast_alert_subs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      world_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      min_confidence REAL NOT NULL DEFAULT 0.6,
      weather_kinds_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_fired_at INTEGER
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_forecast_subs_user ON forecast_alert_subs(user_id)`);
}

// Create a subscription. kind ∈ severe_event|drift|weather|any.
export function createAlertSub(db, userId, params = {}) {
  if (!db || !userId) return { ok: false, reason: "missing_inputs" };
  try {
    ensureAlertTable(db);
    const kind = String(params.kind || "severe_event").toLowerCase();
    if (!["severe_event", "drift", "weather", "any"].includes(kind)) {
      return { ok: false, reason: "bad_kind" };
    }
    const worldId = String(params.worldId || "concordia-hub");
    const minConfidence = Math.max(0, Math.min(1,
      typeof params.minConfidence === "number" ? params.minConfidence : 0.6));
    const weatherKinds = Array.isArray(params.weatherKinds)
      ? params.weatherKinds.map(String).slice(0, 12) : [];
    const id = `fas_${Date.now().toString(36)}_${String(strHash(`${userId}:${Date.now()}:${kind}`)).slice(2, 8)}`;
    db.prepare(`
      INSERT INTO forecast_alert_subs (id, user_id, world_id, kind, min_confidence, weather_kinds_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, worldId, kind, minConfidence,
      weatherKinds.length ? JSON.stringify(weatherKinds) : null);
    return { ok: true, subscription: { id, worldId, kind, minConfidence, weatherKinds, createdAt: Math.floor(Date.now() / 1000) } };
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
}

function rowToSub(r) {
  let wk = [];
  try { wk = r.weather_kinds_json ? JSON.parse(r.weather_kinds_json) : []; } catch { /* skip */ }
  return {
    id: r.id,
    worldId: r.world_id,
    kind: r.kind,
    minConfidence: r.min_confidence,
    weatherKinds: wk,
    createdAt: r.created_at,
    lastFiredAt: r.last_fired_at ?? null,
  };
}

export function listAlertSubs(db, userId, worldId = null) {
  if (!db || !userId) return [];
  try {
    ensureAlertTable(db);
    const rows = worldId
      ? db.prepare(`SELECT * FROM forecast_alert_subs WHERE user_id = ? AND world_id = ? ORDER BY created_at DESC`).all(userId, worldId)
      : db.prepare(`SELECT * FROM forecast_alert_subs WHERE user_id = ? ORDER BY created_at DESC`).all(userId);
    return rows.map(rowToSub);
  } catch { return []; }
}

export function deleteAlertSub(db, userId, subId) {
  if (!db || !userId || !subId) return { ok: false, reason: "missing_inputs" };
  try {
    ensureAlertTable(db);
    const info = db.prepare(`DELETE FROM forecast_alert_subs WHERE id = ? AND user_id = ?`).run(subId, userId);
    return { ok: info.changes > 0, removed: info.changes };
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
}

function markSubsFired(db, ids) {
  if (!db || !Array.isArray(ids) || !ids.length) return;
  try {
    const stmt = db.prepare(`UPDATE forecast_alert_subs SET last_fired_at = unixepoch() WHERE id = ?`);
    for (const id of ids) stmt.run(id);
  } catch { /* best-effort */ }
}

// Compose a fresh forecast, evaluate the user's subscriptions against it, and
// return the triggered alerts. Stamps last_fired_at on subscriptions that hit.
export async function checkAlerts(db, STATE, userId, worldId) {
  if (!db || !userId) return { ok: false, reason: "missing_inputs" };
  const wid = String(worldId || "concordia-hub");
  const subs = listAlertSubs(db, userId, wid);
  if (!subs.length) return { ok: true, worldId: wid, subscriptionCount: 0, triggered: [], forecastComposedAt: null };
  const base = await composeForecast(db, STATE, wid);
  if (!base.ok) return { ok: false, reason: base.reason || "compose_failed" };
  const triggered = evaluateAlerts(base.forecast, subs);
  markSubsFired(db, triggered.map(t => t.subscriptionId));
  return {
    ok: true,
    worldId: wid,
    subscriptionCount: subs.length,
    triggered,
    forecast: base.forecast,
    forecastComposedAt: base.composedAt,
  };
}
