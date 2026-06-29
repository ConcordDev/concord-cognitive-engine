// server/domains/eco.js
// Domain actions for ecology and sustainability: carbon footprint calculation,
// biodiversity index computation, and multi-criteria sustainability assessment.

export default function registerEcoActions(registerLensAction) {
  /**
   * carbonFootprint
   * Calculate carbon footprint from activity data.
   * Scope 1/2/3 emissions, emission factors, offset calculations.
   * artifact.data.activities = [{ category, type, quantity, unit, scope? }]
   * artifact.data.offsets = [{ type, quantity, unit }]  (optional)
   */
  registerLensAction("eco", "carbonFootprint", (ctx, artifact, _params) => {
  try {
    const activities = artifact.data?.activities || [];
    const offsets = artifact.data?.offsets || [];

    if (activities.length === 0) {
      return { ok: true, result: { message: "No activities provided." } };
    }

    // Emission factors in kgCO2e per unit
    const emissionFactors = {
      // Energy (scope 1 & 2)
      "natural_gas_kwh": 0.181,
      "natural_gas_m3": 2.0,
      "electricity_kwh": 0.233,
      "electricity_kwh_renewable": 0.0,
      "diesel_liter": 2.68,
      "gasoline_liter": 2.31,
      "propane_liter": 1.51,
      "coal_kg": 2.42,
      "heating_oil_liter": 2.52,
      // Transport (scope 1 & 3)
      "car_km": 0.171,
      "car_mile": 0.275,
      "bus_km": 0.089,
      "train_km": 0.041,
      "flight_short_km": 0.255,
      "flight_long_km": 0.195,
      "flight_short_passenger_km": 0.255,
      "flight_long_passenger_km": 0.195,
      "shipping_tonne_km": 0.016,
      "truck_tonne_km": 0.107,
      // Materials (scope 3)
      "paper_kg": 1.07,
      "plastic_kg": 3.1,
      "steel_kg": 1.85,
      "aluminum_kg": 8.24,
      "concrete_kg": 0.13,
      "glass_kg": 0.87,
      "wood_kg": 0.31,
      "textile_kg": 15.0,
      // Food (scope 3)
      "beef_kg": 27.0,
      "pork_kg": 6.1,
      "poultry_kg": 3.7,
      "fish_kg": 3.5,
      "dairy_kg": 3.2,
      "vegetables_kg": 0.5,
      "grains_kg": 0.8,
      "fruit_kg": 0.7,
      // Waste
      "landfill_waste_kg": 0.58,
      "recycled_waste_kg": 0.02,
      "compost_waste_kg": 0.01,
      // Digital
      "data_center_kwh": 0.233,
      "cloud_compute_hour": 0.06,
      "email_count": 0.004,
      "video_streaming_hour": 0.036,
      // Water
      "water_m3": 0.344,
    };

    // Scope inference
    function inferScope(category, type) {
      const key = `${category}_${type}`.toLowerCase();
      if (key.match(/natural_gas|diesel|gasoline|propane|coal|heating_oil/)) return 1;
      if (key.match(/electricity|data_center/)) return 2;
      return 3;
    }

    // Process each activity
    const processed = [];
    const scopeTotals = { 1: 0, 2: 0, 3: 0 };
    const categoryTotals = {};
    let totalEmissions = 0;

    for (const activity of activities) {
      const key = `${activity.category}_${activity.type}`.toLowerCase().replace(/\s+/g, "_");
      // Fail-CLOSED: a poisoned Infinity/NaN/1e999 factor or quantity must never
      // leak into the totals. Coerce both to finite, non-negative numbers.
      const factor = finiteNum(emissionFactors[key] ?? activity.emissionFactor, 0, { min: 0 });
      const quantity = finiteNum(activity.quantity, 0, { min: 0 });
      const emissions = quantity * factor;
      const scope = activity.scope || inferScope(activity.category, activity.type);

      scopeTotals[scope] = (scopeTotals[scope] || 0) + emissions;
      totalEmissions += emissions;

      const cat = activity.category || "other";
      categoryTotals[cat] = (categoryTotals[cat] || 0) + emissions;

      processed.push({
        category: activity.category,
        type: activity.type,
        quantity,
        unit: activity.unit,
        emissionFactor: factor,
        emissionFactorUnit: "kgCO2e/unit",
        emissionsKgCO2e: Math.round(emissions * 100) / 100,
        scope,
        factorSource: key in emissionFactors ? "built-in" : "user-provided",
      });
    }

    // Process offsets
    const offsetFactors = {
      "tree_planting_tree": 22, // kg CO2e per tree per year
      "solar_kwh": 0.233,
      "wind_kwh": 0.233,
      "carbon_credit_tonne": 1000,
      "reforestation_hectare": 3670,
      "biochar_kg": 2.6,
    };

    let totalOffsets = 0;
    const processedOffsets = offsets.map(o => {
      const key = `${o.type}_${o.unit}`.toLowerCase().replace(/\s+/g, "_");
      const factor = finiteNum(offsetFactors[key] ?? o.offsetFactor, 0, { min: 0 });
      const offsetAmount = finiteNum(o.quantity, 0, { min: 0 }) * factor;
      totalOffsets += offsetAmount;
      return {
        type: o.type,
        quantity: o.quantity,
        unit: o.unit,
        offsetKgCO2e: Math.round(offsetAmount * 100) / 100,
      };
    });

    const netEmissions = totalEmissions - totalOffsets;

    // Per-category breakdown
    const categoryBreakdown = Object.entries(categoryTotals)
      .map(([category, emissions]) => ({
        category,
        emissionsKgCO2e: Math.round(emissions * 100) / 100,
        percentage: Math.round((emissions / Math.max(totalEmissions, 1)) * 10000) / 100,
      }))
      .sort((a, b) => b.emissionsKgCO2e - a.emissionsKgCO2e);

    // Equivalencies
    const treesNeeded = Math.ceil(netEmissions / 22); // trees to offset annually
    const carKmEquivalent = Math.round(netEmissions / 0.171);
    const flightsLondon2NY = Math.round(netEmissions / (5570 * 0.195) * 100) / 100; // ~5570 km

    return {
      ok: true,
      result: {
        totalEmissionsKgCO2e: Math.round(totalEmissions * 100) / 100,
        totalEmissionsTonneCO2e: Math.round(totalEmissions / 10) / 100,
        totalOffsetsKgCO2e: Math.round(totalOffsets * 100) / 100,
        netEmissionsKgCO2e: Math.round(netEmissions * 100) / 100,
        offsetPercentage: totalEmissions > 0 ? Math.round((totalOffsets / totalEmissions) * 10000) / 100 : 0,
        carbonNeutral: netEmissions <= 0,
        scopeBreakdown: {
          scope1: { kgCO2e: Math.round(scopeTotals[1] * 100) / 100, percentage: Math.round((scopeTotals[1] / Math.max(totalEmissions, 1)) * 10000) / 100, label: "Direct emissions" },
          scope2: { kgCO2e: Math.round(scopeTotals[2] * 100) / 100, percentage: Math.round((scopeTotals[2] / Math.max(totalEmissions, 1)) * 10000) / 100, label: "Indirect energy emissions" },
          scope3: { kgCO2e: Math.round(scopeTotals[3] * 100) / 100, percentage: Math.round((scopeTotals[3] / Math.max(totalEmissions, 1)) * 10000) / 100, label: "Value chain emissions" },
        },
        categoryBreakdown,
        equivalencies: {
          treesNeededToOffset: treesNeeded,
          carKmEquivalent,
          londonToNewYorkFlights: flightsLondon2NY,
        },
        activities: processed,
        offsets: processedOffsets,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * biodiversityIndex
   * Compute biodiversity metrics: Shannon diversity, Simpson's index,
   * species richness, evenness, and rarefaction curves.
   * artifact.data.observations = [{ species, count }] or artifact.data.species = { speciesName: count }
   */
  registerLensAction("eco", "biodiversityIndex", (ctx, artifact, _params) => {
  try {
    // Accept either array or object format
    let speciesCounts = {};
    if (Array.isArray(artifact.data?.observations)) {
      for (const obs of artifact.data.observations) {
        const name = obs.species || obs.name || "unknown";
        // Fail-CLOSED: a poisoned Infinity/NaN/1e999 count is clamped to a
        // finite, non-negative integer so the diversity indices never go NaN.
        const c = finiteNum(obs.count, 1, { min: 0, integer: true });
        speciesCounts[name] = (speciesCounts[name] || 0) + c;
      }
    } else if (artifact.data?.species) {
      for (const [k, v] of Object.entries(artifact.data.species)) {
        speciesCounts[k] = finiteNum(v, 0, { min: 0, integer: true });
      }
    } else {
      return { ok: true, result: { message: "No species data provided." } };
    }

    const species = Object.keys(speciesCounts);
    const counts = Object.values(speciesCounts).map(Number);
    const S = species.length; // species richness
    const N = counts.reduce((s, c) => s + c, 0); // total individuals

    if (S === 0 || N === 0) {
      return { ok: true, result: { message: "No valid species data." } };
    }

    // Proportions
    const proportions = counts.map(c => c / N);

    // Shannon diversity index: H' = -sum(p_i * ln(p_i))
    const shannonH = -proportions.reduce((s, p) => {
      return p > 0 ? s + p * Math.log(p) : s;
    }, 0);

    // Maximum possible Shannon index
    const shannonMax = Math.log(S);

    // Shannon evenness (Pielou's J)
    const shannonEvenness = shannonMax > 0 ? shannonH / shannonMax : 0;

    // Simpson's index: D = sum(p_i^2)
    const simpsonsD = proportions.reduce((s, p) => s + p * p, 0);

    // Simpson's diversity (1 - D)
    const simpsonsDiversity = 1 - simpsonsD;

    // Simpson's reciprocal (1/D)
    const simpsonsReciprocal = simpsonsD > 0 ? 1 / simpsonsD : 0;

    // Berger-Parker dominance: d = N_max / N
    const maxCount = Math.max(...counts);
    const bergerParkerD = maxCount / N;

    // Margalef richness index: D_Mg = (S-1) / ln(N)
    const margalefIndex = Math.log(N) > 0 ? (S - 1) / Math.log(N) : 0;

    // Menhinick richness index: D_Mn = S / sqrt(N)
    const menhinickIndex = S / Math.sqrt(N);

    // Rarefaction curve: E(S_n) = S - sum(C(N-N_i, n)/C(N, n)) for various n
    // Using simplified computation
    function logCombination(a, b) {
      if (b > a || b < 0) return -Infinity;
      if (b === 0 || b === a) return 0;
      b = Math.min(b, a - b);
      let result = 0;
      for (let i = 0; i < b; i++) {
        result += Math.log(a - i) - Math.log(i + 1);
      }
      return result;
    }

    const rarefactionPoints = [];
    const sampleSizes = [];
    for (let k = 1; k <= 10; k++) {
      sampleSizes.push(Math.min(Math.round(N * k / 10), N));
    }
    // Add small sample sizes too
    for (const n of [1, 2, 5, 10, 20, 50]) {
      if (n < N && !sampleSizes.includes(n)) sampleSizes.push(n);
    }
    sampleSizes.sort((a, b) => a - b);

    for (const n of sampleSizes) {
      if (n > N) continue;
      const logCN = logCombination(N, n);
      let expectedS = S;
      for (const ni of counts) {
        const logCNn = logCombination(N - ni, n);
        if (logCNn > -Infinity) {
          expectedS -= Math.exp(logCNn - logCN);
        }
      }
      rarefactionPoints.push({
        sampleSize: n,
        expectedSpecies: Math.round(Math.max(0, expectedS) * 100) / 100,
      });
    }

    // Rank-abundance
    const ranked = species.map((name, i) => ({
      rank: 0,
      species: name,
      count: counts[i],
      proportion: Math.round(proportions[i] * 10000) / 10000,
    }))
      .sort((a, b) => b.count - a.count)
      .map((item, idx) => ({ ...item, rank: idx + 1 }));

    // Dominance classification
    const dominantSpecies = ranked.filter(r => r.proportion > 0.1);
    const rareSpecies = ranked.filter(r => r.count === 1); // singletons

    const r = (v) => Math.round(v * 10000) / 10000;

    return {
      ok: true,
      result: {
        speciesRichness: S,
        totalIndividuals: N,
        diversityIndices: {
          shannonH: r(shannonH),
          shannonHMax: r(shannonMax),
          shannonEvenness: r(shannonEvenness),
          simpsonsD: r(simpsonsD),
          simpsonsDiversity: r(simpsonsDiversity),
          simpsonsReciprocal: r(simpsonsReciprocal),
          bergerParkerDominance: r(bergerParkerD),
        },
        richnessIndices: {
          margalef: r(margalefIndex),
          menhinick: r(menhinickIndex),
        },
        diversityLabel: shannonH > 3 ? "very high" : shannonH > 2 ? "high" : shannonH > 1 ? "moderate" : "low",
        evennessLabel: shannonEvenness > 0.8 ? "very even" : shannonEvenness > 0.6 ? "moderately even" : shannonEvenness > 0.4 ? "moderately uneven" : "highly uneven",
        dominantSpecies: dominantSpecies.slice(0, 10),
        rareSpecies: { count: rareSpecies.length, singletonPercentage: r((rareSpecies.length / S) * 100) },
        rankAbundance: ranked.slice(0, 20),
        rarefactionCurve: rarefactionPoints,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * sustainabilityScore
   * Multi-criteria sustainability assessment across environmental, social,
   * and governance (ESG) pillars with weighted sub-indicators.
   * artifact.data.indicators = {
   *   environmental?: { emissions?, energyEfficiency?, wasteReduction?, waterUsage?, biodiversity? },
   *   social?: { laborPractices?, communityImpact?, healthSafety?, diversity?, humanRights? },
   *   governance?: { boardDiversity?, transparency?, ethics?, riskManagement?, compliance? }
   * }
   * Each indicator value: 0-100 score. params.weights (optional) to override pillar weights.
   */
  registerLensAction("eco", "sustainabilityScore", (ctx, artifact, params) => {
  try {
    const indicators = artifact.data?.indicators || {};
    const env = indicators.environmental || {};
    const soc = indicators.social || {};
    const gov = indicators.governance || {};

    // Default pillar weights (can be overridden)
    const weights = params.weights || { environmental: 0.4, social: 0.35, governance: 0.25 };

    // Sub-indicator definitions with default weights within each pillar
    const pillarDefs = {
      environmental: {
        indicators: {
          emissions: { weight: 0.25, value: env.emissions, label: "GHG Emissions Reduction" },
          energyEfficiency: { weight: 0.2, value: env.energyEfficiency, label: "Energy Efficiency" },
          wasteReduction: { weight: 0.2, value: env.wasteReduction, label: "Waste Reduction" },
          waterUsage: { weight: 0.2, value: env.waterUsage, label: "Water Management" },
          biodiversity: { weight: 0.15, value: env.biodiversity, label: "Biodiversity Impact" },
        },
      },
      social: {
        indicators: {
          laborPractices: { weight: 0.25, value: soc.laborPractices, label: "Labor Practices" },
          communityImpact: { weight: 0.2, value: soc.communityImpact, label: "Community Impact" },
          healthSafety: { weight: 0.2, value: soc.healthSafety, label: "Health & Safety" },
          diversity: { weight: 0.2, value: soc.diversity, label: "Diversity & Inclusion" },
          humanRights: { weight: 0.15, value: soc.humanRights, label: "Human Rights" },
        },
      },
      governance: {
        indicators: {
          boardDiversity: { weight: 0.2, value: gov.boardDiversity, label: "Board Diversity" },
          transparency: { weight: 0.25, value: gov.transparency, label: "Transparency & Reporting" },
          ethics: { weight: 0.2, value: gov.ethics, label: "Business Ethics" },
          riskManagement: { weight: 0.2, value: gov.riskManagement, label: "Risk Management" },
          compliance: { weight: 0.15, value: gov.compliance, label: "Regulatory Compliance" },
        },
      },
    };

    // Calculate pillar scores
    const pillarResults = {};
    let overallWeightedSum = 0;
    let overallWeightTotal = 0;

    for (const [pillarName, pillar] of Object.entries(pillarDefs)) {
      let pillarWeightedSum = 0;
      let pillarWeightTotal = 0;
      const subScores = [];
      const gaps = [];

      for (const [key, def] of Object.entries(pillar.indicators)) {
        const value = def.value;
        if (value != null && !isNaN(value)) {
          const clamped = Math.max(0, Math.min(100, Number(value)));
          pillarWeightedSum += clamped * def.weight;
          pillarWeightTotal += def.weight;
          subScores.push({
            indicator: key,
            label: def.label,
            score: clamped,
            weight: def.weight,
            rating: clamped >= 80 ? "excellent" : clamped >= 60 ? "good" : clamped >= 40 ? "fair" : clamped >= 20 ? "poor" : "critical",
          });
          if (clamped < 50) {
            gaps.push({ indicator: key, label: def.label, score: clamped, improvementPotential: 100 - clamped });
          }
        } else {
          subScores.push({
            indicator: key,
            label: def.label,
            score: null,
            weight: def.weight,
            rating: "not reported",
          });
        }
      }

      const pillarScore = pillarWeightTotal > 0 ? pillarWeightedSum / pillarWeightTotal : null;
      const pillarWeight = weights[pillarName] || 0.33;

      if (pillarScore !== null) {
        overallWeightedSum += pillarScore * pillarWeight;
        overallWeightTotal += pillarWeight;
      }

      // Data completeness
      const reported = subScores.filter(s => s.score !== null).length;
      const total = subScores.length;

      pillarResults[pillarName] = {
        score: pillarScore !== null ? Math.round(pillarScore * 100) / 100 : null,
        weight: pillarWeight,
        rating: pillarScore >= 80 ? "excellent" : pillarScore >= 60 ? "good" : pillarScore >= 40 ? "fair" : pillarScore >= 20 ? "poor" : pillarScore !== null ? "critical" : "insufficient data",
        dataCompleteness: Math.round((reported / total) * 100),
        subIndicators: subScores,
        gaps: gaps.sort((a, b) => a.score - b.score),
      };
    }

    const overallScore = overallWeightTotal > 0
      ? Math.round((overallWeightedSum / overallWeightTotal) * 100) / 100
      : null;

    // Identify top strengths and weaknesses
    const allSubScores = Object.values(pillarResults)
      .flatMap(p => p.subIndicators.filter(s => s.score !== null));
    allSubScores.sort((a, b) => b.score - a.score);

    const strengths = allSubScores.filter(s => s.score >= 70).slice(0, 5);
    const weaknesses = allSubScores.filter(s => s.score < 50).sort((a, b) => a.score - b.score).slice(0, 5);

    // Maturity level
    const maturityLevel =
      overallScore >= 80 ? "Leader" :
      overallScore >= 65 ? "Advanced" :
      overallScore >= 50 ? "Developing" :
      overallScore >= 30 ? "Emerging" :
      overallScore !== null ? "Lagging" : "Unrated";

    // Recommendations
    const recommendations = [];
    for (const weakness of weaknesses) {
      recommendations.push(`Improve ${weakness.label} (current score: ${weakness.score}/100)`);
    }
    for (const [pillarName, pillar] of Object.entries(pillarResults)) {
      if (pillar.dataCompleteness < 60) {
        recommendations.push(`Increase ${pillarName} reporting coverage (currently ${pillar.dataCompleteness}%)`);
      }
    }

    return {
      ok: true,
      result: {
        overallScore,
        maturityLevel,
        overallRating: overallScore >= 80 ? "excellent" : overallScore >= 60 ? "good" : overallScore >= 40 ? "fair" : overallScore >= 20 ? "poor" : overallScore !== null ? "critical" : "insufficient data",
        pillars: pillarResults,
        strengths,
        weaknesses,
        recommendations: recommendations.slice(0, 10),
        dataCompleteness: Math.round(
          Object.values(pillarResults).reduce((s, p) => s + p.dataCompleteness, 0) / 3
        ),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Parity-sprint macros: Joro / Klima / Windy / iNaturalist / NREL ───

  function getEcoState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.ecoLens) {
      STATE.ecoLens = {
        biodiversity: new Map(),  // userId → observation[]
        actionLog: new Map(),     // userId → entry[]
      };
    }
    // Lazily extend the substrate with parity-sprint Maps so older
    // persisted STATE blobs are forward-compatible.
    if (!STATE.ecoLens.footprintLog) STATE.ecoLens.footprintLog = new Map(); // userId → footprint[]
    if (!STATE.ecoLens.challenges) STATE.ecoLens.challenges = new Map();     // userId → enrollment[]
    if (!STATE.ecoLens.savedLocations) STATE.ecoLens.savedLocations = new Map(); // userId → location[]
    return STATE.ecoLens;
  }

  function ecoUserId(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function persistEco() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }

  /**
   * weather-forecast — Open-Meteo (no API key) current + daily + hourly + alerts.
   * params: { lat, lng }
   */
  registerLensAction("eco", "weather-forecast", async (_ctx, _artifact, params = {}) => {
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (!isFinite(lat) || !isFinite(lng)) return { ok: false, error: "lat, lng required" };
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,precipitation,relative_humidity_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max&forecast_days=7&timezone=auto`;
      const r = await safeFetchJson(url);
      const daily = (r.daily?.time || []).map((d, i) => ({
        date: d,
        high: r.daily.temperature_2m_max[i],
        low: r.daily.temperature_2m_min[i],
        precipitationMm: r.daily.precipitation_sum[i] || 0,
        precipitationProbability: r.daily.precipitation_probability_max?.[i] || 0,
        windSpeedMax: r.daily.wind_speed_10m_max[i],
        weatherCode: r.daily.weather_code[i],
        uvIndex: r.daily.uv_index_max?.[i] || 0,
      }));
      const hourly = (r.hourly?.time || []).slice(0, 24).map((t, i) => ({
        time: t,
        temperature: r.hourly.temperature_2m[i],
        precipitationMm: r.hourly.precipitation[i] || 0,
        humidity: r.hourly.relative_humidity_2m[i] || 0,
      }));
      return {
        ok: true,
        result: {
          current: {
            temperature: r.current.temperature_2m,
            feelsLike: r.current.apparent_temperature,
            humidity: r.current.relative_humidity_2m,
            windSpeed: r.current.wind_speed_10m,
            windDirection: r.current.wind_direction_10m,
            precipitationMm: r.current.precipitation || 0,
            weatherCode: r.current.weather_code,
            isDay: r.current.is_day === 1,
          },
          daily, hourly,
          location: { lat, lng },
          alerts: [],
        },
      };
    } catch (e) {
      // Per "everything must be real" directive: no synthetic week fallback.
      // Open-Meteo is the real source; surface the network error.
      return { ok: false, error: `open-meteo unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * aqi-current — Open-Meteo Air Quality (no API key) — PM2.5/PM10/O3/NO2/CO/SO2 + US AQI.
   */
  registerLensAction("eco", "aqi-current", async (_ctx, _artifact, params = {}) => {
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (!isFinite(lat) || !isFinite(lng)) return { ok: false, error: "lat, lng required" };
    try {
      const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone`;
      const r = await safeFetchJson(url);
      const cur = r.current || {};
      const aqi = Number(cur.us_aqi) || 0;
      const cat = categoriseAqi(aqi);
      return {
        ok: true,
        result: {
          aqi,
          pm25: Number(cur.pm2_5) || 0,
          pm10: Number(cur.pm10) || 0,
          o3: Number(cur.ozone) || 0,
          no2: Number(cur.nitrogen_dioxide) || 0,
          co: (Number(cur.carbon_monoxide) || 0) / 1000,
          so2: Number(cur.sulphur_dioxide) || 0,
          category: cat.key,
          recommendation: cat.recommendation,
          source: "Open-Meteo Air Quality",
          lat, lng,
        },
      };
    } catch (e) {
      // Per "everything must be real": Open-Meteo is the real source; a network
      // failure surfaces honestly rather than fabricating a plausible AQI. The
      // AQIPanel renders this as an error, not a silent fake reading.
      return { ok: false, error: `Open-Meteo air-quality unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * climate-actions-list — curated library of high-impact climate actions
   * (per Project Drawdown + IPCC AR6 mitigation), each as a slug with
   * effort 1-5 + kgCO2e saved per year + citation.
   */
  registerLensAction("eco", "climate-actions-list", (_ctx, _artifact, _params = {}) => {
    return { ok: true, result: { actions: CLIMATE_ACTIONS_LIBRARY, count: CLIMATE_ACTIONS_LIBRARY.length } };
  });

  /**
   * climate-actions-log — record one instance of an action.
   * params: { slug, kgCo2eSavedThisInstance? }
   */
  registerLensAction("eco", "climate-actions-log", (ctx, _artifact, params = {}) => {
    const state = getEcoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const slug = String(params.slug || "");
    if (!slug) return { ok: false, error: "slug required" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const action = CLIMATE_ACTIONS_LIBRARY.find(a => a.slug === slug);
    if (!action) return { ok: false, error: "unknown action slug" };
    const kgSaved = Number(params.kgCo2eSavedThisInstance) || (action.kgCo2eSavedPerYear / 52);
    if (!state.actionLog.has(userId)) state.actionLog.set(userId, []);
    const entry = {
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      slug, kgSaved, at: new Date().toISOString(),
    };
    state.actionLog.get(userId).push(entry);
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
    return { ok: true, result: { entry } };
  });

  /**
   * climate-actions-logged — list recent action log entries for the user.
   */
  registerLensAction("eco", "climate-actions-logged", (ctx, _artifact, params = {}) => {
    const state = getEcoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const sinceDays = Math.max(1, Math.min(365, Number(params.sinceDays) || 30));
    const cutoff = Date.now() - sinceDays * 86400000;
    const entries = (state.actionLog.get(userId) || []).filter(e => new Date(e.at).getTime() >= cutoff);
    const totalKgSaved = entries.reduce((s, e) => s + (e.kgSaved || 0), 0);
    return { ok: true, result: { entries, totalKgSaved, sinceDays } };
  });

  /**
   * species-identify — LLaVA vision identification of an organism photo.
   * params: { imageDataUrl } — accepts data URL or raw base64
   * Returns: { suggestions: [{ commonName, scientificName, confidence, taxonomicRank, kingdom }] }
   */
  registerLensAction("eco", "species-identify", async (_ctx, _artifact, params = {}) => {
    const dataUrl = String(params.imageDataUrl || "");
    if (!dataUrl) return { ok: false, error: "imageDataUrl required" };
    const imageB64 = dataUrl.startsWith("data:") ? dataUrl.split(",")[1] : dataUrl;
    if (!imageB64) return { ok: false, error: "could not decode image" };
    try {
      const { callVision } = await import("../lib/vision-inference.js");
      const prompt = `You are a biologist identifying organisms from photos. Look at this image and return JSON only — no prose, no markdown:
{"suggestions":[
  {"commonName":"...", "scientificName":"...", "confidence":0.85, "taxonomicRank":"species|genus|family|order|class|phylum|kingdom", "kingdom":"Plantae|Animalia|Fungi|Bacteria|Archaea|Protista"},
  ... up to 5 candidates ordered by confidence
]}
If unsure, fall back to coarser ranks. Always include at least one suggestion even if low confidence.`;
      const out = await callVision(imageB64, prompt, { temperature: 0.1, max_tokens: 512 });
      const text = String(out?.text || out?.content || out?.response || "").trim();
      const parsed = extractJson(text);
      const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions.slice(0, 5).map(s => ({
        commonName: String(s.commonName || s.common_name || "Unknown"),
        scientificName: String(s.scientificName || s.scientific_name || ""),
        confidence: clamp01(Number(s.confidence) || 0.5),
        taxonomicRank: String(s.taxonomicRank || s.taxonomic_rank || "species"),
        kingdom: s.kingdom ? String(s.kingdom) : undefined,
      })) : [];
      return { ok: true, result: { suggestions, source: "llava-vision", raw: text.slice(0, 200) } };
    } catch (e) {
      return {
        ok: true,
        result: {
          suggestions: [
            { commonName: "Vision brain unavailable", scientificName: "—", confidence: 0, taxonomicRank: "kingdom" },
          ],
          source: "fallback",
          error: e instanceof Error ? e.message : "vision call failed",
        },
      };
    }
  });

  /**
   * energy-estimate — Deterministic solar PV production estimate.
   * Uses a simplified PVWatts-like model: irradiance × system size × derate.
   * Defaults to a global solar resource of ~4.5 kWh/m²/day, modulated by
   * latitude (cosine of |lat-23.5|°), tilt match, and azimuth deviation.
   * params: { lat, lng, systemKw, tilt?, azimuth? }
   */
  registerLensAction("eco", "energy-estimate", (_ctx, _artifact, params = {}) => {
  try {
    // Fail-CLOSED: reject poisoned numerics (NaN/Infinity/1e308/-1 out of range)
    // outright instead of clamping onto a default and returning ok:true with a
    // bogus kWh estimate. Each supplied field must be finite + within bounds.
    if (params.lat != null) { const v = Number(params.lat); if (!Number.isFinite(v) || v < -90 || v > 90) return { ok: false, error: "invalid_lat" }; }
    if (params.lng != null) { const v = Number(params.lng); if (!Number.isFinite(v) || v < -180 || v > 180) return { ok: false, error: "invalid_lng" }; }
    if (params.systemKw != null) { const v = Number(params.systemKw); if (!Number.isFinite(v) || v <= 0 || v > 1e6) return { ok: false, error: "invalid_systemKw" }; }
    if (params.tilt != null) { const v = Number(params.tilt); if (!Number.isFinite(v) || v < 0 || v > 90) return { ok: false, error: "invalid_tilt" }; }
    if (params.azimuth != null) { const v = Number(params.azimuth); if (!Number.isFinite(v) || v < 0 || v > 360) return { ok: false, error: "invalid_azimuth" }; }
    // Every numeric is coerced to a finite value within physical
    // bounds, so a poisoned Infinity/NaN/1e999 never leaks into the kWh totals.
    const lat = finiteNum(params.lat, 0, { min: -90, max: 90 });
    const lng = finiteNum(params.lng, 0, { min: -180, max: 180 });
    const systemKw = finiteNum(params.systemKw, 5, { min: 0.1, max: 1e6 });
    const tilt = finiteNum(params.tilt, 30, { min: 0, max: 89 });
    const azimuth = params.azimuth != null ? finiteNum(params.azimuth, 180, { min: 0, max: 360 }) : 180;

    // Baseline daily insolation (kWh/m²/day) — NREL average for the US is
    // ~4.5; we modulate by absolute latitude (higher = lower) and seasonal
    // monthly factor.
    const baseGHI = 4.5;
    const absLat = Math.abs(lat);
    const latFactor = Math.cos((Math.PI / 180) * Math.max(0, absLat - 23.5)) * 0.5 + 0.6; // 0.6–1.1 range
    const optimalTilt = absLat;
    const tiltDeltaPenalty = 1 - 0.005 * Math.abs(tilt - optimalTilt);
    const azDeviation = Math.min(180, Math.abs(((lat >= 0 ? 180 : 0) - azimuth) % 360));
    const azPenalty = 1 - Math.min(0.4, (azDeviation / 180) * 0.5);
    const derate = 0.85; // system losses

    // Monthly distribution: simple sinusoidal seasonality keyed by hemisphere
    const monthlyKwh = [];
    for (let m = 0; m < 12; m++) {
      const seasonal = lat >= 0
        ? 0.85 + 0.35 * Math.cos((m - 6) * Math.PI / 6) // peak summer (Jun = m=5)
        : 0.85 + 0.35 * Math.cos((m - 0) * Math.PI / 6); // S-hemisphere offset
      const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];
      const kwh = baseGHI * latFactor * tiltDeltaPenalty * azPenalty * derate * seasonal * systemKw * daysInMonth;
      monthlyKwh.push(Math.max(0, kwh));
    }
    const annualKwh = monthlyKwh.reduce((s, k) => s + k, 0);
    const capacityFactor = annualKwh / (systemKw * 8760);
    const co2AvoidedKgPerYear = annualKwh * 0.4; // US avg grid 0.4 kgCO2/kWh

    return {
      ok: true,
      result: {
        systemKwp: systemKw,
        annualKwh: Math.round(annualKwh),
        monthlyKwh: monthlyKwh.map(v => Math.round(v)),
        co2AvoidedKgPerYear: Math.round(co2AvoidedKgPerYear),
        capacityFactor,
        source: "concord-pvmodel (NREL-derived constants, deterministic)",
        location: { lat, lng },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * biodiversity-log / list / delete — Personal life list of species observations.
   */
  registerLensAction("eco", "biodiversity-log", (ctx, _artifact, params = {}) => {
    const state = getEcoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const commonName = String(params.commonName || "").trim();
    const scientificName = String(params.scientificName || "").trim();
    if (!commonName) return { ok: false, error: "commonName required" };
    if (!state.biodiversity.has(userId)) state.biodiversity.set(userId, []);
    const entry = {
      id: `obs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      commonName, scientificName,
      observedAt: params.observedAt || new Date().toISOString(),
      lat: params.lat != null ? Number(params.lat) : undefined,
      lng: params.lng != null ? Number(params.lng) : undefined,
      imageDataUrl: params.imageDataUrl ? String(params.imageDataUrl).slice(0, 500_000) : undefined,
      notes: params.notes ? String(params.notes).slice(0, 1000) : undefined,
    };
    state.biodiversity.get(userId).push(entry);
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
    return { ok: true, result: { entry } };
  });

  registerLensAction("eco", "biodiversity-list", (ctx, _artifact, params = {}) => {
    const state = getEcoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const limit = Math.min(200, Math.max(1, Number(params.limit) || 50));
    const all = state.biodiversity.get(userId) || [];
    const observations = [...all].reverse().slice(0, limit);
    return { ok: true, result: { observations, total: all.length } };
  });

  registerLensAction("eco", "biodiversity-delete", (ctx, _artifact, params = {}) => {
    const state = getEcoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const id = String(params.id || "");
    const list = state.biodiversity.get(userId) || [];
    const idx = list.findIndex(o => o.id === id);
    if (idx < 0) return { ok: false, error: "observation not found" };
    list.splice(idx, 1);
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
    return { ok: true, result: { id, deleted: true } };
  });

  // ─── Feature-parity backlog: observation feed, footprint trend, ───────────
  // ─── challenges/streaks, geotagged map, ID alternatives, eco alerts ───────

  /**
   * observation-feed — community sightings near a point, iNaturalist-style.
   * Pulls real verifiable records from the GBIF occurrence API (free, keyless).
   * params: { lat, lng, radiusKm?, limit?, taxonName? }
   * Returns observations with coordinates suitable for a MapView.
   */
  registerLensAction("eco", "observation-feed", async (_ctx, _artifact, params = {}) => {
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (!isFinite(lat) || !isFinite(lng)) return { ok: false, error: "lat, lng required" };
    const radiusKm = Math.min(200, Math.max(1, Number(params.radiusKm) || 25));
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 50));
    const taxonName = String(params.taxonName || "").trim();
    // Convert radius to a lat/lng bounding box (1° lat ≈ 111 km).
    const dLat = radiusKm / 111;
    const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);
    const minLat = Math.max(-90, lat - dLat), maxLat = Math.min(90, lat + dLat);
    const minLng = Math.max(-180, lng - dLng), maxLng = Math.min(180, lng + dLng);
    try {
      let taxonKey = null;
      let resolvedName = taxonName || null;
      if (taxonName) {
        const match = await safeFetchJson(
          `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(taxonName)}`,
        );
        taxonKey = match.usageKey || match.acceptedUsageKey || null;
        resolvedName = match.scientificName || taxonName;
      }
      const geom = `POLYGON((${minLng}+${minLat},${maxLng}+${minLat},${maxLng}+${maxLat},${minLng}+${maxLat},${minLng}+${minLat}))`;
      let url = `https://api.gbif.org/v1/occurrence/search?geometry=${geom}&hasCoordinate=true&limit=${limit}`;
      if (taxonKey) url += `&taxonKey=${taxonKey}`;
      const data = await safeFetchJson(url);
      const observations = (data.results || [])
        .filter(o => isFinite(o.decimalLatitude) && isFinite(o.decimalLongitude))
        .map(o => ({
          key: String(o.key),
          commonName: o.vernacularName || o.genus || o.scientificName || "Unknown organism",
          scientificName: o.scientificName || o.acceptedScientificName || "",
          kingdom: o.kingdom || null,
          lat: o.decimalLatitude,
          lng: o.decimalLongitude,
          country: o.country || null,
          observedAt: o.eventDate || null,
          basisOfRecord: o.basisOfRecord || null,
          datasetName: o.datasetName || null,
        }));
      return {
        ok: true,
        result: {
          observations,
          total: data.count || observations.length,
          center: { lat, lng },
          radiusKm,
          taxonFilter: resolvedName,
          source: "GBIF (Global Biodiversity Information Facility)",
        },
      };
    } catch (e) {
      return { ok: false, error: `GBIF unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * footprint-record — store one carbon-footprint snapshot for trend tracking.
   * params: { totalKgCO2e, netKgCO2e?, categoryBreakdown?, label? }
   */
  registerLensAction("eco", "footprint-record", (ctx, _artifact, params = {}) => {
  try {
    const state = getEcoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const total = Number(params.totalKgCO2e);
    if (!isFinite(total) || total < 0) return { ok: false, error: "totalKgCO2e (>=0) required" };
    const userId = ecoUserId(ctx);
    if (!state.footprintLog.has(userId)) state.footprintLog.set(userId, []);
    const net = isFinite(Number(params.netKgCO2e)) ? Number(params.netKgCO2e) : total;
    const entry = {
      id: `fp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      totalKgCO2e: Math.round(total * 100) / 100,
      netKgCO2e: Math.round(net * 100) / 100,
      categoryBreakdown: Array.isArray(params.categoryBreakdown)
        ? params.categoryBreakdown.slice(0, 20).map(c => ({
            category: String(c.category || "other"),
            emissionsKgCO2e: Number(c.emissionsKgCO2e) || 0,
          }))
        : [],
      label: params.label ? String(params.label).slice(0, 120) : "",
      at: new Date().toISOString(),
    };
    state.footprintLog.get(userId).push(entry);
    persistEco();
    return { ok: true, result: { entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * footprint-history — chronological footprint snapshots + trend analysis.
   * params: { sinceDays? }
   */
  registerLensAction("eco", "footprint-history", (ctx, _artifact, params = {}) => {
  try {
    const state = getEcoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ecoUserId(ctx);
    const sinceDays = Math.max(1, Math.min(1095, Number(params.sinceDays) || 365));
    const cutoff = Date.now() - sinceDays * 86400000;
    const all = (state.footprintLog.get(userId) || [])
      .filter(e => new Date(e.at).getTime() >= cutoff)
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    let trend = "none", changePct = 0, deltaKg = 0;
    if (all.length >= 2) {
      const first = all[0].netKgCO2e;
      const last = all[all.length - 1].netKgCO2e;
      deltaKg = Math.round((last - first) * 100) / 100;
      changePct = first > 0 ? Math.round(((last - first) / first) * 10000) / 100 : 0;
      trend = deltaKg < -0.5 ? "improving" : deltaKg > 0.5 ? "worsening" : "stable";
    }
    const avg = all.length
      ? Math.round((all.reduce((s, e) => s + e.netKgCO2e, 0) / all.length) * 100) / 100
      : 0;
    const best = all.length ? all.reduce((m, e) => (e.netKgCO2e < m.netKgCO2e ? e : m)) : null;
    return {
      ok: true,
      result: {
        entries: all,
        count: all.length,
        trend,
        changePct,
        deltaKg,
        averageNetKgCO2e: avg,
        bestEntry: best,
        sinceDays,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * footprint-delete — remove one footprint snapshot.
   */
  registerLensAction("eco", "footprint-delete", (ctx, _artifact, params = {}) => {
    const state = getEcoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ecoUserId(ctx);
    const id = String(params.id || "");
    const list = state.footprintLog.get(userId) || [];
    const idx = list.findIndex(e => e.id === id);
    if (idx < 0) return { ok: false, error: "snapshot not found" };
    list.splice(idx, 1);
    persistEco();
    return { ok: true, result: { id, deleted: true } };
  });

  /**
   * challenges-catalog — JouleBug-style gamified sustainability habits.
   * Each is a recurring habit with a cadence, points, and an estimated
   * kgCO2e impact. Curated from the same Drawdown/EPA references as the
   * climate-action library — no fabricated values.
   */
  registerLensAction("eco", "challenges-catalog", (_ctx, _artifact, _params = {}) => {
    return { ok: true, result: { challenges: ECO_CHALLENGES_LIBRARY, count: ECO_CHALLENGES_LIBRARY.length } };
  });

  /**
   * challenges-join — enroll the user in a sustainability challenge.
   * params: { slug }
   */
  registerLensAction("eco", "challenges-join", (ctx, _artifact, params = {}) => {
    const state = getEcoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const slug = String(params.slug || "");
    const challenge = ECO_CHALLENGES_LIBRARY.find(c => c.slug === slug);
    if (!challenge) return { ok: false, error: "unknown challenge slug" };
    const userId = ecoUserId(ctx);
    if (!state.challenges.has(userId)) state.challenges.set(userId, []);
    const list = state.challenges.get(userId);
    if (list.some(e => e.slug === slug)) return { ok: false, error: "already enrolled" };
    const enrollment = {
      slug,
      joinedAt: new Date().toISOString(),
      checkIns: [],          // ISO date strings
      currentStreak: 0,
      longestStreak: 0,
      totalCheckIns: 0,
      totalPoints: 0,
      totalKgSaved: 0,
    };
    list.push(enrollment);
    persistEco();
    return { ok: true, result: { enrollment, challenge } };
  });

  /**
   * challenges-checkin — record a completion for a joined challenge, updating
   * the streak. One check-in per UTC day is counted.
   * params: { slug }
   */
  registerLensAction("eco", "challenges-checkin", (ctx, _artifact, params = {}) => {
  try {
    const state = getEcoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const slug = String(params.slug || "");
    const challenge = ECO_CHALLENGES_LIBRARY.find(c => c.slug === slug);
    if (!challenge) return { ok: false, error: "unknown challenge slug" };
    const userId = ecoUserId(ctx);
    const list = state.challenges.get(userId) || [];
    const enrollment = list.find(e => e.slug === slug);
    if (!enrollment) return { ok: false, error: "not enrolled in this challenge" };
    const today = new Date().toISOString().slice(0, 10);
    if (enrollment.checkIns.includes(today)) {
      return { ok: false, error: "already checked in today" };
    }
    enrollment.checkIns.push(today);
    enrollment.checkIns.sort();
    // Recompute streaks from the sorted unique date list.
    let cur = 0, longest = 0, prev = null;
    for (const d of enrollment.checkIns) {
      if (prev) {
        const gap = (new Date(d).getTime() - new Date(prev).getTime()) / 86400000;
        cur = gap === 1 ? cur + 1 : 1;
      } else {
        cur = 1;
      }
      longest = Math.max(longest, cur);
      prev = d;
    }
    // currentStreak only counts if the latest check-in is today or yesterday.
    const lastDate = enrollment.checkIns[enrollment.checkIns.length - 1];
    const daysSinceLast = (new Date(today).getTime() - new Date(lastDate).getTime()) / 86400000;
    enrollment.currentStreak = daysSinceLast <= 1 ? cur : 0;
    enrollment.longestStreak = longest;
    enrollment.totalCheckIns = enrollment.checkIns.length;
    enrollment.totalPoints = enrollment.totalCheckIns * challenge.points;
    enrollment.totalKgSaved =
      Math.round(enrollment.totalCheckIns * challenge.kgCo2eSavedPerCheckIn * 100) / 100;
    persistEco();
    return { ok: true, result: { enrollment, challenge, checkedInOn: today } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * challenges-mine — list the user's enrollments with progress + aggregate
   * gamification stats (total points, streaks).
   */
  registerLensAction("eco", "challenges-mine", (ctx, _artifact, _params = {}) => {
    const state = getEcoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ecoUserId(ctx);
    const list = state.challenges.get(userId) || [];
    const enrollments = list.map(e => {
      const challenge = ECO_CHALLENGES_LIBRARY.find(c => c.slug === e.slug) || null;
      return { ...e, challenge };
    });
    const totalPoints = enrollments.reduce((s, e) => s + (e.totalPoints || 0), 0);
    const totalKgSaved = Math.round(enrollments.reduce((s, e) => s + (e.totalKgSaved || 0), 0) * 100) / 100;
    const bestStreak = enrollments.reduce((m, e) => Math.max(m, e.longestStreak || 0), 0);
    return {
      ok: true,
      result: { enrollments, totalPoints, totalKgSaved, bestStreak, activeCount: enrollments.length },
    };
  });

  /**
   * challenges-leave — drop an enrollment.
   */
  registerLensAction("eco", "challenges-leave", (ctx, _artifact, params = {}) => {
    const state = getEcoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ecoUserId(ctx);
    const slug = String(params.slug || "");
    const list = state.challenges.get(userId) || [];
    const idx = list.findIndex(e => e.slug === slug);
    if (idx < 0) return { ok: false, error: "not enrolled" };
    list.splice(idx, 1);
    persistEco();
    return { ok: true, result: { slug, left: true } };
  });

  /**
   * species-suggest — confidence-ranked species candidates with suggested
   * alternatives. Resolves a typed-or-identified name against the GBIF
   * taxonomy backbone (free, keyless) and returns the matched taxon plus
   * fuzzy-search alternatives, each with a real GBIF confidence score.
   * params: { name }
   */
  registerLensAction("eco", "species-suggest", async (_ctx, _artifact, params = {}) => {
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (name.length > 200) return { ok: false, error: "name too long" };
    try {
      const match = await safeFetchJson(
        `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}&verbose=true`,
      );
      const primary = match.usageKey
        ? {
            commonName: match.canonicalName || name,
            scientificName: match.scientificName || match.canonicalName || name,
            rank: (match.rank || "").toLowerCase() || "unknown",
            kingdom: match.kingdom || null,
            family: match.family || null,
            confidence: clamp01((Number(match.confidence) || 0) / 100),
            matchType: match.matchType || "NONE",
            taxonKey: match.usageKey,
          }
        : null;
      // verbose=true returns near-miss alternatives the backbone considered.
      const alternatives = Array.isArray(match.alternatives)
        ? match.alternatives.slice(0, 8).map(a => ({
            commonName: a.canonicalName || a.scientificName || "Unknown",
            scientificName: a.scientificName || a.canonicalName || "",
            rank: (a.rank || "").toLowerCase() || "unknown",
            kingdom: a.kingdom || null,
            family: a.family || null,
            confidence: clamp01((Number(a.confidence) || 0) / 100),
            matchType: a.matchType || "FUZZY",
            taxonKey: a.usageKey || null,
          }))
        : [];
      // If the backbone gave no alternatives, fall back to a fuzzy
      // name search so the user still sees real candidate species.
      let extra = [];
      if (alternatives.length === 0) {
        const search = await safeFetchJson(
          `https://api.gbif.org/v1/species/search?q=${encodeURIComponent(name)}&rank=SPECIES&limit=6`,
        );
        extra = (search.results || [])
          .filter(r => r.key !== match.usageKey)
          .slice(0, 6)
          .map(r => ({
            commonName: r.canonicalName || r.scientificName || "Unknown",
            scientificName: r.scientificName || r.canonicalName || "",
            rank: (r.rank || "").toLowerCase() || "species",
            kingdom: r.kingdom || null,
            family: r.family || null,
            confidence: 0,
            matchType: "SEARCH",
            taxonKey: r.key || null,
          }));
      }
      return {
        ok: true,
        result: {
          query: name,
          primary,
          alternatives: alternatives.length ? alternatives : extra,
          source: "GBIF taxonomic backbone",
        },
      };
    } catch (e) {
      return { ok: false, error: `GBIF unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * locations-save / locations-list / locations-delete — saved places for
   * which the user wants recurring environmental alerts.
   */
  registerLensAction("eco", "locations-save", (ctx, _artifact, params = {}) => {
    const state = getEcoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (!isFinite(lat) || !isFinite(lng)) return { ok: false, error: "lat, lng required" };
    const label = String(params.label || "").trim();
    if (!label) return { ok: false, error: "label required" };
    const userId = ecoUserId(ctx);
    if (!state.savedLocations.has(userId)) state.savedLocations.set(userId, []);
    const list = state.savedLocations.get(userId);
    if (list.length >= 25) return { ok: false, error: "saved-location limit reached (25)" };
    const entry = {
      id: `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label: label.slice(0, 80),
      lat, lng,
      savedAt: new Date().toISOString(),
    };
    list.push(entry);
    persistEco();
    return { ok: true, result: { entry } };
  });

  registerLensAction("eco", "locations-list", (ctx, _artifact, _params = {}) => {
    const state = getEcoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ecoUserId(ctx);
    const locations = [...(state.savedLocations.get(userId) || [])];
    return { ok: true, result: { locations, count: locations.length } };
  });

  registerLensAction("eco", "locations-delete", (ctx, _artifact, params = {}) => {
    const state = getEcoState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ecoUserId(ctx);
    const id = String(params.id || "");
    const list = state.savedLocations.get(userId) || [];
    const idx = list.findIndex(l => l.id === id);
    if (idx < 0) return { ok: false, error: "location not found" };
    list.splice(idx, 1);
    persistEco();
    return { ok: true, result: { id, deleted: true } };
  });

  /**
   * environmental-alerts — composite air-quality / pollen / UV alert for a
   * point, derived from real live data. AQI + pollen + UV come from the
   * Open-Meteo Air-Quality + Forecast APIs (free, keyless). Each reading is
   * graded against published health thresholds; only readings that cross a
   * caution threshold become alerts.
   * params: { lat, lng, label? }
   */
  registerLensAction("eco", "environmental-alerts", async (_ctx, _artifact, params = {}) => {
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    if (!isFinite(lat) || !isFinite(lng)) return { ok: false, error: "lat, lng required" };
    const label = params.label ? String(params.label).slice(0, 80) : null;
    try {
      const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=us_aqi,pm2_5,pm10,ozone&hourly=alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen&forecast_days=1`;
      const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=uv_index_max&forecast_days=1&timezone=auto`;
      const [aq, wx] = await Promise.all([safeFetchJson(aqUrl), safeFetchJson(wxUrl)]);
      const cur = aq.current || {};
      const aqi = Number(cur.us_aqi) || 0;
      const uv = Number(wx.daily?.uv_index_max?.[0]) || 0;
      // Peak pollen across all tracked species in the next 24h (grains/m³).
      const pollenSeries = aq.hourly || {};
      const pollenFields = ["alder_pollen", "birch_pollen", "grass_pollen", "mugwort_pollen", "olive_pollen", "ragweed_pollen"];
      let peakPollen = 0, peakPollenType = null;
      for (const f of pollenFields) {
        const arr = pollenSeries[f] || [];
        for (const v of arr) {
          const n = Number(v) || 0;
          if (n > peakPollen) { peakPollen = n; peakPollenType = f.replace("_pollen", ""); }
        }
      }
      const alerts = [];
      // AQI thresholds (US EPA AQI scale).
      if (aqi > 100) {
        const cat = categoriseAqi(aqi);
        alerts.push({
          kind: "air_quality", severity: aqi > 200 ? "high" : aqi > 150 ? "moderate" : "low",
          value: aqi, unit: "US AQI", category: cat.key, message: cat.recommendation,
        });
      }
      // UV thresholds (WHO UV index).
      if (uv >= 6) {
        alerts.push({
          kind: "uv", severity: uv >= 11 ? "high" : uv >= 8 ? "moderate" : "low",
          value: Math.round(uv * 10) / 10, unit: "UV index",
          category: uv >= 11 ? "extreme" : uv >= 8 ? "very-high" : "high",
          message: uv >= 8
            ? "Very high UV. Avoid sun 10am-4pm; SPF 30+, hat, and shade essential."
            : "High UV. Apply sunscreen and seek shade during midday hours.",
        });
      }
      // Pollen thresholds (grains/m³ — common allergy-forecast bands).
      if (peakPollen >= 20) {
        alerts.push({
          kind: "pollen", severity: peakPollen >= 90 ? "high" : peakPollen >= 50 ? "moderate" : "low",
          value: Math.round(peakPollen), unit: "grains/m³",
          category: peakPollen >= 90 ? "very-high" : peakPollen >= 50 ? "high" : "moderate",
          pollenType: peakPollenType,
          message: `Elevated ${peakPollenType || "pollen"} levels. Allergy sufferers should limit outdoor time and keep windows closed.`,
        });
      }
      return {
        ok: true,
        result: {
          location: { lat, lng, label },
          readings: {
            aqi, pm25: Number(cur.pm2_5) || 0, pm10: Number(cur.pm10) || 0,
            ozone: Number(cur.ozone) || 0, uvIndexMax: Math.round(uv * 10) / 10,
            peakPollen: Math.round(peakPollen), peakPollenType,
          },
          alerts,
          alertCount: alerts.length,
          allClear: alerts.length === 0,
          source: "Open-Meteo Air Quality + Forecast",
          checkedAt: new Date().toISOString(),
        },
      };
    } catch (e) {
      return { ok: false, error: `Open-Meteo unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}

// ─── helpers ─────────────────────────────────────────────────────────────

async function safeFetchJson(url) {
  if (typeof fetch !== "function") throw new Error("fetch unavailable");
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { "user-agent": "ConcordEcoLens/1.0" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function categoriseAqi(aqi) {
  if (aqi <= 50) return { key: "good", recommendation: "Air quality is good. Outdoor activities encouraged." };
  if (aqi <= 100) return { key: "moderate", recommendation: "Acceptable. Unusually sensitive people should consider reducing prolonged outdoor exertion." };
  if (aqi <= 150) return { key: "sensitive", recommendation: "People with lung/heart conditions, older adults, and children should reduce prolonged outdoor exertion." };
  if (aqi <= 200) return { key: "unhealthy", recommendation: "Everyone may begin to experience health effects; sensitive groups more serious." };
  if (aqi <= 300) return { key: "very-unhealthy", recommendation: "Health alert: everyone may experience more serious health effects. Limit outdoor activity." };
  return { key: "hazardous", recommendation: "Health warning of emergency conditions: the entire population is more likely to be affected. Stay indoors." };
}

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

// finiteNum — the fail-CLOSED numeric coercion every eco calc routes user
// numbers through. parseFloat/Number admit Infinity (from "1e999") and NaN
// (from "not-a-number") silently; this rejects both, falls back to `fallback`,
// then clamps into [min, max]. With `integer:true` the result is floored.
// Guarantees a finite return for ALL inputs so no calc can leak Infinity/NaN.
function finiteNum(v, fallback = 0, { min = -Infinity, max = Infinity, integer = false } = {}) {
  let n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) n = fallback;
  if (n < min) n = min;
  if (n > max) n = max;
  if (integer) n = Math.floor(n);
  return n;
}

function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(body.slice(first, last + 1)); } catch { return null; }
}

const CLIMATE_ACTIONS_LIBRARY = [
  // Transport
  { slug: "bike-commute-week", title: "Bike to work for a week (vs car)", category: "transport", effort: 3, kgCo2eSavedPerYear: 380, description: "Replacing a 10 km daily round-trip car commute with a bike for a year saves ~380 kgCO₂e.", citation: "EPA emission factor (passenger car 171 gCO₂e/km)" },
  { slug: "skip-flight-domestic", title: "Skip one domestic flight (replace w/ train)", category: "transport", effort: 4, kgCo2eSavedPerYear: 250, description: "A typical 1000-km domestic flight emits ~250 kgCO₂e per passenger. Train averages ~40 kg.", citation: "DEFRA 2024 transport conversion factors" },
  { slug: "public-transit-month", title: "Use public transit for a month", category: "transport", effort: 2, kgCo2eSavedPerYear: 200, description: "Replacing car commute with bus/train for a month saves ~200 kg over a year if continued.", citation: "EPA fast-facts" },
  { slug: "ev-switch", title: "Switch primary car to EV", category: "transport", effort: 5, kgCo2eSavedPerYear: 2700, description: "Average ICE → EV switch saves ~2.7 tCO₂e/year on a US grid mix.", citation: "Carbon Brief 2024 EV lifecycle study" },

  // Food
  { slug: "veggie-day", title: "One veggie day per week", category: "food", effort: 2, kgCo2eSavedPerYear: 120, description: "Swapping one beef-based meal for plant-based weekly saves ~120 kgCO₂e/year.", citation: "Poore & Nemecek (Science 2018)" },
  { slug: "no-beef-month", title: "Cut beef for a month", category: "food", effort: 4, kgCo2eSavedPerYear: 540, description: "Beef is 27 kgCO₂e/kg; cutting it for 30 days saves ~540 kg if you'd normally eat 2 kg/week.", citation: "Poore & Nemecek (2018)" },
  { slug: "compost-organics", title: "Compost food waste", category: "food", effort: 2, kgCo2eSavedPerYear: 220, description: "Diverting ~150 kg/yr of food waste from landfill prevents ~220 kgCO₂e of methane.", citation: "EPA WARM model" },
  { slug: "buy-local-seasonal", title: "Shop seasonal & local produce", category: "food", effort: 1, kgCo2eSavedPerYear: 90, description: "Reduces shipping + cold-storage emissions by ~90 kg/year for a household of 2.", citation: "Drawdown #3" },

  // Home / energy
  { slug: "led-retrofit", title: "Retrofit all home lights to LED", category: "home", effort: 2, kgCo2eSavedPerYear: 300, description: "LEDs use 75% less energy; an average household saves ~300 kg CO₂e/year.", citation: "DOE Energy Saver" },
  { slug: "smart-thermostat", title: "Install a smart thermostat", category: "home", effort: 2, kgCo2eSavedPerYear: 470, description: "Programmable + smart thermostats cut HVAC use ~10–15% (~470 kgCO₂e/year US avg).", citation: "Nest energy savings study" },
  { slug: "lower-thermostat-2c", title: "Lower thermostat 2°C in winter", category: "home", effort: 1, kgCo2eSavedPerYear: 350, description: "Each 1°C reduction trims ~7% off heating use; 2°C ≈ ~350 kgCO₂e in a typical home.", citation: "Carbon Trust" },
  { slug: "cold-wash-laundry", title: "Wash laundry in cold water", category: "home", effort: 1, kgCo2eSavedPerYear: 100, description: "Hot water heating dominates a wash cycle. ~100 kgCO₂e saved per household/year.", citation: "Cold Water Saves" },
  { slug: "rooftop-solar", title: "Install rooftop solar", category: "energy", effort: 5, kgCo2eSavedPerYear: 3200, description: "Average 8 kW residential system offsets ~3.2 tCO₂e/year against the US grid mix.", citation: "NREL PVWatts" },
  { slug: "switch-renewable-electricity", title: "Switch to renewable electricity plan", category: "energy", effort: 1, kgCo2eSavedPerYear: 1500, description: "Average US household uses ~10,500 kWh/yr; switching to 100% renewable saves ~1.5 tCO₂e.", citation: "EPA Green Power Partnership" },

  // Shopping / consumer
  { slug: "buy-secondhand", title: "Buy secondhand vs new", category: "shopping", effort: 2, kgCo2eSavedPerYear: 180, description: "Cutting 4 new clothing items/month for secondhand saves ~180 kg embodied emissions.", citation: "thredUP Resale Report 2024" },
  { slug: "repair-vs-replace", title: "Repair appliances vs replace", category: "shopping", effort: 3, kgCo2eSavedPerYear: 240, description: "Repairing a fridge instead of replacing avoids ~240 kg manufacturing emissions.", citation: "Right to Repair coalition" },
  { slug: "no-fast-fashion", title: "Cut fast fashion purchases", category: "shopping", effort: 2, kgCo2eSavedPerYear: 200, description: "Average wardrobe replacement is ~30 items/year × 5-10 kgCO₂e per garment.", citation: "Quantis fashion LCA" },

  // Advocacy
  { slug: "contact-representative", title: "Contact representative on climate bill", category: "advocacy", effort: 1, kgCo2eSavedPerYear: 0, description: "Symbolic per-action carbon impact ~0; structural impact much larger via policy.", citation: "Citizens' Climate Lobby" },
  { slug: "switch-bank-fossil", title: "Move bank to a fossil-free option", category: "advocacy", effort: 3, kgCo2eSavedPerYear: 2000, description: "Average US bank account funds ~2 tCO₂e of fossil lending per $1k held; switching diverts that.", citation: "Bank.Green / Rainforest Action Network" },
  { slug: "join-clean-energy-coop", title: "Join a community solar co-op", category: "advocacy", effort: 3, kgCo2eSavedPerYear: 1200, description: "Community solar shares offset grid electricity at scale; ~1.2 tCO₂e/share/year.", citation: "DOE Community Solar program" },
];

// JouleBug-style gamified recurring habits. Each check-in is one completion;
// kgCo2eSavedPerCheckIn is derived from the same lifecycle research as the
// climate-action library — never a fabricated figure.
const ECO_CHALLENGES_LIBRARY = [
  { slug: "meatless-monday", title: "Meatless Monday", category: "food", cadence: "weekly", points: 25, kgCo2eSavedPerCheckIn: 2.3, description: "Swap one meat-based day for plant-based meals. Beef is ~27 kgCO₂e/kg; a plant day saves ~2.3 kg.", citation: "Poore & Nemecek (Science 2018)" },
  { slug: "bring-your-cup", title: "Bring your own cup", category: "waste", cadence: "daily", points: 10, kgCo2eSavedPerCheckIn: 0.06, description: "Skip a single-use cup. Each disposable cup carries ~0.06 kgCO₂e embodied + waste emissions.", citation: "Carbon Trust packaging LCA" },
  { slug: "car-free-day", title: "Car-free day", category: "transport", cadence: "weekly", points: 30, kgCo2eSavedPerCheckIn: 3.4, description: "Walk, cycle, or take transit instead of driving. Avoids ~3.4 kg for a typical 20 km day.", citation: "EPA passenger-car emission factor" },
  { slug: "cold-wash", title: "Cold-water wash", category: "home", cadence: "weekly", points: 15, kgCo2eSavedPerCheckIn: 0.9, description: "Run laundry on cold. Water heating dominates a wash cycle — ~0.9 kg saved per load switched.", citation: "Cold Water Saves / AHAM" },
  { slug: "zero-food-waste", title: "Zero food waste day", category: "food", cadence: "daily", points: 15, kgCo2eSavedPerCheckIn: 0.5, description: "Finish or compost everything. The avg person wastes ~0.5 kgCO₂e of food per day.", citation: "FAO food-loss report" },
  { slug: "unplug-vampires", title: "Unplug standby devices", category: "home", cadence: "weekly", points: 10, kgCo2eSavedPerCheckIn: 0.4, description: "Cut phantom load from chargers and electronics. Standby is ~5-10% of home electricity.", citation: "DOE Energy Saver" },
  { slug: "refill-not-landfill", title: "Refill, don't landfill", category: "waste", cadence: "weekly", points: 12, kgCo2eSavedPerCheckIn: 0.3, description: "Choose refillable containers over single-use packaging on one shopping trip.", citation: "EPA WARM model" },
  { slug: "transit-commute", title: "Public-transit commute", category: "transport", cadence: "daily", points: 20, kgCo2eSavedPerCheckIn: 1.7, description: "Take the bus or train instead of driving to work. ~1.7 kg saved per round-trip.", citation: "EPA fast-facts" },
  { slug: "line-dry-laundry", title: "Line-dry laundry", category: "home", cadence: "weekly", points: 12, kgCo2eSavedPerCheckIn: 1.4, description: "Skip the tumble dryer. A dryer cycle is ~1.4 kgCO₂e on an average grid.", citation: "DOE appliance energy data" },
  { slug: "local-produce-shop", title: "Shop local & seasonal", category: "food", cadence: "weekly", points: 15, kgCo2eSavedPerCheckIn: 0.8, description: "Buy seasonal produce from local growers, cutting transport and cold-storage emissions.", citation: "Drawdown #3 (regional food)" },
];

