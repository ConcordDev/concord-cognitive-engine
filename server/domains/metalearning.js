// server/domains/metalearning.js
// Domain actions for learning-to-learn: strategy selection via meta-learning,
// transfer analysis between domains, and learner performance profiling.

export default function registerMetalearningActions(registerLensAction) {
  /**
   * strategySelection
   * Select optimal learning strategy based on task features using feature-based
   * meta-learning with k-nearest landmark tasks.
   * artifact.data.taskFeatures = { complexity: number, dimensionality: number, noise: number, sampleSize: number, nonlinearity: number }
   * artifact.data.landmarkTasks = [{ features: {...}, bestStrategy: string, performance: number }]
   * params.k — number of nearest neighbors (default 5)
   */
  registerLensAction("metalearning", "strategySelection", (ctx, artifact, params) => {
  try {
    const taskFeatures = artifact.data?.taskFeatures || {};
    const landmarks = artifact.data?.landmarkTasks || [];
    const k = Math.min(params.k || 5, landmarks.length);

    if (landmarks.length === 0) {
      // Use built-in heuristic rules when no landmark data is available
      const complexity = parseFloat(taskFeatures.complexity) || 0.5;
      const dimensionality = parseFloat(taskFeatures.dimensionality) || 0.5;
      const noise = parseFloat(taskFeatures.noise) || 0.5;
      const sampleSize = parseFloat(taskFeatures.sampleSize) || 0.5;
      const nonlinearity = parseFloat(taskFeatures.nonlinearity) || 0.5;

      const scores = {};
      // Decision tree: good for low-dim, handles noise moderately
      scores["decision_tree"] = (1 - dimensionality * 0.5) * (1 - noise * 0.3) * 0.8;
      // Linear model: good for low nonlinearity, scales well
      scores["linear_model"] = (1 - nonlinearity) * (1 - noise * 0.4) * 0.9;
      // Neural network: good for complex, nonlinear, large sample
      scores["neural_network"] = nonlinearity * sampleSize * (1 - noise * 0.2) * complexity;
      // Ensemble: robust across conditions
      scores["ensemble"] = 0.6 + complexity * 0.2 - noise * 0.1;
      // KNN: good for low-dim, small sample
      scores["knn"] = (1 - dimensionality * 0.7) * (1 - noise * 0.5) * 0.75;
      // SVM: good for moderate dimensions, moderate sample
      scores["svm"] = (1 - Math.abs(dimensionality - 0.5)) * (1 - noise * 0.3) * 0.85;

      const ranked = Object.entries(scores)
        .map(([strategy, score]) => ({ strategy, score: Math.round(Math.max(0, score) * 10000) / 10000 }))
        .sort((a, b) => b.score - a.score);

      return {
        ok: true,
        result: {
          method: "heuristic",
          taskFeatures,
          recommended: ranked[0].strategy,
          rankings: ranked,
          note: "No landmark tasks provided; using built-in heuristic rules.",
        },
      };
    }

    // --- Feature-based k-NN meta-learning ---
    const featureKeys = Object.keys(taskFeatures);
    if (featureKeys.length === 0) {
      return { ok: true, result: { message: "No task features provided." } };
    }

    // Compute feature statistics for normalization
    const featureStats = {};
    for (const key of featureKeys) {
      const values = landmarks.map(l => parseFloat(l.features?.[key]) || 0);
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const stdDev = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length);
      featureStats[key] = { mean, stdDev: stdDev || 1 };
    }

    // Normalize a feature vector
    function normalize(features) {
      const result = {};
      for (const key of featureKeys) {
        const raw = parseFloat(features[key]) || 0;
        result[key] = (raw - featureStats[key].mean) / featureStats[key].stdDev;
      }
      return result;
    }

    // Euclidean distance
    function distance(a, b) {
      let sum = 0;
      for (const key of featureKeys) {
        sum += Math.pow((a[key] || 0) - (b[key] || 0), 2);
      }
      return Math.sqrt(sum);
    }

    const normalizedTarget = normalize(taskFeatures);

    // Find k nearest neighbors
    const distances = landmarks.map((landmark, idx) => ({
      idx,
      distance: distance(normalizedTarget, normalize(landmark.features || {})),
      strategy: landmark.bestStrategy,
      performance: parseFloat(landmark.performance) || 0,
    })).sort((a, b) => a.distance - b.distance);

    const neighbors = distances.slice(0, k);

    // Weight by inverse distance (with epsilon to avoid division by zero)
    const epsilon = 1e-8;
    const totalWeight = neighbors.reduce((s, n) => s + 1 / (n.distance + epsilon), 0);

    // Aggregate strategy votes with distance weighting and performance weighting
    const strategyScores = {};
    for (const neighbor of neighbors) {
      const weight = (1 / (neighbor.distance + epsilon)) / totalWeight;
      const score = weight * neighbor.performance;
      strategyScores[neighbor.strategy] = (strategyScores[neighbor.strategy] || 0) + score;
    }

    const ranked = Object.entries(strategyScores)
      .map(([strategy, score]) => ({ strategy, score: Math.round(score * 10000) / 10000 }))
      .sort((a, b) => b.score - a.score);

    // Confidence based on neighbor agreement and distance
    const dominantStrategy = ranked[0];
    const neighborAgreement = neighbors.filter(n => n.strategy === dominantStrategy.strategy).length / k;
    const avgDistance = neighbors.reduce((s, n) => s + n.distance, 0) / k;
    const confidence = neighborAgreement * Math.exp(-avgDistance * 0.5);

    return {
      ok: true,
      result: {
        method: "knn_metalearning",
        k,
        taskFeatures,
        recommended: dominantStrategy.strategy,
        confidence: Math.round(confidence * 10000) / 10000,
        rankings: ranked,
        nearestNeighbors: neighbors.map(n => ({
          strategy: n.strategy,
          distance: Math.round(n.distance * 10000) / 10000,
          performance: n.performance,
        })),
        featureNormalization: featureStats,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * transferAnalysis
   * Analyze knowledge transfer potential between domains — compute domain
   * similarity, identify transferable components.
   * artifact.data.sourceDomain = { name, concepts: [string], skills: [string], vocabulary: [string], performanceBySkill: { skill: number } }
   * artifact.data.targetDomain = { name, concepts: [string], skills: [string], vocabulary: [string] }
   */
  registerLensAction("metalearning", "transferAnalysis", (ctx, artifact, params) => {
  try {
    const source = artifact.data?.sourceDomain || {};
    const target = artifact.data?.targetDomain || {};

    if (!source.name || !target.name) {
      return { ok: true, result: { message: "Both sourceDomain and targetDomain must have a name." } };
    }

    const r = (v) => Math.round(v * 10000) / 10000;

    // --- Jaccard similarity between two sets ---
    function jaccard(setA, setB) {
      const a = new Set(setA.map(s => s.toLowerCase()));
      const b = new Set(setB.map(s => s.toLowerCase()));
      const intersection = [...a].filter(x => b.has(x));
      const union = new Set([...a, ...b]);
      return union.size > 0 ? intersection.length / union.size : 0;
    }

    // --- Concept overlap ---
    const sourceConcepts = source.concepts || [];
    const targetConcepts = target.concepts || [];
    const conceptSimilarity = jaccard(sourceConcepts, targetConcepts);
    const sharedConcepts = sourceConcepts.filter(c =>
      targetConcepts.some(tc => tc.toLowerCase() === c.toLowerCase())
    );

    // --- Skill overlap ---
    const sourceSkills = source.skills || [];
    const targetSkills = target.skills || [];
    const skillSimilarity = jaccard(sourceSkills, targetSkills);
    const sharedSkills = sourceSkills.filter(s =>
      targetSkills.some(ts => ts.toLowerCase() === s.toLowerCase())
    );

    // --- Vocabulary overlap (indicates representational similarity) ---
    const sourceVocab = source.vocabulary || [];
    const targetVocab = target.vocabulary || [];
    const vocabSimilarity = jaccard(sourceVocab, targetVocab);

    // --- Transferable components (shared skills with performance data) ---
    const perfBySkill = source.performanceBySkill || {};
    const transferableComponents = sharedSkills.map(skill => {
      const perf = parseFloat(perfBySkill[skill]) || parseFloat(perfBySkill[skill.toLowerCase()]) || 0;
      return {
        skill,
        sourcePerformance: r(perf),
        estimatedTransferValue: r(perf * skillSimilarity),
        readiness: perf >= 0.8 ? "high" : perf >= 0.5 ? "moderate" : "low",
      };
    }).sort((a, b) => b.estimatedTransferValue - a.estimatedTransferValue);

    // --- Novel components (in target but not source) ---
    const novelConcepts = targetConcepts.filter(c =>
      !sourceConcepts.some(sc => sc.toLowerCase() === c.toLowerCase())
    );
    const novelSkills = targetSkills.filter(s =>
      !sourceSkills.some(ss => ss.toLowerCase() === s.toLowerCase())
    );

    // --- Overall transfer score (weighted composite) ---
    const weights = { concepts: 0.35, skills: 0.4, vocabulary: 0.25 };
    const overallSimilarity = weights.concepts * conceptSimilarity
      + weights.skills * skillSimilarity
      + weights.vocabulary * vocabSimilarity;

    // Transfer distance estimate (1 - similarity, scaled)
    const transferDistance = 1 - overallSimilarity;

    // Estimated effort reduction based on transferable components
    const maxTransfer = transferableComponents.length > 0
      ? transferableComponents.reduce((s, c) => s + c.estimatedTransferValue, 0) / targetSkills.length
      : 0;
    const effortReduction = Math.min(0.8, maxTransfer); // Cap at 80%

    const transferability = overallSimilarity > 0.6 ? "high" : overallSimilarity > 0.3 ? "moderate" : "low";

    return {
      ok: true,
      result: {
        sourceDomain: source.name,
        targetDomain: target.name,
        similarity: {
          overall: r(overallSimilarity),
          concepts: r(conceptSimilarity),
          skills: r(skillSimilarity),
          vocabulary: r(vocabSimilarity),
        },
        transferDistance: r(transferDistance),
        transferability,
        sharedConcepts,
        sharedSkills,
        transferableComponents,
        novelToLearn: {
          concepts: novelConcepts,
          skills: novelSkills,
          totalNovel: novelConcepts.length + novelSkills.length,
        },
        estimatedEffortReduction: r(effortReduction),
        recommendation: transferability === "high"
          ? "Strong transfer potential. Leverage shared skills and focus learning on novel components."
          : transferability === "moderate"
            ? "Partial transfer possible. Some skills carry over but expect significant new learning."
            : "Limited transfer. Treat target domain as largely new learning.",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * performanceProfile
   * Build learner performance profile — strengths/weaknesses radar, learning
   * style classification, and optimal difficulty targeting.
   * artifact.data.assessments = [{ skill, difficulty: number(0-1), score: number(0-1), timeSpent?: number, attempts?: number, category? }]
   * params.targetSuccessRate — desired success rate for optimal difficulty (default 0.75)
   */
  registerLensAction("metalearning", "performanceProfile", (ctx, artifact, params) => {
  try {
    const assessments = artifact.data?.assessments || [];
    if (assessments.length === 0) {
      return { ok: true, result: { message: "No assessment data to profile." } };
    }

    const targetSuccessRate = params.targetSuccessRate || 0.75;
    const r = (v) => Math.round(v * 10000) / 10000;

    // --- Aggregate by skill ---
    const skillMap = {};
    for (const a of assessments) {
      const skill = a.skill || "unknown";
      if (!skillMap[skill]) skillMap[skill] = { scores: [], difficulties: [], times: [], attempts: [], category: a.category || null };
      skillMap[skill].scores.push(parseFloat(a.score) || 0);
      skillMap[skill].difficulties.push(parseFloat(a.difficulty) || 0.5);
      if (a.timeSpent) skillMap[skill].times.push(parseFloat(a.timeSpent));
      if (a.attempts) skillMap[skill].attempts.push(parseInt(a.attempts));
    }

    // --- Strengths/weaknesses radar ---
    const skillProfiles = Object.entries(skillMap).map(([skill, data]) => {
      const avgScore = data.scores.reduce((s, v) => s + v, 0) / data.scores.length;
      const avgDifficulty = data.difficulties.reduce((s, v) => s + v, 0) / data.difficulties.length;
      const avgTime = data.times.length > 0 ? data.times.reduce((s, v) => s + v, 0) / data.times.length : null;
      const avgAttempts = data.attempts.length > 0 ? data.attempts.reduce((s, v) => s + v, 0) / data.attempts.length : null;

      // Difficulty-adjusted score (normalizing for difficulty)
      const adjustedScore = avgDifficulty > 0 ? avgScore / avgDifficulty : avgScore;

      // Consistency (inverse of standard deviation)
      const scoreStdDev = data.scores.length > 1
        ? Math.sqrt(data.scores.reduce((s, v) => s + Math.pow(v - avgScore, 2), 0) / data.scores.length)
        : 0;
      const consistency = 1 - Math.min(1, scoreStdDev * 2);

      // Efficiency: score / time (if available)
      const efficiency = avgTime && avgTime > 0 ? avgScore / avgTime : null;

      return {
        skill,
        category: data.category,
        avgScore: r(avgScore),
        adjustedScore: r(Math.min(1, adjustedScore)),
        avgDifficulty: r(avgDifficulty),
        consistency: r(consistency),
        efficiency: efficiency !== null ? r(efficiency) : null,
        avgTime: avgTime !== null ? r(avgTime) : null,
        avgAttempts: avgAttempts !== null ? r(avgAttempts) : null,
        assessmentCount: data.scores.length,
      };
    }).sort((a, b) => b.adjustedScore - a.adjustedScore);

    // Classify strengths and weaknesses
    const overallAvg = skillProfiles.reduce((s, p) => s + p.adjustedScore, 0) / skillProfiles.length;
    const strengths = skillProfiles.filter(p => p.adjustedScore > overallAvg + 0.1);
    const weaknesses = skillProfiles.filter(p => p.adjustedScore < overallAvg - 0.1);

    // --- Learning style classification ---
    // Analyze patterns in time-to-mastery and attempt patterns
    const allTimes = assessments.filter(a => a.timeSpent).map(a => parseFloat(a.timeSpent));
    const allScores = assessments.map(a => parseFloat(a.score) || 0);
    const allAttempts = assessments.filter(a => a.attempts).map(a => parseInt(a.attempts));

    let learningStyle = "balanced";
    if (allTimes.length > 3) {
      const avgTime = allTimes.reduce((s, v) => s + v, 0) / allTimes.length;
      const avgScore = allScores.reduce((s, v) => s + v, 0) / allScores.length;

      // Speed-accuracy tradeoff: correlate time with score
      const meanT = avgTime;
      const meanS = avgScore;
      let ssTS = 0, ssTT = 0;
      const paired = assessments.filter(a => a.timeSpent);
      for (const a of paired) {
        const t = parseFloat(a.timeSpent) || 0;
        const s = parseFloat(a.score) || 0;
        ssTS += (t - meanT) * (s - meanS);
        ssTT += (t - meanT) * (t - meanT);
      }
      const timeScoreCorrelation = ssTT > 0 ? ssTS / Math.sqrt(ssTT * paired.reduce((s, a) => s + Math.pow((parseFloat(a.score) || 0) - meanS, 2), 0)) : 0;

      if (timeScoreCorrelation > 0.3) learningStyle = "reflective"; // More time = better score
      else if (timeScoreCorrelation < -0.3) learningStyle = "intuitive"; // Less time = better score
      else if (avgScore > 0.8 && avgTime < allTimes.sort((a, b) => a - b)[Math.floor(allTimes.length * 0.3)]) learningStyle = "rapid";
      else if (allAttempts.length > 0 && allAttempts.reduce((s, v) => s + v, 0) / allAttempts.length > 2) learningStyle = "persistent";
    }

    // --- Optimal difficulty targeting (zone of proximal development) ---
    // Fit logistic curve: P(success) = 1 / (1 + exp(-a*(difficulty - b)))
    // Find difficulty where P(success) = targetSuccessRate
    const difficultyBins = {};
    for (const a of assessments) {
      const diff = Math.round((parseFloat(a.difficulty) || 0.5) * 10) / 10;
      if (!difficultyBins[diff]) difficultyBins[diff] = { total: 0, successes: 0 };
      difficultyBins[diff].total++;
      if ((parseFloat(a.score) || 0) >= 0.7) difficultyBins[diff].successes++;
    }

    const difficultyPoints = Object.entries(difficultyBins)
      .map(([diff, data]) => ({ difficulty: parseFloat(diff), successRate: data.successes / data.total }))
      .sort((a, b) => a.difficulty - b.difficulty);

    // Simple interpolation to find optimal difficulty
    let optimalDifficulty = 0.5;
    if (difficultyPoints.length >= 2) {
      let bestDist = Infinity;
      for (let i = 0; i < difficultyPoints.length - 1; i++) {
        const p1 = difficultyPoints[i];
        const p2 = difficultyPoints[i + 1];
        if ((p1.successRate >= targetSuccessRate && p2.successRate <= targetSuccessRate) ||
            (p1.successRate <= targetSuccessRate && p2.successRate >= targetSuccessRate)) {
          // Linear interpolation
          const t = Math.abs(p2.successRate - p1.successRate) > 1e-10
            ? (targetSuccessRate - p1.successRate) / (p2.successRate - p1.successRate)
            : 0.5;
          const interp = p1.difficulty + t * (p2.difficulty - p1.difficulty);
          const dist = Math.abs(targetSuccessRate - (p1.successRate + t * (p2.successRate - p1.successRate)));
          if (dist < bestDist) {
            bestDist = dist;
            optimalDifficulty = interp;
          }
        }
      }
      // Fallback: if no crossing found, find closest point
      if (bestDist === Infinity) {
        const closest = difficultyPoints.reduce((best, p) =>
          Math.abs(p.successRate - targetSuccessRate) < Math.abs(best.successRate - targetSuccessRate) ? p : best
        );
        optimalDifficulty = closest.difficulty;
      }
    }

    // --- Category-level aggregation ---
    const categoryMap = {};
    for (const p of skillProfiles) {
      const cat = p.category || "uncategorized";
      if (!categoryMap[cat]) categoryMap[cat] = [];
      categoryMap[cat].push(p.adjustedScore);
    }
    const categoryScores = Object.entries(categoryMap)
      .map(([category, scores]) => ({
        category,
        avgScore: r(scores.reduce((s, v) => s + v, 0) / scores.length),
        skillCount: scores.length,
      }))
      .sort((a, b) => b.avgScore - a.avgScore);

    return {
      ok: true,
      result: {
        totalAssessments: assessments.length,
        uniqueSkills: skillProfiles.length,
        overallScore: r(overallAvg),
        skillProfiles,
        strengths: strengths.map(s => ({ skill: s.skill, score: s.adjustedScore })),
        weaknesses: weaknesses.map(w => ({ skill: w.skill, score: w.adjustedScore })),
        learningStyle,
        optimalDifficulty: {
          targetSuccessRate,
          recommendedDifficulty: r(Math.max(0, Math.min(1, optimalDifficulty))),
          difficultySuccessCurve: difficultyPoints,
        },
        categoryScores,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ──────────────────────────────────────────────────────────────────────
  // Learning-science practice substrate (per-user, STATE-backed)
  // Spaced repetition, learning plans, technique library, progress
  // analytics, goal tracking, strategy A/B experiments, study journal.
  // ──────────────────────────────────────────────────────────────────────

  function getMLState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.metalearningLens) STATE.metalearningLens = {};
    const ml = STATE.metalearningLens;
    if (!(ml.cards instanceof Map)) ml.cards = new Map();         // userId -> Array<reviewCard>
    if (!(ml.plans instanceof Map)) ml.plans = new Map();         // userId -> Array<plan>
    if (!(ml.goals instanceof Map)) ml.goals = new Map();         // userId -> Array<goal>
    if (!(ml.experiments instanceof Map)) ml.experiments = new Map(); // userId -> Array<experiment>
    if (!(ml.journal instanceof Map)) ml.journal = new Map();     // userId -> Array<entry>
    return ml;
  }
  function saveML() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const mlId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const mlActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const mlClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const mlNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const mlList = (m, userId) => { if (!m.has(userId)) m.set(userId, []); return m.get(userId); };
  const DAY_MS = 86400000;

  // ─── Spaced-repetition scheduler (SM-2 derived) ─────────────────────────

  registerLensAction("metalearning", "srsAddCard", (ctx, _a, params = {}) => {
    try {
      const s = getMLState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const front = mlClean(params.front, 500);
      if (!front) return { ok: false, error: "card front (prompt) required" };
      const now = Date.now();
      const card = {
        id: mlId("card"),
        front,
        back: mlClean(params.back, 2000),
        topic: mlClean(params.topic, 160) || "general",
        ease: 2.5,
        intervalDays: 0,
        repetitions: 0,
        lapses: 0,
        dueAt: now,
        createdAt: new Date(now).toISOString(),
        lastReviewedAt: null,
        history: [],
      };
      mlList(s.cards, mlActor(ctx)).push(card);
      saveML();
      return { ok: true, result: { card } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("metalearning", "srsReview", (ctx, _a, params = {}) => {
    try {
      const s = getMLState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const cards = mlList(s.cards, mlActor(ctx));
      const card = cards.find((c) => c.id === params.cardId);
      if (!card) return { ok: false, error: "card not found" };
      // grade 0-5 (SM-2): <3 is a lapse
      const grade = Math.max(0, Math.min(5, Math.round(mlNum(params.grade, 3))));
      const now = Date.now();
      if (grade < 3) {
        card.repetitions = 0;
        card.intervalDays = 1;
        card.lapses += 1;
      } else {
        if (card.repetitions === 0) card.intervalDays = 1;
        else if (card.repetitions === 1) card.intervalDays = 6;
        else card.intervalDays = Math.round(card.intervalDays * card.ease);
        card.repetitions += 1;
      }
      // ease update (SM-2 formula), floored at 1.3
      card.ease = Math.max(1.3, Math.round((card.ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))) * 1000) / 1000);
      card.dueAt = now + card.intervalDays * DAY_MS;
      card.lastReviewedAt = new Date(now).toISOString();
      card.history.push({ at: new Date(now).toISOString(), grade, intervalDays: card.intervalDays, ease: card.ease });
      if (card.history.length > 50) card.history = card.history.slice(-50);
      saveML();
      return { ok: true, result: { card, nextDueInDays: card.intervalDays } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("metalearning", "srsDue", (ctx, _a, params = {}) => {
    try {
      const s = getMLState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const cards = mlList(s.cards, mlActor(ctx));
      const now = Date.now();
      const topic = params.topic ? mlClean(params.topic, 160) : null;
      const scoped = topic ? cards.filter((c) => c.topic === topic) : cards;
      const due = scoped.filter((c) => c.dueAt <= now)
        .sort((a, b) => a.dueAt - b.dueAt)
        .map((c) => ({ ...c, history: undefined, overdueDays: Math.round((now - c.dueAt) / DAY_MS) }));
      const upcoming = scoped.filter((c) => c.dueAt > now)
        .map((c) => ({ id: c.id, front: c.front, topic: c.topic, dueInDays: Math.ceil((c.dueAt - now) / DAY_MS) }))
        .sort((a, b) => a.dueInDays - b.dueInDays);
      return {
        ok: true,
        result: {
          dueNow: due,
          dueCount: due.length,
          upcoming: upcoming.slice(0, 30),
          totalCards: scoped.length,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("metalearning", "srsDeleteCard", (ctx, _a, params = {}) => {
    try {
      const s = getMLState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const m = s.cards; const userId = mlActor(ctx);
      const arr = mlList(m, userId);
      const idx = arr.findIndex((c) => c.id === params.cardId);
      if (idx < 0) return { ok: false, error: "card not found" };
      arr.splice(idx, 1);
      saveML();
      return { ok: true, result: { deleted: params.cardId, remaining: arr.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Learning-plan builder ──────────────────────────────────────────────

  registerLensAction("metalearning", "planCreate", (ctx, _a, params = {}) => {
    try {
      const s = getMLState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const title = mlClean(params.title, 200);
      if (!title) return { ok: false, error: "plan title required" };
      const rawTopics = Array.isArray(params.topics) ? params.topics : [];
      const topics = rawTopics.map((t, i) => {
        const name = typeof t === "string" ? t : mlClean(t?.name, 200);
        return {
          id: mlId("step"),
          order: i + 1,
          name: name || `Topic ${i + 1}`,
          estimatedHours: Math.max(0, mlNum(typeof t === "object" ? t?.estimatedHours : 0, 4)),
          milestone: typeof t === "object" ? mlClean(t?.milestone, 200) : "",
          done: false,
        };
      }).filter((t) => t.name);
      const plan = {
        id: mlId("plan"),
        title,
        goal: mlClean(params.goal, 500),
        topics,
        createdAt: new Date().toISOString(),
      };
      mlList(s.plans, mlActor(ctx)).push(plan);
      saveML();
      return { ok: true, result: { plan } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("metalearning", "planList", (ctx, _a, _params = {}) => {
    try {
      const s = getMLState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const plans = mlList(s.plans, mlActor(ctx)).map((p) => {
        const total = p.topics.length;
        const done = p.topics.filter((t) => t.done).length;
        const totalHours = p.topics.reduce((sum, t) => sum + (t.estimatedHours || 0), 0);
        const remainingHours = p.topics.filter((t) => !t.done).reduce((sum, t) => sum + (t.estimatedHours || 0), 0);
        return {
          ...p,
          progress: total > 0 ? Math.round((done / total) * 1000) / 1000 : 0,
          stepsDone: done,
          stepsTotal: total,
          totalHours,
          remainingHours,
        };
      });
      return { ok: true, result: { plans, count: plans.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("metalearning", "planToggleStep", (ctx, _a, params = {}) => {
    try {
      const s = getMLState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const plan = mlList(s.plans, mlActor(ctx)).find((p) => p.id === params.planId);
      if (!plan) return { ok: false, error: "plan not found" };
      const step = plan.topics.find((t) => t.id === params.stepId);
      if (!step) return { ok: false, error: "step not found" };
      step.done = params.done != null ? !!params.done : !step.done;
      saveML();
      const done = plan.topics.filter((t) => t.done).length;
      return { ok: true, result: { step, progress: plan.topics.length ? Math.round((done / plan.topics.length) * 1000) / 1000 : 0 } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Technique library (learning-science methods) ───────────────────────

  const TECHNIQUES = [
    {
      id: "retrieval_practice",
      name: "Retrieval Practice",
      summary: "Actively recall information from memory instead of re-reading it.",
      whenToUse: "Consolidating facts, concepts, and procedures into durable memory.",
      steps: [
        "Close the source material.",
        "Write or say everything you can remember about the topic.",
        "Check against the source and note gaps.",
        "Re-test the gaps after a delay.",
      ],
      evidence: "One of the most robust effects in cognitive science (the testing effect).",
      strength: 0.95,
    },
    {
      id: "spaced_repetition",
      name: "Spaced Repetition",
      summary: "Review material at expanding intervals timed near the point of forgetting.",
      whenToUse: "Long-term retention of large bodies of discrete knowledge.",
      steps: [
        "Break material into atomic question/answer cards.",
        "Review on a schedule that lengthens after each success.",
        "Reset the interval when you fail a card.",
      ],
      evidence: "The spacing effect — distributed practice beats massed practice.",
      strength: 0.92,
    },
    {
      id: "interleaving",
      name: "Interleaving",
      summary: "Mix related but distinct topics or problem types within a session.",
      whenToUse: "Building discrimination skill across similar concepts or problem categories.",
      steps: [
        "Pick 3-4 related problem types.",
        "Shuffle them rather than blocking by type.",
        "Force yourself to identify which approach each problem needs.",
      ],
      evidence: "Improves transfer and discrimination at a cost to short-term fluency.",
      strength: 0.85,
    },
    {
      id: "elaboration",
      name: "Elaborative Interrogation",
      summary: "Explain how and why facts are true, connecting them to what you know.",
      whenToUse: "Deepening understanding and integrating new material with prior knowledge.",
      steps: [
        "For each new fact ask 'why is this true?'",
        "Generate an explanation in your own words.",
        "Link it to a concrete example or analogy.",
      ],
      evidence: "Elaboration builds richer, more retrievable memory traces.",
      strength: 0.8,
    },
    {
      id: "dual_coding",
      name: "Dual Coding",
      summary: "Combine verbal explanations with visual representations.",
      whenToUse: "Complex systems, processes, or spatial/relational information.",
      steps: [
        "Read or hear the verbal explanation.",
        "Draw a diagram, graph, or sketch capturing the same idea.",
        "Re-explain the concept using only your visual.",
      ],
      evidence: "Two complementary memory channels strengthen recall.",
      strength: 0.78,
    },
    {
      id: "self_explanation",
      name: "Self-Explanation",
      summary: "Narrate your reasoning steps aloud while working through material.",
      whenToUse: "Procedural skills, worked examples, and problem-solving.",
      steps: [
        "Work a problem one step at a time.",
        "Explain why each step follows from the previous.",
        "Flag steps you cannot justify and study those.",
      ],
      evidence: "Surfaces gaps and builds a connected mental model.",
      strength: 0.82,
    },
    {
      id: "feynman",
      name: "Feynman Technique",
      summary: "Teach the concept in plain language as if to a beginner.",
      whenToUse: "Checking whether understanding is genuine rather than superficial.",
      steps: [
        "Write the concept name at the top of a page.",
        "Explain it simply, no jargon.",
        "Identify where the explanation breaks down and restudy.",
        "Simplify and use analogies.",
      ],
      evidence: "Plain-language teaching exposes hidden gaps in understanding.",
      strength: 0.83,
    },
  ];

  registerLensAction("metalearning", "techniqueLibrary", (_ctx, _a, params = {}) => {
    try {
      const q = params.query ? mlClean(params.query, 120).toLowerCase() : null;
      let list = TECHNIQUES;
      if (q) {
        list = TECHNIQUES.filter((t) =>
          t.name.toLowerCase().includes(q) ||
          t.summary.toLowerCase().includes(q) ||
          t.whenToUse.toLowerCase().includes(q));
      }
      if (params.id) {
        const one = TECHNIQUES.find((t) => t.id === params.id);
        return one ? { ok: true, result: { technique: one } } : { ok: false, error: "technique not found" };
      }
      return { ok: true, result: { techniques: list, count: list.length, total: TECHNIQUES.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Progress analytics — retention curves, time-to-mastery ──────────────

  registerLensAction("metalearning", "progressAnalytics", (ctx, _a, params = {}) => {
    try {
      const s = getMLState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const cards = mlList(s.cards, mlActor(ctx));
      const journal = mlList(s.journal, mlActor(ctx));
      const topic = params.topic ? mlClean(params.topic, 160) : null;
      const scoped = topic ? cards.filter((c) => c.topic === topic) : cards;

      // Retention curve: bucket reviews by interval, success = grade >= 3.
      const buckets = {};
      let totalReviews = 0;
      let totalSuccess = 0;
      for (const c of scoped) {
        for (const h of (c.history || [])) {
          totalReviews += 1;
          const ok = h.grade >= 3;
          if (ok) totalSuccess += 1;
          const bk = h.intervalDays <= 1 ? "1d"
            : h.intervalDays <= 7 ? "1w"
              : h.intervalDays <= 30 ? "1m"
                : h.intervalDays <= 90 ? "3m" : "3m+";
          if (!buckets[bk]) buckets[bk] = { total: 0, success: 0 };
          buckets[bk].total += 1;
          if (ok) buckets[bk].success += 1;
        }
      }
      const order = ["1d", "1w", "1m", "3m", "3m+"];
      const retentionCurve = order
        .filter((k) => buckets[k])
        .map((k) => ({
          interval: k,
          reviews: buckets[k].total,
          retention: Math.round((buckets[k].success / buckets[k].total) * 1000) / 1000,
        }));

      // Per-topic time-to-mastery: a card is "mastered" once repetitions >= 3
      // with current ease >= 2.3. Estimate calendar days from create→last review.
      const topicAgg = {};
      for (const c of scoped) {
        const t = c.topic || "general";
        if (!topicAgg[t]) topicAgg[t] = { cards: 0, mastered: 0, daysSum: 0, daysN: 0, avgEase: 0 };
        topicAgg[t].cards += 1;
        topicAgg[t].avgEase += c.ease;
        const mastered = c.repetitions >= 3 && c.ease >= 2.3;
        if (mastered && c.lastReviewedAt) {
          topicAgg[t].mastered += 1;
          const days = (new Date(c.lastReviewedAt).getTime() - new Date(c.createdAt).getTime()) / DAY_MS;
          if (days >= 0) { topicAgg[t].daysSum += days; topicAgg[t].daysN += 1; }
        }
      }
      const timeToMastery = Object.entries(topicAgg).map(([t, a]) => ({
        topic: t,
        cards: a.cards,
        mastered: a.mastered,
        masteryRate: a.cards ? Math.round((a.mastered / a.cards) * 1000) / 1000 : 0,
        avgDaysToMastery: a.daysN ? Math.round((a.daysSum / a.daysN) * 10) / 10 : null,
        avgEase: a.cards ? Math.round((a.avgEase / a.cards) * 1000) / 1000 : 0,
      })).sort((a, b) => b.masteryRate - a.masteryRate);

      return {
        ok: true,
        result: {
          totalReviews,
          overallRetention: totalReviews ? Math.round((totalSuccess / totalReviews) * 1000) / 1000 : 0,
          retentionCurve,
          timeToMastery,
          studySessions: journal.length,
          cardsTracked: scoped.length,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Goal setting & tracking ────────────────────────────────────────────

  registerLensAction("metalearning", "goalCreate", (ctx, _a, params = {}) => {
    try {
      const s = getMLState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const title = mlClean(params.title, 200);
      if (!title) return { ok: false, error: "goal title required" };
      const goal = {
        id: mlId("goal"),
        title,
        metric: mlClean(params.metric, 120) || "completion",
        targetValue: mlNum(params.targetValue, 100),
        currentValue: mlNum(params.currentValue, 0),
        deadline: params.deadline ? mlClean(params.deadline, 40) : null,
        status: "active",
        checkIns: [],
        createdAt: new Date().toISOString(),
      };
      mlList(s.goals, mlActor(ctx)).push(goal);
      saveML();
      return { ok: true, result: { goal } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("metalearning", "goalCheckIn", (ctx, _a, params = {}) => {
    try {
      const s = getMLState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const goal = mlList(s.goals, mlActor(ctx)).find((g) => g.id === params.goalId);
      if (!goal) return { ok: false, error: "goal not found" };
      goal.currentValue = mlNum(params.value, goal.currentValue);
      goal.checkIns.push({
        at: new Date().toISOString(),
        value: goal.currentValue,
        note: mlClean(params.note, 500),
      });
      if (goal.checkIns.length > 100) goal.checkIns = goal.checkIns.slice(-100);
      if (goal.targetValue > 0 && goal.currentValue >= goal.targetValue) goal.status = "achieved";
      else if (params.status && ["active", "paused", "abandoned", "achieved"].includes(params.status)) goal.status = params.status;
      saveML();
      return {
        ok: true,
        result: { goal, progress: goal.targetValue > 0 ? Math.round((goal.currentValue / goal.targetValue) * 1000) / 1000 : 0 },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("metalearning", "goalList", (ctx, _a, _params = {}) => {
    try {
      const s = getMLState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const goals = mlList(s.goals, mlActor(ctx)).map((g) => ({
        ...g,
        progress: g.targetValue > 0 ? Math.round((g.currentValue / g.targetValue) * 1000) / 1000 : 0,
        checkInCount: g.checkIns.length,
      }));
      const active = goals.filter((g) => g.status === "active").length;
      const achieved = goals.filter((g) => g.status === "achieved").length;
      return { ok: true, result: { goals, count: goals.length, active, achieved } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Strategy A/B experiment ────────────────────────────────────────────

  registerLensAction("metalearning", "experimentCreate", (ctx, _a, params = {}) => {
    try {
      const s = getMLState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const title = mlClean(params.title, 200);
      const a = mlClean(params.strategyA, 160);
      const b = mlClean(params.strategyB, 160);
      if (!title || !a || !b) return { ok: false, error: "title, strategyA and strategyB required" };
      const exp = {
        id: mlId("exp"),
        title,
        hypothesis: mlClean(params.hypothesis, 500),
        strategyA: { name: a, trials: [] },
        strategyB: { name: b, trials: [] },
        status: "running",
        createdAt: new Date().toISOString(),
      };
      mlList(s.experiments, mlActor(ctx)).push(exp);
      saveML();
      return { ok: true, result: { experiment: exp } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("metalearning", "experimentRecordTrial", (ctx, _a, params = {}) => {
    try {
      const s = getMLState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const exp = mlList(s.experiments, mlActor(ctx)).find((e) => e.id === params.experimentId);
      if (!exp) return { ok: false, error: "experiment not found" };
      const arm = params.arm === "B" ? "strategyB" : params.arm === "A" ? "strategyA" : null;
      if (!arm) return { ok: false, error: "arm must be 'A' or 'B'" };
      const score = mlNum(params.score, NaN);
      if (!Number.isFinite(score)) return { ok: false, error: "numeric score required" };
      exp[arm].trials.push({
        at: new Date().toISOString(),
        score,
        note: mlClean(params.note, 300),
      });
      saveML();
      return { ok: true, result: { arm, trialCount: exp[arm].trials.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("metalearning", "experimentList", (ctx, _a, _params = {}) => {
    try {
      const s = getMLState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const stats = (arm) => {
        const scores = arm.trials.map((t) => t.score);
        const n = scores.length;
        const mean = n ? scores.reduce((a, b) => a + b, 0) / n : 0;
        const variance = n > 1 ? scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
        return { name: arm.name, n, mean: Math.round(mean * 1000) / 1000, stdDev: Math.round(Math.sqrt(variance) * 1000) / 1000 };
      };
      const experiments = mlList(s.experiments, mlActor(ctx)).map((e) => {
        const a = stats(e.strategyA);
        const b = stats(e.strategyB);
        let winner = null;
        let effectSize = 0;
        let confidence = "insufficient-data";
        if (a.n >= 2 && b.n >= 2) {
          const diff = a.mean - b.mean;
          // pooled SD for a Cohen's-d style effect size
          const pooled = Math.sqrt((a.stdDev ** 2 + b.stdDev ** 2) / 2) || 1e-9;
          effectSize = Math.round((diff / pooled) * 1000) / 1000;
          winner = diff > 0 ? "A" : diff < 0 ? "B" : "tie";
          const abs = Math.abs(effectSize);
          confidence = abs >= 0.8 ? "large" : abs >= 0.5 ? "medium" : abs >= 0.2 ? "small" : "negligible";
        }
        return { ...e, summary: { armA: a, armB: b, winner, effectSize, confidence } };
      });
      return { ok: true, result: { experiments, count: experiments.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Reflection / study-log journaling ──────────────────────────────────

  registerLensAction("metalearning", "journalAdd", (ctx, _a, params = {}) => {
    try {
      const s = getMLState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const reflection = mlClean(params.reflection, 4000);
      if (!reflection) return { ok: false, error: "reflection text required" };
      const entry = {
        id: mlId("log"),
        topic: mlClean(params.topic, 160) || "general",
        technique: mlClean(params.technique, 160) || "",
        minutesStudied: Math.max(0, Math.round(mlNum(params.minutesStudied, 0))),
        effectiveness: Math.max(1, Math.min(5, Math.round(mlNum(params.effectiveness, 3)))),
        reflection,
        createdAt: new Date().toISOString(),
      };
      mlList(s.journal, mlActor(ctx)).push(entry);
      saveML();
      return { ok: true, result: { entry } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("metalearning", "journalList", (ctx, _a, params = {}) => {
    try {
      const s = getMLState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let entries = mlList(s.journal, mlActor(ctx)).slice();
      if (params.topic) {
        const t = mlClean(params.topic, 160);
        entries = entries.filter((e) => e.topic === t);
      }
      entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const totalMinutes = entries.reduce((sum, e) => sum + (e.minutesStudied || 0), 0);

      // Effectiveness by technique — links study log to technique outcomes.
      const byTechnique = {};
      for (const e of entries) {
        const tk = e.technique || "(unspecified)";
        if (!byTechnique[tk]) byTechnique[tk] = { sessions: 0, effSum: 0, minutes: 0 };
        byTechnique[tk].sessions += 1;
        byTechnique[tk].effSum += e.effectiveness;
        byTechnique[tk].minutes += e.minutesStudied || 0;
      }
      const techniqueEffectiveness = Object.entries(byTechnique)
        .map(([technique, a]) => ({
          technique,
          sessions: a.sessions,
          avgEffectiveness: Math.round((a.effSum / a.sessions) * 100) / 100,
          totalMinutes: a.minutes,
        }))
        .sort((a, b) => b.avgEffectiveness - a.avgEffectiveness);

      return {
        ok: true,
        result: {
          entries: entries.slice(0, mlNum(params.limit, 100)),
          count: entries.length,
          totalMinutes,
          techniqueEffectiveness,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
}
