// server/domains/desert.js
export default function registerDesertActions(registerLensAction) {
  registerLensAction("desert", "waterBudget", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const rainfall = parseFloat(data.annualRainfallMm) || 250;
    const evaporation = parseFloat(data.evaporationMm) || 2000;
    const areaHectares = parseFloat(data.areaHectares) || 100;
    const waterInflow = rainfall * areaHectares * 10; // cubic meters
    const waterLoss = Math.min(evaporation, rainfall * 1.5) * areaHectares * 10;
    const netBalance = waterInflow - waterLoss;
    return { ok: true, result: { annualRainfall: `${rainfall} mm`, evaporationRate: `${evaporation} mm`, area: `${areaHectares} hectares`, waterInflow: `${Math.round(waterInflow)} m³/year`, waterLoss: `${Math.round(waterLoss)} m³/year`, netBalance: `${Math.round(netBalance)} m³/year`, deficit: netBalance < 0, aridity: rainfall < 100 ? "hyper-arid" : rainfall < 250 ? "arid" : rainfall < 500 ? "semi-arid" : "sub-humid", irrigationNeeded: netBalance < 0 ? `${Math.abs(Math.round(netBalance))} m³/year supplemental water required` : "Natural water balance sufficient" } };
  });
  registerLensAction("desert", "heatStressIndex", (ctx, artifact, _params) => {
    const temp = parseFloat(artifact.data?.temperatureCelsius) || 40;
    const humidity = parseFloat(artifact.data?.humidityPercent) || 20;
    const wind = parseFloat(artifact.data?.windSpeedKmh) || 10;
    // Simplified heat index
    const heatIndex = temp + 0.33 * (humidity / 100 * 6.105 * Math.exp(17.27 * temp / (237.7 + temp))) - 0.7 * wind / 3.6 - 4;
    const risk = heatIndex > 54 ? "extreme-danger" : heatIndex > 41 ? "danger" : heatIndex > 32 ? "extreme-caution" : heatIndex > 27 ? "caution" : "safe";
    return { ok: true, result: { temperature: `${temp}°C`, humidity: `${humidity}%`, windSpeed: `${wind} km/h`, heatIndex: Math.round(heatIndex * 10) / 10, riskLevel: risk, recommendations: risk === "extreme-danger" ? ["Cease all outdoor activity", "Seek air-conditioned shelter", "Hydrate continuously"] : risk === "danger" ? ["Limit outdoor exposure", "Take breaks every 15 min", "Drink 1L water per hour"] : ["Stay hydrated", "Wear sun protection"] } };
  });
  registerLensAction("desert", "terrainClassification", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const elevation = parseFloat(data.elevationMeters) || 500;
    const soilType = (data.soilType || "sand").toLowerCase();
    const vegetation = parseFloat(data.vegetationCoverPercent) || 5;
    const slope = parseFloat(data.slopePercent) || 2;
    const terrainTypes = { sand: "erg (sand sea)", rock: "hamada (stone desert)", gravel: "reg (gravel plain)", salt: "sabkha (salt flat)", clay: "playa (dry lake bed)" };
    const terrain = terrainTypes[soilType] || "mixed desert";
    const traversability = slope < 5 && soilType !== "sand" ? "easy" : slope < 15 ? "moderate" : "difficult";
    return { ok: true, result: { classification: terrain, elevation: `${elevation}m`, soilType, vegetationCover: `${vegetation}%`, slope: `${slope}%`, traversability, ecosystem: vegetation > 20 ? "desert-scrubland" : vegetation > 5 ? "sparse-desert" : "barren-desert", habitability: vegetation > 10 && elevation < 2000 ? "marginal" : "inhospitable" } };
  });
  registerLensAction("desert", "solarPotential", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const latitude = parseFloat(data.latitude) || 25;
    const clearDays = parseInt(data.clearDaysPerYear) || 300;
    const areaAcres = parseFloat(data.areaAcres) || 10;
    // Solar irradiance estimate (kWh/m²/day)
    const irradiance = Math.max(3, 8 - Math.abs(latitude - 25) * 0.1);
    const annualIrradiance = irradiance * clearDays;
    const panelEfficiency = 0.20;
    const areaM2 = areaAcres * 4047;
    const annualOutput = Math.round(areaM2 * annualIrradiance * panelEfficiency / 1000); // MWh
    const homesEquivalent = Math.round(annualOutput / 10); // ~10 MWh per home per year
    return { ok: true, result: { latitude, clearDaysPerYear: clearDays, dailyIrradiance: `${Math.round(irradiance * 10) / 10} kWh/m²`, annualIrradiance: `${Math.round(annualIrradiance)} kWh/m²`, solarArea: `${areaAcres} acres (${Math.round(areaM2).toLocaleString()} m²)`, annualOutputMWh: annualOutput, homesEquivalent, potential: annualOutput > 1000 ? "excellent" : annualOutput > 100 ? "good" : "modest" } };
  });
}
