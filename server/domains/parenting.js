// server/domains/parenting.js
// Domain actions for parenting: milestone tracking, growth percentiles,
// sleep analysis, developmental screening, routine optimization.

export default function registerParentingActions(registerLensAction) {
  /**
   * milestoneCheck
   * Evaluate developmental milestones against age-appropriate expectations.
   * artifact.data: { childName, childAge, milestones: [{ category, name, date }] }
   */
  registerLensAction("parenting", "milestoneCheck", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const childAge = data.childAge || "";
    const milestones = data.milestones || [];

    // Parse age string like "2y 3m" into months
    const ageMatch = childAge.match(/(\d+)\s*y(?:ear)?s?\s*(?:(\d+)\s*m(?:onth)?s?)?/i);
    const ageMonths = ageMatch ? (parseInt(ageMatch[1]) || 0) * 12 + (parseInt(ageMatch[2]) || 0) : 0;

    // CDC milestone benchmarks by age range (months)
    const benchmarks = [
      { ageMin: 0, ageMax: 3, category: "Physical", expected: ["Lifts head", "Opens/closes hands", "Brings hands to mouth"] },
      { ageMin: 0, ageMax: 3, category: "Social", expected: ["Smiles at people", "Tries to look at parent", "Coos and makes sounds"] },
      { ageMin: 4, ageMax: 6, category: "Physical", expected: ["Rolls over", "Reaches for toys", "Brings things to mouth"] },
      { ageMin: 4, ageMax: 6, category: "Cognitive", expected: ["Responds to name", "Shows curiosity", "Passes things hand to hand"] },
      { ageMin: 7, ageMax: 12, category: "Physical", expected: ["Sits without support", "Crawls", "Pulls to stand", "May walk"] },
      { ageMin: 7, ageMax: 12, category: "Language", expected: ["Babbles", "Says mama/dada", "Understands no"] },
      { ageMin: 12, ageMax: 24, category: "Physical", expected: ["Walks independently", "Begins to run", "Climbs furniture"] },
      { ageMin: 12, ageMax: 24, category: "Language", expected: ["Says several words", "Points to things", "2-word phrases by 24m"] },
      { ageMin: 12, ageMax: 24, category: "Cognitive", expected: ["Follows simple directions", "Scribbles", "Sorts shapes"] },
      { ageMin: 24, ageMax: 48, category: "Physical", expected: ["Runs easily", "Jumps", "Pedals tricycle"] },
      { ageMin: 24, ageMax: 48, category: "Language", expected: ["3-4 word sentences", "Names familiar things", "Understood by strangers"] },
      { ageMin: 24, ageMax: 48, category: "Social", expected: ["Takes turns", "Shows concern for others", "Plays with other children"] },
      { ageMin: 48, ageMax: 72, category: "Physical", expected: ["Hops on one foot", "Catches bounced ball", "Uses scissors"] },
      { ageMin: 48, ageMax: 72, category: "Cognitive", expected: ["Counts to 10+", "Draws person with 6 parts", "Tells stories"] },
    ];

    const applicable = benchmarks.filter(b => ageMonths >= b.ageMin && ageMonths <= b.ageMax);
    const achievedNames = milestones.map(m => (m.name || m.milestone || "").toLowerCase());

    const results = applicable.map(benchmark => {
      const achieved = benchmark.expected.filter(exp =>
        achievedNames.some(a => a.includes(exp.toLowerCase().slice(0, 10)))
      );
      return {
        category: benchmark.category,
        ageRange: `${benchmark.ageMin}-${benchmark.ageMax} months`,
        expected: benchmark.expected,
        achieved: achieved.length,
        total: benchmark.expected.length,
        completionRate: Math.round((achieved.length / benchmark.expected.length) * 100),
      };
    });

    const overallRate = results.length > 0
      ? Math.round(results.reduce((s, r) => s + r.completionRate, 0) / results.length)
      : 0;

    return {
      ok: true,
      result: {
        childName: data.childName,
        ageMonths,
        ageDisplay: childAge,
        milestoneResults: results,
        overallCompletionRate: overallRate,
        totalMilestonesRecorded: milestones.length,
        assessment: overallRate >= 80 ? "On track — excellent development"
          : overallRate >= 50 ? "Mostly on track — a few areas to monitor"
          : overallRate >= 20 ? "Some delays noted — consider pediatrician consultation"
          : ageMonths > 0 ? "Limited milestone data — record more observations" : "Enter child age to assess milestones",
      },
    };
  });

  /**
   * growthPercentile
   * Calculate height/weight percentile based on WHO/CDC growth charts.
   * artifact.data: { childAge, height, weight, headCirc, sex }
   */
  registerLensAction("parenting", "growthPercentile", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const height = parseFloat(data.height) || 0;
    const weight = parseFloat(data.weight) || 0;
    const headCirc = parseFloat(data.headCirc) || 0;
    const sex = (data.sex || "neutral").toLowerCase();

    // Simplified percentile estimation using z-score approximation
    // WHO median values for 2-year-old as reference point
    const medians = {
      male: { height: 34.2, weight: 27.5, head: 19.2 },
      female: { height: 33.7, weight: 26.5, head: 18.9 },
      neutral: { height: 34.0, weight: 27.0, head: 19.0 },
    };
    const ref = medians[sex] || medians.neutral;

    // Approximate percentile from deviation
    function estimatePercentile(value, median, sd) {
      if (!value || !median) return null;
      const z = (value - median) / sd;
      // Simplified normal CDF approximation
      const p = 1 / (1 + Math.exp(-1.7 * z));
      return Math.round(p * 100);
    }

    const heightPct = estimatePercentile(height, ref.height, 2.5);
    const weightPct = estimatePercentile(weight, ref.weight, 3.5);
    const headPct = estimatePercentile(headCirc, ref.head, 1.2);

    // BMI for age (simplified)
    const heightM = height > 0 ? height * 0.0254 : 1; // inches to meters
    const weightKg = weight > 0 ? weight * 0.4536 : 0;
    const bmi = heightM > 0 ? Math.round((weightKg / (heightM * heightM)) * 10) / 10 : 0;

    const flags = [];
    if (weightPct !== null && weightPct < 5) flags.push("Weight below 5th percentile — discuss with pediatrician");
    if (weightPct !== null && weightPct > 95) flags.push("Weight above 95th percentile — monitor growth trajectory");
    if (heightPct !== null && heightPct < 5) flags.push("Height below 5th percentile — may need evaluation");
    if (headPct !== null && headPct < 5) flags.push("Head circumference below 5th percentile — worth monitoring");

    return {
      ok: true,
      result: {
        measurements: {
          height: height ? `${height} in` : "Not recorded",
          weight: weight ? `${weight} lbs` : "Not recorded",
          headCircumference: headCirc ? `${headCirc} in` : "Not recorded",
          bmi,
        },
        percentiles: {
          height: heightPct !== null ? `${heightPct}th` : "N/A",
          weight: weightPct !== null ? `${weightPct}th` : "N/A",
          headCircumference: headPct !== null ? `${headPct}th` : "N/A",
        },
        flags,
        note: "Percentiles are approximations. Consult your pediatrician for precise growth chart plotting.",
      },
    };
  });

  /**
   * sleepAnalysis
   * Analyze sleep patterns and recommend age-appropriate schedules.
   * artifact.data: { childAge, sleepLogs: [{ date, bedtime, wakeTime, naps }] }
   */
  registerLensAction("parenting", "sleepAnalysis", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const childAge = data.childAge || "";
    const sleepLogs = data.sleepLogs || [];

    const ageMatch = childAge.match(/(\d+)\s*y/i);
    const ageYears = ageMatch ? parseInt(ageMatch[1]) : 2;

    // Recommended sleep by age (hours per 24h)
    const recommendations = {
      0: { total: 16, nightMin: 8, nightMax: 9, naps: "3-5 naps", napHours: 7 },
      1: { total: 14, nightMin: 10, nightMax: 12, naps: "2 naps", napHours: 3 },
      2: { total: 13, nightMin: 10, nightMax: 12, naps: "1 nap", napHours: 2 },
      3: { total: 12, nightMin: 10, nightMax: 12, naps: "0-1 nap", napHours: 1 },
      5: { total: 11, nightMin: 10, nightMax: 11, naps: "No naps", napHours: 0 },
      8: { total: 10, nightMin: 9, nightMax: 11, naps: "No naps", napHours: 0 },
      13: { total: 9, nightMin: 8, nightMax: 10, naps: "No naps", napHours: 0 },
    };

    const ageKey = Object.keys(recommendations).map(Number).filter(k => k <= ageYears).pop() || 2;
    const rec = recommendations[ageKey];

    // Analyze logs
    let avgNightHours = 0;
    let avgNapHours = 0;
    if (sleepLogs.length > 0) {
      for (const log of sleepLogs) {
        if (log.bedtime && log.wakeTime) {
          const bed = new Date(`2000-01-01 ${log.bedtime}`);
          let wake = new Date(`2000-01-01 ${log.wakeTime}`);
          if (wake < bed) wake = new Date(`2000-01-02 ${log.wakeTime}`);
          avgNightHours += (wake.getTime() - bed.getTime()) / 3600000;
        }
        avgNapHours += parseFloat(log.naps) || 0;
      }
      avgNightHours = Math.round((avgNightHours / sleepLogs.length) * 10) / 10;
      avgNapHours = Math.round((avgNapHours / sleepLogs.length) * 10) / 10;
    }

    const totalAvg = avgNightHours + avgNapHours;
    const deficit = rec.total - totalAvg;

    return {
      ok: true,
      result: {
        ageYears,
        recommended: rec,
        actual: {
          avgNightHours,
          avgNapHours,
          totalAvg: Math.round(totalAvg * 10) / 10,
          logsAnalyzed: sleepLogs.length,
        },
        sleepDebt: deficit > 0 ? `${Math.round(deficit * 10) / 10} hours/day below recommended` : "Getting enough sleep",
        tips: [
          deficit > 1 ? `Try moving bedtime ${Math.round(deficit * 30)} minutes earlier` : null,
          ageYears < 3 && avgNapHours < 1 ? "Ensure at least one daytime nap" : null,
          "Consistent bedtime routine helps — bath, book, bed",
          "Limit screen time 1 hour before bed",
          ageYears >= 5 ? "School-age children need 9-11 hours total" : null,
        ].filter(Boolean),
      },
    };
  });

  /**
   * routineOptimizer
   * Suggest an optimized daily routine based on child's age and family schedule.
   * artifact.data: { childAge, schedules: [{ name, time, frequency }] }
   */
  registerLensAction("parenting", "routineOptimizer", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const childAge = data.childAge || "2y";
    const schedules = data.schedules || [];

    const ageMatch = childAge.match(/(\d+)/);
    const ageYears = ageMatch ? parseInt(ageMatch[1]) : 2;

    // Age-appropriate routine templates
    const templates = {
      infant: [
        { time: "06:00", activity: "Wake & Feed", duration: 30, category: "care" },
        { time: "07:00", activity: "Tummy Time / Play", duration: 20, category: "development" },
        { time: "08:00", activity: "Nap 1", duration: 90, category: "sleep" },
        { time: "10:00", activity: "Feed", duration: 30, category: "care" },
        { time: "10:30", activity: "Sensory Play", duration: 30, category: "development" },
        { time: "11:30", activity: "Nap 2", duration: 90, category: "sleep" },
        { time: "13:30", activity: "Feed", duration: 30, category: "care" },
        { time: "14:00", activity: "Outdoor Time", duration: 30, category: "development" },
        { time: "15:00", activity: "Nap 3", duration: 60, category: "sleep" },
        { time: "17:00", activity: "Feed", duration: 30, category: "care" },
        { time: "18:00", activity: "Bath", duration: 20, category: "care" },
        { time: "18:30", activity: "Bedtime Routine", duration: 30, category: "sleep" },
      ],
      toddler: [
        { time: "07:00", activity: "Wake & Breakfast", duration: 30, category: "care" },
        { time: "08:00", activity: "Free Play / Arts", duration: 60, category: "development" },
        { time: "09:00", activity: "Outdoor Play", duration: 60, category: "physical" },
        { time: "10:00", activity: "Snack & Story Time", duration: 30, category: "learning" },
        { time: "10:30", activity: "Learning Activity", duration: 30, category: "learning" },
        { time: "11:30", activity: "Lunch", duration: 30, category: "care" },
        { time: "12:30", activity: "Nap", duration: 120, category: "sleep" },
        { time: "14:30", activity: "Snack", duration: 15, category: "care" },
        { time: "15:00", activity: "Playdate / Park", duration: 90, category: "social" },
        { time: "17:00", activity: "Dinner", duration: 30, category: "care" },
        { time: "18:00", activity: "Bath & Wind Down", duration: 30, category: "care" },
        { time: "19:00", activity: "Bedtime Stories & Sleep", duration: 30, category: "sleep" },
      ],
      preschool: [
        { time: "07:00", activity: "Wake & Breakfast", duration: 30, category: "care" },
        { time: "08:00", activity: "School / Learning", duration: 180, category: "learning" },
        { time: "12:00", activity: "Lunch", duration: 30, category: "care" },
        { time: "13:00", activity: "Quiet Time / Rest", duration: 60, category: "sleep" },
        { time: "14:00", activity: "Creative Play", duration: 60, category: "development" },
        { time: "15:00", activity: "Outdoor Activity", duration: 60, category: "physical" },
        { time: "16:00", activity: "Snack & Free Play", duration: 60, category: "care" },
        { time: "17:30", activity: "Dinner", duration: 30, category: "care" },
        { time: "18:30", activity: "Family Time", duration: 60, category: "social" },
        { time: "19:30", activity: "Bath & Bedtime", duration: 30, category: "sleep" },
      ],
    };

    const stage = ageYears < 1 ? "infant" : ageYears < 3 ? "toddler" : "preschool";
    const template = templates[stage] || templates.toddler;

    // Merge with existing schedules
    const existingTimes = new Set(schedules.map(s => s.time));
    const suggested = template.filter(t => !existingTimes.has(t.time));

    return {
      ok: true,
      result: {
        stage,
        ageYears,
        suggestedRoutine: template,
        existingSchedules: schedules.length,
        newSuggestions: suggested.length,
        categoryBreakdown: template.reduce((acc, t) => {
          acc[t.category] = (acc[t.category] || 0) + t.duration;
          return acc;
        }, {}),
      },
    };
  });

  /**
   * immunizationTracker
   * Track and recommend childhood immunizations per CDC schedule.
   * artifact.data: { childAge, vaccinations: [{ name, date }] }
   */
  registerLensAction("parenting", "immunizationTracker", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const childAge = data.childAge || "1y";
    const vaccinations = data.vaccinations ? data.vaccinations.split(",").map(v => v.trim()) : [];

    const ageMatch = childAge.match(/(\d+)\s*y/i);
    const ageYears = ageMatch ? parseInt(ageMatch[1]) : 1;
    const ageMonths = ageYears * 12;

    const cdcSchedule = [
      { vaccine: "Hepatitis B", doses: 3, byMonths: 6, critical: true },
      { vaccine: "DTaP", doses: 5, byMonths: 72, critical: true },
      { vaccine: "IPV (Polio)", doses: 4, byMonths: 72, critical: true },
      { vaccine: "Hib", doses: 4, byMonths: 15, critical: true },
      { vaccine: "PCV13 (Pneumococcal)", doses: 4, byMonths: 15, critical: true },
      { vaccine: "RV (Rotavirus)", doses: 3, byMonths: 8, critical: true },
      { vaccine: "MMR", doses: 2, byMonths: 72, critical: true },
      { vaccine: "Varicella", doses: 2, byMonths: 72, critical: true },
      { vaccine: "Hepatitis A", doses: 2, byMonths: 24, critical: true },
      { vaccine: "Influenza", doses: 1, byMonths: 6, critical: false, note: "Annual" },
    ];

    const applicable = cdcSchedule.filter(v => ageMonths >= v.byMonths - 6);
    const received = applicable.map(v => {
      const got = vaccinations.some(vax => vax.toLowerCase().includes(v.vaccine.toLowerCase().slice(0, 5)));
      return {
        vaccine: v.vaccine,
        required: v.critical,
        received: got,
        status: got ? "completed" : ageMonths > v.byMonths ? "overdue" : "upcoming",
        note: v.note || null,
      };
    });

    const overdue = received.filter(r => r.status === "overdue" && r.required).length;

    return {
      ok: true,
      result: {
        childAge,
        ageMonths,
        immunizations: received,
        summary: {
          total: received.length,
          completed: received.filter(r => r.received).length,
          overdue,
          complianceRate: received.length > 0 ? Math.round((received.filter(r => r.received).length / received.length) * 100) : 0,
        },
        action: overdue > 0 ? `${overdue} critical immunization(s) overdue — schedule pediatrician visit` : "Immunizations on track",
      },
    };
  });

  // ─── Huckleberry 2026 parity — smart baby-care tracker ──────────────
  // Child profiles, one-touch logging (feeds, sleep, diapers, pumping,
  // growth, milestones, medicine, activities), SweetSpot nap prediction,
  // WHO growth percentiles, CDC milestone checklist. Not medical advice.

  function getPgState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.parentingLens) STATE.parentingLens = {};
    const s = STATE.parentingLens;
    for (const k of ["children", "feeds", "sleeps", "diapers", "pumps", "growth", "milestones", "meds", "activities"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function savePgState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const pgId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const pgNow = () => new Date().toISOString();
  const pgAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const pgListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const pgNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const pgClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const PG_DAY = 86400000;

  function pgAgeMonths(birthDate) {
    const b = Date.parse(`${birthDate}T00:00:00Z`);
    if (!Number.isFinite(b)) return 0;
    return Math.max(0, (Date.now() - b) / (PG_DAY * 30.4375));
  }
  function pgAgeDisplay(birthDate) {
    const m = pgAgeMonths(birthDate);
    if (m < 1) return `${Math.round(m * 30.4375)} days`;
    if (m < 24) return `${Math.round(m)} months`;
    return `${Math.floor(m / 12)}y ${Math.round(m % 12)}m`;
  }
  function pgChild(s, userId, childId) {
    return (s.children.get(userId) || []).find((c) => c.id === childId) || null;
  }

  // Age-based wake windows in minutes (pediatric sleep science).
  const PG_WAKE_WINDOWS = [
    { maxMonths: 1, min: 35, typical: 50, max: 60 },
    { maxMonths: 2, min: 60, typical: 75, max: 90 },
    { maxMonths: 3, min: 75, typical: 90, max: 105 },
    { maxMonths: 4, min: 75, typical: 100, max: 120 },
    { maxMonths: 5, min: 105, typical: 120, max: 135 },
    { maxMonths: 7, min: 120, typical: 150, max: 180 },
    { maxMonths: 10, min: 150, typical: 180, max: 210 },
    { maxMonths: 12, min: 180, typical: 210, max: 240 },
    { maxMonths: 15, min: 210, typical: 240, max: 270 },
    { maxMonths: 18, min: 240, typical: 270, max: 300 },
    { maxMonths: 24, min: 270, typical: 300, max: 330 },
    { maxMonths: 999, min: 300, typical: 330, max: 360 },
  ];
  function pgWakeWindow(ageMonths) {
    return PG_WAKE_WINDOWS.find((w) => ageMonths < w.maxMonths) || PG_WAKE_WINDOWS[PG_WAKE_WINDOWS.length - 1];
  }

  // WHO Child Growth Standards — 50th-percentile medians at anchor ages.
  const PG_WHO = {
    boy: {
      weight: { 0: 3.3, 1: 4.5, 2: 5.6, 3: 6.4, 4: 7.0, 6: 7.9, 9: 8.9, 12: 9.6, 18: 10.9, 24: 12.2, 36: 14.3, 48: 16.3, 60: 18.3 },
      height: { 0: 49.9, 1: 54.7, 2: 58.4, 3: 61.4, 4: 63.9, 6: 67.6, 9: 72.0, 12: 75.7, 18: 82.3, 24: 87.1, 36: 96.1, 48: 103.3, 60: 110.0 },
      head: { 0: 34.5, 1: 37.3, 2: 39.1, 3: 40.5, 6: 43.3, 12: 46.1, 24: 48.3, 36: 49.5, 48: 50.5, 60: 51.0 },
    },
    girl: {
      weight: { 0: 3.2, 1: 4.2, 2: 5.1, 3: 5.8, 4: 6.4, 6: 7.3, 9: 8.2, 12: 8.9, 18: 10.2, 24: 11.5, 36: 13.9, 48: 16.1, 60: 18.2 },
      height: { 0: 49.1, 1: 53.7, 2: 57.1, 3: 59.8, 4: 62.1, 6: 65.7, 9: 70.1, 12: 74.0, 18: 80.7, 24: 85.7, 36: 95.1, 48: 102.7, 60: 109.4 },
      head: { 0: 33.9, 1: 36.5, 2: 38.3, 3: 39.5, 6: 42.2, 12: 44.9, 24: 47.2, 36: 48.5, 48: 49.5, 60: 50.0 },
    },
  };
  // Approximate coefficient of variation per measure (WHO spread).
  const PG_CV = { weight: 0.13, height: 0.038, head: 0.035 };
  function pgWhoMedian(table, ageMonths) {
    const ages = Object.keys(table).map(Number).sort((a, b) => a - b);
    if (ageMonths <= ages[0]) return table[ages[0]];
    if (ageMonths >= ages[ages.length - 1]) return table[ages[ages.length - 1]];
    let lo = ages[0], hi = ages[ages.length - 1];
    for (let i = 0; i < ages.length - 1; i++) {
      if (ageMonths >= ages[i] && ageMonths <= ages[i + 1]) { lo = ages[i]; hi = ages[i + 1]; break; }
    }
    const t = (ageMonths - lo) / (hi - lo);
    return table[lo] + t * (table[hi] - table[lo]);
  }
  function pgPercentile(value, median, cv) {
    if (!(value > 0) || !(median > 0)) return null;
    const z = (value - median) / (median * cv);
    const p = 1 / (1 + Math.exp(-1.7 * z));   // logistic CDF approximation
    return Math.max(1, Math.min(99, Math.round(p * 100)));
  }

  // CDC "Learn the Signs. Act Early." milestone checklist (2022 update).
  const PG_MILESTONES = [
    [2, "social", "Calms down when spoken to or picked up"],
    [2, "language", "Makes sounds other than crying"],
    [2, "cognitive", "Watches you as you move"],
    [2, "movement", "Holds head up when on tummy"],
    [4, "social", "Smiles on their own to get your attention"],
    [4, "language", "Makes cooing sounds like 'oooo' and 'aahh'"],
    [4, "cognitive", "Opens mouth when sees a breast or bottle if hungry"],
    [4, "movement", "Holds head steady without support when held"],
    [6, "social", "Knows familiar people; laughs"],
    [6, "language", "Takes turns making sounds with you; blows raspberries"],
    [6, "cognitive", "Reaches to grab a toy they want"],
    [6, "movement", "Rolls from tummy to back"],
    [9, "social", "Looks when you call their name"],
    [9, "language", "Makes sounds like 'mamamama' and 'babababa'"],
    [9, "cognitive", "Looks for objects when dropped out of sight"],
    [9, "movement", "Sits without support"],
    [12, "social", "Plays games with you, like pat-a-cake"],
    [12, "language", "Waves bye-bye; understands 'no'"],
    [12, "cognitive", "Puts something in a container; looks for hidden things"],
    [12, "movement", "Pulls up to stand; walks holding furniture"],
    [15, "social", "Claps when excited; shows you affection"],
    [15, "language", "Tries to say one or two words besides 'mama'/'dada'"],
    [15, "cognitive", "Stacks at least two small objects"],
    [15, "movement", "Takes a few steps on their own"],
    [18, "social", "Points to show you something interesting"],
    [18, "language", "Tries to say three or more words besides 'mama'/'dada'"],
    [18, "cognitive", "Copies you doing chores"],
    [18, "movement", "Walks without holding on; scribbles"],
    [24, "social", "Notices when others are hurt or upset"],
    [24, "language", "Says at least two words together"],
    [24, "cognitive", "Plays with more than one toy at the same time"],
    [24, "movement", "Kicks a ball; runs"],
    [30, "social", "Plays next to other children and sometimes with them"],
    [30, "language", "Says about 50 words; uses two-step actions"],
    [30, "cognitive", "Uses things to pretend, like feeding a doll"],
    [30, "movement", "Twists hands to turn things like doorknobs"],
    [36, "social", "Calms down within 10 minutes after you leave"],
    [36, "language", "Talks well enough for others to understand most of the time"],
    [36, "cognitive", "Draws a circle when shown how"],
    [36, "movement", "Strings large beads; uses a fork"],
    [48, "social", "Pretends to be something else during play"],
    [48, "language", "Says sentences with four or more words"],
    [48, "cognitive", "Names a few colors of items"],
    [48, "movement", "Catches a large ball most of the time"],
    [60, "social", "Follows rules or takes turns when playing games"],
    [60, "language", "Tells a story with at least two events"],
    [60, "cognitive", "Counts to 10"],
    [60, "movement", "Hops on one foot"],
  ].map(([ageMonths, category, text], i) => ({ id: `cdc_${i}`, ageMonths, category, text }));

  const PG_FEED_KINDS = ["nursing", "bottle", "solid"];
  const PG_DIAPER_KINDS = ["wet", "dirty", "mixed"];
  const PG_ACTIVITY_KINDS = ["tummy_time", "bath", "play", "potty", "outdoors", "reading", "other"];

  // ── Children ────────────────────────────────────────────────────────
  registerLensAction("parenting", "child-add", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = pgClean(params.name, 60);
    if (!name) return { ok: false, error: "child name required" };
    const birthDate = pgClean(params.birthDate, 10).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return { ok: false, error: "birthDate must be YYYY-MM-DD" };
    const child = {
      id: pgId("kid"), name, birthDate,
      sex: ["boy", "girl"].includes(String(params.sex).toLowerCase()) ? String(params.sex).toLowerCase() : "boy",
      createdAt: pgNow(),
    };
    pgListB(s.children, pgAid(ctx)).push(child);
    savePgState();
    return { ok: true, result: { child: { ...child, ageMonths: Math.round(pgAgeMonths(birthDate) * 10) / 10, ageDisplay: pgAgeDisplay(birthDate) } } };
  });

  registerLensAction("parenting", "child-list", (ctx, _a, _params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const children = (s.children.get(pgAid(ctx)) || []).map((c) => ({
      ...c,
      ageMonths: Math.round(pgAgeMonths(c.birthDate) * 10) / 10,
      ageDisplay: pgAgeDisplay(c.birthDate),
    }));
    return { ok: true, result: { children, count: children.length } };
  });

  registerLensAction("parenting", "child-delete", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.children.get(pgAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "child not found" };
    arr.splice(i, 1);
    savePgState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Feeding ─────────────────────────────────────────────────────────
  registerLensAction("parenting", "feed-log", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pgAid(ctx);
    if (!pgChild(s, userId, params.childId)) return { ok: false, error: "child not found" };
    const kind = PG_FEED_KINDS.includes(String(params.kind).toLowerCase()) ? String(params.kind).toLowerCase() : "nursing";
    const entry = {
      id: pgId("fed"), childId: String(params.childId), kind,
      amountMl: kind === "bottle" ? Math.max(0, pgNum(params.amountMl)) : null,
      durationMin: kind === "solid" ? null : Math.max(0, pgNum(params.durationMin)),
      side: kind === "nursing" && ["left", "right", "both"].includes(String(params.side))
        ? String(params.side) : null,
      food: kind === "solid" ? (pgClean(params.food, 80) || null) : null,
      at: pgClean(params.at, 30) || pgNow(),
    };
    pgListB(s.feeds, userId).push(entry);
    savePgState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("parenting", "feed-history", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = Math.max(1, Math.min(60, Math.round(pgNum(params.days, 7))));
    const cutoff = Date.now() - days * PG_DAY;
    const entries = (s.feeds.get(pgAid(ctx)) || [])
      .filter((e) => e.childId === String(params.childId) && Date.parse(e.at) >= cutoff)
      .sort((a, b) => b.at.localeCompare(a.at));
    return { ok: true, result: { entries, count: entries.length } };
  });

  registerLensAction("parenting", "feed-stats", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const todayStr = pgNow().slice(0, 10);
    const all = (s.feeds.get(pgAid(ctx)) || []).filter((e) => e.childId === String(params.childId));
    const today = all.filter((e) => e.at.slice(0, 10) === todayStr);
    const byKind = {};
    for (const k of PG_FEED_KINDS) byKind[k] = today.filter((e) => e.kind === k).length;
    const lastBottle = all.filter((e) => e.kind === "bottle").sort((a, b) => b.at.localeCompare(a.at))[0];
    return {
      ok: true,
      result: {
        feedsToday: today.length,
        byKind,
        bottleMlToday: today.filter((e) => e.kind === "bottle").reduce((a, e) => a + (e.amountMl || 0), 0),
        nursingMinToday: today.filter((e) => e.kind === "nursing").reduce((a, e) => a + (e.durationMin || 0), 0),
        lastFeedAt: all.length ? all.sort((a, b) => b.at.localeCompare(a.at))[0].at : null,
        lastBottleMl: lastBottle ? lastBottle.amountMl : null,
      },
    };
  });

  // ── Sleep ───────────────────────────────────────────────────────────
  registerLensAction("parenting", "sleep-log", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pgAid(ctx);
    if (!pgChild(s, userId, params.childId)) return { ok: false, error: "child not found" };
    const durationMin = Math.max(1, Math.round(pgNum(params.durationMin)));
    const startAt = pgClean(params.startAt, 30) || pgNow();
    const entry = {
      id: pgId("slp"), childId: String(params.childId),
      type: ["nap", "night"].includes(String(params.type)) ? String(params.type) : "nap",
      durationMin, startAt,
      endAt: new Date(Date.parse(startAt) + durationMin * 60000).toISOString(),
    };
    pgListB(s.sleeps, userId).push(entry);
    savePgState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("parenting", "sleep-history", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = Math.max(1, Math.min(60, Math.round(pgNum(params.days, 7))));
    const cutoff = Date.now() - days * PG_DAY;
    const entries = (s.sleeps.get(pgAid(ctx)) || [])
      .filter((e) => e.childId === String(params.childId) && Date.parse(e.startAt) >= cutoff)
      .sort((a, b) => b.startAt.localeCompare(a.startAt));
    return { ok: true, result: { entries, count: entries.length } };
  });

  registerLensAction("parenting", "sleep-stats", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const todayStr = pgNow().slice(0, 10);
    const all = (s.sleeps.get(pgAid(ctx)) || []).filter((e) => e.childId === String(params.childId));
    const today = all.filter((e) => e.startAt.slice(0, 10) === todayStr);
    const last7Days = [...new Set(all.map((e) => e.startAt.slice(0, 10)))].slice(-7);
    const last7Total = all
      .filter((e) => last7Days.includes(e.startAt.slice(0, 10)))
      .reduce((a, e) => a + e.durationMin, 0);
    return {
      ok: true,
      result: {
        sleepMinToday: today.reduce((a, e) => a + e.durationMin, 0),
        napsToday: today.filter((e) => e.type === "nap").length,
        longestStretchMin: all.reduce((m, e) => Math.max(m, e.durationMin), 0),
        avgDailyMin: last7Days.length ? Math.round(last7Total / last7Days.length) : 0,
      },
    };
  });

  registerLensAction("parenting", "sweet-spot", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pgAid(ctx);
    const child = pgChild(s, userId, params.childId);
    if (!child) return { ok: false, error: "child not found" };
    const ageMonths = pgAgeMonths(child.birthDate);
    const ww = pgWakeWindow(ageMonths);
    const sleeps = (s.sleeps.get(userId) || []).filter((e) => e.childId === child.id);
    const lastWake = sleeps.length
      ? sleeps.reduce((m, e) => Math.max(m, Date.parse(e.endAt)), 0)
      : null;
    if (ageMonths >= 36) {
      return {
        ok: true,
        result: { ageMonths: Math.round(ageMonths), napsLikelyDropped: true, wakeWindow: ww,
          note: "Most children over 3 have dropped daytime naps. Focus on a consistent bedtime." },
      };
    }
    if (!lastWake) {
      return {
        ok: true,
        result: { ageMonths: Math.round(ageMonths), wakeWindow: ww, predictedNap: null,
          note: "Log a sleep to predict the next SweetSpot nap window." },
      };
    }
    return {
      ok: true,
      result: {
        ageMonths: Math.round(ageMonths),
        wakeWindow: ww,
        lastWakeAt: new Date(lastWake).toISOString(),
        predictedNap: {
          earliest: new Date(lastWake + ww.min * 60000).toISOString(),
          ideal: new Date(lastWake + ww.typical * 60000).toISOString(),
          latest: new Date(lastWake + ww.max * 60000).toISOString(),
        },
      },
    };
  });

  // ── Diapers ─────────────────────────────────────────────────────────
  registerLensAction("parenting", "diaper-log", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pgAid(ctx);
    if (!pgChild(s, userId, params.childId)) return { ok: false, error: "child not found" };
    const entry = {
      id: pgId("dpr"), childId: String(params.childId),
      kind: PG_DIAPER_KINDS.includes(String(params.kind)) ? String(params.kind) : "wet",
      at: pgClean(params.at, 30) || pgNow(),
    };
    pgListB(s.diapers, userId).push(entry);
    savePgState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("parenting", "diaper-history", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = Math.max(1, Math.min(60, Math.round(pgNum(params.days, 7))));
    const cutoff = Date.now() - days * PG_DAY;
    const todayStr = pgNow().slice(0, 10);
    const all = (s.diapers.get(pgAid(ctx)) || []).filter((e) => e.childId === String(params.childId));
    const entries = all.filter((e) => Date.parse(e.at) >= cutoff).sort((a, b) => b.at.localeCompare(a.at));
    const today = all.filter((e) => e.at.slice(0, 10) === todayStr);
    const byKind = {};
    for (const k of PG_DIAPER_KINDS) byKind[k] = today.filter((e) => e.kind === k).length;
    return { ok: true, result: { entries, count: entries.length, todayCount: today.length, byKindToday: byKind } };
  });

  // ── Pumping ─────────────────────────────────────────────────────────
  registerLensAction("parenting", "pump-log", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entry = {
      id: pgId("pmp"),
      amountMl: Math.max(0, pgNum(params.amountMl)),
      side: ["left", "right", "both"].includes(String(params.side)) ? String(params.side) : "both",
      durationMin: Math.max(0, pgNum(params.durationMin)),
      at: pgClean(params.at, 30) || pgNow(),
    };
    pgListB(s.pumps, pgAid(ctx)).push(entry);
    savePgState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("parenting", "pump-history", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = Math.max(1, Math.min(60, Math.round(pgNum(params.days, 7))));
    const cutoff = Date.now() - days * PG_DAY;
    const todayStr = pgNow().slice(0, 10);
    const all = s.pumps.get(pgAid(ctx)) || [];
    const entries = all.filter((e) => Date.parse(e.at) >= cutoff).sort((a, b) => b.at.localeCompare(a.at));
    return {
      ok: true,
      result: {
        entries, count: entries.length,
        mlToday: all.filter((e) => e.at.slice(0, 10) === todayStr).reduce((a, e) => a + e.amountMl, 0),
      },
    };
  });

  // ── Growth ──────────────────────────────────────────────────────────
  registerLensAction("parenting", "growth-log", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pgAid(ctx);
    if (!pgChild(s, userId, params.childId)) return { ok: false, error: "child not found" };
    const weightKg = pgNum(params.weightKg);
    const heightCm = pgNum(params.heightCm);
    const headCm = pgNum(params.headCm);
    if (weightKg <= 0 && heightCm <= 0 && headCm <= 0) {
      return { ok: false, error: "provide at least one measurement" };
    }
    const entry = {
      id: pgId("grw"), childId: String(params.childId),
      weightKg: weightKg > 0 ? Math.round(weightKg * 100) / 100 : null,
      heightCm: heightCm > 0 ? Math.round(heightCm * 10) / 10 : null,
      headCm: headCm > 0 ? Math.round(headCm * 10) / 10 : null,
      date: (pgClean(params.date, 10).slice(0, 10)) || pgNow().slice(0, 10),
      at: pgNow(),
    };
    pgListB(s.growth, userId).push(entry);
    savePgState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("parenting", "growth-history", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entries = (s.growth.get(pgAid(ctx)) || [])
      .filter((e) => e.childId === String(params.childId))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { ok: true, result: { entries, count: entries.length } };
  });

  registerLensAction("parenting", "growth-percentile", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pgAid(ctx);
    const child = pgChild(s, userId, params.childId);
    if (!child) return { ok: false, error: "child not found" };
    const latest = (s.growth.get(userId) || [])
      .filter((e) => e.childId === child.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!latest) return { ok: false, error: "no growth measurements logged yet" };
    const ageMonths = pgAgeMonths(child.birthDate);
    const who = PG_WHO[child.sex] || PG_WHO.boy;
    const result = { ageMonths: Math.round(ageMonths * 10) / 10, sex: child.sex, measuredOn: latest.date };
    if (latest.weightKg) {
      const m = pgWhoMedian(who.weight, ageMonths);
      result.weight = { value: latest.weightKg, whoMedian: Math.round(m * 100) / 100, percentile: pgPercentile(latest.weightKg, m, PG_CV.weight) };
    }
    if (latest.heightCm) {
      const m = pgWhoMedian(who.height, ageMonths);
      result.height = { value: latest.heightCm, whoMedian: Math.round(m * 10) / 10, percentile: pgPercentile(latest.heightCm, m, PG_CV.height) };
    }
    if (latest.headCm) {
      const m = pgWhoMedian(who.head, ageMonths);
      result.head = { value: latest.headCm, whoMedian: Math.round(m * 10) / 10, percentile: pgPercentile(latest.headCm, m, PG_CV.head) };
    }
    result.note = "Percentiles are estimates from WHO median references. Confirm growth on your pediatrician's official chart.";
    return { ok: true, result };
  });

  // ── Milestones ──────────────────────────────────────────────────────
  registerLensAction("parenting", "milestone-checklist", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pgAid(ctx);
    const child = pgChild(s, userId, params.childId);
    if (!child) return { ok: false, error: "child not found" };
    const ageMonths = pgAgeMonths(child.birthDate);
    // Bracket = the highest CDC checkpoint at or below the child's age.
    const checkpoints = [...new Set(PG_MILESTONES.map((m) => m.ageMonths))];
    const bracket = checkpoints.filter((c) => c <= ageMonths + 0.5).pop() || checkpoints[0];
    const recorded = (s.milestones.get(userId) || []).filter((r) => r.childId === child.id);
    const items = PG_MILESTONES
      .filter((m) => m.ageMonths === bracket)
      .map((m) => {
        const rec = recorded.find((r) => r.milestoneId === m.id);
        return { ...m, achieved: !!rec?.achieved, achievedDate: rec?.date || null };
      });
    return {
      ok: true,
      result: {
        ageMonths: Math.round(ageMonths),
        checkpoint: bracket,
        items,
        achievedCount: items.filter((i) => i.achieved).length,
      },
    };
  });

  registerLensAction("parenting", "milestone-record", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pgAid(ctx);
    if (!pgChild(s, userId, params.childId)) return { ok: false, error: "child not found" };
    const milestone = PG_MILESTONES.find((m) => m.id === String(params.milestoneId));
    if (!milestone) return { ok: false, error: "unknown milestone" };
    const arr = pgListB(s.milestones, userId);
    let rec = arr.find((r) => r.childId === String(params.childId) && r.milestoneId === milestone.id);
    const achieved = params.achieved !== false;
    if (rec) {
      rec.achieved = achieved;
      rec.date = achieved ? (pgClean(params.date, 10).slice(0, 10) || pgNow().slice(0, 10)) : null;
    } else {
      rec = {
        childId: String(params.childId), milestoneId: milestone.id, achieved,
        date: achieved ? (pgClean(params.date, 10).slice(0, 10) || pgNow().slice(0, 10)) : null,
      };
      arr.push(rec);
    }
    savePgState();
    return { ok: true, result: { record: rec } };
  });

  registerLensAction("parenting", "milestone-progress", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pgAid(ctx);
    const child = pgChild(s, userId, params.childId);
    if (!child) return { ok: false, error: "child not found" };
    const ageMonths = pgAgeMonths(child.birthDate);
    const eligible = PG_MILESTONES.filter((m) => m.ageMonths <= ageMonths + 0.5);
    const recorded = (s.milestones.get(userId) || []).filter((r) => r.childId === child.id && r.achieved);
    const byCategory = {};
    for (const cat of ["social", "language", "cognitive", "movement"]) {
      const total = eligible.filter((m) => m.category === cat).length;
      const done = eligible.filter((m) => m.category === cat &&
        recorded.some((r) => r.milestoneId === m.id)).length;
      byCategory[cat] = { total, achieved: done };
    }
    return {
      ok: true,
      result: {
        ageMonths: Math.round(ageMonths),
        eligibleCount: eligible.length,
        achievedCount: eligible.filter((m) => recorded.some((r) => r.milestoneId === m.id)).length,
        byCategory,
      },
    };
  });

  // ── Medicine ────────────────────────────────────────────────────────
  registerLensAction("parenting", "medicine-log", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pgAid(ctx);
    if (!pgChild(s, userId, params.childId)) return { ok: false, error: "child not found" };
    const name = pgClean(params.name, 80);
    if (!name) return { ok: false, error: "medicine name required" };
    const entry = {
      id: pgId("med"), childId: String(params.childId), name,
      dose: pgClean(params.dose, 40) || null,
      at: pgClean(params.at, 30) || pgNow(),
    };
    pgListB(s.meds, userId).push(entry);
    savePgState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("parenting", "medicine-history", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = Math.max(1, Math.min(60, Math.round(pgNum(params.days, 14))));
    const cutoff = Date.now() - days * PG_DAY;
    const entries = (s.meds.get(pgAid(ctx)) || [])
      .filter((e) => e.childId === String(params.childId) && Date.parse(e.at) >= cutoff)
      .sort((a, b) => b.at.localeCompare(a.at));
    return { ok: true, result: { entries, count: entries.length } };
  });

  // ── Activities ──────────────────────────────────────────────────────
  registerLensAction("parenting", "activity-log", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pgAid(ctx);
    if (!pgChild(s, userId, params.childId)) return { ok: false, error: "child not found" };
    const entry = {
      id: pgId("act"), childId: String(params.childId),
      kind: PG_ACTIVITY_KINDS.includes(String(params.kind)) ? String(params.kind) : "other",
      durationMin: Math.max(0, pgNum(params.durationMin)),
      note: pgClean(params.note, 200) || null,
      at: pgClean(params.at, 30) || pgNow(),
    };
    pgListB(s.activities, userId).push(entry);
    savePgState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("parenting", "activity-history", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = Math.max(1, Math.min(60, Math.round(pgNum(params.days, 7))));
    const cutoff = Date.now() - days * PG_DAY;
    const entries = (s.activities.get(pgAid(ctx)) || [])
      .filter((e) => e.childId === String(params.childId) && Date.parse(e.at) >= cutoff)
      .sort((a, b) => b.at.localeCompare(a.at));
    return { ok: true, result: { entries, count: entries.length } };
  });

  // ── Day timeline ────────────────────────────────────────────────────
  registerLensAction("parenting", "day-timeline", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pgAid(ctx);
    if (!pgChild(s, userId, params.childId)) return { ok: false, error: "child not found" };
    const childId = String(params.childId);
    const date = (pgClean(params.date, 10).slice(0, 10)) || pgNow().slice(0, 10);
    const events = [];
    for (const e of (s.feeds.get(userId) || []).filter((x) => x.childId === childId && x.at.slice(0, 10) === date)) {
      events.push({ type: "feed", at: e.at, label: e.kind, detail: e });
    }
    for (const e of (s.sleeps.get(userId) || []).filter((x) => x.childId === childId && x.startAt.slice(0, 10) === date)) {
      events.push({ type: "sleep", at: e.startAt, label: `${e.type} ${e.durationMin}m`, detail: e });
    }
    for (const e of (s.diapers.get(userId) || []).filter((x) => x.childId === childId && x.at.slice(0, 10) === date)) {
      events.push({ type: "diaper", at: e.at, label: e.kind, detail: e });
    }
    for (const e of (s.meds.get(userId) || []).filter((x) => x.childId === childId && x.at.slice(0, 10) === date)) {
      events.push({ type: "medicine", at: e.at, label: e.name, detail: e });
    }
    for (const e of (s.activities.get(userId) || []).filter((x) => x.childId === childId && x.at.slice(0, 10) === date)) {
      events.push({ type: "activity", at: e.at, label: e.kind, detail: e });
    }
    events.sort((a, b) => b.at.localeCompare(a.at));
    return { ok: true, result: { date, events, count: events.length } };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("parenting", "parenting-dashboard", (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = pgAid(ctx);
    const children = s.children.get(userId) || [];
    const child = params.childId ? pgChild(s, userId, params.childId) : children[0];
    if (!child) return { ok: true, result: { hasChild: false, childCount: 0 } };
    const todayStr = pgNow().slice(0, 10);
    const feeds = (s.feeds.get(userId) || []).filter((e) => e.childId === child.id);
    const sleeps = (s.sleeps.get(userId) || []).filter((e) => e.childId === child.id);
    const diapers = (s.diapers.get(userId) || []).filter((e) => e.childId === child.id);
    const lastFeed = feeds.sort((a, b) => b.at.localeCompare(a.at))[0] || null;
    const lastSleep = sleeps.sort((a, b) => b.startAt.localeCompare(a.startAt))[0] || null;
    return {
      ok: true,
      result: {
        hasChild: true,
        childCount: children.length,
        child: { id: child.id, name: child.name, ageDisplay: pgAgeDisplay(child.birthDate) },
        feedsToday: feeds.filter((e) => e.at.slice(0, 10) === todayStr).length,
        sleepMinToday: sleeps.filter((e) => e.startAt.slice(0, 10) === todayStr).reduce((a, e) => a + e.durationMin, 0),
        diapersToday: diapers.filter((e) => e.at.slice(0, 10) === todayStr).length,
        lastFeed: lastFeed ? { kind: lastFeed.kind, at: lastFeed.at } : null,
        lastSleepEndAt: lastSleep ? lastSleep.endAt : null,
      },
    };
  });

  // feed — ingest real children's-product safety recalls from the U.S.
  // Consumer Product Safety Commission as visible DTUs. Free, no key.
  registerLensAction("parenting", "feed", async (ctx, _a, params = {}) => {
    const s = getPgState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 12)));
    const CHILD_RE = /child|infant|baby|toddler|nursery|crib|stroller|car seat|booster|playpen|pacifier|bassinet|high chair|toy/i;
    try {
      const r = await fetch("https://www.saferproducts.gov/RestWebServices/Recall?format=json");
      if (!r.ok) return { ok: false, error: `cpsc ${r.status}` };
      const data = await r.json();
      const all = Array.isArray(data) ? data : [];
      const recalls = all.filter((rec) => {
        const hay = `${rec.Title || ""} ${(rec.Products || []).map((p) => p.Name).join(" ")} ${rec.Description || ""}`;
        return CHILD_RE.test(hay);
      }).slice(0, limit);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const rec of recalls) {
        const id = `cpsckid_${rec.RecallID || rec.RecallNumber}`;
        if (s.feedSeen.has(id)) { skipped++; continue; }
        const product = (rec.Products?.[0]?.Name || rec.Title || "Children's product recall").slice(0, 90);
        const hazard = rec.Hazards?.[0]?.Name || "?";
        const title = `Child-product recall: ${product}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nHazard: ${hazard}\nRemedy: ${(rec.Remedies?.[0]?.Name) || "?"}\nRecall date: ${rec.RecallDate || "?"}\nDescription: ${(rec.Description || "").replace(/<[^>]+>/g, "").slice(0, 600)}\nSource: U.S. Consumer Product Safety Commission`,
          tags: ["parenting", "feed", "child-safety", "recall", "cpsc"],
          source: "cpsc-parenting-feed",
          meta: { recallId: rec.RecallID, product, hazard, recallDate: rec.RecallDate },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(id); }
      }
      savePgState();
      return { ok: true, result: { ingested, skipped, source: "cpsc-child-recalls", dtuIds } };
    } catch (e) {
      return { ok: false, error: `cpsc unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
