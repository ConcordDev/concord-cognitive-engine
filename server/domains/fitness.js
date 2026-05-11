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
};
