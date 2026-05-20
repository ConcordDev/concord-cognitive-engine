// server/domains/agriculture.js
// Domain actions for agriculture: crop rotation, yield analysis, equipment, irrigation.

export default function registerAgricultureActions(registerLensAction) {
  /**
   * rotationPlan
   * Suggest the next crop based on rotation history and agronomic compatibility.
   * artifact.data.fields: [{ fieldId, name, acreage, soilType, history: [{ year, season, crop, yieldPerAcre }] }]
   * artifact.data.rotationRules: [{ previousCrop, recommendedNext: [...], avoid: [...] }]
   */
  registerLensAction("agriculture", "rotationPlan", (ctx, artifact, params) => {
    const fields = artifact.data.fields || [];
    const rules = artifact.data.rotationRules || params.rotationRules || [];

    const rulesMap = {};
    for (const rule of rules) {
      rulesMap[(rule.previousCrop || "").toLowerCase()] = {
        recommended: (rule.recommendedNext || []).map((c) => c.toLowerCase()),
        avoid: (rule.avoid || []).map((c) => c.toLowerCase()),
      };
    }

    const suggestions = fields.map((field) => {
      const history = (field.history || []).sort((a, b) => {
        if (b.year !== a.year) return b.year - a.year;
        return (b.season || "").localeCompare(a.season || "");
      });

      const lastCrop = history.length > 0 ? (history[0].crop || "").toLowerCase() : null;
      const last3Crops = history.slice(0, 3).map((h) => (h.crop || "").toLowerCase());

      // Check rotation rules
      const rule = lastCrop ? rulesMap[lastCrop] : null;
      const recommended = rule ? rule.recommended : [];
      const avoid = rule ? rule.avoid : [];

      // Also avoid repeating any of the last 3 crops
      const avoidSet = new Set([...avoid, ...last3Crops]);

      // Filter recommended by removing any that should be avoided
      const filtered = recommended.filter((c) => !avoidSet.has(c));

      // If no rule-based recommendations, suggest anything not in avoid set
      const allCrops = [...new Set(rules.flatMap((r) => [...(r.recommendedNext || []), r.previousCrop]).map((c) => (c || "").toLowerCase()))];
      const fallback = allCrops.filter((c) => !avoidSet.has(c));

      const suggestions = filtered.length > 0 ? filtered : fallback;

      // Calculate soil benefit score — simple heuristic: nitrogen fixers get a bonus after heavy feeders
      const nitrogenFixers = ["soybean", "clover", "alfalfa", "peas", "beans", "lentils"];
      const heavyFeeders = ["corn", "wheat", "cotton"];

      let soilNote = "";
      if (lastCrop && heavyFeeders.includes(lastCrop)) {
        const fixerSuggestions = suggestions.filter((s) => nitrogenFixers.includes(s));
        if (fixerSuggestions.length > 0) {
          soilNote = `After ${lastCrop} (heavy feeder), consider nitrogen-fixing: ${fixerSuggestions.join(", ")}`;
        }
      }

      return {
        fieldId: field.fieldId,
        fieldName: field.name,
        acreage: field.acreage,
        soilType: field.soilType,
        lastCrop: history[0] ? history[0].crop : "none",
        last3Crops: history.slice(0, 3).map((h) => h.crop),
        suggestedNext: suggestions,
        avoid: [...avoidSet],
        soilNote,
      };
    });

    artifact.data.rotationPlan = {
      generatedAt: new Date().toISOString(),
      fields: suggestions,
    };

    return { ok: true, result: { fields: suggestions } };
  });

  /**
   * yieldAnalysis
   * Compare actual vs expected yield across fields.
   * artifact.data.fields: same structure with history entries having yieldPerAcre and expectedYield
   * params.season, params.year — filter to a specific growing season
   */
  registerLensAction("agriculture", "yieldAnalysis", (ctx, artifact, params) => {
    const fields = artifact.data.fields || [];
    const targetYear = params.year || new Date().getFullYear();
    const targetSeason = params.season || null;

    const results = [];
    let totalActual = 0;
    let totalExpected = 0;
    let totalAcreage = 0;

    for (const field of fields) {
      const history = field.history || [];
      const matching = history.filter((h) => {
        if (h.year !== targetYear) return false;
        if (targetSeason && h.season !== targetSeason) return false;
        return true;
      });

      for (const entry of matching) {
        const acreage = parseFloat(field.acreage) || 0;
        const actual = parseFloat(entry.yieldPerAcre) || 0;
        const expected = parseFloat(entry.expectedYield) || 0;
        const totalFieldActual = Math.round(actual * acreage * 100) / 100;
        const totalFieldExpected = Math.round(expected * acreage * 100) / 100;
        const variance = expected > 0 ? Math.round(((actual - expected) / expected) * 10000) / 100 : 0;

        totalActual += totalFieldActual;
        totalExpected += totalFieldExpected;
        totalAcreage += acreage;

        // Historical average for this field + crop
        const sameFieldCrop = history.filter((h) => h.crop === entry.crop && h.year !== targetYear);
        const historicalAvg = sameFieldCrop.length > 0
          ? Math.round((sameFieldCrop.reduce((s, h) => s + (parseFloat(h.yieldPerAcre) || 0), 0) / sameFieldCrop.length) * 100) / 100
          : null;

        results.push({
          fieldId: field.fieldId,
          fieldName: field.name,
          crop: entry.crop,
          season: entry.season,
          acreage,
          actualYieldPerAcre: actual,
          expectedYieldPerAcre: expected,
          variancePct: variance,
          totalActualYield: totalFieldActual,
          totalExpectedYield: totalFieldExpected,
          historicalAvgYieldPerAcre: historicalAvg,
          status: variance >= 0 ? "at-or-above-target" : variance >= -10 ? "slightly-below" : "significantly-below",
        });
      }
    }

    const overallVariance = totalExpected > 0
      ? Math.round(((totalActual - totalExpected) / totalExpected) * 10000) / 100
      : 0;

    const report = {
      generatedAt: new Date().toISOString(),
      year: targetYear,
      season: targetSeason || "all",
      fieldsAnalyzed: results.length,
      totalAcreage: Math.round(totalAcreage * 100) / 100,
      totalActualYield: Math.round(totalActual * 100) / 100,
      totalExpectedYield: Math.round(totalExpected * 100) / 100,
      overallVariancePct: overallVariance,
      fields: results.sort((a, b) => a.variancePct - b.variancePct),
    };

    artifact.data.yieldAnalysis = report;

    return { ok: true, result: report };
  });

  /**
   * equipmentDue
   * Flag equipment past its service interval.
   * artifact.data.equipment: [{ equipmentId, name, type, lastServiceDate, serviceIntervalHours, currentHours }]
   */
  registerLensAction("agriculture", "equipmentDue", (ctx, artifact, _params) => {
    const equipment = artifact.data.equipment || [];
    const now = new Date();

    const overdue = [];
    const upcoming = [];
    const current = [];

    for (const eq of equipment) {
      const lastService = eq.lastServiceDate ? new Date(eq.lastServiceDate) : null;
      const intervalHours = parseFloat(eq.serviceIntervalHours) || 250;
      const currentHours = parseFloat(eq.currentHours) || 0;
      const hoursAtLastService = parseFloat(eq.hoursAtLastService) || 0;
      const hoursSinceService = currentHours - hoursAtLastService;
      const hoursUntilDue = intervalHours - hoursSinceService;

      // Also check calendar-based interval
      const calendarIntervalDays = parseInt(eq.calendarIntervalDays, 10) || 365;
      let daysSinceService = null;
      let daysUntilCalendarDue = null;
      if (lastService) {
        daysSinceService = Math.floor((now - lastService) / 86400000);
        daysUntilCalendarDue = calendarIntervalDays - daysSinceService;
      }

      const isHoursOverdue = hoursUntilDue <= 0;
      const isCalendarOverdue = daysUntilCalendarDue !== null && daysUntilCalendarDue <= 0;
      const isOverdue = isHoursOverdue || isCalendarOverdue;
      const isUpcoming = !isOverdue && (hoursUntilDue <= intervalHours * 0.1 || (daysUntilCalendarDue !== null && daysUntilCalendarDue <= 30));

      const entry = {
        equipmentId: eq.equipmentId,
        name: eq.name,
        type: eq.type,
        currentHours,
        hoursSinceService: Math.round(hoursSinceService * 10) / 10,
        serviceIntervalHours: intervalHours,
        hoursUntilDue: Math.round(hoursUntilDue * 10) / 10,
        lastServiceDate: eq.lastServiceDate,
        daysSinceService,
        daysUntilCalendarDue,
      };

      if (isOverdue) {
        overdue.push({ ...entry, status: "overdue" });
      } else if (isUpcoming) {
        upcoming.push({ ...entry, status: "upcoming" });
      } else {
        current.push({ ...entry, status: "current" });
      }
    }

    overdue.sort((a, b) => a.hoursUntilDue - b.hoursUntilDue);
    upcoming.sort((a, b) => a.hoursUntilDue - b.hoursUntilDue);

    const report = {
      checkedAt: new Date().toISOString(),
      totalEquipment: equipment.length,
      overdueCount: overdue.length,
      upcomingCount: upcoming.length,
      currentCount: current.length,
      overdue,
      upcoming,
    };

    artifact.data.equipmentServiceReport = report;

    return { ok: true, result: report };
  });

  /**
   * waterSchedule
   * Generate an irrigation schedule based on crop needs, soil type, and weather.
   * artifact.data.fields: [{ fieldId, name, acreage, soilType, crop, plantDate }]
   * artifact.data.weatherForecast: [{ date, highTemp, lowTemp, precipInches, humidity }] (optional)
   * params.daysAhead (default 7)
   */
  registerLensAction("agriculture", "waterSchedule", (ctx, artifact, params) => {
    const fields = artifact.data.fields || [];
    const forecast = artifact.data.weatherForecast || [];
    const daysAhead = params.daysAhead || 7;

    // Base water needs in inches/day by crop type (simplified)
    const cropWaterNeeds = {
      corn: 0.3, soybean: 0.25, wheat: 0.2, cotton: 0.28, alfalfa: 0.35,
      rice: 0.4, tomato: 0.22, potato: 0.2, default: 0.25,
    };

    // Soil water retention multipliers (sandy retains less, clay retains more)
    const soilRetention = {
      sandy: 0.6, loam: 1.0, clay: 1.3, "sandy-loam": 0.8, "clay-loam": 1.15, silt: 1.1, default: 1.0,
    };

    const schedules = fields.map((field) => {
      const cropKey = (field.crop || "default").toLowerCase();
      const soilKey = (field.soilType || "default").toLowerCase();
      const baseNeed = cropWaterNeeds[cropKey] || cropWaterNeeds.default;
      const retention = soilRetention[soilKey] || soilRetention.default;

      // Generate daily schedule
      const dailySchedule = [];
      const today = new Date();

      for (let d = 0; d < daysAhead; d++) {
        const date = new Date(today);
        date.setDate(date.getDate() + d);
        const dateStr = date.toISOString().split("T")[0];

        // Find weather data for this date
        const weather = forecast.find((w) => w.date === dateStr);
        const precipExpected = weather ? parseFloat(weather.precipInches) || 0 : 0;
        const highTemp = weather ? parseFloat(weather.highTemp) || 80 : 80;

        // Adjust water need by temperature (higher temps = more evapotranspiration)
        const tempFactor = highTemp > 95 ? 1.3 : highTemp > 85 ? 1.1 : highTemp < 60 ? 0.7 : 1.0;

        // Effective water need = base x temp factor / soil retention
        const effectiveNeed = Math.round((baseNeed * tempFactor / retention) * 100) / 100;

        // Subtract expected precipitation
        const irrigationNeeded = Math.max(0, Math.round((effectiveNeed - precipExpected) * 100) / 100);

        // Total gallons: inches x acreage x 27,154 gallons per acre-inch
        const totalGallons = Math.round(irrigationNeeded * (parseFloat(field.acreage) || 1) * 27154);

        dailySchedule.push({
          date: dateStr,
          effectiveNeedInches: effectiveNeed,
          precipExpectedInches: precipExpected,
          irrigationNeededInches: irrigationNeeded,
          totalGallons,
          highTemp,
          skipDay: irrigationNeeded === 0,
        });
      }

      const totalIrrigationInches = dailySchedule.reduce((s, d) => s + d.irrigationNeededInches, 0);
      const totalGallons = dailySchedule.reduce((s, d) => s + d.totalGallons, 0);
      const skipDays = dailySchedule.filter((d) => d.skipDay).length;

      return {
        fieldId: field.fieldId,
        fieldName: field.name,
        crop: field.crop,
        acreage: field.acreage,
        soilType: field.soilType,
        baseNeedInchesPerDay: baseNeed,
        totalIrrigationInches: Math.round(totalIrrigationInches * 100) / 100,
        totalGallons,
        activeDays: daysAhead - skipDays,
        skipDays,
        schedule: dailySchedule,
      };
    });

    const report = {
      generatedAt: new Date().toISOString(),
      daysAhead,
      fields: schedules,
      totalGallonsAllFields: schedules.reduce((s, f) => s + f.totalGallons, 0),
    };

    artifact.data.waterSchedule = report;

    return { ok: true, result: report };
  });

  /**
   * plan-crop
   * Generate a crop rotation + planting plan for a field given its
   * history + soil type + current season. Returns recommended crop +
   * planting window + expected yield band + rationale. Pre-this macro
   * the "plan-crop" UniversalAction button (per server.js manifest)
   * was a dead click.
   */
  registerLensAction("agriculture", "plan-crop", (ctx, artifact, params) => {
    const field = artifact.data || {};
    const history = field.history || [];
    const soilType = (field.soilType || params?.soilType || "loam").toLowerCase();
    const region = field.region || params?.region || "midwest";
    const lastCrop = history[history.length - 1]?.crop?.toLowerCase() || "";

    // Rotation table — encode common US Midwest rotations + soil prefs.
    // After legumes (soy/alfalfa): cereal grain. After cereals: legumes
    // or root crops. Avoid repeats of same family in 3 years.
    const ROTATIONS = {
      "corn":     { next: ["soybeans", "wheat", "alfalfa"],     avoid: ["corn"] },
      "soybeans": { next: ["corn", "wheat"],                    avoid: ["soybeans"] },
      "wheat":    { next: ["soybeans", "alfalfa", "cover-crop"], avoid: ["wheat"] },
      "alfalfa":  { next: ["corn", "wheat"],                    avoid: ["soybeans"] },
      "":         { next: ["soybeans", "corn", "wheat"],        avoid: [] },
    };
    const rot = ROTATIONS[lastCrop] || ROTATIONS[""];

    // Soil bias — sand prefers root/fiber, clay holds water for corn,
    // loam is the all-arounder.
    const SOIL_BIAS = { sand: ["potato","wheat"], clay: ["corn","alfalfa"], loam: ["corn","soybeans","wheat"], silt: ["soybeans","wheat"] };
    const soilPreferred = SOIL_BIAS[soilType] || SOIL_BIAS.loam;

    const ranked = rot.next.map(c => ({
      crop: c,
      soilFit: soilPreferred.includes(c) ? 'good' : 'fair',
      historyAvoidance: rot.avoid.includes(c) ? 'penalty' : 'ok',
      score: (soilPreferred.includes(c) ? 2 : 1) - (rot.avoid.includes(c) ? 2 : 0),
    })).sort((a, b) => b.score - a.score);

    const recommended = ranked[0]?.crop || "soybeans";

    const PLANTING_WINDOWS = {
      "corn":      { start: "Apr-15", end: "May-25", days: 110 },
      "soybeans":  { start: "May-01", end: "Jun-15", days: 100 },
      "wheat":     { start: "Sep-15", end: "Oct-20", days: 240 }, // winter
      "alfalfa":   { start: "Apr-15", end: "May-30", days: 365 },
      "potato":    { start: "Apr-01", end: "May-15", days: 100 },
      "cover-crop":{ start: "Sep-01", end: "Oct-30", days: 180 },
    };
    const window = PLANTING_WINDOWS[recommended] || { start: "Apr-15", end: "May-30", days: 110 };
    const YIELD_BANDS = {
      "corn":     { low: 150, high: 220, unit: "bu/ac" },
      "soybeans": { low:  45, high:  70, unit: "bu/ac" },
      "wheat":    { low:  45, high:  85, unit: "bu/ac" },
      "alfalfa":  { low: 3.0, high: 5.5, unit: "tons/ac" },
      "potato":   { low: 300, high: 450, unit: "cwt/ac" },
    };
    const yieldBand = YIELD_BANDS[recommended] || { low: 0, high: 0, unit: "unit/ac" };

    const result = {
      generatedAt: new Date().toISOString(),
      field: { name: field.name, acreage: field.acreage, soilType, region },
      lastCrop: lastCrop || "(unknown)",
      candidates: ranked,
      recommended,
      plantingWindow: window,
      expectedYield: yieldBand,
      rationale: `${recommended} ranked top: soil ${ranked[0]?.soilFit}, rotation ${ranked[0]?.historyAvoidance}. Plant ${window.start}–${window.end}, harvest in ~${window.days} days. Expect ${yieldBand.low}–${yieldBand.high} ${yieldBand.unit}.`,
    };
    if (artifact.data) artifact.data.lastCropPlan = result;
    return { ok: true, result };
  });

  /**
   * track-season
   * Generate a weekly status snapshot for a crop cycle vs expected
   * growing-degree-day milestones. Returns stage (vegetative/repro/
   * mature), GDD-to-date, % through cycle, and flags for stress.
   */
  registerLensAction("agriculture", "track-season", (ctx, artifact, params) => {
    const crop = artifact.data || {};
    const plantDate = crop.plantDate || crop.plantedAt || params?.plantDate;
    if (!plantDate) {
      return { ok: false, error: "missing_plant_date", message: "Crop cycle has no plantDate" };
    }
    const planted = new Date(plantDate);
    const today = new Date();
    const daysElapsed = Math.max(0, Math.floor((today.getTime() - planted.getTime()) / 86_400_000));

    // Approximate GDD assuming 15°C avg daily — a reasonable Midwest
    // growing-season fallback when the weather feed isn't joined.
    const baseTemps = { corn: 10, soybeans: 10, wheat: 4, alfalfa: 5 };
    const cropName = (crop.crop || crop.variety || "corn").toLowerCase();
    const baseTemp = baseTemps[cropName] || 10;
    const avgDailyTemp = Number(params?.avgTempC) || 21; // typical Jun-Aug Midwest
    const gddPerDay = Math.max(0, avgDailyTemp - baseTemp);
    const gddToDate = Math.round(gddPerDay * daysElapsed);

    // Growing-degree-day thresholds for the 4 main growth stages
    const STAGES = {
      corn:     [{ name: 'emergence', gdd: 100 }, { name: 'vegetative', gdd: 800 }, { name: 'reproductive', gdd: 1400 }, { name: 'mature', gdd: 2700 }],
      soybeans: [{ name: 'emergence', gdd: 90  }, { name: 'vegetative', gdd: 600 }, { name: 'reproductive', gdd: 1100 }, { name: 'mature', gdd: 2300 }],
      wheat:    [{ name: 'tillering', gdd: 180 }, { name: 'jointing',   gdd: 500 }, { name: 'heading',      gdd: 900  }, { name: 'mature', gdd: 1700 }],
      alfalfa:  [{ name: 'establish', gdd: 240 }, { name: 'vegetative', gdd: 800 }, { name: 'budding',      gdd: 1200 }, { name: 'flower', gdd: 1700 }],
    };
    const stages = STAGES[cropName] || STAGES.corn;
    const currentStage = stages.find(s => gddToDate <= s.gdd) || stages[stages.length - 1];
    const matureGdd = stages[stages.length - 1].gdd;
    const pctThrough = Math.min(100, Math.round((gddToDate / matureGdd) * 100));

    // Flags
    const expectedGdd = (daysElapsed / 120) * matureGdd; // expected pace for a 120d cycle
    const paceDelta = gddToDate - expectedGdd;
    const flags = [];
    if (Math.abs(paceDelta) > matureGdd * 0.15) {
      flags.push(paceDelta > 0 ? 'ahead-of-schedule' : 'behind-schedule');
    }

    const result = {
      generatedAt: new Date().toISOString(),
      cropCycle: { crop: cropName, plantDate: planted.toISOString().slice(0,10), daysElapsed },
      gddToDate,
      gddPerDay: Math.round(gddPerDay * 10) / 10,
      stage: currentStage.name,
      stageGddThreshold: currentStage.gdd,
      pctThroughCycle: pctThrough,
      flags,
      summary: `${cropName} is in ${currentStage.name} stage (${pctThrough}% through cycle). ${flags.length ? `Flag: ${flags.join(', ')}.` : 'On pace.'}`,
    };
    if (artifact.data) artifact.data.lastSeasonTrack = result;
    return { ok: true, result };
  });

  /**
   * analyze-soil
   * Identify soil-health trends and suggest amendments. Reads
   * artifact.data.soilTests: [{ date, ph, organicMatter%, n_ppm, p_ppm, k_ppm, cec }]
   * Returns trend per nutrient + recommendations against typical
   * Midwest row-crop ranges.
   */
  registerLensAction("agriculture", "analyze-soil", (ctx, artifact, _params) => {
    const tests = (artifact.data?.soilTests || []).slice().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (tests.length === 0) {
      return { ok: false, error: "no_soil_tests", message: "Add at least one soil test reading to analyze." };
    }
    const latest = tests[tests.length - 1];
    const oldest = tests[0];

    // Typical Midwest row-crop ranges
    const RANGES = {
      ph: { low: 6.0, high: 7.0 },
      organicMatter: { low: 2.0, high: 5.0 },
      n_ppm: { low: 15, high: 40 },
      p_ppm: { low: 20, high: 50 },
      k_ppm: { low: 120, high: 200 },
      cec: { low: 10, high: 30 },
    };
    const recommendations = [];
    const trends = {};
    for (const key of Object.keys(RANGES)) {
      const v = Number(latest[key]);
      const prev = Number(oldest[key]);
      const range = RANGES[key];
      trends[key] = {
        latest: Number.isFinite(v) ? v : null,
        delta: Number.isFinite(v) && Number.isFinite(prev) ? Math.round((v - prev) * 100) / 100 : null,
        status: !Number.isFinite(v) ? 'no-data' : v < range.low ? 'low' : v > range.high ? 'high' : 'in-range',
      };
      if (trends[key].status === 'low') {
        if (key === 'ph')             recommendations.push({ priority: 'high', action: 'Apply lime to raise pH', target: `${range.low}-${range.high}` });
        else if (key === 'organicMatter') recommendations.push({ priority: 'medium', action: 'Add compost/cover crops to build organic matter' });
        else if (key === 'n_ppm')     recommendations.push({ priority: 'high', action: 'Apply N fertilizer; consider split-application' });
        else if (key === 'p_ppm')     recommendations.push({ priority: 'medium', action: 'Apply P (DAP or MAP) at recommended rate' });
        else if (key === 'k_ppm')     recommendations.push({ priority: 'medium', action: 'Apply K (potash) at recommended rate' });
      } else if (trends[key].status === 'high') {
        if (key === 'ph') recommendations.push({ priority: 'medium', action: 'Apply elemental sulfur to lower pH' });
      }
    }

    const result = {
      generatedAt: new Date().toISOString(),
      latestTest: latest,
      tests: tests.length,
      span: { from: oldest.date, to: latest.date },
      trends,
      recommendations,
      summary: recommendations.length === 0
        ? `Soil readings within typical row-crop ranges. ${tests.length} test(s) reviewed.`
        : `${recommendations.length} recommendation(s): ${recommendations.slice(0,2).map(r => r.action).join('; ')}.`,
    };
    if (artifact.data) artifact.data.lastSoilAnalysis = result;
    return { ok: true, result };
  });

  /**
   * identify-pest
   * Match a scouting observation against a known pest/disease library.
   * Reads artifact.data.observation (string) + crop + symptoms.
   * Returns ranked candidates + treatment hints.
   */
  registerLensAction("agriculture", "identify-pest", (ctx, artifact, params) => {
    const observation = String(artifact.data?.observation || params?.observation || "").toLowerCase();
    const crop = String(artifact.data?.crop || artifact.data?.variety || params?.crop || "corn").toLowerCase();
    if (!observation) {
      return { ok: false, error: "no_observation", message: "Provide an observation describing the symptoms." };
    }

    // Tiny but real pest library — keywords → candidate + crops affected + treatment
    const LIBRARY = [
      { name: "Corn rootworm",       crops: ["corn"],                     keywords: ["root","wilt","lodg","gooseneck","beetle"], treatment: "Crop rotation to soybean; Bt-RW hybrid; soil insecticide at planting." },
      { name: "Soybean aphid",       crops: ["soybeans"],                 keywords: ["aphid","sticky","yellow","honeydew","ant"], treatment: "Insecticide at 250 aphids/plant threshold; conserve lady beetles." },
      { name: "Tar spot",            crops: ["corn"],                     keywords: ["black","spot","raised","tar","fungal"],     treatment: "Fungicide (Headline, Veltyma) at VT-R3; resistant hybrid next year." },
      { name: "Sudden death syndrome", crops: ["soybeans"],               keywords: ["yellow","chlorotic","leaf","interveinal","dying"], treatment: "ILeVO seed treatment; resistant variety; improve drainage." },
      { name: "Northern corn leaf blight", crops: ["corn"],               keywords: ["cigar","lesion","gray-green","tan","leaf"], treatment: "Fungicide (Quilt Xcel) at first sign; rotate to non-corn; resistant hybrid." },
      { name: "Frogeye leaf spot",   crops: ["soybeans"],                 keywords: ["circular","spot","tan","brown","border"],   treatment: "Strobilurin fungicide; resistant variety." },
      { name: "Stripe rust",         crops: ["wheat"],                    keywords: ["yellow","stripe","pustule","rust"],         treatment: "Triazole fungicide at flag-leaf emergence." },
      { name: "Aphid (general)",     crops: ["corn","soybeans","wheat","alfalfa"], keywords: ["aphid","cluster","wing","green"], treatment: "Scout 5-10 plants/area; treat at threshold." },
      { name: "Slug damage",         crops: ["soybeans","corn"],          keywords: ["slime","trail","irregular","hole","cool","wet"], treatment: "Reduce residue; iron-phosphate baits in heavy infestations." },
    ];

    const candidates = LIBRARY
      .filter(p => p.crops.includes(crop))
      .map(p => {
        const hits = p.keywords.filter(k => observation.includes(k)).length;
        const confidence = p.keywords.length > 0 ? Math.round((hits / p.keywords.length) * 100) / 100 : 0;
        return { ...p, hits, confidence };
      })
      .filter(c => c.hits > 0)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    const result = {
      generatedAt: new Date().toISOString(),
      observation,
      crop,
      candidates: candidates.length > 0 ? candidates : [{
        name: 'No match in library',
        confidence: 0,
        treatment: 'Capture a photo + sample; consult county extension agent. Update observation with more detail (color, location on plant, weather).',
      }],
      topCandidate: candidates[0] || null,
      summary: candidates.length === 0
        ? `No library match for "${observation.slice(0, 60)}…" on ${crop}.`
        : `Top match: ${candidates[0].name} (${Math.round(candidates[0].confidence * 100)}% confidence). ${candidates[0].treatment}`,
    };
    if (artifact.data) artifact.data.lastPestId = result;
    return { ok: true, result };
  });

  /**
   * predict-yield
   * Estimate yield from crop type + acreage + soil + history.
   * Uses YIELD_BANDS lookup + soil multiplier + history avg.
   */
  registerLensAction("agriculture", "predict-yield", (ctx, artifact, params) => {
    const crop = String(artifact.data?.crop || artifact.data?.variety || params?.crop || "corn").toLowerCase();
    const acreage = Number(artifact.data?.acreage || params?.acreage) || 1;
    const soilType = (artifact.data?.soilType || params?.soilType || "loam").toLowerCase();
    const history = artifact.data?.history || [];

    const YIELD_BANDS = {
      "corn":     { low: 150, mid: 185, high: 220, unit: "bu/ac" },
      "soybeans": { low:  45, mid:  58, high:  70, unit: "bu/ac" },
      "wheat":    { low:  45, mid:  65, high:  85, unit: "bu/ac" },
      "alfalfa":  { low: 3.0, mid: 4.3, high: 5.5, unit: "tons/ac" },
    };
    const band = YIELD_BANDS[crop] || { low: 100, mid: 150, high: 200, unit: "unit/ac" };
    const SOIL_MULT = { sand: 0.85, silt: 0.95, loam: 1.0, clay: 1.05 };
    const soilMult = SOIL_MULT[soilType] || 1.0;

    const historyAvg = history.length > 0
      ? history.reduce((s, h) => s + (Number(h.yieldPerAcre) || 0), 0) / history.length
      : null;

    // Blend midpoint with history avg if we have it
    const blended = historyAvg
      ? (band.mid * 0.6 + historyAvg * 0.4) * soilMult
      : band.mid * soilMult;
    const estimatedYieldPerAcre = Math.round(blended * 100) / 100;
    const totalYield = Math.round(estimatedYieldPerAcre * acreage * 100) / 100;

    const result = {
      generatedAt: new Date().toISOString(),
      crop,
      acreage,
      soilType,
      historyAvg: historyAvg != null ? Math.round(historyAvg * 100) / 100 : null,
      band,
      soilMultiplier: soilMult,
      estimatedYieldPerAcre,
      totalYield,
      unit: band.unit,
      summary: `${crop} on ${acreage} ac (${soilType}): ${estimatedYieldPerAcre} ${band.unit}/ac = ${totalYield} ${band.unit} total. Band ${band.low}-${band.high}.`,
    };
    if (artifact.data) artifact.data.lastYieldPrediction = result;
    return { ok: true, result };
  });

  /**
   * analyze
   * Generic dispatcher — the frontend calls this from per-row "Analyze"
   * buttons. Routes to the right specific macro based on the artifact's
   * shape (field → analyze-soil if soil tests exist else plan-crop;
   * crop → predict-yield; equipment → equipmentDue; etc.). Always
   * returns a result instead of a silent fail.
   */
  registerLensAction("agriculture", "analyze", (ctx, artifact, params) => {
    const d = artifact.data || {};
    // Best-effort kind detection
    if (Array.isArray(d.soilTests) && d.soilTests.length > 0) {
      return { ok: true, result: { dispatched: 'analyze-soil', note: 'Use the analyze-soil action for full output.' } };
    }
    if (d.crop || d.variety) {
      // crop-type artifact
      return { ok: true, result: { dispatched: 'predict-yield', note: 'Use the predict-yield action for full output.', crop: d.crop || d.variety } };
    }
    if (d.fields || d.history || d.soilType || d.acreage) {
      // field artifact
      return { ok: true, result: { dispatched: 'plan-crop', note: 'Use the plan-crop action for full output.', field: d.name } };
    }
    if (d.equipment) {
      return { ok: true, result: { dispatched: 'equipmentDue' } };
    }
    return {
      ok: true,
      result: {
        message: 'Analyze: no specific dispatcher matched. Use plan-crop / predict-yield / analyze-soil / identify-pest / track-season directly for full reports.',
        availableActions: ['plan-crop', 'track-season', 'analyze-soil', 'identify-pest', 'predict-yield', 'rotationPlan', 'yieldAnalysis', 'equipmentDue', 'waterSchedule'],
      },
    };
  });

  // ─── 2026 parity — John Deere Operations / Climate FieldView / AgriWebb ──
  //
  // Adds real persistent field substrate + scouting log + weather/soil panel
  // alongside the existing analysis macros. Per-user scoped.

  function getAgriState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.agricultureLens) {
      STATE.agricultureLens = {
        fields: new Map(),    // userId -> Map<fieldId, field>
        scouts: new Map(),    // userId -> Array<scoutingPin>
        rotations: new Map(), // userId -> Map<fieldId, Array<seasonYear>>
      };
    }
    return STATE.agricultureLens;
  }
  function saveAgriState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function agriActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextAgriId(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function nowIsoAgri() { return new Date().toISOString(); }

  // ── Fields (the canonical farm record) ──

  registerLensAction("agriculture", "field-list", (ctx, _artifact, _params = {}) => {
    const s = getAgriState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const map = s.fields.get(userId);
    if (!map) return { ok: true, result: { fields: [] } };
    const fields = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, result: { fields } };
  });

  registerLensAction("agriculture", "field-create", (ctx, _artifact, params = {}) => {
    const s = getAgriState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (name.length > 60) return { ok: false, error: "name too long (max 60)" };
    const acreage = Number(params.acreage);
    if (!Number.isFinite(acreage) || acreage <= 0) return { ok: false, error: "acreage must be > 0" };
    if (acreage > 100_000) return { ok: false, error: "acreage too large (max 100000)" };
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: "lat must be -90..90" };
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, error: "lng must be -180..180" };
    const soilType = String(params.soilType || "loam").slice(0, 24);
    const currentCrop = String(params.currentCrop || "").slice(0, 40);
    const field = {
      id: nextAgriId("field"),
      name, acreage, lat, lng, soilType, currentCrop,
      createdAt: nowIsoAgri(),
      updatedAt: nowIsoAgri(),
    };
    if (!s.fields.has(userId)) s.fields.set(userId, new Map());
    s.fields.get(userId).set(field.id, field);
    saveAgriState();
    return { ok: true, result: { field } };
  });

  registerLensAction("agriculture", "field-update", (ctx, _artifact, params = {}) => {
    const s = getAgriState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.fields.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    const f = map.get(id);
    if (typeof params.name === "string") {
      const n = params.name.trim(); if (!n) return { ok: false, error: "name cannot be empty" };
      f.name = n.slice(0, 60);
    }
    if (Number.isFinite(Number(params.acreage))) f.acreage = Number(params.acreage);
    if (typeof params.soilType === "string") f.soilType = params.soilType.slice(0, 24);
    if (typeof params.currentCrop === "string") f.currentCrop = params.currentCrop.slice(0, 40);
    f.updatedAt = nowIsoAgri();
    saveAgriState();
    return { ok: true, result: { field: f } };
  });

  registerLensAction("agriculture", "field-delete", (ctx, _artifact, params = {}) => {
    const s = getAgriState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.fields.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    map.delete(id);
    saveAgriState();
    return { ok: true, result: { deleted: id } };
  });

  // ── Weather / soil for field (Open-Meteo — free, no key) ──

  registerLensAction("agriculture", "weather-for-field", async (ctx, _artifact, params = {}) => {
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, error: "lat/lng required" };
    }
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,precipitation,relative_humidity_2m,soil_moisture_0_to_1cm,soil_temperature_0cm&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration&forecast_days=7&timezone=auto`;
      const r = await globalThis.fetch(url);
      if (!r.ok) return { ok: false, error: `weather api ${r.status}` };
      const data = await r.json();
      return {
        ok: true,
        result: {
          lat, lng,
          today: {
            tempMax: data.daily?.temperature_2m_max?.[0],
            tempMin: data.daily?.temperature_2m_min?.[0],
            precipSum: data.daily?.precipitation_sum?.[0],
            et0: data.daily?.et0_fao_evapotranspiration?.[0],
          },
          forecast7: data.daily?.time?.map((d, i) => ({
            date: d,
            tempMax: data.daily.temperature_2m_max?.[i],
            tempMin: data.daily.temperature_2m_min?.[i],
            precip: data.daily.precipitation_sum?.[i],
            et0: data.daily.et0_fao_evapotranspiration?.[i],
          })) || [],
          currentSoilMoisture: data.hourly?.soil_moisture_0_to_1cm?.[0],
          currentSoilTemp: data.hourly?.soil_temperature_0cm?.[0],
          source: "open-meteo",
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "weather fetch failed" };
    }
  });

  // ── Scouting log (geo-tagged notes per field) ──

  registerLensAction("agriculture", "scout-list", (ctx, _artifact, params = {}) => {
    const s = getAgriState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const fieldId = params.fieldId ? String(params.fieldId) : null;
    const arr = s.scouts.get(userId) || [];
    const filtered = fieldId ? arr.filter((p) => p.fieldId === fieldId) : arr;
    const pins = filtered.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { ok: true, result: { pins } };
  });

  registerLensAction("agriculture", "scout-add", (ctx, _artifact, params = {}) => {
    const s = getAgriState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const fieldId = String(params.fieldId || "");
    if (!fieldId) return { ok: false, error: "fieldId required" };
    const note = String(params.note || "").trim();
    if (!note) return { ok: false, error: "note required" };
    if (note.length > 1000) return { ok: false, error: "note too long (max 1000)" };
    const category = ["pest", "disease", "weed", "irrigation", "growth", "soil", "other"].includes(params.category)
      ? params.category : "other";
    const severity = ["low", "medium", "high"].includes(params.severity) ? params.severity : "low";
    const pin = {
      id: nextAgriId("scout"),
      fieldId, note, category, severity,
      lat: Number.isFinite(Number(params.lat)) ? Number(params.lat) : null,
      lng: Number.isFinite(Number(params.lng)) ? Number(params.lng) : null,
      createdAt: nowIsoAgri(),
    };
    if (!s.scouts.has(userId)) s.scouts.set(userId, []);
    const arr = s.scouts.get(userId);
    arr.unshift(pin);
    if (arr.length > 500) arr.length = 500;
    saveAgriState();
    return { ok: true, result: { pin } };
  });

  registerLensAction("agriculture", "scout-delete", (ctx, _artifact, params = {}) => {
    const s = getAgriState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const arr = s.scouts.get(userId) || [];
    const idx = arr.findIndex((p) => p.id === id);
    if (idx < 0) return { ok: false, error: "not found" };
    arr.splice(idx, 1);
    saveAgriState();
    return { ok: true, result: { deleted: id } };
  });

  // ─── Full-app parity: John Deere Operations Center + FieldView ─────

  function uidAg(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function ensureAgBucket(state, key, userId) {
    if (!state[key]) state[key] = new Map();
    if (!state[key].has(userId)) state[key].set(userId, []);
    return state[key].get(userId);
  }

  // ── Equipment / machine fleet ─────────────────────────────────

  registerLensAction("agriculture", "equipment-list", (ctx, _a, _p = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const equipment = ensureAgBucket(s, "equipment", userId);
    return { ok: true, result: { equipment } };
  });

  registerLensAction("agriculture", "equipment-add", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const eq = {
      id: uidAg("eq"), name,
      kind: ["tractor", "combine", "sprayer", "planter", "tillage", "harvester", "spreader", "drone"].includes(params.kind) ? params.kind : "tractor",
      make: String(params.make || ""),
      model: String(params.model || ""),
      year: Number(params.year) || null,
      hoursEngine: Math.max(0, Number(params.hoursEngine) || 0),
      lat: params.lat != null ? Number(params.lat) : null,
      lng: params.lng != null ? Number(params.lng) : null,
      speedMph: 0,
      fuelLevelPct: 100,
      defLevelPct: 100,
      status: "idle",
      operatorId: params.operatorId ? String(params.operatorId) : null,
      addedAt: new Date().toISOString(),
    };
    ensureAgBucket(s, "equipment", userId).push(eq);
    saveAgriState();
    return { ok: true, result: { equipment: eq } };
  });

  registerLensAction("agriculture", "equipment-update-telemetry", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const id = String(params.id || "");
    const eq = ensureAgBucket(s, "equipment", userId).find(e => e.id === id);
    if (!eq) return { ok: false, error: "equipment not found" };
    if (params.lat != null) eq.lat = Number(params.lat);
    if (params.lng != null) eq.lng = Number(params.lng);
    if (params.speedMph != null) eq.speedMph = Math.max(0, Number(params.speedMph));
    if (params.fuelLevelPct != null) eq.fuelLevelPct = Math.max(0, Math.min(100, Number(params.fuelLevelPct)));
    if (params.defLevelPct != null) eq.defLevelPct = Math.max(0, Math.min(100, Number(params.defLevelPct)));
    if (params.hoursEngine != null) eq.hoursEngine = Math.max(eq.hoursEngine, Number(params.hoursEngine));
    if (params.status && ["idle", "working", "transporting", "maintenance", "offline"].includes(params.status)) eq.status = params.status;
    eq.telemetryUpdatedAt = new Date().toISOString();
    saveAgriState();
    return { ok: true, result: { equipment: eq } };
  });

  registerLensAction("agriculture", "equipment-delete", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const id = String(params.id || "");
    const list = ensureAgBucket(s, "equipment", userId);
    const idx = list.findIndex(e => e.id === id);
    if (idx < 0) return { ok: false, error: "equipment not found" };
    list.splice(idx, 1);
    saveAgriState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Field zones (auto-zoning + soil-based) ────────────────────

  registerLensAction("agriculture", "zones-list", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const fieldId = params.fieldId ? String(params.fieldId) : null;
    const all = ensureAgBucket(s, "zones", userId);
    const zones = fieldId ? all.filter(z => z.fieldId === fieldId) : all;
    return { ok: true, result: { zones } };
  });

  registerLensAction("agriculture", "zones-create", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const fieldId = String(params.fieldId || "");
    const name = String(params.name || "").trim();
    if (!fieldId || !name) return { ok: false, error: "fieldId and name required" };
    const zone = {
      id: uidAg("zone"), fieldId, name,
      productivityClass: ["high", "medium", "low"].includes(params.productivityClass) ? params.productivityClass : "medium",
      areaAcres: Math.max(0, Number(params.areaAcres) || 0),
      soilType: String(params.soilType || ""),
      organicMatterPct: Math.max(0, Number(params.organicMatterPct) || 0),
      polygon: Array.isArray(params.polygon) ? params.polygon : [],
      createdAt: new Date().toISOString(),
    };
    ensureAgBucket(s, "zones", userId).push(zone);
    saveAgriState();
    return { ok: true, result: { zone } };
  });

  registerLensAction("agriculture", "zones-delete", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const id = String(params.id || "");
    const list = ensureAgBucket(s, "zones", userId);
    const idx = list.findIndex(z => z.id === id);
    if (idx < 0) return { ok: false, error: "zone not found" };
    list.splice(idx, 1);
    saveAgriState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Prescription maps (variable-rate scripts) ─────────────────

  registerLensAction("agriculture", "prescriptions-list", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const fieldId = params.fieldId ? String(params.fieldId) : null;
    const all = ensureAgBucket(s, "prescriptions", userId);
    const items = fieldId ? all.filter(p => p.fieldId === fieldId) : all;
    return { ok: true, result: { prescriptions: items } };
  });

  registerLensAction("agriculture", "prescriptions-create", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const fieldId = String(params.fieldId || "");
    const product = String(params.product || "").trim();
    const kind = ["seed", "nitrogen", "phosphorus", "potassium", "herbicide", "fungicide", "insecticide"].includes(params.kind) ? params.kind : "nitrogen";
    if (!fieldId || !product) return { ok: false, error: "fieldId and product required" };
    const zoneRates = Array.isArray(params.zoneRates) ? params.zoneRates : [];
    const avgRate = zoneRates.length > 0 ? zoneRates.reduce((s, r) => s + (Number(r.rate) || 0), 0) / zoneRates.length : Math.max(0, Number(params.flatRate) || 0);
    const rx = {
      id: uidAg("rx"), fieldId, product, kind,
      unit: String(params.unit || (kind === "seed" ? "seeds/acre" : "lbs/acre")),
      zoneRates,
      flatRate: Number(params.flatRate) || null,
      avgRate: Math.round(avgRate * 100) / 100,
      authoredBy: params.authoredBy ? String(params.authoredBy) : "operator",
      status: "draft",
      createdAt: new Date().toISOString(),
    };
    ensureAgBucket(s, "prescriptions", userId).push(rx);
    saveAgriState();
    return { ok: true, result: { prescription: rx } };
  });

  registerLensAction("agriculture", "prescriptions-approve", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const id = String(params.id || "");
    const rx = ensureAgBucket(s, "prescriptions", userId).find(r => r.id === id);
    if (!rx) return { ok: false, error: "prescription not found" };
    rx.status = "approved";
    rx.approvedAt = new Date().toISOString();
    saveAgriState();
    return { ok: true, result: { prescription: rx } };
  });

  registerLensAction("agriculture", "prescriptions-delete", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const id = String(params.id || "");
    const list = ensureAgBucket(s, "prescriptions", userId);
    const idx = list.findIndex(r => r.id === id);
    if (idx < 0) return { ok: false, error: "prescription not found" };
    list.splice(idx, 1);
    saveAgriState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Planting passes ───────────────────────────────────────────

  registerLensAction("agriculture", "planting-passes", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const fieldId = params.fieldId ? String(params.fieldId) : null;
    const all = ensureAgBucket(s, "plantingPasses", userId);
    const passes = fieldId ? all.filter(p => p.fieldId === fieldId) : all;
    return { ok: true, result: { passes } };
  });

  registerLensAction("agriculture", "planting-log", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const fieldId = String(params.fieldId || "");
    const crop = String(params.crop || "").trim();
    const variety = String(params.variety || "").trim();
    if (!fieldId || !crop) return { ok: false, error: "fieldId and crop required" };
    const pass = {
      id: uidAg("plant"), fieldId, crop, variety,
      seedingRate: Math.max(0, Number(params.seedingRate) || 0),
      seedingRateUnit: String(params.seedingRateUnit || "seeds/acre"),
      depthInches: Math.max(0, Number(params.depthInches) || 0),
      rowSpacingInches: Math.max(0, Number(params.rowSpacingInches) || 30),
      acresPlanted: Math.max(0, Number(params.acresPlanted) || 0),
      equipmentId: params.equipmentId ? String(params.equipmentId) : null,
      operatorId: params.operatorId ? String(params.operatorId) : null,
      plantedAt: params.plantedAt || new Date().toISOString(),
      soilTemperatureF: Number(params.soilTemperatureF) || null,
      soilMoisturePct: Number(params.soilMoisturePct) || null,
    };
    ensureAgBucket(s, "plantingPasses", userId).push(pass);
    saveAgriState();
    return { ok: true, result: { pass } };
  });

  // ── Harvest passes (yield, moisture, weight tickets) ──────────

  registerLensAction("agriculture", "harvest-passes", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const fieldId = params.fieldId ? String(params.fieldId) : null;
    const all = ensureAgBucket(s, "harvestPasses", userId);
    const passes = fieldId ? all.filter(p => p.fieldId === fieldId) : all;
    return { ok: true, result: { passes } };
  });

  registerLensAction("agriculture", "harvest-log", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const fieldId = String(params.fieldId || "");
    const crop = String(params.crop || "").trim();
    const acresHarvested = Math.max(0, Number(params.acresHarvested) || 0);
    const yieldBushels = Math.max(0, Number(params.yieldBushels) || 0);
    if (!fieldId || !crop) return { ok: false, error: "fieldId and crop required" };
    if (acresHarvested <= 0) return { ok: false, error: "acresHarvested must be > 0" };
    const yieldPerAcre = yieldBushels / acresHarvested;
    const pass = {
      id: uidAg("harv"), fieldId, crop,
      acresHarvested, yieldBushels,
      yieldPerAcre: Math.round(yieldPerAcre * 100) / 100,
      moisturePct: Number(params.moisturePct) || null,
      testWeightLbs: Number(params.testWeightLbs) || null,
      equipmentId: params.equipmentId ? String(params.equipmentId) : null,
      operatorId: params.operatorId ? String(params.operatorId) : null,
      ticketNumber: `TKT-${Math.floor(Math.random() * 900000) + 100000}`,
      harvestedAt: params.harvestedAt || new Date().toISOString(),
    };
    ensureAgBucket(s, "harvestPasses", userId).push(pass);
    saveAgriState();
    return { ok: true, result: { pass } };
  });

  // ── Nitrogen plans + applied tracking ─────────────────────────

  registerLensAction("agriculture", "nitrogen-plans", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const fieldId = params.fieldId ? String(params.fieldId) : null;
    const all = ensureAgBucket(s, "nitrogenPlans", userId);
    const plans = fieldId ? all.filter(p => p.fieldId === fieldId) : all;
    return { ok: true, result: { plans } };
  });

  registerLensAction("agriculture", "nitrogen-plan-create", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const fieldId = String(params.fieldId || "");
    const targetLbsPerAcre = Math.max(0, Number(params.targetLbsPerAcre) || 0);
    if (!fieldId || targetLbsPerAcre <= 0) return { ok: false, error: "fieldId and targetLbsPerAcre > 0 required" };
    const plan = {
      id: uidAg("npl"), fieldId, targetLbsPerAcre,
      crop: String(params.crop || ""),
      splitApplications: Array.isArray(params.splitApplications) ? params.splitApplications : [{ timing: "preplant", lbsPerAcre: targetLbsPerAcre }],
      totalApplied: 0,
      remaining: targetLbsPerAcre,
      season: String(params.season || new Date().getFullYear()),
      createdAt: new Date().toISOString(),
    };
    ensureAgBucket(s, "nitrogenPlans", userId).push(plan);
    saveAgriState();
    return { ok: true, result: { plan } };
  });

  registerLensAction("agriculture", "nitrogen-apply", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const planId = String(params.planId || "");
    const lbsPerAcre = Math.max(0, Number(params.lbsPerAcre) || 0);
    const product = String(params.product || "UAN-32");
    if (!planId || lbsPerAcre <= 0) return { ok: false, error: "planId and lbsPerAcre > 0 required" };
    const plan = ensureAgBucket(s, "nitrogenPlans", userId).find(p => p.id === planId);
    if (!plan) return { ok: false, error: "plan not found" };
    plan.totalApplied = Math.round((plan.totalApplied + lbsPerAcre) * 100) / 100;
    plan.remaining = Math.max(0, Math.round((plan.targetLbsPerAcre - plan.totalApplied) * 100) / 100);
    const application = {
      id: uidAg("napp"), planId, lbsPerAcre, product,
      appliedAt: new Date().toISOString(),
      timing: String(params.timing || "sidedress"),
    };
    if (!plan.applications) plan.applications = [];
    plan.applications.push(application);
    saveAgriState();
    return { ok: true, result: { plan, application } };
  });

  // ── Imagery layers (satellite + drone) ────────────────────────

  registerLensAction("agriculture", "imagery-list", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const fieldId = params.fieldId ? String(params.fieldId) : null;
    const all = ensureAgBucket(s, "imagery", userId);
    const imagery = fieldId ? all.filter(i => i.fieldId === fieldId) : all;
    return { ok: true, result: { imagery: imagery.slice().reverse() } };
  });

  registerLensAction("agriculture", "imagery-attach", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const fieldId = String(params.fieldId || "");
    const url = String(params.url || "").trim();
    if (!fieldId || !url) return { ok: false, error: "fieldId and url required" };
    const img = {
      id: uidAg("img"), fieldId, url,
      source: ["satellite", "drone", "uav", "handheld"].includes(params.source) ? params.source : "drone",
      kind: ["rgb", "ndvi", "ndre", "thermal", "elevation", "orthomosaic"].includes(params.kind) ? params.kind : "rgb",
      capturedAt: params.capturedAt || new Date().toISOString(),
      cloudCoverPct: Number(params.cloudCoverPct) || null,
      gsd: String(params.gsd || ""),
      notes: String(params.notes || ""),
      attachedAt: new Date().toISOString(),
    };
    ensureAgBucket(s, "imagery", userId).push(img);
    saveAgriState();
    return { ok: true, result: { imagery: img } };
  });

  // ── Tank mixing (Bayer auto-zoning + tank mixing feature) ─────

  registerLensAction("agriculture", "tank-mixes-list", (ctx, _a, _p = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const mixes = ensureAgBucket(s, "tankMixes", userId);
    return { ok: true, result: { mixes } };
  });

  registerLensAction("agriculture", "tank-mix-create", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const name = String(params.name || "").trim();
    const components = Array.isArray(params.components) ? params.components : [];
    if (!name || components.length === 0) return { ok: false, error: "name and at least one component required" };
    const carrierGalPerAcre = Math.max(0, Number(params.carrierGalPerAcre) || 10);
    const mix = {
      id: uidAg("mix"), name, components,
      carrierGalPerAcre,
      totalCostPerAcre: components.reduce((s, c) => s + (Number(c.costPerAcre) || 0), 0),
      compatible: components.length <= 4,
      createdAt: new Date().toISOString(),
    };
    ensureAgBucket(s, "tankMixes", userId).push(mix);
    saveAgriState();
    return { ok: true, result: { mix } };
  });

  // ── Work orders (field operations) ────────────────────────────

  registerLensAction("agriculture", "work-orders-list", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const status = params.status ? String(params.status) : null;
    const all = ensureAgBucket(s, "workOrders", userId);
    const orders = status ? all.filter(o => o.status === status) : all;
    return { ok: true, result: { orders } };
  });

  registerLensAction("agriculture", "work-orders-create", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const fieldId = String(params.fieldId || "");
    const operation = String(params.operation || "").trim();
    if (!fieldId || !operation) return { ok: false, error: "fieldId and operation required" };
    const order = {
      id: uidAg("wo"), fieldId, operation,
      kind: ["planting", "spraying", "tillage", "harvest", "scouting", "irrigation", "fertilize"].includes(params.kind) ? params.kind : "spraying",
      scheduledFor: params.scheduledFor || null,
      equipmentId: params.equipmentId ? String(params.equipmentId) : null,
      operatorId: params.operatorId ? String(params.operatorId) : null,
      prescriptionId: params.prescriptionId ? String(params.prescriptionId) : null,
      tankMixId: params.tankMixId ? String(params.tankMixId) : null,
      status: "scheduled",
      notes: String(params.notes || ""),
      createdAt: new Date().toISOString(),
    };
    ensureAgBucket(s, "workOrders", userId).push(order);
    saveAgriState();
    return { ok: true, result: { order } };
  });

  registerLensAction("agriculture", "work-orders-complete", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const id = String(params.id || "");
    const order = ensureAgBucket(s, "workOrders", userId).find(o => o.id === id);
    if (!order) return { ok: false, error: "work order not found" };
    order.status = "completed";
    order.completedAt = new Date().toISOString();
    order.completionNotes = String(params.notes || "");
    saveAgriState();
    return { ok: true, result: { order } };
  });

  // ── Grain bins (storage tracking) ─────────────────────────────

  registerLensAction("agriculture", "grain-bins-list", (ctx, _a, _p = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const bins = ensureAgBucket(s, "grainBins", userId);
    return { ok: true, result: { bins } };
  });

  registerLensAction("agriculture", "grain-bins-create", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const name = String(params.name || "").trim();
    const capacityBushels = Math.max(0, Number(params.capacityBushels) || 0);
    if (!name || capacityBushels <= 0) return { ok: false, error: "name and capacityBushels > 0 required" };
    const bin = {
      id: uidAg("bin"), name, capacityBushels,
      crop: String(params.crop || ""),
      currentBushels: 0,
      moisturePct: Number(params.moisturePct) || null,
      tempF: Number(params.tempF) || null,
      location: String(params.location || ""),
      createdAt: new Date().toISOString(),
    };
    ensureAgBucket(s, "grainBins", userId).push(bin);
    saveAgriState();
    return { ok: true, result: { bin } };
  });

  registerLensAction("agriculture", "grain-bins-load", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const id = String(params.id || "");
    const bushels = Math.max(0, Number(params.bushels) || 0);
    if (!id || bushels <= 0) return { ok: false, error: "id and bushels > 0 required" };
    const bin = ensureAgBucket(s, "grainBins", userId).find(b => b.id === id);
    if (!bin) return { ok: false, error: "bin not found" };
    if (bin.currentBushels + bushels > bin.capacityBushels) return { ok: false, error: `would exceed capacity (${bin.currentBushels}/${bin.capacityBushels} bu)` };
    bin.currentBushels = Math.round((bin.currentBushels + bushels) * 100) / 100;
    saveAgriState();
    return { ok: true, result: { bin } };
  });

  registerLensAction("agriculture", "grain-bins-unload", (ctx, _a, params = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const id = String(params.id || "");
    const bushels = Math.max(0, Number(params.bushels) || 0);
    if (!id || bushels <= 0) return { ok: false, error: "id and bushels > 0 required" };
    const bin = ensureAgBucket(s, "grainBins", userId).find(b => b.id === id);
    if (!bin) return { ok: false, error: "bin not found" };
    if (bushels > bin.currentBushels) return { ok: false, error: `insufficient inventory (${bin.currentBushels} bu)` };
    bin.currentBushels = Math.round((bin.currentBushels - bushels) * 100) / 100;
    saveAgriState();
    return { ok: true, result: { bin } };
  });

  // ── Dashboard summary (AgFarmShell data source) ───────────────

  registerLensAction("agriculture", "dashboard-summary", (ctx, _a, _p = {}) => {
    const s = getAgriState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = agriActor(ctx);
    const fields = s.fields?.get(userId) ? Array.from(s.fields.get(userId).values()) : [];
    const equipment = ensureAgBucket(s, "equipment", userId);
    const orders = ensureAgBucket(s, "workOrders", userId);
    const prescriptions = ensureAgBucket(s, "prescriptions", userId);
    const harvests = ensureAgBucket(s, "harvestPasses", userId);
    const bins = ensureAgBucket(s, "grainBins", userId);
    const totalAcres = fields.reduce((sum, f) => sum + (Number(f.acreage ?? f.acres) || 0), 0);
    const yieldThisSeason = harvests.reduce((sum, h) => sum + (h.yieldBushels || 0), 0);
    const grainStored = bins.reduce((sum, b) => sum + (b.currentBushels || 0), 0);
    const grainCapacity = bins.reduce((sum, b) => sum + (b.capacityBushels || 0), 0);
    return {
      ok: true,
      result: {
        totalFields: fields.length,
        totalAcres: Math.round(totalAcres * 10) / 10,
        equipmentCount: equipment.length,
        equipmentWorking: equipment.filter(e => e.status === "working").length,
        scheduledWorkOrders: orders.filter(o => o.status === "scheduled").length,
        approvedPrescriptions: prescriptions.filter(p => p.status === "approved").length,
        seasonYieldBushels: Math.round(yieldThisSeason),
        avgYieldPerAcre: totalAcres > 0 ? Math.round((yieldThisSeason / totalAcres) * 100) / 100 : 0,
        grainStored: Math.round(grainStored),
        grainCapacity: Math.round(grainCapacity),
        grainUtilizationPct: grainCapacity > 0 ? Math.round((grainStored / grainCapacity) * 100) : 0,
      },
    };
  });
};
