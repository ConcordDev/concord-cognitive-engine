// scripts/value-assertions-batch2.mjs
//
// WAVE 2 of the business-logic value-assertion sweep — extends the original
// scripts/value-assertions.mjs (math/chem/physics/accounting/finance, 26 cases,
// HTTP) to the rest of the COMPUTE-bearing lens domains, run IN-PROCESS so it
// doesn't depend on a live HTTP server (the sandbox reaps detached servers).
//
// Each case: a KNOWN input → an assertion on the computed output, where the
// expected value was derived BY HAND from the real-world standard formula
// (Kepler, NEC, amortization, Mifflin-St Jeor, Jukes-Cantor, …) — NOT copied
// from the code. The code's math is the thing under test; if it disagrees with
// the independently-derived answer, that's a bug (the "renders fine, math wrong"
// class a reachability sweep can't catch).
//
// Lens-action handlers have signature (ctx, artifact, params) and read inputs
// from artifact.data.* and/or params.*. We invoke them directly via the
// globalThis.__concordLensActions registry. register() macros go via runMacro.
//
// Usage:  node scripts/value-assertions-batch2.mjs [batchName]
//   no arg → run all batches.  arg → run only that batch.

process.env.NODE_ENV = "test";
process.env.CONCORD_NO_LISTEN = "true";
process.env.JWT_SECRET = process.env.JWT_SECRET || "value-assert-fixed-secret-key-32plus-characters-2026";

const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", dim: "\x1b[2m", rst: "\x1b[0m" };
const near = (a, b, tol = 0.01) => typeof a === "number" && Number.isFinite(a) && Math.abs(a - b) <= tol;
const numIn = (s) => { const m = String(s ?? "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };

const mod = await import(new URL("../server/server.js", import.meta.url).href);
const T = mod.__TEST__ || mod.default?.__TEST__;
if (!T) { console.error("no __TEST__ export"); process.exit(1); }
const { runMacro, makeInternalCtx } = T;
const LA = globalThis.__concordLensActions;
if (!(LA instanceof Map)) { console.error("no __concordLensActions"); process.exit(1); }

const ctx = makeInternalCtx("value-assert-batch2");

// Invoke a lens action handler directly. data → artifact.data, params → params.
async function runLensAction(dom, act, data = {}, params = {}) {
  const h = LA.get(`${dom}.${act}`);
  if (typeof h !== "function") return { ok: false, error: `no handler ${dom}.${act}` };
  const artifact = { domain: dom, data };
  try { return await h(ctx, artifact, params); }
  catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

// ── BATCHES — each case: { dom, act, data?, params?, assert(result)->bool, show(result)->str, note } ──
// `result` is the UNWRAPPED handler result (we unwrap .result below).

const BATCHES = {
  // ───────────────────────── astronomy (time-independent only) ─────────────────────────
  astronomy: [
    { dom: "astronomy", act: "orbitalMechanics", data: { semiMajorAxis: 1, eccentricity: 0, centralMass: 1 },
      // Kepler III: P=√(a³/M)=1yr; perihelion=aphelion=1; v=29.78/√1=29.78
      assert: r => near(r.periodYears, 1, 1e-3) && near(r.perihelionAU, 1, 1e-3) && near(r.aphelionAU, 1, 1e-3) && near(r.avgOrbitalVelocityKmS, 29.78, 0.1),
      show: r => `P=${r.periodYears}y v=${r.avgOrbitalVelocityKmS}km/s peri=${r.perihelionAU} apo=${r.aphelionAU}` },
    { dom: "astronomy", act: "orbitalMechanics", data: { semiMajorAxis: 4, eccentricity: 0.5, centralMass: 1 },
      // P=√(64)=8yr; peri=4*(1-0.5)=2; apo=4*1.5=6; v=29.78/2=14.89
      assert: r => near(r.periodYears, 8, 1e-3) && near(r.perihelionAU, 2, 1e-3) && near(r.aphelionAU, 6, 1e-3) && near(r.avgOrbitalVelocityKmS, 14.89, 0.05),
      show: r => `P=${r.periodYears}y v=${r.avgOrbitalVelocityKmS} peri=${r.perihelionAU} apo=${r.aphelionAU}` },
    { dom: "astronomy", act: "lightTravelTime", data: { distanceLightYears: 10 },
      // 10 ly = 10/3.2616 = 3.0660 pc
      assert: r => near(r.distanceLightYears, 10, 1e-3) && near(r.distanceParsecs, 3.066, 0.01),
      show: r => `ly=${r.distanceLightYears} pc=${r.distanceParsecs}` },
  ],

  // ───────────────────────── ocean (time-independent only) ─────────────────────────
  ocean: [
    { dom: "ocean", act: "waveAnalysis", data: { waveHeightMeters: 2, wavePeriodSeconds: 8, windSpeedKnots: 12 },
      // λ=1.56*8²=99.84→100; c=1.56*8=12.48; E=0.5*1025*9.81*2²=20110.5; Beaufort(12kn)=4
      assert: r => near(numIn(r.wavelength), 100, 0.5) && near(numIn(r.speed), 12.48, 0.05) && near(numIn(r.energyDensity), 20111, 2) && r.beaufortScale === 4,
      show: r => `λ=${r.wavelength} c=${r.speed} E=${r.energyDensity} B=${r.beaufortScale}` },
    { dom: "ocean", act: "salinityProfile", data: { readings: [{ depth: 0, salinity: 34, temperature: 20 }, { depth: 50, salinity: 36, temperature: 15 }] },
      // avg salinity = (34+36)/2 = 35.0
      assert: r => near(r.avgSalinity, 35, 0.1),
      show: r => `avgSal=${r.avgSalinity}` },
  ],

  // ───────────────────────── math (descriptive stats / poly / regression / matrix) ─────────────────────────
  math: [
    { dom: "math", act: "statisticalAnalysis", data: { values: [1, 2, 3, 4, 5] },
      // mean3 median3 var(pop)=2 stdev=√2≈1.414 q1=2 q3=4 iqr=2 skew=0 kurt(excess)=6.8/4-3=-1.3 (skew/kurt under result.shape)
      assert: r => near(r.mean, 3) && near(r.median, 3) && near(r.stdDev, 1.41421, 1e-3) && near(r.q1, 2) && near(r.q3, 4) && near(r.shape?.skewness, 0, 1e-6) && near(r.shape?.kurtosis, -1.3, 1e-2),
      show: r => `mean=${r.mean} sd=${r.stdDev} q1=${r.q1} q3=${r.q3} skew=${r.shape?.skewness} kurt=${r.shape?.kurtosis}` },
    { dom: "math", act: "polynomialAnalysis", data: { coefficients: [1, -5, 6] }, params: { evaluateAt: [0, 1, 2, 3] },
      // x²-5x+6: f(0)=6 f(1)=2 f(2)=0 f(3)=0; roots {2,3}; derivative 2x-5
      assert: r => { const ev = r.evaluations?.map(e => e.y ?? e.value ?? e); const roots = (r.roots || []).map(Number).sort((a, b) => a - b);
        return near(roots[0], 2) && near(roots[1], 3) && Array.isArray(ev) && near(ev[0], 6) && near(ev[2], 0); },
      show: r => `roots=${JSON.stringify(r.roots)} eval=${JSON.stringify(r.evaluations)}` },
    { dom: "math", act: "regressionFit", data: { x: [1, 2, 3], y: [2, 4, 6] }, params: { order: 1 },
      // perfect line y=2x: slope2 intercept0 r²=1
      assert: r => near(r.slope, 2) && near(r.intercept, 0, 1e-6) && near(r.rSquared, 1, 1e-6),
      show: r => `slope=${r.slope} int=${r.intercept} r²=${r.rSquared}` },
    { dom: "math", act: "matrixOperations", data: { matrixA: [[1, 2], [3, 4]] }, params: { operation: "determinant" },
      // det = 1*4 - 2*3 = -2
      assert: r => near(r.determinant ?? r.result, -2),
      show: r => `det=${r.determinant ?? r.result}` },
  ],

  // ───────────────────────── fitness (BMI / Navy BF% / HR zones / progression) ─────────────────────────
  fitness: [
    { dom: "fitness", act: "bodyCompReport", data: { weight: 80, height: 180, age: 30, sex: "male", waist: 85, neck: 38, unit: "metric" },
      // BMI=80/1.8²=24.69→24.7; Navy male BF%=495/(1.0324-0.19077*log10(47)+0.15456*log10(180))-450≈16.1
      assert: r => near(r.bmi, 24.7, 0.05) && near(r.bodyFatPct, 16.1, 0.6),
      show: r => `bmi=${r.bmi} bf%=${r.bodyFatPct}` },
    { dom: "fitness", act: "hr-zones", params: { age: 30, restingHr: 60, method: "tanaka" },
      // Tanaka max = 208 - 0.7*30 = 187
      assert: r => near(r.maxHr, 187),
      show: r => `maxHr=${r.maxHr}` },
    { dom: "fitness", act: "progressionCalc", data: { exercises: [{ weight: 100, reps: 5, rpe: 6 }] },
      // rpe6 → +5% → 105
      assert: r => near(r.recommendations?.[0]?.recommendedWeight, 105),
      show: r => `rec=${r.recommendations?.[0]?.recommendedWeight}` },
  ],

  // ───────────────────────── music (BPM / key) ─────────────────────────
  music: [
    { dom: "music", act: "bpmAnalyze", data: { beats: [0, 1, 2, 3] },
      // 1s intervals → 60 BPM, perfectly stable
      assert: r => near(r.bpm, 60) && near(r.minBpm, 60) && near(r.maxBpm, 60) && near(r.stability, 100, 1),
      show: r => `bpm=${r.bpm} stab=${r.stability} min=${r.minBpm} max=${r.maxBpm}` },
    { dom: "music", act: "bpmAnalyze", data: { beats: [0, 0.5, 1.0, 1.5, 2.0] },
      // 0.5s intervals → 120 BPM
      assert: r => near(r.bpm, 120),
      show: r => `bpm=${r.bpm}` },
  ],

  // ───────────────────────── sports ─────────────────────────
  sports: [
    { dom: "sports", act: "performanceStats", data: { stats: [{ value: 70 }, { value: 75 }, { value: 80 }, { value: 85 }, { value: 90 }] },
      // avg80 best90 worst70 consistency=stdev(pop)=√50≈7.07 trend improving
      assert: r => near(r.average ?? r.avg, 80) && near(r.best, 90) && near(r.worst, 70) && near(r.consistency, 7.07, 0.02) && /improv/i.test(r.trend || ""),
      show: r => `avg=${r.average ?? r.avg} best=${r.best} cons=${r.consistency} trend=${r.trend}` },
  ],

  // ───────────────────────── biology (Jukes-Cantor / fold-change) ─────────────────────────
  bio: [
    { dom: "bio", act: "phylogeneticDistance", data: { sequences: [{ id: "a", sequence: "ATGC" }, { id: "b", sequence: "AGGC" }] }, params: { model: "jukes-cantor" },
      // p=1/4=0.25; d=-0.75*ln(1-4*0.25/3)=-0.75*ln(0.66667)=0.30410
      assert: r => { const m = r.distanceMatrix; const d = m?.[0]?.[1] ?? m?.[1]?.[0]; return near(d, 0.30410, 1e-3); },
      show: r => `d=${JSON.stringify(r.distanceMatrix)}` },
    { dom: "bio", act: "geneExpression", data: { samples: [
        { gene: "G1", condition: "A", expression: 10 }, { gene: "G1", condition: "A", expression: 12 }, { gene: "G1", condition: "A", expression: 11 },
        { gene: "G1", condition: "B", expression: 20 }, { gene: "G1", condition: "B", expression: 22 }, { gene: "G1", condition: "B", expression: 21 } ] },
      // meanA=11 meanB=21 fold=21/11=1.909 log2FC=log2(1.909)=0.9328
      assert: r => { const g = r.genes?.[0]; return near(g?.foldChange, 1.909, 0.01) && near(g?.log2FC, 0.9328, 0.01); },
      show: r => `fc=${r.genes?.[0]?.foldChange} log2=${r.genes?.[0]?.log2FC}` },
  ],

  // ───────────────────────── real-estate (cap rate / cash flow / mortgage / affordability) ─────────────────────────
  realestate: [
    { dom: "realestate", act: "capRate", data: { netOperatingIncome: 12000, purchasePrice: 200000 },
      // 12000/200000*100 = 6.0%
      assert: r => near(r.capRate, 6, 0.01),
      show: r => `cap=${r.capRate}` },
    { dom: "realestate", act: "cashFlow", data: { rentAmount: 2000, monthlyExpenses: 500, mortgagePayment: 1000, vacancyRate: 5 },
      // eff=2000*0.95=1900; cf=1900-500-1000=400; annual=4800
      assert: r => near(r.monthly?.cashFlow, 400, 0.5) && near(r.annual?.cashFlow, 4800, 5),
      show: r => `mcf=${r.monthly?.cashFlow} acf=${r.annual?.cashFlow}` },
    { dom: "realestate", act: "calc-mortgage", params: { price: 300000, downPercent: 20, rate: 6, termYears: 30, taxRate: 0, insurance: 0, hoa: 0 },
      // loan=240000 r=0.005 n=360 → PI=1438.92; LTV=80 → PMI=0
      assert: r => near(r.monthly?.principalAndInterest, 1438.92, 1) && near(r.monthly?.pmi, 0) && near(r.loanAmount, 240000),
      show: r => `PI=${r.monthly?.principalAndInterest} pmi=${r.monthly?.pmi} loan=${r.loanAmount}` },
    { dom: "realestate", act: "calc-affordability", params: { grossIncome: 120000, monthlyDebts: 500, downPayment: 40000, rate: 6, termYears: 30 },
      // gross/mo=10000; front=2800 back=3600-500=3100; PITI=2800; PI=2100; maxLoan≈350259; maxPrice≈390259
      assert: r => near(r.maxPITI, 2800, 1) && near(r.maxHomePrice, 390259, 1500),
      show: r => `piti=${r.maxPITI} maxPrice=${r.maxHomePrice} maxLoan=${r.maxLoanAmount}` },
  ],

  // ───────────────────────── finance (compound interest) ─────────────────────────
  finance: [
    { dom: "finance", act: "compoundInterest", data: { principal: 1000, annualRate: 0.07, years: 10, monthlyContribution: 0 },
      // 1000*(1+0.07/12)^120 = 1000*2.009661 = 2009.66
      assert: r => near(r.finalBalance, 2009.66, 1) && near(r.totalContributed, 1000, 0.5),
      show: r => `final=${r.finalBalance} contrib=${r.totalContributed} int=${r.totalInterest}` },
    { dom: "finance", act: "portfolioAnalysis", data: { holdings: [{ symbol: "A", value: 6000 }, { symbol: "B", value: 4000 }] },
      // allocations 60 / 40
      assert: r => near(r.holdings?.[0]?.allocation, 60, 0.01) && near(r.holdings?.[1]?.allocation, 40, 0.01) && near(r.totalValue, 10000),
      show: r => `alloc=${r.holdings?.map(h => h.allocation).join("/")} total=${r.totalValue}` },
  ],

  // ───────────────────────── electrical (NEC) ─────────────────────────
  electrical: [
    { dom: "electrical", act: "loadCalculation", data: { circuits: [{ name: "A", watts: 1200, voltage: 120 }, { name: "B", watts: 2400, voltage: 120 }] },
      // ampsA=10 ampsB=20 totalW=3600 totalA=30 panel=100 util=30 margin=round((1-30/80)*100)=63 NEC: 30<=80 PASS
      assert: r => near(r.totalWatts, 3600) && near(r.totalAmps, 30, 0.1) && near(r.utilization, 30) && r.nec80PercentRule === "PASS",
      show: r => `W=${r.totalWatts} A=${r.totalAmps} util=${r.utilization} nec=${r.nec80PercentRule}` },
    { dom: "electrical", act: "voltageDropCalc", data: { amps: 20, distanceFeet: 100, wireGauge: 10, voltage: 120, phase: 1 },
      // R10=1.21Ω/kft; drop=(1.21/1000)*100*20*2=4.84V; %=4.033; not acceptable (>3%)
      assert: r => near(numIn(r.voltageDrop), 4.84, 0.02) && near(r.dropPercentValue, 4.03, 0.02) && r.acceptable === false,
      show: r => `drop=${r.voltageDrop} %=${r.dropPercentValue} ok=${r.acceptable}` },
    { dom: "electrical", act: "boxFill", data: { largestAwg: 14, currentCarrying: 3, groundConductors: 1, internalClamps: true, devices: 1, supportFittings: 0, boxVolumeCubicInches: 18 },
      // NEC 314.16: equiv=3+1(grounds)+1(clamps)+1*2(device)+0=7; vol#14=2.0; required=14.0; 18>=14 → pass
      assert: r => near(r.requiredBoxVolume, 14, 0.01) && r.pass === true,
      show: r => `req=${r.requiredBoxVolume} provided=${r.providedBoxVolume} pass=${r.pass}` },
    { dom: "electrical", act: "wireSize", data: { loadAmps: 40, continuous: true, distanceFeet: 50, voltage: 240 },
      // design=40*1.25=50A → #8 (50A ampacity); drop@#8=(0.764/1000)*50*40*2=3.056V=1.27% <3% → no upsize, #8
      assert: r => near(r.designAmps, 50, 0.1) && near(numIn(r.recommendedWire), 8),
      show: r => `design=${r.designAmps} wire=${r.recommendedWire} vd=${r.voltageDropAtRecommended}` },
  ],

  // ───────────────────────── engineering ─────────────────────────
  engineering: [
    { dom: "engineering", act: "stressAnalysis", data: { forceNewtons: 10000, crossSectionMm2: 100, yieldStrengthMPa: 250 },
      // σ=10000/100=100 MPa (N/mm²=MPa); SF=250/100=2.5 → acceptable
      assert: r => near(numIn(r.appliedStress), 100, 0.5) && near(r.safetyFactor, 2.5, 0.01),
      show: r => `σ=${r.appliedStress} SF=${r.safetyFactor} ${r.status}` },
    { dom: "engineering", act: "toleranceAnalysis", data: { parts: [{ name: "A", nominal: 10, tolerance: 0.01 }, { name: "B", nominal: 20, tolerance: 0.02 }] },
      // stack nominal=30; worst-case tol=0.03; RSS=√(0.01²+0.02²)=0.022360
      assert: r => near(r.stackUp?.nominal, 30) && near(r.stackUp?.worstCaseTolerance, 0.03, 1e-6) && near(r.stackUp?.rssTolerance, 0.0223607, 1e-4),
      show: r => `nom=${r.stackUp?.nominal} wc=${r.stackUp?.worstCaseTolerance} rss=${r.stackUp?.rssTolerance}` },
    { dom: "engineering", act: "bomRollup", data: { items: [{ partNumber: "P1", quantity: 2, unitCost: 10 }, { partNumber: "P2", quantity: 3, unitCost: 5 }], overheadRate: 0.15, buildQty: 1 },
      // mat=2*10+3*5=35; overhead=35*0.15=5.25; total=40.25
      assert: r => near(r.rollup?.materialCost, 35, 0.01) && near(r.rollup?.overhead, 5.25, 0.01) && near(r.rollup?.totalCost, 40.25, 0.01),
      show: r => `mat=${r.rollup?.materialCost} oh=${r.rollup?.overhead} total=${r.rollup?.totalCost}` },
  ],

  // ───────────────────────── hvac ─────────────────────────
  hvac: [
    { dom: "hvac", act: "loadCalculation", data: { squareFootage: 1000, stories: 1, insulation: "average", climate: "temperate" },
      // base=1000*25=25000; ins=1.0 climate=1.0 story=1 → 25000 BTU; tons=round(25000/12000*10)/10=2.1
      assert: r => near(r.requiredBTU, 25000) && near(r.tonnage, 2.1, 0.01),
      show: r => `BTU=${r.requiredBTU} tons=${r.tonnage}` },
    { dom: "hvac", act: "energyAudit", data: { monthlyBill: 200, squareFootage: 1000, systemAge: 10 },
      // costPerSqFt=200*12/1000=2.4; effLoss=min(50,20)=20%; savings=round(200*0.2)=40; grade 2.4<2.5 → B
      assert: r => near(r.costPerSqFt, 2.4, 0.01) && near(r.potentialMonthlySavings, 40, 0.5) && r.grade === "B",
      show: r => `$/sf=${r.costPerSqFt} save=${r.potentialMonthlySavings} grade=${r.grade}` },
    { dom: "hvac", act: "zoneBalance", data: { zones: [{ name: "Z1", currentTemp: 70, targetTemp: 72 }, { name: "Z2", currentTemp: 68, targetTemp: 72 }] },
      // dev 2 / 4; maxDev=4; avgDev=3.0; balanced=(4<3)=false
      assert: r => near(r.maxDeviation, 4) && near(r.avgDeviation, 3, 0.01) && r.balanced === false,
      show: r => `max=${r.maxDeviation} avg=${r.avgDeviation} bal=${r.balanced}` },
  ],

  // ───────────────────────── plumbing ─────────────────────────
  plumbing: [
    { dom: "plumbing", act: "pipeSize", data: { flowGPM: 10, velocityFPS: 5 },
      // GPM=2.448·d²·v → d=√(10/(2.448·5))=√0.8170=0.9039"; recommended nominal = first ≥0.904 = 1"
      assert: r => near(numIn(r.calculatedDiameter), 0.904, 0.02) && numIn(r.recommendedSize) === 1,
      show: r => `d=${r.calculatedDiameter} rec=${r.recommendedSize}` },
    { dom: "plumbing", act: "waterHeaterSize", data: { household: 4, simultaneousFixtures: 2 },
      // peak=2*2.5=5 GPM; FHR=round(60*1.5)=90; tanklessKW=round(5*8.33*60*70/3412)=51 (ΔT=70°F standard)
      assert: r => near(r.peakDemandGPM, 5) && near(r.firstHourRating, 90) && near(numIn(r.tanklessRecommendation), 51, 1),
      show: r => `peak=${r.peakDemandGPM} FHR=${r.firstHourRating} tankless=${r.tanklessRecommendation}` },
    { dom: "plumbing", act: "drainSlope", data: { pipeSizeInches: 2, lengthFeet: 10 },
      // 2" → 0.25"/ft (IPC); totalDrop=10*0.25=2.5"
      assert: r => near(numIn(r.slopePerFoot), 0.25) && near(numIn(r.totalDrop), 2.5),
      show: r => `slope=${r.slopePerFoot} drop=${r.totalDrop}` },
    { dom: "plumbing", act: "fixtureCount", data: { fixtures: [{ type: "toilet", count: 2 }, { type: "lavatory", count: 2 }] },
      // 2.5*2 + 1*2 = 7 WSFU; meter ≤15 → 3/4"
      assert: r => near(r.totalWSFU, 7) && /3\/4/.test(r.meterSize || ""),
      show: r => `wsfu=${r.totalWSFU} meter=${r.meterSize}` },
  ],

  // ───────────────────────── construction ─────────────────────────
  construction: [
    { dom: "construction", act: "takeoffEstimate", data: { lineItems: [{ description: "X", quantity: 100, unit: "sf", unitCost: 2, wastePercent: 10 }], laborPercent: 40, squareFootage: 1000 },
      // adjQty=110; lineCost=220; mat=220; labor=88; overhead=308*0.15=46.2; profit=354.2*0.10=35.42; total=389.62
      assert: r => near(r.subtotalMaterials, 220, 0.01) && near(r.laborCost, 88, 0.01) && near(r.overhead, 46.2, 0.01) && near(r.grandTotal, 389.62, 0.02),
      show: r => `mat=${r.subtotalMaterials} labor=${r.laborCost} oh=${r.overhead} total=${r.grandTotal}` },
    { dom: "construction", act: "criticalPath", data: { tasks: [{ name: "A", duration: 3, dependencies: [] }, { name: "B", duration: 2, dependencies: ["A"] }, { name: "C", duration: 4, dependencies: ["A"] }] },
      // A(0-3) B(3-5) C(3-7); duration=7; critical A→C; B slack=2
      assert: r => near(r.projectDuration, 7) && (r.criticalPath || []).includes("A") && (r.criticalPath || []).includes("C"),
      show: r => `dur=${r.projectDuration} crit=${JSON.stringify(r.criticalPath)}` },
    { dom: "construction", act: "safetyCompliance", data: { safetyChecklist: [{ passed: true }, { passed: true }, { passed: false }], incidents: [{}], workerCount: 10, totalHoursWorked: 200000 },
      // compliance=round(2/3*100)=67; OSHA TRIR=1*200000/200000=1.0
      assert: r => near(r.complianceRate, 67) && near(r.incidentRate, 1, 0.01),
      show: r => `comp=${r.complianceRate}% TRIR=${r.incidentRate}` },
    { dom: "construction", act: "progressReport", data: { phases: [{ name: "P1", plannedPercent: 50, actualPercent: 45 }, { name: "P2", plannedPercent: 30, actualPercent: 30 }] },
      // overallPlanned=40 overallActual=37.5 (code rounds display→38) variance=round(-2.5)=-2
      assert: r => near(r.overallPlannedPercent, 40) && near(r.overallActualPercent, 38) && near(r.overallVariance, -2),
      show: r => `plan=${r.overallPlannedPercent} act=${r.overallActualPercent} var=${r.overallVariance}` },
    // budget-list is a STATEFUL aggregator (reads per-user STATE, not artifact.data) — seed via budget-add first.
    { dom: "construction", act: "budget-list", seed: { act: "budget-add", params: { costCode: "01", description: "framing", budgetAmount: 1000, committed: 200, actual: 300 } },
      // FAC=max(1000, 300+max(200-300,0))=1000; variance=1000-1000=0; under-budget
      assert: r => near(r.forecastAtCompletion, 1000) && near(r.variance, 0) && r.status === "under-budget",
      show: r => `FAC=${r.forecastAtCompletion} var=${r.variance} ${r.status}` },
  ],

  // ───────────────────────── insurance ─────────────────────────
  insurance: [
    { dom: "insurance", act: "riskScore", data: { probability: 4, impact: 5, mitigations: ["a", "b"] },
      // raw=4*5=20; normalized=round(20/25*100)=80; mitigated=max(1,20-2)=18; 20>=15→critical
      assert: r => near(r.rawScore, 20) && near(r.normalizedScore, 80) && near(r.mitigatedScore, 18) && r.level === "critical",
      show: r => `raw=${r.rawScore} norm=${r.normalizedScore} mit=${r.mitigatedScore} ${r.level}` },
    { dom: "insurance", act: "lossRatioReport", data: { policies: [{ premium: 1000 }, { premium: 1000 }], claims: [{ status: "paid", amount: 600 }] },
      // premiums=2000; paid=600; lossRatio=600/2000=30%
      assert: r => near(r.lossRatio, 30, 0.01) && near(r.claimsPaid, 600),
      show: r => `LR=${r.lossRatio}% paid=${r.claimsPaid}` },
    { dom: "insurance", act: "commissionSummary", data: { policies: [{ premium: 1000, rate: 10, tier: "A" }, { premium: 2000, rate: 5, tier: "B" }] },
      // comm=100+100=200; effRate=200/3000=6.67%
      assert: r => near(r.totalCommission, 200, 0.01) && near(r.effectiveRate, 6.67, 0.02),
      show: r => `comm=${r.totalCommission} eff=${r.effectiveRate}%` },
  ],

  // ───────────────────────── agriculture ─────────────────────────
  agriculture: [
    { dom: "agriculture", act: "yieldAnalysis", data: { fields: [{ acreage: 100, history: [{ yieldPerAcre: 50, expectedYield: 48, year: 2025, season: "summer", crop: "corn" }] }] }, params: { year: 2025 },
      // actual=50*100=5000; expected=48*100=4800; variance=(5000-4800)/4800=4.17% (filter by year=2025)
      assert: r => near(r.totalActualYield, 5000, 1) && near(r.totalExpectedYield, 4800, 1) && near(r.overallVariancePct, 4.17, 0.05),
      show: r => `act=${r.totalActualYield} exp=${r.totalExpectedYield} var=${r.overallVariancePct}%` },
    { dom: "agriculture", act: "waterSchedule", data: { fields: [{ crop: "corn", acreage: 100, soilType: "sandy" }] },
      // ET formula baseline (no forecast → temp 80, factor 1.0): corn(0.3)/sandy(0.6)=0.5"/day; daysAhead=7 → 3.5" total
      assert: r => { const f = r.fields?.[0]; return near(f?.schedule?.[0]?.irrigationNeededInches, 0.5, 0.01) && near(f?.totalIrrigationInches, 3.5, 0.02); },
      show: r => `perDay=${r.fields?.[0]?.schedule?.[0]?.irrigationNeededInches}" total=${r.fields?.[0]?.totalIrrigationInches}"` },
  ],

  // ───────────────────────── geology ─────────────────────────
  geology: [
    { dom: "geology", act: "seismicRisk", data: { latitude: 37, longitude: -122, soilType: "soft-soil" },
      // amp=1.6 (table); baseRisk=0.8 (SF zone)→80; adjusted=min(1,0.8*1.6)=1.0→100; high
      assert: r => near(r.amplificationFactor, 1.6) && near(r.baseSeismicRisk, 80) && near(r.adjustedRisk, 100) && r.riskLevel === "high",
      show: r => `amp=${r.amplificationFactor} base=${r.baseSeismicRisk} adj=${r.adjustedRisk} ${r.riskLevel}` },
    { dom: "geology", act: "mineralId", data: { hardness: 7, streak: "white", cleavage: "none", specificGravity: 2.65, color: "clear" },
      // score = 25(hardness>0)+20(streak)+20(cleavage)+20(sg>0)+15(color) = 100
      assert: r => near(r.identificationConfidence, 100),
      show: r => `confidence=${r.identificationConfidence}` },
  ],

  // ───────────────────────── crypto ─────────────────────────
  crypto: [
    { dom: "crypto", act: "portfolioAnalysis", data: { holdings: [{ token: "BTC", amount: 1, priceUsd: 60000, costBasis: 40000 }, { token: "ETH", amount: 10, priceUsd: 2000, costBasis: 25000 }] },
      // values 60000/20000; total=80000; weights 75/25; HHI=0.75²+0.25²=0.625→critical; PnL=(80000-65000)/65000=23.08%
      assert: r => near(r.totalValue, 80000) && near(r.hhi, 0.625, 1e-3) && r.concentrationRisk === "critical" && near(r.overallPnlPercent, 23.08, 0.02),
      show: r => `total=${r.totalValue} hhi=${r.hhi} ${r.concentrationRisk} pnl=${r.overallPnlPercent}%` },
  ],

  // ───────────────────────── cooking ─────────────────────────
  cooking: [
    { dom: "cooking", act: "scaleRecipe", data: { servings: 4, targetServings: 8, ingredients: [{ name: "flour", quantity: 2, unit: "cup" }] },
      // factor=8/4=2; 2 cup → 4 cup
      assert: r => near(r.scaleFactor, 2) && /(^|\D)4(\D|$)/.test(r.ingredients?.[0]?.scaled || ""),
      show: r => `factor=${r.scaleFactor} scaled=${r.ingredients?.[0]?.scaled}` },
    { dom: "cooking", act: "nutritionEstimate", data: { ingredients: [{ name: "butter", grams: 100 }], servings: 1 },
      // butter 717 cal/100g × 1 = 717
      assert: r => near(r.totalCalories, 717) && near(r.perServing, 717),
      show: r => `cal=${r.totalCalories} perServing=${r.perServing}` },
  ],

  // ───────────────────────── automotive ─────────────────────────
  automotive: [
    { dom: "automotive", act: "fuelEfficiency", data: { fillups: [{ mileage: 1000, gallons: 10 }, { mileage: 1300, gallons: 10, pricePerGallon: 3 }] },
      // 300 mi / 10 gal = 30 MPG
      assert: r => near(r.avgMPG, 30, 0.1) && near(r.bestMPG, 30, 0.1) && near(r.worstMPG, 30, 0.1),
      show: r => `avg=${r.avgMPG} best=${r.bestMPG} worst=${r.worstMPG}` },
    { dom: "automotive", act: "repairEstimate", data: { repairs: [{ name: "brakes", partsCost: 200, laborHours: 2, laborRate: 100 }], shopRate: 120 },
      // labor=2*100=200; total=400; tax=8%→32; withTax=432
      assert: r => near(r.grandTotal, 400) && near(r.tax, 32) && near(r.totalWithTax, 432),
      show: r => `total=${r.grandTotal} tax=${r.tax} withTax=${r.totalWithTax}` },
  ],

  // ───────────────────────── aviation ─────────────────────────
  aviation: [
    { dom: "aviation", act: "calculate-wb", data: { aircraft: { emptyWeight: 1500, emptyArm: 39 }, loading: [{ weight: 340, arm: 37 }, { weight: 100, arm: 95 }] },
      // moment=1500*39+340*37+100*95=58500+12580+9500=80580; gross=1940; cg=80580/1940=41.54
      assert: r => near(r.grossWeight, 1940, 0.1) && near(r.cg, 41.54, 0.02),
      show: r => `gross=${r.grossWeight} cg=${r.cg}` },
    { dom: "aviation", act: "perf-takeoff", params: { pressureAlt: 0, oat: 15, weight: 2200, headwind: 0, slope: 0 },
      // all factors=1 at sea level/ISA/2200lb → groundRoll=860; over50ft=round(860*1.83)=1574
      assert: r => near(r.groundRoll_ft, 860, 1) && near(r.over50ft_ft, 1574, 2),
      show: r => `roll=${r.groundRoll_ft} over50=${r.over50ft_ft}` },
  ],

  // ───────────────────────── photography ─────────────────────────
  photography: [
    { dom: "photography", act: "printSize", data: { widthPixels: 6000, heightPixels: 4000, dpi: 300 },
      // 6000*4000/1e6=24 MP; 6000/300=20" wide @300dpi
      assert: r => near(r.megapixels, 24, 0.1) && /(^|\D)20(\D|$)/.test(r.maxPrintAt300DPI || JSON.stringify(r.maxPrint || "")),
      show: r => `MP=${r.megapixels} print=${r.maxPrintAt300DPI || JSON.stringify(r.maxPrint)}` },
  ],

  // ───────────────────────── welding ─────────────────────────
  welding: [
    { dom: "welding", act: "heatInput", data: { voltage: 25, amperage: 150, travelSpeed: 5, efficiency: 0.8 },
      // HI=(25*150*0.8)/5=600 J/mm=0.6 kJ/mm; 0.6<1.5→low
      assert: r => near(numIn(r.heatInput), 0.6, 0.01) && near(r.heatInputJoules, 600, 1) && r.distortionRisk === "low",
      show: r => `HI=${r.heatInput} J=${r.heatInputJoules} ${r.distortionRisk}` },
    { dom: "welding", act: "jointStrength", data: { thickness: 6, weldType: "fillet", material: "mild-steel", length: 100 },
      // throat=6*0.707=4.24; shear=400*0.6=240; cap=round(4.242*100*240/1000)=102; safe=round(102/1.5)=68
      assert: r => near(numIn(r.throatSize), 4.2, 0.05) && near(numIn(r.theoreticalCapacity), 102, 1) && near(numIn(r.safeWorkingLoad), 68, 1),
      show: r => `throat=${r.throatSize} cap=${r.theoreticalCapacity} safe=${r.safeWorkingLoad}` },
  ],

  // ───────────────────────── carpentry ─────────────────────────
  carpentry: [
    { dom: "carpentry", act: "boardFootCalc", data: { pieces: [{ thickness: 2, width: 6, length: 96, quantity: 5 }] },
      // BF=(2*6*96)/144=8 each; ×5=40; +15% waste → 46
      assert: r => near(r.pieces?.[0]?.boardFeetEach, 8, 0.01) && near(r.totalBoardFeet, 40, 0.01) && near(r.totalWithWaste, 46, 0.02),
      show: r => `each=${r.pieces?.[0]?.boardFeetEach} total=${r.totalBoardFeet} +waste=${r.totalWithWaste}` },
    { dom: "carpentry", act: "jointStrength", data: { jointType: "mortise-tenon", species: "oak", glued: true },
      // base=90; oak×1.2=108; +glue20=128
      assert: r => near(r.effectiveStrength, 128),
      show: r => `eff=${r.effectiveStrength} base=${r.baseStrength} mult=${r.speciesMultiplier}` },
  ],

  // ───────────────────────── masonry ─────────────────────────
  masonry: [
    { dom: "masonry", act: "materialEstimate", data: { squareFootage: 100, material: "brick" },
      // units=ceil(100*7*1.05)=735; matCost=round(735*0.75)=551; mortar=ceil(2)=2 bags→$24; labor=1500; grand=2075
      assert: r => near(r.unitsNeeded, 735) && near(r.materialCost, 551) && near(r.grandTotal, 2075),
      show: r => `units=${r.unitsNeeded} matCost=${r.materialCost} grand=${r.grandTotal}` },
    { dom: "masonry", act: "wallStrength", data: { heightFeet: 8, thicknessInches: 8, reinforced: true },
      // slenderness=(8*12)/8=12; max(reinforced)=25; 12<=25 → pass
      assert: r => near(r.slendernessRatio, 12) && near(r.maxAllowedRatio, 25) && r.passesSlenderness === true,
      show: r => `slender=${r.slendernessRatio} max=${r.maxAllowedRatio} pass=${r.passesSlenderness}` },
  ],

  // ───────────────────────── manufacturing ─────────────────────────
  manufacturing: [
    { dom: "manufacturing", act: "oeeCalculate", data: { plannedTime: 480, downtime: 80, idealCycleTime: 1, totalPieces: 350, goodPieces: 330 },
      // A=400/480=83%; P=(1*350)/400=88%; Q=330/350=94%; OEE=0.687→69%
      assert: r => near(r.availability, 83) && near(r.performance, 88) && near(r.quality, 94) && near(r.oee, 69),
      show: r => `A=${r.availability} P=${r.performance} Q=${r.quality} OEE=${r.oee}` },
    { dom: "manufacturing", act: "safetyRate", data: { incidents: [{ oshaRecordable: true }, { oshaRecordable: false }], hoursWorked: 200000 },
      // TRIR = 1*200000/200000 = 1.0
      assert: r => near(r.incidentRate, 1, 0.01) && near(r.recordableIncidents, 1),
      show: r => `TRIR=${r.incidentRate} rec=${r.recordableIncidents}` },
    { dom: "manufacturing", act: "bomCost", data: { components: [{ name: "A", quantity: 2, unitCost: 10 }, { name: "B", quantity: 3, unitCost: 5 }] },
      // 2*10 + 3*5 = 35
      assert: r => near(r.totalCost, 35),
      show: r => `total=${r.totalCost}` },
  ],
};

// ── runner ──
const only = process.argv[2];
const batchNames = only ? [only] : Object.keys(BATCHES);
let pass = 0, fail = 0, err = 0;
const failures = [];

console.log(`\nBusiness-logic value assertions — WAVE 2 (in-process)\n`);
for (const bn of batchNames) {
  const cases = BATCHES[bn];
  if (!cases) { console.log(`${C.y}no batch '${bn}'${C.rst}`); continue; }
  console.log(`${C.dim}── ${bn} ──${C.rst}`);
  for (const c of cases) {
    if (c.seed) { await runLensAction(c.dom, c.seed.act, c.seed.data || {}, c.seed.params || {}); }
    const raw = await runLensAction(c.dom, c.act, c.data || {}, c.params || {});
    const result = raw && typeof raw === "object" && "result" in raw ? raw.result : raw;
    let ok = false, shown = "";
    try { ok = !!(raw?.ok !== false) && c.assert(result); shown = c.show ? c.show(result || {}) : ""; }
    catch (e) { ok = false; shown = `assert threw: ${e?.message}`; }
    if (raw?.ok === false) { err++; failures.push([`${c.dom}.${c.act}`, `handler error: ${raw.error}`]); console.log(`  ${C.y}ERR ${C.rst}${c.dom}.${c.act}  ${C.dim}${raw.error}${C.rst}`); continue; }
    if (ok) { pass++; console.log(`  ${C.g}PASS${C.rst} ${c.dom}.${c.act}  ${C.dim}${shown}${C.rst}`); }
    else { fail++; failures.push([`${c.dom}.${c.act}`, shown]); console.log(`  ${C.r}FAIL${C.rst} ${c.dom}.${c.act}  ${C.dim}${shown}${C.rst}`); }
  }
}

console.log(`\n${C.g}${pass} pass${C.rst}  ${fail ? C.r : C.dim}${fail} fail${C.rst}  ${err ? C.y : C.dim}${err} err${C.rst}`);
if (failures.length) { console.log(`\n${C.r}Failures / errors to triage:${C.rst}`); for (const [k, v] of failures) console.log(`  • ${k}  ${C.dim}${v}${C.rst}`); }
setImmediate(() => process.exit((fail > 0 || err > 0) ? 1 : 0)); // defer past V8 async-module fulfillment (exit-133 race)
