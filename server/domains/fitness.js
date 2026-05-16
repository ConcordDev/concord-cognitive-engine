export default function registerFitnessActions(registerLensAction) {
  registerLensAction("fitness", "progressionCalc", (ctx, artifact, _params) => {
    const exercises = artifact.data?.exercises || [];
    const recommendations = exercises.map(ex => {
      const weight = ex.weight || 0;
      const reps = ex.reps || 0;
      const rpe = ex.rpe || 7;
      let increment = 0;
      if (rpe <= 6) increment = weight * 0.05;
      else if (rpe <= 7) increment = weight * 0.025;
      else if (rpe >= 9) increment = -weight * 0.05;
      return {
        exercise: ex.name,
        currentWeight: weight,
        currentReps: reps,
        currentRPE: rpe,
        recommendedWeight: Math.round((weight + increment) * 2) / 2,
        recommendation: rpe <= 6 ? 'increase_weight' : rpe <= 8 ? 'maintain' : 'reduce_weight',
      };
    });
    return { ok: true, result: { recommendations } };
  });

  registerLensAction("fitness", "classUtilization", (ctx, artifact, params) => {
    const capacity = artifact.data?.capacity || 0;
    const enrolled = artifact.data?.enrolled || 0;
    const attendanceLog = artifact.data?.attendanceLog || [];
    const period = params.period || 30;
    const recentAttendance = attendanceLog.filter(a => {
      const d = new Date(a.date);
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - period);
      return d >= cutoff;
    });
    const avgAttendance = recentAttendance.length > 0
      ? Math.round(recentAttendance.reduce((s, a) => s + (a.count || 0), 0) / recentAttendance.length)
      : enrolled;
    const utilization = capacity > 0 ? Math.round((avgAttendance / capacity) * 100) : 0;
    return { ok: true, result: { className: artifact.title, capacity, enrolled, avgAttendance, utilization, period, sessions: recentAttendance.length } };
  });

  registerLensAction("fitness", "bodyCompReport", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const weight = parseFloat(data.weight) || 0; // in lbs or kg
    const height = parseFloat(data.height) || 0; // in inches or cm
    const unit = data.unit || "imperial"; // "imperial" or "metric"
    const age = parseInt(data.age, 10) || 30;
    const sex = (data.sex || data.gender || "male").toLowerCase();
    const waist = parseFloat(data.waist) || 0;
    const neck = parseFloat(data.neck) || 0;
    const hip = parseFloat(data.hip) || 0;

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
      if (sex === "male") {
        bodyFatPct = 495 / (1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)) - 450;
      } else if (hipCm > 0) {
        bodyFatPct = 495 / (1.29579 - 0.35004 * Math.log10(waistCm + hipCm - neckCm) + 0.22100 * Math.log10(heightCm)) - 450;
      }
      if (bodyFatPct != null) bodyFatPct = Math.round(bodyFatPct * 10) / 10;
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
    const weeks = params.weeks || artifact.data?.weeks || 12;
    const goal = params.goal || artifact.data?.goal || 'general_fitness';
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
    if (!STATE.fitnessLens) {
      STATE.fitnessLens = { workouts: new Map() };
    }
    return STATE.fitnessLens;
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
   * recovery-history — Synthetic Whoop-style recovery + sleep + strain
   * series for the last N days. Deterministic by userId.
   */
  registerLensAction("fitness", "recovery-history", (ctx, _artifact, params = {}) => {
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const N = Math.max(1, Math.min(90, Number(params.days) || 14));
    const seed = hashStringFitness(userId);
    const days = [];
    for (let i = N - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const recoveryScore = 30 + ((seed >> i) & 63);  // 30-93
      const sleepDurationHours = 6.0 + ((seed >> (i + 2)) & 7) / 4;  // 6.0-7.75
      const sleepQualityPct = 55 + ((seed >> (i + 3)) & 31);
      const restingHr = 52 + ((seed >> (i + 1)) & 7);
      const hrv = 35 + ((seed >> (i + 4)) & 31);
      const strainYesterday = 8 + ((seed >> (i + 5)) & 15) / 2;
      days.push({ date, recoveryScore, sleepDurationHours, sleepQualityPct, restingHr, hrv, strainYesterday });
    }
    return { ok: true, result: { days } };
  });

  /**
   * activity-summary — Apple Fitness+ style move/exercise/stand rings.
   * Synthetic per userId for the last N days.
   */
  registerLensAction("fitness", "activity-summary", (ctx, _artifact, params = {}) => {
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const N = Math.max(1, Math.min(30, Number(params.days) || 7));
    const seed = hashStringFitness(userId);
    const days = [];
    for (let i = N - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const moveCalories = 200 + ((seed >> i) & 511);
      const exerciseMinutes = 15 + ((seed >> (i + 2)) & 31);
      const standHours = 6 + ((seed >> (i + 1)) & 7);
      const steps = 4000 + ((seed >> (i + 3)) & 8191);
      days.push({
        date,
        moveCalories, moveGoal: 500,
        exerciseMinutes, exerciseGoal: 30,
        standHours, standGoal: 12,
        steps, stepsGoal: 10000,
      });
    }
    return { ok: true, result: { days } };
  });

  /**
   * workout-plan-generate — Conscious-brain generated multi-week plan.
   */
  registerLensAction("fitness", "workout-plan-generate", async (ctx, _artifact, params = {}) => {
    if (!ctx?.llm?.chat) return { ok: false, error: "llm unavailable" };
    const goal = ["strength", "hypertrophy", "endurance", "fat_loss", "general"].includes(params.goal) ? params.goal : "general";
    const daysPerWeek = Math.max(1, Math.min(7, Number(params.daysPerWeek) || 4));
    const weeks = Math.max(1, Math.min(24, Number(params.weeks) || 8));
    const equipment = ["full_gym", "home_dumbbells", "bodyweight_only"].includes(params.equipment) ? params.equipment : "full_gym";
    const experience = ["beginner", "intermediate", "advanced"].includes(params.experience) ? params.experience : "intermediate";

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
      if (!parsed?.plan) return { ok: false, error: "parse failed", raw: raw.slice(0, 200) };
      return { ok: true, result: { plan: parsed.plan } };
    } catch (e) {
      return { ok: false, error: e?.message || "generation failed" };
    }
  });
};

function hashStringFitness(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function extractJsonFit(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(body.slice(first, last + 1)); } catch { return null; }
}
