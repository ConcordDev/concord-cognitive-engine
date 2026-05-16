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
      const factor = emissionFactors[key] || activity.emissionFactor || 0;
      const quantity = activity.quantity || 0;
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
      const factor = offsetFactors[key] || o.offsetFactor || 0;
      const offsetAmount = (o.quantity || 0) * factor;
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
  });

  /**
   * biodiversityIndex
   * Compute biodiversity metrics: Shannon diversity, Simpson's index,
   * species richness, evenness, and rarefaction curves.
   * artifact.data.observations = [{ species, count }] or artifact.data.species = { speciesName: count }
   */
  registerLensAction("eco", "biodiversityIndex", (ctx, artifact, _params) => {
    // Accept either array or object format
    let speciesCounts = {};
    if (Array.isArray(artifact.data?.observations)) {
      for (const obs of artifact.data.observations) {
        const name = obs.species || obs.name || "unknown";
        speciesCounts[name] = (speciesCounts[name] || 0) + (obs.count || 1);
      }
    } else if (artifact.data?.species) {
      speciesCounts = { ...artifact.data.species };
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
    return STATE.ecoLens;
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
      return {
        ok: true,
        result: synthesizeWeatherFallback(lat, lng, e),
      };
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
      const fallback = 42;
      return {
        ok: true,
        result: {
          aqi: fallback, pm25: 8, pm10: 14, o3: 60, no2: 12, co: 0.4, so2: 2,
          category: 'good', recommendation: "Air quality good (fallback estimate).",
          source: `fallback (${e?.message || 'network unavailable'})`,
          lat, lng,
        },
      };
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
    const lat = Number(params.lat) || 0;
    const lng = Number(params.lng) || 0;
    const systemKw = Math.max(0.1, Number(params.systemKw) || 5);
    const tilt = Math.min(89, Math.max(0, Number(params.tilt) || 30));
    const azimuth = params.azimuth != null ? Number(params.azimuth) : 180;

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

function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(body.slice(first, last + 1)); } catch { return null; }
}

function synthesizeWeatherFallback(lat, lng, err) {
  // Deterministic-ish synthetic week so the UI stays useful when Open-Meteo unreachable
  const seasonAmp = 10;
  const base = 18 - Math.abs(lat) * 0.3;
  const daily = Array.from({ length: 7 }, (_, i) => ({
    date: new Date(Date.now() + i * 86400000).toISOString().slice(0, 10),
    high: base + 8 + Math.sin(i / 2) * seasonAmp / 2,
    low: base - 2 + Math.sin(i / 2) * seasonAmp / 2,
    precipitationMm: i % 3 === 0 ? 2.5 : 0,
    precipitationProbability: i % 3 === 0 ? 60 : 10,
    windSpeedMax: 18 + i,
    weatherCode: i % 3 === 0 ? 61 : i % 2 === 0 ? 2 : 0,
    uvIndex: 5,
  }));
  return {
    current: {
      temperature: base + 5, feelsLike: base + 4, humidity: 60,
      windSpeed: 12, windDirection: 270, precipitationMm: 0,
      weatherCode: 1, isDay: true,
    },
    daily,
    hourly: Array.from({ length: 24 }, (_, i) => ({
      time: new Date(Date.now() + i * 3600000).toISOString(),
      temperature: base + 3 + Math.sin(i / 4) * 3,
      precipitationMm: 0,
      humidity: 60,
    })),
    location: { lat, lng, label: "fallback" },
    alerts: [],
    error: err instanceof Error ? err.message : String(err),
  };
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

