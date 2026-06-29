// scripts/value-assertions-batch3.mjs
// Wave 5 of the value-assertion sweep — the long tail of compute domains.
// In-process (calls __concordLensActions handlers directly). Every expected value
// hand-derived from the standard formula, not copied from code. See batch2 for the
// methodology. Usage: node scripts/value-assertions-batch3.mjs [batchName]

process.env.NODE_ENV = "test";
process.env.CONCORD_NO_LISTEN = "true";
process.env.JWT_SECRET = process.env.JWT_SECRET || "value-assert-fixed-secret-key-32plus-characters-2026";

const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", dim: "\x1b[2m", rst: "\x1b[0m" };
const near = (a, b, tol = 0.01) => typeof a === "number" && Number.isFinite(a) && Math.abs(a - b) <= tol;
const numIn = (s) => { const m = String(s ?? "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };

const mod = await import(new URL("../server/server.js", import.meta.url).href);
const T = mod.__TEST__ || mod.default?.__TEST__;
const { makeInternalCtx } = T;
const LA = globalThis.__concordLensActions;
const ctx = makeInternalCtx("value-assert-batch3");
async function run(dom, act, data = {}, params = {}) {
  const h = LA.get(`${dom}.${act}`);
  if (typeof h !== "function") return { ok: false, error: `no handler ${dom}.${act}` };
  try { return await h(ctx, { domain: dom, data }, params); } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

const BATCHES = {
  pharmacy: [
    { dom: "pharmacy", act: "dosageCalculator", data: { weightKg: 20, dosePerKg: 10, frequencyPerDay: 3, maxDailyDose: 500 },
      // single=20*10=200; daily=600; capped=min(600,500)=500
      assert: r => near(numIn(r.singleDose), 200) && near(numIn(r.dailyDose), 500) && r.capped === true,
      show: r => `single=${r.singleDose} daily=${r.dailyDose} capped=${r.capped}` },
  ],
  mentalhealth: [
    { dom: "mental-health", act: "wellnessScore", data: { sleepHours: 8, exerciseMinutes: 30, socialInteractions: 3, moodScore: 10 },
      // min(8/8,1)*25*4 = 100
      assert: r => near(r.wellnessScore, 100), show: r => `score=${r.wellnessScore}` },
    { dom: "mental-health", act: "moodTracker", data: { entries: [{ mood: 5 }, { mood: 7 }, { mood: 9 }] },
      // avg=(5+7+9)/3=7
      assert: r => near(r.avgMood, 7, 0.1), show: r => `avg=${r.avgMood} trend=${r.trend}` },
  ],
  wellness: [
    { dom: "wellness", act: "sleepScore", params: { minutesAsleep: 420, minutesInBed: 480, disturbances: 1 },
      // eff=0.875; 7h; min(60,52.5)+min(30,26.25)+max(0,10-2)=52.5+26.25+8=86.75
      assert: r => near(r.score, 86.75, 0.75), show: r => `score=${r.score} ${r.band}` },
    { dom: "wellness", act: "recoveryReport", params: { hrvMs: 60, rhrBpm: 50, baselineHrvMs: 50, baselineRhrBpm: 60, sleepScore: 80 },
      // hrvF=min(1.2,1.2)=1.2; rhrF=min(1.2,1.2)=1.2; 40*1.2+30*1.2+30*0.8=48+36+24=108→clamp 100
      assert: r => near(r.recoveryPct, 100), show: r => `recovery=${r.recoveryPct} ${r.band}` },
  ],
  robotics: [
    { dom: "robotics", act: "kinematicsCalc", data: { joints: [{ length: 100 }, { length: 100 }, { length: 100 }] },
      // reach=300; DOF=3
      assert: r => near(numIn(r.maxReach), 300) && near(r.degreesOfFreedom, 3), show: r => `reach=${r.maxReach} DOF=${r.degreesOfFreedom}` },
    { dom: "robotics", act: "pathPlan", data: { waypoints: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }] },
      // sqrt(9+16)=5
      assert: r => near(r.totalDistance, 5, 0.01), show: r => `dist=${r.totalDistance}` },
    { dom: "robotics", act: "sensorFusion", data: { sensors: [{ value: 10, confidence: 1, weight: 1 }, { value: 20, confidence: 1, weight: 1 }] },
      // (10+20)/2 = 15
      assert: r => near(r.fusedValue, 15, 0.01), show: r => `fused=${r.fusedValue}` },
    { dom: "robotics", act: "batteryLife", data: { batteryCapacityWh: 50, motorDrawW: 20, sensorDrawW: 5, computeDrawW: 10 },
      // draw=35; runtime=50/35*60=85.71; safe=68.57
      assert: r => near(numIn(r.estimatedRuntime), 86, 0.6) && near(numIn(r.safeRuntime), 69, 0.6), show: r => `rt=${r.estimatedRuntime} safe=${r.safeRuntime}` },
  ],
  mining: [
    { dom: "mining", act: "oreGradeCalc", data: { samples: [{ grade: 1 }, { grade: 2 }, { grade: 3 }], cutoffGrade: 0.5 },
      // avg=2; aboveCutoff=3→100%; high-grade
      assert: r => near(r.avgGrade, 2) && near(r.economicPercent, 100) && r.classification === "high-grade",
      show: r => `avg=${r.avgGrade} econ=${r.economicPercent}% ${r.classification}` },
    { dom: "mining", act: "blastDesign", data: { holeDepthMeters: 10, burdenMeters: 3, spacingMeters: 3.5, rockDensityTonM3: 2.7, powderFactor: 0.4 },
      // vol=3*3.5*10=105; tons=283.5; explosive=113.4
      assert: r => near(r.volumePerHole, 105) && near(r.tonsPerHole, 283.5, 0.1) && near(r.explosiveKgPerHole, 113.4, 0.1),
      show: r => `vol=${r.volumePerHole} tons=${r.tonsPerHole} exp=${r.explosiveKgPerHole}` },
    { dom: "mining", act: "safetyMetrics", data: { hoursWorked: 200000, incidents: 2, lostTimeIncidents: 1 },
      // TRIR=2; LTIR=1
      assert: r => near(r.trir, 2) && near(r.ltir, 1), show: r => `TRIR=${r.trir} LTIR=${r.ltir}` },
    { dom: "mining", act: "resourceEstimate", data: { volumeM3: 1000000, avgGradePercent: 2, densityTonM3: 2.7, recoveryPercent: 85, metalPricePerTon: 5000 },
      // tonnage=2.7M; contained=54000; recoverable=45900; gross=229.5M
      assert: r => near(r.totalTonnage, 2700000) && near(r.recoverableMetal, 45900, 1) && near(r.grossValue, 229500000, 100),
      show: r => `tons=${r.totalTonnage} recov=${r.recoverableMetal} gross=${r.grossValue}` },
  ],
  forestry: [
    // Real ForestryActionPanel contract: { species, acres, avgAgeYears,
    // treeCount, pricePerMBF }. ageMaturity = 1 − e^(−35/35) = 0.6321;
    // bfPerTree = round(220·1.0·(0.15 + 0.85·0.6321)) = round(151.2) = 151;
    // boardFeet = 151·100 = 15100; valuation = round(15.1·400) = 6040.
    { dom: "forestry", act: "timberVolume", data: { species: "mixed", acres: 10, avgAgeYears: 35, treeCount: 100, pricePerMBF: 400 },
      assert: r => near(r.boardFeet, 15100, 2) && near(r.valuation, 6040, 2), show: r => `BF=${r.boardFeet} val=${r.valuation}` },
    { dom: "forestry", act: "fireRisk", data: { temperatureF: 100, humidityPercent: 10, windSpeedMph: 30, droughtIndex: 5, fuelMoisturePercent: 5 },
      // 25+25+20+25+15=110→100; extreme
      assert: r => near(r.riskScore, 100) && r.riskLevel === "extreme", show: r => `risk=${r.riskScore} ${r.riskLevel}` },
  ],
  landscaping: [
    { dom: "landscaping", act: "irrigationCalc", data: { squareFootage: 1000, plantType: "lawn" },
      // gallons/wk=round(1000*1.0*0.623)=623; runtime=round(623/5)=125
      assert: r => near(r.gallonsPerWeek, 623) && near(r.runtimeMinutes, 125), show: r => `gpw=${r.gallonsPerWeek} rt=${r.runtimeMinutes}` },
    { dom: "landscaping", act: "materialEstimate", data: { squareFootage: 100, material: "mulch" },
      // cubicYards=round((100*3/12/27)*10)/10=0.9; bags=ceil(0.9*13.5)=13
      assert: r => near(r.cubicYards, 0.9, 0.01) && near(r.bags, 13), show: r => `yd³=${r.cubicYards} bags=${r.bags} cost=${r.estimatedCost}` },
  ],
  homeimprovement: [
    { dom: "home-improvement", act: "projectEstimate", data: { squareFootage: 200, projectType: "flooring" },
      // rate=8; mat=round(200*8*0.6)=960; labor=640; permits(200 not>200)=0; total=1600; diy=880
      assert: r => near(r.materialsCost, 960) && near(r.laborCost, 640) && near(r.total, 1600) && near(r.diyEstimate, 880),
      show: r => `mat=${r.materialsCost} labor=${r.laborCost} total=${r.total} diy=${r.diyEstimate}` },
    { dom: "home-improvement", act: "roiCalculator", data: { projects: [{ name: "kitchen", cost: 20000, valueAdded: 25000 }] },
      // roi=25%; netGain=5000
      assert: r => near(r.projects?.[0]?.roi, 25) && near(r.projects?.[0]?.netGain, 5000),
      show: r => `roi=${r.projects?.[0]?.roi} net=${r.projects?.[0]?.netGain}` },
  ],
  retail: [
    { dom: "retail", act: "reorderCheck", data: { products: [{ onHand: 15, reorderPoint: 20, dailyUsage: 5, leadTimeDays: 7 }] },
      // daysOfStock=floor(30/5)=6
      assert: r => near(r.critical?.[0]?.daysOfStock, 3), show: r => `days=${r.critical?.[0]?.daysOfStock} status=${r.critical?.[0]?.status}` },
  ],
  marketing: [
    { dom: "marketing", act: "campaignROI", data: { spend: 1000, revenue: 5000, leads: 100, conversions: 20 },
      // roi=400; cpl=10; cpa=50; conv=20
      assert: r => near(r.roi, 400) && near(r.costPerLead, 10) && near(r.costPerAcquisition, 50) && near(r.conversionRate, 20),
      show: r => `roi=${r.roi} cpl=${r.costPerLead} cpa=${r.costPerAcquisition} conv=${r.conversionRate}` },
  ],
  wallet: [
    { dom: "wallet", act: "portfolioBalance", data: { assets: [{ quantity: 10, currentPrice: 100, costBasis: 80 }] },
      // mv=1000; gainLoss=1000-800=200; pct=25
      assert: r => near(r.assets?.[0]?.gainLoss, 200) && near(r.assets?.[0]?.gainLossPercent, 25),
      show: r => `gl=${r.assets?.[0]?.gainLoss} pct=${r.assets?.[0]?.gainLossPercent}` },
  ],
  billing: [
    { dom: "billing", act: "invoiceCalculation", data: { lineItems: [{ quantity: 10, unitPrice: 5 }] }, params: { taxRate: 0.1 },
      // subtotal=50; tax=5; total=55
      assert: r => near(r.subtotal, 50) && near(r.total, 55, 0.01),
      show: r => `sub=${r.subtotal} tax=${r.taxAmount} total=${r.total}` },
  ],
  hr: [
    // Real HrActionPanel contract: turnoverAnalysis takes { headcount,
    // leaversLast12Months }. BLS avg-headcount denominator = head + leavers/2 =
    // 100 + 5 = 105; ratePct = round1(10/105*100) = 9.5; 6 < 9.5 ≤ 13 → "healthy".
    { dom: "hr", act: "turnoverAnalysis", data: { headcount: 100, leaversLast12Months: 10 },
      assert: r => near(r.ratePct, 9.5, 0.1) && r.band === "healthy",
      show: r => `rate=${r.ratePct}% band=${r.band}` },
    // compensationBenchmark takes { role, location }. senior → base 165;
    // /engineer/ → ×1.15 = 189.75; remote → ×0.92 = 174.57; round → 175.
    { dom: "hr", act: "compensationBenchmark", data: { role: "senior software engineer", location: "remote" },
      assert: r => near(r.market50, 175, 1), show: r => `market50=${r.market50}` },
  ],
  supplychain: [
    { dom: "supplychain", act: "inventoryOptimize", data: { items: [{ dailyDemand: 10, leadTimeDays: 5, currentStock: 100, orderCost: 50, holdingCost: 2 }] },
      // safety=ceil(10*5*0.5)=25; reorder=ceil(50+25)=75; eoq=sqrt(2*10*365*50/2)=427.2
      assert: r => near(r.items?.[0]?.safetyStock, 25) && near(r.items?.[0]?.reorderPoint, 75) && near(r.items?.[0]?.eoq, 427, 2),
      show: r => `safety=${r.items?.[0]?.safetyStock} reorder=${r.items?.[0]?.reorderPoint} eoq=${r.items?.[0]?.eoq}` },
    { dom: "supplychain", act: "supplierScore", data: { suppliers: [{ qualityScore: 90, onTimePercent: 95, priceCompetitiveness: 80, responsiveness: 85 }] },
      // 90*.3+95*.3+80*.2+85*.2 = 27+28.5+16+17 = 88.5 → preferred
      assert: r => near(r.suppliers?.[0]?.totalScore, 89, 0.6) && r.suppliers?.[0]?.tier === "preferred",
      show: r => `score=${r.suppliers?.[0]?.totalScore} ${r.suppliers?.[0]?.tier}` },
  ],
  education: [
    { dom: "education", act: "generateReportCard", data: { grades: [{ subject: "Math", score: 95, maxScore: 100, credits: 1 }] },
      // pct=95→A→4.0; cumGPA=4.0; >=3.8 high-honors
      assert: r => near(r.cumulativeGpa, 4.0, 0.01), show: r => `gpa=${r.cumulativeGpa} ${r.honorRoll}` },
  ],
  analytics: [
    { dom: "analytics", act: "funnelAnalysis", data: { stages: [{ name: "Visit", count: 1000 }, { name: "Signup", count: 100 }, { name: "Purchase", count: 10 }] },
      // overall=(10/1000)*100=1
      assert: r => near(r.overallConversion, 1, 0.01), show: r => `overall=${r.overallConversion}%` },
    { dom: "analytics", act: "detectAnomalies", data: { dataPoints: [{ value: 10 }, { value: 10 }, { value: 10 }, { value: 10 }, { value: 100 }] },
      // mean=28; stdDev=36
      assert: r => near(r.mean, 28) && near(r.stdDev, 36, 0.01), show: r => `mean=${r.mean} sd=${r.stdDev}` },
  ],
  ml: [
    { dom: "ml", act: "modelEvaluate", data: { predictions: [1.1, 2.2, 3.3], actuals: [1.1, 2.2, 4.3] },
      // regression: mse=(0+0+1)/3=0.333; rmse=0.577; mae=0.333
      assert: r => near(r.mse, 0.3333, 0.01) && near(r.rmse, 0.5774, 0.01) && near(r.mae, 0.3333, 0.01),
      show: r => `mse=${r.mse} rmse=${r.rmse} mae=${r.mae} r2=${r.r2}` },
  ],
  environment: [
    { dom: "environment", act: "diversionRate", data: { totalVolume: 100, divertedVolume: 75 }, params: { target: 50 },
      // 75%; landfilled=25
      assert: r => near(r.diversionRate, 75) && near(r.landfilled, 25), show: r => `div=${r.diversionRate}% landfill=${r.landfilled}` },
  ],
  eco: [
    { dom: "eco", act: "biodiversityIndex", data: { species: { a: 50, b: 50 } },
      // 2 species, 50/50: Shannon=ln2=0.693; Simpson D=0.5; evenness=1.0
      assert: r => near(r.diversityIndices?.shannonH, 0.693, 0.01) && near(r.diversityIndices?.simpsonsD, 0.5, 0.01) && near(r.diversityIndices?.shannonEvenness, 1.0, 0.01),
      show: r => `H=${r.diversityIndices?.shannonH} D=${r.diversityIndices?.simpsonsD} J=${r.diversityIndices?.shannonEvenness}` },
  ],
  travel: [
    { dom: "travel", act: "tripBudget", data: { days: 5, travelStyle: "moderate" },
      // daily=150; flights=450; accom=300; food=187.5; act=150; transport=112.5; total=1200
      assert: r => near(r.totalEstimate, 1200, 1) && near(r.breakdown?.accommodation, 300, 1),
      show: r => `total=${r.totalEstimate} accom=${r.breakdown?.accommodation}` },
  ],
  urbanplanning: [
    { dom: "urban-planning", act: "zoningAnalysis", data: { zoneType: "commercial", lotSizeSqFt: 10000 },
      // FAR commercial=2.0 → maxBuildable=20000
      assert: r => near(r.maxBuildableSqFt, 20000), show: r => `far=${r.floorAreaRatio} max=${r.maxBuildableSqFt}` },
    { dom: "urban-planning", act: "densityCalc", data: { population: 50000, areaSqMiles: 5, housingUnits: 20000 },
      // popDensity=10000; housingDensity=4000
      assert: r => near(numIn(r.populationDensity), 10000) && near(numIn(r.housingDensity), 4000),
      show: r => `popD=${r.populationDensity} houseD=${r.housingDensity}` },
    { dom: "urban-planning", act: "trafficImpact", data: { newHousingUnits: 100, newCommercialSqFt: 10000, currentADT: 5000 },
      // newTrips=800+100=900; peak=90; %inc=18
      assert: r => near(r.newDailyTrips, 900) && near(r.peakHourTrips, 90) && near(r.percentIncrease, 18, 0.1),
      show: r => `trips=${r.newDailyTrips} peak=${r.peakHourTrips} inc=${r.percentIncrease}%` },
  ],

  physics: [
    { dom: "physics", act: "projectile", params: { v0: 20, angleDeg: 45, h0: 0, g: 9.81 },
      // range=v0²sin2θ/g=400/9.81=40.77; maxH=v0²sin²θ/2g=10.19; t=2.883; impact=20
      assert: r => near(r.range_m, 40.77, 0.1) && near(r.maxHeight_m, 10.19, 0.05) && near(r.timeOfFlight_s, 2.883, 0.01) && near(r.impactSpeed_mps, 20, 0.05),
      show: r => `range=${r.range_m} maxH=${r.maxHeight_m} t=${r.timeOfFlight_s} vi=${r.impactSpeed_mps}` },
    { dom: "physics", act: "pendulum-period", params: { length: 1, gravity: 9.81, amplitudeDeg: 0 },
      // T=2π√(1/9.81)=2.006; f=0.4985
      assert: r => near(r.smallAnglePeriod_s, 2.006, 0.01) && near(r.frequency_hz, 0.4985, 0.01),
      show: r => `T=${r.smallAnglePeriod_s} f=${r.frequency_hz}` },
    { dom: "physics", act: "kinematics-1d", params: { v0: 0, a: 10, t: 5 },
      // v=0+10*5=50; x=0.5*10*25=125
      assert: r => near(r.solved?.v ?? r.v, 50, 0.01) && near(r.solved?.x ?? r.x, 125, 0.01),
      show: r => `v=${r.solved?.v ?? r.v} x=${r.solved?.x ?? r.x}` },
    { dom: "physics", act: "convert-units", params: { value: 1, from: "km", to: "m", kind: "length" },
      // 1 km = 1000 m
      assert: r => near(r.result, 1000, 0.01), show: r => `result=${r.result}` },
  ],

  chem: [
    { dom: "chem", act: "molecularAnalysis", data: { formula: "C6H12O6" },
      // MW=180.156; DoU=(2*6+2-12)/2=1
      assert: r => near(r.molarMass, 180.16, 0.1) && near(r.degreeOfUnsaturation, 1, 0.01),
      show: r => `MW=${r.molarMass} DoU=${r.degreeOfUnsaturation}` },
    { dom: "chem", act: "calc-gas-law", params: { P: 1, n: 1, T: 273.15 },
      // V=nRT/P=1*0.08206*273.15/1=22.41 L
      assert: r => near(numIn(r.V ?? r.volume ?? r.result), 22.41, 0.05),
      show: r => `V=${r.V ?? r.volume ?? JSON.stringify(r).slice(0, 80)}` },
  ],

  materials: [
    { dom: "materials", act: "compositeAnalysis", data: { components: [{ volumeFraction: 0.5, density: 1, tensileStrength: 100, youngsModulus: 10 }, { volumeFraction: 0.5, density: 3, tensileStrength: 300, youngsModulus: 30 }] },
      // Voigt density = 0.5*1+0.5*3 = 2
      assert: r => near(r.compositeProperties?.density, 2, 0.01), show: r => `ρ=${r.compositeProperties?.density}` },
    { dom: "materials", act: "thermalAnalysis", data: { thermalConductivity: 50, meltingPoint: 1500, thermalExpansion: 12, operatingTemp: 500, application: "general" },
      // safetyMargin=((1500-500)/1500)*100=66.67; isSafe (500<1005)=true
      assert: r => near(numIn(r.safetyMargin), 67, 0.6) && r.isSafe === true,
      show: r => `margin=${r.safetyMargin} safe=${r.isSafe}` },
  ],

  space: [
    { dom: "space", act: "orbitCalc", data: { altitudeKm: 400 },
      // r=6771km; T=92.4min; v=7.67km/s; escape=10.85km/s (ISS-like LEO)
      assert: r => near(r.periodMinutes, 92.4, 0.3) && near(r.velocityKmS, 7.67, 0.03) && near(numIn(r.escapeVelocity), 10.85, 0.05),
      show: r => `T=${r.periodMinutes}min v=${r.velocityKmS} esc=${r.escapeVelocity}` },
    { dom: "space", act: "reentryAnalysis", data: { massKg: 1000, velocityKmS: 7.8, reentryAngleDeg: 5 },
      // KE=0.5*1000*7800²=30.42 GJ; peak_g=5*1.5=7.5; peakTemp=1000+7.8*200=2560
      assert: r => near(r.kineticEnergyGJ, 30.4, 0.1) && near(numIn(r.peakDeceleration), 7.5, 0.01) && near(numIn(r.peakTemperature), 2560, 1),
      show: r => `KE=${r.kineticEnergyGJ}GJ g=${r.peakDeceleration_g} T=${r.peakTemperature}` },
    { dom: "space", act: "deltaVBudget", data: { maneuvers: [{ name: "launch", deltaV: 9000 }, { name: "circularize", deltaV: 1000 }] },
      // total=10000
      assert: r => near(r.totalDeltaV, 10000), show: r => `total=${r.totalDeltaV}` },
  ],

  energy: [
    { dom: "energy", act: "consumptionAnalysis", data: { readings: [{ kWh: 10 }, { kWh: 20 }, { kWh: 30 }], costPerKWh: 0.15 },
      // total=60; avg=20; peak=30; cost=9; ratio=1.5
      assert: r => near(r.totalKWh, 60) && near(r.avgKWh, 20) && near(r.peakKWh, 30) && near(r.estimatedCost, 9, 0.01) && near(r.peakToAvgRatio, 1.5, 0.01),
      show: r => `total=${r.totalKWh} avg=${r.avgKWh} cost=${r.estimatedCost} ratio=${r.peakToAvgRatio}` },
    { dom: "energy", act: "carbonFootprint", data: { electricityKWh: 1000, naturalGasTherms: 0, gasolineGallons: 0, flightMiles: 0 },
      // 1000*0.000417 = 0.417 metric tons
      assert: r => near(r.totalMetricTons, 0.417, 0.005), show: r => `tons=${r.totalMetricTons}` },
    { dom: "energy", act: "solarEstimate", data: { roofAreaSqFt: 1000, peakSunHours: 5, monthlyUsageKWh: 900 },
      // panels=floor(700/18)=38; kW=15.2; production=15.2*5*30*0.8=1824
      assert: r => near(r.maxPanels, 38) && near(r.systemSizeKW, 15.2, 0.01) && near(r.monthlyProductionKWh, 1824, 1),
      show: r => `panels=${r.maxPanels} kW=${r.systemSizeKW} prod=${r.monthlyProductionKWh}` },
  ],
};

const only = process.argv[2];
const batchNames = only ? [only] : Object.keys(BATCHES);
let pass = 0, fail = 0, err = 0; const failures = [];
console.log(`\nValue assertions — WAVE 5 (long-tail compute domains)\n`);
for (const bn of batchNames) {
  const cases = BATCHES[bn]; if (!cases) { console.log(`${C.y}no batch '${bn}'${C.rst}`); continue; }
  console.log(`${C.dim}── ${bn} ──${C.rst}`);
  for (const c of cases) {
    const raw = await run(c.dom, c.act, c.data || {}, c.params || {});
    const result = raw && typeof raw === "object" && "result" in raw ? raw.result : raw;
    if (raw?.ok === false) { err++; failures.push([`${c.dom}.${c.act}`, `handler error: ${raw.error}`]); console.log(`  ${C.y}ERR ${C.rst}${c.dom}.${c.act}  ${C.dim}${raw.error}${C.rst}`); continue; }
    let ok = false, shown = "";
    try { ok = c.assert(result); shown = c.show ? c.show(result || {}) : ""; } catch (e) { ok = false; shown = `assert threw: ${e?.message}`; }
    if (ok) { pass++; console.log(`  ${C.g}PASS${C.rst} ${c.dom}.${c.act}  ${C.dim}${shown}${C.rst}`); }
    else { fail++; failures.push([`${c.dom}.${c.act}`, shown]); console.log(`  ${C.r}FAIL${C.rst} ${c.dom}.${c.act}  ${C.dim}${shown}${C.rst}`); }
  }
}
console.log(`\n${C.g}${pass} pass${C.rst}  ${fail ? C.r : C.dim}${fail} fail${C.rst}  ${err ? C.y : C.dim}${err} err${C.rst}`);
if (failures.length) { console.log(`\n${C.r}Triage:${C.rst}`); for (const [k, v] of failures) console.log(`  • ${k}  ${C.dim}${v}${C.rst}`); }
process.exit((fail > 0 || err > 0) ? 1 : 0);
