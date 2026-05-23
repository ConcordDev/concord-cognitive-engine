// server/domains/reflection.js
// Domain actions for self-reflection and journaling: insight extraction,
// growth metrics tracking, and habit pattern analysis.

import { cachedFetchJson } from "../lib/external-fetch.js";
import { createHash } from "node:crypto";

export default function registerReflectionActions(registerLensAction) {
  /**
   * insightExtraction
   * Extract insights from journal entries — pattern recognition across entries,
   * identify recurring themes with TF-IDF.
   * artifact.data.entries = [{ text, date?, tags?: [string], mood?: string }]
   * params.topN — number of top themes to return (default 10)
   */
  registerLensAction("reflection", "insightExtraction", (ctx, artifact, params) => {
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * growthMetrics
   * Compute personal growth metrics — sentiment trend, vocabulary diversity
   * (type-token ratio), and topic expansion over time.
   * artifact.data.entries = [{ text, date }]
   * params.windowSize — entries per window for trend analysis (default 5)
   */
  registerLensAction("reflection", "growthMetrics", (ctx, artifact, params) => {
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * habitTracking
   * Analyze habit patterns — streak counting, consistency scoring, optimal
   * time detection, and habit stacking recommendations.
   * artifact.data.habits = [{ name, completions: [{ date, time?, duration?, quality? }] }]
   */
  registerLensAction("reflection", "habitTracking", (ctx, artifact, params) => {
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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

  // ─── Day One parity backlog ─────────────────────────────────────────
  // Rich media, reminders, encryption, timeline/map, audio journaling,
  // year-in-review/export, and a multi-device sync indicator.

  function rfExtraState(s) {
    for (const k of ["reminders", "deviceLog", "exports"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  const RF_MEDIA_TYPES = ["image", "audio", "video", "file"];
  // A small XOR + base64 reversible cipher. Real obfuscation at rest for the
  // in-memory substrate — keyed per user so one user's key can't read another.
  function rfCipher(text, key) {
    const k = String(key || "");
    if (!k) return text;
    let out = "";
    for (let i = 0; i < text.length; i++) {
      out += String.fromCharCode(text.charCodeAt(i) ^ k.charCodeAt(i % k.length));
    }
    return out;
  }
  function rfB64encode(str) {
    return Buffer.from(str, "utf8").toString("base64");
  }
  function rfB64decode(str) {
    try { return Buffer.from(String(str), "base64").toString("utf8"); }
    catch (_e) { return ""; }
  }
  // Salted key fingerprint — lets decrypt reject a wrong key. The XOR
  // cipher is its own inverse, so a content round-trip alone can never
  // detect a wrong key; a stored fingerprint can.
  function rfKeyFingerprint(key) {
    return createHash("sha256").update(`concord-reflection-kf::${String(key)}`).digest("hex");
  }
  function rfEntryById(s, userId, id) {
    return (s.entries.get(userId) || []).find((e) => e.id === id) || null;
  }

  // ── Rich entry media ────────────────────────────────────────────────
  // Attach images / audio / video references to an entry. Stores a media
  // descriptor (caption, mime, byte size, optional data URL) — never
  // fabricates content; the caller supplies real uploaded data.
  registerLensAction("reflection", "entry-attach-media", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const entry = rfEntryById(s, userId, params.entryId);
    if (!entry) return { ok: false, error: "entry not found" };
    const type = RF_MEDIA_TYPES.includes(String(params.type)) ? String(params.type) : null;
    if (!type) return { ok: false, error: "media type must be image/audio/video/file" };
    const dataUrl = rfClean(params.dataUrl, 8_000_000);
    const url = rfClean(params.url, 2000);
    if (!dataUrl && !url) return { ok: false, error: "dataUrl or url required" };
    const media = {
      id: rfId("med"), type,
      caption: rfClean(params.caption, 200) || null,
      mime: rfClean(params.mime, 80) || null,
      bytes: Math.max(0, Math.round(rfNum(params.bytes))),
      dataUrl: dataUrl || null,
      url: url || null,
      addedAt: rfNow(),
    };
    if (!Array.isArray(entry.media)) entry.media = [];
    entry.media.push(media);
    entry.photoCount = entry.media.filter((m) => m.type === "image").length;
    entry.updatedAt = rfNow();
    saveRfState();
    return { ok: true, result: { entryId: entry.id, media, mediaCount: entry.media.length } };
  });

  registerLensAction("reflection", "entry-remove-media", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const entry = rfEntryById(s, userId, params.entryId);
    if (!entry) return { ok: false, error: "entry not found" };
    const arr = Array.isArray(entry.media) ? entry.media : [];
    const i = arr.findIndex((m) => m.id === params.mediaId);
    if (i < 0) return { ok: false, error: "media not found" };
    arr.splice(i, 1);
    entry.photoCount = arr.filter((m) => m.type === "image").length;
    entry.updatedAt = rfNow();
    saveRfState();
    return { ok: true, result: { entryId: entry.id, removed: params.mediaId, mediaCount: arr.length } };
  });

  // Set location with real geo-coordinates + optionally fetch live weather.
  registerLensAction("reflection", "entry-set-place", async (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const entry = rfEntryById(s, userId, params.entryId);
    if (!entry) return { ok: false, error: "entry not found" };
    const lat = rfNum(params.lat, NaN);
    const lon = rfNum(params.lon, NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return { ok: false, error: "valid lat/lon required" };
    }
    entry.location = rfClean(params.location, 120) || entry.location;
    entry.geo = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
    let weatherFetched = false;
    if (params.fetchWeather) {
      try {
        const data = await cachedFetchJson(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`,
          { ttlMs: 600000 });
        const code = data?.current?.weather_code;
        const CODE_MAP = { 0: "clear", 1: "sunny", 2: "cloudy", 3: "cloudy", 45: "foggy", 48: "foggy",
          51: "rainy", 61: "rainy", 63: "rainy", 65: "rainy", 71: "snowy", 73: "snowy", 75: "snowy",
          80: "rainy", 95: "stormy", 96: "stormy", 99: "stormy" };
        if (code != null && CODE_MAP[code]) { entry.weather = CODE_MAP[code]; weatherFetched = true; }
        if (data?.current?.temperature_2m != null) {
          entry.temperatureC = Math.round(rfNum(data.current.temperature_2m) * 10) / 10;
        }
      } catch (_e) { /* weather is best-effort */ }
    }
    entry.updatedAt = rfNow();
    saveRfState();
    return { ok: true, result: { entryId: entry.id, geo: entry.geo, weather: entry.weather, temperatureC: entry.temperatureC || null, weatherFetched } };
  });

  // ── Daily writing reminders ─────────────────────────────────────────
  registerLensAction("reflection", "reminder-set", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    rfExtraState(s);
    const hh = Math.max(0, Math.min(23, Math.round(rfNum(params.hour, 21))));
    const mm = Math.max(0, Math.min(59, Math.round(rfNum(params.minute, 0))));
    const allDays = [0, 1, 2, 3, 4, 5, 6];
    const days = Array.isArray(params.days) && params.days.length
      ? [...new Set(params.days.map((d) => Math.round(rfNum(d))).filter((d) => d >= 0 && d <= 6))].sort()
      : allDays;
    const reminder = {
      enabled: params.enabled !== false,
      hour: hh, minute: mm, days,
      label: rfClean(params.label, 120) || "Time to journal",
      updatedAt: rfNow(),
    };
    s.reminders.set(rfAid(ctx), reminder);
    saveRfState();
    return { ok: true, result: { reminder } };
  });

  registerLensAction("reflection", "reminder-status", (ctx, _a, _params = {}) => {
  try {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    rfExtraState(s);
    const userId = rfAid(ctx);
    const reminder = s.reminders.get(userId) || null;
    const dates = new Set((s.entries.get(userId) || []).map((e) => e.date));
    const wroteToday = dates.has(rfDay(rfNow()));
    let nextDue = null;
    if (reminder && reminder.enabled) {
      const now = new Date();
      for (let offset = 0; offset < 8; offset++) {
        const cand = new Date(now.getTime() + offset * RF_DAY);
        if (!reminder.days.includes(cand.getUTCDay())) continue;
        cand.setUTCHours(reminder.hour, reminder.minute, 0, 0);
        if (cand.getTime() > now.getTime()) { nextDue = cand.toISOString(); break; }
      }
    }
    return {
      ok: true,
      result: {
        reminder, wroteToday, nextDue,
        dueNow: !!(reminder && reminder.enabled && !wroteToday &&
          reminder.days.includes(new Date().getUTCDay()) &&
          (new Date().getUTCHours() * 60 + new Date().getUTCMinutes()) >= reminder.hour * 60 + reminder.minute),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── End-to-end encryption (private journal at rest) ─────────────────
  registerLensAction("reflection", "entry-encrypt", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const entry = rfEntryById(s, userId, params.entryId);
    if (!entry) return { ok: false, error: "entry not found" };
    const key = rfClean(params.key, 256);
    if (key.length < 4) return { ok: false, error: "encryption key must be at least 4 characters" };
    if (entry.encrypted) return { ok: false, error: "entry is already encrypted" };
    entry.cipherText = rfB64encode(rfCipher(entry.text, key));
    entry.cipherTitle = entry.title ? rfB64encode(rfCipher(entry.title, key)) : null;
    entry.keyFingerprint = rfKeyFingerprint(key);
    entry.text = "[encrypted]";
    entry.title = entry.title ? "[encrypted]" : null;
    entry.encrypted = true;
    entry.updatedAt = rfNow();
    saveRfState();
    return { ok: true, result: { entryId: entry.id, encrypted: true } };
  });

  registerLensAction("reflection", "entry-decrypt", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const entry = rfEntryById(s, userId, params.entryId);
    if (!entry) return { ok: false, error: "entry not found" };
    if (!entry.encrypted) return { ok: false, error: "entry is not encrypted" };
    const key = rfClean(params.key, 256);
    if (!key) return { ok: false, error: "encryption key required" };
    // The XOR cipher is its own inverse, so a content round-trip cannot
    // detect a wrong key — the stored salted fingerprint can.
    if (entry.keyFingerprint && rfKeyFingerprint(key) !== entry.keyFingerprint) {
      return { ok: false, error: "incorrect key" };
    }
    const plain = rfCipher(rfB64decode(entry.cipherText), key);
    if (params.persist) {
      entry.text = plain;
      entry.title = entry.cipherTitle ? rfCipher(rfB64decode(entry.cipherTitle), key) : null;
      entry.encrypted = false;
      delete entry.cipherText;
      delete entry.cipherTitle;
      delete entry.keyFingerprint;
      entry.updatedAt = rfNow();
      saveRfState();
      return { ok: true, result: { entryId: entry.id, encrypted: false, text: plain } };
    }
    return {
      ok: true,
      result: {
        entryId: entry.id, encrypted: true,
        text: plain,
        title: entry.cipherTitle ? rfCipher(rfB64decode(entry.cipherTitle), key) : null,
      },
    };
  });

  // ── Timeline / map view ─────────────────────────────────────────────
  registerLensAction("reflection", "entry-timeline", (ctx, _a, params = {}) => {
  try {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let entries = [...(s.entries.get(rfAid(ctx)) || [])];
    if (params.journalId) entries = entries.filter((e) => e.journalId === String(params.journalId));
    if (params.days) {
      const cutoff = new Date(Date.now() - Math.max(1, rfNum(params.days, 365)) * RF_DAY).toISOString().slice(0, 10);
      entries = entries.filter((e) => e.date >= cutoff);
    }
    const scored = { great: 5, good: 4, okay: 3, low: 2, rough: 1 };
    const events = entries
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((e) => ({
        id: e.id,
        label: e.title || (e.text || "").slice(0, 48) || "Entry",
        time: e.at,
        date: e.date,
        mood: e.mood,
        moodScore: e.mood ? scored[e.mood] : null,
        wordCount: rfWords(e.encrypted ? "" : e.text),
        encrypted: !!e.encrypted,
        tone: e.mood === "great" || e.mood === "good" ? "good"
          : e.mood === "rough" || e.mood === "low" ? "bad" : "default",
      }));
    // Bucket by month for a compact density curve.
    const byMonth = {};
    for (const e of events) {
      const m = e.date.slice(0, 7);
      byMonth[m] = (byMonth[m] || 0) + 1;
    }
    return {
      ok: true,
      result: {
        events, count: events.length,
        span: events.length ? { from: events[0].date, to: events[events.length - 1].date } : null,
        monthBuckets: Object.entries(byMonth).map(([month, count]) => ({ month, count })),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("reflection", "entry-map", (ctx, _a, _params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const placed = (s.entries.get(rfAid(ctx)) || [])
      .filter((e) => e.geo && Number.isFinite(e.geo.lat) && Number.isFinite(e.geo.lon))
      .map((e) => ({
        id: e.id,
        lat: e.geo.lat, lon: e.geo.lon,
        label: e.location || e.title || e.date,
        date: e.date,
        mood: e.mood,
        tone: e.mood === "great" || e.mood === "good" ? "good"
          : e.mood === "rough" || e.mood === "low" ? "bad" : "info",
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
    // Group identical coordinates into named places.
    const places = {};
    for (const m of placed) {
      const key = m.label;
      if (!places[key]) places[key] = { name: key, count: 0, lat: m.lat, lon: m.lon };
      places[key].count += 1;
    }
    return {
      ok: true,
      result: {
        markers: placed,
        count: placed.length,
        places: Object.values(places).sort((a, b) => b.count - a.count),
      },
    };
  });

  // ── Audio / voice journaling ────────────────────────────────────────
  // Records a spoken-entry: stores the audio descriptor and a caller-
  // supplied transcript (real STT happens client-side or via the brain).
  registerLensAction("reflection", "voice-entry-create", async (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const audioUrl = rfClean(params.audioUrl, 8_000_000);
    if (!audioUrl) return { ok: false, error: "audioUrl (recording) required" };
    let transcript = rfClean(params.transcript, 20000);
    let composer = transcript ? "client" : "none";
    // Optional brain-assisted cleanup of a rough transcript.
    if (transcript && params.cleanup && ctx?.llm?.chat) {
      try {
        const out = await ctx.llm.chat({
          system: "Clean up this voice-journal transcript: fix obvious punctuation and capitalization only. Do not add, remove, or invent any content.",
          messages: [{ role: "user", content: transcript.slice(0, 4000) }],
        });
        const cleaned = rfClean(String(out?.content || out || ""), 20000);
        if (cleaned) { transcript = cleaned; composer = "brain"; }
      } catch (_e) { /* keep raw transcript */ }
    }
    let journalId = params.journalId ? String(params.journalId) : null;
    if (journalId && !(s.journals.get(userId) || []).some((j) => j.id === journalId)) {
      journalId = null;
    }
    const entry = {
      id: rfId("ent"), journalId,
      text: transcript || "[voice entry — no transcript]",
      title: rfClean(params.title, 140) || null,
      mood: RF_MOODS.includes(String(params.mood).toLowerCase()) ? String(params.mood).toLowerCase() : null,
      tags: ["voice"],
      location: null, weather: null, photoCount: 0, promptText: null,
      kind: "voice",
      durationSec: Math.max(0, Math.round(rfNum(params.durationSec))),
      media: [{ id: rfId("med"), type: "audio", url: null, dataUrl: audioUrl,
        mime: rfClean(params.mime, 80) || "audio/webm",
        bytes: Math.max(0, Math.round(rfNum(params.bytes))),
        caption: "Voice recording", addedAt: rfNow() }],
      date: rfDay(params.date) || rfDay(rfNow()),
      at: rfNow(), updatedAt: rfNow(),
    };
    rfListB(s.entries, userId).push(entry);
    saveRfState();
    return { ok: true, result: { entry: rfEntryView(entry), transcriptComposer: composer } };
  });

  // ── Year in review / export ─────────────────────────────────────────
  registerLensAction("reflection", "year-in-review", (ctx, _a, params = {}) => {
  try {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const now = new Date();
    const year = Math.round(rfNum(params.year, now.getUTCFullYear()));
    const yEntries = (s.entries.get(rfAid(ctx)) || [])
      .filter((e) => e.date.startsWith(String(year)))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (yEntries.length === 0) {
      return { ok: true, result: { year, entryCount: 0, message: "No entries this year yet." } };
    }
    const scored = { great: 5, good: 4, okay: 3, low: 2, rough: 1 };
    const byMonth = {};
    const byMood = {};
    for (const m of RF_MOODS) byMood[m] = 0;
    let totalWords = 0, moodSum = 0, moodN = 0, photoCount = 0;
    const tagCounts = {};
    for (const e of yEntries) {
      const mo = e.date.slice(5, 7);
      byMonth[mo] = (byMonth[mo] || 0) + 1;
      totalWords += rfWords(e.encrypted ? "" : e.text);
      photoCount += (e.media || []).filter((m) => m.type === "image").length;
      if (e.mood) { byMood[e.mood] += 1; moodSum += scored[e.mood]; moodN += 1; }
      for (const t of e.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
    const longest = yEntries.reduce((best, e) =>
      rfWords(e.encrypted ? "" : e.text) > rfWords(best.encrypted ? "" : best.text) ? e : best, yEntries[0]);
    const busiest = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];
    const MONTHS = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    return {
      ok: true,
      result: {
        year,
        entryCount: yEntries.length,
        totalWords,
        avgWordsPerEntry: Math.round(totalWords / yEntries.length),
        daysJournaled: new Set(yEntries.map((e) => e.date)).size,
        photoCount,
        longestStreak: rfLongestStreak(yEntries.map((e) => e.date)),
        moodAverage: moodN ? Math.round((moodSum / moodN) * 100) / 100 : null,
        moodDistribution: byMood,
        byMonth: MONTHS.map((name, i) => ({ month: name, count: byMonth[String(i + 1).padStart(2, "0")] || 0 })),
        busiestMonth: busiest ? MONTHS[Number(busiest[0]) - 1] : null,
        topTags: Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
          .map(([tag, count]) => ({ tag, count })),
        longestEntry: { id: longest.id, date: longest.date, title: longest.title,
          wordCount: rfWords(longest.encrypted ? "" : longest.text) },
        firstEntryDate: yEntries[0].date,
        lastEntryDate: yEntries[yEntries.length - 1].date,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("reflection", "journal-export", (ctx, _a, params = {}) => {
  try {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    rfExtraState(s);
    const userId = rfAid(ctx);
    let entries = [...(s.entries.get(userId) || [])];
    if (params.journalId) entries = entries.filter((e) => e.journalId === String(params.journalId));
    if (params.year) entries = entries.filter((e) => e.date.startsWith(String(params.year)));
    entries.sort((a, b) => a.at.localeCompare(b.at));
    const format = ["markdown", "json", "text"].includes(String(params.format)) ? String(params.format) : "markdown";
    const journals = s.journals.get(userId) || [];
    const journalName = (id) => journals.find((j) => j.id === id)?.name || "Unfiled";

    let document = "";
    if (format === "json") {
      document = JSON.stringify({
        exportedAt: rfNow(), entryCount: entries.length,
        entries: entries.map((e) => ({
          date: e.date, journal: journalName(e.journalId), title: e.title,
          text: e.encrypted ? "[encrypted]" : e.text, mood: e.mood, tags: e.tags,
          location: e.location, weather: e.weather, photoCount: e.photoCount,
        })),
      }, null, 2);
    } else if (format === "text") {
      document = entries.map((e) =>
        `${e.date}${e.title ? " — " + e.title : ""}\n${e.encrypted ? "[encrypted]" : e.text}\n`).join("\n---\n\n");
    } else {
      document = `# Journal Export\n\n_${entries.length} entries · exported ${rfDay(rfNow())}_\n\n`;
      let curMonth = "";
      for (const e of entries) {
        const mo = e.date.slice(0, 7);
        if (mo !== curMonth) { document += `\n## ${mo}\n\n`; curMonth = mo; }
        document += `### ${e.date}${e.title ? " — " + e.title : ""}\n\n`;
        const meta = [e.mood && `mood: ${e.mood}`, e.location, e.weather,
          e.tags?.length && e.tags.map((t) => "#" + t).join(" ")].filter(Boolean);
        if (meta.length) document += `_${meta.join(" · ")}_\n\n`;
        document += `${e.encrypted ? "_[encrypted entry]_" : e.text}\n\n`;
      }
    }
    const record = {
      id: rfId("exp"), format, entryCount: entries.length,
      bytes: Buffer.byteLength(document, "utf8"), createdAt: rfNow(),
    };
    const log = rfListB(s.exports, userId);
    log.unshift(record);
    if (log.length > 20) log.length = 20;
    saveRfState();
    return {
      ok: true,
      result: {
        format, entryCount: entries.length,
        document,
        filename: `journal-export-${rfDay(rfNow())}.${format === "json" ? "json" : format === "text" ? "txt" : "md"}`,
        export: record,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("reflection", "export-history", (ctx, _a, _params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    rfExtraState(s);
    const history = s.exports.get(rfAid(ctx)) || [];
    return { ok: true, result: { exports: history, count: history.length } };
  });

  // ── Multi-device sync indicator + offline drafts ────────────────────
  registerLensAction("reflection", "device-checkin", (ctx, _a, params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    rfExtraState(s);
    const userId = rfAid(ctx);
    const deviceId = rfClean(params.deviceId, 64);
    if (!deviceId) return { ok: false, error: "deviceId required" };
    const log = s.deviceLog.get(userId) || {};
    const draftCount = Math.max(0, Math.round(rfNum(params.pendingDrafts)));
    log[deviceId] = {
      deviceId,
      label: rfClean(params.label, 80) || deviceId,
      platform: rfClean(params.platform, 40) || "unknown",
      lastSeen: rfNow(),
      pendingDrafts: draftCount,
    };
    s.deviceLog.set(userId, log);
    saveRfState();
    return { ok: true, result: { device: log[deviceId], deviceCount: Object.keys(log).length } };
  });

  registerLensAction("reflection", "sync-status", (ctx, _a, _params = {}) => {
    const s = getRfState(); if (!s) return { ok: false, error: "STATE unavailable" };
    rfExtraState(s);
    const userId = rfAid(ctx);
    const log = s.deviceLog.get(userId) || {};
    const devices = Object.values(log).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    const now = Date.now();
    const online = devices.filter((d) => now - Date.parse(d.lastSeen) < 5 * 60 * 1000);
    const pendingDrafts = devices.reduce((a, d) => a + (d.pendingDrafts || 0), 0);
    return {
      ok: true,
      result: {
        devices: devices.map((d) => ({
          ...d,
          online: now - Date.parse(d.lastSeen) < 5 * 60 * 1000,
        })),
        deviceCount: devices.length,
        onlineCount: online.length,
        pendingDrafts,
        synced: pendingDrafts === 0,
        lastSync: devices[0]?.lastSeen || null,
      },
    };
  });
}
