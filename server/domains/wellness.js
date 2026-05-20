// server/domains/wellness.js
// Domain actions for the wellness lens — Whoop shape. 4 macros over
// sleep / strain / recovery / HRV.

export default function registerWellnessActions(registerLensAction) {
  /**
   * sleepScore — compute a 0-100 sleep score from time-in-bed,
   * efficiency, and disturbances.
   *   params.minutesAsleep, params.minutesInBed, params.disturbances
   */
  registerLensAction("wellness", "sleepScore", (_ctx, _artifact, params = {}) => {
    const asleep = parseFloat(params.minutesAsleep) || 0;
    const inBed = parseFloat(params.minutesInBed) || asleep;
    const disturb = parseInt(params.disturbances, 10) || 0;
    if (asleep <= 0) return { ok: false, reason: "minutesAsleep required" };
    const efficiency = inBed > 0 ? asleep / inBed : 1;
    const hoursAsleep = asleep / 60;
    // Reference: 7.5h baseline at 95% efficiency, 0 disturbances = 95
    let score = 0;
    score += Math.min(60, (hoursAsleep / 8) * 60);          // duration
    score += Math.min(30, efficiency * 30);                  // efficiency
    score += Math.max(0, 10 - disturb * 2);                  // restfulness
    score = Math.round(Math.max(0, Math.min(100, score)));
    return {
      ok: true,
      result: {
        score,
        hoursAsleep: Math.round(hoursAsleep * 100) / 100,
        efficiencyPct: Math.round(efficiency * 1000) / 10,
        disturbances: disturb,
        band: score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "ok" : "poor",
      },
    };
  });

  /**
   * strainLog — compute training strain over the day from heart-rate-
   * elevated minutes per zone.
   *   params.minutesByZone = { z1, z2, z3, z4, z5 } (each int minutes)
   */
  registerLensAction("wellness", "strainLog", (_ctx, _artifact, params = {}) => {
    const z = params.minutesByZone || {};
    const z1 = parseInt(z.z1, 10) || 0;
    const z2 = parseInt(z.z2, 10) || 0;
    const z3 = parseInt(z.z3, 10) || 0;
    const z4 = parseInt(z.z4, 10) || 0;
    const z5 = parseInt(z.z5, 10) || 0;
    // Whoop-ish 0-21 logarithmic scale
    const weighted = z1 * 1 + z2 * 2 + z3 * 4 + z4 * 7 + z5 * 12;
    const strain = Math.min(21, Math.round(Math.log10(Math.max(1, weighted)) * 6 * 10) / 10);
    const totalMin = z1 + z2 + z3 + z4 + z5;
    return {
      ok: true,
      result: {
        strain,
        band: strain >= 18 ? "all-out" : strain >= 14 ? "strenuous" : strain >= 10 ? "moderate" : strain >= 5 ? "light" : "minimal",
        totalActiveMin: totalMin,
        weightedLoad: weighted,
        byZone: { z1, z2, z3, z4, z5 },
      },
    };
  });

  /**
   * recoveryReport — combine HRV + RHR + sleep score to give a 0-100
   * recovery percentage.
   *   params.hrvMs, params.rhrBpm, params.baselineHrvMs, params.baselineRhrBpm, params.sleepScore
   */
  registerLensAction("wellness", "recoveryReport", (_ctx, _artifact, params = {}) => {
    const hrv = parseFloat(params.hrvMs) || 0;
    const rhr = parseFloat(params.rhrBpm) || 0;
    const baseHrv = parseFloat(params.baselineHrvMs) || hrv;
    const baseRhr = parseFloat(params.baselineRhrBpm) || rhr;
    const sleep = parseFloat(params.sleepScore) || 70;
    if (hrv <= 0 || rhr <= 0) return { ok: false, reason: "hrvMs and rhrBpm required" };
    const hrvFactor = Math.min(1.2, hrv / Math.max(1, baseHrv));
    const rhrFactor = Math.min(1.2, baseRhr / Math.max(1, rhr));
    const recovery = Math.round(Math.max(0, Math.min(100, 40 * hrvFactor + 30 * rhrFactor + 30 * (sleep / 100))));
    return {
      ok: true,
      result: {
        recoveryPct: recovery,
        hrvMs: hrv,
        rhrBpm: rhr,
        sleepScore: sleep,
        band: recovery >= 75 ? "green" : recovery >= 50 ? "yellow" : "red",
        recommendation: recovery >= 75 ? "Ready for high strain." : recovery >= 50 ? "Moderate strain only." : "Active recovery / rest day.",
      },
    };
  });

  /**
   * hrvTrend — compute HRV trend across a series of readings.
   *   artifact.data.readings = [{ date, hrvMs }]
   */
  registerLensAction("wellness", "hrvTrend", (_ctx, artifact, _params) => {
    const readings = artifact.data?.readings || [];
    if (readings.length < 2) return { ok: true, result: { message: "Need at least 2 readings.", count: readings.length } };
    const sorted = [...readings].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const values = sorted.map((r) => parseFloat(r.hrvMs) || 0);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const recent7 = values.slice(-7);
    const recentAvg = recent7.reduce((s, v) => s + v, 0) / recent7.length;
    const trend = recentAvg > avg + 2 ? "improving" : recentAvg < avg - 2 ? "declining" : "stable";
    return {
      ok: true,
      result: {
        count: values.length,
        average: Math.round(avg * 10) / 10,
        recentAverage: Math.round(recentAvg * 10) / 10,
        latest: values[values.length - 1],
        min: Math.round(Math.min(...values) * 10) / 10,
        max: Math.round(Math.max(...values) * 10) / 10,
        trend,
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════
  //  Apple Health + Whoop + Oura + Daylio + Habitify 2026 parity —
  //  metric logging, habits + streaks, mood journal + correlation,
  //  workouts, recovery score, goals.
  // ═══════════════════════════════════════════════════════════════

  function getWellState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.wellnessLens) {
      STATE.wellnessLens = {
        metrics: new Map(),   // userId -> Array<MetricEntry>
        habits: new Map(),    // userId -> Array<Habit>
        checkins: new Map(),  // userId -> Map<habitId, Map<"YYYY-MM-DD", value>>
        moods: new Map(),     // userId -> Array<MoodEntry>
        workouts: new Map(),  // userId -> Array<Workout>
        goals: new Map(),     // userId -> Array<Goal>
        seq: new Map(),       // userId -> { habit, workout, goal }
      };
    }
    return STATE.wellnessLens;
  }
  function saveWell() { if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) {} } }
  function aidWl(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function uidWl(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function isoWl() { return new Date().toISOString(); }
  function dayWl() { return new Date().toISOString().slice(0, 10); }
  function listWl(map, k) { if (!map.has(k)) map.set(k, []); return map.get(k); }
  function mapWl(map, k) { if (!map.has(k)) map.set(k, new Map()); return map.get(k); }
  function ensureSeqWl(s, userId) {
    if (!s.seq.has(userId)) s.seq.set(userId, { habit: 1, workout: 1, goal: 1 });
    const seq = s.seq.get(userId);
    for (const k of ['habit','workout','goal']) if (!Number.isFinite(seq[k])) seq[k] = 1;
    return seq;
  }

  const METRIC_TYPES = ['steps', 'weight_kg', 'sleep_hours', 'water_ml', 'resting_hr', 'calories', 'hrv_ms', 'body_fat_pct', 'systolic', 'diastolic'];

  // ── Metric logging (Apple Health-style) ──────────────────────

  registerLensAction("wellness", "metrics-log", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidWl(ctx);
    const type = String(params.type || "");
    if (!METRIC_TYPES.includes(type)) return { ok: false, error: `type must be one of: ${METRIC_TYPES.join(', ')}` };
    const value = Number(params.value);
    if (!Number.isFinite(value)) return { ok: false, error: "numeric value required" };
    const entry = {
      id: uidWl('m'),
      type,
      value,
      date: String(params.date || dayWl()),
      at: isoWl(),
      note: String(params.note || ''),
    };
    listWl(s.metrics, userId).push(entry);
    saveWell();
    return { ok: true, result: { entry } };
  });

  registerLensAction("wellness", "metrics-list", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const type = params.type ? String(params.type) : null;
    const days = Math.max(1, Math.min(365, Number(params.days) || 30));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    let list = listWl(s.metrics, aidWl(ctx));
    if (type) list = list.filter(m => m.type === type);
    list = list.filter(m => m.date >= cutoff);
    return { ok: true, result: { metrics: list.slice().sort((a, b) => a.date.localeCompare(b.date)) } };
  });

  // Trend: latest value per day for one metric type, ready for charts.
  registerLensAction("wellness", "metrics-trend", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const type = String(params.type || "");
    if (!METRIC_TYPES.includes(type)) return { ok: false, error: "valid type required" };
    const days = Math.max(1, Math.min(365, Number(params.days) || 30));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const byDay = new Map();
    for (const m of listWl(s.metrics, aidWl(ctx))) {
      if (m.type !== type || m.date < cutoff) continue;
      // last write per day wins
      byDay.set(m.date, m.value);
    }
    const series = Array.from(byDay.entries()).map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
    const vals = series.map(p => p.value);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    // simple trend: compare last-third avg to first-third avg
    let trend = 'flat';
    if (vals.length >= 3) {
      const third = Math.max(1, Math.floor(vals.length / 3));
      const firstAvg = vals.slice(0, third).reduce((a, b) => a + b, 0) / third;
      const lastAvg = vals.slice(-third).reduce((a, b) => a + b, 0) / third;
      if (lastAvg > firstAvg * 1.03) trend = 'rising';
      else if (lastAvg < firstAvg * 0.97) trend = 'falling';
    }
    return {
      ok: true,
      result: {
        type, days, series,
        average: Math.round(avg * 100) / 100,
        latest: vals.length ? vals[vals.length - 1] : null,
        min: vals.length ? Math.min(...vals) : null,
        max: vals.length ? Math.max(...vals) : null,
        trend,
      },
    };
  });

  // ── Habits + streaks (Habitify-style) ────────────────────────

  registerLensAction("wellness", "habits-list", (ctx, _a, _p = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidWl(ctx);
    const habits = listWl(s.habits, userId);
    const checkins = mapWl(s.checkins, userId);
    const today = dayWl();
    const enriched = habits.filter(h => !h.archived).map(h => {
      const log = checkins.get(h.id) || new Map();
      // streak: count consecutive days back from today (or yesterday) that met target
      let streak = 0;
      const cursor = new Date(today);
      // if not done today, start from yesterday so an in-progress day doesn't break streak
      if (!log.has(today)) cursor.setDate(cursor.getDate() - 1);
      while (true) {
        const key = cursor.toISOString().slice(0, 10);
        const v = log.get(key);
        if (v === undefined || v < h.target) break;
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      }
      // longest streak
      const dates = Array.from(log.keys()).filter(d => log.get(d) >= h.target).sort();
      let longest = 0, run = 0, prev = null;
      for (const d of dates) {
        if (prev && (new Date(d).getTime() - new Date(prev).getTime()) === 86_400_000) run++;
        else run = 1;
        longest = Math.max(longest, run);
        prev = d;
      }
      return {
        ...h,
        todayValue: log.get(today) || 0,
        doneToday: (log.get(today) || 0) >= h.target,
        streak,
        longestStreak: longest,
        last7: Array.from({ length: 7 }, (_, i) => {
          const d = new Date(today); d.setDate(d.getDate() - (6 - i));
          const k = d.toISOString().slice(0, 10);
          return { date: k, value: log.get(k) || 0, done: (log.get(k) || 0) >= h.target };
        }),
      };
    });
    return { ok: true, result: { habits: enriched } };
  });

  registerLensAction("wellness", "habits-create", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidWl(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const seq = ensureSeqWl(s, userId);
    const habit = {
      id: uidWl('h'),
      number: `HB-${String(seq.habit).padStart(4, '0')}`,
      name,
      unit: String(params.unit || ''),       // '' = simple check; 'glasses' / 'min' = flexible goal
      target: Math.max(1, Number(params.target) || 1),
      color: String(params.color || '#34d399'),
      cadence: ['daily'].includes(params.cadence) ? params.cadence : 'daily',
      archived: false,
      createdAt: isoWl(),
    };
    seq.habit++;
    listWl(s.habits, userId).push(habit);
    saveWell();
    return { ok: true, result: { habit } };
  });

  registerLensAction("wellness", "habits-checkin", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidWl(ctx);
    const habitId = String(params.habitId || "");
    const habit = listWl(s.habits, userId).find(h => h.id === habitId);
    if (!habit) return { ok: false, error: "habit not found" };
    const date = String(params.date || dayWl());
    const log = mapWl(mapWl(s.checkins, userId), habitId);
    if (params.toggle && habit.target === 1 && (habit.unit === '' )) {
      // simple check toggle
      if (log.get(date)) log.delete(date); else log.set(date, 1);
    } else {
      const value = Number(params.value);
      if (!Number.isFinite(value) || value < 0) return { ok: false, error: "value (>= 0) required" };
      if (value === 0) log.delete(date); else log.set(date, value);
    }
    saveWell();
    return { ok: true, result: { habitId, date, value: log.get(date) || 0, doneToday: (log.get(date) || 0) >= habit.target } };
  });

  registerLensAction("wellness", "habits-archive", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const habit = listWl(s.habits, aidWl(ctx)).find(h => h.id === String(params.id || ""));
    if (!habit) return { ok: false, error: "habit not found" };
    habit.archived = true;
    saveWell();
    return { ok: true, result: { archived: true } };
  });

  // ── Mood journal (Daylio-style) ──────────────────────────────

  const MOOD_SCALE = ['awful', 'bad', 'meh', 'good', 'great']; // index 0..4

  registerLensAction("wellness", "mood-log", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidWl(ctx);
    const mood = String(params.mood || "");
    if (!MOOD_SCALE.includes(mood)) return { ok: false, error: `mood must be one of: ${MOOD_SCALE.join(', ')}` };
    const entry = {
      id: uidWl('mood'),
      mood,
      moodScore: MOOD_SCALE.indexOf(mood),
      activities: Array.isArray(params.activities) ? params.activities.map(String) : [],
      note: String(params.note || ''),
      date: String(params.date || dayWl()),
      at: isoWl(),
    };
    listWl(s.moods, userId).push(entry);
    saveWell();
    return { ok: true, result: { entry } };
  });

  registerLensAction("wellness", "mood-list", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = Math.max(1, Math.min(365, Number(params.days) || 30));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const list = listWl(s.moods, aidWl(ctx)).filter(m => m.date >= cutoff);
    return { ok: true, result: { moods: list.slice().sort((a, b) => b.at.localeCompare(a.at)) } };
  });

  // Correlate activities with mood — which activities co-occur with good days.
  registerLensAction("wellness", "mood-correlate", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = Math.max(7, Math.min(365, Number(params.days) || 90));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const moods = listWl(s.moods, aidWl(ctx)).filter(m => m.date >= cutoff);
    if (moods.length < 3) return { ok: true, result: { correlations: [], message: "Log at least 3 mood entries to see correlations." } };
    const overallAvg = moods.reduce((sum, m) => sum + m.moodScore, 0) / moods.length;
    const byActivity = new Map();
    for (const m of moods) {
      for (const act of m.activities) {
        const cur = byActivity.get(act) || { activity: act, scores: [] };
        cur.scores.push(m.moodScore);
        byActivity.set(act, cur);
      }
    }
    const correlations = Array.from(byActivity.values())
      .filter(a => a.scores.length >= 2)
      .map(a => {
        const avg = a.scores.reduce((x, y) => x + y, 0) / a.scores.length;
        return {
          activity: a.activity,
          occurrences: a.scores.length,
          avgMood: Math.round(avg * 100) / 100,
          delta: Math.round((avg - overallAvg) * 100) / 100,
          effect: avg > overallAvg + 0.3 ? 'lifts mood' : avg < overallAvg - 0.3 ? 'lowers mood' : 'neutral',
        };
      })
      .sort((a, b) => b.delta - a.delta);
    return { ok: true, result: { overallAvgMood: Math.round(overallAvg * 100) / 100, correlations } };
  });

  // ── Workouts ──────────────────────────────────────────────────

  const WORKOUT_KINDS = ['run', 'walk', 'cycle', 'swim', 'strength', 'yoga', 'hiit', 'sport', 'other'];

  registerLensAction("wellness", "workouts-log", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidWl(ctx);
    const kind = WORKOUT_KINDS.includes(params.kind) ? params.kind : 'other';
    const durationMin = Math.max(1, Number(params.durationMin) || 0);
    if (durationMin < 1) return { ok: false, error: "durationMin required" };
    const seq = ensureSeqWl(s, userId);
    const workout = {
      id: uidWl('w'),
      number: `WO-${String(seq.workout).padStart(5, '0')}`,
      kind,
      durationMin,
      distanceKm: Number(params.distanceKm) || null,
      calories: Number(params.calories) || null,
      avgHr: Number(params.avgHr) || null,
      intensity: ['easy', 'moderate', 'hard', 'max'].includes(params.intensity) ? params.intensity : 'moderate',
      date: String(params.date || dayWl()),
      note: String(params.note || ''),
      at: isoWl(),
    };
    seq.workout++;
    listWl(s.workouts, userId).push(workout);
    saveWell();
    return { ok: true, result: { workout } };
  });

  registerLensAction("wellness", "workouts-list", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = Math.max(1, Math.min(365, Number(params.days) || 30));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const list = listWl(s.workouts, aidWl(ctx)).filter(w => w.date >= cutoff);
    const totalMin = list.reduce((sum, w) => sum + w.durationMin, 0);
    return { ok: true, result: { workouts: list.slice().sort((a, b) => b.date.localeCompare(a.date)), totalMin, count: list.length } };
  });

  registerLensAction("wellness", "workouts-delete", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listWl(s.workouts, aidWl(ctx));
    const i = list.findIndex(w => w.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "workout not found" };
    list.splice(i, 1);
    saveWell();
    return { ok: true, result: { deleted: true } };
  });

  // ── Recovery score (Whoop/Oura-style) ────────────────────────

  registerLensAction("wellness", "recovery-score", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidWl(ctx);
    const date = String(params.date || dayWl());
    // Pull the day's metrics.
    const metrics = listWl(s.metrics, userId).filter(m => m.date === date);
    function latest(type) { const ms = metrics.filter(m => m.type === type); return ms.length ? ms[ms.length - 1].value : null; }
    const sleep = latest('sleep_hours');
    const restingHr = latest('resting_hr');
    const hrv = latest('hrv_ms');
    // Strain from the day's workouts.
    const workouts = listWl(s.workouts, userId).filter(w => w.date === date);
    const strainMin = workouts.reduce((sum, w) => {
      const mult = w.intensity === 'max' ? 2.5 : w.intensity === 'hard' ? 2 : w.intensity === 'moderate' ? 1.3 : 1;
      return sum + w.durationMin * mult;
    }, 0);
    const inputs = [];
    let score = 50; // neutral baseline
    if (sleep !== null) {
      inputs.push('sleep');
      // 8h = +25, scaled
      score += Math.max(-25, Math.min(25, (sleep - 6) * 12.5));
    }
    if (hrv !== null) {
      inputs.push('hrv');
      // higher HRV = better recovery; 60ms ~ neutral
      score += Math.max(-15, Math.min(15, (hrv - 60) * 0.5));
    }
    if (restingHr !== null) {
      inputs.push('resting_hr');
      // lower RHR = better; 60bpm ~ neutral
      score += Math.max(-15, Math.min(15, (60 - restingHr) * 0.75));
    }
    // Heavy strain yesterday lowers today's readiness slightly.
    if (strainMin > 60) { inputs.push('strain'); score -= Math.min(15, (strainMin - 60) * 0.1); }
    score = Math.max(0, Math.min(100, Math.round(score)));
    const band = score >= 67 ? 'green' : score >= 34 ? 'yellow' : 'red';
    const advice = band === 'green' ? "Recovered — good day to push hard."
      : band === 'yellow' ? "Moderate recovery — train at a measured intensity."
      : "Low recovery — prioritise rest, sleep, and light movement.";
    return {
      ok: true,
      result: {
        date, score, band, advice,
        inputsUsed: inputs,
        signals: { sleepHours: sleep, restingHr, hrvMs: hrv, strainMin: Math.round(strainMin) },
        hasEnoughData: inputs.length >= 1,
      },
    };
  });

  // ── Goals ─────────────────────────────────────────────────────

  registerLensAction("wellness", "goals-list", (ctx, _a, _p = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { goals: listWl(s.goals, aidWl(ctx)) } };
  });

  registerLensAction("wellness", "goals-create", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidWl(ctx);
    const name = String(params.name || "").trim();
    const target = Number(params.target);
    if (!name || !Number.isFinite(target) || target <= 0) return { ok: false, error: "name + positive target required" };
    const seq = ensureSeqWl(s, userId);
    const goal = {
      id: uidWl('g'),
      number: `GL-${String(seq.goal).padStart(4, '0')}`,
      name,
      metricType: METRIC_TYPES.includes(params.metricType) ? params.metricType : null,
      target,
      current: Number(params.current) || 0,
      unit: String(params.unit || ''),
      deadline: params.deadline ? String(params.deadline) : null,
      status: 'active',
      createdAt: isoWl(),
    };
    seq.goal++;
    listWl(s.goals, userId).push(goal);
    saveWell();
    return { ok: true, result: { goal } };
  });

  registerLensAction("wellness", "goals-update-progress", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const goal = listWl(s.goals, aidWl(ctx)).find(g => g.id === String(params.id || ""));
    if (!goal) return { ok: false, error: "goal not found" };
    if (Number.isFinite(Number(params.current))) goal.current = Number(params.current);
    if (goal.current >= goal.target) { goal.status = 'achieved'; goal.achievedAt = goal.achievedAt || isoWl(); }
    else if (goal.status === 'achieved') goal.status = 'active';
    saveWell();
    return { ok: true, result: { goal, progressPct: Math.min(100, Math.round((goal.current / goal.target) * 100)) } };
  });

  registerLensAction("wellness", "goals-delete", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listWl(s.goals, aidWl(ctx));
    const i = list.findIndex(g => g.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "goal not found" };
    list.splice(i, 1);
    saveWell();
    return { ok: true, result: { deleted: true } };
  });

  // ── Dashboard summary ────────────────────────────────────────

  registerLensAction("wellness", "wellness-dashboard-summary", (ctx, _a, _p = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidWl(ctx);
    const today = dayWl();
    const habits = listWl(s.habits, userId).filter(h => !h.archived);
    const checkins = mapWl(s.checkins, userId);
    let habitsDoneToday = 0;
    for (const h of habits) {
      const log = checkins.get(h.id);
      if (log && (log.get(today) || 0) >= h.target) habitsDoneToday++;
    }
    const weekCutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const workoutsThisWeek = listWl(s.workouts, userId).filter(w => w.date >= weekCutoff);
    const moodsThisWeek = listWl(s.moods, userId).filter(m => m.date >= weekCutoff);
    const avgMood = moodsThisWeek.length ? moodsThisWeek.reduce((sum, m) => sum + m.moodScore, 0) / moodsThisWeek.length : null;
    const activeGoals = listWl(s.goals, userId).filter(g => g.status === 'active').length;
    return {
      ok: true,
      result: {
        habitCount: habits.length,
        habitsDoneToday,
        workoutsThisWeek: workoutsThisWeek.length,
        workoutMinThisWeek: workoutsThisWeek.reduce((sum, w) => sum + w.durationMin, 0),
        avgMoodThisWeek: avgMood !== null ? Math.round(avgMood * 100) / 100 : null,
        activeGoals,
        metricEntryCount: listWl(s.metrics, userId).length,
      },
    };
  });
}
