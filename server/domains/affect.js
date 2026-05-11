// server/domains/affect.js
// Domain actions for emotional/sentiment analysis: sentiment scoring, emotion timelines, empathy mapping.

export default function registerAffectActions(registerLensAction) {
  /**
   * sentimentAnalysis
   * Multi-dimensional sentiment scoring — valence, arousal, dominance (VAD) model,
   * detect mixed emotions and sarcasm indicators.
   * artifact.data.text: string — the text to analyze
   * artifact.data.lexicon: { word: { valence, arousal, dominance } } — optional VAD lexicon
   * params.detectSarcasm — whether to run sarcasm heuristics (default true)
   */
  registerLensAction("affect", "sentimentAnalysis", (ctx, artifact, params) => {
    const text = artifact.data.text || "";
    if (!text.trim()) {
      return { ok: true, result: { message: "No text provided for sentiment analysis." } };
    }

    const detectSarcasm = params.detectSarcasm !== false;

    // Default VAD lexicon (simplified; real systems use NRC-VAD or similar)
    const defaultLexicon = {
      happy: { valence: 0.9, arousal: 0.6, dominance: 0.7 },
      joy: { valence: 0.95, arousal: 0.7, dominance: 0.7 },
      love: { valence: 0.95, arousal: 0.7, dominance: 0.5 },
      great: { valence: 0.85, arousal: 0.5, dominance: 0.6 },
      excellent: { valence: 0.9, arousal: 0.5, dominance: 0.7 },
      wonderful: { valence: 0.9, arousal: 0.6, dominance: 0.6 },
      amazing: { valence: 0.9, arousal: 0.7, dominance: 0.6 },
      good: { valence: 0.7, arousal: 0.4, dominance: 0.5 },
      nice: { valence: 0.7, arousal: 0.3, dominance: 0.5 },
      like: { valence: 0.6, arousal: 0.3, dominance: 0.5 },
      fine: { valence: 0.5, arousal: 0.2, dominance: 0.5 },
      okay: { valence: 0.5, arousal: 0.2, dominance: 0.5 },
      sad: { valence: 0.1, arousal: 0.3, dominance: 0.2 },
      angry: { valence: 0.15, arousal: 0.85, dominance: 0.7 },
      furious: { valence: 0.05, arousal: 0.95, dominance: 0.8 },
      hate: { valence: 0.05, arousal: 0.8, dominance: 0.7 },
      terrible: { valence: 0.1, arousal: 0.7, dominance: 0.3 },
      awful: { valence: 0.1, arousal: 0.6, dominance: 0.3 },
      bad: { valence: 0.2, arousal: 0.5, dominance: 0.3 },
      horrible: { valence: 0.05, arousal: 0.7, dominance: 0.3 },
      fear: { valence: 0.1, arousal: 0.9, dominance: 0.1 },
      afraid: { valence: 0.1, arousal: 0.8, dominance: 0.15 },
      anxious: { valence: 0.2, arousal: 0.75, dominance: 0.2 },
      worried: { valence: 0.2, arousal: 0.65, dominance: 0.25 },
      disgusted: { valence: 0.1, arousal: 0.7, dominance: 0.6 },
      surprised: { valence: 0.5, arousal: 0.85, dominance: 0.3 },
      shocked: { valence: 0.3, arousal: 0.9, dominance: 0.2 },
      calm: { valence: 0.7, arousal: 0.1, dominance: 0.6 },
      peaceful: { valence: 0.8, arousal: 0.1, dominance: 0.5 },
      excited: { valence: 0.8, arousal: 0.9, dominance: 0.6 },
      bored: { valence: 0.3, arousal: 0.1, dominance: 0.3 },
      disappointed: { valence: 0.2, arousal: 0.4, dominance: 0.25 },
      frustrated: { valence: 0.2, arousal: 0.7, dominance: 0.4 },
      hopeful: { valence: 0.75, arousal: 0.5, dominance: 0.5 },
      grateful: { valence: 0.85, arousal: 0.4, dominance: 0.4 },
      proud: { valence: 0.85, arousal: 0.5, dominance: 0.8 },
      ashamed: { valence: 0.1, arousal: 0.5, dominance: 0.15 },
      guilty: { valence: 0.15, arousal: 0.5, dominance: 0.2 },
      lonely: { valence: 0.15, arousal: 0.25, dominance: 0.15 },
      contempt: { valence: 0.15, arousal: 0.5, dominance: 0.8 },
    };

    const lexicon = { ...defaultLexicon, ...(artifact.data.lexicon || {}) };

    // Tokenize and normalize
    const tokens = text.toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter(t => t.length > 1);
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);

    // Negation words that invert sentiment for the next word
    const negators = new Set(["not", "no", "never", "neither", "nobody", "nothing",
      "nowhere", "nor", "cannot", "can't", "don't", "doesn't", "didn't",
      "won't", "wouldn't", "shouldn't", "couldn't", "isn't", "aren't", "wasn't", "weren't"]);

    // Intensifiers that amplify the next word
    const intensifiers = { very: 1.3, extremely: 1.5, incredibly: 1.5, absolutely: 1.4,
      really: 1.2, quite: 1.1, somewhat: 0.8, slightly: 0.7, barely: 0.6, hardly: 0.5 };

    // Score each token with context awareness
    let totalValence = 0;
    let totalArousal = 0;
    let totalDominance = 0;
    let matchedCount = 0;
    const emotionHits = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const entry = lexicon[token];
      if (!entry) continue;

      let v = entry.valence;
      let a = entry.arousal;
      let d = entry.dominance;

      // Check for negation in preceding 3 tokens
      let negated = false;
      for (let j = Math.max(0, i - 3); j < i; j++) {
        if (negators.has(tokens[j])) { negated = true; break; }
      }
      if (negated) {
        v = 1 - v; // Invert valence
        d = 1 - d; // Invert dominance
      }

      // Check for intensifier immediately preceding
      if (i > 0 && intensifiers[tokens[i - 1]]) {
        const factor = intensifiers[tokens[i - 1]];
        v = Math.min(1, Math.max(0, 0.5 + (v - 0.5) * factor));
        a = Math.min(1, a * factor);
      }

      totalValence += v;
      totalArousal += a;
      totalDominance += d;
      matchedCount++;

      emotionHits.push({ word: token, valence: v, arousal: a, dominance: d, negated });
    }

    // Compute averages
    const avgValence = matchedCount > 0 ? Math.round((totalValence / matchedCount) * 1000) / 1000 : 0.5;
    const avgArousal = matchedCount > 0 ? Math.round((totalArousal / matchedCount) * 1000) / 1000 : 0.5;
    const avgDominance = matchedCount > 0 ? Math.round((totalDominance / matchedCount) * 1000) / 1000 : 0.5;

    // Detect mixed emotions: high variance in valence scores
    const valences = emotionHits.map(h => h.valence);
    const valenceVariance = valences.length > 1
      ? valences.reduce((s, v) => s + Math.pow(v - avgValence, 2), 0) / valences.length
      : 0;
    const isMixed = valenceVariance > 0.06;

    // Classify primary emotion based on VAD space (Russell's circumplex adapted)
    let primaryEmotion = "neutral";
    if (matchedCount > 0) {
      if (avgValence > 0.65 && avgArousal > 0.6) primaryEmotion = "excitement";
      else if (avgValence > 0.65 && avgArousal <= 0.6) primaryEmotion = "contentment";
      else if (avgValence <= 0.35 && avgArousal > 0.6) primaryEmotion = "distress";
      else if (avgValence <= 0.35 && avgArousal <= 0.6) primaryEmotion = "depression";
      else if (avgValence > 0.5 && avgArousal > 0.5) primaryEmotion = "happiness";
      else if (avgValence > 0.5) primaryEmotion = "calm";
      else if (avgArousal > 0.5) primaryEmotion = "tension";
      else primaryEmotion = "apathy";
    }

    // Sarcasm indicators
    const sarcasmIndicators = [];
    if (detectSarcasm) {
      // Exclamation with positive words but overall negative context
      const exclamationCount = (text.match(/!/g) || []).length;
      const questionCount = (text.match(/\?/g) || []).length;
      const capsWords = (text.match(/\b[A-Z]{2,}\b/g) || []).length;

      // Sarcasm pattern: positive words + excessive punctuation
      const positiveCount = emotionHits.filter(h => h.valence > 0.65).length;
      const negativeCount = emotionHits.filter(h => h.valence < 0.35).length;

      if (positiveCount > 0 && negativeCount > 0 && exclamationCount >= 2) {
        sarcasmIndicators.push({ type: "mixed-sentiment-emphasis", detail: "Positive and negative words combined with excessive exclamation marks" });
      }
      if (capsWords >= 2 && avgValence > 0.6) {
        sarcasmIndicators.push({ type: "caps-with-positive", detail: "Multiple ALL-CAPS words alongside positive sentiment" });
      }
      // Quotation marks around positive words (air quotes)
      const airQuotes = text.match(/"(\w+)"/g) || [];
      const quotedPositive = airQuotes.filter(q => {
        const word = q.replace(/"/g, "").toLowerCase();
        return lexicon[word] && lexicon[word].valence > 0.6;
      });
      if (quotedPositive.length > 0) {
        sarcasmIndicators.push({ type: "air-quotes", detail: `Positive words in quotes: ${quotedPositive.join(", ")}` });
      }
      // Ellipsis pattern suggesting irony
      if ((text.match(/\.\.\./g) || []).length >= 2 && avgValence > 0.5) {
        sarcasmIndicators.push({ type: "ellipsis-irony", detail: "Multiple ellipses with positive sentiment suggest irony" });
      }
    }

    // Sentiment label
    const sentimentLabel = avgValence >= 0.65 ? "positive"
      : avgValence >= 0.45 ? "neutral"
      : "negative";

    const result = {
      analyzedAt: new Date().toISOString(),
      textLength: text.length,
      tokenCount: tokens.length,
      matchedTokens: matchedCount,
      coverage: tokens.length > 0 ? Math.round((matchedCount / tokens.length) * 10000) / 100 : 0,
      vad: { valence: avgValence, arousal: avgArousal, dominance: avgDominance },
      sentimentLabel,
      primaryEmotion,
      isMixedEmotion: isMixed,
      valenceVariance: Math.round(valenceVariance * 10000) / 10000,
      sarcasmIndicators,
      sarcasmLikelihood: sarcasmIndicators.length > 1 ? "high" : sarcasmIndicators.length === 1 ? "moderate" : "low",
      emotionHits: emotionHits.slice(0, 50),
      sentenceCount: sentences.length,
    };

    artifact.data.sentimentAnalysis = result;
    return { ok: true, result };
  });

  /**
   * emotionTimeline
   * Track emotion changes over a sequence of text entries — detect emotional arcs.
   * artifact.data.entries: [{ id, text, timestamp? }] — ordered text entries
   * artifact.data.lexicon: { word: { valence, arousal, dominance } } — optional VAD lexicon
   * params.windowSize — smoothing window for arc detection (default 3)
   */
  registerLensAction("affect", "emotionTimeline", (ctx, artifact, params) => {
    const entries = artifact.data.entries || [];
    if (entries.length === 0) {
      return { ok: true, result: { message: "No entries provided for emotion timeline." } };
    }

    const windowSize = params.windowSize || 3;

    // Simple inline lexicon for scoring
    const posWords = new Set(["happy", "joy", "love", "great", "excellent", "wonderful", "amazing",
      "good", "nice", "beautiful", "fantastic", "brilliant", "delighted", "pleased", "grateful",
      "hopeful", "proud", "excited", "cheerful", "glad", "thrilled", "blessed", "awesome",
      "magnificent", "perfect", "superb", "terrific", "marvelous", "outstanding", "triumph",
      "victory", "success", "win", "celebrate", "enjoy", "paradise", "heaven"]);
    const negWords = new Set(["sad", "angry", "hate", "terrible", "awful", "bad", "horrible",
      "disgusting", "fear", "afraid", "anxious", "worried", "depressed", "miserable",
      "frustrated", "disappointed", "lonely", "ashamed", "guilty", "grief", "pain",
      "suffer", "loss", "death", "die", "kill", "destroy", "ruin", "failure", "fail",
      "catastrophe", "disaster", "tragedy", "crisis", "agony", "torment", "despair", "doom"]);

    // Score each entry
    const timeline = entries.map((entry, idx) => {
      const text = (entry.text || "").toLowerCase();
      const tokens = text.replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter(t => t.length > 1);
      let posCount = 0;
      let negCount = 0;
      for (const token of tokens) {
        if (posWords.has(token)) posCount++;
        if (negWords.has(token)) negCount++;
      }
      const total = posCount + negCount;
      // Valence: -1 (very negative) to +1 (very positive)
      const valence = total > 0 ? Math.round(((posCount - negCount) / total) * 1000) / 1000 : 0;
      // Intensity: how emotionally charged
      const intensity = tokens.length > 0 ? Math.round((total / tokens.length) * 1000) / 1000 : 0;

      return {
        id: entry.id || idx,
        index: idx,
        timestamp: entry.timestamp || null,
        valence,
        intensity,
        positiveCount: posCount,
        negativeCount: negCount,
        tokenCount: tokens.length,
      };
    });

    // Smoothed valence using moving average
    const smoothed = [];
    for (let i = 0; i < timeline.length; i++) {
      const start = Math.max(0, i - Math.floor(windowSize / 2));
      const end = Math.min(timeline.length, i + Math.ceil(windowSize / 2));
      const window = timeline.slice(start, end);
      const avgValence = window.reduce((s, t) => s + t.valence, 0) / window.length;
      smoothed.push(Math.round(avgValence * 1000) / 1000);
    }

    // Detect emotional arc pattern using Kurt Vonnegut's shapes
    // Compute beginning, middle, end valence
    const thirds = Math.max(1, Math.floor(timeline.length / 3));
    const beginAvg = smoothed.slice(0, thirds).reduce((s, v) => s + v, 0) / thirds;
    const midAvg = smoothed.slice(thirds, thirds * 2).reduce((s, v) => s + v, 0) / Math.max(1, smoothed.slice(thirds, thirds * 2).length);
    const endSlice = smoothed.slice(thirds * 2);
    const endAvg = endSlice.length > 0 ? endSlice.reduce((s, v) => s + v, 0) / endSlice.length : 0;

    let arcType;
    const threshold = 0.15;

    if (beginAvg < -threshold && midAvg > threshold && endAvg > threshold) {
      arcType = "rags-to-riches";
    } else if (beginAvg > threshold && midAvg < -threshold && endAvg < -threshold) {
      arcType = "tragedy";
    } else if (beginAvg > threshold && midAvg < -threshold && endAvg > threshold) {
      arcType = "man-in-a-hole";
    } else if (beginAvg < -threshold && midAvg > threshold && endAvg < -threshold) {
      arcType = "icarus";
    } else if (endAvg - beginAvg > threshold) {
      arcType = "ascending";
    } else if (beginAvg - endAvg > threshold) {
      arcType = "descending";
    } else if (Math.abs(beginAvg) < threshold && Math.abs(midAvg) < threshold && Math.abs(endAvg) < threshold) {
      arcType = "flat";
    } else {
      arcType = "complex";
    }

    // Detect significant turning points (local extrema in smoothed)
    const turningPoints = [];
    for (let i = 1; i < smoothed.length - 1; i++) {
      if ((smoothed[i] > smoothed[i - 1] && smoothed[i] > smoothed[i + 1]) ||
          (smoothed[i] < smoothed[i - 1] && smoothed[i] < smoothed[i + 1])) {
        const magnitude = Math.abs(smoothed[i] - smoothed[i - 1]) + Math.abs(smoothed[i] - smoothed[i + 1]);
        if (magnitude > 0.1) {
          turningPoints.push({
            index: i,
            id: timeline[i].id,
            valence: smoothed[i],
            type: smoothed[i] > smoothed[i - 1] ? "peak" : "valley",
            magnitude: Math.round(magnitude * 1000) / 1000,
          });
        }
      }
    }

    // Overall emotional volatility
    let volatility = 0;
    if (smoothed.length > 1) {
      for (let i = 1; i < smoothed.length; i++) {
        volatility += Math.abs(smoothed[i] - smoothed[i - 1]);
      }
      volatility = Math.round((volatility / (smoothed.length - 1)) * 1000) / 1000;
    }

    const result = {
      analyzedAt: new Date().toISOString(),
      entryCount: entries.length,
      timeline,
      smoothedValence: smoothed,
      arcType,
      arcSegments: {
        beginning: Math.round(beginAvg * 1000) / 1000,
        middle: Math.round(midAvg * 1000) / 1000,
        end: Math.round(endAvg * 1000) / 1000,
      },
      turningPoints,
      volatility,
      overallValence: Math.round((timeline.reduce((s, t) => s + t.valence, 0) / timeline.length) * 1000) / 1000,
      overallIntensity: Math.round((timeline.reduce((s, t) => s + t.intensity, 0) / timeline.length) * 1000) / 1000,
    };

    artifact.data.emotionTimeline = result;
    return { ok: true, result };
  });

  /**
   * empathyMap
   * Build an empathy map from user feedback — categorize into thinks/feels/says/does
   * quadrants, identify pain points and gains.
   * artifact.data.feedback: [{ userId?, text, category?, context? }]
   * params.painKeywords — additional pain point keywords (optional)
   * params.gainKeywords — additional gain keywords (optional)
   */
  registerLensAction("affect", "empathyMap", (ctx, artifact, params) => {
    const feedback = artifact.data.feedback || [];
    if (feedback.length === 0) {
      return { ok: true, result: { message: "No feedback data provided for empathy mapping." } };
    }

    // Keyword sets for quadrant classification
    const thinkIndicators = ["think", "believe", "consider", "expect", "assume", "wonder",
      "suppose", "imagine", "hope", "wish", "know", "understand", "realize", "opinion",
      "perspective", "idea", "thought", "mindset", "perception", "impression"];
    const feelIndicators = ["feel", "emotion", "happy", "sad", "angry", "frustrated",
      "anxious", "worried", "excited", "scared", "love", "hate", "joy", "fear",
      "comfortable", "uncomfortable", "stressed", "relieved", "overwhelmed", "satisfied",
      "disappointed", "grateful", "annoyed", "delighted"];
    const sayIndicators = ["say", "said", "tell", "told", "mention", "comment", "complain",
      "suggest", "recommend", "request", "ask", "state", "express", "quote", "voice",
      "report", "feedback", "respond", "reply"];
    const doIndicators = ["do", "did", "use", "click", "buy", "purchase", "return",
      "cancel", "switch", "try", "attempt", "navigate", "search", "browse", "download",
      "install", "uninstall", "subscribe", "unsubscribe", "visit", "leave", "abandon"];

    const defaultPainKeywords = ["problem", "issue", "difficult", "hard", "confusing", "slow",
      "broken", "bug", "error", "crash", "fail", "expensive", "costly", "waste", "frustrating",
      "annoying", "terrible", "awful", "horrible", "painful", "struggle", "complicate",
      "missing", "lack", "need", "can't", "unable", "impossible", "bad"];
    const defaultGainKeywords = ["easy", "fast", "quick", "simple", "helpful", "useful",
      "efficient", "save", "benefit", "improve", "love", "great", "excellent", "perfect",
      "amazing", "convenient", "powerful", "intuitive", "reliable", "valuable", "enjoy",
      "delight", "smooth", "seamless", "wonderful"];

    const painKeywords = new Set([...defaultPainKeywords, ...(params.painKeywords || [])]);
    const gainKeywords = new Set([...defaultGainKeywords, ...(params.gainKeywords || [])]);

    function scoreCategory(text, indicators) {
      const lower = text.toLowerCase();
      let score = 0;
      for (const word of indicators) {
        if (lower.includes(word)) score++;
      }
      return score;
    }

    const quadrants = { thinks: [], feels: [], says: [], does: [] };
    const painPoints = [];
    const gains = [];
    const themes = {};

    for (const item of feedback) {
      const text = item.text || "";
      const lower = text.toLowerCase();
      const tokens = lower.replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter(t => t.length > 1);

      // Score for each quadrant
      const scores = {
        thinks: scoreCategory(text, thinkIndicators),
        feels: scoreCategory(text, feelIndicators),
        says: scoreCategory(text, sayIndicators),
        does: scoreCategory(text, doIndicators),
      };

      // If pre-categorized, use that
      if (item.category && quadrants[item.category]) {
        quadrants[item.category].push({ userId: item.userId, text, context: item.context });
      } else {
        // Assign to highest-scoring quadrant, default to "says"
        let bestQuadrant = "says";
        let bestScore = 0;
        for (const [q, s] of Object.entries(scores)) {
          if (s > bestScore) { bestScore = s; bestQuadrant = q; }
        }
        quadrants[bestQuadrant].push({ userId: item.userId, text, context: item.context, confidence: bestScore });
      }

      // Pain point detection
      let painScore = 0;
      const pains = [];
      for (const token of tokens) {
        if (painKeywords.has(token)) { painScore++; pains.push(token); }
      }
      if (painScore > 0) {
        painPoints.push({
          userId: item.userId,
          text,
          painScore,
          keywords: [...new Set(pains)],
        });
      }

      // Gain detection
      let gainScore = 0;
      const gainMatches = [];
      for (const token of tokens) {
        if (gainKeywords.has(token)) { gainScore++; gainMatches.push(token); }
      }
      if (gainScore > 0) {
        gains.push({
          userId: item.userId,
          text,
          gainScore,
          keywords: [...new Set(gainMatches)],
        });
      }

      // Theme extraction: most common 2-word phrases
      for (let i = 0; i < tokens.length - 1; i++) {
        const bigram = `${tokens[i]} ${tokens[i + 1]}`;
        themes[bigram] = (themes[bigram] || 0) + 1;
      }
    }

    // Sort pain points and gains by score
    painPoints.sort((a, b) => b.painScore - a.painScore);
    gains.sort((a, b) => b.gainScore - a.gainScore);

    // Top themes
    const topThemes = Object.entries(themes)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([phrase, count]) => ({ phrase, count }));

    const result = {
      analyzedAt: new Date().toISOString(),
      totalFeedback: feedback.length,
      quadrants: {
        thinks: { count: quadrants.thinks.length, items: quadrants.thinks },
        feels: { count: quadrants.feels.length, items: quadrants.feels },
        says: { count: quadrants.says.length, items: quadrants.says },
        does: { count: quadrants.does.length, items: quadrants.does },
      },
      painPoints: painPoints.slice(0, 20),
      gains: gains.slice(0, 20),
      topThemes,
      summary: {
        totalPainPoints: painPoints.length,
        totalGains: gains.length,
        avgPainScore: painPoints.length > 0
          ? Math.round((painPoints.reduce((s, p) => s + p.painScore, 0) / painPoints.length) * 100) / 100
          : 0,
        avgGainScore: gains.length > 0
          ? Math.round((gains.reduce((s, g) => s + g.gainScore, 0) / gains.length) * 100) / 100
          : 0,
        sentimentBalance: gains.length - painPoints.length,
      },
    };

    artifact.data.empathyMap = result;
    return { ok: true, result };
  });
}
