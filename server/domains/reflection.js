// server/domains/reflection.js
// Domain actions for self-reflection and journaling: insight extraction,
// growth metrics tracking, and habit pattern analysis.

export default function registerReflectionActions(registerLensAction) {
  /**
   * insightExtraction
   * Extract insights from journal entries — pattern recognition across entries,
   * identify recurring themes with TF-IDF.
   * artifact.data.entries = [{ text, date?, tags?: [string], mood?: string }]
   * params.topN — number of top themes to return (default 10)
   */
  registerLensAction("reflection", "insightExtraction", (ctx, artifact, params) => {
    const entries = artifact.data?.entries || [];
    if (entries.length === 0) {
      return { ok: true, result: { message: "No journal entries to analyze." } };
    }

    const topN = params.topN || 10;
    const r = (v) => Math.round(v * 10000) / 10000;

    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "can", "to", "of", "in", "for", "on",
      "with", "at", "by", "from", "as", "into", "through", "during",
      "and", "but", "or", "not", "so", "yet", "that", "this", "these",
      "those", "it", "its", "he", "she", "they", "them", "his", "her",
      "their", "we", "our", "you", "your", "my", "me", "i", "just",
      "really", "very", "also", "about", "been", "more", "some", "than",
      "then", "what", "when", "where", "how", "who", "which", "all",
      "each", "every", "both", "few", "most", "other", "such", "only",
      "same", "too", "own", "going", "went", "got", "get", "like",
      "know", "think", "feel", "want", "need", "make", "made", "day",
      "today", "much", "still", "even", "back", "after", "before",
    ]);

    function tokenize(text) {
      return (text || "").toLowerCase()
        .replace(/[^a-z\s]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));
    }

    // --- TF-IDF computation ---
    const docTokens = entries.map(e => tokenize(e.text));

    // Term frequency per document
    const docTFs = docTokens.map(tokens => {
      const tf = {};
      for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
      return tf;
    });

    // Document frequency
    const df = {};
    for (const tf of docTFs) {
      for (const term of Object.keys(tf)) {
        df[term] = (df[term] || 0) + 1;
      }
    }

    // IDF
    const numDocs = entries.length;
    const idf = {};
    for (const term of Object.keys(df)) {
      idf[term] = Math.log((numDocs + 1) / (df[term] + 1)) + 1;
    }

    // Aggregate TF-IDF scores across all documents
    const globalScores = {};
    for (const tf of docTFs) {
      for (const [term, freq] of Object.entries(tf)) {
        const tfidf = freq * (idf[term] || 1);
        globalScores[term] = (globalScores[term] || 0) + tfidf;
      }
    }

    // --- Top themes ---
    const themes = Object.entries(globalScores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([term, score]) => ({
        theme: term,
        tfidfScore: r(score),
        documentFrequency: df[term],
        prevalence: r(df[term] / numDocs),
      }));

    // --- Recurring patterns: bigram analysis ---
    const bigramCounts = {};
    for (const tokens of docTokens) {
      for (let i = 0; i < tokens.length - 1; i++) {
        const bigram = `${tokens[i]} ${tokens[i + 1]}`;
        bigramCounts[bigram] = (bigramCounts[bigram] || 0) + 1;
      }
    }
    const topBigrams = Object.entries(bigramCounts)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([bigram, count]) => ({ phrase: bigram, occurrences: count }));

    // --- Cross-entry pattern detection: which themes co-occur ---
    const themeSet = new Set(themes.map(t => t.theme));
    const coOccurrence = {};
    for (const tf of docTFs) {
      const present = Object.keys(tf).filter(t => themeSet.has(t));
      for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
          const pair = [present[i], present[j]].sort().join(" + ");
          coOccurrence[pair] = (coOccurrence[pair] || 0) + 1;
        }
      }
    }
    const topCoOccurrences = Object.entries(coOccurrence)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pair, count]) => ({ themes: pair, count }));

    // --- Mood correlation with themes (if mood data available) ---
    const moodThemeCorrelation = [];
    const moodEntries = entries.filter(e => e.mood);
    if (moodEntries.length >= 3) {
      const moodGroups = {};
      for (let i = 0; i < entries.length; i++) {
        const mood = entries[i].mood;
        if (!mood) continue;
        if (!moodGroups[mood]) moodGroups[mood] = [];
        moodGroups[mood].push(docTFs[i]);
      }

      for (const [mood, tfs] of Object.entries(moodGroups)) {
        const moodTermScores = {};
        for (const tf of tfs) {
          for (const [term, freq] of Object.entries(tf)) {
            if (themeSet.has(term)) {
              moodTermScores[term] = (moodTermScores[term] || 0) + freq;
            }
          }
        }
        const topMoodThemes = Object.entries(moodTermScores)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([term, score]) => term);

        if (topMoodThemes.length > 0) {
          moodThemeCorrelation.push({ mood, entryCount: tfs.length, associatedThemes: topMoodThemes });
        }
      }
    }

    // --- Tag analysis ---
    const tagCounts = {};
    for (const entry of entries) {
      for (const tag of (entry.tags || [])) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count, prevalence: r(count / numDocs) }));

    return {
      ok: true,
      result: {
        entriesAnalyzed: numDocs,
        themes,
        recurringPhrases: topBigrams,
        themeCoOccurrences: topCoOccurrences,
        moodThemeCorrelation: moodThemeCorrelation.length > 0 ? moodThemeCorrelation : null,
        topTags: topTags.length > 0 ? topTags : null,
      },
    };
  });

  /**
   * growthMetrics
   * Compute personal growth metrics — sentiment trend, vocabulary diversity
   * (type-token ratio), and topic expansion over time.
   * artifact.data.entries = [{ text, date }]
   * params.windowSize — entries per window for trend analysis (default 5)
   */
  registerLensAction("reflection", "growthMetrics", (ctx, artifact, params) => {
    const entries = artifact.data?.entries || [];
    if (entries.length < 2) {
      return { ok: true, result: { message: "Need at least 2 entries for growth analysis." } };
    }

    const windowSize = params.windowSize || 5;
    const r = (v) => Math.round(v * 10000) / 10000;

    // Sort by date
    const sorted = [...entries].map((e, i) => ({
      ...e,
      originalIndex: i,
      ts: new Date(e.date).getTime(),
    })).sort((a, b) => (isNaN(a.ts) ? 0 : a.ts) - (isNaN(b.ts) ? 0 : b.ts));

    // --- Simple sentiment scoring ---
    const positiveWords = new Set([
      "happy", "grateful", "excited", "proud", "accomplished", "peaceful",
      "hopeful", "inspired", "motivated", "confident", "content", "joyful",
      "loved", "amazing", "wonderful", "great", "good", "better", "best",
      "growth", "progress", "success", "learn", "improve", "achieve",
      "thankful", "blessed", "strong", "calm", "clarity", "focused",
    ]);
    const negativeWords = new Set([
      "sad", "angry", "frustrated", "anxious", "worried", "stressed",
      "overwhelmed", "disappointed", "lonely", "afraid", "confused",
      "exhausted", "stuck", "lost", "failed", "struggling", "difficult",
      "painful", "regret", "doubt", "fear", "terrible", "worse", "worst",
      "hopeless", "helpless", "depressed", "tired", "drained", "upset",
    ]);

    function sentimentScore(text) {
      const words = (text || "").toLowerCase().split(/\s+/);
      let pos = 0, neg = 0;
      for (const w of words) {
        const clean = w.replace(/[^a-z]/g, "");
        if (positiveWords.has(clean)) pos++;
        if (negativeWords.has(clean)) neg++;
      }
      const total = pos + neg;
      return total > 0 ? (pos - neg) / total : 0;
    }

    // Sentiment per entry
    const sentiments = sorted.map(e => ({
      date: e.date,
      sentiment: r(sentimentScore(e.text)),
    }));

    // Sentiment trend via linear regression
    const sentValues = sentiments.map(s => s.sentiment);
    const meanSent = sentValues.reduce((s, v) => s + v, 0) / sentValues.length;
    const xs = sentValues.map((_, i) => i);
    const meanX = xs.reduce((s, v) => s + v, 0) / xs.length;
    let ssXY = 0, ssXX = 0;
    for (let i = 0; i < xs.length; i++) {
      ssXY += (xs[i] - meanX) * (sentValues[i] - meanSent);
      ssXX += (xs[i] - meanX) * (xs[i] - meanX);
    }
    const sentimentSlope = ssXX > 0 ? ssXY / ssXX : 0;
    const sentimentTrend = sentimentSlope > 0.005 ? "improving" : sentimentSlope < -0.005 ? "declining" : "stable";

    // --- Vocabulary diversity (Type-Token Ratio per entry and over time) ---
    const ttrValues = sorted.map(e => {
      const words = (e.text || "").toLowerCase().split(/\s+/).filter(w => w.length > 1);
      const types = new Set(words).size;
      return {
        date: e.date,
        wordCount: words.length,
        uniqueWords: types,
        ttr: words.length > 0 ? r(types / words.length) : 0,
      };
    });

    // TTR trend
    const ttrVals = ttrValues.map(t => t.ttr);
    const meanTTR = ttrVals.reduce((s, v) => s + v, 0) / ttrVals.length;
    let ttrSSXY = 0, ttrSSXX = 0;
    const ttrXs = ttrVals.map((_, i) => i);
    const ttrMeanX = ttrXs.reduce((s, v) => s + v, 0) / ttrXs.length;
    for (let i = 0; i < ttrXs.length; i++) {
      ttrSSXY += (ttrXs[i] - ttrMeanX) * (ttrVals[i] - meanTTR);
      ttrSSXX += (ttrXs[i] - ttrMeanX) * (ttrXs[i] - ttrMeanX);
    }
    const ttrSlope = ttrSSXX > 0 ? ttrSSXY / ttrSSXX : 0;
    const vocabTrend = ttrSlope > 0.002 ? "expanding" : ttrSlope < -0.002 ? "contracting" : "stable";

    // --- Topic expansion over time (cumulative unique terms) ---
    const cumulativeVocab = [];
    const seenTerms = new Set();
    for (const entry of sorted) {
      const words = (entry.text || "").toLowerCase().split(/\s+/).filter(w => w.length > 3);
      for (const w of words) seenTerms.add(w);
      cumulativeVocab.push({
        date: entry.date,
        cumulativeUniqueTerms: seenTerms.size,
      });
    }

    // Topic expansion rate (new unique terms per entry in recent vs early entries)
    const earlyRate = sorted.length >= 4
      ? (cumulativeVocab[Math.floor(sorted.length / 4)].cumulativeUniqueTerms) / Math.floor(sorted.length / 4)
      : 0;
    const recentRate = sorted.length >= 4
      ? (cumulativeVocab[sorted.length - 1].cumulativeUniqueTerms - cumulativeVocab[sorted.length - Math.floor(sorted.length / 4) - 1].cumulativeUniqueTerms) / Math.floor(sorted.length / 4)
      : 0;

    // --- Windowed growth analysis ---
    const windows = [];
    for (let i = 0; i <= sorted.length - windowSize; i++) {
      const win = sorted.slice(i, i + windowSize);
      const avgSentiment = win.reduce((s, e) => s + sentimentScore(e.text), 0) / windowSize;
      const avgWordCount = win.reduce((s, e) => s + (e.text || "").split(/\s+/).length, 0) / windowSize;
      windows.push({
        windowStart: i,
        dateRange: { from: win[0].date, to: win[windowSize - 1].date },
        avgSentiment: r(avgSentiment),
        avgWordCount: Math.round(avgWordCount),
      });
    }

    // --- Entry length trend (are entries getting longer/deeper?) ---
    const lengths = sorted.map(e => (e.text || "").split(/\s+/).length);
    const avgLength = lengths.reduce((s, v) => s + v, 0) / lengths.length;
    const meanLenX = lengths.map((_, i) => i).reduce((s, v) => s + v, 0) / lengths.length;
    let lenSSXY = 0, lenSSXX = 0;
    for (let i = 0; i < lengths.length; i++) {
      lenSSXY += (i - meanLenX) * (lengths[i] - avgLength);
      lenSSXX += (i - meanLenX) * (i - meanLenX);
    }
    const lengthSlope = lenSSXX > 0 ? lenSSXY / lenSSXX : 0;
    const depthTrend = lengthSlope > 1 ? "deepening" : lengthSlope < -1 ? "shallowing" : "consistent";

    return {
      ok: true,
      result: {
        entriesAnalyzed: sorted.length,
        sentiment: {
          overall: r(meanSent),
          trend: sentimentTrend,
          slope: r(sentimentSlope),
          timeline: sentiments.length <= 30 ? sentiments : sentiments.filter((_, i) => i % Math.ceil(sentiments.length / 30) === 0),
        },
        vocabularyDiversity: {
          avgTTR: r(meanTTR),
          trend: vocabTrend,
          slope: r(ttrSlope),
          totalUniqueTerms: seenTerms.size,
        },
        topicExpansion: {
          earlyNewTermsPerEntry: r(earlyRate),
          recentNewTermsPerEntry: r(recentRate),
          expansionRatio: earlyRate > 0 ? r(recentRate / earlyRate) : null,
          cumulativeCurve: cumulativeVocab.length <= 20 ? cumulativeVocab : cumulativeVocab.filter((_, i) => i % Math.ceil(cumulativeVocab.length / 20) === 0),
        },
        entryDepth: {
          avgWordCount: Math.round(avgLength),
          trend: depthTrend,
          slope: r(lengthSlope),
        },
        growthWindows: windows.length <= 15 ? windows : windows.filter((_, i) => i % Math.ceil(windows.length / 15) === 0),
      },
    };
  });

  /**
   * habitTracking
   * Analyze habit patterns — streak counting, consistency scoring, optimal
   * time detection, and habit stacking recommendations.
   * artifact.data.habits = [{ name, completions: [{ date, time?, duration?, quality? }] }]
   */
  registerLensAction("reflection", "habitTracking", (ctx, artifact, params) => {
    const habits = artifact.data?.habits || [];
    if (habits.length === 0) {
      return { ok: true, result: { message: "No habit data to analyze." } };
    }

    const r = (v) => Math.round(v * 10000) / 10000;

    const habitProfiles = habits.map(habit => {
      const completions = (habit.completions || [])
        .map(c => ({
          ...c,
          dateObj: new Date(c.date),
          ts: new Date(c.date).getTime(),
        }))
        .filter(c => !isNaN(c.ts))
        .sort((a, b) => a.ts - b.ts);

      if (completions.length === 0) {
        return { name: habit.name, completions: 0, streak: 0, consistency: 0 };
      }

      // --- Streak counting ---
      // Normalize to day strings
      const daySet = new Set();
      const days = [];
      for (const c of completions) {
        const dayStr = c.dateObj.toISOString().split("T")[0];
        if (!daySet.has(dayStr)) {
          daySet.add(dayStr);
          days.push(dayStr);
        }
      }
      days.sort();

      // Current streak (consecutive days ending at most recent)
      let currentStreak = 1;
      for (let i = days.length - 1; i > 0; i--) {
        const diff = (new Date(days[i]).getTime() - new Date(days[i - 1]).getTime()) / 86400000;
        if (diff === 1) currentStreak++;
        else break;
      }

      // Longest streak
      let longestStreak = 1;
      let tempStreak = 1;
      for (let i = 1; i < days.length; i++) {
        const diff = (new Date(days[i]).getTime() - new Date(days[i - 1]).getTime()) / 86400000;
        if (diff === 1) {
          tempStreak++;
          longestStreak = Math.max(longestStreak, tempStreak);
        } else {
          tempStreak = 1;
        }
      }

      // --- Consistency score ---
      // Based on regularity over the date range
      const rangeMs = completions[completions.length - 1].ts - completions[0].ts;
      const rangeDays = Math.max(1, rangeMs / 86400000);
      const expectedCompletions = rangeDays; // assuming daily habit
      const consistency = Math.min(1, days.length / expectedCompletions);

      // Weekly consistency (fraction of weeks with at least one completion)
      const weekSet = new Set();
      for (const c of completions) {
        const weekStart = new Date(c.dateObj);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        weekSet.add(weekStart.toISOString().split("T")[0]);
      }
      const totalWeeks = Math.max(1, Math.ceil(rangeDays / 7));
      const weeklyConsistency = weekSet.size / totalWeeks;

      // --- Optimal time detection ---
      const hourCounts = new Array(24).fill(0);
      for (const c of completions) {
        if (c.time) {
          const parts = c.time.split(":");
          const hour = parseInt(parts[0]);
          if (!isNaN(hour) && hour >= 0 && hour < 24) hourCounts[hour]++;
        } else if (c.dateObj) {
          const hour = c.dateObj.getHours();
          hourCounts[hour]++;
        }
      }
      const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
      const hasTimeData = hourCounts.some(c => c > 0);

      // Day-of-week distribution
      const dowCounts = new Array(7).fill(0);
      const dowNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      for (const c of completions) {
        dowCounts[c.dateObj.getDay()]++;
      }
      const peakDay = dowNames[dowCounts.indexOf(Math.max(...dowCounts))];

      // --- Quality trend (if available) ---
      let qualityTrend = null;
      const qualityValues = completions.map(c => parseFloat(c.quality)).filter(v => !isNaN(v));
      if (qualityValues.length >= 3) {
        const meanQ = qualityValues.reduce((s, v) => s + v, 0) / qualityValues.length;
        const qXs = qualityValues.map((_, i) => i);
        const meanQX = qXs.reduce((s, v) => s + v, 0) / qXs.length;
        let qSSXY = 0, qSSXX = 0;
        for (let i = 0; i < qXs.length; i++) {
          qSSXY += (qXs[i] - meanQX) * (qualityValues[i] - meanQ);
          qSSXX += (qXs[i] - meanQX) * (qXs[i] - meanQX);
        }
        const qSlope = qSSXX > 0 ? qSSXY / qSSXX : 0;
        qualityTrend = {
          avgQuality: r(meanQ),
          trend: qSlope > 0.01 ? "improving" : qSlope < -0.01 ? "declining" : "stable",
          slope: r(qSlope),
        };
      }

      // --- Duration stats (if available) ---
      let durationStats = null;
      const durations = completions.map(c => parseFloat(c.duration)).filter(v => !isNaN(v) && v > 0);
      if (durations.length > 0) {
        const avgDuration = durations.reduce((s, v) => s + v, 0) / durations.length;
        durationStats = {
          avg: r(avgDuration),
          min: r(Math.min(...durations)),
          max: r(Math.max(...durations)),
          total: r(durations.reduce((s, v) => s + v, 0)),
        };
      }

      return {
        name: habit.name,
        totalCompletions: completions.length,
        uniqueDays: days.length,
        currentStreak,
        longestStreak,
        consistency: r(consistency),
        weeklyConsistency: r(weeklyConsistency),
        optimalTime: hasTimeData ? { hour: peakHour, label: `${peakHour}:00` } : null,
        peakDay,
        dayOfWeekDistribution: Object.fromEntries(dowNames.map((name, i) => [name, dowCounts[i]])),
        qualityTrend,
        durationStats,
        dateRange: { from: days[0], to: days[days.length - 1] },
      };
    });

    // --- Habit stacking recommendations ---
    // Find habits that tend to co-occur on the same days
    const stackingRecommendations = [];
    for (let i = 0; i < habitProfiles.length; i++) {
      for (let j = i + 1; j < habitProfiles.length; j++) {
        const h1 = habits[i];
        const h2 = habits[j];
        const days1 = new Set((h1.completions || []).map(c => new Date(c.date).toISOString().split("T")[0]));
        const days2 = new Set((h2.completions || []).map(c => new Date(c.date).toISOString().split("T")[0]));
        const overlap = [...days1].filter(d => days2.has(d)).length;
        const union = new Set([...days1, ...days2]).size;
        const coOccurrence = union > 0 ? overlap / union : 0;

        if (coOccurrence > 0.3) {
          stackingRecommendations.push({
            habits: [h1.name, h2.name],
            coOccurrenceRate: r(coOccurrence),
            sharedDays: overlap,
            recommendation: coOccurrence > 0.6
              ? "Already strongly linked. Formalize as a stack."
              : "Moderate co-occurrence. Could benefit from intentional stacking.",
          });
        }
      }
    }
    stackingRecommendations.sort((a, b) => b.coOccurrenceRate - a.coOccurrenceRate);

    // Overall consistency
    const avgConsistency = habitProfiles.reduce((s, h) => s + (h.consistency || 0), 0) / habitProfiles.length;

    return {
      ok: true,
      result: {
        totalHabits: habits.length,
        overallConsistency: r(avgConsistency),
        habitProfiles,
        stackingRecommendations: stackingRecommendations.slice(0, 10),
        strongest: habitProfiles.reduce((best, h) => (h.consistency || 0) > (best.consistency || 0) ? h : best, habitProfiles[0])?.name,
        needsAttention: habitProfiles.filter(h => (h.consistency || 0) < 0.3).map(h => h.name),
      },
    };
  });

  // ─── Day One 2026 parity — journaling companion ─────────────────────
  // Named journals, rich entries (mood / tags / location / weather),
  // On This Day, streaks, a rotating prompt library, templates, search.

  function getRfState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.reflectionLens) STATE.reflectionLens = {};
    const s = STATE.reflectionLens;
    for (const k of ["journals", "entries", "goal"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveRfState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const rfId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const rfNow = () => new Date().toISOString();
  const rfAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const rfListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const rfNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const rfClean = (v, max = 500) => String(v == null ? "" : v).trim().slice(0, max);
  const rfDay = (v) => rfClean(v, 10).slice(0, 10);
  const RF_DAY = 86400000;
  const RF_MOODS = ["great", "good", "okay", "low", "rough"];
  const RF_WEATHER = ["sunny", "cloudy", "rainy", "snowy", "stormy", "clear", "windy", "foggy"];

  // Real, evidence-informed reflective journaling prompts.
  const RF_PROMPTS = [
    { category: "gratitude", text: "What is one small thing today that you are grateful for, and why?" },
    { category: "gratitude", text: "Who made your day a little better, and have you told them?" },
    { category: "gratitude", text: "What is something about your body or health you appreciated today?" },
    { category: "growth", text: "What did you learn today that you did not know yesterday?" },
    { category: "growth", text: "What is a mistake you made recently, and what did it teach you?" },
    { category: "growth", text: "What is one habit you want to be true of you a year from now?" },
    { category: "growth", text: "Where did you step outside your comfort zone, even slightly?" },
    { category: "relationships", text: "Describe a conversation that stayed with you today." },
    { category: "relationships", text: "Who do you want to be more present for, and how?" },
    { category: "relationships", text: "When did you feel most connected to someone this week?" },
    { category: "work", text: "What is the most meaningful thing you worked on today?" },
    { category: "work", text: "What drained your energy at work, and what restored it?" },
    { category: "work", text: "If tomorrow had only one priority, what should it be?" },
    { category: "mindfulness", text: "What emotion was loudest for you today? Where did you feel it in your body?" },
    { category: "mindfulness", text: "Describe a moment today when you felt fully present." },
    { category: "mindfulness", text: "What is your mind circling around right now? Name it plainly." },
    { category: "creativity", text: "What idea excited you today, even if you did nothing with it?" },
    { category: "creativity", text: "If you could redo one hour of today, how would you spend it?" },
    { category: "reflection", text: "What would you tell yourself this morning if you could go back?" },
    { category: "reflection", text: "What is something you are letting go of?" },
  ];
  const RF_PROMPT_CATEGORIES = [...new Set(RF_PROMPTS.map((p) => p.category))];

  // Structured entry templates.
  const RF_TEMPLATES = [
    { id: "daily-review", name: "Daily review", category: "reflection",
      body: "Highlight of the day:\n\nWhat challenged me:\n\nWhat I'm grateful for:\n\nOne thing for tomorrow:" },
    { id: "gratitude", name: "Three good things", category: "gratitude",
      body: "1.\n\n2.\n\n3.\n\nWhy these mattered:" },
    { id: "morning-intention", name: "Morning intention", category: "mindfulness",
      body: "How I feel waking up:\n\nMy intention for today:\n\nWhat would make today good:" },
    { id: "evening-reflection", name: "Evening reflection", category: "mindfulness",
      body: "What went well:\n\nWhat I would do differently:\n\nWhat I'm releasing before sleep:" },
    { id: "travel", name: "Travel log", category: "travel",
      body: "Where I am:\n\nWhat I saw:\n\nA moment I want to remember:\n\nHow this place made me feel:" },
    { id: "weekly-review", name: "Weekly review", category: "growth",
      body: "Wins this week:\n\nWhat I learned:\n\nWhat I'm carrying into next week:\n\nOne thing to change:" },
  ];

  function rfStreak(dateset) {
    if (!dateset.size) return 0;
    let streak = 0;
    const d = new Date();
    if (!dateset.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
    while (dateset.has(d.toISOString().slice(0, 10))) { streak += 1; d.setUTCDate(d.getUTCDate() - 1); }
    return streak;
  }
  function rfLongestStreak(dates) {
    const sorted = [...new Set(dates)].sort();
    let longest = 0, run = 0, prev = null;
    for (const ds of sorted) {
      if (prev && (Date.parse(ds) - Date.parse(prev)) === RF_DAY) run += 1;
      else run = 1;
      if (run > longest) longest = run;
      prev = ds;
    }
    return longest;
  }
  function rfWords(text) {
    return rfClean(text, 100000).split(/\s+/).filter(Boolean).length;
  }
  function rfEntryView(e) {
    return { ...e, wordCount: rfWords(e.text) };
  }

  // ── Journals ────────────────────────────────────────────────────────
  registerLensAction("reflection", "journal-create", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = rfClean(params.name, 80);
    if (!name) return { ok: false, error: "journal name required" };
    const journal = {
      id: rfId("jrn"), name,
      color: rfClean(params.color, 16) || "sky",
      createdAt: rfNow(),
    };
    rfListB(s.journals, rfAid(ctx)).push(journal);
    saveRfState();
    return { ok: true, result: { journal } };
  });

  registerLensAction("reflection", "journal-list", (ctx, _a, _params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const entries = s.entries.get(userId) || [];
    const journals = (s.journals.get(userId) || []).map((j) => ({
      ...j,
      entryCount: entries.filter((e) => e.journalId === j.id).length,
    }));
    return { ok: true, result: { journals, count: journals.length } };
  });

  registerLensAction("reflection", "journal-delete", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const arr = s.journals.get(userId) || [];
    const i = arr.findIndex((j) => j.id === params.id);
    if (i < 0) return { ok: false, error: "journal not found" };
    arr.splice(i, 1);
    // detach orphaned entries rather than deleting them
    for (const e of s.entries.get(userId) || []) {
      if (e.journalId === params.id) e.journalId = null;
    }
    saveRfState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Entries ─────────────────────────────────────────────────────────
  registerLensAction("reflection", "entry-create", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const text = rfClean(params.text, 20000);
    if (!text) return { ok: false, error: "entry text required" };
    const userId = rfAid(ctx);
    let journalId = params.journalId ? String(params.journalId) : null;
    if (journalId && !(s.journals.get(userId) || []).some((j) => j.id === journalId)) {
      journalId = null;
    }
    const entry = {
      id: rfId("ent"), journalId, text,
      title: rfClean(params.title, 140) || null,
      mood: RF_MOODS.includes(String(params.mood).toLowerCase()) ? String(params.mood).toLowerCase() : null,
      tags: Array.isArray(params.tags)
        ? [...new Set(params.tags.map((t) => rfClean(t, 30).toLowerCase()).filter(Boolean))].slice(0, 12) : [],
      location: rfClean(params.location, 120) || null,
      weather: RF_WEATHER.includes(String(params.weather).toLowerCase()) ? String(params.weather).toLowerCase() : null,
      photoCount: Math.max(0, Math.round(rfNum(params.photoCount))),
      promptText: rfClean(params.promptText, 300) || null,
      date: rfDay(params.date) || rfDay(rfNow()),
      at: rfNow(), updatedAt: rfNow(),
    };
    rfListB(s.entries, userId).push(entry);
    saveRfState();
    return { ok: true, result: { entry: rfEntryView(entry) } };
  });

  registerLensAction("reflection", "entry-list", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let entries = [...(s.entries.get(rfAid(ctx)) || [])];
    if (params.journalId) entries = entries.filter((e) => e.journalId === String(params.journalId));
    if (params.tag) entries = entries.filter((e) => e.tags.includes(String(params.tag).toLowerCase()));
    if (params.days) {
      const cutoff = new Date(Date.now() - Math.max(1, rfNum(params.days, 30)) * RF_DAY).toISOString().slice(0, 10);
      entries = entries.filter((e) => e.date >= cutoff);
    }
    entries.sort((a, b) => b.at.localeCompare(a.at));
    const limit = Math.max(1, Math.min(200, Math.round(rfNum(params.limit, 60))));
    return {
      ok: true,
      result: { entries: entries.slice(0, limit).map(rfEntryView), count: entries.length },
    };
  });

  registerLensAction("reflection", "entry-detail", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entry = (s.entries.get(rfAid(ctx)) || []).find((e) => e.id === params.id);
    if (!entry) return { ok: false, error: "entry not found" };
    return { ok: true, result: { entry: rfEntryView(entry) } };
  });

  registerLensAction("reflection", "entry-update", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entry = (s.entries.get(rfAid(ctx)) || []).find((e) => e.id === params.id);
    if (!entry) return { ok: false, error: "entry not found" };
    if (params.text != null) {
      const text = rfClean(params.text, 20000);
      if (!text) return { ok: false, error: "entry text cannot be empty" };
      entry.text = text;
    }
    if (params.title != null) entry.title = rfClean(params.title, 140) || null;
    if (params.mood != null) {
      entry.mood = RF_MOODS.includes(String(params.mood).toLowerCase()) ? String(params.mood).toLowerCase() : entry.mood;
    }
    if (Array.isArray(params.tags)) {
      entry.tags = [...new Set(params.tags.map((t) => rfClean(t, 30).toLowerCase()).filter(Boolean))].slice(0, 12);
    }
    entry.updatedAt = rfNow();
    saveRfState();
    return { ok: true, result: { entry: rfEntryView(entry) } };
  });

  registerLensAction("reflection", "entry-delete", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.entries.get(rfAid(ctx)) || [];
    const i = arr.findIndex((e) => e.id === params.id);
    if (i < 0) return { ok: false, error: "entry not found" };
    arr.splice(i, 1);
    saveRfState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("reflection", "entry-search", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = rfClean(params.query, 120).toLowerCase();
    if (!q) return { ok: false, error: "search query required" };
    const hits = (s.entries.get(rfAid(ctx)) || [])
      .filter((e) =>
        e.text.toLowerCase().includes(q) ||
        (e.title || "").toLowerCase().includes(q) ||
        e.tags.some((t) => t.includes(q)))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 50)
      .map(rfEntryView);
    return { ok: true, result: { entries: hits, count: hits.length, query: q } };
  });

  // ── On This Day ─────────────────────────────────────────────────────
  registerLensAction("reflection", "on-this-day", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ref = rfDay(params.date) || rfDay(rfNow());
    const md = ref.slice(5);             // MM-DD
    const year = ref.slice(0, 4);
    const matches = (s.entries.get(rfAid(ctx)) || [])
      .filter((e) => e.date.slice(5) === md && e.date.slice(0, 4) !== year)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => ({ ...rfEntryView(e), yearsAgo: Number(year) - Number(e.date.slice(0, 4)) }));
    return { ok: true, result: { date: md, entries: matches, count: matches.length } };
  });

  // ── Streaks & stats ─────────────────────────────────────────────────
  registerLensAction("reflection", "journal-streak", (ctx, _a, _params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const dates = (s.entries.get(rfAid(ctx)) || []).map((e) => e.date);
    return {
      ok: true,
      result: {
        currentStreak: rfStreak(new Set(dates)),
        longestStreak: rfLongestStreak(dates),
        daysJournaled: new Set(dates).size,
      },
    };
  });

  registerLensAction("reflection", "journal-stats", (ctx, _a, _params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entries = s.entries.get(rfAid(ctx)) || [];
    const byMood = {};
    for (const m of RF_MOODS) byMood[m] = 0;
    let totalWords = 0;
    for (const e of entries) {
      totalWords += rfWords(e.text);
      if (e.mood) byMood[e.mood] = (byMood[e.mood] || 0) + 1;
    }
    return {
      ok: true,
      result: {
        totalEntries: entries.length,
        totalWords,
        avgWords: entries.length ? Math.round(totalWords / entries.length) : 0,
        totalPhotos: entries.reduce((a, e) => a + (e.photoCount || 0), 0),
        byMood,
      },
    };
  });

  // ── Prompts ─────────────────────────────────────────────────────────
  registerLensAction("reflection", "prompt-today", (_ctx, _a, params = {}) => {
    const ref = rfDay(params.date) || rfDay(rfNow());
    // Deterministic rotation: day-of-epoch indexes the prompt library.
    const idx = Math.floor(Date.parse(`${ref}T00:00:00Z`) / RF_DAY) % RF_PROMPTS.length;
    return { ok: true, result: { date: ref, prompt: RF_PROMPTS[(idx + RF_PROMPTS.length) % RF_PROMPTS.length] } };
  });

  registerLensAction("reflection", "prompt-library", (_ctx, _a, _params = {}) => {
    return {
      ok: true,
      result: {
        categories: RF_PROMPT_CATEGORIES,
        prompts: RF_PROMPTS,
        count: RF_PROMPTS.length,
      },
    };
  });

  registerLensAction("reflection", "prompt-random", (_ctx, _a, params = {}) => {
    let pool = RF_PROMPTS;
    if (params.category) {
      const c = String(params.category).toLowerCase();
      const filtered = RF_PROMPTS.filter((p) => p.category === c);
      if (filtered.length) pool = filtered;
    }
    return { ok: true, result: { prompt: pool[Math.floor(Math.random() * pool.length)] } };
  });

  // ── Templates ───────────────────────────────────────────────────────
  registerLensAction("reflection", "templates-list", (_ctx, _a, _params = {}) => {
    return { ok: true, result: { templates: RF_TEMPLATES, count: RF_TEMPLATES.length } };
  });

  registerLensAction("reflection", "entry-from-template", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const tpl = RF_TEMPLATES.find((t) => t.id === String(params.templateId));
    if (!tpl) return { ok: false, error: "unknown template" };
    const userId = rfAid(ctx);
    let journalId = params.journalId ? String(params.journalId) : null;
    if (journalId && !(s.journals.get(userId) || []).some((j) => j.id === journalId)) {
      journalId = null;
    }
    const entry = {
      id: rfId("ent"), journalId, text: tpl.body, title: tpl.name,
      mood: null, tags: [tpl.category], location: null, weather: null,
      photoCount: 0, promptText: null,
      date: rfDay(rfNow()), at: rfNow(), updatedAt: rfNow(),
    };
    rfListB(s.entries, userId).push(entry);
    saveRfState();
    return { ok: true, result: { entry: rfEntryView(entry), template: tpl.id } };
  });

  // ── Tags ────────────────────────────────────────────────────────────
  registerLensAction("reflection", "tags-list", (ctx, _a, _params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const counts = {};
    for (const e of s.entries.get(rfAid(ctx)) || []) {
      for (const t of e.tags) counts[t] = (counts[t] || 0) + 1;
    }
    const tags = Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
    return { ok: true, result: { tags, count: tags.length } };
  });

  // ── Calendar ────────────────────────────────────────────────────────
  registerLensAction("reflection", "calendar-month", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const now = new Date();
    const year = Math.round(rfNum(params.year, now.getUTCFullYear()));
    const month = Math.max(1, Math.min(12, Math.round(rfNum(params.month, now.getUTCMonth() + 1))));
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const days = {};
    for (const e of s.entries.get(rfAid(ctx)) || []) {
      if (e.date.startsWith(prefix)) {
        const d = e.date.slice(8, 10);
        days[d] = (days[d] || 0) + 1;
      }
    }
    return {
      ok: true,
      result: { year, month, days, daysWithEntries: Object.keys(days).length },
    };
  });

  // ── Mood trend ──────────────────────────────────────────────────────
  registerLensAction("reflection", "mood-trend", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = Math.max(1, Math.min(365, Math.round(rfNum(params.days, 30))));
    const cutoff = new Date(Date.now() - days * RF_DAY).toISOString().slice(0, 10);
    const scored = { great: 5, good: 4, okay: 3, low: 2, rough: 1 };
    const moodEntries = (s.entries.get(rfAid(ctx)) || [])
      .filter((e) => e.mood && e.date >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date));
    const distribution = {};
    for (const m of RF_MOODS) distribution[m] = 0;
    for (const e of moodEntries) distribution[e.mood] += 1;
    const avg = moodEntries.length
      ? Math.round((moodEntries.reduce((a, e) => a + scored[e.mood], 0) / moodEntries.length) * 100) / 100
      : null;
    return {
      ok: true,
      result: {
        entries: moodEntries.length,
        averageScore: avg,
        distribution,
        series: moodEntries.map((e) => ({ date: e.date, mood: e.mood, score: scored[e.mood] })),
      },
    };
  });

  // ── Reflection AI — deterministic-first, optional brain enhancement ──
  registerLensAction("reflection", "reflect-deepen", async (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entry = (s.entries.get(rfAid(ctx)) || []).find((e) => e.id === params.id);
    if (!entry) return { ok: false, error: "entry not found" };
    // Deterministic "go deeper" follow-up questions grounded in the entry.
    const deterministic = [
      "What part of this still feels unresolved?",
      "If a friend wrote this, what would you want to ask them?",
      "What does this entry tell you about what you need right now?",
    ];
    let questions = deterministic;
    let composer = "deterministic";
    if (ctx?.llm?.chat) {
      try {
        const out = await ctx.llm.chat({
          system: "You help someone reflect more deeply on a journal entry. Return exactly three short, open follow-up questions, one per line. Ask only about what is in the entry — never invent events.",
          messages: [{ role: "user", content: entry.text.slice(0, 2000) }],
        });
        const lines = String(out?.content || out || "")
          .split("\n").map((l) => l.replace(/^[\d.\-)\s]+/, "").trim()).filter(Boolean);
        if (lines.length >= 3) { questions = lines.slice(0, 3); composer = "brain"; }
      } catch (_e) { /* fall back to deterministic */ }
    }
    return { ok: true, result: { entryId: entry.id, questions, composer } };
  });

  registerLensAction("reflection", "entry-summarize", async (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entry = (s.entries.get(rfAid(ctx)) || []).find((e) => e.id === params.id);
    if (!entry) return { ok: false, error: "entry not found" };
    const sentences = entry.text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
    let summary = sentences.slice(0, 2).join(" ") || entry.text.slice(0, 160);
    let composer = "deterministic";
    if (ctx?.llm?.chat) {
      try {
        const out = await ctx.llm.chat({
          system: "Summarize this journal entry in one or two sentences. Use only what the entry says — never add events the writer did not mention.",
          messages: [{ role: "user", content: entry.text.slice(0, 2000) }],
        });
        const text = rfClean(String(out?.content || out || ""), 400);
        if (text) { summary = text; composer = "brain"; }
      } catch (_e) { /* fall back to deterministic */ }
    }
    return { ok: true, result: { entryId: entry.id, summary, composer } };
  });

  // ── Goal ────────────────────────────────────────────────────────────
  registerLensAction("reflection", "reflection-goal-set", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const weeklyEntries = Math.max(1, Math.min(21, Math.round(rfNum(params.weeklyEntries, 5))));
    s.goal.set(rfAid(ctx), { weeklyEntries, updatedAt: rfNow() });
    saveRfState();
    return { ok: true, result: { weeklyEntries } };
  });

  registerLensAction("reflection", "reflection-goal-status", (ctx, _a, _params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const goal = s.goal.get(userId) || { weeklyEntries: 5 };
    const weekAgo = new Date(Date.now() - 7 * RF_DAY).toISOString().slice(0, 10);
    const thisWeek = (s.entries.get(userId) || []).filter((e) => e.date >= weekAgo).length;
    return {
      ok: true,
      result: {
        weeklyEntries: goal.weeklyEntries,
        entriesThisWeek: thisWeek,
        pct: Math.round((thisWeek / goal.weeklyEntries) * 100),
        met: thisWeek >= goal.weeklyEntries,
        isDefault: !s.goal.has(userId),
      },
    };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("reflection", "reflection-dashboard", (ctx, _a, _params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const entries = s.entries.get(userId) || [];
    const dates = entries.map((e) => e.date);
    const weekAgo = new Date(Date.now() - 7 * RF_DAY).toISOString().slice(0, 10);
    const today = rfDay(rfNow());
    const idx = Math.floor(Date.parse(`${today}T00:00:00Z`) / RF_DAY) % RF_PROMPTS.length;
    const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at));
    return {
      ok: true,
      result: {
        currentStreak: rfStreak(new Set(dates)),
        longestStreak: rfLongestStreak(dates),
        totalEntries: entries.length,
        entriesThisWeek: entries.filter((e) => e.date >= weekAgo).length,
        journals: (s.journals.get(userId) || []).length,
        totalWords: entries.reduce((a, e) => a + rfWords(e.text), 0),
        latestMood: sorted.find((e) => e.mood)?.mood || null,
        promptOfTheDay: RF_PROMPTS[(idx + RF_PROMPTS.length) % RF_PROMPTS.length],
        wroteToday: dates.includes(today),
      },
    };
  });
}
