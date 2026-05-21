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

  // ═══════════════════════════════════════════════════════════════
  //  Whoop / Calm / Woebot 2026 parity — self-composed therapeutic
  //  fields, guided CBT thought records, wearable import, meditation
  //  + breathing sessions, personalized daily recovery recommendation.
  // ═══════════════════════════════════════════════════════════════

  function getTherapyState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.wellnessTherapy) {
      STATE.wellnessTherapy = {
        fields: new Map(),       // userId -> Array<SelfField>
        thoughtRecords: new Map(), // userId -> Array<ThoughtRecord>
        sessions: new Map(),     // userId -> Array<MeditationSession>
        wearableSyncs: new Map(), // userId -> Array<SyncSummary>
        seq: new Map(),          // userId -> { field, record, session }
      };
    }
    return STATE.wellnessTherapy;
  }
  function ensureTherSeq(s, userId) {
    if (!s.seq.has(userId)) s.seq.set(userId, { field: 1, record: 1, session: 1 });
    const seq = s.seq.get(userId);
    for (const k of ['field', 'record', 'session']) if (!Number.isFinite(seq[k])) seq[k] = 1;
    return seq;
  }

  // The 8 cognitive-pattern field kinds (mirrors the therapy domain).
  const FIELD_KINDS = [
    'binary_thinking', 'catastrophising', 'self_judgment', 'numbing',
    'compulsion', 'rumination', 'perfectionism', 'shame_spiral',
  ];

  // Each field kind carries a CBT prompt set: the distortion name, the
  // Socratic challenge, and a reframe scaffold. Authored, not synthesized.
  const CBT_PROMPTS = {
    binary_thinking: {
      label: 'All-or-nothing thinking',
      distortion: 'Seeing things in absolute, black-and-white categories.',
      challenges: [
        'Is this truly all-or-nothing, or is there a middle ground?',
        'What would a 60% outcome look like here?',
        'Would you judge a friend by this same absolute standard?',
      ],
      reframe: 'Most outcomes live on a spectrum. Name the partial wins.',
    },
    catastrophising: {
      label: 'Catastrophising',
      distortion: 'Expecting the worst-case outcome as if it were certain.',
      challenges: [
        'What is the most likely outcome, not the worst one?',
        'If the worst happened, how would you cope with it?',
        'Has this feared outcome actually happened before?',
      ],
      reframe: 'Separate what is possible from what is probable.',
    },
    self_judgment: {
      label: 'Harsh self-judgment',
      distortion: 'Labelling yourself globally from a single event.',
      challenges: [
        'Would you speak to a friend the way you just spoke to yourself?',
        'Is this a fact about who you are, or one moment in time?',
        'What evidence contradicts this judgment?',
      ],
      reframe: 'Describe the behaviour, not the whole self.',
    },
    numbing: {
      label: 'Emotional numbing',
      distortion: 'Avoiding feeling by disconnecting or distracting.',
      challenges: [
        'What feeling are you avoiding right now?',
        'What is the smallest amount of this feeling you could allow?',
        'What would feeling it fully actually cost you?',
      ],
      reframe: 'Name the feeling. Naming it is already metabolising it.',
    },
    compulsion: {
      label: 'Compulsive urge',
      distortion: 'Acting to relieve discomfort without choosing to.',
      challenges: [
        'What discomfort is this urge trying to discharge?',
        'Could you delay the action by ten minutes and observe?',
        'What happens to the urge if you do nothing?',
      ],
      reframe: 'The urge is a wave; you can let it crest and pass.',
    },
    rumination: {
      label: 'Rumination',
      distortion: 'Replaying a problem without moving toward a solution.',
      challenges: [
        'Is this thinking solving anything, or just circling?',
        'What is one concrete next action you could take?',
        'What would you tell yourself to set this down for now?',
      ],
      reframe: 'Schedule a worry window; outside it, set the loop down.',
    },
    perfectionism: {
      label: 'Perfectionism',
      distortion: 'Holding a standard so high that nothing counts as enough.',
      challenges: [
        'What would "good enough" look like for this task?',
        'What is the real cost of stopping at 90%?',
        'Whose standard is this — yours, or an inherited one?',
      ],
      reframe: 'Done and shared beats perfect and hidden.',
    },
    shame_spiral: {
      label: 'Shame spiral',
      distortion: 'A single mistake expanding into a verdict on your worth.',
      challenges: [
        'What is the actual size of this mistake, factually?',
        'Does this error change your worth, or just your to-do list?',
        'What would repair — not punishment — look like?',
      ],
      reframe: 'Guilt says "I did a bad thing"; shame says "I am bad." Stay with guilt.',
    },
  };

  // ── Self-composed therapeutic fields ─────────────────────────
  // Whoop/Calm parity: users gate their OWN cognitive patterns
  // directly, instead of a therapist targeting another user id.

  registerLensAction("wellness", "self-field-compose", (ctx, _a, params = {}) => {
    const s = getTherapyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidWl(ctx);
    const kind = String(params.fieldKind || "");
    if (!FIELD_KINDS.includes(kind)) return { ok: false, error: `fieldKind must be one of: ${FIELD_KINDS.join(', ')}` };
    const durationSeconds = Math.max(300, Math.min(30 * 86_400, Number(params.durationSeconds) || 86_400));
    const seq = ensureTherSeq(s, userId);
    const now = Date.now();
    const field = {
      id: uidWl('sf'),
      number: `SF-${String(seq.field).padStart(4, '0')}`,
      authorUserId: userId,
      selfComposed: true,
      fieldKind: kind,
      intention: String(params.intention || '').slice(0, 280),
      durationSeconds,
      createdAt: now,
      expiresAt: now + durationSeconds * 1000,
      status: 'active',
    };
    seq.field++;
    listWl(s.fields, userId).push(field);
    saveWell();
    return { ok: true, result: { field } };
  });

  registerLensAction("wellness", "self-field-list", (ctx, _a, _p = {}) => {
    const s = getTherapyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const now = Date.now();
    const list = listWl(s.fields, aidWl(ctx)).map(f => {
      const expired = f.status === 'active' && f.expiresAt <= now;
      const status = expired ? 'expired' : f.status;
      return { ...f, status, msRemaining: status === 'active' ? Math.max(0, f.expiresAt - now) : 0 };
    });
    const active = list.filter(f => f.status === 'active');
    return { ok: true, result: { fields: list.slice().sort((a, b) => b.createdAt - a.createdAt), activeCount: active.length } };
  });

  registerLensAction("wellness", "self-field-deactivate", (ctx, _a, params = {}) => {
    const s = getTherapyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    // Privacy-first invariant: a user can always revoke their own field.
    const field = listWl(s.fields, aidWl(ctx)).find(f => f.id === String(params.id || ""));
    if (!field) return { ok: false, error: "field not found" };
    if (field.status !== 'active') return { ok: false, error: "field already inactive" };
    field.status = 'revoked';
    field.revokedAt = Date.now();
    saveWell();
    return { ok: true, result: { revoked: true, id: field.id } };
  });

  // ── Guided CBT thought records (Woebot parity) ───────────────

  // The prompt library is read-only and content-keyed; safe to surface.
  registerLensAction("wellness", "cbt-prompts", (_ctx, _a, params = {}) => {
    const kind = params.fieldKind ? String(params.fieldKind) : null;
    if (kind) {
      const p = CBT_PROMPTS[kind];
      if (!p) return { ok: false, error: "unknown fieldKind" };
      return { ok: true, result: { fieldKind: kind, ...p } };
    }
    return {
      ok: true,
      result: {
        kinds: FIELD_KINDS.map(k => ({ fieldKind: k, label: CBT_PROMPTS[k].label, distortion: CBT_PROMPTS[k].distortion })),
      },
    };
  });

  registerLensAction("wellness", "cbt-record-create", (ctx, _a, params = {}) => {
    const s = getTherapyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidWl(ctx);
    const kind = String(params.fieldKind || "");
    if (!FIELD_KINDS.includes(kind)) return { ok: false, error: `fieldKind must be one of: ${FIELD_KINDS.join(', ')}` };
    const situation = String(params.situation || "").trim();
    const automaticThought = String(params.automaticThought || "").trim();
    if (!situation || !automaticThought) return { ok: false, error: "situation + automaticThought required" };
    const before = Math.max(0, Math.min(100, Number(params.intensityBefore)));
    const after = Number.isFinite(Number(params.intensityAfter)) ? Math.max(0, Math.min(100, Number(params.intensityAfter))) : null;
    const seq = ensureTherSeq(s, userId);
    const record = {
      id: uidWl('tr'),
      number: `TR-${String(seq.record).padStart(4, '0')}`,
      fieldKind: kind,
      distortionLabel: CBT_PROMPTS[kind].label,
      situation,
      emotion: String(params.emotion || '').slice(0, 80),
      automaticThought,
      evidenceFor: String(params.evidenceFor || '').slice(0, 600),
      evidenceAgainst: String(params.evidenceAgainst || '').slice(0, 600),
      reframe: String(params.reframe || '').slice(0, 600),
      intensityBefore: Number.isFinite(before) ? before : 0,
      intensityAfter: after,
      relief: after !== null && Number.isFinite(before) ? Math.round((before - after)) : null,
      date: String(params.date || dayWl()),
      at: isoWl(),
    };
    seq.record++;
    listWl(s.thoughtRecords, userId).push(record);
    saveWell();
    return { ok: true, result: { record } };
  });

  registerLensAction("wellness", "cbt-record-list", (ctx, _a, params = {}) => {
    const s = getTherapyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = Math.max(1, Math.min(365, Number(params.days) || 60));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    let list = listWl(s.thoughtRecords, aidWl(ctx)).filter(r => r.date >= cutoff);
    if (params.fieldKind) list = list.filter(r => r.fieldKind === String(params.fieldKind));
    const completed = list.filter(r => r.intensityAfter !== null);
    const avgRelief = completed.length
      ? Math.round(completed.reduce((sum, r) => sum + (r.relief || 0), 0) / completed.length)
      : null;
    return {
      ok: true,
      result: {
        records: list.slice().sort((a, b) => b.at.localeCompare(a.at)),
        total: list.length,
        completed: completed.length,
        avgRelief,
      },
    };
  });

  // ── Wearable import (Apple Health / Whoop export parity) ─────
  // Accepts a batch of readings from a wearable export and folds them
  // into the metric store. type-mapped, deduped per (type,date).

  const WEARABLE_FIELD_MAP = {
    hrv: 'hrv_ms', hrv_ms: 'hrv_ms', heartRateVariability: 'hrv_ms',
    sleep: 'sleep_hours', sleep_hours: 'sleep_hours', sleepHours: 'sleep_hours',
    restingHeartRate: 'resting_hr', resting_hr: 'resting_hr', rhr: 'resting_hr',
    steps: 'steps', stepCount: 'steps',
    weight: 'weight_kg', weight_kg: 'weight_kg',
    calories: 'calories', activeCalories: 'calories',
  };

  registerLensAction("wellness", "wearable-import", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ts = getTherapyState(); if (!ts) return { ok: false, error: "STATE unavailable" };
    const userId = aidWl(ctx);
    const source = String(params.source || 'wearable');
    const readings = Array.isArray(params.readings) ? params.readings : [];
    if (readings.length === 0) return { ok: false, error: "readings[] required" };
    const metrics = listWl(s.metrics, userId);
    let imported = 0, skipped = 0;
    const byType = {};
    for (const raw of readings) {
      if (!raw || typeof raw !== 'object') { skipped++; continue; }
      const mapped = WEARABLE_FIELD_MAP[String(raw.type || '')];
      const value = Number(raw.value);
      if (!mapped || !Number.isFinite(value)) { skipped++; continue; }
      const date = String(raw.date || dayWl()).slice(0, 10);
      // dedupe: skip if an entry from this exact source/type/date exists
      const dup = metrics.some(m => m.type === mapped && m.date === date && m.source === source);
      if (dup) { skipped++; continue; }
      metrics.push({
        id: uidWl('m'),
        type: mapped,
        value,
        date,
        at: isoWl(),
        note: '',
        source,
      });
      imported++;
      byType[mapped] = (byType[mapped] || 0) + 1;
    }
    const summary = {
      id: uidWl('sync'),
      source,
      imported,
      skipped,
      byType,
      at: isoWl(),
    };
    listWl(ts.wearableSyncs, userId).push(summary);
    saveWell();
    return { ok: true, result: { summary } };
  });

  registerLensAction("wellness", "wearable-sync-history", (ctx, _a, _p = {}) => {
    const ts = getTherapyState(); if (!ts) return { ok: false, error: "STATE unavailable" };
    const list = listWl(ts.wearableSyncs, aidWl(ctx)).slice().sort((a, b) => b.at.localeCompare(a.at));
    return { ok: true, result: { syncs: list, lastSyncAt: list.length ? list[0].at : null } };
  });

  // ── Meditation / breathing sessions (Calm parity) ────────────

  // Authored guided-session catalogue. Breathing patterns are
  // [inhale, hold, exhale, holdEmpty] seconds.
  const SESSION_CATALOGUE = [
    { id: 'box_breathing', kind: 'breathing', title: 'Box Breathing', desc: 'Equal four-count cycle to steady the nervous system.', durationMin: 5, pattern: [4, 4, 4, 4], cycles: 18 },
    { id: 'four_seven_eight', kind: 'breathing', title: '4-7-8 Breath', desc: 'Long exhale to down-regulate before sleep.', durationMin: 6, pattern: [4, 7, 8, 0], cycles: 14 },
    { id: 'coherent_breathing', kind: 'breathing', title: 'Coherent Breathing', desc: 'Five-second in, five-second out — heart-rate coherence.', durationMin: 8, pattern: [5, 0, 5, 0], cycles: 48 },
    { id: 'body_scan', kind: 'meditation', title: 'Body Scan', desc: 'Attention swept slowly head-to-toe to release held tension.', durationMin: 10, pattern: null, cycles: 0 },
    { id: 'loving_kindness', kind: 'meditation', title: 'Loving-Kindness', desc: 'Directed goodwill — self, then widening circles.', durationMin: 12, pattern: null, cycles: 0 },
    { id: 'focused_attention', kind: 'meditation', title: 'Focused Attention', desc: 'Anchor on the breath; notice, label, return.', durationMin: 10, pattern: null, cycles: 0 },
    { id: 'sleep_wind_down', kind: 'meditation', title: 'Sleep Wind-Down', desc: 'A slow descent to release the day before sleep.', durationMin: 15, pattern: null, cycles: 0 },
  ];

  registerLensAction("wellness", "session-catalogue", (_ctx, _a, _p = {}) => {
    return { ok: true, result: { sessions: SESSION_CATALOGUE } };
  });

  registerLensAction("wellness", "session-complete", (ctx, _a, params = {}) => {
    const s = getTherapyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidWl(ctx);
    const catId = String(params.catalogueId || "");
    const preset = SESSION_CATALOGUE.find(c => c.id === catId);
    if (!preset) return { ok: false, error: "unknown catalogueId" };
    const durationMin = Math.max(1, Math.min(120, Number(params.durationMin) || preset.durationMin));
    const moodBefore = Number.isFinite(Number(params.moodBefore)) ? Math.max(0, Math.min(4, Number(params.moodBefore))) : null;
    const moodAfter = Number.isFinite(Number(params.moodAfter)) ? Math.max(0, Math.min(4, Number(params.moodAfter))) : null;
    const seq = ensureTherSeq(s, userId);
    const session = {
      id: uidWl('ms'),
      number: `MS-${String(seq.session).padStart(5, '0')}`,
      catalogueId: catId,
      kind: preset.kind,
      title: preset.title,
      durationMin,
      moodBefore,
      moodAfter,
      moodShift: moodBefore !== null && moodAfter !== null ? moodAfter - moodBefore : null,
      note: String(params.note || '').slice(0, 280),
      date: String(params.date || dayWl()),
      at: isoWl(),
    };
    seq.session++;
    listWl(s.sessions, userId).push(session);
    saveWell();
    return { ok: true, result: { session } };
  });

  registerLensAction("wellness", "session-history", (ctx, _a, params = {}) => {
    const s = getTherapyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = Math.max(1, Math.min(365, Number(params.days) || 30));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const all = listWl(s.sessions, aidWl(ctx));
    const list = all.filter(x => x.date >= cutoff);
    // streak: consecutive days back from today (or yesterday) with >= 1 session
    const datesWith = new Set(all.map(x => x.date));
    const today = dayWl();
    let streak = 0;
    const cursor = new Date(today);
    if (!datesWith.has(today)) cursor.setDate(cursor.getDate() - 1);
    while (datesWith.has(cursor.toISOString().slice(0, 10))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    const totalMin = list.reduce((sum, x) => sum + x.durationMin, 0);
    const shifts = list.filter(x => x.moodShift !== null);
    const avgMoodShift = shifts.length
      ? Math.round((shifts.reduce((sum, x) => sum + x.moodShift, 0) / shifts.length) * 100) / 100
      : null;
    return {
      ok: true,
      result: {
        sessions: list.slice().sort((a, b) => b.at.localeCompare(a.at)),
        count: list.length,
        totalMin,
        streak,
        avgMoodShift,
      },
    };
  });

  // ── Personalized daily recovery recommendation ───────────────
  // Folds today's recovery signals, sleep, strain, mood, mindfulness
  // and open thought-record patterns into one actionable daily plan.

  registerLensAction("wellness", "daily-recommendation", (ctx, _a, params = {}) => {
    const s = getWellState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ts = getTherapyState(); if (!ts) return { ok: false, error: "STATE unavailable" };
    const userId = aidWl(ctx);
    const date = String(params.date || dayWl());

    // Today's metric signals.
    const todayMetrics = listWl(s.metrics, userId).filter(m => m.date === date);
    function latest(type) { const ms = todayMetrics.filter(m => m.type === type); return ms.length ? ms[ms.length - 1].value : null; }
    const sleepHours = latest('sleep_hours');
    const hrv = latest('hrv_ms');
    const restingHr = latest('resting_hr');

    // Today's strain from workouts.
    const todayWorkouts = listWl(s.workouts, userId).filter(w => w.date === date);
    const strainMin = todayWorkouts.reduce((sum, w) => {
      const mult = w.intensity === 'max' ? 2.5 : w.intensity === 'hard' ? 2 : w.intensity === 'moderate' ? 1.3 : 1;
      return sum + w.durationMin * mult;
    }, 0);

    // Recovery score (same model as recovery-score macro).
    let score = 50;
    const inputs = [];
    if (sleepHours !== null) { inputs.push('sleep'); score += Math.max(-25, Math.min(25, (sleepHours - 6) * 12.5)); }
    if (hrv !== null) { inputs.push('hrv'); score += Math.max(-15, Math.min(15, (hrv - 60) * 0.5)); }
    if (restingHr !== null) { inputs.push('resting_hr'); score += Math.max(-15, Math.min(15, (60 - restingHr) * 0.75)); }
    if (strainMin > 60) { inputs.push('strain'); score -= Math.min(15, (strainMin - 60) * 0.1); }
    score = Math.max(0, Math.min(100, Math.round(score)));
    const band = score >= 67 ? 'green' : score >= 34 ? 'yellow' : 'red';

    // Recent mood (last 3 days).
    const moodCutoff = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const recentMoods = listWl(s.moods, userId).filter(m => m.date >= moodCutoff);
    const avgMood = recentMoods.length
      ? recentMoods.reduce((sum, m) => sum + m.moodScore, 0) / recentMoods.length
      : null;

    // Mindfulness today + open thought records.
    const sessionsToday = listWl(ts.sessions, userId).filter(x => x.date === date).length;
    const openRecords = listWl(ts.thoughtRecords, userId).filter(r => r.intensityAfter === null).length;

    // Build a prioritized, deduplicated set of recommendations.
    const recs = [];
    if (band === 'green') {
      recs.push({ priority: 1, area: 'training', text: 'Recovery is high — a good day to take on hard strain or a long workout.' });
    } else if (band === 'yellow') {
      recs.push({ priority: 1, area: 'training', text: 'Recovery is moderate — train at a measured intensity; avoid going to failure.' });
    } else if (band === 'red') {
      recs.push({ priority: 1, area: 'training', text: 'Recovery is low — prioritize active recovery, light movement, and rest.' });
    } else {
      recs.push({ priority: 2, area: 'tracking', text: 'Log today\'s sleep, HRV, or resting heart rate to compute a recovery score.' });
    }
    if (sleepHours !== null && sleepHours < 7) {
      recs.push({ priority: 1, area: 'sleep', text: `Only ${sleepHours}h of sleep logged — aim for an earlier wind-down tonight; try the 4-7-8 breath.` });
    }
    if (strainMin > 120) {
      recs.push({ priority: 2, area: 'recovery', text: 'High training load today — hydrate, refuel with protein, and protect tonight\'s sleep.' });
    }
    if (avgMood !== null && avgMood < 2) {
      recs.push({ priority: 1, area: 'mood', text: 'Mood has trended low — a short loving-kindness or body-scan session can lift the baseline.' });
    }
    if (openRecords > 0) {
      recs.push({ priority: 2, area: 'cbt', text: `You have ${openRecords} unfinished thought record${openRecords > 1 ? 's' : ''} — completing the reframe step usually brings the most relief.` });
    }
    if (sessionsToday === 0) {
      recs.push({ priority: 3, area: 'mindfulness', text: 'No mindfulness session yet today — even 5 minutes of box breathing counts.' });
    }
    recs.sort((a, b) => a.priority - b.priority);

    const focus = recs.length ? recs[0].text : 'Keep logging your daily signals to build a personalized recommendation.';

    return {
      ok: true,
      result: {
        date,
        recoveryScore: score,
        band,
        focus,
        recommendations: recs,
        signals: {
          sleepHours, hrvMs: hrv, restingHr,
          strainMin: Math.round(strainMin),
          avgRecentMood: avgMood !== null ? Math.round(avgMood * 100) / 100 : null,
          mindfulnessSessionsToday: sessionsToday,
          openThoughtRecords: openRecords,
        },
        hasEnoughData: inputs.length >= 1 || recentMoods.length > 0,
      },
    };
  });
}
