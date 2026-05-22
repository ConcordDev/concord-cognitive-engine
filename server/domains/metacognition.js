// server/domains/metacognition.js
// Domain actions for metacognitive monitoring: confidence calibration,
// learning curve modeling, and cognitive bias detection.

export default function registerMetacognitionActions(registerLensAction) {
  /**
   * confidenceCalibration
   * Calibrate prediction confidence — compare predicted vs actual outcomes,
   * compute Brier score and calibration curve.
   * artifact.data.predictions = [{ predicted: number(0-1), actual: 0|1, label? }]
   * params.bins — number of calibration bins (default 10)
   */
  registerLensAction("metacognition", "confidenceCalibration", (ctx, artifact, params) => {
    const predictions = artifact.data?.predictions || [];
    if (predictions.length < 2) {
      return { ok: true, result: { message: "Need at least 2 predictions for calibration.", brierScore: null } };
    }

    const numBins = params.bins || 10;
    const r = (v) => Math.round(v * 10000) / 10000;

    // Validate and parse predictions
    const valid = predictions
      .map(p => ({
        predicted: parseFloat(p.predicted),
        actual: parseInt(p.actual),
        label: p.label || null,
      }))
      .filter(p => !isNaN(p.predicted) && (p.actual === 0 || p.actual === 1)
        && p.predicted >= 0 && p.predicted <= 1);

    if (valid.length < 2) {
      return { ok: true, result: { message: "Insufficient valid predictions (need predicted in [0,1] and actual in {0,1})." } };
    }

    const n = valid.length;

    // --- Brier score: mean of (predicted - actual)^2 ---
    const brierScore = valid.reduce((s, p) => s + Math.pow(p.predicted - p.actual, 2), 0) / n;

    // --- Brier skill score (relative to climatological forecast) ---
    const baseRate = valid.reduce((s, p) => s + p.actual, 0) / n;
    const brierClimatology = baseRate * (1 - baseRate);
    const brierSkillScore = brierClimatology > 0 ? 1 - brierScore / brierClimatology : 0;

    // --- Log loss ---
    const epsilon = 1e-15;
    const logLoss = -valid.reduce((s, p) => {
      const clipped = Math.max(epsilon, Math.min(1 - epsilon, p.predicted));
      return s + (p.actual * Math.log(clipped) + (1 - p.actual) * Math.log(1 - clipped));
    }, 0) / n;

    // --- Calibration curve (binned) ---
    const bins = [];
    for (let i = 0; i < numBins; i++) {
      const lower = i / numBins;
      const upper = (i + 1) / numBins;
      const inBin = valid.filter(p => p.predicted >= lower && (i === numBins - 1 ? p.predicted <= upper : p.predicted < upper));
      if (inBin.length === 0) {
        bins.push({ binRange: [r(lower), r(upper)], count: 0, avgPredicted: null, avgActual: null, gap: null });
        continue;
      }
      const avgPredicted = inBin.reduce((s, p) => s + p.predicted, 0) / inBin.length;
      const avgActual = inBin.reduce((s, p) => s + p.actual, 0) / inBin.length;
      const gap = Math.abs(avgPredicted - avgActual);
      bins.push({
        binRange: [r(lower), r(upper)],
        count: inBin.length,
        avgPredicted: r(avgPredicted),
        avgActual: r(avgActual),
        gap: r(gap),
      });
    }

    // --- Expected Calibration Error (ECE) ---
    const ece = bins.reduce((s, bin) => {
      if (bin.count === 0) return s;
      return s + (bin.count / n) * (bin.gap || 0);
    }, 0);

    // --- Maximum Calibration Error (MCE) ---
    const mce = Math.max(...bins.filter(b => b.count > 0).map(b => b.gap || 0), 0);

    // --- Overconfidence / underconfidence analysis ---
    const overconfident = valid.filter(p => p.predicted > 0.5 && p.actual === 0).length;
    const underconfident = valid.filter(p => p.predicted < 0.5 && p.actual === 1).length;
    const correctHigh = valid.filter(p => p.predicted > 0.5 && p.actual === 1).length;
    const correctLow = valid.filter(p => p.predicted <= 0.5 && p.actual === 0).length;

    // --- Discrimination: separate distributions of predicted for actual=0 vs actual=1 ---
    const positivePredictions = valid.filter(p => p.actual === 1).map(p => p.predicted);
    const negativePredictions = valid.filter(p => p.actual === 0).map(p => p.predicted);
    const avgPosPred = positivePredictions.length > 0
      ? positivePredictions.reduce((s, v) => s + v, 0) / positivePredictions.length : 0;
    const avgNegPred = negativePredictions.length > 0
      ? negativePredictions.reduce((s, v) => s + v, 0) / negativePredictions.length : 0;
    const discrimination = avgPosPred - avgNegPred;

    const calibrationQuality = ece < 0.05 ? "excellent" : ece < 0.1 ? "good" : ece < 0.2 ? "moderate" : "poor";

    return {
      ok: true,
      result: {
        n,
        brierScore: r(brierScore),
        brierSkillScore: r(brierSkillScore),
        logLoss: r(logLoss),
        calibration: {
          ece: r(ece),
          mce: r(mce),
          quality: calibrationQuality,
          bins,
        },
        discrimination: {
          avgPredictedForPositive: r(avgPosPred),
          avgPredictedForNegative: r(avgNegPred),
          separation: r(discrimination),
        },
        confusionSummary: {
          overconfident,
          underconfident,
          correctHigh,
          correctLow,
          accuracy: r((correctHigh + correctLow) / n),
        },
        baseRate: r(baseRate),
      },
    };
  });

  /**
   * learningCurve
   * Model learning progress — fit power law and exponential learning curves,
   * predict mastery timeline.
   * artifact.data.progress = [{ trial, performance, timestamp? }]
   * params.masteryThreshold — performance level for mastery (default 0.9)
   */
  registerLensAction("metacognition", "learningCurve", (ctx, artifact, params) => {
    const progress = artifact.data?.progress || [];
    if (progress.length < 3) {
      return { ok: true, result: { message: "Need at least 3 data points to model a learning curve." } };
    }

    const masteryThreshold = params.masteryThreshold || 0.9;
    const r = (v) => Math.round(v * 10000) / 10000;

    const trials = progress.map(p => parseFloat(p.trial) || 0);
    const performance = progress.map(p => parseFloat(p.performance) || 0);
    const n = trials.length;

    // --- Power law fit: P = a * t^b ---
    // Log-log linear regression: ln(P) = ln(a) + b * ln(t)
    const validPower = trials.map((t, i) => ({ t, p: performance[i] })).filter(d => d.t > 0 && d.p > 0);

    let powerFit = null;
    if (validPower.length >= 3) {
      const logT = validPower.map(d => Math.log(d.t));
      const logP = validPower.map(d => Math.log(d.p));
      const nv = logT.length;
      const meanLogT = logT.reduce((s, v) => s + v, 0) / nv;
      const meanLogP = logP.reduce((s, v) => s + v, 0) / nv;

      let ssXY = 0, ssXX = 0, ssYY = 0;
      for (let i = 0; i < nv; i++) {
        ssXY += (logT[i] - meanLogT) * (logP[i] - meanLogP);
        ssXX += (logT[i] - meanLogT) * (logT[i] - meanLogT);
        ssYY += (logP[i] - meanLogP) * (logP[i] - meanLogP);
      }

      const b = ssXX > 1e-10 ? ssXY / ssXX : 0;
      const lnA = meanLogP - b * meanLogT;
      const a = Math.exp(lnA);

      // R-squared for power law
      const predicted = validPower.map(d => a * Math.pow(d.t, b));
      const meanP = validPower.reduce((s, d) => s + d.p, 0) / nv;
      const ssRes = validPower.reduce((s, d, i) => s + Math.pow(d.p - predicted[i], 2), 0);
      const ssTot = validPower.reduce((s, d) => s + Math.pow(d.p - meanP, 2), 0);
      const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

      // Predict mastery trial
      let masteryTrial = null;
      if (b > 0 && a > 0) {
        masteryTrial = Math.ceil(Math.pow(masteryThreshold / a, 1 / b));
      }

      powerFit = {
        model: "power_law",
        equation: `P = ${r(a)} * t^${r(b)}`,
        a: r(a), b: r(b),
        rSquared: r(rSquared),
        predictedMasteryTrial: masteryTrial,
      };
    }

    // --- Exponential fit: P = L - (L - P0) * e^(-k*t) ---
    // Simplified: assume L = 1 (ceiling), fit P = 1 - c * e^(-k*t)
    // Linearize: ln(1 - P) = ln(c) - k*t
    const validExp = trials.map((t, i) => ({ t, p: performance[i] })).filter(d => d.p < 1 && d.p > 0);

    let expFit = null;
    if (validExp.length >= 3) {
      const linX = validExp.map(d => d.t);
      const linY = validExp.map(d => Math.log(1 - d.p));
      const ne = linX.length;
      const meanX = linX.reduce((s, v) => s + v, 0) / ne;
      const meanY = linY.reduce((s, v) => s + v, 0) / ne;

      let ssXY = 0, ssXX = 0;
      for (let i = 0; i < ne; i++) {
        ssXY += (linX[i] - meanX) * (linY[i] - meanY);
        ssXX += (linX[i] - meanX) * (linX[i] - meanX);
      }

      const negK = ssXX > 1e-10 ? ssXY / ssXX : 0;
      const k = -negK;
      const c = Math.exp(meanY - negK * meanX);

      // R-squared
      const predicted = validExp.map(d => 1 - c * Math.exp(-k * d.t));
      const meanP = validExp.reduce((s, d) => s + d.p, 0) / ne;
      const ssRes = validExp.reduce((s, d, i) => s + Math.pow(d.p - predicted[i], 2), 0);
      const ssTot = validExp.reduce((s, d) => s + Math.pow(d.p - meanP, 2), 0);
      const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

      // Predict mastery trial
      let masteryTrial = null;
      if (k > 0 && c > 0 && masteryThreshold < 1) {
        const val = (1 - masteryThreshold) / c;
        if (val > 0) masteryTrial = Math.ceil(-Math.log(val) / k);
      }

      expFit = {
        model: "exponential",
        equation: `P = 1 - ${r(c)} * e^(-${r(k)} * t)`,
        ceiling: 1, c: r(c), k: r(k),
        rSquared: r(rSquared),
        predictedMasteryTrial: masteryTrial,
      };
    }

    // --- Select best model ---
    const bestFit = (powerFit && expFit)
      ? (powerFit.rSquared >= expFit.rSquared ? powerFit : expFit)
      : (powerFit || expFit);

    // --- Learning rate analysis ---
    const improvements = [];
    for (let i = 1; i < performance.length; i++) {
      improvements.push(performance[i] - performance[i - 1]);
    }
    const avgImprovement = improvements.reduce((s, v) => s + v, 0) / improvements.length;
    const recentImprovement = improvements.length >= 3
      ? improvements.slice(-3).reduce((s, v) => s + v, 0) / 3
      : avgImprovement;

    // Plateau detection: if recent improvement is near zero relative to overall
    const plateauDetected = Math.abs(avgImprovement) > 0.001
      ? Math.abs(recentImprovement) < Math.abs(avgImprovement) * 0.1
      : false;

    // Current performance level
    const latestPerformance = performance[performance.length - 1];
    const mastered = latestPerformance >= masteryThreshold;

    return {
      ok: true,
      result: {
        dataPoints: n,
        currentPerformance: r(latestPerformance),
        masteryThreshold,
        mastered,
        powerLawFit: powerFit,
        exponentialFit: expFit,
        bestModel: bestFit ? bestFit.model : null,
        learningRate: {
          avgImprovement: r(avgImprovement),
          recentImprovement: r(recentImprovement),
          plateauDetected,
          phase: plateauDetected ? "plateau" : (recentImprovement > avgImprovement * 0.5 ? "active_learning" : "diminishing_returns"),
        },
        trialRange: { first: trials[0], last: trials[trials.length - 1] },
      },
    };
  });

  /**
   * biasDetection
   * Detect cognitive biases in decision data — anchoring, confirmation bias,
   * and sunk cost patterns.
   * artifact.data.decisions = [{ id, options: [{ name, score, evidence: [{ supports: bool, strength: number }] }], chosen, initialAnchor?, investedCost?, outcome? }]
   */
  registerLensAction("metacognition", "biasDetection", (ctx, artifact, params) => {
    const decisions = artifact.data?.decisions || [];
    if (decisions.length === 0) {
      return { ok: true, result: { message: "No decision data to analyze." } };
    }

    const r = (v) => Math.round(v * 10000) / 10000;
    const biases = [];

    // --- Anchoring bias: chosen option disproportionately close to initial anchor ---
    const anchoringData = decisions.filter(d => d.initialAnchor !== undefined && d.options && d.options.length > 1);
    if (anchoringData.length >= 2) {
      let anchoredCount = 0;
      let totalAnchorDeviation = 0;
      let totalOptimalDeviation = 0;

      for (const decision of anchoringData) {
        const anchor = parseFloat(decision.initialAnchor);
        const chosen = decision.options.find(o => o.name === decision.chosen);
        if (!chosen) continue;

        const chosenScore = parseFloat(chosen.score) || 0;
        const bestOption = decision.options.reduce((best, o) => (parseFloat(o.score) || 0) > (parseFloat(best.score) || 0) ? o : best);
        const bestScore = parseFloat(bestOption.score) || 0;

        const anchorDist = Math.abs(chosenScore - anchor);
        const optimalDist = Math.abs(chosenScore - bestScore);
        const allScores = decision.options.map(o => parseFloat(o.score) || 0);
        const scoreRange = Math.max(...allScores) - Math.min(...allScores);

        if (scoreRange > 0) {
          totalAnchorDeviation += anchorDist / scoreRange;
          totalOptimalDeviation += optimalDist / scoreRange;
          if (anchorDist / scoreRange < 0.3) anchoredCount++;
        }
      }

      const anchoringRate = anchoredCount / anchoringData.length;
      if (anchoringRate > 0.4) {
        biases.push({
          type: "anchoring",
          description: "Decisions tend to cluster near the initial anchor value",
          severity: anchoringRate > 0.7 ? "high" : "moderate",
          anchoringRate: r(anchoringRate),
          avgAnchorDeviation: r(totalAnchorDeviation / anchoringData.length),
          decisionsAnalyzed: anchoringData.length,
        });
      }
    }

    // --- Confirmation bias: selective weighting of supporting vs. contradicting evidence ---
    const confirmationData = decisions.filter(d => d.options && d.options.some(o => o.evidence && o.evidence.length > 0));
    if (confirmationData.length >= 2) {
      let supportBias = 0;
      let totalDecisions = 0;

      for (const decision of confirmationData) {
        const chosen = decision.options.find(o => o.name === decision.chosen);
        if (!chosen || !chosen.evidence || chosen.evidence.length === 0) continue;

        const supporting = chosen.evidence.filter(e => e.supports);
        const contradicting = chosen.evidence.filter(e => !e.supports);

        if (contradicting.length === 0 && supporting.length > 0) {
          supportBias += 1;
        } else if (supporting.length > 0 && contradicting.length > 0) {
          const avgSupportStrength = supporting.reduce((s, e) => s + (parseFloat(e.strength) || 0), 0) / supporting.length;
          const avgContradictStrength = contradicting.reduce((s, e) => s + (parseFloat(e.strength) || 0), 0) / contradicting.length;
          // Check if contradicting evidence is systematically underweighted
          if (avgSupportStrength > avgContradictStrength * 1.5) {
            supportBias += 0.5;
          }
        }
        totalDecisions++;
      }

      if (totalDecisions > 0) {
        const biasRate = supportBias / totalDecisions;
        if (biasRate > 0.3) {
          biases.push({
            type: "confirmation_bias",
            description: "Contradicting evidence is ignored or underweighted relative to supporting evidence",
            severity: biasRate > 0.6 ? "high" : "moderate",
            biasRate: r(biasRate),
            decisionsAnalyzed: totalDecisions,
          });
        }
      }
    }

    // --- Sunk cost bias: continuing with higher-investment options despite lower expected value ---
    const sunkCostData = decisions.filter(d => d.investedCost !== undefined && d.options && d.options.length > 1);
    if (sunkCostData.length >= 2) {
      let sunkCostCount = 0;
      let totalSunkCostCorrelation = 0;

      for (const decision of sunkCostData) {
        const invested = parseFloat(decision.investedCost) || 0;
        const chosen = decision.options.find(o => o.name === decision.chosen);
        const bestOption = decision.options.reduce((best, o) => (parseFloat(o.score) || 0) > (parseFloat(best.score) || 0) ? o : best);

        if (!chosen) continue;

        const chosenScore = parseFloat(chosen.score) || 0;
        const bestScore = parseFloat(bestOption.score) || 0;

        // If the chosen option is not the best AND investment is high, suspect sunk cost
        if (chosenScore < bestScore * 0.9 && invested > 0) {
          sunkCostCount++;
        }
        totalSunkCostCorrelation++;
      }

      if (totalSunkCostCorrelation > 0) {
        const sunkCostRate = sunkCostCount / totalSunkCostCorrelation;
        if (sunkCostRate > 0.2) {
          biases.push({
            type: "sunk_cost",
            description: "Suboptimal options chosen when prior investment is high, suggesting sunk cost influence",
            severity: sunkCostRate > 0.5 ? "high" : "moderate",
            sunkCostRate: r(sunkCostRate),
            decisionsAnalyzed: sunkCostData.length,
          });
        }
      }
    }

    // --- Overall bias score ---
    const severityWeights = { high: 3, moderate: 2, low: 1 };
    const totalBiasScore = biases.reduce((s, b) => s + (severityWeights[b.severity] || 1), 0);
    const maxPossibleScore = 3 * 3; // 3 biases, max severity each
    const biasIndex = Math.min(1, totalBiasScore / maxPossibleScore);

    return {
      ok: true,
      result: {
        decisionsAnalyzed: decisions.length,
        biasesDetected: biases.length,
        biases,
        biasIndex: r(biasIndex),
        riskLevel: biasIndex > 0.5 ? "high" : biasIndex > 0.2 ? "moderate" : "low",
        recommendations: biases.map(b => {
          switch (b.type) {
            case "anchoring": return "Consider generating options independently before reviewing anchor values";
            case "confirmation_bias": return "Actively seek disconfirming evidence and assign equal weight to contradicting data";
            case "sunk_cost": return "Evaluate options based on future expected value, not past investments";
            default: return "Review decision process for systematic biases";
          }
        }),
      },
    };
  });

  // ─── Decision journal + reflection substrate (per-user, STATE-backed) ──────

  function getMetaState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.metacognitionLens) STATE.metacognitionLens = {};
    const m = STATE.metacognitionLens;
    if (!(m.decisions instanceof Map)) m.decisions = new Map(); // userId -> Array<decision>
    if (!(m.reflections instanceof Map)) m.reflections = new Map(); // userId -> Array<reflection>
    if (!(m.streaks instanceof Map)) m.streaks = new Map(); // userId -> streak record
    return m;
  }
  function saveMeta() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const mcId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const mcActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const mcClean = (v, max = 600) => String(v == null ? "" : v).trim().slice(0, max);
  const mcNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const mcClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const mcDecisions = (m, u) => { if (!m.decisions.has(u)) m.decisions.set(u, []); return m.decisions.get(u); };
  const mcReflections = (m, u) => { if (!m.reflections.has(u)) m.reflections.set(u, []); return m.reflections.get(u); };
  const round = (v) => Math.round(v * 10000) / 10000;
  const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);

  // Reflection prompt templates — structured after-action review questions.
  const REFLECTION_PROMPTS = [
    "What did I expect to happen, and what actually happened?",
    "What information did I have, and what did I wish I had?",
    "What was the single biggest factor in this outcome?",
    "If I faced this decision again, what would I do differently?",
    "Was my confidence justified by the evidence at the time?",
    "What surprised me, and what does that surprise tell me?",
    "Which assumption, if wrong, would have changed everything?",
    "How will I recognize a similar situation in the future?",
  ];

  // Pre-decision bias checklist — common biases to surface before deciding.
  const BIAS_CHECKLIST = [
    { id: "anchoring", name: "Anchoring", prompt: "Am I over-weighting the first number or option I encountered?" },
    { id: "confirmation", name: "Confirmation bias", prompt: "Have I genuinely looked for evidence I'm wrong?" },
    { id: "sunk_cost", name: "Sunk cost", prompt: "Am I continuing because of past investment rather than future value?" },
    { id: "availability", name: "Availability", prompt: "Am I over-weighting a recent or vivid example?" },
    { id: "overconfidence", name: "Overconfidence", prompt: "Could I be wrong? What would a calibrated forecaster say?" },
    { id: "groupthink", name: "Groupthink", prompt: "Am I deferring to consensus instead of reasoning independently?" },
    { id: "loss_aversion", name: "Loss aversion", prompt: "Am I avoiding a good option only because it risks a small loss?" },
    { id: "planning_fallacy", name: "Planning fallacy", prompt: "Have I considered how similar plans actually turned out?" },
  ];

  // Thinking-strategy library — named reasoning techniques + when to use them.
  const THINKING_STRATEGIES = [
    { id: "premortem", name: "Pre-mortem", category: "decision", when: "Before committing to a plan, imagine it has failed and explain why.", how: "Assume failure 6 months out; list every plausible cause; harden against the top ones." },
    { id: "inversion", name: "Inversion", category: "problem-solving", when: "When the path forward is unclear.", how: "Instead of asking how to succeed, ask what would guarantee failure — then avoid it." },
    { id: "base_rates", name: "Base-rate reasoning", category: "forecasting", when: "When estimating the odds of an outcome.", how: "Start from how often this class of event happens, then adjust for specifics." },
    { id: "second_order", name: "Second-order thinking", category: "decision", when: "When a choice has downstream consequences.", how: "Ask 'and then what?' at least twice for each option." },
    { id: "steelman", name: "Steelmanning", category: "reasoning", when: "When evaluating an opposing view.", how: "State the strongest version of the other side before critiquing it." },
    { id: "fermi", name: "Fermi estimation", category: "estimation", when: "When you need a rough number fast.", how: "Decompose into factors you can estimate, multiply, sanity-check the order of magnitude." },
    { id: "occam", name: "Occam's razor", category: "explanation", when: "When choosing between explanations.", how: "Prefer the explanation requiring the fewest unsupported assumptions." },
    { id: "red_team", name: "Red teaming", category: "decision", when: "Before a high-stakes commitment.", how: "Assign someone (or yourself) to actively attack the plan." },
    { id: "five_whys", name: "Five whys", category: "problem-solving", when: "When diagnosing a root cause.", how: "Ask 'why' repeatedly until you reach a cause you can act on." },
    { id: "outside_view", name: "Outside view", category: "forecasting", when: "When your plan feels uniquely promising.", how: "Compare against a reference class of similar past efforts." },
    { id: "decision_tree", name: "Decision tree", category: "decision", when: "When outcomes branch on uncertain events.", how: "Map options, chance nodes and payoffs; compute expected value per branch." },
    { id: "rubber_duck", name: "Rubber-duck explanation", category: "reasoning", when: "When stuck on a problem.", how: "Explain the problem step-by-step out loud as if to a novice." },
  ];

  /**
   * journalLog — log a decision with predicted outcome + confidence.
   * params: { title, context?, predictedOutcome?, confidence (0-1), domain?, options?, biasChecklist? }
   */
  registerLensAction("metacognition", "journalLog", (ctx, _a, params = {}) => {
    try {
      const m = getMetaState(); if (!m) return { ok: false, error: "STATE unavailable" };
      const title = mcClean(params.title, 200);
      if (!title) return { ok: false, error: "decision title required" };
      const decision = {
        id: mcId("dec"),
        title,
        context: mcClean(params.context, 2000),
        predictedOutcome: mcClean(params.predictedOutcome, 1000),
        confidence: mcClamp(mcNum(params.confidence) || 0.5, 0, 1),
        domain: mcClean(params.domain, 80) || "general",
        options: Array.isArray(params.options) ? params.options.slice(0, 12).map((o) => mcClean(o, 200)).filter(Boolean) : [],
        biasChecks: Array.isArray(params.biasChecklist)
          ? params.biasChecklist.slice(0, 12).map((b) => mcClean(b, 80)).filter(Boolean) : [],
        status: "open",
        actualOutcome: null,
        correct: null,
        reflection: null,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      };
      mcDecisions(m, mcActor(ctx)).push(decision);
      saveMeta();
      return { ok: true, result: { decision } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  /**
   * journalList — list a user's decision-journal entries.
   * params: { status?: 'open'|'resolved'|'all', domain? }
   */
  registerLensAction("metacognition", "journalList", (ctx, _a, params = {}) => {
    try {
      const m = getMetaState(); if (!m) return { ok: false, error: "STATE unavailable" };
      let list = mcDecisions(m, mcActor(ctx)).slice();
      const statusFilter = mcClean(params.status, 20);
      if (statusFilter === "open") list = list.filter((d) => d.status === "open");
      else if (statusFilter === "resolved") list = list.filter((d) => d.status === "resolved");
      const domainFilter = mcClean(params.domain, 80);
      if (domainFilter) list = list.filter((d) => d.domain === domainFilter);
      list.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
      const open = list.filter((d) => d.status === "open").length;
      const resolved = list.filter((d) => d.status === "resolved").length;
      return { ok: true, result: { decisions: list, total: list.length, open, resolved } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  /**
   * journalResolve — record the actual outcome of a logged decision + optional reflection.
   * params: { id, actualOutcome, correct (bool), reflection?, lesson? }
   */
  registerLensAction("metacognition", "journalResolve", (ctx, _a, params = {}) => {
    try {
      const m = getMetaState(); if (!m) return { ok: false, error: "STATE unavailable" };
      const id = mcClean(params.id, 80);
      const list = mcDecisions(m, mcActor(ctx));
      const decision = list.find((d) => d.id === id);
      if (!decision) return { ok: false, error: "decision not found" };
      decision.actualOutcome = mcClean(params.actualOutcome, 1000);
      decision.correct = params.correct === true || params.correct === "true";
      decision.reflection = mcClean(params.reflection, 2000) || null;
      decision.lesson = mcClean(params.lesson, 600) || null;
      decision.status = "resolved";
      decision.resolvedAt = new Date().toISOString();
      saveMeta();
      return { ok: true, result: { decision } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  /**
   * journalDelete — remove a decision-journal entry.
   * params: { id }
   */
  registerLensAction("metacognition", "journalDelete", (ctx, _a, params = {}) => {
    try {
      const m = getMetaState(); if (!m) return { ok: false, error: "STATE unavailable" };
      const id = mcClean(params.id, 80);
      const list = mcDecisions(m, mcActor(ctx));
      const idx = list.findIndex((d) => d.id === id);
      if (idx < 0) return { ok: false, error: "decision not found" };
      list.splice(idx, 1);
      saveMeta();
      return { ok: true, result: { removed: id, remaining: list.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  /**
   * calibrationReport — Brier score, accuracy and a reliability diagram
   * computed from the user's resolved decision-journal entries.
   * params: { bins? (default 5) }
   */
  registerLensAction("metacognition", "calibrationReport", (ctx, _a, params = {}) => {
    try {
      const m = getMetaState(); if (!m) return { ok: false, error: "STATE unavailable" };
      const resolved = mcDecisions(m, mcActor(ctx))
        .filter((d) => d.status === "resolved" && typeof d.correct === "boolean" && typeof d.confidence === "number");
      const n = resolved.length;
      if (n === 0) {
        return { ok: true, result: { n: 0, message: "Resolve decisions in the journal to build a calibration report.", reliability: [], history: [] } };
      }
      const numBins = mcClamp(Math.round(mcNum(params.bins) || 5), 2, 10);

      // Brier score: mean (confidence - actual)^2
      const brierScore = resolved.reduce((s, d) => s + Math.pow(d.confidence - (d.correct ? 1 : 0), 2), 0) / n;
      const baseRate = resolved.reduce((s, d) => s + (d.correct ? 1 : 0), 0) / n;
      const brierClimatology = baseRate * (1 - baseRate);
      const brierSkillScore = brierClimatology > 0 ? 1 - brierScore / brierClimatology : 0;
      const accuracy = baseRate;

      // Reliability diagram (binned predicted vs observed)
      const reliability = [];
      for (let i = 0; i < numBins; i++) {
        const lower = i / numBins;
        const upper = (i + 1) / numBins;
        const inBin = resolved.filter((d) => d.confidence >= lower && (i === numBins - 1 ? d.confidence <= upper : d.confidence < upper));
        if (inBin.length === 0) {
          reliability.push({ binRange: [round(lower), round(upper)], midpoint: round((lower + upper) / 2), count: 0, predicted: null, observed: null, gap: null });
          continue;
        }
        const predicted = inBin.reduce((s, d) => s + d.confidence, 0) / inBin.length;
        const observed = inBin.reduce((s, d) => s + (d.correct ? 1 : 0), 0) / inBin.length;
        reliability.push({
          binRange: [round(lower), round(upper)],
          midpoint: round((lower + upper) / 2),
          count: inBin.length,
          predicted: round(predicted),
          observed: round(observed),
          gap: round(Math.abs(predicted - observed)),
        });
      }
      const ece = reliability.reduce((s, b) => (b.count === 0 ? s : s + (b.count / n) * (b.gap || 0)), 0);

      // Over/under-confidence summary
      const overconfident = resolved.filter((d) => d.confidence > 0.5 && !d.correct).length;
      const underconfident = resolved.filter((d) => d.confidence < 0.5 && d.correct).length;
      const avgConfidence = resolved.reduce((s, d) => s + d.confidence, 0) / n;
      const calibrationGap = avgConfidence - accuracy;

      // Running Brier history (chronological) for trend chart
      const chrono = resolved.slice().sort((a, b) => (a.resolvedAt > b.resolvedAt ? 1 : -1));
      let cumBrier = 0;
      const history = chrono.map((d, i) => {
        cumBrier += Math.pow(d.confidence - (d.correct ? 1 : 0), 2);
        return {
          index: i + 1,
          title: d.title,
          confidence: round(d.confidence),
          correct: d.correct,
          runningBrier: round(cumBrier / (i + 1)),
          resolvedAt: d.resolvedAt,
        };
      });

      return {
        ok: true,
        result: {
          n,
          brierScore: round(brierScore),
          brierSkillScore: round(brierSkillScore),
          accuracy: round(accuracy),
          avgConfidence: round(avgConfidence),
          calibrationGap: round(calibrationGap),
          ece: round(ece),
          quality: ece < 0.05 ? "excellent" : ece < 0.1 ? "good" : ece < 0.2 ? "moderate" : "poor",
          tendency: calibrationGap > 0.08 ? "overconfident" : calibrationGap < -0.08 ? "underconfident" : "well-calibrated",
          overconfident,
          underconfident,
          reliability,
          history,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  /**
   * reflectionPrompts — structured after-action review questions for a decision.
   * params: { decisionId? }  (when given, attaches the decision title for context)
   */
  registerLensAction("metacognition", "reflectionPrompts", (ctx, _a, params = {}) => {
    try {
      const m = getMetaState(); if (!m) return { ok: false, error: "STATE unavailable" };
      let decision = null;
      const id = mcClean(params.decisionId, 80);
      if (id) {
        decision = mcDecisions(m, mcActor(ctx)).find((d) => d.id === id) || null;
      }
      return {
        ok: true,
        result: {
          decisionId: id || null,
          decisionTitle: decision ? decision.title : null,
          prompts: REFLECTION_PROMPTS.map((p, i) => ({ id: `rp_${i}`, question: p })),
          count: REFLECTION_PROMPTS.length,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  /**
   * reflectionSave — save a free-form reflection / after-action review.
   * params: { decisionId?, title?, answers? [{ question, answer }], note? }
   */
  registerLensAction("metacognition", "reflectionSave", (ctx, _a, params = {}) => {
    try {
      const m = getMetaState(); if (!m) return { ok: false, error: "STATE unavailable" };
      const userId = mcActor(ctx);
      const answers = Array.isArray(params.answers)
        ? params.answers.slice(0, 20).map((a) => ({
            question: mcClean(a?.question, 300),
            answer: mcClean(a?.answer, 2000),
          })).filter((a) => a.question && a.answer)
        : [];
      const note = mcClean(params.note, 2000);
      if (answers.length === 0 && !note) return { ok: false, error: "reflection requires at least one answer or a note" };
      const reflection = {
        id: mcId("ref"),
        decisionId: mcClean(params.decisionId, 80) || null,
        title: mcClean(params.title, 200) || "Reflection",
        answers,
        note,
        createdAt: new Date().toISOString(),
      };
      mcReflections(m, userId).push(reflection);
      // Link to decision if referenced.
      if (reflection.decisionId) {
        const dec = mcDecisions(m, userId).find((d) => d.id === reflection.decisionId);
        if (dec) dec.reflection = reflection.id;
      }
      // Update reflection streak.
      const streak = m.streaks.get(userId) || { current: 0, longest: 0, lastDay: null, totalDays: 0 };
      const today = dayKey(Date.now());
      if (streak.lastDay !== today) {
        const yesterday = dayKey(Date.now() - 86400000);
        streak.current = streak.lastDay === yesterday ? streak.current + 1 : 1;
        streak.longest = Math.max(streak.longest, streak.current);
        streak.totalDays += 1;
        streak.lastDay = today;
        m.streaks.set(userId, streak);
      }
      saveMeta();
      return { ok: true, result: { reflection, streak: m.streaks.get(userId) || streak } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  /**
   * reflectionList — list saved reflections for the user.
   */
  registerLensAction("metacognition", "reflectionList", (ctx, _a, _params = {}) => {
    try {
      const m = getMetaState(); if (!m) return { ok: false, error: "STATE unavailable" };
      const list = mcReflections(m, mcActor(ctx)).slice().sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
      return { ok: true, result: { reflections: list, total: list.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  /**
   * biasChecklist — pre-decision prompt to surface likely biases.
   * Static checklist; safe public read.
   */
  registerLensAction("metacognition", "biasChecklist", (_ctx, _a, _params = {}) => {
    return { ok: true, result: { checklist: BIAS_CHECKLIST, count: BIAS_CHECKLIST.length } };
  });

  /**
   * strategyLibrary — named reasoning techniques with when-to-use guidance.
   * params: { category? }
   */
  registerLensAction("metacognition", "strategyLibrary", (_ctx, _a, params = {}) => {
    try {
      const category = mcClean(params.category, 60).toLowerCase();
      let list = THINKING_STRATEGIES;
      if (category && category !== "all") list = list.filter((s) => s.category === category);
      const categories = Array.from(new Set(THINKING_STRATEGIES.map((s) => s.category))).sort();
      return { ok: true, result: { strategies: list, count: list.length, categories } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  /**
   * streakStatus — reflection habit / streak tracking for the user.
   */
  registerLensAction("metacognition", "streakStatus", (ctx, _a, _params = {}) => {
    try {
      const m = getMetaState(); if (!m) return { ok: false, error: "STATE unavailable" };
      const userId = mcActor(ctx);
      const streak = m.streaks.get(userId) || { current: 0, longest: 0, lastDay: null, totalDays: 0 };
      const today = dayKey(Date.now());
      const yesterday = dayKey(Date.now() - 86400000);
      // A streak counts as broken if last reflection was before yesterday.
      const effectiveCurrent = (streak.lastDay === today || streak.lastDay === yesterday) ? streak.current : 0;
      const reflectedToday = streak.lastDay === today;

      // Build a 14-day activity calendar from reflection timestamps.
      const refDays = new Set(mcReflections(m, userId).map((r) => dayKey(r.createdAt)));
      const calendar = [];
      for (let i = 13; i >= 0; i--) {
        const day = dayKey(Date.now() - i * 86400000);
        calendar.push({ day, active: refDays.has(day) });
      }
      return {
        ok: true,
        result: {
          current: effectiveCurrent,
          longest: streak.longest || 0,
          totalDays: streak.totalDays || 0,
          lastDay: streak.lastDay || null,
          reflectedToday,
          calendar,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  /**
   * accuracyHistory — Brier score / accuracy over the prediction history,
   * grouped by domain, for trend tracking.
   */
  registerLensAction("metacognition", "accuracyHistory", (ctx, _a, _params = {}) => {
    try {
      const m = getMetaState(); if (!m) return { ok: false, error: "STATE unavailable" };
      const resolved = mcDecisions(m, mcActor(ctx))
        .filter((d) => d.status === "resolved" && typeof d.correct === "boolean")
        .sort((a, b) => (a.resolvedAt > b.resolvedAt ? 1 : -1));
      const n = resolved.length;
      const byDomain = {};
      for (const d of resolved) {
        const dom = d.domain || "general";
        if (!byDomain[dom]) byDomain[dom] = { domain: dom, n: 0, correct: 0, brierSum: 0 };
        byDomain[dom].n += 1;
        byDomain[dom].correct += d.correct ? 1 : 0;
        byDomain[dom].brierSum += Math.pow((d.confidence || 0.5) - (d.correct ? 1 : 0), 2);
      }
      const domains = Object.values(byDomain).map((g) => ({
        domain: g.domain,
        n: g.n,
        accuracy: round(g.correct / g.n),
        brierScore: round(g.brierSum / g.n),
      })).sort((a, b) => b.n - a.n);

      // Rolling 5-prediction accuracy window.
      const rolling = [];
      const W = 5;
      for (let i = 0; i < n; i++) {
        const start = Math.max(0, i - W + 1);
        const window = resolved.slice(start, i + 1);
        const acc = window.reduce((s, d) => s + (d.correct ? 1 : 0), 0) / window.length;
        rolling.push({ index: i + 1, title: resolved[i].title, rollingAccuracy: round(acc) });
      }
      const overallBrier = n > 0
        ? round(resolved.reduce((s, d) => s + Math.pow((d.confidence || 0.5) - (d.correct ? 1 : 0), 2), 0) / n) : null;
      const overallAccuracy = n > 0
        ? round(resolved.reduce((s, d) => s + (d.correct ? 1 : 0), 0) / n) : null;

      return {
        ok: true,
        result: { n, overallBrier, overallAccuracy, domains, rolling },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
}
