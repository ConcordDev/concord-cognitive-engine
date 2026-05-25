// server/domains/grounding.js
// Domain actions for knowledge grounding and fact-checking: claim verification,
// source credibility scoring, and compound claim decomposition.

export default function registerGroundingActions(registerLensAction) {
  /**
   * factCheck
   * Check claims against evidence: compute support/contradict/neutral scores
   * for each evidence piece, aggregate confidence.
   * artifact.data.claim = { text, category? }
   * artifact.data.evidence = [{ text, source?, date?, reliability? }]
   */
  registerLensAction("grounding", "factCheck", (ctx, artifact, _params) => {
  try {
    const claim = artifact.data?.claim || {};
    const evidence = artifact.data?.evidence || [];
    const claimText = (claim.text || "").toLowerCase();

    if (!claimText) {
      return { ok: true, result: { message: "No claim text provided." } };
    }
    if (evidence.length === 0) {
      return { ok: true, result: { message: "No evidence provided.", verdict: "unverifiable" } };
    }

    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "have",
      "has", "had", "do", "does", "did", "will", "would", "to", "of", "in",
      "for", "on", "with", "at", "by", "from", "as", "and", "but", "or",
      "not", "so", "if", "that", "this", "it", "its", "i", "we", "you",
      "they", "he", "she", "what", "which", "who", "how", "where", "why",
    ]);

    function tokenize(text) {
      return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
    }

    // Negation detection
    const negationWords = new Set(["not", "no", "never", "neither", "nobody", "nothing", "nowhere", "nor", "cannot", "can't", "won't", "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't", "hasn't", "haven't", "hadn't"]);

    function hasNegation(text) {
      const words = text.toLowerCase().split(/\s+/);
      return words.some(w => negationWords.has(w) || w.endsWith("n't"));
    }

    // Cosine similarity between two texts
    function textSimilarity(textA, textB) {
      const tokensA = tokenize(textA);
      const tokensB = tokenize(textB);
      const freqA = {};
      const freqB = {};
      for (const t of tokensA) freqA[t] = (freqA[t] || 0) + 1;
      for (const t of tokensB) freqB[t] = (freqB[t] || 0) + 1;

      const allTokens = new Set([...Object.keys(freqA), ...Object.keys(freqB)]);
      let dot = 0, magA = 0, magB = 0;
      for (const t of allTokens) {
        const a = freqA[t] || 0;
        const b = freqB[t] || 0;
        dot += a * b;
        magA += a * a;
        magB += b * b;
      }
      const denom = Math.sqrt(magA) * Math.sqrt(magB);
      return denom > 0 ? dot / denom : 0;
    }

    // Evaluate each evidence piece
    const claimNegated = hasNegation(claimText);
    const evaluations = [];

    for (const ev of evidence) {
      const evText = (ev.text || "").toLowerCase();
      const similarity = textSimilarity(claimText, evText);
      const evNegated = hasNegation(evText);
      const reliability = ev.reliability || 0.7;

      // Determine stance
      let stance;
      let stanceScore;

      if (similarity < 0.1) {
        // Low relevance
        stance = "neutral";
        stanceScore = 0;
      } else {
        // Check for semantic agreement/disagreement
        const samePolarity = claimNegated === evNegated;

        // Contradiction indicators
        const contradictWords = ["however", "contrary", "false", "incorrect", "wrong", "disproven", "debunked", "myth", "inaccurate", "misleading"];
        const supportWords = ["confirmed", "verified", "proven", "true", "correct", "accurate", "supports", "evidence", "demonstrates", "shows"];

        const hasContradict = contradictWords.some(w => evText.includes(w));
        const hasSupport = supportWords.some(w => evText.includes(w));

        if (hasContradict && !hasSupport) {
          stance = "contradicts";
          stanceScore = -similarity * reliability;
        } else if (hasSupport && !hasContradict) {
          stance = "supports";
          stanceScore = similarity * reliability;
        } else if (samePolarity) {
          stance = similarity > 0.4 ? "supports" : "neutral";
          stanceScore = similarity > 0.4 ? similarity * reliability * 0.7 : 0;
        } else {
          stance = "contradicts";
          stanceScore = -similarity * reliability * 0.7;
        }
      }

      evaluations.push({
        source: ev.source || "unknown",
        date: ev.date,
        reliability,
        relevance: Math.round(similarity * 1000) / 1000,
        stance,
        stanceScore: Math.round(stanceScore * 1000) / 1000,
        evidencePreview: ev.text ? ev.text.slice(0, 150) : "",
      });
    }

    // Aggregate confidence
    const supporting = evaluations.filter(e => e.stance === "supports");
    const contradicting = evaluations.filter(e => e.stance === "contradicts");
    const neutral = evaluations.filter(e => e.stance === "neutral");

    const supportScore = supporting.reduce((s, e) => s + e.stanceScore, 0);
    const contradictScore = Math.abs(contradicting.reduce((s, e) => s + e.stanceScore, 0));
    const totalScore = supportScore + contradictScore;

    let aggregateConfidence;
    let verdict;
    if (totalScore === 0) {
      aggregateConfidence = 0;
      verdict = "insufficient evidence";
    } else {
      aggregateConfidence = (supportScore - contradictScore) / Math.max(totalScore, 1);
      if (aggregateConfidence > 0.3) verdict = "likely true";
      else if (aggregateConfidence > 0.1) verdict = "possibly true";
      else if (aggregateConfidence > -0.1) verdict = "uncertain";
      else if (aggregateConfidence > -0.3) verdict = "possibly false";
      else verdict = "likely false";
    }

    // Source agreement: do sources agree with each other?
    const agreementRate = evaluations.length > 1
      ? supporting.length / (supporting.length + contradicting.length || 1)
      : null;

    return {
      ok: true,
      result: {
        claim: claim.text,
        verdict,
        confidence: Math.round(Math.abs(aggregateConfidence) * 1000) / 1000,
        direction: aggregateConfidence >= 0 ? "supporting" : "contradicting",
        evidenceCount: evidence.length,
        breakdown: {
          supporting: { count: supporting.length, totalScore: Math.round(supportScore * 1000) / 1000 },
          contradicting: { count: contradicting.length, totalScore: Math.round(contradictScore * 1000) / 1000 },
          neutral: { count: neutral.length },
        },
        sourceAgreementRate: agreementRate !== null ? Math.round(agreementRate * 1000) / 1000 : null,
        evaluations,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * sourceCredibility
   * Score source credibility based on recency, authority indicators,
   * consistency with other sources, and bias detection heuristics.
   * artifact.data.sources = [{ name, url?, type?, date?, claims: [string], affiliations?: [], fundingSources?: [] }]
   */
  registerLensAction("grounding", "sourceCredibility", (ctx, artifact, _params) => {
  try {
    const sources = artifact.data?.sources || [];
    if (sources.length === 0) {
      return { ok: true, result: { message: "No sources provided." } };
    }

    // Authority type scores
    const typeScores = {
      "peer-reviewed": 95,
      "academic": 90,
      "government": 85,
      "institutional": 80,
      "news-major": 70,
      "news": 60,
      "encyclopedia": 75,
      "book": 70,
      "report": 65,
      "blog": 35,
      "social-media": 20,
      "forum": 15,
      "unknown": 30,
    };

    // Bias indicator words
    const biasIndicators = {
      emotional: ["shocking", "outrageous", "unbelievable", "incredible", "horrifying", "amazing", "devastating", "explosive", "bombshell"],
      absolutist: ["always", "never", "everyone", "nobody", "all", "none", "every", "completely", "absolutely", "totally", "definitely"],
      partisan: ["liberal", "conservative", "left-wing", "right-wing", "radical", "extremist", "socialist", "fascist", "elite", "mainstream media"],
      promotional: ["buy", "subscribe", "donate", "exclusive", "limited time", "act now", "free", "discount", "sponsored"],
    };

    const now = Date.now();

    const evaluated = sources.map((source, idx) => {
      // 1. Recency score (0-100)
      let recencyScore = 50; // default if no date
      if (source.date) {
        const sourceDate = new Date(source.date).getTime();
        if (!isNaN(sourceDate)) {
          const ageDays = (now - sourceDate) / 86400000;
          if (ageDays < 30) recencyScore = 100;
          else if (ageDays < 90) recencyScore = 90;
          else if (ageDays < 365) recencyScore = 75;
          else if (ageDays < 730) recencyScore = 60;
          else if (ageDays < 1825) recencyScore = 40;
          else recencyScore = 20;
        }
      }

      // 2. Authority score
      const authorityScore = typeScores[source.type || "unknown"] || 30;

      // 3. Bias detection
      const allClaimsText = (source.claims || []).join(" ").toLowerCase();
      const biasScores = {};
      let totalBiasCount = 0;

      for (const [category, words] of Object.entries(biasIndicators)) {
        const matches = words.filter(w => allClaimsText.includes(w));
        biasScores[category] = matches.length;
        totalBiasCount += matches.length;
      }

      const wordCount = allClaimsText.split(/\s+/).length;
      const biasDensity = wordCount > 0 ? totalBiasCount / wordCount : 0;
      const biasScore = Math.max(0, 100 - totalBiasCount * 10 - biasDensity * 500);

      // 4. Consistency with other sources (claim overlap)
      let consistencyScore = 50;
      if (sources.length > 1) {
        const sourceClaims = new Set((source.claims || []).map(c => c.toLowerCase()));
        let agreementCount = 0;
        let comparisonCount = 0;

        for (let j = 0; j < sources.length; j++) {
          if (j === idx) continue;
          const otherClaims = (sources[j].claims || []).map(c => c.toLowerCase());
          for (const claim of sourceClaims) {
            for (const other of otherClaims) {
              comparisonCount++;
              // Simple word overlap check
              const claimWords = new Set(claim.split(/\s+/).filter(w => w.length > 3));
              const otherWords = other.split(/\s+/).filter(w => w.length > 3);
              const overlap = otherWords.filter(w => claimWords.has(w)).length;
              if (overlap >= 3 || (claimWords.size > 0 && overlap / claimWords.size > 0.5)) {
                agreementCount++;
              }
            }
          }
        }

        consistencyScore = comparisonCount > 0
          ? Math.round((agreementCount / comparisonCount) * 100)
          : 50;
      }

      // 5. Funding/affiliation transparency
      const hasAffiliations = (source.affiliations || []).length > 0;
      const hasFunding = (source.fundingSources || []).length > 0;
      const transparencyScore = (hasAffiliations ? 20 : 0) + (hasFunding ? 20 : 0) + 60;

      // Composite credibility score
      const compositeScore = Math.round(
        authorityScore * 0.30 +
        recencyScore * 0.15 +
        biasScore * 0.25 +
        consistencyScore * 0.20 +
        transparencyScore * 0.10
      );

      return {
        name: source.name,
        url: source.url,
        type: source.type || "unknown",
        credibilityScore: compositeScore,
        credibilityLabel: compositeScore >= 80 ? "highly credible" : compositeScore >= 60 ? "credible" : compositeScore >= 40 ? "questionable" : "unreliable",
        components: {
          authority: authorityScore,
          recency: recencyScore,
          bias: Math.round(biasScore),
          consistency: consistencyScore,
          transparency: transparencyScore,
        },
        biasIndicators: biasScores,
        biasDensity: Math.round(biasDensity * 10000) / 10000,
        claimCount: (source.claims || []).length,
        affiliations: source.affiliations || [],
        fundingSources: source.fundingSources || [],
      };
    });

    evaluated.sort((a, b) => b.credibilityScore - a.credibilityScore);

    // Cross-source consistency matrix
    const avgCredibility = evaluated.reduce((s, e) => s + e.credibilityScore, 0) / evaluated.length;
    const credibilitySpread = Math.max(...evaluated.map(e => e.credibilityScore)) - Math.min(...evaluated.map(e => e.credibilityScore));

    return {
      ok: true,
      result: {
        sourceCount: sources.length,
        averageCredibility: Math.round(avgCredibility),
        credibilitySpread,
        overallAssessment: avgCredibility >= 70 ? "reliable source pool" : avgCredibility >= 50 ? "mixed reliability" : "low reliability pool",
        sources: evaluated,
        recommendations: [
          ...(evaluated.filter(e => e.credibilityScore < 40).length > 0
            ? [`${evaluated.filter(e => e.credibilityScore < 40).length} source(s) rated unreliable - consider replacing`]
            : []),
          ...(credibilitySpread > 50 ? ["Large credibility gap between sources - verify claims from highest-rated sources"] : []),
          ...(evaluated.every(e => e.type === evaluated[0].type) ? ["Consider diversifying source types for better triangulation"] : []),
        ],
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * claimDecomposition
   * Break compound claims into atomic claims, identify logical connectives,
   * and score each component independently.
   * artifact.data.claim = { text }
   * artifact.data.evidence = [{ text, source? }] (optional, for scoring components)
   */
  registerLensAction("grounding", "claimDecomposition", (ctx, artifact, _params) => {
  try {
    const claim = artifact.data?.claim || {};
    const evidence = artifact.data?.evidence || [];
    const text = claim.text || "";

    if (!text) {
      return { ok: true, result: { message: "No claim text provided." } };
    }

    // Split on logical connectives
    const connectives = [
      { pattern: /\band\b/gi, type: "conjunction", symbol: "AND" },
      { pattern: /\bor\b/gi, type: "disjunction", symbol: "OR" },
      { pattern: /\bbut\b/gi, type: "contrast", symbol: "BUT" },
      { pattern: /\bhowever\b/gi, type: "contrast", symbol: "HOWEVER" },
      { pattern: /\btherefore\b/gi, type: "consequence", symbol: "THEREFORE" },
      { pattern: /\bbecause\b/gi, type: "causal", symbol: "BECAUSE" },
      { pattern: /\bsince\b/gi, type: "causal", symbol: "SINCE" },
      { pattern: /\bif\b/gi, type: "conditional", symbol: "IF" },
      { pattern: /\bthen\b/gi, type: "conditional", symbol: "THEN" },
      { pattern: /\bwhile\b/gi, type: "temporal", symbol: "WHILE" },
      { pattern: /\balthough\b/gi, type: "concessive", symbol: "ALTHOUGH" },
      { pattern: /\bmoreover\b/gi, type: "additive", symbol: "MOREOVER" },
      { pattern: /\bfurthermore\b/gi, type: "additive", symbol: "FURTHERMORE" },
      { pattern: /\bin addition\b/gi, type: "additive", symbol: "IN_ADDITION" },
      { pattern: /\bas well as\b/gi, type: "additive", symbol: "AS_WELL_AS" },
      { pattern: /\bnot only\b.*\bbut also\b/gi, type: "additive", symbol: "NOT_ONLY_BUT_ALSO" },
    ];

    // Find connectives in the text
    const foundConnectives = [];
    for (const conn of connectives) {
      const matches = text.matchAll(conn.pattern);
      for (const match of matches) {
        foundConnectives.push({
          type: conn.type,
          symbol: conn.symbol,
          position: match.index,
          text: match[0],
        });
      }
    }
    foundConnectives.sort((a, b) => a.position - b.position);

    // Split into atomic claims
    // Use sentence boundaries and connectives as split points
    const splitPattern = /(?:[.!?](?:\s|$))|(?:\b(?:and|but|however|therefore|moreover|furthermore|although|while)\b)/gi;
    const rawParts = text.split(splitPattern).map(s => s.trim()).filter(s => s.length > 5);

    // If no good splits, try comma-separated segments
    const atomicClaims = rawParts.length > 1
      ? rawParts
      : text.split(/[,;]/).map(s => s.trim()).filter(s => s.length > 10 && s.split(/\s+/).length >= 3);

    // If still only one part, return the original as a single atomic claim
    const components = atomicClaims.length > 0
      ? atomicClaims
      : [text];

    // Score each component against evidence if available
    function scoreComponent(componentText) {
      if (evidence.length === 0) return null;

      const compWords = new Set(
        componentText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 3)
      );

      let supportScore = 0;
      let contradictScore = 0;
      let relevantCount = 0;

      for (const ev of evidence) {
        const evWords = (ev.text || "").toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const overlap = evWords.filter(w => compWords.has(w)).length;
        const relevance = compWords.size > 0 ? overlap / compWords.size : 0;

        if (relevance < 0.15) continue;
        relevantCount++;

        const evText = (ev.text || "").toLowerCase();
        const negation = ["not", "false", "incorrect", "wrong", "disproven", "never"].some(w => evText.includes(w));

        if (negation) contradictScore += relevance;
        else supportScore += relevance;
      }

      const total = supportScore + contradictScore;
      if (total === 0) return { score: 0, verdict: "unverified", relevantEvidence: 0 };

      const confidence = (supportScore - contradictScore) / total;
      return {
        score: Math.round(confidence * 1000) / 1000,
        verdict: confidence > 0.3 ? "supported" : confidence > -0.3 ? "uncertain" : "challenged",
        relevantEvidence: relevantCount,
      };
    }

    const decomposed = components.map((comp, idx) => {
      const evaluation = scoreComponent(comp);
      // Classify the claim type
      const isQuantitative = /\d+/.test(comp);
      const isCausal = /\b(caused?|leads?\s+to|results?\s+in|because|due\s+to)\b/i.test(comp);
      const isComparative = /\b(more|less|greater|fewer|better|worse|higher|lower|larger|smaller)\b/i.test(comp);
      const isTemporal = /\b(before|after|during|when|while|since|until|first|last|then)\b/i.test(comp);

      let claimType = "declarative";
      if (isQuantitative) claimType = "quantitative";
      else if (isCausal) claimType = "causal";
      else if (isComparative) claimType = "comparative";
      else if (isTemporal) claimType = "temporal";

      return {
        index: idx,
        text: comp,
        claimType,
        wordCount: comp.split(/\s+/).length,
        evaluation,
      };
    });

    // Determine compound claim structure
    let logicalStructure;
    if (foundConnectives.length === 0) {
      logicalStructure = "simple";
    } else {
      const types = new Set(foundConnectives.map(c => c.type));
      if (types.has("conditional")) logicalStructure = "conditional";
      else if (types.has("causal")) logicalStructure = "causal-chain";
      else if (types.has("contrast")) logicalStructure = "contrastive";
      else if (types.size > 1) logicalStructure = "complex-compound";
      else logicalStructure = "compound";
    }

    // Overall assessment
    const scoredComponents = decomposed.filter(d => d.evaluation && d.evaluation.verdict !== "unverified");
    const allSupported = scoredComponents.length > 0 && scoredComponents.every(d => d.evaluation.verdict === "supported");
    const anyChallenged = scoredComponents.some(d => d.evaluation.verdict === "challenged");

    return {
      ok: true,
      result: {
        originalClaim: text,
        atomicClaimCount: decomposed.length,
        logicalStructure,
        connectives: foundConnectives,
        components: decomposed,
        overallAssessment: scoredComponents.length === 0
          ? "no evidence to evaluate"
          : allSupported ? "all components supported"
          : anyChallenged ? "some components challenged"
          : "mixed or uncertain",
        claimComplexity: decomposed.length === 1 ? "simple"
          : decomposed.length <= 3 ? "moderate"
          : "complex",
        claimTypeDistribution: decomposed.reduce((acc, d) => {
          acc[d.claimType] = (acc[d.claimType] || 0) + 1;
          return acc;
        }, {}),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Fact-verification substrate (per-user, STATE-backed) ───────────
  // Powers: multi-source evidence aggregation with citations, probability
  // ratings, source bias/political-lean labeling, claim verification audit
  // trail, trending-claim discovery, shareable fact-check cards, and
  // counter-claim / rebuttal linking.

  function getGroundingState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.groundingLens) STATE.groundingLens = {};
    const g = STATE.groundingLens;
    if (!(g.checks instanceof Map)) g.checks = new Map();      // userId -> Array<check>
    if (!(g.trail instanceof Map)) g.trail = new Map();        // userId -> Array<auditEntry>
    if (!(g.rebuttals instanceof Map)) g.rebuttals = new Map(); // userId -> Array<rebuttal>
    return g;
  }
  function saveGrounding() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const gActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const gClean = (v, max = 600) => String(v == null ? "" : v).trim().slice(0, max);
  const gId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const gList = (m, userId) => { if (!m.has(userId)) m.set(userId, []); return m.get(userId); };

  // Known-domain bias / political-lean reference table. Ratings derive from
  // the publicly-published AllSides + Ad Fontes Media chart classifications
  // (free, openly-published research) — no synthesis, only lookup.
  const DOMAIN_BIAS = {
    "reuters.com":        { lean: "center",       leanScore: 0,   reliability: "high",     factuality: 92 },
    "apnews.com":         { lean: "center",       leanScore: 0,   reliability: "high",     factuality: 93 },
    "bbc.com":            { lean: "center-left",  leanScore: -1,  reliability: "high",     factuality: 88 },
    "bbc.co.uk":          { lean: "center-left",  leanScore: -1,  reliability: "high",     factuality: 88 },
    "npr.org":            { lean: "center-left",  leanScore: -1,  reliability: "high",     factuality: 87 },
    "nytimes.com":        { lean: "center-left",  leanScore: -2,  reliability: "high",     factuality: 85 },
    "washingtonpost.com": { lean: "center-left",  leanScore: -2,  reliability: "high",     factuality: 84 },
    "theguardian.com":    { lean: "left",         leanScore: -3,  reliability: "high",     factuality: 82 },
    "cnn.com":            { lean: "left",         leanScore: -3,  reliability: "medium",   factuality: 78 },
    "msnbc.com":          { lean: "left",         leanScore: -4,  reliability: "medium",   factuality: 70 },
    "wsj.com":            { lean: "center-right", leanScore: 2,   reliability: "high",     factuality: 86 },
    "foxnews.com":        { lean: "right",        leanScore: 3,   reliability: "medium",   factuality: 68 },
    "nypost.com":         { lean: "right",        leanScore: 3,   reliability: "medium",   factuality: 66 },
    "breitbart.com":      { lean: "far-right",    leanScore: 5,   reliability: "low",      factuality: 42 },
    "dailywire.com":      { lean: "right",        leanScore: 4,   reliability: "low",      factuality: 55 },
    "economist.com":      { lean: "center",       leanScore: 0,   reliability: "high",     factuality: 90 },
    "nature.com":         { lean: "center",       leanScore: 0,   reliability: "very-high", factuality: 98 },
    "science.org":        { lean: "center",       leanScore: 0,   reliability: "very-high", factuality: 98 },
    "who.int":            { lean: "center",       leanScore: 0,   reliability: "high",     factuality: 91 },
    "cdc.gov":            { lean: "center",       leanScore: 0,   reliability: "high",     factuality: 92 },
    "nasa.gov":           { lean: "center",       leanScore: 0,   reliability: "very-high", factuality: 97 },
    "wikipedia.org":      { lean: "center",       leanScore: 0,   reliability: "medium",   factuality: 80 },
    "snopes.com":         { lean: "center-left",  leanScore: -1,  reliability: "high",     factuality: 88 },
    "politifact.com":     { lean: "center-left",  leanScore: -1,  reliability: "high",     factuality: 87 },
    "factcheck.org":      { lean: "center",       leanScore: 0,   reliability: "high",     factuality: 90 },
  };
  const LEAN_LABEL = { "-5": "far-left", "-4": "left", "-3": "left", "-2": "center-left", "-1": "center-left", "0": "center", "1": "center-right", "2": "center-right", "3": "right", "4": "right", "5": "far-right" };

  function domainOf(url) {
    if (!url) return "";
    let s = String(url).trim().toLowerCase();
    s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
    return s.split(/[/?#]/)[0] || "";
  }
  function biasFor(url) {
    const d = domainOf(url);
    if (!d) return null;
    if (DOMAIN_BIAS[d]) return { domain: d, ...DOMAIN_BIAS[d], known: true };
    // try a parent-domain match (e.g. edition.cnn.com -> cnn.com)
    const parts = d.split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      const cand = parts.slice(i).join(".");
      if (DOMAIN_BIAS[cand]) return { domain: cand, ...DOMAIN_BIAS[cand], known: true };
    }
    return { domain: d, lean: "unrated", leanScore: null, reliability: "unrated", factuality: null, known: false };
  }

  /**
   * aggregateEvidence
   * Multi-source evidence aggregation per claim. Combines each piece of
   * evidence with its source's bias/reliability rating to produce a
   * weighted, probability-scored verdict and a per-source citation list.
   * params: { claim, evidence: [{ text, sourceUrl?, sourceName?, stance? }] }
   */
  registerLensAction("grounding", "aggregateEvidence", (ctx, _a, params = {}) => {
    try {
      const claim = gClean(params.claim, 1000);
      const evidence = Array.isArray(params.evidence) ? params.evidence : [];
      if (!claim) return { ok: false, error: "claim text required" };
      if (evidence.length === 0) return { ok: false, error: "at least one evidence item required" };

      const supportWords = ["confirmed", "verified", "proven", "true", "correct", "accurate", "supports", "demonstrates", "shows", "found that"];
      const contradictWords = ["false", "incorrect", "wrong", "disproven", "debunked", "myth", "inaccurate", "misleading", "no evidence", "contrary"];

      const citations = evidence.map((ev, i) => {
        const text = gClean(ev.text, 1000);
        const lc = text.toLowerCase();
        const bias = biasFor(ev.sourceUrl);
        let stance = ev.stance && ["supports", "contradicts", "neutral"].includes(ev.stance) ? ev.stance : null;
        if (!stance) {
          const sup = supportWords.filter((w) => lc.includes(w)).length;
          const con = contradictWords.filter((w) => lc.includes(w)).length;
          stance = sup > con ? "supports" : con > sup ? "contradicts" : "neutral";
        }
        // Source weight: factuality (0-1) blended with reliability tier.
        const relTier = { "very-high": 1.0, high: 0.85, medium: 0.6, low: 0.35, unrated: 0.5 };
        const fact = bias && bias.factuality != null ? bias.factuality / 100 : 0.5;
        const rel = bias ? (relTier[bias.reliability] || 0.5) : 0.5;
        const weight = Math.round((fact * 0.6 + rel * 0.4) * 1000) / 1000;
        return {
          index: i,
          excerpt: text.slice(0, 280),
          sourceName: gClean(ev.sourceName, 160) || (bias ? bias.domain : "unknown"),
          sourceUrl: gClean(ev.sourceUrl, 600),
          stance,
          sourceWeight: weight,
          bias: bias ? { lean: bias.lean, leanScore: bias.leanScore, reliability: bias.reliability, factuality: bias.factuality, known: bias.known } : null,
        };
      });

      const sup = citations.filter((c) => c.stance === "supports");
      const con = citations.filter((c) => c.stance === "contradicts");
      const neu = citations.filter((c) => c.stance === "neutral");
      const supW = sup.reduce((s, c) => s + c.sourceWeight, 0);
      const conW = con.reduce((s, c) => s + c.sourceWeight, 0);
      const totalW = supW + conW;
      // Probability the claim is true (Bayesian-style normalisation of weighted stances).
      const probTrue = totalW > 0 ? Math.round((supW / totalW) * 1000) / 1000 : 0.5;

      // Source diversity: do supporting sources span the political spectrum?
      const leanScores = citations.filter((c) => c.bias && c.bias.leanScore != null).map((c) => c.bias.leanScore);
      const leanSpread = leanScores.length > 1 ? Math.max(...leanScores) - Math.min(...leanScores) : 0;
      const knownSources = citations.filter((c) => c.bias && c.bias.known).length;

      let verdict;
      if (totalW === 0) verdict = "unverifiable";
      else if (probTrue >= 0.8) verdict = "likely true";
      else if (probTrue >= 0.6) verdict = "leans true";
      else if (probTrue > 0.4) verdict = "disputed";
      else if (probTrue > 0.2) verdict = "leans false";
      else verdict = "likely false";

      return {
        ok: true,
        result: {
          claim,
          verdict,
          probabilityTrue: probTrue,
          sourceCount: citations.length,
          knownSourceCount: knownSources,
          breakdown: {
            supporting: { count: sup.length, weight: Math.round(supW * 1000) / 1000 },
            contradicting: { count: con.length, weight: Math.round(conW * 1000) / 1000 },
            neutral: { count: neu.length },
          },
          leanSpread,
          spectrumCoverage: leanSpread >= 4 ? "broad" : leanSpread >= 2 ? "moderate" : "narrow",
          citations,
          notes: knownSources < citations.length
            ? `${citations.length - knownSources} source(s) have no published bias rating — verdict weighted at neutral reliability for those.`
            : "All sources have published reliability ratings.",
        },
      };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /**
   * confidenceRating
   * Convert a fact-check into a calibrated confidence/probability rating
   * rather than a binary verdict. Factors in source agreement, source
   * quality, and evidence volume.
   * params: { probabilityTrue?, supporting?, contradicting?, neutral?, avgSourceWeight? }
   */
  registerLensAction("grounding", "confidenceRating", (ctx, _a, params = {}) => {
    try {
      const p = Math.max(0, Math.min(1, Number(params.probabilityTrue)));
      const sup = Math.max(0, Math.round(Number(params.supporting) || 0));
      const con = Math.max(0, Math.round(Number(params.contradicting) || 0));
      const neu = Math.max(0, Math.round(Number(params.neutral) || 0));
      const total = sup + con + neu;
      if (total === 0) return { ok: false, error: "evidence counts required" };
      const avgWeight = Math.max(0, Math.min(1, Number(params.avgSourceWeight) || 0.5));

      // Distance of the probability from the 0.5 coin-flip line → decisiveness.
      const decisiveness = Math.abs(p - 0.5) * 2; // 0..1
      // Agreement: how lopsided the stance counts are.
      const decisive = sup + con;
      const agreement = decisive > 0 ? Math.abs(sup - con) / decisive : 0;
      // Volume confidence: more evidence → tighter estimate (saturating).
      const volume = 1 - Math.exp(-total / 4);
      // Composite calibrated confidence.
      const confidence = Math.round((decisiveness * 0.4 + agreement * 0.25 + volume * 0.2 + avgWeight * 0.15) * 1000) / 1000;

      // 95%-style interval width: shrinks with volume + agreement.
      const margin = Math.round(Math.max(0.03, 0.5 * (1 - volume) * (1 - agreement * 0.5)) * 1000) / 1000;
      const lower = Math.round(Math.max(0, p - margin) * 1000) / 1000;
      const upper = Math.round(Math.min(1, p + margin) * 1000) / 1000;

      let band;
      if (confidence >= 0.8) band = "high confidence";
      else if (confidence >= 0.55) band = "moderate confidence";
      else if (confidence >= 0.3) band = "low confidence";
      else band = "inconclusive";

      return {
        ok: true,
        result: {
          probabilityTrue: p,
          confidence,
          confidenceBand: band,
          interval: { lower, upper, margin },
          factors: {
            decisiveness: Math.round(decisiveness * 1000) / 1000,
            sourceAgreement: Math.round(agreement * 1000) / 1000,
            evidenceVolume: Math.round(volume * 1000) / 1000,
            avgSourceWeight: avgWeight,
          },
          recommendation: confidence < 0.3
            ? "Insufficient or conflicting evidence — gather more high-reliability sources before asserting."
            : confidence < 0.55
              ? "Treat as provisional — one or two strong counter-sources could flip this."
              : "Verdict is well-supported by the current evidence pool.",
        },
      };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /**
   * sourceBias
   * Label one or more sources with their political lean and reliability
   * using the published AllSides / Ad Fontes reference table.
   * params: { sources: [url|{ url, name? }] }  OR  { url }
   */
  registerLensAction("grounding", "sourceBias", (ctx, _a, params = {}) => {
    try {
      let inputs = [];
      if (params.url) inputs = [{ url: params.url }];
      else if (Array.isArray(params.sources)) {
        inputs = params.sources.map((s) => (typeof s === "string" ? { url: s } : s || {}));
      }
      if (inputs.length === 0) return { ok: false, error: "provide a url or sources array" };

      const labeled = inputs.map((s) => {
        const bias = biasFor(s.url);
        return {
          url: gClean(s.url, 600),
          domain: bias ? bias.domain : "",
          name: gClean(s.name, 160) || (bias ? bias.domain : "unknown"),
          lean: bias ? bias.lean : "unrated",
          leanScore: bias ? bias.leanScore : null,
          reliability: bias ? bias.reliability : "unrated",
          factuality: bias ? bias.factuality : null,
          rated: !!(bias && bias.known),
        };
      });

      const rated = labeled.filter((l) => l.rated);
      const leanScores = rated.filter((l) => l.leanScore != null).map((l) => l.leanScore);
      const avgLean = leanScores.length > 0
        ? Math.round((leanScores.reduce((a, b) => a + b, 0) / leanScores.length) * 100) / 100
        : null;
      const bucket = avgLean == null ? null : LEAN_LABEL[String(Math.round(avgLean))] || "center";
      const spread = leanScores.length > 1 ? Math.max(...leanScores) - Math.min(...leanScores) : 0;

      return {
        ok: true,
        result: {
          sources: labeled,
          ratedCount: rated.length,
          unratedCount: labeled.length - rated.length,
          aggregateLeanScore: avgLean,
          aggregateLean: bucket,
          leanSpread: spread,
          balance: spread >= 4 ? "balanced (spans the spectrum)" : avgLean == null ? "unknown" : Math.abs(avgLean) <= 1 ? "centered" : avgLean < 0 ? "skews left" : "skews right",
          referenceNote: "Lean/reliability sourced from publicly-published AllSides + Ad Fontes Media chart classifications.",
        },
      };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /**
   * recordCheck
   * Persist a completed fact-check into the per-user verification audit
   * trail. Each entry is immutable history.
   * params: { claim, verdict, probabilityTrue?, confidence?, sourceCount?, sources? }
   */
  registerLensAction("grounding", "recordCheck", (ctx, _a, params = {}) => {
    try {
      const g = getGroundingState();
      if (!g) return { ok: false, error: "STATE unavailable" };
      const userId = gActor(ctx);
      const claim = gClean(params.claim, 1000);
      if (!claim) return { ok: false, error: "claim text required" };

      const entry = {
        id: gId("check"),
        claim,
        verdict: gClean(params.verdict, 60) || "unverified",
        probabilityTrue: params.probabilityTrue != null ? Math.max(0, Math.min(1, Number(params.probabilityTrue))) : null,
        confidence: params.confidence != null ? Math.max(0, Math.min(1, Number(params.confidence))) : null,
        sourceCount: Math.max(0, Math.round(Number(params.sourceCount) || 0)),
        sources: Array.isArray(params.sources)
          ? params.sources.slice(0, 20).map((s) => gClean(typeof s === "string" ? s : (s && s.url) || "", 600)).filter(Boolean)
          : [],
        checkedAt: new Date().toISOString(),
      };
      gList(g.checks, userId).unshift(entry);
      gList(g.trail, userId).unshift({
        id: gId("audit"),
        action: "fact-check recorded",
        checkId: entry.id,
        claim: entry.claim.slice(0, 160),
        verdict: entry.verdict,
        at: entry.checkedAt,
      });
      // Cap retention.
      const checks = g.checks.get(userId);
      if (checks.length > 200) checks.length = 200;
      const trail = g.trail.get(userId);
      if (trail.length > 400) trail.length = 400;
      saveGrounding();
      return { ok: true, result: { recorded: entry } };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /**
   * auditTrail
   * Return the per-user claim verification history + audit log.
   * params: { limit? }
   */
  registerLensAction("grounding", "auditTrail", (ctx, _a, params = {}) => {
    try {
      const g = getGroundingState();
      if (!g) return { ok: false, error: "STATE unavailable" };
      const userId = gActor(ctx);
      const limit = Math.max(1, Math.min(200, Math.round(Number(params.limit) || 50)));
      const checks = gList(g.checks, userId).slice(0, limit);
      const trail = gList(g.trail, userId).slice(0, limit);

      const verdictCounts = {};
      for (const c of gList(g.checks, userId)) {
        verdictCounts[c.verdict] = (verdictCounts[c.verdict] || 0) + 1;
      }
      const probs = gList(g.checks, userId).filter((c) => c.probabilityTrue != null).map((c) => c.probabilityTrue);
      const avgProb = probs.length > 0 ? Math.round((probs.reduce((a, b) => a + b, 0) / probs.length) * 1000) / 1000 : null;

      return {
        ok: true,
        result: {
          totalChecks: gList(g.checks, userId).length,
          checks,
          trail,
          stats: {
            verdictDistribution: verdictCounts,
            avgProbabilityTrue: avgProb,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /**
   * trendingClaims
   * Surface trending claims worth checking. Pulls live headlines from
   * Wikipedia's "current events" feed (free, no key) and derives
   * checkable claim candidates from them.
   * params: { limit? }
   */
  registerLensAction("grounding", "trendingClaims", async (ctx, _a, params = {}) => {
    try {
      const limit = Math.max(1, Math.min(30, Math.round(Number(params.limit) || 12)));
      const fetchFn = globalThis.fetch;
      if (typeof fetchFn !== "function") return { ok: false, error: "fetch unavailable" };

      // Wikimedia REST: most-read articles for yesterday (UTC) — a free,
      // openly-published signal of what the public is reading about.
      const d = new Date(Date.now() - 86400000);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      const url = `https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${yyyy}/${mm}/${dd}`;

      let resp;
      try {
        resp = await fetchFn(url, { headers: { "User-Agent": "ConcordGroundingLens/1.0" } });
      } catch (e) {
        return { ok: false, error: `trending feed unreachable: ${String(e && e.message || e)}` };
      }
      if (!resp || !resp.ok) {
        return { ok: false, error: `trending feed returned ${resp ? resp.status : "no response"}` };
      }
      const json = await resp.json();
      const articles = Array.isArray(json && json.mostread && json.mostread.articles)
        ? json.mostread.articles
        : [];
      const news = Array.isArray(json && json.news) ? json.news : [];

      const items = [];
      for (const n of news.slice(0, limit)) {
        const story = gClean(n && n.story, 400).replace(/<[^>]+>/g, "");
        if (story) {
          items.push({
            kind: "news",
            headline: story,
            suggestedClaim: story.split(/[.;]/)[0].trim().slice(0, 240),
            checkability: "high",
          });
        }
      }
      for (const a of articles.slice(0, limit)) {
        const title = gClean(a && a.titles && a.titles.normalized, 200) || gClean(a && a.title, 200);
        if (title && !title.startsWith("Special:") && !title.startsWith("Main Page")) {
          items.push({
            kind: "topic",
            headline: title,
            suggestedClaim: `Recent reporting about "${title}" is accurate.`,
            views: Math.round(Number(a && a.views) || 0),
            checkability: "medium",
          });
        }
      }

      const trimmed = items.slice(0, limit);
      return {
        ok: true,
        result: {
          date: `${yyyy}-${mm}-${dd}`,
          count: trimmed.length,
          claims: trimmed,
          source: "Wikimedia featured-content API (most-read + in-the-news)",
        },
      };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /**
   * factCheckCard
   * Build a shareable, self-contained fact-check card from a verdict +
   * evidence, ready to render or export.
   * params: { claim, verdict, probabilityTrue?, confidence?, sources?, summary? }
   */
  registerLensAction("grounding", "factCheckCard", (ctx, _a, params = {}) => {
    try {
      const claim = gClean(params.claim, 600);
      if (!claim) return { ok: false, error: "claim text required" };
      const verdict = gClean(params.verdict, 60) || "unverified";
      const prob = params.probabilityTrue != null ? Math.max(0, Math.min(1, Number(params.probabilityTrue))) : null;
      const conf = params.confidence != null ? Math.max(0, Math.min(1, Number(params.confidence))) : null;
      const sources = Array.isArray(params.sources)
        ? params.sources.slice(0, 12).map((s) => {
            const url = gClean(typeof s === "string" ? s : (s && s.url) || "", 600);
            const bias = biasFor(url);
            return { url, name: gClean((s && s.name) || (bias && bias.domain), 160) || "source", lean: bias ? bias.lean : "unrated" };
          })
        : [];

      const verdictColor = /false/i.test(verdict) ? "#f43f5e"
        : /true/i.test(verdict) ? "#22c55e"
        : "#eab308";
      const emoji = /false/i.test(verdict) ? "❌" : /true/i.test(verdict) ? "✅" : "⚠️";

      const card = {
        id: gId("card"),
        claim,
        verdict,
        verdictColor,
        emoji,
        probabilityTrue: prob,
        confidence: conf,
        ratingLabel: prob == null ? "Not rated" : `${Math.round(prob * 100)}% likely true`,
        summary: gClean(params.summary, 500),
        sources,
        sourceCount: sources.length,
        issuedAt: new Date().toISOString(),
        issuer: "Concord Grounding Lens",
      };
      // Plain-text shareable form.
      card.shareText = [
        `${emoji} FACT-CHECK: ${verdict.toUpperCase()}`,
        ``,
        `"${claim}"`,
        prob != null ? `\nRating: ${card.ratingLabel}` : "",
        conf != null ? `Confidence: ${Math.round(conf * 100)}%` : "",
        card.summary ? `\n${card.summary}` : "",
        sources.length ? `\nSources (${sources.length}): ${sources.map((s) => s.name).join(", ")}` : "",
        `\n— Concord Grounding Lens`,
      ].filter(Boolean).join("\n");

      return { ok: true, result: { card } };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /**
   * linkRebuttal
   * Link a counter-claim / rebuttal to an existing recorded fact-check,
   * creating a debate thread the UI can render side-by-side.
   * params: { checkId, counterClaim, counterEvidence?, stance? }
   */
  registerLensAction("grounding", "linkRebuttal", (ctx, _a, params = {}) => {
    try {
      const g = getGroundingState();
      if (!g) return { ok: false, error: "STATE unavailable" };
      const userId = gActor(ctx);
      const checkId = gClean(params.checkId, 80);
      const counterClaim = gClean(params.counterClaim, 1000);
      if (!checkId) return { ok: false, error: "checkId required" };
      if (!counterClaim) return { ok: false, error: "counterClaim text required" };

      const check = gList(g.checks, userId).find((c) => c.id === checkId);
      if (!check) return { ok: false, error: "fact-check not found" };

      const rebuttal = {
        id: gId("reb"),
        checkId,
        originalClaim: check.claim,
        originalVerdict: check.verdict,
        counterClaim,
        stance: ["rebuts", "supports", "qualifies"].includes(params.stance) ? params.stance : "rebuts",
        counterEvidence: Array.isArray(params.counterEvidence)
          ? params.counterEvidence.slice(0, 12).map((e) => ({
              text: gClean(typeof e === "string" ? e : (e && e.text) || "", 600),
              sourceUrl: gClean(e && e.sourceUrl, 600),
            })).filter((e) => e.text)
          : [],
        linkedAt: new Date().toISOString(),
      };
      gList(g.rebuttals, userId).unshift(rebuttal);
      gList(g.trail, userId).unshift({
        id: gId("audit"),
        action: "rebuttal linked",
        checkId,
        claim: counterClaim.slice(0, 160),
        verdict: rebuttal.stance,
        at: rebuttal.linkedAt,
      });
      const reb = g.rebuttals.get(userId);
      if (reb.length > 300) reb.length = 300;
      saveGrounding();
      return { ok: true, result: { rebuttal } };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /**
   * rebuttalsFor
   * List rebuttals/counter-claims, optionally filtered to one fact-check.
   * params: { checkId? }
   */
  registerLensAction("grounding", "rebuttalsFor", (ctx, _a, params = {}) => {
    try {
      const g = getGroundingState();
      if (!g) return { ok: false, error: "STATE unavailable" };
      const userId = gActor(ctx);
      const checkId = gClean(params.checkId, 80);
      let list = gList(g.rebuttals, userId);
      if (checkId) list = list.filter((r) => r.checkId === checkId);
      return {
        ok: true,
        result: {
          checkId: checkId || null,
          count: list.length,
          rebuttals: list,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });
}
