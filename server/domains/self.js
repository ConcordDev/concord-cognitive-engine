// server/domains/self.js
// Quantified-self lens — a unified personal-health ledger shadowing
// Apple Health / Gyroscope. Users log metric readings (steps, sleep,
// mood, workout minutes, weight, resting heart rate, water, …); every
// other macro is computed from that real ledger. No seed data — an
// empty ledger yields empty results.
//
// Backlog implemented here:
//   - cross-metric correlation     (correlate)
//   - time-series trend charts     (trend)
//   - health-data import           (importBatch)
//   - goals + progress rings       (setGoal / goals)
//   - daily/weekly summary digest  (digest)
//   - customizable dashboard tiles (saveLayout / layout)
//   - streaks across subsystems    (streaks)

const METRICS = {
  steps:        { label: "Steps",            unit: "steps", higherBetter: true },
  sleep_hours:  { label: "Sleep",            unit: "h",     higherBetter: true },
  workout_min:  { label: "Workout",          unit: "min",   higherBetter: true },
  mood:         { label: "Mood",             unit: "/5",    higherBetter: true },
  weight_kg:    { label: "Weight",           unit: "kg",    higherBetter: false },
  resting_hr:   { label: "Resting HR",       unit: "bpm",   higherBetter: false },
  water_ml:     { label: "Water",            unit: "ml",    higherBetter: true },
  calories:     { label: "Calories",         unit: "kcal",  higherBetter: false },
  meditation_min: { label: "Meditation",     unit: "min",   higherBetter: true },
  journal_entries: { label: "Journal",       unit: "entries", higherBetter: true },
};
const METRIC_KEYS = Object.keys(METRICS);

const TILE_KEYS = ["steps", "sleep_hours", "workout_min", "mood", "weight_kg", "resting_hr", "water_ml", "meditation_min"];
const DEFAULT_LAYOUT = ["steps", "sleep_hours", "workout_min", "mood"];

export default function registerSelfActions(registerLensAction) {
  function getState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.selfLens) STATE.selfLens = {};
    const s = STATE.selfLens;
    if (!(s.readings instanceof Map)) s.readings = new Map();   // userId -> Array<reading>
    if (!(s.goals instanceof Map)) s.goals = new Map();         // userId -> Map(metric -> goal)
    if (!(s.layouts instanceof Map)) s.layouts = new Map();     // userId -> Array<tileKey>
    return s;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const actor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const sid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
  const list = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };

  function normMetric(v) {
    const k = String(v || "").trim().toLowerCase();
    return METRIC_KEYS.includes(k) ? k : null;
  }
  function readingsFor(s, userId) {
    return list(s.readings, userId);
  }
  // Daily-aggregated series for one metric: { day, value } sorted ascending.
  // mood/weight/resting_hr average per day; everything else sums.
  function dailySeries(readings, metric, days) {
    const cutoff = days ? Date.now() - days * 86400000 : 0;
    const byDay = new Map();
    for (const r of readings) {
      if (r.metric !== metric) continue;
      if (cutoff && new Date(r.at).getTime() < cutoff) continue;
      const k = dayKey(r.at);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(r.value);
    }
    const avg = ["mood", "weight_kg", "resting_hr"].includes(metric);
    return [...byDay.entries()]
      .map(([day, vals]) => ({
        day,
        value: avg
          ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
          : Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100,
      }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }
  function pearson(xs, ys) {
    const n = xs.length;
    if (n < 3) return null;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      const a = xs[i] - mx, b = ys[i] - my;
      num += a * b; dx += a * a; dy += b * b;
    }
    if (dx === 0 || dy === 0) return null;
    return num / Math.sqrt(dx * dy);
  }

  // ─── logMetric — append one real reading to the ledger ───────────────
  registerLensAction("self", "logMetric", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const metric = normMetric(params.metric);
    if (!metric) return { ok: false, error: `metric must be one of: ${METRIC_KEYS.join(", ")}` };
    const value = Number(params.value);
    if (!Number.isFinite(value)) return { ok: false, error: "value must be a finite number" };
    const at = params.at && !Number.isNaN(new Date(params.at).getTime())
      ? new Date(params.at).toISOString() : new Date().toISOString();
    const entry = {
      id: sid("rd"),
      metric,
      value,
      at,
      source: String(params.source || "manual").slice(0, 32),
      note: String(params.note || "").trim().slice(0, 200),
    };
    readingsFor(s, actor(ctx)).push(entry);
    save();
    return { ok: true, result: { reading: entry } };
  });

  // ─── readings — recent ledger, optionally filtered by metric ─────────
  registerLensAction("self", "readings", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const metric = params.metric ? normMetric(params.metric) : null;
    let rows = [...readingsFor(s, actor(ctx))];
    if (params.metric && !metric) return { ok: false, error: "unknown metric" };
    if (metric) rows = rows.filter((r) => r.metric === metric);
    const limit = Math.max(1, Math.min(500, parseInt(params.limit, 10) || 100));
    rows = rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
    return { ok: true, result: { readings: rows, count: rows.length, metrics: METRICS } };
  });

  // ─── importBatch — wearable / Apple Health / Google Fit ingestion ────
  // Accepts an array of {metric,value,at?,source?} samples in one call.
  // Idempotency: a sample equal in (metric, value, day, source) to an
  // existing reading is skipped so re-importing the same export is safe.
  registerLensAction("self", "importBatch", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const samples = Array.isArray(params.samples) ? params.samples : [];
    if (samples.length === 0) return { ok: false, error: "samples must be a non-empty array" };
    if (samples.length > 5000) return { ok: false, error: "batch too large (max 5000)" };
    const source = String(params.source || "import").slice(0, 32);
    const rows = readingsFor(s, actor(ctx));
    const seen = new Set(rows.map((r) => `${r.metric}|${r.value}|${dayKey(r.at)}|${r.source}`));
    let imported = 0, skipped = 0;
    const errors = [];
    for (const raw of samples) {
      const metric = normMetric(raw && raw.metric);
      const value = Number(raw && raw.value);
      if (!metric || !Number.isFinite(value)) { skipped++; errors.push("invalid sample"); continue; }
      const at = raw.at && !Number.isNaN(new Date(raw.at).getTime())
        ? new Date(raw.at).toISOString() : new Date().toISOString();
      const dedupe = `${metric}|${value}|${dayKey(at)}|${source}`;
      if (seen.has(dedupe)) { skipped++; continue; }
      seen.add(dedupe);
      rows.push({ id: sid("rd"), metric, value, at, source, note: "" });
      imported++;
    }
    save();
    return {
      ok: true,
      result: { imported, skipped, total: rows.length, source, errors: errors.slice(0, 10) },
    };
  });

  // ─── trend — time-series for one metric (chart-ready) ────────────────
  registerLensAction("self", "trend", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const metric = normMetric(params.metric);
    if (!metric) return { ok: false, error: `metric must be one of: ${METRIC_KEYS.join(", ")}` };
    const days = Math.max(7, Math.min(365, parseInt(params.days, 10) || 30));
    const series = dailySeries(readingsFor(s, actor(ctx)), metric, days);
    const values = series.map((p) => p.value);
    const n = values.length;
    let stats = { count: n, avg: null, min: null, max: null, latest: null, deltaPct: null };
    if (n > 0) {
      const avg = values.reduce((a, b) => a + b, 0) / n;
      stats = {
        count: n,
        avg: Math.round(avg * 100) / 100,
        min: Math.min(...values),
        max: Math.max(...values),
        latest: values[n - 1],
      };
      if (n >= 4) {
        const half = Math.floor(n / 2);
        const first = values.slice(0, half).reduce((a, b) => a + b, 0) / half;
        const second = values.slice(half).reduce((a, b) => a + b, 0) / (n - half);
        stats.deltaPct = first === 0 ? null : Math.round(((second - first) / Math.abs(first)) * 1000) / 10;
      }
    }
    return {
      ok: true,
      result: {
        metric,
        label: METRICS[metric].label,
        unit: METRICS[metric].unit,
        higherBetter: METRICS[metric].higherBetter,
        days,
        series,
        stats,
      },
    };
  });

  // ─── correlate — cross-metric Pearson correlation ────────────────────
  // "You sleep better on workout days" style insight: pairs daily
  // series of two metrics on common days and computes r.
  registerLensAction("self", "correlate", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const readings = readingsFor(s, actor(ctx));
    const days = Math.max(14, Math.min(365, parseInt(params.days, 10) || 90));

    function pairR(a, b) {
      const sa = dailySeries(readings, a, days);
      const sb = new Map(dailySeries(readings, b, days).map((p) => [p.day, p.value]));
      const xs = [], ys = [];
      for (const p of sa) {
        if (sb.has(p.day)) { xs.push(p.value); ys.push(sb.get(p.day)); }
      }
      const r = pearson(xs, ys);
      return { r, n: xs.length };
    }

    // Explicit pair, or scan every metric pair for the strongest links.
    const a = params.metricA ? normMetric(params.metricA) : null;
    const b = params.metricB ? normMetric(params.metricB) : null;
    if (params.metricA && !a) return { ok: false, error: "unknown metricA" };
    if (params.metricB && !b) return { ok: false, error: "unknown metricB" };

    function describe(metricA, metricB, r) {
      const la = METRICS[metricA].label, lb = METRICS[metricB].label;
      const strength = Math.abs(r) >= 0.6 ? "strongly" : Math.abs(r) >= 0.35 ? "moderately" : "weakly";
      const dir = r >= 0 ? "rises with" : "falls as";
      return `${la} ${strength} ${dir} ${lb}.`;
    }

    if (a && b) {
      const { r, n } = pairR(a, b);
      return {
        ok: true,
        result: {
          metricA: a, metricB: b,
          r: r == null ? null : Math.round(r * 1000) / 1000,
          sampleDays: n,
          insight: r == null ? "Not enough overlapping days yet." : describe(a, b, r),
        },
      };
    }

    const links = [];
    for (let i = 0; i < METRIC_KEYS.length; i++) {
      for (let j = i + 1; j < METRIC_KEYS.length; j++) {
        const { r, n } = pairR(METRIC_KEYS[i], METRIC_KEYS[j]);
        if (r == null || n < 5) continue;
        links.push({
          metricA: METRIC_KEYS[i], metricB: METRIC_KEYS[j],
          r: Math.round(r * 1000) / 1000, sampleDays: n,
          insight: describe(METRIC_KEYS[i], METRIC_KEYS[j], r),
        });
      }
    }
    links.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
    return { ok: true, result: { links: links.slice(0, 8), scanned: true, days } };
  });

  // ─── setGoal / goals — per-metric targets with progress rings ────────
  registerLensAction("self", "setGoal", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const metric = normMetric(params.metric);
    if (!metric) return { ok: false, error: `metric must be one of: ${METRIC_KEYS.join(", ")}` };
    const target = Number(params.target);
    if (!Number.isFinite(target) || target <= 0) return { ok: false, error: "target must be a positive number" };
    const period = ["daily", "weekly"].includes(String(params.period)) ? String(params.period) : "daily";
    const userId = actor(ctx);
    if (!s.goals.has(userId)) s.goals.set(userId, new Map());
    const goal = { metric, target, period, updatedAt: new Date().toISOString() };
    s.goals.get(userId).set(metric, goal);
    save();
    return { ok: true, result: { goal } };
  });

  registerLensAction("self", "removeGoal", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const metric = normMetric(params.metric);
    if (!metric) return { ok: false, error: "unknown metric" };
    const g = s.goals.get(actor(ctx));
    if (!g || !g.has(metric)) return { ok: false, error: "no goal set for that metric" };
    g.delete(metric);
    save();
    return { ok: true, result: { removed: metric } };
  });

  registerLensAction("self", "goals", (ctx, _a, _params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const goalMap = s.goals.get(userId) || new Map();
    const readings = readingsFor(s, userId);
    const today = dayKey(Date.now());
    const weekCut = Date.now() - 7 * 86400000;

    const rings = [...goalMap.values()].map((g) => {
      let current;
      const rows = readings.filter((r) => r.metric === g.metric);
      if (g.period === "daily") {
        const todayRows = rows.filter((r) => dayKey(r.at) === today);
        current = ["mood", "weight_kg", "resting_hr"].includes(g.metric)
          ? (todayRows.length ? todayRows.reduce((a, r) => a + r.value, 0) / todayRows.length : 0)
          : todayRows.reduce((a, r) => a + r.value, 0);
      } else {
        const weekRows = rows.filter((r) => new Date(r.at).getTime() >= weekCut);
        current = ["mood", "weight_kg", "resting_hr"].includes(g.metric)
          ? (weekRows.length ? weekRows.reduce((a, r) => a + r.value, 0) / weekRows.length : 0)
          : weekRows.reduce((a, r) => a + r.value, 0);
      }
      current = Math.round(current * 100) / 100;
      const pct = Math.max(0, Math.min(1, g.target === 0 ? 0 : current / g.target));
      return {
        metric: g.metric,
        label: METRICS[g.metric].label,
        unit: METRICS[g.metric].unit,
        period: g.period,
        target: g.target,
        current,
        percent: Math.round(pct * 100),
        met: current >= g.target,
      };
    });
    return { ok: true, result: { goals: rings, count: rings.length, available: METRICS } };
  });

  // ─── digest — generated daily / weekly "your day" recap ──────────────
  registerLensAction("self", "digest", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const readings = readingsFor(s, userId);
    const range = params.range === "weekly" ? "weekly" : "daily";
    const windowDays = range === "weekly" ? 7 : 1;
    const cutoff = Date.now() - windowDays * 86400000;
    const cur = readings.filter((r) => new Date(r.at).getTime() >= cutoff);
    const prevCutoff = cutoff - windowDays * 86400000;
    const prev = readings.filter((r) => {
      const t = new Date(r.at).getTime();
      return t >= prevCutoff && t < cutoff;
    });

    function aggregate(rows, metric) {
      const m = rows.filter((r) => r.metric === metric);
      if (m.length === 0) return null;
      const avg = ["mood", "weight_kg", "resting_hr"].includes(metric);
      const v = avg
        ? m.reduce((a, r) => a + r.value, 0) / m.length
        : m.reduce((a, r) => a + r.value, 0);
      return Math.round(v * 100) / 100;
    }

    const lines = [];
    const stats = [];
    for (const metric of METRIC_KEYS) {
      const now = aggregate(cur, metric);
      if (now == null) continue;
      const was = aggregate(prev, metric);
      let deltaPct = null;
      if (was != null && was !== 0) deltaPct = Math.round(((now - was) / Math.abs(was)) * 1000) / 10;
      stats.push({ metric, label: METRICS[metric].label, unit: METRICS[metric].unit, value: now, deltaPct });
      const dir = deltaPct == null ? ""
        : deltaPct > 0 ? ` (up ${deltaPct}%)`
        : deltaPct < 0 ? ` (down ${Math.abs(deltaPct)}%)` : " (flat)";
      lines.push(`${METRICS[metric].label}: ${now}${METRICS[metric].unit}${dir}`);
    }

    const headline = stats.length === 0
      ? (range === "weekly" ? "No data logged this week yet." : "No data logged today yet.")
      : `${range === "weekly" ? "This week" : "Today"}: tracked ${stats.length} metric${stats.length === 1 ? "" : "s"} across ${cur.length} reading${cur.length === 1 ? "" : "s"}.`;

    return {
      ok: true,
      result: {
        range,
        generatedAt: new Date().toISOString(),
        headline,
        stats,
        lines,
        readingCount: cur.length,
      },
    };
  });

  // ─── saveLayout / layout — customizable overview tiles ───────────────
  registerLensAction("self", "saveLayout", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const tiles = Array.isArray(params.tiles) ? params.tiles : null;
    if (!tiles) return { ok: false, error: "tiles must be an array of metric keys" };
    const cleaned = tiles
      .map((t) => normMetric(t))
      .filter((t, i, arr) => t && TILE_KEYS.includes(t) && arr.indexOf(t) === i);
    if (cleaned.length === 0) return { ok: false, error: "no valid tiles supplied" };
    if (cleaned.length > 8) return { ok: false, error: "max 8 tiles" };
    s.layouts.set(actor(ctx), cleaned);
    save();
    return { ok: true, result: { tiles: cleaned } };
  });

  registerLensAction("self", "layout", (ctx, _a, _params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const tiles = s.layouts.get(actor(ctx)) || DEFAULT_LAYOUT;
    return {
      ok: true,
      result: {
        tiles,
        isDefault: !s.layouts.has(actor(ctx)),
        available: TILE_KEYS.map((k) => ({ key: k, label: METRICS[k].label, unit: METRICS[k].unit })),
      },
    };
  });

  // ─── streaks — consecutive-day logging streaks per subsystem ─────────
  registerLensAction("self", "streaks", (ctx, _a, _params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const readings = readingsFor(s, actor(ctx));
    const today = dayKey(Date.now());

    function streakFor(metric) {
      const days = new Set(readings.filter((r) => r.metric === metric).map((r) => dayKey(r.at)));
      if (days.size === 0) return { current: 0, longest: 0, lastLogged: null, loggedToday: false };
      let current = 0;
      for (let i = 0; i < 366; i++) {
        const d = dayKey(Date.now() - i * 86400000);
        if (days.has(d)) current++;
        else if (i === 0) continue;
        else break;
      }
      const sorted = [...days].sort();
      let longest = 0, run = 1;
      for (let i = 1; i < sorted.length; i++) {
        const prev = new Date(sorted[i - 1]);
        prev.setDate(prev.getDate() + 1);
        if (dayKey(prev) === sorted[i]) run++;
        else { longest = Math.max(longest, run); run = 1; }
      }
      longest = Math.max(longest, run);
      return {
        current,
        longest,
        lastLogged: sorted[sorted.length - 1],
        loggedToday: days.has(today),
      };
    }

    const perMetric = METRIC_KEYS
      .map((metric) => ({ metric, label: METRICS[metric].label, ...streakFor(metric) }))
      .filter((x) => x.lastLogged != null);

    // Overall: any-metric logged on a day counts as an active day.
    const anyDays = new Set(readings.map((r) => dayKey(r.at)));
    let overall = 0;
    for (let i = 0; i < 366; i++) {
      const d = dayKey(Date.now() - i * 86400000);
      if (anyDays.has(d)) overall++;
      else if (i === 0) continue;
      else break;
    }
    const bestActive = perMetric.slice().sort((a, b) => b.current - a.current)[0] || null;

    return {
      ok: true,
      result: {
        overall,
        loggedToday: anyDays.has(today),
        perMetric,
        bestStreak: bestActive,
        activeDays: anyDays.size,
      },
    };
  });

  // ─── overview — combined dashboard payload (layout-aware) ────────────
  registerLensAction("self", "overview", (ctx, _a, _params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actor(ctx);
    const readings = readingsFor(s, userId);
    const tiles = s.layouts.get(userId) || DEFAULT_LAYOUT;
    const weekCut = Date.now() - 7 * 86400000;

    const cards = tiles.map((metric) => {
      const rows = readings.filter((r) => r.metric === metric && new Date(r.at).getTime() >= weekCut);
      const avg = ["mood", "weight_kg", "resting_hr"].includes(metric);
      let value = null;
      if (rows.length) {
        value = avg
          ? rows.reduce((a, r) => a + r.value, 0) / rows.length
          : rows.reduce((a, r) => a + r.value, 0);
        value = Math.round(value * 100) / 100;
      }
      return {
        metric,
        label: METRICS[metric].label,
        unit: METRICS[metric].unit,
        value,
        readings: rows.length,
      };
    });
    return {
      ok: true,
      result: {
        tiles,
        cards,
        totalReadings: readings.length,
        hasData: readings.length > 0,
      },
    };
  });
}
