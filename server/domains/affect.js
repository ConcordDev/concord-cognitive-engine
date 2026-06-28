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
  try {
    // Coerce defensively: a poisoned non-string `text` (number/object) must not
    // throw on `.trim()` — fail CLOSED to the empty-input message, never crash.
    const rawText = artifact?.data?.text;
    const text = typeof rawText === "string" ? rawText : "";
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  /**
   * emotionTimeline
   * Track emotion changes over a sequence of text entries — detect emotional arcs.
   * artifact.data.entries: [{ id, text, timestamp? }] — ordered text entries
   * artifact.data.lexicon: { word: { valence, arousal, dominance } } — optional VAD lexicon
   * params.windowSize — smoothing window for arc detection (default 3)
   */
  registerLensAction("affect", "emotionTimeline", (ctx, artifact, params) => {
  try {
    // Guard CLOSED: a poisoned non-array `entries` must not throw on `.map()`.
    const entries = Array.isArray(artifact?.data?.entries) ? artifact.data.entries : [];
    if (entries.length === 0) {
      return { ok: true, result: { message: "No entries provided for emotion timeline." } };
    }

    const windowSize = Number.isFinite(Number(params.windowSize)) && Number(params.windowSize) > 0
      ? Number(params.windowSize)
      : 3;

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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  try {
    // Guard CLOSED: a poisoned non-array `feedback` (string iterates chars,
    // object is non-iterable → throws) must collapse to the empty-input message.
    const feedback = Array.isArray(artifact?.data?.feedback) ? artifact.data.feedback : [];
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

    for (const rawItem of feedback) {
      const item = rawItem && typeof rawItem === "object" ? rawItem : {};
      const text = typeof item.text === "string" ? item.text : "";
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  // ---------------------------------------------------------------------------
  // Mood-tracking parity layer (Daylio / Hume AI feature parity).
  // All data is real user input persisted per-user in globalThis._concordSTATE.
  // No seed/demo/mock mood entries are ever created.
  // ---------------------------------------------------------------------------

  function getMoodState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.affectMood) {
      STATE.affectMood = {
        checkins: new Map(),   // userId -> Array<checkin>
        reminders: new Map(),  // userId -> Array<reminder>
        scales: new Map(),     // userId -> scale config
        seq: new Map(),        // userId -> { checkin, reminder }
      };
    }
    const s = STATE.affectMood;
    if (!s.checkins) s.checkins = new Map();
    if (!s.reminders) s.reminders = new Map();
    if (!s.scales) s.scales = new Map();
    if (!s.seq) s.seq = new Map();
    return s;
  }
  function moodActId(ctx) {
    return ctx?.actor?.userId || ctx?.userId || "anon";
  }
  function moodList(map, userId) {
    if (!map.has(userId)) map.set(userId, []);
    return map.get(userId);
  }
  function moodSeq(s, userId, key) {
    if (!s.seq.has(userId)) s.seq.set(userId, { checkin: 1, reminder: 1 });
    const seq = s.seq.get(userId);
    if (!Number.isFinite(seq[key])) seq[key] = 1;
    return seq[key]++;
  }
  function moodSave() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  // Day key in YYYY-MM-DD from an ISO timestamp.
  function dayKey(iso) {
    return new Date(iso).toISOString().slice(0, 10);
  }
  // Default 5-point mood scale (Daylio's canonical shape).
  const DEFAULT_SCALE = {
    points: [
      { value: 1, label: "Awful", emoji: "😖" },
      { value: 2, label: "Bad", emoji: "😞" },
      { value: 3, label: "Meh", emoji: "😐" },
      { value: 4, label: "Good", emoji: "🙂" },
      { value: 5, label: "Great", emoji: "😄" },
    ],
  };
  function getScale(s, userId) {
    return s.scales.get(userId) || DEFAULT_SCALE;
  }
  // Pearson correlation of two equal-length numeric arrays.
  function pearson(xs, ys) {
    const n = xs.length;
    if (n < 2) return 0;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      const a = xs[i] - mx, b = ys[i] - my;
      num += a * b; dx += a * a; dy += b * b;
    }
    if (dx === 0 || dy === 0) return 0;
    return num / Math.sqrt(dx * dy);
  }

  /**
   * checkin
   * Daily mood check-in ritual. Records one real mood entry. Streak is computed
   * from consecutive calendar days that have at least one check-in.
   * params: { mood (1..maxScale), note?, activities?:[string], promptId?, promptAnswer? }
   */
  registerLensAction("affect", "checkin", (ctx, artifact, params) => {
  try {
    const s = getMoodState();
    if (!s) return { ok: false, error: "state unavailable" };
    const userId = moodActId(ctx);
    const scale = getScale(s, userId);
    const maxVal = Math.max(...scale.points.map((p) => p.value));
    const minVal = Math.min(...scale.points.map((p) => p.value));
    const mood = Number(params.mood);
    if (!Number.isFinite(mood) || mood < minVal || mood > maxVal) {
      return { ok: false, error: `mood must be between ${minVal} and ${maxVal}` };
    }
    const list = moodList(s.checkins, userId);
    const now = new Date().toISOString();
    const point = scale.points.find((p) => p.value === Math.round(mood));
    const entry = {
      id: `chk_${moodSeq(s, userId, "checkin")}`,
      mood: Math.round(mood),
      moodLabel: point ? point.label : String(mood),
      moodEmoji: point ? point.emoji : "",
      note: typeof params.note === "string" ? params.note.slice(0, 2000) : "",
      activities: Array.isArray(params.activities)
        ? params.activities.map((a) => String(a).toLowerCase().trim()).filter(Boolean).slice(0, 20)
        : [],
      promptId: params.promptId || null,
      promptAnswer: typeof params.promptAnswer === "string" ? params.promptAnswer.slice(0, 4000) : "",
      createdAt: now,
      day: dayKey(now),
    };
    list.push(entry);
    moodSave();
    // Recompute streak.
    const days = [...new Set(list.map((c) => c.day))].sort();
    let streak = 0;
    let cursor = new Date(now);
    cursor.setUTCHours(0, 0, 0, 0);
    const daySet = new Set(days);
    while (daySet.has(cursor.toISOString().slice(0, 10))) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    let longest = 0, run = 0, prev = null;
    for (const d of days) {
      if (prev) {
        const gap = (new Date(d) - new Date(prev)) / 86400000;
        run = gap === 1 ? run + 1 : 1;
      } else {
        run = 1;
      }
      longest = Math.max(longest, run);
      prev = d;
    }
    return {
      ok: true,
      result: {
        entry,
        currentStreak: streak,
        longestStreak: longest,
        totalCheckins: list.length,
        daysLogged: days.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * checkinHistory
   * Return recorded check-ins (newest first) plus streak summary.
   * params: { limit?, sinceDays? }
   */
  registerLensAction("affect", "checkinHistory", (ctx, artifact, params) => {
  try {
    const s = getMoodState();
    if (!s) return { ok: false, error: "state unavailable" };
    const userId = moodActId(ctx);
    const list = [...moodList(s.checkins, userId)];
    let filtered = list;
    if (Number.isFinite(Number(params.sinceDays))) {
      const cutoff = Date.now() - Number(params.sinceDays) * 86400000;
      filtered = list.filter((c) => new Date(c.createdAt).getTime() >= cutoff);
    }
    const sorted = filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const limit = Number.isFinite(Number(params.limit)) ? Number(params.limit) : 100;
    const days = [...new Set(list.map((c) => c.day))].sort();
    let streak = 0;
    const cursor = new Date();
    cursor.setUTCHours(0, 0, 0, 0);
    const daySet = new Set(days);
    while (daySet.has(cursor.toISOString().slice(0, 10))) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    const checkedToday = daySet.has(new Date().toISOString().slice(0, 10));
    return {
      ok: true,
      result: {
        entries: sorted.slice(0, limit),
        totalCheckins: list.length,
        currentStreak: streak,
        checkedInToday: checkedToday,
        daysLogged: days.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * trends
   * Weekly/monthly mood averages, day-of-week patterns, and a continuous
   * series for charting. Computed only from real recorded check-ins.
   * params: { granularity?: 'week'|'month', sinceDays? }
   */
  registerLensAction("affect", "trends", (ctx, artifact, params) => {
  try {
    const s = getMoodState();
    if (!s) return { ok: false, error: "state unavailable" };
    const userId = moodActId(ctx);
    let list = [...moodList(s.checkins, userId)];
    if (Number.isFinite(Number(params.sinceDays))) {
      const cutoff = Date.now() - Number(params.sinceDays) * 86400000;
      list = list.filter((c) => new Date(c.createdAt).getTime() >= cutoff);
    }
    if (list.length === 0) {
      return { ok: true, result: { hasData: false, buckets: [], daily: [], dayOfWeek: [] } };
    }
    const granularity = params.granularity === "month" ? "month" : "week";
    // Daily averages.
    const byDay = {};
    for (const c of list) {
      (byDay[c.day] = byDay[c.day] || []).push(c.mood);
    }
    const daily = Object.entries(byDay)
      .sort()
      .map(([day, moods]) => ({
        day,
        avgMood: Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 100) / 100,
        count: moods.length,
      }));
    // Bucket by week (ISO-ish) or month.
    const byBucket = {};
    for (const c of list) {
      let key;
      if (granularity === "month") {
        key = c.day.slice(0, 7);
      } else {
        const d = new Date(c.day);
        const onejan = new Date(d.getUTCFullYear(), 0, 1);
        const week = Math.ceil(((d - onejan) / 86400000 + onejan.getUTCDay() + 1) / 7);
        key = `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
      }
      (byBucket[key] = byBucket[key] || []).push(c.mood);
    }
    const buckets = Object.entries(byBucket)
      .sort()
      .map(([bucket, moods]) => ({
        bucket,
        avgMood: Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 100) / 100,
        count: moods.length,
        min: Math.min(...moods),
        max: Math.max(...moods),
      }));
    // Day-of-week pattern.
    const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dowAgg = DOW.map(() => []);
    for (const c of list) {
      dowAgg[new Date(c.day).getUTCDay()].push(c.mood);
    }
    const dayOfWeek = DOW.map((label, i) => ({
      label,
      avgMood: dowAgg[i].length
        ? Math.round((dowAgg[i].reduce((a, b) => a + b, 0) / dowAgg[i].length) * 100) / 100
        : null,
      count: dowAgg[i].length,
    }));
    const all = list.map((c) => c.mood);
    return {
      ok: true,
      result: {
        hasData: true,
        granularity,
        buckets,
        daily,
        dayOfWeek,
        overallAvg: Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 100) / 100,
        entryCount: list.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * activityCorrelation
   * "You feel better after X" — for each tagged activity, compares the mean
   * mood of check-ins WITH the tag against the baseline mean of all check-ins.
   * params: { sinceDays?, minSamples? }
   */
  registerLensAction("affect", "activityCorrelation", (ctx, artifact, params) => {
  try {
    const s = getMoodState();
    if (!s) return { ok: false, error: "state unavailable" };
    const userId = moodActId(ctx);
    let list = [...moodList(s.checkins, userId)];
    if (Number.isFinite(Number(params.sinceDays))) {
      const cutoff = Date.now() - Number(params.sinceDays) * 86400000;
      list = list.filter((c) => new Date(c.createdAt).getTime() >= cutoff);
    }
    if (list.length === 0) {
      return { ok: true, result: { hasData: false, correlations: [], baseline: null } };
    }
    const minSamples = Number.isFinite(Number(params.minSamples)) ? Number(params.minSamples) : 2;
    const baseline = list.reduce((a, c) => a + c.mood, 0) / list.length;
    const tagAgg = {};
    for (const c of list) {
      for (const a of c.activities) {
        (tagAgg[a] = tagAgg[a] || []).push(c.mood);
      }
    }
    const correlations = Object.entries(tagAgg)
      .filter(([, moods]) => moods.length >= minSamples)
      .map(([activity, moods]) => {
        const avg = moods.reduce((a, b) => a + b, 0) / moods.length;
        const delta = avg - baseline;
        return {
          activity,
          avgMood: Math.round(avg * 100) / 100,
          delta: Math.round(delta * 100) / 100,
          samples: moods.length,
          effect: delta > 0.25 ? "lifts" : delta < -0.25 ? "lowers" : "neutral",
        };
      })
      .sort((a, b) => b.delta - a.delta);
    return {
      ok: true,
      result: {
        hasData: true,
        baseline: Math.round(baseline * 100) / 100,
        correlations,
        topLift: correlations.find((c) => c.effect === "lifts") || null,
        topDrain: [...correlations].reverse().find((c) => c.effect === "lowers") || null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * journalPrompts
   * Reflective journaling prompts to attach to a check-in. Prompts rotate
   * deterministically by day so the same day always offers the same set —
   * this is content, not user data (no mock mood entries).
   * params: { count? }
   */
  registerLensAction("affect", "journalPrompts", (ctx, artifact, params) => {
    const POOL = [
      "What is one moment from today you want to remember?",
      "What drained your energy, and what restored it?",
      "Name one thing you handled better than you would have a year ago.",
      "What were you grateful for in the last 24 hours?",
      "Describe a feeling you noticed but did not act on.",
      "What would make tomorrow 1% better?",
      "Who or what supported you today?",
      "What is a worry you can set down for now?",
      "What did your body tell you today?",
      "When did you feel most like yourself today?",
      "What is something you are looking forward to?",
      "What boundary did you keep or wish you had kept?",
    ];
    const count = Math.min(Math.max(Number(params.count) || 3, 1), POOL.length);
    const daySeed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ""));
    const out = [];
    const used = new Set();
    let i = 0;
    while (out.length < count && i < POOL.length * 2) {
      const idx = (daySeed + i * 7) % POOL.length;
      if (!used.has(idx)) {
        used.add(idx);
        out.push({ id: `prompt_${idx}`, text: POOL[idx] });
      }
      i++;
    }
    return { ok: true, result: { prompts: out, day: new Date().toISOString().slice(0, 10) } };
  });

  /**
   * setReminder
   * Create or update a mood-based reminder / nudge.
   * params: { time?:'HH:MM', label?, condition?:'daily'|'streak_risk'|'low_mood', enabled? }
   */
  registerLensAction("affect", "setReminder", (ctx, artifact, params) => {
    const s = getMoodState();
    if (!s) return { ok: false, error: "state unavailable" };
    const userId = moodActId(ctx);
    const time = typeof params.time === "string" && /^\d{2}:\d{2}$/.test(params.time) ? params.time : "20:00";
    const condition = ["daily", "streak_risk", "low_mood"].includes(params.condition)
      ? params.condition
      : "daily";
    const list = moodList(s.reminders, userId);
    if (params.id) {
      const existing = list.find((r) => r.id === params.id);
      if (!existing) return { ok: false, error: "reminder not found" };
      existing.time = time;
      existing.condition = condition;
      if (typeof params.label === "string") existing.label = params.label.slice(0, 200);
      if (typeof params.enabled === "boolean") existing.enabled = params.enabled;
      existing.updatedAt = new Date().toISOString();
      moodSave();
      return { ok: true, result: { reminder: existing } };
    }
    const reminder = {
      id: `rem_${moodSeq(s, userId, "reminder")}`,
      time,
      condition,
      label: typeof params.label === "string" ? params.label.slice(0, 200) : "Time for your mood check-in",
      enabled: params.enabled !== false,
      createdAt: new Date().toISOString(),
    };
    list.push(reminder);
    moodSave();
    return { ok: true, result: { reminder } };
  });

  /**
   * nudges
   * Evaluate reminders against real check-in history and surface due nudges.
   * No mock data — every nudge is derived from the user's actual entries.
   */
  registerLensAction("affect", "nudges", (ctx, artifact, _params) => {
  try {
    const s = getMoodState();
    if (!s) return { ok: false, error: "state unavailable" };
    const userId = moodActId(ctx);
    const reminders = moodList(s.reminders, userId).filter((r) => r.enabled);
    const checkins = moodList(s.checkins, userId);
    const todayKey = new Date().toISOString().slice(0, 10);
    const checkedToday = checkins.some((c) => c.day === todayKey);
    const recent = checkins.filter((c) => Date.now() - new Date(c.createdAt).getTime() < 3 * 86400000);
    const recentAvg = recent.length ? recent.reduce((a, c) => a + c.mood, 0) / recent.length : null;
    const due = [];
    for (const r of reminders) {
      if (r.condition === "daily" && !checkedToday) {
        due.push({ reminderId: r.id, type: "daily", message: r.label });
      } else if (r.condition === "streak_risk" && !checkedToday) {
        due.push({
          reminderId: r.id,
          type: "streak_risk",
          message: "Check in today to keep your streak alive.",
        });
      } else if (r.condition === "low_mood" && recentAvg != null && recentAvg <= 2.5) {
        due.push({
          reminderId: r.id,
          type: "low_mood",
          message: "Your mood has been low recently — consider a self-care moment.",
        });
      }
    }
    return {
      ok: true,
      result: { reminders, due, checkedInToday: checkedToday, recentAvg: recentAvg != null ? Math.round(recentAvg * 100) / 100 : null },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * exportReport
   * Build an emotional report (rows + summary) for personal/clinical use.
   * params: { format?:'csv'|'json', sinceDays? }
   * Returns structured rows and a CSV string — caller downloads it client-side.
   */
  registerLensAction("affect", "exportReport", (ctx, artifact, params) => {
  try {
    const s = getMoodState();
    if (!s) return { ok: false, error: "state unavailable" };
    const userId = moodActId(ctx);
    let list = [...moodList(s.checkins, userId)];
    if (Number.isFinite(Number(params.sinceDays))) {
      const cutoff = Date.now() - Number(params.sinceDays) * 86400000;
      list = list.filter((c) => new Date(c.createdAt).getTime() >= cutoff);
    }
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const rows = list.map((c) => ({
      date: c.createdAt,
      mood: c.mood,
      moodLabel: c.moodLabel,
      activities: c.activities.join("; "),
      note: c.note,
      journalAnswer: c.promptAnswer,
    }));
    const headers = ["date", "mood", "moodLabel", "activities", "note", "journalAnswer"];
    const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const csv = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
    ].join("\n");
    const moods = list.map((c) => c.mood);
    const summary = {
      generatedAt: new Date().toISOString(),
      entryCount: list.length,
      rangeStart: list.length ? list[0].createdAt : null,
      rangeEnd: list.length ? list[list.length - 1].createdAt : null,
      avgMood: moods.length ? Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 100) / 100 : null,
      minMood: moods.length ? Math.min(...moods) : null,
      maxMood: moods.length ? Math.max(...moods) : null,
    };
    return {
      ok: true,
      result: { format: params.format === "json" ? "json" : "csv", rows, csv, summary },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * getScale / setScale
   * Customizable mood scale / emoji set (Daylio-style). Stored per-user.
   */
  registerLensAction("affect", "getScale", (ctx, artifact, _params) => {
    const s = getMoodState();
    if (!s) return { ok: false, error: "state unavailable" };
    const userId = moodActId(ctx);
    const scale = getScale(s, userId);
    return { ok: true, result: { scale, isCustom: s.scales.has(userId), default: DEFAULT_SCALE } };
  });

  registerLensAction("affect", "setScale", (ctx, artifact, params) => {
    const s = getMoodState();
    if (!s) return { ok: false, error: "state unavailable" };
    const userId = moodActId(ctx);
    if (params.reset === true) {
      s.scales.delete(userId);
      moodSave();
      return { ok: true, result: { scale: DEFAULT_SCALE, isCustom: false } };
    }
    const points = Array.isArray(params.points) ? params.points : null;
    if (!points || points.length < 2 || points.length > 10) {
      return { ok: false, error: "scale must have between 2 and 10 points" };
    }
    const normalized = points.map((p, i) => ({
      value: Number.isFinite(Number(p.value)) ? Number(p.value) : i + 1,
      label: typeof p.label === "string" && p.label.trim() ? p.label.slice(0, 40) : `Level ${i + 1}`,
      emoji: typeof p.emoji === "string" ? p.emoji.slice(0, 8) : "",
    }));
    const values = normalized.map((p) => p.value);
    if (new Set(values).size !== values.length) {
      return { ok: false, error: "scale point values must be unique" };
    }
    const scale = { points: normalized.sort((a, b) => a.value - b.value) };
    s.scales.set(userId, scale);
    moodSave();
    return { ok: true, result: { scale, isCustom: true } };
  });

  // detect-patterns — deterministic analysis of the affect journal entries
  // (artifact.data.entries: [{ text, timestamp }]). Returns the shape the lens's
  // patternResult panel renders: patterns / triggers / cycles / correlations / summary.
  registerLensAction("affect", "detect-patterns", (ctx, artifact, _params = {}) => {
  try {
    const entries = Array.isArray(artifact.data?.entries) ? artifact.data.entries
      : Array.isArray(artifact.data?.checkins) ? artifact.data.checkins : [];
    const STOP = new Set("the a an and or but i to of in is it im was are my me you we be for on with that this so just feel feeling felt today".split(" "));
    const TRIGGER_WORDS = ["work", "money", "family", "sleep", "health", "relationship", "deadline", "alone", "tired", "stress", "anxious", "angry", "sad", "happy", "exam", "conflict"];
    const freq = {}, triggerHits = {}, hourBuckets = {}, dayBuckets = {};
    for (const e of entries) {
      const text = String(e?.text || e?.note || "").toLowerCase();
      for (const w of text.match(/[a-z][a-z']{2,}/g) || []) { if (!STOP.has(w)) freq[w] = (freq[w] || 0) + 1; }
      for (const t of TRIGGER_WORDS) if (text.includes(t)) triggerHits[t] = (triggerHits[t] || 0) + 1;
      const ts = e?.timestamp || e?.at || e?.date;
      if (ts) { const dt = new Date(ts); if (!isNaN(dt)) { hourBuckets[dt.getHours()] = (hourBuckets[dt.getHours()] || 0) + 1; dayBuckets[dt.getDay()] = (dayBuckets[dt.getDay()] || 0) + 1; } }
    }
    const patterns = Object.entries(freq).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word, count]) => ({ theme: word, count }));
    const triggers = Object.entries(triggerHits).sort((a, b) => b[1] - a[1]).map(([trigger, count]) => ({ trigger, count }));
    const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const peakHour = Object.entries(hourBuckets).sort((a, b) => b[1] - a[1])[0];
    const peakDay = Object.entries(dayBuckets).sort((a, b) => b[1] - a[1])[0];
    const cycles = [];
    if (peakHour) cycles.push({ kind: "time_of_day", label: `Most entries around ${peakHour[0]}:00`, count: peakHour[1] });
    if (peakDay) cycles.push({ kind: "day_of_week", label: `${DAYS[Number(peakDay[0])]} is the most-journaled day`, count: peakDay[1] });
    const correlations = triggers.slice(0, 3).map((t) => ({ between: [t.trigger, patterns[0]?.theme || "mood"], strength: t.count >= 3 ? "strong" : "moderate" }));
    return {
      ok: true,
      result: {
        entryCount: entries.length,
        patterns, triggers, cycles, correlations,
        summary: entries.length
          ? `Across ${entries.length} entries: ${patterns.length} recurring theme(s), ${triggers.length} trigger(s) detected${peakDay ? `, most active on ${DAYS[Number(peakDay[0])]}` : ""}.`
          : "No journal entries yet — add a few check-ins to surface patterns.",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });
}
