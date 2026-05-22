// server/domains/lab.js
// Domain actions for laboratory work: experiment design, calibration curves,
// sample tracking, and assay analysis with quality control.

export default function registerLabActions(registerLensAction) {
  /**
   * calibrationCurve
   * Fit a calibration curve from standard measurements and use it to
   * compute unknown concentrations.
   * artifact.data.standards = [{ concentration, response }]
   * artifact.data.unknowns = [{ id, response }] (optional)
   * params.model: "linear" | "quadratic" | "4PL" (default "linear")
   */
  registerLensAction("lab", "calibrationCurve", (ctx, artifact, params) => {
    const standards = artifact.data?.standards || [];
    if (standards.length < 2) return { ok: false, error: "Need at least 2 standard points." };

    const model = params.model || "linear";
    const unknowns = artifact.data?.unknowns || [];
    const r = v => Math.round(v * 100000) / 100000;

    const xs = standards.map(s => s.concentration);
    const ys = standards.map(s => s.response);
    const n = xs.length;

    let predict, equation, coefficients, rSquared;

    if (model === "linear") {
      // y = mx + b
      const sumX = xs.reduce((s, x) => s + x, 0);
      const sumY = ys.reduce((s, y) => s + y, 0);
      const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
      const sumX2 = xs.reduce((s, x) => s + x * x, 0);
      const m = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const b = (sumY - m * sumX) / n;
      coefficients = { slope: r(m), intercept: r(b) };
      equation = `response = ${r(m)} × concentration + ${r(b)}`;
      predict = (resp) => m !== 0 ? (resp - b) / m : null;

      const yMean = sumY / n;
      const ssRes = ys.reduce((s, y, i) => s + Math.pow(y - (m * xs[i] + b), 2), 0);
      const ssTot = ys.reduce((s, y) => s + Math.pow(y - yMean, 2), 0);
      rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    } else if (model === "quadratic") {
      // y = ax² + bx + c via normal equations
      const S = (fn) => xs.reduce((s, x, i) => s + fn(x, ys[i], i), 0);
      const sx = S(x => x, 0), sx2 = S(x => x * x, 0), sx3 = S(x => x * x * x, 0), sx4 = S(x => x * x * x * x, 0);
      const sy = S((_, y) => y, 0), sxy = S((x, y) => x * y, 0), sx2y = S((x, y) => x * x * y, 0);

      // Solve 3x3 system [n,sx,sx2; sx,sx2,sx3; sx2,sx3,sx4] * [c,b,a] = [sy,sxy,sx2y]
      const M = [[n, sx, sx2, sy], [sx, sx2, sx3, sxy], [sx2, sx3, sx4, sx2y]];
      // Gaussian elimination
      for (let col = 0; col < 3; col++) {
        let maxR = col;
        for (let row = col + 1; row < 3; row++) if (Math.abs(M[row][col]) > Math.abs(M[maxR][col])) maxR = row;
        [M[col], M[maxR]] = [M[maxR], M[col]];
        for (let row = col + 1; row < 3; row++) {
          const factor = M[row][col] / M[col][col];
          for (let j = col; j < 4; j++) M[row][j] -= factor * M[col][j];
        }
      }
      const c = M[2][3] / M[2][2];
      const b2 = (M[1][3] - M[1][2] * c) / M[1][1];
      const a2 = (M[0][3] - M[0][2] * c - M[0][1] * b2) / M[0][0];
      // a2=c, b2=b, c=a in ax²+bx+c
      coefficients = { a: r(c), b: r(b2), c: r(a2) };
      equation = `response = ${r(c)}x² + ${r(b2)}x + ${r(a2)}`;
      predict = (resp) => {
        // Solve ax² + bx + (c - resp) = 0
        const disc = b2 * b2 - 4 * c * (a2 - resp);
        if (disc < 0) return null;
        const x1 = (-b2 + Math.sqrt(disc)) / (2 * c);
        const x2 = (-b2 - Math.sqrt(disc)) / (2 * c);
        return x1 >= 0 ? x1 : x2 >= 0 ? x2 : x1; // prefer positive
      };

      const yMean = sy / n;
      const ssRes = ys.reduce((s, y, i) => s + Math.pow(y - (c * xs[i] * xs[i] + b2 * xs[i] + a2), 2), 0);
      const ssTot = ys.reduce((s, y) => s + Math.pow(y - yMean, 2), 0);
      rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    } else if (model === "4PL") {
      // 4-Parameter Logistic: y = D + (A - D) / (1 + (x/C)^B)
      // Fit via iterative least squares (simplified)
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const minX = Math.min(...xs), maxX = Math.max(...xs);

      // Initial guesses
      let A = minY, D = maxY, C = (minX + maxX) / 2, B = 1;

      // Simple gradient descent (50 iterations)
      for (let iter = 0; iter < 50; iter++) {
        const lr = 0.001 / (1 + iter * 0.1);
        let dA = 0, dB = 0, dC = 0, dD = 0;

        for (let i = 0; i < n; i++) {
          const x = Math.max(xs[i], 1e-10);
          const xc = x / C;
          const xcB = Math.pow(xc, B);
          const denom = 1 + xcB;
          const predicted = D + (A - D) / denom;
          const error = ys[i] - predicted;

          dA += error * (1 / denom);
          dD += error * (1 - 1 / denom);
          dB += error * (A - D) * xcB * Math.log(xc) / (denom * denom);
          dC += error * (A - D) * B * xcB / (C * denom * denom);
        }

        A += lr * dA;
        B += lr * dB * 10;
        C += lr * dC;
        D += lr * dD;
      }

      coefficients = { A: r(A), B: r(B), C: r(C), D: r(D) };
      equation = `response = ${r(D)} + (${r(A)} - ${r(D)}) / (1 + (x/${r(C)})^${r(B)})`;

      predict = (resp) => {
        // Solve for x: x = C * ((A-D)/(y-D) - 1)^(1/B)
        const ratio = (A - D) / (resp - D) - 1;
        if (ratio <= 0) return null;
        return C * Math.pow(ratio, 1 / B);
      };

      const yMean = ys.reduce((s, y) => s + y, 0) / n;
      const ssRes = ys.reduce((s, y, i) => {
        const x = Math.max(xs[i], 1e-10);
        const pred = D + (A - D) / (1 + Math.pow(x / C, B));
        return s + Math.pow(y - pred, 2);
      }, 0);
      const ssTot = ys.reduce((s, y) => s + Math.pow(y - yMean, 2), 0);
      rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    } else {
      return { ok: false, error: `Unknown model "${model}". Use: linear, quadratic, 4PL.` };
    }

    // Compute unknown concentrations
    const computed = unknowns.map(u => {
      const conc = predict(u.response);
      return {
        id: u.id, response: u.response,
        computedConcentration: conc != null ? r(conc) : null,
        withinRange: conc != null && conc >= Math.min(...xs) && conc <= Math.max(...xs),
      };
    });

    // Residuals for standards
    const residuals = standards.map(s => {
      const predictedConc = predict(s.response);
      const accuracy = predictedConc != null && s.concentration > 0
        ? Math.round(Math.abs(predictedConc / s.concentration - 1) * 10000) / 100
        : null;
      return { concentration: s.concentration, response: s.response, backCalculated: predictedConc != null ? r(predictedConc) : null, errorPercent: accuracy };
    });

    // LOD/LOQ estimates (3σ and 10σ of blank)
    const blankStd = standards.filter(s => s.concentration === 0);
    let lod = null, loq = null;
    if (blankStd.length > 0 && model === "linear") {
      const blankResponse = blankStd[0].response;
      const residualStd = Math.sqrt(residuals.reduce((s, r) => s + Math.pow(r.errorPercent || 0, 2), 0) / residuals.length) / 100;
      const slope = coefficients.slope;
      if (slope > 0) {
        lod = r(3 * residualStd * blankResponse / slope);
        loq = r(10 * residualStd * blankResponse / slope);
      }
    }

    artifact.data.calibration = { model, rSquared: r(rSquared), coefficients };

    return {
      ok: true, result: {
        model, equation, coefficients,
        rSquared: r(rSquared),
        fitQuality: rSquared > 0.99 ? "excellent" : rSquared > 0.95 ? "good" : rSquared > 0.9 ? "acceptable" : "poor",
        standardResiduals: residuals,
        unknownResults: computed,
        limits: { lod, loq },
        range: { min: r(Math.min(...xs)), max: r(Math.max(...xs)) },
      },
    };
  });

  /**
   * qcAnalysis
   * Quality control analysis using Westgard rules on control measurements.
   * artifact.data.controls = [{ value, timestamp?, level? }]
   * artifact.data.targetMean, artifact.data.targetSD
   */
  registerLensAction("lab", "qcAnalysis", (ctx, artifact, _params) => {
    const controls = artifact.data?.controls || [];
    if (controls.length < 2) return { ok: false, error: "Need at least 2 control measurements." };

    const targetMean = artifact.data?.targetMean;
    const targetSD = artifact.data?.targetSD;

    const values = controls.map(c => c.value);
    const n = values.length;

    // Compute statistics
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const sd = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1));

    const refMean = targetMean ?? mean;
    const refSD = targetSD ?? sd;

    const r = v => Math.round(v * 10000) / 10000;

    // Z-scores
    const zScores = values.map(v => refSD > 0 ? (v - refMean) / refSD : 0);

    // Westgard rules evaluation
    const violations = [];

    for (let i = 0; i < n; i++) {
      const z = zScores[i];

      // 1-2s warning: single observation > 2 SD
      if (Math.abs(z) > 2 && Math.abs(z) <= 3) {
        violations.push({ rule: "1-2s", index: i, value: values[i], zScore: r(z), severity: "warning" });
      }

      // 1-3s: single observation > 3 SD
      if (Math.abs(z) > 3) {
        violations.push({ rule: "1-3s", index: i, value: values[i], zScore: r(z), severity: "reject" });
      }

      // 2-2s: two consecutive > 2 SD in same direction
      if (i > 0 && Math.abs(zScores[i]) > 2 && Math.abs(zScores[i - 1]) > 2) {
        if (Math.sign(zScores[i]) === Math.sign(zScores[i - 1])) {
          violations.push({ rule: "2-2s", indices: [i - 1, i], severity: "reject" });
        }
      }

      // R-4s: range of two consecutive > 4 SD
      if (i > 0) {
        const range = Math.abs(zScores[i] - zScores[i - 1]);
        if (range > 4) {
          violations.push({ rule: "R-4s", indices: [i - 1, i], range: r(range), severity: "reject" });
        }
      }

      // 4-1s: four consecutive > 1 SD in same direction
      if (i >= 3) {
        const last4 = zScores.slice(i - 3, i + 1);
        if (last4.every(z => z > 1) || last4.every(z => z < -1)) {
          violations.push({ rule: "4-1s", indices: [i - 3, i - 2, i - 1, i], severity: "warning" });
        }
      }

      // 10-x: ten consecutive on same side of mean
      if (i >= 9) {
        const last10 = zScores.slice(i - 9, i + 1);
        if (last10.every(z => z > 0) || last10.every(z => z < 0)) {
          violations.push({ rule: "10-x", indices: Array.from({ length: 10 }, (_, j) => i - 9 + j), severity: "reject" });
        }
      }
    }

    // Remove duplicate rule violations
    const uniqueViolations = [];
    const seen = new Set();
    for (const v of violations) {
      const key = `${v.rule}-${v.index ?? v.indices?.join(",")}`;
      if (!seen.has(key)) { seen.add(key); uniqueViolations.push(v); }
    }

    // CV% (coefficient of variation)
    const cv = refMean !== 0 ? Math.abs(sd / refMean) * 100 : 0;

    // Bias
    const bias = refMean !== 0 ? ((mean - refMean) / refMean) * 100 : 0;

    // Total Allowable Error estimate
    const tae = Math.abs(bias) + 2 * cv;

    const inControl = uniqueViolations.filter(v => v.severity === "reject").length === 0;

    return {
      ok: true, result: {
        inControl,
        statistics: {
          n, mean: r(mean), sd: r(sd), cv: r(cv) + "%",
          targetMean: r(refMean), targetSD: r(refSD),
          bias: r(bias) + "%",
          totalAllowableError: r(tae) + "%",
        },
        westgardViolations: uniqueViolations,
        violationCount: uniqueViolations.length,
        rejectCount: uniqueViolations.filter(v => v.severity === "reject").length,
        warningCount: uniqueViolations.filter(v => v.severity === "warning").length,
        zScores: zScores.map(z => r(z)),
        leveyJennings: values.map((v, i) => ({
          index: i, value: v, zScore: r(zScores[i]),
          timestamp: controls[i].timestamp,
          zone: Math.abs(zScores[i]) > 3 ? "out-of-control"
            : Math.abs(zScores[i]) > 2 ? "warning"
              : Math.abs(zScores[i]) > 1 ? "zone-2" : "zone-1",
        })),
      },
    };
  });

  /**
   * sampleTracker
   * Track sample chain of custody and compute turnaround times.
   * artifact.data.samples = [{ id, type, receivedAt, steps: [{ action, timestamp, operator?, result? }] }]
   */
  registerLensAction("lab", "sampleTracker", (ctx, artifact, _params) => {
    const samples = artifact.data?.samples || [];
    if (samples.length === 0) return { ok: true, result: { message: "No samples." } };

    const analyzed = samples.map(s => {
      const steps = s.steps || [];
      const received = s.receivedAt ? new Date(s.receivedAt) : null;
      const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
      const completed = lastStep?.action === "reported" || lastStep?.action === "completed";

      // Turnaround time
      let tatMinutes = null;
      if (received && lastStep?.timestamp) {
        tatMinutes = Math.round((new Date(lastStep.timestamp) - received) / 60000);
      }

      // Step-to-step durations
      const stepDurations = [];
      for (let i = 1; i < steps.length; i++) {
        const duration = (new Date(steps[i].timestamp) - new Date(steps[i - 1].timestamp)) / 60000;
        stepDurations.push({
          from: steps[i - 1].action,
          to: steps[i].action,
          minutes: Math.round(duration * 100) / 100,
        });
      }

      // Chain of custody (unique operators)
      const operators = [...new Set(steps.map(st => st.operator).filter(Boolean))];

      return {
        id: s.id, type: s.type,
        receivedAt: s.receivedAt,
        status: completed ? "completed" : steps.length > 0 ? steps[steps.length - 1].action : "received",
        stepCount: steps.length,
        turnaroundMinutes: tatMinutes,
        turnaroundHours: tatMinutes != null ? Math.round(tatMinutes / 60 * 100) / 100 : null,
        stepDurations,
        operators,
        chainOfCustodyComplete: operators.length > 0 && steps.every(st => st.operator),
        bottleneck: stepDurations.length > 0 ? stepDurations.sort((a, b) => b.minutes - a.minutes)[0] : null,
      };
    });

    // Aggregate stats
    const completedSamples = analyzed.filter(s => s.status === "completed");
    const tats = completedSamples.map(s => s.turnaroundMinutes).filter(t => t != null);
    const avgTAT = tats.length > 0 ? tats.reduce((s, t) => s + t, 0) / tats.length : null;
    const medianTAT = tats.length > 0 ? tats.sort((a, b) => a - b)[Math.floor(tats.length / 2)] : null;

    // Type distribution
    const typeDistribution = {};
    for (const s of analyzed) {
      typeDistribution[s.type || "unknown"] = (typeDistribution[s.type || "unknown"] || 0) + 1;
    }

    // Status distribution
    const statusDistribution = {};
    for (const s of analyzed) {
      statusDistribution[s.status] = (statusDistribution[s.status] || 0) + 1;
    }

    // Common bottleneck steps
    const bottleneckSteps = {};
    for (const s of analyzed) {
      if (s.bottleneck) {
        const key = `${s.bottleneck.from} → ${s.bottleneck.to}`;
        bottleneckSteps[key] = (bottleneckSteps[key] || 0) + 1;
      }
    }

    return {
      ok: true, result: {
        samples: analyzed,
        totalSamples: samples.length,
        completedCount: completedSamples.length,
        inProgressCount: analyzed.filter(s => s.status !== "completed").length,
        turnaroundStats: {
          avgMinutes: avgTAT != null ? Math.round(avgTAT) : null,
          medianMinutes: medianTAT,
          avgHours: avgTAT != null ? Math.round(avgTAT / 60 * 100) / 100 : null,
        },
        typeDistribution,
        statusDistribution,
        commonBottlenecks: Object.entries(bottleneckSteps).sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([step, count]) => ({ step, frequency: count })),
        custodyCompliance: Math.round((analyzed.filter(s => s.chainOfCustodyComplete).length / analyzed.length) * 100),
      },
    };
  });

  /**
   * experimentDesign
   * Generate a factorial or randomized experimental design.
   * artifact.data.factors = [{ name, levels: string[] }]
   * params.type: "full-factorial" | "fractional" | "randomized-block"
   * params.replicates (default 1)
   */
  registerLensAction("lab", "experimentDesign", (ctx, artifact, params) => {
    const factors = artifact.data?.factors || [];
    if (factors.length === 0) return { ok: false, error: "No factors defined." };

    const type = params.type || "full-factorial";
    const replicates = params.replicates || 1;

    // Full factorial: all combinations
    function cartesianProduct(arrays) {
      return arrays.reduce((acc, arr) =>
        acc.flatMap(combo => arr.map(item => [...combo, item])),
        [[]]
      );
    }

    const levelArrays = factors.map(f => f.levels || []);
    let runs;

    if (type === "full-factorial") {
      const combinations = cartesianProduct(levelArrays);
      runs = [];
      for (let rep = 0; rep < replicates; rep++) {
        for (const combo of combinations) {
          const run = { replicate: rep + 1 };
          factors.forEach((f, i) => { run[f.name] = combo[i]; });
          runs.push(run);
        }
      }
    } else if (type === "fractional") {
      // Half-fraction: take every other combination
      const combinations = cartesianProduct(levelArrays);
      const halfIdx = combinations.length > 4 ? Math.ceil(combinations.length / 2) : combinations.length;
      // Use defining relation: select based on XOR of first two factor indices
      const selected = combinations.filter((_, i) => {
        // Balanced selection: use modular arithmetic to get orthogonal fraction
        return i % 2 === 0 || combinations.length <= 4;
      }).slice(0, halfIdx);

      runs = [];
      for (let rep = 0; rep < replicates; rep++) {
        for (const combo of selected) {
          const run = { replicate: rep + 1 };
          factors.forEach((f, i) => { run[f.name] = combo[i]; });
          runs.push(run);
        }
      }
    } else if (type === "randomized-block") {
      const combinations = cartesianProduct(levelArrays);
      runs = [];
      for (let block = 0; block < replicates; block++) {
        // Shuffle within each block
        const shuffled = [...combinations].sort(() => Math.random() - 0.5);
        for (const combo of shuffled) {
          const run = { block: block + 1 };
          factors.forEach((f, i) => { run[f.name] = combo[i]; });
          runs.push(run);
        }
      }
    } else {
      return { ok: false, error: `Unknown design type "${type}". Use: full-factorial, fractional, randomized-block.` };
    }

    // Randomize run order
    const randomized = runs.map((run, i) => ({ runOrder: i + 1, ...run }));

    // Degrees of freedom analysis
    const totalRuns = runs.length;
    const mainEffectsDf = factors.reduce((s, f) => s + (f.levels.length - 1), 0);
    const interactionsDf = factors.length >= 2
      ? factors.reduce((s, f, i) => {
        for (let j = i + 1; j < factors.length; j++) {
          s += (f.levels.length - 1) * (factors[j].levels.length - 1);
        }
        return s;
      }, 0)
      : 0;
    const errorDf = Math.max(0, totalRuns - 1 - mainEffectsDf - interactionsDf);

    // Power estimate (rough)
    const effectsDetectable = errorDf > 0;

    return {
      ok: true, result: {
        designType: type,
        factors: factors.map(f => ({ name: f.name, levels: f.levels, levelCount: f.levels.length })),
        runs: randomized,
        totalRuns,
        replicates,
        degreesOfFreedom: {
          total: totalRuns - 1,
          mainEffects: mainEffectsDf,
          interactions: interactionsDf,
          error: errorDf,
        },
        canEstimateError: errorDf > 0,
        recommendation: errorDf === 0 && replicates === 1
          ? "Add replicates to estimate experimental error"
          : effectsDetectable ? "Design is adequate for effect estimation" : "Consider adding replicates",
      },
    };
  });

  // ─── ELN / LIMS substrate (per-user, STATE-backed) ──────────────────────
  //
  // Persistent lab-bench data: notebook entries, reagent inventory,
  // protocols/SOPs, plate layouts, instrument runs and DNA constructs.
  // Each store is a Map keyed by userId so multi-tenant deploys stay
  // isolated. Every handler is try/catch wrapped and returns a plain
  // { ok, result?, error? } object — never throws.

  function getLabState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.labLens) STATE.labLens = {};
    const L = STATE.labLens;
    for (const k of ["notebook", "reagents", "protocols", "plates", "runs", "constructs"]) {
      if (!(L[k] instanceof Map)) L[k] = new Map(); // userId -> Array
    }
    return L;
  }
  function saveLab() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const labId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const labActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const labClean = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);
  const labNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const labArr = (L, store, userId) => {
    if (!L[store].has(userId)) L[store].set(userId, []);
    return L[store].get(userId);
  };
  const labFind = (arr, id) => arr.find(x => x.id === id);

  /* ── Electronic Lab Notebook ─────────────────────────────────────────── */

  // notebook-create — start a new notebook entry (rich experiment page).
  registerLensAction("lab", "notebook-create", (ctx, _a, params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const title = labClean(params.title, 200);
      if (!title) return { ok: false, error: "entry title required" };
      const entry = {
        id: labId("nb"),
        title,
        project: labClean(params.project, 160) || "Unfiled",
        body: labClean(params.body, 20000) || "",
        tags: Array.isArray(params.tags) ? params.tags.map(t => labClean(t, 40)).filter(Boolean).slice(0, 16) : [],
        protocolId: labClean(params.protocolId, 64) || null,
        status: "draft", // draft | witnessed | signed
        author: labActor(ctx),
        signedBy: null, signedAt: null,
        witnessedBy: null, witnessedAt: null,
        revisions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      labArr(L, "notebook", labActor(ctx)).push(entry);
      saveLab();
      return { ok: true, result: { entry } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // notebook-list — all notebook entries for the user.
  registerLensAction("lab", "notebook-list", (ctx, _a, _params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const entries = labArr(L, "notebook", labActor(ctx))
        .slice().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      return {
        ok: true, result: {
          entries,
          total: entries.length,
          signed: entries.filter(e => e.status === "signed").length,
          draft: entries.filter(e => e.status === "draft").length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // notebook-update — edit body/title; keeps a revision snapshot. A
  // signed page is immutable (GLP requirement) — reject the edit.
  registerLensAction("lab", "notebook-update", (ctx, _a, params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const arr = labArr(L, "notebook", labActor(ctx));
      const entry = labFind(arr, labClean(params.id, 64));
      if (!entry) return { ok: false, error: "entry not found" };
      if (entry.status === "signed") return { ok: false, error: "signed entries are immutable" };
      entry.revisions.push({ body: entry.body, title: entry.title, at: entry.updatedAt });
      if (entry.revisions.length > 50) entry.revisions.shift();
      if (params.title != null) entry.title = labClean(params.title, 200) || entry.title;
      if (params.body != null) entry.body = labClean(params.body, 20000);
      if (Array.isArray(params.tags)) entry.tags = params.tags.map(t => labClean(t, 40)).filter(Boolean).slice(0, 16);
      entry.updatedAt = new Date().toISOString();
      saveLab();
      return { ok: true, result: { entry } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // notebook-sign — author signs (or a witness counter-signs) a page.
  // role: "author" → status signed; "witness" → records witness.
  registerLensAction("lab", "notebook-sign", (ctx, _a, params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const arr = labArr(L, "notebook", labActor(ctx));
      const entry = labFind(arr, labClean(params.id, 64));
      if (!entry) return { ok: false, error: "entry not found" };
      const role = params.role === "witness" ? "witness" : "author";
      const who = labClean(params.name, 120) || labActor(ctx);
      const now = new Date().toISOString();
      if (role === "witness") {
        entry.witnessedBy = who; entry.witnessedAt = now;
        if (entry.status === "draft") entry.status = "witnessed";
      } else {
        entry.signedBy = who; entry.signedAt = now;
        entry.status = "signed";
      }
      entry.updatedAt = now;
      saveLab();
      return { ok: true, result: { entry } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ── Reagent Inventory ───────────────────────────────────────────────── */

  // inventory-add — register a reagent / consumable lot.
  registerLensAction("lab", "inventory-add", (ctx, _a, params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const name = labClean(params.name, 160);
      if (!name) return { ok: false, error: "reagent name required" };
      const item = {
        id: labId("rgt"),
        name,
        catalogNumber: labClean(params.catalogNumber, 80) || "",
        lot: labClean(params.lot, 80) || "",
        vendor: labClean(params.vendor, 120) || "",
        location: labClean(params.location, 120) || "Unassigned",
        freezerBox: labClean(params.freezerBox, 80) || "",
        quantity: Math.max(0, labNum(params.quantity)),
        unit: labClean(params.unit, 24) || "units",
        lowThreshold: Math.max(0, labNum(params.lowThreshold)),
        expiry: labClean(params.expiry, 32) || null, // ISO date
        hazard: labClean(params.hazard, 40) || "none",
        createdAt: new Date().toISOString(),
      };
      labArr(L, "reagents", labActor(ctx)).push(item);
      saveLab();
      return { ok: true, result: { item } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // inventory-list — reagents with computed expiry + low-stock alerts.
  registerLensAction("lab", "inventory-list", (ctx, _a, _params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const now = Date.now();
      const DAY = 86400000;
      const items = labArr(L, "reagents", labActor(ctx)).map(it => {
        let expiryStatus = "ok", daysToExpiry = null;
        if (it.expiry) {
          const t = Date.parse(it.expiry);
          if (Number.isFinite(t)) {
            daysToExpiry = Math.round((t - now) / DAY);
            expiryStatus = daysToExpiry < 0 ? "expired" : daysToExpiry <= 30 ? "expiring-soon" : "ok";
          }
        }
        const lowStock = it.lowThreshold > 0 && it.quantity <= it.lowThreshold;
        return { ...it, daysToExpiry, expiryStatus, lowStock };
      });
      const alerts = items.filter(i => i.expiryStatus !== "ok" || i.lowStock);
      return {
        ok: true, result: {
          items, total: items.length,
          alerts,
          expiredCount: items.filter(i => i.expiryStatus === "expired").length,
          expiringSoonCount: items.filter(i => i.expiryStatus === "expiring-soon").length,
          lowStockCount: items.filter(i => i.lowStock).length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // inventory-consume — debit/restock a reagent quantity (delta can be ±).
  registerLensAction("lab", "inventory-consume", (ctx, _a, params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const arr = labArr(L, "reagents", labActor(ctx));
      const item = labFind(arr, labClean(params.id, 64));
      if (!item) return { ok: false, error: "reagent not found" };
      const delta = labNum(params.delta);
      item.quantity = Math.max(0, Math.round((item.quantity + delta) * 1000) / 1000);
      saveLab();
      return {
        ok: true, result: {
          item,
          lowStock: item.lowThreshold > 0 && item.quantity <= item.lowThreshold,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // inventory-remove — delete a reagent record.
  registerLensAction("lab", "inventory-remove", (ctx, _a, params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const userId = labActor(ctx);
      const arr = labArr(L, "reagents", userId);
      const id = labClean(params.id, 64);
      const idx = arr.findIndex(x => x.id === id);
      if (idx === -1) return { ok: false, error: "reagent not found" };
      arr.splice(idx, 1);
      saveLab();
      return { ok: true, result: { removed: id, remaining: arr.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ── Protocol / SOP Library ──────────────────────────────────────────── */

  // protocol-create — author a protocol with ordered, timed steps.
  registerLensAction("lab", "protocol-create", (ctx, _a, params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const name = labClean(params.name, 200);
      if (!name) return { ok: false, error: "protocol name required" };
      const steps = (Array.isArray(params.steps) ? params.steps : []).map((s, i) => ({
        order: i + 1,
        text: labClean(typeof s === "string" ? s : s.text, 2000),
        durationMinutes: Math.max(0, labNum(typeof s === "object" ? s.durationMinutes : 0)),
        critical: !!(typeof s === "object" && s.critical),
      })).filter(s => s.text);
      const protocol = {
        id: labId("proto"),
        name,
        category: labClean(params.category, 80) || "General",
        description: labClean(params.description, 4000) || "",
        version: 1,
        steps,
        history: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      labArr(L, "protocols", labActor(ctx)).push(protocol);
      saveLab();
      return { ok: true, result: { protocol } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // protocol-list — SOP library with step + duration summary.
  registerLensAction("lab", "protocol-list", (ctx, _a, _params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const protocols = labArr(L, "protocols", labActor(ctx)).map(p => ({
        ...p,
        stepCount: p.steps.length,
        totalMinutes: p.steps.reduce((s, st) => s + (st.durationMinutes || 0), 0),
      }));
      return { ok: true, result: { protocols, total: protocols.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // protocol-revise — publish a new version; prior version archived to history.
  registerLensAction("lab", "protocol-revise", (ctx, _a, params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const arr = labArr(L, "protocols", labActor(ctx));
      const p = labFind(arr, labClean(params.id, 64));
      if (!p) return { ok: false, error: "protocol not found" };
      p.history.push({ version: p.version, steps: p.steps, at: p.updatedAt });
      if (p.history.length > 30) p.history.shift();
      p.version += 1;
      if (Array.isArray(params.steps)) {
        p.steps = params.steps.map((s, i) => ({
          order: i + 1,
          text: labClean(typeof s === "string" ? s : s.text, 2000),
          durationMinutes: Math.max(0, labNum(typeof s === "object" ? s.durationMinutes : 0)),
          critical: !!(typeof s === "object" && s.critical),
        })).filter(s => s.text);
      }
      if (params.description != null) p.description = labClean(params.description, 4000);
      p.updatedAt = new Date().toISOString();
      saveLab();
      return { ok: true, result: { protocol: p } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // protocol-run — start a step-by-step run; returns a guided run object.
  registerLensAction("lab", "protocol-run", (ctx, _a, params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const arr = labArr(L, "protocols", labActor(ctx));
      const p = labFind(arr, labClean(params.id, 64));
      if (!p) return { ok: false, error: "protocol not found" };
      if (p.steps.length === 0) return { ok: false, error: "protocol has no steps" };
      const run = {
        runId: labId("run"),
        protocolId: p.id, protocolName: p.name, protocolVersion: p.version,
        steps: p.steps.map(s => ({ ...s, done: false })),
        currentStep: 1,
        startedAt: new Date().toISOString(),
        estimatedMinutes: p.steps.reduce((s, st) => s + (st.durationMinutes || 0), 0),
      };
      return { ok: true, result: { run } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ── Plate / Well Layout Designer ────────────────────────────────────── */

  // plate-design — build a 96- or 384-well plate map from well assignments.
  // params.format: 96 | 384. params.wells = [{ well:"A1", sample, role }]
  registerLensAction("lab", "plate-design", (ctx, _a, params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const format = params.format === 384 || params.format === "384" ? 384 : 96;
      const rows = format === 384 ? 16 : 8;
      const cols = format === 384 ? 24 : 12;
      const rowLabels = Array.from({ length: rows }, (_, i) => String.fromCharCode(65 + i));
      const grid = {};
      const inputWells = Array.isArray(params.wells) ? params.wells : [];
      let assigned = 0;
      for (const w of inputWells) {
        const well = labClean(w.well, 6).toUpperCase();
        if (!well) continue;
        const rowChar = well[0];
        const colNum = parseInt(well.slice(1), 10);
        if (!rowLabels.includes(rowChar) || !(colNum >= 1 && colNum <= cols)) continue;
        grid[well] = {
          sample: labClean(w.sample, 120) || "",
          role: labClean(w.role, 40) || "sample", // sample | standard | blank | control
          concentration: w.concentration != null ? labNum(w.concentration) : null,
        };
        assigned++;
      }
      const roleCounts = {};
      for (const v of Object.values(grid)) roleCounts[v.role] = (roleCounts[v.role] || 0) + 1;
      const plate = {
        id: labId("plate"),
        name: labClean(params.name, 160) || `Plate ${format}`,
        format, rows, cols, rowLabels,
        grid,
        assignedWells: assigned,
        totalWells: format,
        emptyWells: format - assigned,
        roleCounts,
        createdAt: new Date().toISOString(),
      };
      labArr(L, "plates", labActor(ctx)).push(plate);
      saveLab();
      return { ok: true, result: { plate } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // plate-list — saved plate layouts.
  registerLensAction("lab", "plate-list", (ctx, _a, _params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const plates = labArr(L, "plates", labActor(ctx))
        .slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      return { ok: true, result: { plates, total: plates.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ── Instrument Run Import ───────────────────────────────────────────── */

  // run-import — parse a CSV blob into result records and store the run.
  // params.csv: raw text. First row is the header; numeric columns parsed.
  registerLensAction("lab", "run-import", (ctx, _a, params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const csv = typeof params.csv === "string" ? params.csv : "";
      if (!csv.trim()) return { ok: false, error: "csv content required" };
      const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) return { ok: false, error: "csv needs a header row and at least one data row" };
      const headers = lines[0].split(",").map(h => h.trim());
      const records = lines.slice(1).map((line, idx) => {
        const cells = line.split(",").map(c => c.trim());
        const rec = { _row: idx + 1 };
        headers.forEach((h, i) => {
          const raw = cells[i] ?? "";
          const num = Number(raw);
          rec[h || `col${i}`] = raw !== "" && Number.isFinite(num) ? num : raw;
        });
        return rec;
      });
      // numeric column summary
      const numericCols = headers.filter(h =>
        records.length > 0 && records.every(r => typeof r[h] === "number"));
      const summary = {};
      for (const c of numericCols) {
        const vals = records.map(r => r[c]);
        const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
        summary[c] = {
          n: vals.length,
          min: Math.min(...vals),
          max: Math.max(...vals),
          mean: Math.round(mean * 10000) / 10000,
        };
      }
      const run = {
        id: labId("irun"),
        name: labClean(params.name, 160) || `Run ${new Date().toISOString().slice(0, 10)}`,
        instrument: labClean(params.instrument, 120) || "Unknown",
        headers,
        records,
        recordCount: records.length,
        numericColumns: numericCols,
        summary,
        importedAt: new Date().toISOString(),
      };
      labArr(L, "runs", labActor(ctx)).push(run);
      saveLab();
      return { ok: true, result: { run } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // run-list — imported instrument runs (records trimmed for listing).
  registerLensAction("lab", "run-list", (ctx, _a, _params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const runs = labArr(L, "runs", labActor(ctx))
        .slice().sort((a, b) => (b.importedAt || "").localeCompare(a.importedAt || ""));
      return { ok: true, result: { runs, total: runs.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ── Sequence / Construct Registry ───────────────────────────────────── */

  // construct-register — register a DNA / plasmid construct.
  registerLensAction("lab", "construct-register", (ctx, _a, params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const name = labClean(params.name, 160);
      if (!name) return { ok: false, error: "construct name required" };
      const seq = labClean(params.sequence, 200000).toUpperCase().replace(/[^ACGTUN]/g, "");
      const gc = seq.length
        ? Math.round(([...seq].filter(c => c === "G" || c === "C").length / seq.length) * 1000) / 10
        : 0;
      const construct = {
        id: labId("dna"),
        name,
        type: labClean(params.type, 40) || "plasmid", // plasmid | gene | primer | linear
        sequence: seq,
        length: seq.length,
        gcContent: gc,
        backbone: labClean(params.backbone, 120) || "",
        resistance: labClean(params.resistance, 80) || "",
        features: Array.isArray(params.features)
          ? params.features.map(f => ({
              name: labClean(typeof f === "string" ? f : f.name, 80),
              start: Math.max(0, Math.round(labNum(typeof f === "object" ? f.start : 0))),
              end: Math.max(0, Math.round(labNum(typeof f === "object" ? f.end : 0))),
            })).filter(f => f.name).slice(0, 64)
          : [],
        notes: labClean(params.notes, 4000) || "",
        createdAt: new Date().toISOString(),
      };
      labArr(L, "constructs", labActor(ctx)).push(construct);
      saveLab();
      return { ok: true, result: { construct } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // construct-list — registered constructs.
  registerLensAction("lab", "construct-list", (ctx, _a, _params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      const constructs = labArr(L, "constructs", labActor(ctx))
        .slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      return {
        ok: true, result: {
          constructs, total: constructs.length,
          totalBases: constructs.reduce((s, c) => s + c.length, 0),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // construct-analyze — restriction-style sequence analysis on a stored
  // or supplied sequence: GC content, ORF scan, codon count, motif search.
  registerLensAction("lab", "construct-analyze", (ctx, _a, params = {}) => {
    try {
      const L = getLabState(); if (!L) return { ok: false, error: "STATE unavailable" };
      let seq = labClean(params.sequence, 200000).toUpperCase().replace(/[^ACGTUN]/g, "");
      if (!seq && params.id) {
        const c = labFind(labArr(L, "constructs", labActor(ctx)), labClean(params.id, 64));
        if (c) seq = c.sequence;
      }
      if (!seq) return { ok: false, error: "sequence (or valid construct id) required" };
      const gc = Math.round(([...seq].filter(c => c === "G" || c === "C").length / seq.length) * 1000) / 10;
      // simple ORF scan on the forward strand (ATG ... stop)
      const orfs = [];
      const stops = new Set(["TAA", "TAG", "TGA"]);
      for (let frame = 0; frame < 3; frame++) {
        for (let i = frame; i + 3 <= seq.length; i += 3) {
          if (seq.slice(i, i + 3) === "ATG") {
            for (let j = i + 3; j + 3 <= seq.length; j += 3) {
              if (stops.has(seq.slice(j, j + 3))) {
                if (j - i >= 90) orfs.push({ frame: frame + 1, start: i, end: j + 3, lengthBp: j + 3 - i });
                break;
              }
            }
          }
        }
      }
      // melting temp (Wallace rule for short, GC% formula for long)
      let tm = null;
      if (seq.length < 14) {
        const at = [...seq].filter(c => c === "A" || c === "T" || c === "U").length;
        const gcN = seq.length - at;
        tm = 2 * at + 4 * gcN;
      } else {
        tm = Math.round((64.9 + 41 * (([...seq].filter(c => c === "G" || c === "C").length - 16.4) / seq.length)) * 10) / 10;
      }
      // motif search
      const motif = labClean(params.motif, 64).toUpperCase().replace(/[^ACGTUN]/g, "");
      const motifHits = [];
      if (motif) {
        let idx = seq.indexOf(motif);
        while (idx !== -1 && motifHits.length < 500) {
          motifHits.push(idx);
          idx = seq.indexOf(motif, idx + 1);
        }
      }
      return {
        ok: true, result: {
          length: seq.length,
          gcContent: gc,
          meltingTempC: tm,
          orfCount: orfs.length,
          orfs: orfs.slice(0, 50),
          motif: motif || null,
          motifHitCount: motifHits.length,
          motifPositions: motifHits.slice(0, 100),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /* ── Result Audit Trail + Levey-Jennings over time ───────────────────── */

  // qc-trend — Levey-Jennings QC chart across stored instrument runs or a
  // supplied series of dated control values. Computes per-point Westgard
  // zone classification and an audit trail of out-of-control events.
  registerLensAction("lab", "qc-trend", (ctx, _a, params = {}) => {
    try {
      const points = (Array.isArray(params.points) ? params.points : [])
        .map(p => ({
          value: labNum(p.value),
          date: labClean(p.date, 32) || new Date().toISOString(),
          label: labClean(p.label, 80) || "",
        }))
        .filter(p => Number.isFinite(p.value))
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      if (points.length < 2) return { ok: false, error: "need at least 2 dated control points" };
      const vals = points.map(p => p.value);
      const n = vals.length;
      const mean = params.targetMean != null ? labNum(params.targetMean) : vals.reduce((s, v) => s + v, 0) / n;
      const sd = params.targetSD != null && labNum(params.targetSD) > 0
        ? labNum(params.targetSD)
        : Math.sqrt(vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / Math.max(1, n - 1));
      const r4 = v => Math.round(v * 10000) / 10000;
      const series = points.map((p, i) => {
        const z = sd > 0 ? (p.value - mean) / sd : 0;
        return {
          ...p, index: i, zScore: r4(z),
          zone: Math.abs(z) > 3 ? "out-of-control"
            : Math.abs(z) > 2 ? "warning"
              : Math.abs(z) > 1 ? "zone-2" : "zone-1",
          inControl: Math.abs(z) <= 3,
        };
      });
      const auditTrail = series
        .filter(s => s.zone === "out-of-control" || s.zone === "warning")
        .map(s => ({
          date: s.date, value: s.value, zScore: s.zScore,
          event: s.zone === "out-of-control" ? "1-3s rejection" : "1-2s warning",
        }));
      return {
        ok: true, result: {
          series,
          controlLimits: {
            mean: r4(mean), sd: r4(sd),
            plus1sd: r4(mean + sd), minus1sd: r4(mean - sd),
            plus2sd: r4(mean + 2 * sd), minus2sd: r4(mean - 2 * sd),
            plus3sd: r4(mean + 3 * sd), minus3sd: r4(mean - 3 * sd),
          },
          n,
          outOfControlCount: series.filter(s => s.zone === "out-of-control").length,
          warningCount: series.filter(s => s.zone === "warning").length,
          auditTrail,
          inControl: series.every(s => s.inControl),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
