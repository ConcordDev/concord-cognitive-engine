// server/domains/resonance.js
// Domain actions for content resonance/impact: engagement scoring,
// audience-content alignment, and impact prediction.
//
// Cross-domain analogy / knowledge-graph resonance tooling:
//  - resonanceGraph     : domain-pair network from authored pairs
//  - pairDrilldown      : structural correspondence breakdown for one pair
//  - proposePair        : manual pair authoring
//  - listPairs          : authored + analysed pairs for the user
//  - resonanceAlerts    : strong-signal alerting (list / ack)
//  - resonanceToInsight : signal -> citable hypothesis DTU
//  - pairTrend          : historical resonance trend series per pair

export default function registerResonanceActions(registerLensAction) {
  // ── Per-user persistent store ──────────────────────────────────────
  function getResonanceState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.resonanceLens) STATE.resonanceLens = {};
    const s = STATE.resonanceLens;
    if (!(s.pairs instanceof Map)) s.pairs = new Map();        // userId -> Array<pair>
    if (!(s.alerts instanceof Map)) s.alerts = new Map();      // userId -> Array<alert>
    if (!(s.insights instanceof Map)) s.insights = new Map();  // userId -> Array<insight>
    return s;
  }
  function saveResonance() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const rsActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const rsId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const rsNow = () => new Date().toISOString();
  const rsClean = (v, max = 2000) => String(v == null ? "" : v).trim().slice(0, max);
  const rsRound = (v) => Math.round(v * 10000) / 10000;
  const rsList = (m, userId) => { if (!m.has(userId)) m.set(userId, []); return m.get(userId); };

  // Tokenise free text into a comparable invariant/constraint set.
  function tokenSet(text) {
    return new Set(
      String(text || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2),
    );
  }
  function jaccard(a, b) {
    if (a.size === 0 && b.size === 0) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const union = a.size + b.size - inter;
    return union > 0 ? inter / union : 0;
  }

  // Core resonance computation for a domain pair. Resonance is HIGH invariant
  // alignment combined with LOW semantic (token) overlap — genuine structural
  // correspondence rather than the same content restated.
  function computePairResonance(pair) {
    const invA = (pair.a.invariants || []).map((s) => rsClean(s, 200)).filter(Boolean);
    const invB = (pair.b.invariants || []).map((s) => rsClean(s, 200)).filter(Boolean);

    // Shared invariants: token-overlap match between invariant statements.
    const shared = [];
    const invSetsB = invB.map((s) => ({ text: s, set: tokenSet(s) }));
    for (const ia of invA) {
      const setA = tokenSet(ia);
      let best = 0;
      let bestText = "";
      for (const ib of invSetsB) {
        const sim = jaccard(setA, ib.set);
        if (sim > best) { best = sim; bestText = ib.text; }
      }
      if (best >= 0.34) shared.push(`${ia} ⇔ ${bestText}`);
    }
    const invDenom = Math.max(1, Math.max(invA.length, invB.length));
    const invOverlap = shared.length / invDenom;

    // Semantic / token overlap on the descriptive text of each side.
    const tokA = tokenSet(`${pair.a.title} ${pair.a.description || ""}`);
    const tokB = tokenSet(`${pair.b.title} ${pair.b.description || ""}`);
    const tokOverlap = jaccard(tokA, tokB);

    // Resonance: reward invariant alignment, penalise semantic similarity.
    const resonance = Math.max(0, invOverlap * (1 - tokOverlap * 0.7));
    return {
      invOverlap: rsRound(invOverlap),
      tokOverlap: rsRound(tokOverlap),
      resonance: rsRound(resonance),
      sharedInvariants: shared,
    };
  }

  function classifyResonance(resonance) {
    if (resonance >= 0.30) return "strong_resonance";
    if (resonance >= 0.10) return "moderate_resonance";
    if (resonance >= 0.03) return "weak_signal";
    return "noise_floor";
  }

  function recomputePair(pair) {
    const m = computePairResonance(pair);
    pair.invOverlap = m.invOverlap;
    pair.tokOverlap = m.tokOverlap;
    pair.resonance = m.resonance;
    pair.sharedInvariants = m.sharedInvariants;
    pair.classification = classifyResonance(m.resonance);
    pair.analyzedAt = rsNow();
    return pair;
  }


  /**
   * engagementScore
   * Compute content engagement score — view-to-interaction ratio, time-on-content,
   * return rate, and viral coefficient (k-factor).
   * artifact.data.content = { views, likes?, comments?, shares?, saves?, avgTimeOnContent?, totalVisitors?, returningVisitors?, referrals? }
   * artifact.data.contentHistory (optional) = [{ date, views, interactions }] for trend
   */
  registerLensAction("resonance", "engagementScore", (ctx, artifact, params) => {
  try {
    const content = artifact.data?.content || {};
    const history = artifact.data?.contentHistory || [];

    const views = parseInt(content.views) || 0;
    if (views === 0) {
      return { ok: true, result: { message: "No view data available.", engagementScore: 0 } };
    }

    const r = (v) => Math.round(v * 10000) / 10000;

    const likes = parseInt(content.likes) || 0;
    const comments = parseInt(content.comments) || 0;
    const shares = parseInt(content.shares) || 0;
    const saves = parseInt(content.saves) || 0;
    const avgTimeOnContent = parseFloat(content.avgTimeOnContent) || 0;
    const totalVisitors = parseInt(content.totalVisitors) || views;
    const returningVisitors = parseInt(content.returningVisitors) || 0;
    const referrals = parseInt(content.referrals) || 0;

    // --- Interaction metrics ---
    const totalInteractions = likes + comments + shares + saves;
    const interactionRate = views > 0 ? totalInteractions / views : 0;

    // Weighted interaction score (shares and saves weighted higher)
    const weightedInteractions = likes * 1 + comments * 2 + shares * 3 + saves * 2.5;
    const weightedInteractionRate = views > 0 ? weightedInteractions / views : 0;

    // --- Time-on-content score (normalize: assume target is 3 minutes = 180s) ---
    const timeScore = avgTimeOnContent > 0
      ? Math.min(1, avgTimeOnContent / 180)
      : 0;

    // --- Return rate ---
    const returnRate = totalVisitors > 0 ? returningVisitors / totalVisitors : 0;

    // --- Viral coefficient (k-factor) ---
    // k = shares * conversion_rate
    // Approximate conversion rate from referrals/shares
    const conversionRate = shares > 0 ? Math.min(1, referrals / shares) : 0;
    const kFactor = shares > 0 ? (shares / views) * conversionRate * views / totalVisitors : 0;
    // Simplified: k = invitations * conversion = (shares/views) * (referrals/shares)
    const kFactorSimple = views > 0 ? referrals / views : 0;

    const isViral = kFactorSimple > 1;

    // --- Composite engagement score (0-100) ---
    const weights = {
      interactionRate: 0.30,
      timeScore: 0.25,
      returnRate: 0.20,
      viralCoeff: 0.15,
      volumeBonus: 0.10,
    };

    // Volume bonus: logarithmic scaling of view count
    const volumeBonus = Math.min(1, Math.log10(Math.max(1, views)) / 6); // normalizes to 1M views = 1.0

    const engagementScore = (
      Math.min(1, weightedInteractionRate * 10) * weights.interactionRate +
      timeScore * weights.timeScore +
      returnRate * weights.returnRate +
      Math.min(1, kFactorSimple) * weights.viralCoeff +
      volumeBonus * weights.volumeBonus
    ) * 100;

    // --- Engagement trend (if history available) ---
    let trend = null;
    if (history.length >= 3) {
      const rates = history.map(h => {
        const v = parseInt(h.views) || 1;
        const inter = parseInt(h.interactions) || 0;
        return inter / v;
      });
      const meanRate = rates.reduce((s, v) => s + v, 0) / rates.length;
      const xs = rates.map((_, i) => i);
      const meanX = xs.reduce((s, v) => s + v, 0) / xs.length;
      let ssXY = 0, ssXX = 0;
      for (let i = 0; i < xs.length; i++) {
        ssXY += (xs[i] - meanX) * (rates[i] - meanRate);
        ssXX += (xs[i] - meanX) * (xs[i] - meanX);
      }
      const slope = ssXX > 0 ? ssXY / ssXX : 0;
      trend = {
        direction: slope > 0.001 ? "growing" : slope < -0.001 ? "declining" : "stable",
        slope: r(slope),
        dataPoints: history.length,
      };
    }

    // --- Engagement breakdown by type ---
    const breakdown = {
      likes: { count: likes, rate: r(views > 0 ? likes / views : 0) },
      comments: { count: comments, rate: r(views > 0 ? comments / views : 0) },
      shares: { count: shares, rate: r(views > 0 ? shares / views : 0) },
      saves: { count: saves, rate: r(views > 0 ? saves / views : 0) },
    };

    // Engagement quality tier
    const tier = engagementScore >= 80 ? "exceptional" : engagementScore >= 60 ? "strong"
      : engagementScore >= 40 ? "moderate" : engagementScore >= 20 ? "low" : "minimal";

    return {
      ok: true,
      result: {
        engagementScore: r(engagementScore),
        tier,
        views,
        totalInteractions,
        interactionRate: r(interactionRate),
        weightedInteractionRate: r(weightedInteractionRate),
        timeOnContent: { avgSeconds: avgTimeOnContent, score: r(timeScore) },
        returnRate: r(returnRate),
        virality: {
          kFactor: r(kFactorSimple),
          isViral,
          shares,
          referrals,
          conversionRate: r(conversionRate),
        },
        breakdown,
        trend,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * audienceMatch
   * Score content-audience alignment — topic relevance, reading level match,
   * format preference, and timing optimization.
   * artifact.data.content = { topics: [string], readingLevel?: number(1-20), format?: string, publishTime?: string, wordCount?: number }
   * artifact.data.audience = { interests: [string], avgReadingLevel?: number, preferredFormats?: [string], activeHours?: [number], demographics?: { ageGroup?, education? } }
   */
  registerLensAction("resonance", "audienceMatch", (ctx, artifact, params) => {
  try {
    const content = artifact.data?.content || {};
    const audience = artifact.data?.audience || {};

    const r = (v) => Math.round(v * 10000) / 10000;

    // --- Topic relevance (Jaccard + weighted overlap) ---
    const contentTopics = (content.topics || []).map(t => t.toLowerCase());
    const audienceInterests = (audience.interests || []).map(t => t.toLowerCase());

    let topicRelevance = 0;
    if (contentTopics.length > 0 && audienceInterests.length > 0) {
      const contentSet = new Set(contentTopics);
      const audienceSet = new Set(audienceInterests);
      const intersection = [...contentSet].filter(t => audienceSet.has(t));
      const union = new Set([...contentSet, ...audienceSet]);
      const jaccard = union.size > 0 ? intersection.length / union.size : 0;

      // Also compute overlap from audience perspective (what % of their interests are covered)
      const coverageScore = audienceSet.size > 0 ? intersection.length / audienceSet.size : 0;

      // Partial matching: check for substring overlaps
      let partialMatches = 0;
      for (const ct of contentTopics) {
        for (const ai of audienceInterests) {
          if (ct !== ai && (ct.includes(ai) || ai.includes(ct))) {
            partialMatches++;
          }
        }
      }
      const partialBonus = Math.min(0.2, partialMatches * 0.05);

      topicRelevance = Math.min(1, jaccard * 0.4 + coverageScore * 0.4 + partialBonus + 0.2 * (intersection.length > 0 ? 1 : 0));
    }

    // --- Reading level match ---
    const contentLevel = parseFloat(content.readingLevel) || 10;
    const audienceLevel = parseFloat(audience.avgReadingLevel) || 10;
    const levelDiff = Math.abs(contentLevel - audienceLevel);
    // Perfect match at 0, decays with distance
    const readingLevelMatch = Math.exp(-levelDiff * 0.3);

    // --- Format preference match ---
    const contentFormat = (content.format || "article").toLowerCase();
    const preferredFormats = (audience.preferredFormats || []).map(f => f.toLowerCase());
    let formatMatch = 0.5; // default neutral
    if (preferredFormats.length > 0) {
      if (preferredFormats.includes(contentFormat)) {
        const rank = preferredFormats.indexOf(contentFormat);
        formatMatch = 1 - (rank * 0.1); // slight penalty for lower preference rank
      } else {
        formatMatch = 0.2; // low match if format not in preferences
      }
    }

    // --- Timing optimization ---
    const activeHours = audience.activeHours || [];
    let timingMatch = 0.5; // default
    if (content.publishTime && activeHours.length > 0) {
      const pubDate = new Date(content.publishTime);
      if (!isNaN(pubDate.getTime())) {
        const pubHour = pubDate.getHours();
        if (activeHours.includes(pubHour)) {
          timingMatch = 1.0;
        } else {
          // Find distance to nearest active hour
          const minDist = Math.min(...activeHours.map(h => {
            const diff = Math.abs(h - pubHour);
            return Math.min(diff, 24 - diff);
          }));
          timingMatch = Math.max(0.1, 1 - minDist * 0.15);
        }
      }
    }
    const optimalPublishHour = activeHours.length > 0 ? activeHours[0] : null;

    // --- Word count appropriateness ---
    const wordCount = parseInt(content.wordCount) || 0;
    let lengthScore = 0.5;
    if (wordCount > 0) {
      // Optimal ranges by format
      const optimalRanges = {
        article: [800, 2000],
        blog: [600, 1500],
        report: [2000, 5000],
        tweet: [20, 280],
        video_script: [300, 1000],
        newsletter: [400, 1200],
      };
      const range = optimalRanges[contentFormat] || [500, 2000];
      if (wordCount >= range[0] && wordCount <= range[1]) {
        lengthScore = 1.0;
      } else if (wordCount < range[0]) {
        lengthScore = Math.max(0.2, wordCount / range[0]);
      } else {
        lengthScore = Math.max(0.3, 1 - (wordCount - range[1]) / range[1] * 0.5);
      }
    }

    // --- Composite alignment score ---
    const weights = {
      topicRelevance: 0.35,
      readingLevel: 0.20,
      format: 0.15,
      timing: 0.15,
      length: 0.15,
    };

    const alignmentScore = (
      topicRelevance * weights.topicRelevance +
      readingLevelMatch * weights.readingLevel +
      formatMatch * weights.format +
      timingMatch * weights.timing +
      lengthScore * weights.length
    ) * 100;

    // --- Recommendations ---
    const recommendations = [];
    if (topicRelevance < 0.5) recommendations.push("Content topics have low overlap with audience interests. Consider adjusting topic focus.");
    if (readingLevelMatch < 0.5) recommendations.push(`Reading level mismatch: content is level ${contentLevel}, audience is level ${audienceLevel}. ${contentLevel > audienceLevel ? "Simplify language." : "Content may be too simple."}`);
    if (formatMatch < 0.5) recommendations.push(`Audience prefers ${preferredFormats.join(", ")}. Current format (${contentFormat}) may not resonate.`);
    if (timingMatch < 0.5 && optimalPublishHour !== null) recommendations.push(`Consider publishing at ${optimalPublishHour}:00 when audience is most active.`);
    if (lengthScore < 0.5) recommendations.push(`Word count (${wordCount}) is outside optimal range for ${contentFormat} format.`);

    return {
      ok: true,
      result: {
        alignmentScore: r(alignmentScore),
        quality: alignmentScore >= 80 ? "excellent" : alignmentScore >= 60 ? "good" : alignmentScore >= 40 ? "fair" : "poor",
        components: {
          topicRelevance: { score: r(topicRelevance * 100), weight: weights.topicRelevance, matchedTopics: contentTopics.filter(t => audienceInterests.includes(t)) },
          readingLevel: { score: r(readingLevelMatch * 100), weight: weights.readingLevel, contentLevel, audienceLevel, gap: r(levelDiff) },
          formatMatch: { score: r(formatMatch * 100), weight: weights.format, contentFormat, preferredFormats },
          timing: { score: r(timingMatch * 100), weight: weights.timing, optimalPublishHour },
          contentLength: { score: r(lengthScore * 100), weight: weights.length, wordCount },
        },
        recommendations,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * impactPrediction
   * Predict content impact using historical patterns — feature extraction,
   * weighted similarity to past high-performers.
   * artifact.data.newContent = { topics: [string], wordCount?: number, format?: string, readingLevel?: number, hasMedia?: boolean, publishDayOfWeek?: number }
   * artifact.data.historicalContent = [{ topics: [string], wordCount?: number, format?: string, readingLevel?: number, hasMedia?: boolean, publishDayOfWeek?: number, engagementScore: number }]
   * params.k — number of nearest neighbors (default 5)
   */
  registerLensAction("resonance", "impactPrediction", (ctx, artifact, params) => {
  try {
    const newContent = artifact.data?.newContent || {};
    const historical = artifact.data?.historicalContent || [];
    const k = Math.min(params.k || 5, historical.length);

    if (historical.length < 2) {
      return { ok: true, result: { message: "Need at least 2 historical content items for prediction." } };
    }

    const r = (v) => Math.round(v * 10000) / 10000;

    // --- Feature extraction ---
    function extractFeatures(item) {
      return {
        wordCount: parseInt(item.wordCount) || 0,
        readingLevel: parseFloat(item.readingLevel) || 10,
        hasMedia: item.hasMedia ? 1 : 0,
        publishDayOfWeek: parseInt(item.publishDayOfWeek) || 0,
        topicCount: (item.topics || []).length,
        format: (item.format || "article").toLowerCase(),
        topics: (item.topics || []).map(t => t.toLowerCase()),
      };
    }

    const newFeatures = extractFeatures(newContent);
    const historicalFeatures = historical.map(h => ({
      features: extractFeatures(h),
      engagementScore: parseFloat(h.engagementScore) || 0,
    }));

    // --- Compute feature statistics for normalization ---
    const numericKeys = ["wordCount", "readingLevel", "topicCount"];
    const stats = {};
    for (const key of numericKeys) {
      const values = historicalFeatures.map(h => h.features[key]);
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const stdDev = Math.sqrt(values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length) || 1;
      stats[key] = { mean, stdDev };
    }

    // --- Similarity computation (hybrid: numeric + categorical + topic) ---
    function similarity(a, b) {
      // Numeric similarity (normalized Euclidean)
      let numDist = 0;
      for (const key of numericKeys) {
        const na = (a[key] - stats[key].mean) / stats[key].stdDev;
        const nb = (b[key] - stats[key].mean) / stats[key].stdDev;
        numDist += Math.pow(na - nb, 2);
      }
      const numSim = Math.exp(-numDist / (2 * numericKeys.length));

      // Categorical similarity
      const formatSim = a.format === b.format ? 1 : 0;
      const mediaSim = a.hasMedia === b.hasMedia ? 1 : 0;
      const dowDiff = Math.abs(a.publishDayOfWeek - b.publishDayOfWeek);
      const dowSim = 1 - Math.min(dowDiff, 7 - dowDiff) / 3.5;

      // Topic similarity (Jaccard)
      const setA = new Set(a.topics);
      const setB = new Set(b.topics);
      const intersection = [...setA].filter(t => setB.has(t)).length;
      const union = new Set([...setA, ...setB]).size;
      const topicSim = union > 0 ? intersection / union : 0;

      // Weighted combination
      return numSim * 0.25 + formatSim * 0.15 + mediaSim * 0.05 + dowSim * 0.10 + topicSim * 0.45;
    }

    // --- Find k nearest neighbors ---
    const distances = historicalFeatures.map((h, idx) => ({
      idx,
      similarity: similarity(newFeatures, h.features),
      engagementScore: h.engagementScore,
      features: h.features,
    })).sort((a, b) => b.similarity - a.similarity);

    const neighbors = distances.slice(0, k);

    // --- Weighted prediction ---
    const totalWeight = neighbors.reduce((s, n) => s + n.similarity, 0);
    const predictedScore = totalWeight > 0
      ? neighbors.reduce((s, n) => s + n.similarity * n.engagementScore, 0) / totalWeight
      : neighbors.reduce((s, n) => s + n.engagementScore, 0) / k;

    // --- Confidence interval ---
    const neighborScores = neighbors.map(n => n.engagementScore);
    const stdDev = Math.sqrt(
      neighborScores.reduce((s, v) => s + Math.pow(v - predictedScore, 2), 0) / neighborScores.length
    );
    const confidence = {
      predicted: r(predictedScore),
      lower: r(Math.max(0, predictedScore - 1.96 * stdDev)),
      upper: r(Math.min(100, predictedScore + 1.96 * stdDev)),
      stdDev: r(stdDev),
    };

    // --- Feature importance (which features most differentiate high vs low performers) ---
    const medianEngagement = [...historicalFeatures]
      .sort((a, b) => a.engagementScore - b.engagementScore)[Math.floor(historicalFeatures.length / 2)]
      .engagementScore;

    const highPerformers = historicalFeatures.filter(h => h.engagementScore > medianEngagement);
    const lowPerformers = historicalFeatures.filter(h => h.engagementScore <= medianEngagement);

    const featureImportance = {};
    for (const key of numericKeys) {
      const highAvg = highPerformers.length > 0
        ? highPerformers.reduce((s, h) => s + h.features[key], 0) / highPerformers.length : 0;
      const lowAvg = lowPerformers.length > 0
        ? lowPerformers.reduce((s, h) => s + h.features[key], 0) / lowPerformers.length : 0;
      const diff = stats[key].stdDev > 0 ? Math.abs(highAvg - lowAvg) / stats[key].stdDev : 0;
      featureImportance[key] = {
        importance: r(diff),
        highPerformerAvg: r(highAvg),
        lowPerformerAvg: r(lowAvg),
        newContentValue: newFeatures[key],
      };
    }

    // Format importance
    const highFormats = {};
    for (const h of highPerformers) highFormats[h.features.format] = (highFormats[h.features.format] || 0) + 1;
    const bestFormat = Object.entries(highFormats).sort((a, b) => b[1] - a[1])[0];

    // --- Recommendations ---
    const recommendations = [];
    if (bestFormat && bestFormat[0] !== newFeatures.format) {
      recommendations.push(`High-performing content tends to use "${bestFormat[0]}" format.`);
    }
    for (const [key, data] of Object.entries(featureImportance)) {
      if (data.importance > 0.5) {
        const direction = data.highPerformerAvg > data.lowPerformerAvg ? "higher" : "lower";
        if ((direction === "higher" && data.newContentValue < data.highPerformerAvg) ||
            (direction === "lower" && data.newContentValue > data.highPerformerAvg)) {
          recommendations.push(`Consider adjusting ${key}: high performers average ${data.highPerformerAvg}, yours is ${data.newContentValue}.`);
        }
      }
    }

    // Performance tier prediction
    const tier = predictedScore >= 80 ? "exceptional" : predictedScore >= 60 ? "strong"
      : predictedScore >= 40 ? "moderate" : predictedScore >= 20 ? "low" : "minimal";

    return {
      ok: true,
      result: {
        prediction: confidence,
        predictedTier: tier,
        neighbors: neighbors.map(n => ({
          similarity: r(n.similarity),
          engagementScore: n.engagementScore,
          topics: n.features.topics,
          format: n.features.format,
        })),
        featureImportance,
        bestPerformingFormat: bestFormat ? bestFormat[0] : null,
        historicalBaseline: {
          mean: r(historicalFeatures.reduce((s, h) => s + h.engagementScore, 0) / historicalFeatures.length),
          median: r(medianEngagement),
          max: r(Math.max(...historicalFeatures.map(h => h.engagementScore))),
        },
        recommendations,
        dataQuality: {
          historicalItems: historical.length,
          neighborsUsed: k,
          avgNeighborSimilarity: r(neighbors.reduce((s, n) => s + n.similarity, 0) / k),
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ════════════════════════════════════════════════════════════════════
  // Cross-domain analogy / knowledge-graph resonance tooling
  // ════════════════════════════════════════════════════════════════════

  /**
   * proposePair — manual pair authoring. Propose a domain pair to analyze.
   * params: {
   *   a: { domain, title, description?, invariants?: [string] },
   *   b: { domain, title, description?, invariants?: [string] }
   * }
   * Persists the pair, computes its resonance, and (if strong) raises an alert.
   */
  registerLensAction("resonance", "proposePair", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const userId = rsActor(ctx);
      const a = p.a || {};
      const b = p.b || {};
      if (!a.domain || !a.title || !b.domain || !b.title) {
        return { ok: false, error: "Both sides require a domain and a title." };
      }
      const s = getResonanceState();
      const mkSide = (side) => ({
        id: rsId("node"),
        domain: rsClean(side.domain, 80),
        title: rsClean(side.title, 240),
        description: rsClean(side.description, 1200),
        invariants: Array.isArray(side.invariants)
          ? side.invariants.map((v) => rsClean(v, 200)).filter(Boolean).slice(0, 24)
          : [],
      });
      const pair = recomputePair({
        id: rsId("pair"),
        a: mkSide(a),
        b: mkSide(b),
        note: rsClean(p.note, 600),
        createdAt: rsNow(),
        source: "authored",
      });
      const list = rsList(s.pairs, userId);
      list.unshift(pair);
      if (list.length > 200) list.length = 200;

      // Strong signal → raise an alert.
      let alerted = false;
      if (pair.classification === "strong_resonance") {
        const alerts = rsList(s.alerts, userId);
        alerts.unshift({
          id: rsId("alert"),
          pairId: pair.id,
          label: `${pair.a.domain} ↔ ${pair.b.domain}`,
          resonance: pair.resonance,
          classification: pair.classification,
          message: `Strong cross-domain signal: ${pair.a.title} ⇔ ${pair.b.title}`,
          raisedAt: rsNow(),
          acknowledged: false,
        });
        if (alerts.length > 100) alerts.length = 100;
        alerted = true;
      }
      saveResonance();
      return { ok: true, result: { pair, alerted, totalPairs: list.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * listPairs — all authored/analysed pairs for the user, with stats.
   * params: { minResonance?, domain? } — optional filters.
   */
  registerLensAction("resonance", "listPairs", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const userId = rsActor(ctx);
      const s = getResonanceState();
      let pairs = rsList(s.pairs, userId).slice();
      if (typeof p.minResonance === "number") {
        pairs = pairs.filter((x) => x.resonance >= p.minResonance);
      }
      if (p.domain) {
        const d = rsClean(p.domain, 80).toLowerCase();
        pairs = pairs.filter(
          (x) => x.a.domain.toLowerCase() === d || x.b.domain.toLowerCase() === d,
        );
      }
      const byClass = { strong_resonance: 0, moderate_resonance: 0, weak_signal: 0, noise_floor: 0 };
      for (const x of pairs) byClass[x.classification] = (byClass[x.classification] || 0) + 1;
      return {
        ok: true,
        result: {
          pairs,
          count: pairs.length,
          byClass,
          avgResonance: pairs.length
            ? rsRound(pairs.reduce((acc, x) => acc + x.resonance, 0) / pairs.length)
            : 0,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * resonanceGraph — domain-pair network. Nodes are domains; edges are the
   * resonance strength between two domains (aggregated across pairs).
   * params: { minResonance? } — edge inclusion threshold (default 0).
   */
  registerLensAction("resonance", "resonanceGraph", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const userId = rsActor(ctx);
      const minResonance = typeof p.minResonance === "number" ? p.minResonance : 0;
      const s = getResonanceState();
      const pairs = rsList(s.pairs, userId);

      const nodeMap = new Map();   // domain -> { id, label, pairCount, totalResonance }
      const edgeMap = new Map();   // "a|b" -> { source, target, resonances:[], pairIds:[] }
      const touchNode = (domain) => {
        if (!nodeMap.has(domain)) {
          nodeMap.set(domain, { id: domain, label: domain, pairCount: 0, totalResonance: 0 });
        }
        return nodeMap.get(domain);
      };

      for (const pair of pairs) {
        if (pair.resonance < minResonance) continue;
        const da = pair.a.domain;
        const db = pair.b.domain;
        if (da === db) continue;
        const na = touchNode(da);
        const nb = touchNode(db);
        na.pairCount++; nb.pairCount++;
        na.totalResonance += pair.resonance;
        nb.totalResonance += pair.resonance;
        const key = [da, db].sort().join("|");
        if (!edgeMap.has(key)) {
          const [source, target] = [da, db].sort();
          edgeMap.set(key, { source, target, resonances: [], pairIds: [] });
        }
        const e = edgeMap.get(key);
        e.resonances.push(pair.resonance);
        e.pairIds.push(pair.id);
      }

      const nodes = [...nodeMap.values()].map((n) => ({
        id: n.id,
        label: n.label,
        pairCount: n.pairCount,
        avgResonance: n.pairCount ? rsRound(n.totalResonance / n.pairCount) : 0,
      }));
      const edges = [...edgeMap.values()].map((e) => {
        const strength = e.resonances.reduce((a, b) => a + b, 0) / e.resonances.length;
        return {
          source: e.source,
          target: e.target,
          strength: rsRound(strength),
          classification: classifyResonance(strength),
          pairCount: e.pairIds.length,
          pairIds: e.pairIds,
        };
      }).sort((x, y) => y.strength - x.strength);

      return {
        ok: true,
        result: {
          nodes,
          edges,
          stats: {
            domains: nodes.length,
            connections: edges.length,
            strongestEdge: edges[0] || null,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * pairDrilldown — for one authored pair, show the specific invariants /
   * constraints that align and how they map across the two domains.
   * params: { pairId }
   */
  registerLensAction("resonance", "pairDrilldown", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const userId = rsActor(ctx);
      const s = getResonanceState();
      const pair = rsList(s.pairs, userId).find((x) => x.id === p.pairId);
      if (!pair) return { ok: false, error: "Pair not found." };

      // Per-invariant correspondence map: best match of each A invariant to B.
      const invA = pair.a.invariants || [];
      const invB = pair.b.invariants || [];
      const invSetsB = invB.map((t) => ({ text: t, set: tokenSet(t) }));
      const correspondences = invA.map((ia) => {
        const setA = tokenSet(ia);
        let best = 0;
        let bestText = "";
        for (const ib of invSetsB) {
          const sim = jaccard(setA, ib.set);
          if (sim > best) { best = sim; bestText = ib.text; }
        }
        const sharedTokens = bestText
          ? [...setA].filter((t) => tokenSet(bestText).has(t))
          : [];
        return {
          aInvariant: ia,
          bInvariant: best >= 0.34 ? bestText : null,
          alignment: rsRound(best),
          aligned: best >= 0.34,
          sharedTokens,
        };
      });
      const alignedCount = correspondences.filter((c) => c.aligned).length;

      return {
        ok: true,
        result: {
          pair: {
            id: pair.id,
            a: { domain: pair.a.domain, title: pair.a.title },
            b: { domain: pair.b.domain, title: pair.b.title },
            resonance: pair.resonance,
            classification: pair.classification,
            invOverlap: pair.invOverlap,
            tokOverlap: pair.tokOverlap,
          },
          correspondences,
          alignedCount,
          unmatchedA: correspondences.filter((c) => !c.aligned).map((c) => c.aInvariant),
          unmatchedB: invB.filter(
            (ib) => !correspondences.some((c) => c.bInvariant === ib),
          ),
          interpretation:
            pair.classification === "strong_resonance"
              ? "Genuine structural correspondence — the domains share constraint geometry without restating the same content."
              : pair.classification === "moderate_resonance"
                ? "Partial structural alignment. Some invariants map cleanly; others diverge."
                : "Weak alignment. Few invariants correspond, or the two sides are semantically too close to be a true analogy.",
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * resonanceAlerts — list strong-signal alerts; optionally acknowledge one.
   * params: { acknowledge?: alertId, clearAcknowledged?: boolean }
   */
  registerLensAction("resonance", "resonanceAlerts", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const userId = rsActor(ctx);
      const s = getResonanceState();
      let alerts = rsList(s.alerts, userId);

      if (p.acknowledge) {
        const a = alerts.find((x) => x.id === p.acknowledge);
        if (a) { a.acknowledged = true; a.acknowledgedAt = rsNow(); }
      }
      if (p.clearAcknowledged) {
        const kept = alerts.filter((x) => !x.acknowledged);
        s.alerts.set(userId, kept);
        alerts = kept;
      }
      saveResonance();
      const unacknowledged = alerts.filter((x) => !x.acknowledged);
      return {
        ok: true,
        result: {
          alerts,
          unacknowledgedCount: unacknowledged.length,
          totalCount: alerts.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * resonanceToInsight — turn a strong resonance signal into a citable
   * hypothesis. Composes a structured DTU-shaped insight from the pair's
   * shared invariants and records it in the user's insight ledger.
   * params: { pairId, hypothesis? }
   */
  registerLensAction("resonance", "resonanceToInsight", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const userId = rsActor(ctx);
      const s = getResonanceState();
      const pair = rsList(s.pairs, userId).find((x) => x.id === p.pairId);
      if (!pair) return { ok: false, error: "Pair not found." };
      if (pair.resonance < 0.10) {
        return { ok: false, error: "Resonance too weak to form a citable hypothesis (need moderate or stronger)." };
      }

      const shared = pair.sharedInvariants || [];
      const claims = shared.map(
        (inv) => `Invariant correspondence: ${inv}`,
      );
      const hypothesis = rsClean(p.hypothesis, 1000) ||
        `If ${pair.a.domain} and ${pair.b.domain} share the invariant structure observed in "${pair.a.title}" and "${pair.b.title}", then a transfer of method from ${pair.a.domain} should hold under the same constraints in ${pair.b.domain}.`;

      const insightDtu = {
        id: rsId("insight"),
        kind: "hypothesis",
        title: `Cross-domain resonance: ${pair.a.domain} ↔ ${pair.b.domain}`,
        layers: {
          human: hypothesis,
          core: {
            claims,
            definitions: {
              resonance: "High invariant alignment with low semantic overlap.",
            },
            evidence: {
              resonance: pair.resonance,
              invariantOverlap: pair.invOverlap,
              semanticOverlap: pair.tokOverlap,
              classification: pair.classification,
            },
          },
          machine: {
            tags: ["resonance", "analogy", "cross-domain", pair.a.domain, pair.b.domain],
            sourcePairId: pair.id,
            verifier: "resonance.computePairResonance",
          },
        },
        derivedFrom: pair.id,
        confidence: pair.classification === "strong_resonance" ? 0.72 : 0.48,
        createdAt: rsNow(),
      };
      const list = rsList(s.insights, userId);
      list.unshift(insightDtu);
      if (list.length > 200) list.length = 200;
      saveResonance();
      return {
        ok: true,
        result: {
          insight: insightDtu,
          citable: true,
          totalInsights: list.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * listInsights — citable hypotheses generated from resonance signals.
   */
  registerLensAction("resonance", "listInsights", (ctx, artifact, _params) => {
    try {
      const userId = rsActor(ctx);
      const s = getResonanceState();
      const insights = rsList(s.insights, userId).slice();
      return { ok: true, result: { insights, count: insights.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * pairTrend — historical resonance trend series for one pair. Each call
   * re-evaluates the pair and appends a sample to its trend buffer, so the
   * series builds organically as the user revisits the pair over time.
   * params: { pairId }
   */
  registerLensAction("resonance", "pairTrend", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const userId = rsActor(ctx);
      const s = getResonanceState();
      const pair = rsList(s.pairs, userId).find((x) => x.id === p.pairId);
      if (!pair) return { ok: false, error: "Pair not found." };

      recomputePair(pair);
      if (!Array.isArray(pair.trend)) pair.trend = [];
      pair.trend.push({
        timestamp: rsNow(),
        resonance: pair.resonance,
        invOverlap: pair.invOverlap,
        tokOverlap: pair.tokOverlap,
        classification: pair.classification,
      });
      if (pair.trend.length > 200) pair.trend = pair.trend.slice(-200);
      saveResonance();

      const series = pair.trend;
      const first = series[0];
      const last = series[series.length - 1];
      const delta = series.length > 1 ? rsRound(last.resonance - first.resonance) : 0;
      return {
        ok: true,
        result: {
          pairId: pair.id,
          label: `${pair.a.domain} ↔ ${pair.b.domain}`,
          series,
          samples: series.length,
          current: last.resonance,
          delta,
          direction: delta > 0.005 ? "rising" : delta < -0.005 ? "falling" : "stable",
          peak: rsRound(Math.max(...series.map((x) => x.resonance))),
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
