export default function registerFitnessActions(registerLensAction) {
  // Fail-CLOSED numeric coercion for the legacy calc surfaces (progression /
  // body-comp / periodization / class-utilization) which predate the `fnum`
  // helper below and used `parseFloat(x) || 0` — a fail-OPEN pattern that lets
  // Infinity ("1e999"/"Infinity") leak straight through into the output. A
  // lying calorie / 1RM / progression number is a real safety harm, so every
  // numeric input is coerced through `Number.isFinite` with a finite default
  // and (optionally) clamped to a sane domain. NaN/Infinity NEVER reach output.
  const ffnum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const fclampN = (v, lo, hi, d = lo) => { const n = ffnum(v, d); return Math.max(lo, Math.min(hi, n)); };

  registerLensAction("fitness", "progressionCalc", (ctx, artifact, _params) => {
    const exercises = Array.isArray(artifact.data?.exercises) ? artifact.data.exercises : [];
    const recommendations = exercises.map(ex => {
      // Weights/reps/RPE are clamped to physically-sane finite domains so a
      // poisoned "1e999" weight can never produce an Infinity recommendation.
      const weight = fclampN(ex?.weight, 0, 100000, 0);
      const reps = fclampN(ex?.reps, 0, 1000, 0);
      const rpe = ex?.rpe == null ? 7 : fclampN(ex?.rpe, 1, 10, 7);
      let increment = 0;
      if (rpe <= 6) increment = weight * 0.05;
      else if (rpe <= 7) increment = weight * 0.025;
      else if (rpe >= 9) increment = -weight * 0.05;
      return {
        exercise: String(ex?.name ?? ''),
        currentWeight: weight,
        currentReps: reps,
        currentRPE: rpe,
        recommendedWeight: Math.max(0, Math.round((weight + increment) * 2) / 2),
        recommendation: rpe <= 6 ? 'increase_weight' : rpe <= 8 ? 'maintain' : 'reduce_weight',
      };
    });
    return { ok: true, result: { recommendations } };
  });

  registerLensAction("fitness", "classUtilization", (ctx, artifact, params) => {
    const capacity = fclampN(artifact.data?.capacity, 0, 1000000, 0);
    const enrolled = fclampN(artifact.data?.enrolled, 0, 1000000, 0);
    const attendanceLog = Array.isArray(artifact.data?.attendanceLog) ? artifact.data.attendanceLog : [];
    const period = fclampN(params?.period, 1, 3650, 30);
    const recentAttendance = attendanceLog.filter(a => {
      const d = new Date(a?.date);
      if (isNaN(d.getTime())) return false;
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - period);
      return d >= cutoff;
    });
    const avgAttendance = recentAttendance.length > 0
      ? Math.round(recentAttendance.reduce((s, a) => s + fclampN(a?.count, 0, 1000000, 0), 0) / recentAttendance.length)
      : enrolled;
    const utilization = capacity > 0 ? Math.round((avgAttendance / capacity) * 100) : 0;
    return { ok: true, result: { className: artifact.title, capacity, enrolled, avgAttendance, utilization, period, sessions: recentAttendance.length } };
  });

  registerLensAction("fitness", "bodyCompReport", (ctx, artifact, _params) => {
  try {
    const data = artifact.data || {};
    // Fail-CLOSED + clamped to physiological domains. parseFloat("1e999") is
    // Infinity and `Infinity || 0` is Infinity, so the old `parseFloat||0` was
    // fail-OPEN and would emit Infinity BMI / body-fat. ffnum + clamp closes it.
    const weight = fclampN(data.weight, 0, 2000, 0); // lbs or kg
    const height = fclampN(data.height, 0, 300, 0);   // inches or cm
    const unit = data.unit === "metric" ? "metric" : "imperial";
    const age = fclampN(data.age, 1, 120, 30);
    const sex = String(data.sex || data.gender || "male").toLowerCase() === "female" ? "female" : "male";
    const waist = fclampN(data.waist, 0, 500, 0);
    const neck = fclampN(data.neck, 0, 500, 0);
    const hip = fclampN(data.hip, 0, 500, 0);

    // Convert to metric for BMI
    let weightKg, heightCm;
    if (unit === "imperial") {
      weightKg = weight * 0.453592;
      heightCm = height * 2.54;
    } else {
      weightKg = weight;
      heightCm = height;
    }
    const heightM = heightCm / 100;
    const bmi = heightM > 0 ? Math.round((weightKg / (heightM * heightM)) * 10) / 10 : 0;

    let bmiCategory;
    if (bmi < 18.5) bmiCategory = "underweight";
    else if (bmi < 25) bmiCategory = "normal";
    else if (bmi < 30) bmiCategory = "overweight";
    else bmiCategory = "obese";

    // Body fat % estimate (US Navy method if measurements available)
    let bodyFatPct = null;
    if (waist > 0 && neck > 0 && height > 0) {
      let waistCm, neckCm, hipCm;
      if (unit === "imperial") {
        waistCm = waist * 2.54;
        neckCm = neck * 2.54;
        hipCm = hip * 2.54;
      } else {
        waistCm = waist;
        neckCm = neck;
        hipCm = hip;
      }
      // The Navy formula takes log10 of (waist−neck) / (waist+hip−neck); when
      // waist ≤ neck (or the sum ≤ neck) that argument is ≤0 → NaN. Guard the
      // circumference difference so a nonsensical measurement set degrades to
      // "no estimate" rather than leaking NaN.
      if (sex === "male") {
        const wn = waistCm - neckCm;
        if (wn > 0 && heightCm > 0) {
          bodyFatPct = 495 / (1.0324 - 0.19077 * Math.log10(wn) + 0.15456 * Math.log10(heightCm)) - 450;
        }
      } else if (hipCm > 0) {
        const whn = waistCm + hipCm - neckCm;
        if (whn > 0 && heightCm > 0) {
          bodyFatPct = 495 / (1.29579 - 0.35004 * Math.log10(whn) + 0.22100 * Math.log10(heightCm)) - 450;
        }
      }
      // Clamp to a finite physiological band; drop a non-finite/absurd result.
      if (bodyFatPct != null) {
        bodyFatPct = Number.isFinite(bodyFatPct) ? Math.round(fclampN(bodyFatPct, 1, 75, 1) * 10) / 10 : null;
      }
    }

    const fatMass = bodyFatPct != null ? Math.round(weightKg * (bodyFatPct / 100) * 10) / 10 : null;
    const leanMass = bodyFatPct != null ? Math.round((weightKg - fatMass) * 10) / 10 : null;

    return {
      ok: true,
      result: {
        name: artifact.title,
        weight, height, unit,
        bmi, bmiCategory,
        bodyFatPct,
        fatMass: fatMass != null ? { kg: fatMass, lbs: Math.round(fatMass / 0.453592 * 10) / 10 } : null,
        leanMass: leanMass != null ? { kg: leanMass, lbs: Math.round(leanMass / 0.453592 * 10) / 10 } : null,
        age, sex,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("fitness", "attendanceReport", (ctx, artifact, _params) => {
    const log = artifact.data?.attendanceLog || [];
    if (log.length === 0) {
      return { ok: true, result: { totalSessions: 0, attended: 0, attendanceRate: 0, message: "No attendance data." } };
    }

    let attended = 0;
    let currentStreak = 0;
    let longestStreak = 0;

    const sorted = log.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    for (const entry of sorted) {
      const present = entry.attended !== false && entry.status !== "absent";
      if (present) {
        attended++;
        currentStreak++;
        longestStreak = Math.max(longestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }

    const attendanceRate = Math.round((attended / sorted.length) * 10000) / 100;

    return {
      ok: true,
      result: {
        className: artifact.title,
        totalSessions: sorted.length,
        attended,
        missed: sorted.length - attended,
        attendanceRate,
        currentStreak,
        longestStreak,
        firstDate: sorted[0].date,
        lastDate: sorted[sorted.length - 1].date,
      },
    };
  });

  registerLensAction("fitness", "periodization", (ctx, artifact, params) => {
    // Clamp weeks to a finite, sane macrocycle length so a poisoned "1e999"
    // can't produce Infinity phase durations.
    const weeks = fclampN(params?.weeks ?? artifact.data?.weeks, 1, 104, 12);
    const goal = params?.goal || artifact.data?.goal || 'general_fitness';
    const phases = [];
    if (goal === 'strength') {
      phases.push({ name: 'Hypertrophy', weeks: Math.ceil(weeks * 0.33), sets: '3-4', reps: '8-12', intensity: '65-75%' });
      phases.push({ name: 'Strength', weeks: Math.ceil(weeks * 0.33), sets: '4-5', reps: '3-5', intensity: '80-90%' });
      phases.push({ name: 'Peaking', weeks: Math.ceil(weeks * 0.25), sets: '3-5', reps: '1-3', intensity: '90-100%' });
      phases.push({ name: 'Deload', weeks: Math.max(1, weeks - phases.reduce((s, p) => s + p.weeks, 0)), sets: '2-3', reps: '8-10', intensity: '50-60%' });
    } else {
      phases.push({ name: 'Foundation', weeks: Math.ceil(weeks * 0.25), sets: '2-3', reps: '12-15', intensity: '50-65%' });
      phases.push({ name: 'Build', weeks: Math.ceil(weeks * 0.33), sets: '3-4', reps: '8-12', intensity: '65-80%' });
      phases.push({ name: 'Peak', weeks: Math.ceil(weeks * 0.25), sets: '3-4', reps: '6-10', intensity: '75-85%' });
      phases.push({ name: 'Recovery', weeks: Math.max(1, weeks - phases.reduce((s, p) => s + p.weeks, 0)), sets: '2', reps: '10-12', intensity: '50-60%' });
    }
    return { ok: true, result: { program: artifact.title, goal, totalWeeks: weeks, phases } };
  });

  registerLensAction("fitness", "recruitProfile", (ctx, artifact, _params) => {
    const profile = {
      name: artifact.title,
      sport: artifact.data?.sport || 'Unknown',
      position: artifact.data?.position || '',
      stats: artifact.data?.stats || {},
      academic: artifact.data?.academicInfo || {},
      highlights: artifact.data?.highlights || [],
      contact: artifact.data?.contacts || {},
      recruitingStatus: artifact.data?.recruitingStatus || 'prospect',
      compiledAt: new Date().toISOString(),
    };
    return { ok: true, result: { profile } };
  });

  // ─── Parity-sprint macros: Strava/Whoop/Apple Fitness+/Hevy ──────────

  function getFitState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.fitnessLens) STATE.fitnessLens = {};
    const s = STATE.fitnessLens;
    // Backfill append-only so older persisted STATE upgrades cleanly.
    for (const k of [
      "workouts", "recoveryEntries", "activityEntries",
      "activities", "routes", "goals", "gear", "hrvSamples",
      "segments", "segmentEfforts", "clubs", "challenges",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }

  function saveStateIfAvailable() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }

  registerLensAction("fitness", "workout-list", (ctx, _artifact, _params = {}) => {
    const state = getFitState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const workouts = state.workouts.get(userId) || [];
    return { ok: true, result: { workouts: [...workouts].reverse() } };
  });

  registerLensAction("fitness", "workout-save", (ctx, _artifact, params = {}) => {
    const state = getFitState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const w = params.workout;
    if (!w || typeof w !== "object") return { ok: false, error: "workout payload required" };
    if (!state.workouts.has(userId)) state.workouts.set(userId, []);
    state.workouts.get(userId).push(w);
    saveStateIfAvailable();
    return { ok: true, result: { id: w.id } };
  });

  /**
   * hr-zones — Compute 5 HR zones via Tanaka / Fox / Karvonen.
   * Weekly minute targets follow ACSM-style polarised distribution.
   */
  registerLensAction("fitness", "hr-zones", (_ctx, _artifact, params = {}) => {
    const age = Math.max(5, Math.min(100, Number(params.age) || 30));
    const restingHr = Math.max(30, Math.min(120, Number(params.restingHr) || 60));
    const method = ["tanaka", "fox", "karvonen"].includes(params.method) ? params.method : "tanaka";
    const maxHr = method === "fox" ? 220 - age : Math.round(208 - 0.7 * age);
    const hrr = maxHr - restingHr;

    const bands = [
      { pct: [0.50, 0.60], name: "Recovery", purpose: "Easy aerobic; promotes recovery and fat utilisation.", weeklyMinutesTarget: 60 },
      { pct: [0.60, 0.70], name: "Easy", purpose: "Aerobic base; builds capillary density.", weeklyMinutesTarget: 180 },
      { pct: [0.70, 0.80], name: "Aerobic", purpose: "Aerobic threshold; improves stroke volume.", weeklyMinutesTarget: 90 },
      { pct: [0.80, 0.90], name: "Threshold", purpose: "Lactate threshold; sustains hard pace longer.", weeklyMinutesTarget: 40 },
      { pct: [0.90, 1.00], name: "VO₂ Max", purpose: "Peak power and VO₂max development.", weeklyMinutesTarget: 15 },
    ];
    const zones = bands.map((b, i) => {
      const lowBpm = method === "karvonen"
        ? Math.round(restingHr + hrr * b.pct[0])
        : Math.round(maxHr * b.pct[0]);
      const highBpm = method === "karvonen"
        ? Math.round(restingHr + hrr * b.pct[1])
        : Math.round(maxHr * b.pct[1]);
      // Seed weekly actual minutes deterministically by user-id+zone (demo)
      const actualSeed = (i * 31 + age) % 100;
      const weeklyMinutesActual = Math.round(b.weeklyMinutesTarget * (actualSeed / 100));
      return {
        zone: i + 1, name: b.name,
        lowBpm, highBpm,
        pctOfMax: `${Math.round(b.pct[0] * 100)}–${Math.round(b.pct[1] * 100)}%`,
        purpose: b.purpose,
        weeklyMinutesTarget: b.weeklyMinutesTarget,
        weeklyMinutesActual,
      };
    });
    return { ok: true, result: { zones, maxHr, restingHr, method } };
  });

  /**
   * recovery-history — Reads from STATE.fitnessLens.recoveryEntries,
   * which is populated by real device integrations (Whoop OAuth, Apple
   * HealthKit bridge, Garmin Connect IQ, Fitbit Web API). Per the
   * "everything must be real" directive, no synthetic Whoop-style data
   * is fabricated.
   */
  registerLensAction("fitness", "recovery-history", (ctx, _artifact, params = {}) => {
    const state = getFitState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const N = Math.max(1, Math.min(90, Number(params.days) || 14));
    const all = state.recoveryEntries?.get(userId) || [];
    const cutoff = Date.now() - N * 86400000;
    // Map each stored device row → the EXACT shape SleepRecovery.tsx renders
    // (recoveryScore / sleepDurationHours / sleepQualityPct / restingHr / hrv /
    // strainYesterday). The stored rows carry restingHr / hrv / sleepHours /
    // recoveryScore (written by wearable-sync); the component reads
    // sleepDurationHours / sleepQualityPct / strainYesterday, which never
    // existed on the row → undefined.toFixed() crash in prod. We surface the
    // real device fields under the rendered names and derive the rest ONLY from
    // present real values (no fabrication; missing → 0, never invented). The
    // raw row is preserved under `raw` for callers that want device-native keys.
    const sorted = all
      .filter((d) => d && !isNaN(new Date(d.date).getTime()) && new Date(d.date).getTime() >= cutoff)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const days = sorted.map((d, i) => {
      const sleepHours = fnum(d.sleepHours);
      const prev = i > 0 ? sorted[i - 1] : null;
      return {
        date: d.date,
        recoveryScore: Math.max(0, Math.min(100, Math.round(fnum(d.recoveryScore)))),
        sleepDurationHours: Math.max(0, Math.round(sleepHours * 100) / 100),
        // sleepQualityPct is reported by the device when present; otherwise it
        // is left at 0 (honest "not reported"), never synthesised.
        sleepQualityPct: Math.max(0, Math.min(100, Math.round(fnum(d.sleepQualityPct)))),
        restingHr: Math.max(0, Math.round(fnum(d.restingHr))),
        hrv: Math.max(0, Math.round(fnum(d.hrv) * 10) / 10),
        // strain "yesterday" is the prior day's reported strain, if the device
        // pushed one; 0 when there is no prior reading.
        strainYesterday: prev ? Math.max(0, Math.min(21, Math.round(fnum(prev.strain ?? prev.strainYesterday) * 10) / 10)) : 0,
        raw: d,
      };
    });
    return {
      ok: true,
      result: {
        days,
        source: days.length === 0 ? "empty" : "device",
        notes: days.length === 0
          ? "No recovery data logged. Connect a wearable (Whoop, Apple Watch, Garmin, Fitbit) or POST entries to fitness.recovery-log to populate."
          : null,
      },
    };
  });

  /**
   * activity-summary — Reads from STATE.fitnessLens.activityEntries,
   * populated by real device integrations or fitness.activity-log macro.
   * No synthesized Apple Fitness-style rings.
   */
  registerLensAction("fitness", "activity-summary", (ctx, _artifact, params = {}) => {
    const state = getFitState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const N = Math.max(1, Math.min(30, Number(params.days) || 7));
    const all = state.activityEntries?.get(userId) || [];
    const cutoff = Date.now() - N * 86400000;
    // Apple-Fitness ring goals. Standard targets; the device can override any
    // of them per-row (moveGoal/exerciseGoal/standGoal/stepsGoal). These are
    // GOALS (a fixed target), not fabricated metric data — the actual progress
    // values below come only from real stored device readings.
    const DEFAULT_MOVE_GOAL = 600, DEFAULT_EXERCISE_GOAL = 30, DEFAULT_STAND_GOAL = 12, DEFAULT_STEPS_GOAL = 10000;
    // Map each stored device row → the EXACT shape ActivityRings.tsx renders.
    // The stored row carries steps / activeCalories / exerciseMinutes (written
    // by wearable-sync); the component reads moveCalories / standHours and four
    // *Goal fields that never existed → undefined.toLocaleString() crash + NaN
    // ring widths in prod. We surface real values under the rendered names and
    // default the goals; missing real metrics → 0 (honest), never invented.
    const days = all
      .filter((d) => d && !isNaN(new Date(d.date).getTime()) && new Date(d.date).getTime() >= cutoff)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((d) => ({
        date: d.date,
        moveCalories: Math.max(0, Math.round(fnum(d.moveCalories ?? d.activeCalories))),
        moveGoal: Math.max(1, Math.round(fnum(d.moveGoal, DEFAULT_MOVE_GOAL))),
        exerciseMinutes: Math.max(0, Math.round(fnum(d.exerciseMinutes))),
        exerciseGoal: Math.max(1, Math.round(fnum(d.exerciseGoal, DEFAULT_EXERCISE_GOAL))),
        standHours: Math.max(0, Math.round(fnum(d.standHours))),
        standGoal: Math.max(1, Math.round(fnum(d.standGoal, DEFAULT_STAND_GOAL))),
        steps: Math.max(0, Math.round(fnum(d.steps))),
        stepsGoal: Math.max(1, Math.round(fnum(d.stepsGoal, DEFAULT_STEPS_GOAL))),
        raw: d,
      }));
    return {
      ok: true,
      result: {
        days,
        source: days.length === 0 ? "empty" : "device",
        notes: days.length === 0
          ? "No activity data logged. Connect a wearable (Apple Watch, Fitbit, Garmin) or POST entries to fitness.activity-log to populate."
          : null,
      },
    };
  });

  /**
   * workout-plan-generate — Conscious-brain generated multi-week plan.
   */
  // Deterministic workout-program generator (templated exercise library × split logic).
  // The default path needs NO model — it composes a real periodised plan from goal /
  // equipment / experience / frequency. The LLM is an opt-in enhancement
  // (CONCORD_FITNESS_PLAN_LLM=true) layered on top, with this as the guaranteed fallback.
  const FIT_REP_SCHEME = {
    strength:   { sets: 5, reps: "3-5",  restSec: 180, rpe: "RPE 8" },
    hypertrophy:{ sets: 4, reps: "8-12", restSec: 90,  rpe: "RPE 9" },
    endurance:  { sets: 3, reps: "15-20",restSec: 45,  rpe: "RPE 7" },
    fat_loss:   { sets: 3, reps: "12-15",restSec: 45,  rpe: "RPE 8, short rest" },
    general:    { sets: 3, reps: "8-12", restSec: 75,  rpe: "RPE 7-8" },
  };
  const FIT_EXERCISES = {
    "Upper push": { full_gym: ["Barbell Bench Press", "Overhead Press", "Incline Dumbbell Press", "Cable Triceps Pushdown"], home_dumbbells: ["Dumbbell Bench Press", "Dumbbell Shoulder Press", "Dumbbell Floor Press", "Overhead Triceps Extension"], bodyweight_only: ["Push-Up", "Pike Push-Up", "Dip", "Diamond Push-Up"] },
    "Upper pull": { full_gym: ["Pull-Up", "Barbell Row", "Lat Pulldown", "Face Pull"], home_dumbbells: ["Dumbbell Row", "Renegade Row", "Reverse Fly", "Dumbbell Curl"], bodyweight_only: ["Pull-Up", "Inverted Row", "Towel Row", "Chin-Up"] },
    "Lower": { full_gym: ["Back Squat", "Romanian Deadlift", "Leg Press", "Standing Calf Raise"], home_dumbbells: ["Goblet Squat", "Dumbbell RDL", "Walking Lunge", "Calf Raise"], bodyweight_only: ["Bulgarian Split Squat", "Glute Bridge", "Reverse Lunge", "Calf Raise"] },
    "Full body": { full_gym: ["Deadlift", "Front Squat", "Push Press", "Pull-Up"], home_dumbbells: ["Dumbbell Thruster", "Goblet Squat", "Dumbbell Row", "Dumbbell Swing"], bodyweight_only: ["Burpee", "Squat", "Push-Up", "Inverted Row"] },
    "Conditioning": { full_gym: ["Rowing Intervals", "Assault Bike", "Sled Push", "Farmer Carry"], home_dumbbells: ["Dumbbell Complex", "Jump Rope", "Renegade Row", "Mountain Climber"], bodyweight_only: ["Jump Rope", "Burpee Intervals", "Mountain Climber", "High Knees"] },
  };
  // Day-split focus rotation by weekly frequency.
  const FIT_SPLITS = {
    1: ["Full body"],
    2: ["Full body", "Full body"],
    3: ["Upper push", "Lower", "Upper pull"],
    4: ["Upper push", "Lower", "Upper pull", "Conditioning"],
    5: ["Upper push", "Lower", "Upper pull", "Full body", "Conditioning"],
    6: ["Upper push", "Upper pull", "Lower", "Upper push", "Upper pull", "Lower"],
    7: ["Upper push", "Upper pull", "Lower", "Conditioning", "Upper push", "Lower", "Conditioning"],
  };
  const FIT_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const FIT_PROGRESSION = {
    strength: "Add 2.5–5 lb to main lifts each week; deload every 4th week (−40% volume).",
    hypertrophy: "Add 1 rep per set weekly until the top of the range, then add load and reset reps.",
    endurance: "Add one set or reduce rest by 5s each week; build total work capacity.",
    fat_loss: "Hold strength loads; cut rest 5–10s weekly and add one conditioning finisher.",
    general: "Progress load or reps slightly each week; prioritise consistent form.",
  };
  const FIT_NUTRITION = {
    strength: "Slight surplus (~+150 kcal), 1.6–2.2 g protein/kg, fuel pre-lift.",
    hypertrophy: "Moderate surplus (~+250 kcal), 1.8–2.2 g protein/kg, carbs around training.",
    endurance: "Maintenance kcal, 1.4–1.8 g protein/kg, higher carbs for long sessions.",
    fat_loss: "Deficit (~−400 kcal), 1.8–2.4 g protein/kg to preserve muscle, high fibre.",
    general: "Maintenance kcal, 1.6 g protein/kg, mostly whole foods.",
  };
  function buildDeterministicPlan(goal, daysPerWeek, weeks, equipment, experience) {
    const scheme = FIT_REP_SCHEME[goal] || FIT_REP_SCHEME.general;
    const focuses = FIT_SPLITS[daysPerWeek] || FIT_SPLITS[4];
    // Experience scales exercise count (beginner fewer) + duration.
    const exCount = experience === "beginner" ? 3 : experience === "advanced" ? 5 : 4;
    const template = focuses.map((focus, i) => {
      const pool = (FIT_EXERCISES[focus] && FIT_EXERCISES[focus][equipment]) || FIT_EXERCISES["Full body"].full_gym;
      const exercises = pool.slice(0, exCount).map((name) => ({
        name, sets: scheme.sets, reps: scheme.reps, restSec: scheme.restSec, notes: scheme.rpe,
      }));
      return { day: FIT_DAYS[i % 7], focus, duration: 30 + exCount * 8, exercises };
    });
    return {
      goal, weeks, daysPerWeek,
      equipment, experience,
      template,
      progression: FIT_PROGRESSION[goal] || FIT_PROGRESSION.general,
      nutrition: FIT_NUTRITION[goal] || FIT_NUTRITION.general,
      composedBy: "deterministic",
    };
  }
  async function runWorkoutPlanGenerate(ctx, params = {}) {
    const goal = ["strength", "hypertrophy", "endurance", "fat_loss", "general"].includes(params.goal) ? params.goal : "general";
    const daysPerWeek = Math.max(1, Math.min(7, Number(params.daysPerWeek) || 4));
    const weeks = Math.max(1, Math.min(24, Number(params.weeks) || 8));
    const equipment = ["full_gym", "home_dumbbells", "bodyweight_only"].includes(params.equipment) ? params.equipment : "full_gym";
    const experience = ["beginner", "intermediate", "advanced"].includes(params.experience) ? params.experience : "intermediate";

    const deterministic = buildDeterministicPlan(goal, daysPerWeek, weeks, equipment, experience);
    // Opt-in LLM enhancement; deterministic plan is always the guaranteed fallback.
    if (process.env.CONCORD_FITNESS_PLAN_LLM === "true" && ctx?.llm?.chat) {
      try {
        const llmPlan = await llmWorkoutPlan(ctx, { goal, daysPerWeek, weeks, equipment, experience });
        if (llmPlan?.plan) return { ok: true, result: { plan: { ...llmPlan.plan, composedBy: "llm" } } };
      } catch { /* fall through to deterministic */ }
    }
    return { ok: true, result: { plan: deterministic } };
  }
  registerLensAction("fitness", "workout-plan-generate", (ctx, _artifact, params = {}) => runWorkoutPlanGenerate(ctx, params));
  // Alias for the fitness lens's "Generate program" button (was an AI-catch-all).
  registerLensAction("fitness", "generate-program", (ctx, artifact, params = {}) => runWorkoutPlanGenerate(ctx, { ...(artifact?.data || {}), ...params }));

  async function llmWorkoutPlan(ctx, params) {
    const { goal, daysPerWeek, weeks, equipment, experience } = params;
    const sys = `You are a certified strength coach. Output ONLY JSON, no prose, no fences.
{
  "plan": {
    "goal": "${goal}",
    "weeks": ${weeks},
    "daysPerWeek": ${daysPerWeek},
    "template": [
      {
        "day": "Monday",
        "focus": "Upper push",
        "duration": 60,
        "exercises": [
          {"name":"Barbell Bench Press","sets":4,"reps":"5","restSec":180,"notes":"top set RPE 8"}
        ]
      }
    ],
    "progression": "1-2 sentence weekly progression rule",
    "nutrition": "1-2 sentence nutrition guidance for the goal"
  }
}`;
    const user = `Goal: ${goal}
Frequency: ${daysPerWeek}/week × ${weeks} weeks
Equipment: ${equipment}
Experience: ${experience}
Generate the plan.`;
    try {
      const llmRes = await ctx.llm.chat({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: 0.4, maxTokens: 2048, slot: "conscious",
      });
      const raw = String(llmRes?.text || llmRes?.content || "").trim();
      const parsed = extractJsonFit(raw);
      if (!parsed?.plan) return null;
      return { plan: parsed.plan };
    } catch {
      return null;
    }
  }

  // ─── Strava + Garmin Connect 2026 parity ────────────────────────────
  // Activities, segments, routes, training-load (CTL/ATL/TSB),
  // Garmin physiology (readiness/body-battery/HRV/VO2max/race-predictor),
  // goals, PRs, gear, clubs, challenges. All STATE-backed, per-user
  // scoped, real sports-science math. No fabricated data.

  const fid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const fnow = () => new Date().toISOString();
  const faid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const flistB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const fnum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const fclamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fday = (v) => String(v || "").slice(0, 10);
  const ACTIVITY_TYPES = ["run", "ride", "swim", "walk", "hike", "row", "workout", "yoga", "ski", "elliptical"];

  function paceStr(secPerKm) {
    if (!Number.isFinite(secPerKm) || secPerKm <= 0) return null;
    const m = Math.floor(secPerKm / 60);
    const s = Math.round(secPerKm % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  function durStr(sec) {
    sec = Math.round(fnum(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
                 : `${m}:${String(s).padStart(2, "0")}`;
  }

  // Strava-style Relative Effort: HR-weighted training impulse (Banister-like).
  function relativeEffort(act) {
    const durMin = fnum(act.durationSec) / 60;
    if (durMin <= 0) return 0;
    const avgHr = fnum(act.avgHr);
    if (avgHr > 0) {
      const hrMax = fnum(act.maxHr) > avgHr ? fnum(act.maxHr) : 190;
      const frac = fclamp(avgHr / hrMax, 0.4, 1);
      // hard minutes weigh exponentially more than easy minutes
      return Math.round(durMin * Math.exp(2.2 * (frac - 0.5)));
    }
    const metByType = { run: 1.5, ride: 1.0, swim: 1.4, walk: 0.5, hike: 0.9, row: 1.3, workout: 1.1, yoga: 0.4, ski: 1.1, elliptical: 0.9 };
    return Math.round(durMin * (metByType[String(act.type || "").toLowerCase()] ?? 1.0));
  }

  // Daniels/Gilbert VDOT — VO2max from a race effort. d=metres, t=minutes.
  function vdotFromEffort(distanceMeters, timeMinutes) {
    if (distanceMeters <= 0 || timeMinutes <= 0) return 0;
    const v = distanceMeters / timeMinutes; // m/min
    const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * timeMinutes)
                    + 0.2989558 * Math.exp(-0.1932605 * timeMinutes);
    const vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v;
    return vo2 / pct;
  }
  // Invert VDOT — predict time (minutes) for a distance at a target VDOT.
  function predictTimeMinutes(distanceMeters, targetVdot) {
    if (distanceMeters <= 0 || targetVdot <= 0) return 0;
    let lo = 1, hi = 1200;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      // VDOT is monotonically decreasing in time for a fixed distance.
      if (vdotFromEffort(distanceMeters, mid) > targetVdot) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // Banister impulse-response: CTL (42d fitness), ATL (7d fatigue), TSB (form).
  function trainingLoadSeries(activities) {
    const byDay = new Map();
    for (const a of activities) {
      const d = fday(a.date || a.createdAt);
      if (!d) continue;
      byDay.set(d, (byDay.get(d) || 0) + fnum(a.relativeEffort));
    }
    const keys = [...byDay.keys()].sort();
    if (!keys.length) return { ctl: 0, atl: 0, tsb: 0, daily: [], days: 0 };
    const start = new Date(keys[0] + "T00:00:00Z").getTime();
    const end = Date.now();
    let ctl = 0, atl = 0;
    const daily = [];
    for (let t = start; t <= end + 86400000; t += 86400000) {
      const key = new Date(t).toISOString().slice(0, 10);
      const load = byDay.get(key) || 0;
      ctl += (load - ctl) / 42;
      atl += (load - atl) / 7;
      daily.push({
        date: key, load,
        ctl: Math.round(ctl * 10) / 10,
        atl: Math.round(atl * 10) / 10,
        tsb: Math.round((ctl - atl) * 10) / 10,
      });
    }
    const last = daily[daily.length - 1];
    return { ctl: last.ctl, atl: last.atl, tsb: last.tsb, daily: daily.slice(-120), days: daily.length };
  }

  function periodBounds(period) {
    const now = new Date();
    const d = new Date(now);
    if (period === "year") { d.setMonth(0, 1); }
    else if (period === "month") { d.setDate(1); }
    else { const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); } // week (Mon start)
    d.setHours(0, 0, 0, 0);
    return { start: d.getTime(), label: period || "week" };
  }

  // ── Activities ──────────────────────────────────────────────────────
  registerLensAction("fitness", "activity-create", (ctx, _a, params = {}) => {
  try {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const type = String(params.type || "").toLowerCase();
    if (!ACTIVITY_TYPES.includes(type)) return { ok: false, error: `type required (${ACTIVITY_TYPES.join("/")})` };
    const durationSec = fnum(params.durationSec);
    if (durationSec <= 0) return { ok: false, error: "durationSec must be > 0" };
    const distanceKm = Math.max(0, fnum(params.distanceKm));
    const act = {
      id: fid("act"),
      type,
      name: String(params.name || "").trim() || `${type[0].toUpperCase()}${type.slice(1)} activity`,
      distanceKm: Math.round(distanceKm * 1000) / 1000,
      durationSec: Math.round(durationSec),
      elevationGainM: Math.max(0, Math.round(fnum(params.elevationGainM))),
      avgHr: Math.max(0, Math.round(fnum(params.avgHr))),
      maxHr: Math.max(0, Math.round(fnum(params.maxHr))),
      calories: Math.max(0, Math.round(fnum(params.calories))),
      date: fday(params.date) || fday(fnow()),
      gearId: params.gearId ? String(params.gearId) : null,
      kudos: [],
      comments: [],
      createdAt: fnow(),
    };
    act.relativeEffort = relativeEffort(act);
    act.paceSecPerKm = distanceKm > 0 ? Math.round(durationSec / distanceKm) : null;
    act.speedKmh = distanceKm > 0 ? Math.round((distanceKm / (durationSec / 3600)) * 100) / 100 : null;
    flistB(s.activities, userId).push(act);
    if (act.gearId) {
      const gear = (s.gear.get(userId) || []).find((g) => g.id === act.gearId);
      if (gear) gear.distanceKm = Math.round((gear.distanceKm + distanceKm) * 100) / 100;
    }
    saveStateIfAvailable();
    return { ok: true, result: { activity: act } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("fitness", "activity-list", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let acts = [...(s.activities.get(faid(ctx)) || [])];
    if (params.type) acts = acts.filter((a) => a.type === String(params.type).toLowerCase());
    acts.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.createdAt.localeCompare(a.createdAt));
    const limit = fclamp(fnum(params.limit, 100), 1, 500);
    const totalDistanceKm = Math.round(acts.reduce((s2, a) => s2 + a.distanceKm, 0) * 100) / 100;
    return {
      ok: true,
      result: {
        activities: acts.slice(0, limit),
        count: acts.length,
        totalDistanceKm,
        totalRelativeEffort: acts.reduce((s2, a) => s2 + fnum(a.relativeEffort), 0),
      },
    };
  });

  registerLensAction("fitness", "activity-detail", (ctx, _a, params = {}) => {
  try {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const act = (s.activities.get(faid(ctx)) || []).find((a) => a.id === params.id);
    if (!act) return { ok: false, error: "activity not found" };
    const detail = {
      ...act,
      pace: paceStr(act.paceSecPerKm),
      duration: durStr(act.durationSec),
      caloriesPerKm: act.distanceKm > 0 ? Math.round(act.calories / act.distanceKm) : null,
    };
    if (Array.isArray(act.splits) && act.splits.length) {
      const splits = act.splits.map((sec, i) => ({ km: i + 1, seconds: fnum(sec), pace: paceStr(fnum(sec)) }));
      const fastest = splits.reduce((m, x) => (x.seconds < m.seconds ? x : m), splits[0]);
      const slowest = splits.reduce((m, x) => (x.seconds > m.seconds ? x : m), splits[0]);
      detail.splitAnalysis = { splits, fastestKm: fastest.km, slowestKm: slowest.km };
    }
    return { ok: true, result: { activity: detail } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("fitness", "activity-delete", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const arr = s.activities.get(userId) || [];
    const i = arr.findIndex((a) => a.id === params.id);
    if (i < 0) return { ok: false, error: "activity not found" };
    const [removed] = arr.splice(i, 1);
    if (removed.gearId) {
      const gear = (s.gear.get(userId) || []).find((g) => g.id === removed.gearId);
      if (gear) gear.distanceKm = Math.max(0, Math.round((gear.distanceKm - removed.distanceKm) * 100) / 100);
    }
    saveStateIfAvailable();
    return { ok: true, result: { deleted: removed.id } };
  });

  registerLensAction("fitness", "activity-kudos", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const ownerId = String(params.ownerUserId || userId);
    const act = (s.activities.get(ownerId) || []).find((a) => a.id === params.id);
    if (!act) return { ok: false, error: "activity not found" };
    if (!Array.isArray(act.kudos)) act.kudos = [];
    const had = act.kudos.includes(userId);
    if (params.comment) {
      if (!Array.isArray(act.comments)) act.comments = [];
      act.comments.push({ userId, text: String(params.comment).slice(0, 500), at: fnow() });
    } else {
      if (had) act.kudos = act.kudos.filter((u) => u !== userId);
      else act.kudos.push(userId);
    }
    saveStateIfAvailable();
    return { ok: true, result: { kudosCount: act.kudos.length, commentCount: act.comments.length, kudoed: !had && !params.comment } };
  });

  // ── Segments + leaderboards ─────────────────────────────────────────
  registerLensAction("fitness", "segment-create", (ctx, _a, params = {}) => {
  try {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const distanceKm = fnum(params.distanceKm);
    if (distanceKm <= 0) return { ok: false, error: "distanceKm must be > 0" };
    const seg = {
      id: fid("seg"),
      ownerUserId: faid(ctx),
      name,
      activityType: ACTIVITY_TYPES.includes(String(params.activityType).toLowerCase())
        ? String(params.activityType).toLowerCase() : "run",
      distanceKm: Math.round(distanceKm * 1000) / 1000,
      elevationGainM: Math.max(0, Math.round(fnum(params.elevationGainM))),
      gradePct: Math.round(fnum(params.gradePct) * 10) / 10,
      location: String(params.location || "").trim() || null,
      lat: Number.isFinite(Number(params.lat)) ? Number(params.lat) : null,
      lon: Number.isFinite(Number(params.lon)) ? Number(params.lon) : null,
      createdAt: fnow(),
    };
    s.segments.set(seg.id, seg);
    s.segmentEfforts.set(seg.id, []);
    saveStateIfAvailable();
    return { ok: true, result: { segment: seg } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("fitness", "segment-list", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let segs = [...s.segments.values()];
    if (params.mine) segs = segs.filter((x) => x.ownerUserId === faid(ctx));
    if (params.activityType) segs = segs.filter((x) => x.activityType === String(params.activityType).toLowerCase());
    segs = segs.map((seg) => {
      const efforts = s.segmentEfforts.get(seg.id) || [];
      const mine = efforts.filter((e) => e.userId === faid(ctx));
      const best = efforts.length ? Math.min(...efforts.map((e) => e.timeSeconds)) : null;
      return {
        ...seg,
        effortCount: efforts.length,
        myBestSeconds: mine.length ? Math.min(...mine.map((e) => e.timeSeconds)) : null,
        courseRecordSeconds: best,
      };
    });
    return { ok: true, result: { segments: segs, count: segs.length } };
  });

  registerLensAction("fitness", "segment-effort", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const seg = s.segments.get(String(params.segmentId));
    if (!seg) return { ok: false, error: "segment not found" };
    const timeSeconds = fnum(params.timeSeconds);
    if (timeSeconds <= 0) return { ok: false, error: "timeSeconds must be > 0" };
    const userId = faid(ctx);
    const efforts = flistB(s.segmentEfforts, seg.id);
    const priorMine = efforts.filter((e) => e.userId === userId).map((e) => e.timeSeconds);
    const isPR = !priorMine.length || timeSeconds < Math.min(...priorMine);
    const priorCR = efforts.length ? Math.min(...efforts.map((e) => e.timeSeconds)) : Infinity;
    const isCourseRecord = timeSeconds < priorCR;
    const effort = {
      id: fid("eff"), segmentId: seg.id, userId, timeSeconds,
      avgHr: Math.max(0, Math.round(fnum(params.avgHr))),
      date: fday(params.date) || fday(fnow()), createdAt: fnow(),
    };
    efforts.push(effort);
    saveStateIfAvailable();
    return { ok: true, result: { effort, isPR, isCourseRecord, segmentName: seg.name } };
  });

  registerLensAction("fitness", "segment-leaderboard", (ctx, _a, params = {}) => {
  try {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const seg = s.segments.get(String(params.segmentId));
    if (!seg) return { ok: false, error: "segment not found" };
    const efforts = s.segmentEfforts.get(seg.id) || [];
    // best effort per user → ranked ascending
    const bestByUser = new Map();
    for (const e of efforts) {
      const cur = bestByUser.get(e.userId);
      if (!cur || e.timeSeconds < cur.timeSeconds) bestByUser.set(e.userId, e);
    }
    const board = [...bestByUser.values()]
      .sort((a, b) => a.timeSeconds - b.timeSeconds)
      .map((e, i) => ({
        rank: i + 1, userId: e.userId,
        timeSeconds: e.timeSeconds, time: durStr(e.timeSeconds),
        avgHr: e.avgHr, date: e.date,
        title: i === 0 ? "CR" : null,
        isMe: e.userId === faid(ctx),
      }));
    return { ok: true, result: { segment: seg, leaderboard: board, athletes: board.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Routes ──────────────────────────────────────────────────────────
  registerLensAction("fitness", "route-create", (ctx, _a, params = {}) => {
  try {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const distanceKm = fnum(params.distanceKm);
    if (distanceKm <= 0) return { ok: false, error: "distanceKm must be > 0" };
    const elevationGainM = Math.max(0, Math.round(fnum(params.elevationGainM)));
    const route = {
      id: fid("rt"),
      name,
      activityType: ACTIVITY_TYPES.includes(String(params.activityType).toLowerCase())
        ? String(params.activityType).toLowerCase() : "run",
      distanceKm: Math.round(distanceKm * 1000) / 1000,
      elevationGainM,
      surface: ["road", "trail", "mixed", "track", "gravel"].includes(String(params.surface).toLowerCase())
        ? String(params.surface).toLowerCase() : "road",
      // climb difficulty from elevation per km (Strava-style trail rating)
      difficulty: (() => {
        const climbPerKm = distanceKm > 0 ? elevationGainM / distanceKm : 0;
        if (climbPerKm < 10) return "easy";
        if (climbPerKm < 25) return "moderate";
        if (climbPerKm < 50) return "hard";
        return "extreme";
      })(),
      pois: Array.isArray(params.pois) ? params.pois.slice(0, 50).map((p) => String(p).slice(0, 80)) : [],
      waypointCount: Array.isArray(params.waypoints) ? params.waypoints.length : 0,
      createdAt: fnow(),
    };
    flistB(s.routes, faid(ctx)).push(route);
    saveStateIfAvailable();
    return { ok: true, result: { route } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("fitness", "route-list", (ctx, _a, _params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const routes = [...(s.routes.get(faid(ctx)) || [])].reverse();
    return { ok: true, result: { routes, count: routes.length } };
  });

  registerLensAction("fitness", "route-delete", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.routes.get(faid(ctx)) || [];
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "route not found" };
    arr.splice(i, 1);
    saveStateIfAvailable();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Training load + Garmin physiology ───────────────────────────────
  registerLensAction("fitness", "training-load", (ctx, _a, _params = {}) => {
  try {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const acts = s.activities.get(faid(ctx)) || [];
    const tl = trainingLoadSeries(acts);
    let status = "no_data";
    if (acts.length) {
      if (tl.tsb < -25) status = "overreaching";
      else if (tl.tsb < -10) status = "productive";
      else if (tl.tsb < 5) status = "maintaining";
      else if (tl.tsb < 25) status = "fresh";
      else status = "detraining";
    }
    return {
      ok: true,
      result: {
        fitness: tl.ctl, fatigue: tl.atl, form: tl.tsb,
        status, trackedDays: tl.days, daily: tl.daily,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("fitness", "vo2max-estimate", (ctx, _a, params = {}) => {
  try {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let distanceMeters = fnum(params.distanceKm) * 1000;
    let timeMinutes = fnum(params.durationSec) / 60;
    let source = "supplied effort";
    if (distanceMeters <= 0 || timeMinutes <= 0) {
      // fall back to the best recent run in the athlete's log
      const runs = (s.activities.get(faid(ctx)) || [])
        .filter((a) => a.type === "run" && a.distanceKm >= 1.5 && a.durationSec > 0);
      if (!runs.length) return { ok: false, error: "supply distanceKm + durationSec, or log a run ≥1.5km" };
      const best = runs.reduce((m, a) => (vdotFromEffort(a.distanceKm * 1000, a.durationSec / 60)
        > vdotFromEffort(m.distanceKm * 1000, m.durationSec / 60) ? a : m));
      distanceMeters = best.distanceKm * 1000;
      timeMinutes = best.durationSec / 60;
      source = `best logged run (${best.name})`;
    }
    const vo2max = vdotFromEffort(distanceMeters, timeMinutes);
    if (!Number.isFinite(vo2max) || vo2max <= 0) return { ok: false, error: "could not estimate" };
    const rounded = Math.round(vo2max * 10) / 10;
    let fitnessAge = null;
    const age = fnum(params.age);
    if (age > 0) {
      // ~0.4 ml/kg/min decline per year past 25 from a 48 baseline
      fitnessAge = Math.round(fclamp(25 + (48 - rounded) / 0.4, 18, 90));
    }
    return {
      ok: true,
      result: {
        vo2max: rounded,
        rating: rounded >= 56 ? "superior" : rounded >= 48 ? "excellent"
              : rounded >= 42 ? "good" : rounded >= 35 ? "fair" : "poor",
        fitnessAge, source,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("fitness", "race-predictor", (ctx, _a, params = {}) => {
  try {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let vdot = fnum(params.vo2max);
    let source = "supplied VO2max";
    if (vdot <= 0) {
      const runs = (s.activities.get(faid(ctx)) || [])
        .filter((a) => a.type === "run" && a.distanceKm >= 1.5 && a.durationSec > 0);
      if (!runs.length) return { ok: false, error: "supply vo2max, or log a run ≥1.5km" };
      vdot = Math.max(...runs.map((a) => vdotFromEffort(a.distanceKm * 1000, a.durationSec / 60)));
      source = "best logged run";
    }
    const distances = [
      { name: "5K", meters: 5000 },
      { name: "10K", meters: 10000 },
      { name: "Half Marathon", meters: 21097.5 },
      { name: "Marathon", meters: 42195 },
    ];
    const predictions = distances.map((d) => {
      const minutes = predictTimeMinutes(d.meters, vdot);
      const sec = minutes * 60;
      return {
        distance: d.name,
        timeSeconds: Math.round(sec),
        time: durStr(sec),
        paceSecPerKm: Math.round(sec / (d.meters / 1000)),
        pace: paceStr(sec / (d.meters / 1000)),
      };
    });
    return { ok: true, result: { vo2max: Math.round(vdot * 10) / 10, source, predictions } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("fitness", "hrv-log", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rmssd = fnum(params.rmssd);
    if (rmssd <= 0) return { ok: false, error: "rmssd (ms) must be > 0" };
    const sample = {
      id: fid("hrv"), rmssd: Math.round(rmssd * 10) / 10,
      restingHr: Math.max(0, Math.round(fnum(params.restingHr))),
      date: fday(params.date) || fday(fnow()), createdAt: fnow(),
    };
    flistB(s.hrvSamples, faid(ctx)).push(sample);
    saveStateIfAvailable();
    return { ok: true, result: { sample } };
  });

  registerLensAction("fitness", "hrv-status", (ctx, _a, _params = {}) => {
  try {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const samples = [...(s.hrvSamples.get(faid(ctx)) || [])].sort((a, b) => a.date.localeCompare(b.date));
    if (samples.length < 3) {
      return { ok: true, result: { status: "insufficient_data", samples: samples.length, notes: "Log at least 3 nightly HRV readings for a status." } };
    }
    const recent = samples.slice(-7);
    const recentAvg = recent.reduce((a, x) => a + x.rmssd, 0) / recent.length;
    const baseline = samples.reduce((a, x) => a + x.rmssd, 0) / samples.length;
    const ratio = baseline > 0 ? recentAvg / baseline : 1;
    let status;
    if (ratio >= 1.05) status = "balanced_high";
    else if (ratio >= 0.95) status = "balanced";
    else if (ratio >= 0.85) status = "unbalanced";
    else status = "low";
    return {
      ok: true,
      result: {
        status,
        recent7Avg: Math.round(recentAvg * 10) / 10,
        baselineAvg: Math.round(baseline * 10) / 10,
        deviationPct: Math.round((ratio - 1) * 1000) / 10,
        samples: samples.length,
        latest: samples[samples.length - 1],
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("fitness", "training-readiness", (ctx, _a, params = {}) => {
  try {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const factors = [];
    let score = 65;
    // sleep
    const sleepHours = fnum(params.sleepHours);
    if (sleepHours > 0) {
      let sf = sleepHours >= 7.5 ? 15 : sleepHours >= 6.5 ? 5 : sleepHours >= 5.5 ? -5 : -20;
      score += sf; factors.push({ factor: "sleep", hours: sleepHours, contribution: sf });
    }
    // HRV vs baseline
    const samples = [...(s.hrvSamples.get(userId) || [])].sort((a, b) => a.date.localeCompare(b.date));
    if (samples.length >= 3) {
      const recent = samples.slice(-7);
      const recentAvg = recent.reduce((a, x) => a + x.rmssd, 0) / recent.length;
      const baseline = samples.reduce((a, x) => a + x.rmssd, 0) / samples.length;
      const ratio = baseline > 0 ? recentAvg / baseline : 1;
      let hf = ratio >= 1.05 ? 15 : ratio >= 0.95 ? 10 : ratio >= 0.85 ? -5 : -20;
      score += hf; factors.push({ factor: "hrv", ratio: Math.round(ratio * 100) / 100, contribution: hf });
    }
    // training load (form/TSB)
    const tl = trainingLoadSeries(s.activities.get(userId) || []);
    if (tl.days > 0) {
      let lf = tl.tsb < -25 ? -20 : tl.tsb < -10 ? -8 : tl.tsb < 10 ? 0 : 5;
      score += lf; factors.push({ factor: "training_load", form: tl.tsb, contribution: lf });
    }
    score = Math.round(fclamp(score, 1, 100));
    let label;
    if (score >= 80) label = "prime";
    else if (score >= 60) label = "ready";
    else if (score >= 40) label = "moderate";
    else if (score >= 20) label = "low";
    else label = "poor";
    return {
      ok: true,
      result: {
        score, label, factors,
        recommendation: score >= 60 ? "Good day for a hard or long session."
          : score >= 40 ? "Moderate effort recommended; keep it controlled."
          : "Prioritise recovery — easy movement or rest.",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("fitness", "body-battery", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const acts = s.activities.get(userId) || [];
    const today = fday(fnow());
    const todayDrain = acts.filter((a) => a.date === today)
      .reduce((sum, a) => sum + fnum(a.relativeEffort), 0);
    const yesterday = fday(new Date(Date.now() - 86400000).toISOString());
    const yesterdayDrain = acts.filter((a) => a.date === yesterday)
      .reduce((sum, a) => sum + fnum(a.relativeEffort), 0);
    const sleepHours = fnum(params.sleepHours, 7);
    // base recharge from sleep, drain from today's load, partial carry-over from yesterday
    let battery = 25 + Math.min(60, sleepHours * 8) - todayDrain * 0.45 - yesterdayDrain * 0.12;
    battery = Math.round(fclamp(battery, 5, 100));
    return {
      ok: true,
      result: {
        battery,
        state: battery >= 70 ? "charged" : battery >= 40 ? "moderate" : battery >= 20 ? "low" : "drained",
        todayDrain: Math.round(todayDrain),
        sleepHours,
      },
    };
  });

  // ── Goals ───────────────────────────────────────────────────────────
  registerLensAction("fitness", "goal-create", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const metric = ["distance", "duration", "activity_count", "elevation", "relative_effort"].includes(params.metric)
      ? params.metric : null;
    if (!metric) return { ok: false, error: "metric required (distance/duration/activity_count/elevation/relative_effort)" };
    const target = fnum(params.target);
    if (target <= 0) return { ok: false, error: "target must be > 0" };
    const goal = {
      id: fid("goal"), metric, target,
      period: ["week", "month", "year"].includes(params.period) ? params.period : "week",
      activityType: ACTIVITY_TYPES.includes(String(params.activityType).toLowerCase())
        ? String(params.activityType).toLowerCase() : null,
      label: String(params.label || "").trim() || null,
      createdAt: fnow(),
    };
    flistB(s.goals, faid(ctx)).push(goal);
    saveStateIfAvailable();
    return { ok: true, result: { goal } };
  });

  function goalProgress(goal, acts) {
    const { start } = periodBounds(goal.period);
    let inWindow = acts.filter((a) => new Date((a.date || "") + "T00:00:00Z").getTime() >= start);
    if (goal.activityType) inWindow = inWindow.filter((a) => a.type === goal.activityType);
    let value = 0;
    for (const a of inWindow) {
      if (goal.metric === "distance") value += a.distanceKm;
      else if (goal.metric === "duration") value += a.durationSec / 3600;
      else if (goal.metric === "activity_count") value += 1;
      else if (goal.metric === "elevation") value += fnum(a.elevationGainM);
      else if (goal.metric === "relative_effort") value += fnum(a.relativeEffort);
    }
    value = Math.round(value * 100) / 100;
    return {
      value,
      pct: Math.round(fclamp(value / goal.target, 0, 1) * 100),
      complete: value >= goal.target,
      remaining: Math.max(0, Math.round((goal.target - value) * 100) / 100),
    };
  }

  registerLensAction("fitness", "goal-list", (ctx, _a, _params = {}) => {
  try {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const acts = s.activities.get(userId) || [];
    const goals = (s.goals.get(userId) || []).map((g) => ({ ...g, progress: goalProgress(g, acts) }));
    return {
      ok: true,
      result: { goals, count: goals.length, completed: goals.filter((g) => g.progress.complete).length },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("fitness", "goal-delete", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.goals.get(faid(ctx)) || [];
    const i = arr.findIndex((g) => g.id === params.id);
    if (i < 0) return { ok: false, error: "goal not found" };
    arr.splice(i, 1);
    saveStateIfAvailable();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Personal records ────────────────────────────────────────────────
  registerLensAction("fitness", "personal-records", (ctx, _a, _params = {}) => {
  try {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const acts = s.activities.get(faid(ctx)) || [];
    if (!acts.length) return { ok: true, result: { records: [], activities: 0 } };
    const records = [];
    const push = (label, act, value, display) => {
      if (act) records.push({ label, value, display, activityId: act.id, activityName: act.name, date: act.date });
    };
    const byMax = (arr, key) => arr.reduce((m, a) => (fnum(a[key]) > fnum(m?.[key] ?? -1) ? a : m), null);
    push("Longest distance", byMax(acts, "distanceKm"),
      byMax(acts, "distanceKm")?.distanceKm,
      `${byMax(acts, "distanceKm")?.distanceKm} km`);
    push("Longest duration", byMax(acts, "durationSec"),
      byMax(acts, "durationSec")?.durationSec,
      durStr(byMax(acts, "durationSec")?.durationSec || 0));
    push("Biggest climb", byMax(acts, "elevationGainM"),
      byMax(acts, "elevationGainM")?.elevationGainM,
      `${byMax(acts, "elevationGainM")?.elevationGainM} m`);
    push("Highest relative effort", byMax(acts, "relativeEffort"),
      byMax(acts, "relativeEffort")?.relativeEffort,
      String(byMax(acts, "relativeEffort")?.relativeEffort));
    // fastest pace among runs ≥ 1km
    const pacedRuns = acts.filter((a) => a.type === "run" && a.distanceKm >= 1 && a.paceSecPerKm);
    if (pacedRuns.length) {
      const fastest = pacedRuns.reduce((m, a) => (a.paceSecPerKm < m.paceSecPerKm ? a : m));
      push("Fastest run pace", fastest, fastest.paceSecPerKm, `${paceStr(fastest.paceSecPerKm)} /km`);
    }
    // biggest single week by distance
    const byWeek = new Map();
    for (const a of acts) {
      const d = new Date((a.date || "") + "T00:00:00Z");
      if (isNaN(d)) continue;
      const dow = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - dow);
      const wk = d.toISOString().slice(0, 10);
      byWeek.set(wk, (byWeek.get(wk) || 0) + a.distanceKm);
    }
    if (byWeek.size) {
      const [wk, km] = [...byWeek.entries()].reduce((m, x) => (x[1] > m[1] ? x : m));
      records.push({ label: "Biggest week", value: Math.round(km * 100) / 100, display: `${Math.round(km * 100) / 100} km`, weekOf: wk });
    }
    return { ok: true, result: { records, activities: acts.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Gear ────────────────────────────────────────────────────────────
  registerLensAction("fitness", "gear-add", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const kind = ["shoes", "bike", "other"].includes(String(params.kind).toLowerCase())
      ? String(params.kind).toLowerCase() : "shoes";
    const gear = {
      id: fid("gear"), name, kind,
      distanceKm: Math.max(0, fnum(params.initialDistanceKm)),
      // default wear thresholds: ~640km for shoes, ~5000km bike chain interval
      retireAtKm: fnum(params.retireAtKm) > 0 ? fnum(params.retireAtKm) : (kind === "shoes" ? 640 : kind === "bike" ? 5000 : 1000),
      retired: false,
      createdAt: fnow(),
    };
    flistB(s.gear, faid(ctx)).push(gear);
    saveStateIfAvailable();
    return { ok: true, result: { gear } };
  });

  registerLensAction("fitness", "gear-list", (ctx, _a, _params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const gear = (s.gear.get(faid(ctx)) || []).map((g) => {
      const wearPct = g.retireAtKm > 0 ? Math.round(fclamp(g.distanceKm / g.retireAtKm, 0, 2) * 100) : 0;
      return {
        ...g, wearPct,
        status: g.retired ? "retired" : wearPct >= 100 ? "replace_now" : wearPct >= 85 ? "wearing_out" : "ok",
      };
    });
    return { ok: true, result: { gear, count: gear.length } };
  });

  registerLensAction("fitness", "gear-retire", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const g = (s.gear.get(faid(ctx)) || []).find((x) => x.id === params.id);
    if (!g) return { ok: false, error: "gear not found" };
    g.retired = !(params.unretire === true);
    saveStateIfAvailable();
    return { ok: true, result: { gear: g } };
  });

  // ── Clubs ───────────────────────────────────────────────────────────
  registerLensAction("fitness", "club-create", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const userId = faid(ctx);
    const club = {
      id: fid("club"), name, ownerUserId: userId,
      sport: ACTIVITY_TYPES.includes(String(params.sport).toLowerCase())
        ? String(params.sport).toLowerCase() : "run",
      description: String(params.description || "").trim().slice(0, 500) || null,
      members: [userId], createdAt: fnow(),
    };
    s.clubs.set(club.id, club);
    saveStateIfAvailable();
    return { ok: true, result: { club } };
  });

  registerLensAction("fitness", "club-list", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    let clubs = [...s.clubs.values()];
    if (params.mine) clubs = clubs.filter((c) => c.members.includes(userId));
    clubs = clubs.map((c) => ({ ...c, memberCount: c.members.length, joined: c.members.includes(userId) }));
    return { ok: true, result: { clubs, count: clubs.length } };
  });

  registerLensAction("fitness", "club-join", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const club = s.clubs.get(String(params.id));
    if (!club) return { ok: false, error: "club not found" };
    const userId = faid(ctx);
    const leaving = params.leave === true;
    if (leaving) club.members = club.members.filter((m) => m !== userId);
    else if (!club.members.includes(userId)) club.members.push(userId);
    saveStateIfAvailable();
    return { ok: true, result: { joined: !leaving, memberCount: club.members.length } };
  });

  // ── Challenges ──────────────────────────────────────────────────────
  registerLensAction("fitness", "challenge-create", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const metric = ["distance", "elevation", "activity_count", "duration"].includes(params.metric)
      ? params.metric : null;
    if (!metric) return { ok: false, error: "metric required (distance/elevation/activity_count/duration)" };
    const target = fnum(params.target);
    if (target <= 0) return { ok: false, error: "target must be > 0" };
    const userId = faid(ctx);
    const ch = {
      id: fid("chal"), name, metric, target, ownerUserId: userId,
      startDate: fday(params.startDate) || fday(fnow()),
      endDate: fday(params.endDate) || fday(new Date(Date.now() + 30 * 86400000).toISOString()),
      activityType: ACTIVITY_TYPES.includes(String(params.activityType).toLowerCase())
        ? String(params.activityType).toLowerCase() : null,
      participants: [userId], createdAt: fnow(),
    };
    s.challenges.set(ch.id, ch);
    saveStateIfAvailable();
    return { ok: true, result: { challenge: ch } };
  });

  function challengeProgress(ch, acts) {
    let inWindow = acts.filter((a) => {
      const d = a.date || "";
      return d >= ch.startDate && d <= ch.endDate;
    });
    if (ch.activityType) inWindow = inWindow.filter((a) => a.type === ch.activityType);
    let value = 0;
    for (const a of inWindow) {
      if (ch.metric === "distance") value += a.distanceKm;
      else if (ch.metric === "elevation") value += fnum(a.elevationGainM);
      else if (ch.metric === "activity_count") value += 1;
      else if (ch.metric === "duration") value += a.durationSec / 3600;
    }
    return Math.round(value * 100) / 100;
  }

  registerLensAction("fitness", "challenge-list", (ctx, _a, params = {}) => {
  try {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    let challenges = [...s.challenges.values()];
    if (params.mine) challenges = challenges.filter((c) => c.participants.includes(userId));
    const today = fday(fnow());
    challenges = challenges.map((ch) => {
      const myActs = s.activities.get(userId) || [];
      const myValue = challengeProgress(ch, myActs);
      // leaderboard across all participants
      const board = ch.participants.map((p) => ({
        userId: p,
        value: challengeProgress(ch, s.activities.get(p) || []),
      })).sort((a, b) => b.value - a.value)
        .map((x, i) => ({ rank: i + 1, ...x, isMe: x.userId === userId }));
      return {
        ...ch,
        joined: ch.participants.includes(userId),
        active: today >= ch.startDate && today <= ch.endDate,
        participantCount: ch.participants.length,
        myProgress: { value: myValue, pct: Math.round(fclamp(myValue / ch.target, 0, 1) * 100), complete: myValue >= ch.target },
        leaderboard: board,
      };
    });
    return { ok: true, result: { challenges, count: challenges.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("fitness", "challenge-join", (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ch = s.challenges.get(String(params.id));
    if (!ch) return { ok: false, error: "challenge not found" };
    const userId = faid(ctx);
    const leaving = params.leave === true;
    if (leaving) ch.participants = ch.participants.filter((p) => p !== userId);
    else if (!ch.participants.includes(userId)) ch.participants.push(userId);
    saveStateIfAvailable();
    return { ok: true, result: { joined: !leaving, participantCount: ch.participants.length } };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("fitness", "fitness-dashboard", (ctx, _a, _params = {}) => {
  try {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const acts = s.activities.get(userId) || [];
    const { start } = periodBounds("week");
    const thisWeek = acts.filter((a) => new Date((a.date || "") + "T00:00:00Z").getTime() >= start);
    const tl = trainingLoadSeries(acts);
    const goals = (s.goals.get(userId) || []).map((g) => goalProgress(g, acts));
    const gear = s.gear.get(userId) || [];
    return {
      ok: true,
      result: {
        week: {
          activities: thisWeek.length,
          distanceKm: Math.round(thisWeek.reduce((x, a) => x + a.distanceKm, 0) * 100) / 100,
          durationSec: thisWeek.reduce((x, a) => x + a.durationSec, 0),
          elevationGainM: thisWeek.reduce((x, a) => x + fnum(a.elevationGainM), 0),
          relativeEffort: thisWeek.reduce((x, a) => x + fnum(a.relativeEffort), 0),
        },
        trainingLoad: { fitness: tl.ctl, fatigue: tl.atl, form: tl.tsb },
        goals: { total: goals.length, completed: goals.filter((g) => g.complete).length },
        gear: { tracked: gear.length, needReplacement: gear.filter((g) => !g.retired && g.retireAtKm > 0 && g.distanceKm >= g.retireAtKm).length },
        totals: {
          activities: acts.length,
          distanceKm: Math.round(acts.reduce((x, a) => x + a.distanceKm, 0) * 100) / 100,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ════════════════════════════════════════════════════════════════════
  // Parity backlog — Strava / Garmin 2026 feature gap closure.
  // GPS recording + GPX import, wearable sync, map heatmap, photos +
  // comments, live Beacon, training-plan calendar, fitness-freshness.
  // All STATE-backed, per-user scoped, real user input only.
  // ════════════════════════════════════════════════════════════════════

  function getFitState2() {
    const s = getFitState();
    if (!s) return null;
    for (const k of [
      "gpsTracks", "trainingPlans", "wearableLinks", "beacons",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }

  // Haversine distance between two [lat,lon] points, metres.
  function haversineM(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLon = toRad(b[1] - a[1]);
    const lat1 = toRad(a[0]);
    const lat2 = toRad(b[0]);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Reduce a GPS point stream to summary metrics: distance, elevation
  // gain, moving time, bounds. Points: {lat,lon,ele?,t?(epoch ms or ISO)}.
  function summarizeTrack(points) {
    let distanceM = 0;
    let elevationGainM = 0;
    let movingSec = 0;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    let firstT = null, lastT = null;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const lat = Number(p.lat), lon = Number(p.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
      const t = p.t != null ? new Date(p.t).getTime() : null;
      if (t != null && Number.isFinite(t)) {
        if (firstT == null) firstT = t;
        lastT = t;
      }
      if (i > 0) {
        const prev = points[i - 1];
        const seg = haversineM([Number(prev.lat), Number(prev.lon)], [lat, lon]);
        if (Number.isFinite(seg)) distanceM += seg;
        const ele = Number(p.ele), preEle = Number(prev.ele);
        if (Number.isFinite(ele) && Number.isFinite(preEle) && ele > preEle) {
          elevationGainM += ele - preEle;
        }
        const pt = prev.t != null ? new Date(prev.t).getTime() : null;
        if (t != null && pt != null && t > pt && seg > 0.5) {
          // count only segments where the athlete actually moved
          movingSec += (t - pt) / 1000;
        }
      }
    }
    return {
      distanceKm: Math.round((distanceM / 1000) * 1000) / 1000,
      elevationGainM: Math.round(elevationGainM),
      movingSec: Math.round(movingSec),
      elapsedSec: firstT != null && lastT != null ? Math.round((lastT - firstT) / 1000) : 0,
      pointCount: points.length,
      bounds: minLat === Infinity ? null
        : { minLat, maxLat, minLon, maxLon,
            centerLat: (minLat + maxLat) / 2, centerLon: (minLon + maxLon) / 2 },
    };
  }

  // Minimal GPX <trkpt> parser — no XML library, regex over the track
  // point elements. Reads lat/lon attributes + nested <ele>/<time>.
  function parseGpx(xml) {
    const points = [];
    const re = /<trkpt\b[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"[^>]*?>([\s\S]*?)<\/trkpt>/gi;
    const reSelfClose = /<trkpt\b[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"[^>]*?\/>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
      const inner = m[3] || "";
      const ele = inner.match(/<ele>([-\d.]+)<\/ele>/i);
      const time = inner.match(/<time>([^<]+)<\/time>/i);
      points.push({
        lat, lon,
        ele: ele ? parseFloat(ele[1]) : undefined,
        t: time ? time[1].trim() : undefined,
      });
    }
    while ((m = reSelfClose.exec(xml)) !== null) {
      points.push({ lat: parseFloat(m[1]), lon: parseFloat(m[2]) });
    }
    return points;
  }

  // ── GPS recording + GPX import ──────────────────────────────────────
  /**
   * gps-record — persist a recorded or imported GPS point stream and
   * create a backing activity from its computed summary. Accepts either
   * `points` (array of {lat,lon,ele?,t?}) or `gpx` (raw GPX XML string).
   */
  registerLensAction("fitness", "gps-record", (ctx, _a, params = {}) => {
  try {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    let points = Array.isArray(params.points) ? params.points : null;
    let imported = false;
    if (!points && typeof params.gpx === "string" && params.gpx.trim()) {
      points = parseGpx(params.gpx);
      imported = true;
    }
    if (!points || points.length < 2) {
      return { ok: false, error: "supply points[] (≥2) or a gpx string with track points" };
    }
    const type = ACTIVITY_TYPES.includes(String(params.type || "").toLowerCase())
      ? String(params.type).toLowerCase() : "run";
    const summary = summarizeTrack(points);
    if (summary.distanceKm <= 0) return { ok: false, error: "track has no measurable distance" };
    const durationSec = summary.movingSec > 0 ? summary.movingSec
      : summary.elapsedSec > 0 ? summary.elapsedSec
      : fnum(params.durationSec);
    if (durationSec <= 0) return { ok: false, error: "track has no timing — pass durationSec" };

    const act = {
      id: fid("act"),
      type,
      name: String(params.name || "").trim()
        || `${type[0].toUpperCase()}${type.slice(1)} ${imported ? "(GPX import)" : "(GPS)"}`,
      distanceKm: summary.distanceKm,
      durationSec: Math.round(durationSec),
      elevationGainM: summary.elevationGainM,
      avgHr: Math.max(0, Math.round(fnum(params.avgHr))),
      maxHr: Math.max(0, Math.round(fnum(params.maxHr))),
      calories: Math.max(0, Math.round(fnum(params.calories))),
      date: fday(params.date) || fday(fnow()),
      gearId: params.gearId ? String(params.gearId) : null,
      kudos: [], comments: [], photos: [],
      hasGps: true, source: imported ? "gpx_import" : "gps_recording",
      createdAt: fnow(),
    };
    act.relativeEffort = relativeEffort(act);
    act.paceSecPerKm = act.distanceKm > 0 ? Math.round(act.durationSec / act.distanceKm) : null;
    act.speedKmh = act.distanceKm > 0
      ? Math.round((act.distanceKm / (act.durationSec / 3600)) * 100) / 100 : null;
    flistB(s.activities, userId).push(act);

    // store the raw track keyed by activity id (downsample huge streams)
    const stride = points.length > 2000 ? Math.ceil(points.length / 2000) : 1;
    const track = {
      activityId: act.id,
      points: points.filter((_, i) => i % stride === 0).map((p) => ({
        lat: Number(p.lat), lon: Number(p.lon),
        ele: Number.isFinite(Number(p.ele)) ? Number(p.ele) : null,
      })),
      bounds: summary.bounds,
      source: act.source,
      createdAt: fnow(),
    };
    s.gpsTracks.set(act.id, track);

    if (act.gearId) {
      const gear = (s.gear.get(userId) || []).find((g) => g.id === act.gearId);
      if (gear) gear.distanceKm = Math.round((gear.distanceKm + act.distanceKm) * 100) / 100;
    }
    saveStateIfAvailable();
    return { ok: true, result: { activity: act, summary, imported } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("fitness", "gps-track", (ctx, _a, params = {}) => {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const act = (s.activities.get(faid(ctx)) || []).find((a) => a.id === params.id);
    if (!act) return { ok: false, error: "activity not found" };
    const track = s.gpsTracks.get(params.id);
    if (!track) return { ok: false, error: "no GPS track for this activity" };
    return { ok: true, result: { track } };
  });

  // ── Wearable sync (Apple Health / Garmin / Fitbit) ──────────────────
  const WEARABLE_PROVIDERS = ["apple_health", "garmin", "fitbit", "whoop"];

  registerLensAction("fitness", "wearable-link", (ctx, _a, params = {}) => {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const provider = String(params.provider || "").toLowerCase();
    if (!WEARABLE_PROVIDERS.includes(provider)) {
      return { ok: false, error: `provider required (${WEARABLE_PROVIDERS.join("/")})` };
    }
    const userId = faid(ctx);
    const links = flistB(s.wearableLinks, userId);
    if (params.unlink === true) {
      const i = links.findIndex((l) => l.provider === provider);
      if (i < 0) return { ok: false, error: "provider not linked" };
      links.splice(i, 1);
      saveStateIfAvailable();
      return { ok: true, result: { unlinked: provider } };
    }
    let link = links.find((l) => l.provider === provider);
    if (!link) {
      link = { provider, linkedAt: fnow(), lastSyncAt: null, deviceName: null };
      links.push(link);
    }
    if (params.deviceName) link.deviceName = String(params.deviceName).slice(0, 80);
    saveStateIfAvailable();
    return { ok: true, result: { link } };
  });

  registerLensAction("fitness", "wearable-status", (ctx, _a, _params = {}) => {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const links = s.wearableLinks.get(faid(ctx)) || [];
    return { ok: true, result: { links, count: links.length } };
  });

  /**
   * wearable-sync — ingest a batch of HR / sleep / steps samples pushed
   * from a linked device bridge. Routes recovery + activity metrics into
   * the same STATE Maps the existing recovery/activity macros read. No
   * synthetic data — the bridge supplies real device readings.
   */
  registerLensAction("fitness", "wearable-sync", (ctx, _a, params = {}) => {
  try {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const provider = String(params.provider || "").toLowerCase();
    if (!WEARABLE_PROVIDERS.includes(provider)) {
      return { ok: false, error: `provider required (${WEARABLE_PROVIDERS.join("/")})` };
    }
    const userId = faid(ctx);
    const link = (s.wearableLinks.get(userId) || []).find((l) => l.provider === provider);
    if (!link) return { ok: false, error: "link the provider first via wearable-link" };

    const samples = Array.isArray(params.samples) ? params.samples : [];
    if (!samples.length) return { ok: false, error: "samples[] required" };

    if (!(s.recoveryEntries instanceof Map)) s.recoveryEntries = new Map();
    if (!(s.activityEntries instanceof Map)) s.activityEntries = new Map();
    const recov = flistB(s.recoveryEntries, userId);
    const activ = flistB(s.activityEntries, userId);
    const hrvArr = flistB(s.hrvSamples, userId);

    let recoveryAdded = 0, activityAdded = 0, hrvAdded = 0;
    for (const sm of samples) {
      const date = fday(sm.date);
      if (!date) continue;
      const restingHr = Math.max(0, Math.round(fnum(sm.restingHr)));
      const hrv = Math.round(fnum(sm.hrv) * 10) / 10;
      const sleepHours = Math.round(fnum(sm.sleepHours) * 100) / 100;
      const recoveryScore = Math.max(0, Math.round(fnum(sm.recoveryScore)));
      const steps = Math.max(0, Math.round(fnum(sm.steps)));
      const activeCalories = Math.max(0, Math.round(fnum(sm.activeCalories)));
      const exerciseMinutes = Math.max(0, Math.round(fnum(sm.exerciseMinutes)));

      // recovery row if any recovery-grade metric present
      if (restingHr > 0 || hrv > 0 || sleepHours > 0 || recoveryScore > 0) {
        const ex = recov.find((r) => r.date === date);
        const row = ex || { date };
        if (restingHr > 0) row.restingHr = restingHr;
        if (hrv > 0) row.hrv = hrv;
        if (sleepHours > 0) row.sleepHours = sleepHours;
        if (recoveryScore > 0) row.recoveryScore = recoveryScore;
        row.source = provider;
        if (!ex) { recov.push(row); recoveryAdded++; }
      }
      // activity-ring row if any activity-grade metric present
      if (steps > 0 || activeCalories > 0 || exerciseMinutes > 0) {
        const ex = activ.find((r) => r.date === date);
        const row = ex || { date };
        if (steps > 0) row.steps = steps;
        if (activeCalories > 0) row.activeCalories = activeCalories;
        if (exerciseMinutes > 0) row.exerciseMinutes = exerciseMinutes;
        row.source = provider;
        if (!ex) { activ.push(row); activityAdded++; }
      }
      // HRV nightly sample so hrv-status / readiness pick it up
      if (hrv > 0) {
        if (!hrvArr.some((h) => h.date === date && h.source === provider)) {
          hrvArr.push({
            id: fid("hrv"), rmssd: hrv, restingHr,
            date, source: provider, createdAt: fnow(),
          });
          hrvAdded++;
        }
      }
    }
    link.lastSyncAt = fnow();
    saveStateIfAvailable();
    return {
      ok: true,
      result: {
        provider, recoveryAdded, activityAdded, hrvAdded,
        synced: recoveryAdded + activityAdded + hrvAdded,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Map heatmap + segment explore ───────────────────────────────────
  /**
   * activity-heatmap — aggregates every GPS track's points into a
   * density grid for a real map render. Cells are ~0.0025° (~250m).
   */
  registerLensAction("fitness", "activity-heatmap", (ctx, _a, _params = {}) => {
  try {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const myActIds = new Set((s.activities.get(userId) || []).map((a) => a.id));
    const cellSize = 0.0025;
    const grid = new Map();
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    let tracks = 0, totalPoints = 0;
    for (const [actId, track] of s.gpsTracks) {
      if (!myActIds.has(actId)) continue;
      tracks++;
      for (const p of track.points || []) {
        const lat = Number(p.lat), lon = Number(p.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        totalPoints++;
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
        const key = `${Math.round(lat / cellSize)}:${Math.round(lon / cellSize)}`;
        grid.set(key, (grid.get(key) || 0) + 1);
      }
    }
    const maxCount = grid.size ? Math.max(...grid.values()) : 0;
    const cells = [...grid.entries()].map(([key, count]) => {
      const [gy, gx] = key.split(":").map(Number);
      return {
        lat: gy * cellSize, lon: gx * cellSize,
        count, intensity: maxCount > 0 ? Math.round((count / maxCount) * 1000) / 1000 : 0,
      };
    }).sort((a, b) => b.count - a.count);
    return {
      ok: true,
      result: {
        cells, tracks, totalPoints,
        bounds: minLat === Infinity ? null
          : { minLat, maxLat, minLon, maxLon,
              centerLat: (minLat + maxLat) / 2, centerLon: (minLon + maxLon) / 2 },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * segment-explore — segments visible on the map. Optionally bounded
   * by a bbox {minLat,maxLat,minLon,maxLon}; segments carry an explicit
   * lat/lon location from segment-create's `location` is a string only,
   * so we surface those that have geo coords set on `lat`/`lon`.
   */
  registerLensAction("fitness", "segment-explore", (ctx, _a, params = {}) => {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const bbox = params.bbox && typeof params.bbox === "object" ? params.bbox : null;
    const segs = [...s.segments.values()]
      .filter((seg) => seg.lat != null && seg.lon != null
        && Number.isFinite(Number(seg.lat)) && Number.isFinite(Number(seg.lon)))
      .filter((seg) => {
        if (!bbox) return true;
        const lat = Number(seg.lat), lon = Number(seg.lon);
        return lat >= fnum(bbox.minLat, -90) && lat <= fnum(bbox.maxLat, 90)
            && lon >= fnum(bbox.minLon, -180) && lon <= fnum(bbox.maxLon, 180);
      })
      .map((seg) => {
        const efforts = s.segmentEfforts.get(seg.id) || [];
        const mine = efforts.filter((e) => e.userId === userId);
        return {
          id: seg.id, name: seg.name, lat: Number(seg.lat), lon: Number(seg.lon),
          activityType: seg.activityType, distanceKm: seg.distanceKm,
          elevationGainM: seg.elevationGainM, gradePct: seg.gradePct,
          location: seg.location, effortCount: efforts.length,
          courseRecordSeconds: efforts.length ? Math.min(...efforts.map((e) => e.timeSeconds)) : null,
          myBestSeconds: mine.length ? Math.min(...mine.map((e) => e.timeSeconds)) : null,
        };
      });
    return { ok: true, result: { segments: segs, count: segs.length } };
  });

  // ── Photo attachments + comments thread ─────────────────────────────
  registerLensAction("fitness", "activity-photo-add", (ctx, _a, params = {}) => {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const act = (s.activities.get(userId) || []).find((a) => a.id === params.id);
    if (!act) return { ok: false, error: "activity not found" };
    const url = String(params.url || "").trim();
    const dataUrl = String(params.dataUrl || "").trim();
    if (!url && !dataUrl) return { ok: false, error: "url or dataUrl required" };
    if (!Array.isArray(act.photos)) act.photos = [];
    const photo = {
      id: fid("photo"),
      url: url || null,
      dataUrl: dataUrl ? dataUrl.slice(0, 2_500_000) : null,
      caption: String(params.caption || "").slice(0, 200) || null,
      addedAt: fnow(),
    };
    act.photos.push(photo);
    saveStateIfAvailable();
    return { ok: true, result: { photo, photoCount: act.photos.length } };
  });

  registerLensAction("fitness", "activity-photo-remove", (ctx, _a, params = {}) => {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const act = (s.activities.get(userId) || []).find((a) => a.id === params.id);
    if (!act) return { ok: false, error: "activity not found" };
    if (!Array.isArray(act.photos)) act.photos = [];
    const i = act.photos.findIndex((p) => p.id === params.photoId);
    if (i < 0) return { ok: false, error: "photo not found" };
    act.photos.splice(i, 1);
    saveStateIfAvailable();
    return { ok: true, result: { photoCount: act.photos.length } };
  });

  registerLensAction("fitness", "activity-comments", (ctx, _a, params = {}) => {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const ownerId = String(params.ownerUserId || userId);
    const act = (s.activities.get(ownerId) || []).find((a) => a.id === params.id);
    if (!act) return { ok: false, error: "activity not found" };
    if (!Array.isArray(act.comments)) act.comments = [];
    if (!Array.isArray(act.photos)) act.photos = [];
    return {
      ok: true,
      result: {
        comments: act.comments,
        photos: act.photos,
        kudosCount: (act.kudos || []).length,
      },
    };
  });

  registerLensAction("fitness", "activity-comment-delete", (ctx, _a, params = {}) => {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const ownerId = String(params.ownerUserId || userId);
    const act = (s.activities.get(ownerId) || []).find((a) => a.id === params.id);
    if (!act) return { ok: false, error: "activity not found" };
    if (!Array.isArray(act.comments)) act.comments = [];
    const idx = fnum(params.index, -1);
    if (idx < 0 || idx >= act.comments.length) return { ok: false, error: "comment index out of range" };
    // only the comment author or the activity owner may delete
    const c = act.comments[idx];
    if (c.userId !== userId && ownerId !== userId) {
      return { ok: false, error: "not authorised to delete this comment" };
    }
    act.comments.splice(idx, 1);
    saveStateIfAvailable();
    return { ok: true, result: { commentCount: act.comments.length } };
  });

  // ── Live activity sharing — "Beacon" ────────────────────────────────
  /**
   * beacon-start — begin a live-sharing session. Returns a share token
   * trusted followers use to read live position via beacon-status.
   */
  registerLensAction("fitness", "beacon-start", (ctx, _a, params = {}) => {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const type = ACTIVITY_TYPES.includes(String(params.type || "").toLowerCase())
      ? String(params.type).toLowerCase() : "run";
    const beacon = {
      id: fid("beacon"),
      shareToken: `bcn_${Math.random().toString(36).slice(2, 12)}`,
      userId, type,
      status: "live",
      startedAt: fnow(),
      endedAt: null,
      lastUpdate: fnow(),
      position: null,
      distanceKm: 0,
      durationSec: 0,
      followers: Array.isArray(params.followers)
        ? params.followers.slice(0, 50).map((f) => String(f)) : [],
      pings: [],
    };
    s.beacons.set(beacon.id, beacon);
    saveStateIfAvailable();
    return { ok: true, result: { beacon } };
  });

  registerLensAction("fitness", "beacon-ping", (ctx, _a, params = {}) => {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const beacon = s.beacons.get(String(params.id));
    if (!beacon) return { ok: false, error: "beacon not found" };
    if (beacon.userId !== faid(ctx)) return { ok: false, error: "not your beacon" };
    if (beacon.status !== "live") return { ok: false, error: "beacon is not live" };
    const lat = Number(params.lat), lon = Number(params.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { ok: false, error: "lat and lon required" };
    }
    const ping = { lat, lon, at: fnow() };
    beacon.pings.push(ping);
    if (beacon.pings.length > 500) beacon.pings = beacon.pings.slice(-500);
    beacon.position = ping;
    beacon.lastUpdate = ping.at;
    beacon.distanceKm = Math.max(0, Math.round(fnum(params.distanceKm, beacon.distanceKm) * 1000) / 1000);
    beacon.durationSec = Math.max(0, Math.round(fnum(params.durationSec, beacon.durationSec)));
    saveStateIfAvailable();
    return { ok: true, result: { position: ping, pingCount: beacon.pings.length } };
  });

  registerLensAction("fitness", "beacon-status", (ctx, _a, params = {}) => {
  try {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    // resolve by share token (follower view) or id (owner view)
    let beacon = null;
    if (params.shareToken) {
      beacon = [...s.beacons.values()].find((b) => b.shareToken === String(params.shareToken));
    } else if (params.id) {
      beacon = s.beacons.get(String(params.id));
    }
    if (!beacon) return { ok: false, error: "beacon not found" };
    const isOwner = beacon.userId === userId;
    const isFollower = beacon.followers.includes(userId);
    if (!isOwner && !isFollower && !params.shareToken) {
      return { ok: false, error: "not authorised to view this beacon" };
    }
    return {
      ok: true,
      result: {
        beacon: {
          id: isOwner ? beacon.id : undefined,
          status: beacon.status,
          type: beacon.type,
          startedAt: beacon.startedAt,
          endedAt: beacon.endedAt,
          lastUpdate: beacon.lastUpdate,
          position: beacon.position,
          distanceKm: beacon.distanceKm,
          durationSec: beacon.durationSec,
          followerCount: beacon.followers.length,
          track: beacon.pings.map((p) => ({ lat: p.lat, lon: p.lon })),
        },
        isOwner,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("fitness", "beacon-stop", (ctx, _a, params = {}) => {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const beacon = s.beacons.get(String(params.id));
    if (!beacon) return { ok: false, error: "beacon not found" };
    if (beacon.userId !== faid(ctx)) return { ok: false, error: "not your beacon" };
    beacon.status = "ended";
    beacon.endedAt = fnow();
    saveStateIfAvailable();
    return { ok: true, result: { beacon: { id: beacon.id, status: beacon.status, endedAt: beacon.endedAt } } };
  });

  registerLensAction("fitness", "beacon-list", (ctx, _a, _params = {}) => {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const mine = [];
    const following = [];
    for (const b of s.beacons.values()) {
      const summary = {
        id: b.userId === userId ? b.id : undefined,
        shareToken: b.userId === userId ? b.shareToken : undefined,
        userId: b.userId, type: b.type, status: b.status,
        startedAt: b.startedAt, lastUpdate: b.lastUpdate,
        distanceKm: b.distanceKm,
      };
      if (b.userId === userId) mine.push(summary);
      else if (b.followers.includes(userId)) following.push(summary);
    }
    return { ok: true, result: { mine, following } };
  });

  // ── Training plan calendar + adaptive rescheduling ──────────────────
  const PLAN_SESSION_TYPES = ["easy", "long", "tempo", "intervals", "recovery", "race", "rest", "strength", "cross"];

  registerLensAction("fitness", "plan-create", (ctx, _a, params = {}) => {
  try {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const sessions = Array.isArray(params.sessions) ? params.sessions : [];
    if (!sessions.length) return { ok: false, error: "sessions[] required" };
    const cleaned = [];
    for (const sess of sessions) {
      const date = fday(sess.date);
      if (!date) continue;
      cleaned.push({
        id: fid("psess"),
        date,
        type: PLAN_SESSION_TYPES.includes(String(sess.type || "").toLowerCase())
          ? String(sess.type).toLowerCase() : "easy",
        title: String(sess.title || "").slice(0, 120) || null,
        targetDistanceKm: Math.max(0, fnum(sess.targetDistanceKm)),
        targetDurationMin: Math.max(0, fnum(sess.targetDurationMin)),
        notes: String(sess.notes || "").slice(0, 300) || null,
        status: "planned",
        completedActivityId: null,
      });
    }
    if (!cleaned.length) return { ok: false, error: "no valid sessions (each needs a date)" };
    cleaned.sort((a, b) => a.date.localeCompare(b.date));
    const plan = {
      id: fid("plan"), name,
      goalRace: String(params.goalRace || "").slice(0, 120) || null,
      goalDate: fday(params.goalDate) || null,
      sessions: cleaned,
      createdAt: fnow(),
    };
    flistB(s.trainingPlans, userId).push(plan);
    saveStateIfAvailable();
    return { ok: true, result: { plan } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  function planWithCompletion(plan, acts) {
    // mark a planned session complete if a matching activity exists that
    // day; carry adherence metrics for the calendar surface.
    const byDate = new Map();
    for (const a of acts) {
      const d = fday(a.date);
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(a);
    }
    let done = 0, missed = 0;
    const today = fday(fnow());
    const sessions = plan.sessions.map((sess) => {
      const out = { ...sess };
      const sameDay = byDate.get(sess.date) || [];
      if (sess.type === "rest") {
        out.status = "rest";
      } else if (sess.completedActivityId
          && acts.some((a) => a.id === sess.completedActivityId)) {
        out.status = "completed"; done++;
      } else if (sameDay.length) {
        out.status = "completed";
        out.completedActivityId = sameDay[0].id;
        out.actualDistanceKm = sameDay.reduce((x, a) => x + a.distanceKm, 0);
        done++;
      } else if (sess.date < today) {
        out.status = "missed"; missed++;
      } else {
        out.status = "planned";
      }
      return out;
    });
    const trackable = sessions.filter((x) => x.type !== "rest");
    return {
      sessions,
      adherence: {
        completed: done, missed,
        upcoming: trackable.filter((x) => x.status === "planned").length,
        rate: trackable.length ? Math.round((done / trackable.length) * 100) : 0,
      },
    };
  }

  registerLensAction("fitness", "plan-list", (ctx, _a, _params = {}) => {
  try {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const acts = s.activities.get(userId) || [];
    const plans = (s.trainingPlans.get(userId) || []).map((p) => {
      const { sessions, adherence } = planWithCompletion(p, acts);
      return { ...p, sessions, adherence };
    });
    return { ok: true, result: { plans, count: plans.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("fitness", "plan-delete", (ctx, _a, params = {}) => {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.trainingPlans.get(faid(ctx)) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "plan not found" };
    arr.splice(i, 1);
    saveStateIfAvailable();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("fitness", "plan-session-move", (ctx, _a, params = {}) => {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const plan = (s.trainingPlans.get(faid(ctx)) || []).find((p) => p.id === params.planId);
    if (!plan) return { ok: false, error: "plan not found" };
    const sess = plan.sessions.find((x) => x.id === params.sessionId);
    if (!sess) return { ok: false, error: "session not found" };
    const newDate = fday(params.date);
    if (!newDate) return { ok: false, error: "valid date required" };
    sess.date = newDate;
    plan.sessions.sort((a, b) => a.date.localeCompare(b.date));
    saveStateIfAvailable();
    return { ok: true, result: { sessionId: sess.id, date: sess.date } };
  });

  /**
   * plan-reschedule — adaptive rescheduling. Pushes every missed
   * (past, uncompleted, non-rest) session forward by `shiftDays`,
   * preserving order. Strava/Garmin adaptive-plan behaviour: a missed
   * key session slides the remaining plan rather than being dropped.
   */
  registerLensAction("fitness", "plan-reschedule", (ctx, _a, params = {}) => {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = faid(ctx);
    const plan = (s.trainingPlans.get(userId) || []).find((p) => p.id === params.planId);
    if (!plan) return { ok: false, error: "plan not found" };
    const shiftDays = fclamp(fnum(params.shiftDays, 1), 1, 28);
    const acts = s.activities.get(userId) || [];
    const today = fday(fnow());
    const completedDates = new Set(acts.map((a) => fday(a.date)));
    let moved = 0;
    for (const sess of plan.sessions) {
      const isMissed = sess.type !== "rest"
        && sess.date < today
        && !sess.completedActivityId
        && !completedDates.has(sess.date);
      if (isMissed) {
        const d = new Date(sess.date + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + shiftDays);
        sess.date = d.toISOString().slice(0, 10);
        sess.rescheduled = true;
        moved++;
      }
    }
    plan.sessions.sort((a, b) => a.date.localeCompare(b.date));
    saveStateIfAvailable();
    const { sessions, adherence } = planWithCompletion(plan, acts);
    return { ok: true, result: { moved, shiftDays, plan: { ...plan, sessions, adherence } } };
  });

  // ── Relative effort / fitness-and-freshness trend ───────────────────
  /**
   * fitness-freshness — daily fitness (CTL), fatigue (ATL), form (TSB)
   * plus per-day relative effort, ready to drive a ChartKit trend. Adds
   * weekly RE rollups and a form-trend verdict.
   */
  registerLensAction("fitness", "fitness-freshness", (ctx, _a, params = {}) => {
  try {
    const s = getFitState2(); if (!s) return { ok: false, error: "STATE unavailable" };
    const acts = s.activities.get(faid(ctx)) || [];
    const tl = trainingLoadSeries(acts);
    const N = fclamp(fnum(params.days, 90), 14, 365);
    const daily = tl.daily.slice(-N);

    // weekly relative-effort rollup (Mon-anchored)
    const weekly = new Map();
    for (const a of acts) {
      const d = new Date((a.date || "") + "T00:00:00Z");
      if (isNaN(d)) continue;
      const dow = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - dow);
      const wk = d.toISOString().slice(0, 10);
      const cur = weekly.get(wk) || { week: wk, relativeEffort: 0, activities: 0, distanceKm: 0 };
      cur.relativeEffort += fnum(a.relativeEffort);
      cur.activities += 1;
      cur.distanceKm += a.distanceKm;
      weekly.set(wk, cur);
    }
    const weeklyEffort = [...weekly.values()]
      .map((w) => ({ ...w, distanceKm: Math.round(w.distanceKm * 100) / 100 }))
      .sort((a, b) => a.week.localeCompare(b.week));

    // form trend: compare last 7 days' TSB slope
    let formTrend = "stable";
    if (daily.length >= 8) {
      const recent = daily[daily.length - 1].tsb;
      const weekAgo = daily[daily.length - 8].tsb;
      const delta = recent - weekAgo;
      if (delta > 5) formTrend = "freshening";
      else if (delta < -5) formTrend = "fatiguing";
    }
    const last = daily[daily.length - 1] || { ctl: 0, atl: 0, tsb: 0 };
    return {
      ok: true,
      result: {
        daily,
        weeklyEffort,
        fitness: last.ctl,
        fatigue: last.atl,
        form: last.tsb,
        formTrend,
        rampRate: daily.length >= 8
          ? Math.round((daily[daily.length - 1].ctl - daily[daily.length - 8].ctl) * 10) / 10
          : 0,
        trackedDays: tl.days,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // feed — ingest real exercises from the open wger workout database as
  // visible DTUs. Free public API, no key.
  registerLensAction("fitness", "feed", async (ctx, _a, params = {}) => {
    const s = getFitState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 12)));
    const offset = (new Date().getDate() * limit) % 200;
    try {
      const r = await fetch(`https://wger.de/api/v2/exercise/?language=2&limit=${limit}&offset=${offset}&format=json`);
      if (!r.ok) return { ok: false, error: `wger ${r.status}` };
      const data = await r.json();
      const exercises = (Array.isArray(data?.results) ? data.results : []).slice(0, limit);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const ex of exercises) {
        const id = `wger_${ex.uuid || ex.id}`;
        if (s.feedSeen.has(id)) { skipped++; continue; }
        const name = ex.name || `Exercise ${ex.id}`;
        const desc = String(ex.description || "").replace(/<[^>]+>/g, "").trim();
        const title = `Exercise: ${name}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\n${desc || "An exercise from the wger open workout database."}`.slice(0, 3000),
          tags: ["fitness", "feed", "exercise", "wger"],
          source: "wger-feed",
          meta: { exerciseId: ex.id, uuid: ex.uuid, name },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(id); }
      }
      saveStateIfAvailable();
      return { ok: true, result: { ingested, skipped, source: "wger-exercises", dtuIds } };
    } catch (e) {
      return { ok: false, error: `wger unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
};

function extractJsonFit(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(body.slice(first, last + 1)); } catch { return null; }
}
