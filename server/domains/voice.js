// server/domains/voice.js
// Domain actions for voice: transcript analysis, speaker diarization,
// sentiment scoring, and keyword spotting.

export default function registerVoiceActions(registerLensAction) {
  registerLensAction("voice", "transcriptAnalyze", (ctx, artifact, _params) => {
    const text = artifact.data?.transcript || artifact.data?.text || "";
    if (!text.trim()) return { ok: true, result: { message: "Provide a transcript text to analyze." } };
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const sentenceCount = sentences.length;
    const durationMinutes = parseFloat(artifact.data?.durationMinutes) || null;
    const speakingRate = durationMinutes ? Math.round(wordCount / durationMinutes) : null;
    const fillerPatterns = { um: /\bum+\b/gi, uh: /\buh+\b/gi, like: /\blike\b/gi, "you know": /\byou know\b/gi, basically: /\bbasically\b/gi, actually: /\bactually\b/gi, "sort of": /\bsort of\b/gi, "kind of": /\bkind of\b/gi };
    const fillerCounts = {};
    let totalFillers = 0;
    for (const [filler, pattern] of Object.entries(fillerPatterns)) {
      const matches = text.match(pattern);
      const count = matches ? matches.length : 0;
      if (count > 0) fillerCounts[filler] = count;
      totalFillers += count;
    }
    const fillerRate = wordCount > 0 ? Math.round((totalFillers / wordCount) * 10000) / 100 : 0;
    const avgWordsPerSentence = sentenceCount > 0 ? Math.round((wordCount / sentenceCount) * 10) / 10 : 0;
    const longSentences = sentences.filter(s => s.trim().split(/\s+/).length > 25).length;
    const shortSentences = sentences.filter(s => { const wc = s.trim().split(/\s+/).length; return wc > 0 && wc <= 8; }).length;
    const avgWordLength = wordCount > 0 ? Math.round((words.reduce((s, w) => s + w.replace(/[^a-zA-Z]/g, "").length, 0) / wordCount) * 10) / 10 : 0;
    let complexityRating = "simple";
    if (avgWordsPerSentence > 20 && avgWordLength > 5) complexityRating = "complex";
    else if (avgWordsPerSentence > 14 || avgWordLength > 4.5) complexityRating = "moderate";
    const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-z']/g, "")).filter(w => w.length > 0));
    const vocabularyRichness = wordCount > 0 ? Math.round((uniqueWords.size / wordCount) * 100) : 0;
    return { ok: true, result: { wordCount, sentenceCount, avgWordsPerSentence, avgWordLength, speakingRate: speakingRate ? `${speakingRate} words/min` : "Provide durationMinutes to calculate", fillerWords: fillerCounts, totalFillers, fillerRate: `${fillerRate}%`, longSentences, shortSentences, complexityRating, uniqueWordCount: uniqueWords.size, vocabularyRichness: `${vocabularyRichness}%` } };
  });

  registerLensAction("voice", "speakerDiarize", (ctx, artifact, _params) => {
    const segments = artifact.data?.segments || [];
    const transcript = artifact.data?.transcript || "";
    if (segments.length === 0 && !transcript.trim()) return { ok: true, result: { message: "Provide segments (array of {speaker, text, startTime, endTime}) or a tagged transcript." } };
    const parsed = segments;
    if (parsed.length === 0 && transcript) {
      const tagPattern = /\[?(Speaker\s*\w+|SPEAKER[\s_]*\w+)\]?:\s*(.*?)(?=\[?(?:Speaker\s*\w+|SPEAKER[\s_]*\w+)\]?:|$)/gis;
      let match;
      while ((match = tagPattern.exec(transcript)) !== null) {
        parsed.push({ speaker: match[1].trim(), text: match[2].trim() });
      }
      if (parsed.length === 0) {
        parsed.push({ speaker: "Unknown", text: transcript.trim() });
      }
    }
    const speakerStats = {};
    let totalWords = 0;
    let totalDuration = 0;
    for (const seg of parsed) {
      const speaker = seg.speaker || "Unknown";
      const text = seg.text || "";
      const wc = text.split(/\s+/).filter(w => w.length > 0).length;
      const start = parseFloat(seg.startTime) || 0;
      const end = parseFloat(seg.endTime) || 0;
      const duration = end > start ? end - start : 0;
      if (!speakerStats[speaker]) {
        speakerStats[speaker] = { segmentCount: 0, wordCount: 0, talkTimeSeconds: 0, longestSegmentWords: 0, shortestSegmentWords: Infinity };
      }
      speakerStats[speaker].segmentCount += 1;
      speakerStats[speaker].wordCount += wc;
      speakerStats[speaker].talkTimeSeconds += duration;
      if (wc > speakerStats[speaker].longestSegmentWords) speakerStats[speaker].longestSegmentWords = wc;
      if (wc < speakerStats[speaker].shortestSegmentWords) speakerStats[speaker].shortestSegmentWords = wc;
      totalWords += wc;
      totalDuration += duration;
    }
    const speakers = Object.entries(speakerStats).map(([name, stats]) => {
      if (stats.shortestSegmentWords === Infinity) stats.shortestSegmentWords = 0;
      return {
        speaker: name,
        segmentCount: stats.segmentCount,
        wordCount: stats.wordCount,
        wordShare: totalWords > 0 ? Math.round((stats.wordCount / totalWords) * 10000) / 100 : 0,
        talkTimeSeconds: Math.round(stats.talkTimeSeconds * 10) / 10,
        talkTimeShare: totalDuration > 0 ? Math.round((stats.talkTimeSeconds / totalDuration) * 10000) / 100 : 0,
        avgWordsPerSegment: stats.segmentCount > 0 ? Math.round((stats.wordCount / stats.segmentCount) * 10) / 10 : 0,
        longestSegmentWords: stats.longestSegmentWords,
        shortestSegmentWords: stats.shortestSegmentWords,
      };
    }).sort((a, b) => b.wordCount - a.wordCount);
    const dominantSpeaker = speakers[0]?.speaker || "N/A";
    const turnCount = parsed.length;
    return { ok: true, result: { speakerCount: speakers.length, totalSegments: turnCount, totalWords, totalDurationSeconds: Math.round(totalDuration * 10) / 10, speakers, dominantSpeaker, balanceRatio: speakers.length >= 2 ? Math.round((speakers[speakers.length - 1].wordCount / speakers[0].wordCount) * 100) : 100 } };
  });

  registerLensAction("voice", "sentimentScore", (ctx, artifact, _params) => {
    const segments = artifact.data?.segments || [];
    const transcript = artifact.data?.transcript || artifact.data?.text || "";
    if (segments.length === 0 && !transcript.trim()) return { ok: true, result: { message: "Provide a transcript or segments to score sentiment." } };
    const positiveWords = new Set(["good", "great", "excellent", "amazing", "wonderful", "fantastic", "love", "happy", "glad", "pleased", "awesome", "perfect", "beautiful", "brilliant", "enjoy", "success", "best", "better", "exciting", "positive", "agree", "right", "thank", "thanks", "helpful", "kind", "nice", "impressive", "outstanding", "remarkable", "superb", "terrific", "delighted", "satisfied", "thrilled", "confident", "optimistic", "fortunate", "grateful"]);
    const negativeWords = new Set(["bad", "terrible", "awful", "horrible", "hate", "angry", "sad", "upset", "disappointed", "worst", "worse", "poor", "fail", "failure", "wrong", "problem", "issue", "difficult", "hard", "never", "unfortunately", "disagree", "concern", "worried", "annoyed", "frustrated", "confused", "ugly", "boring", "painful", "miserable", "dreadful", "unhappy", "regret", "sorry", "fear", "anxious", "stress", "doubt"]);
    const intensifiers = new Set(["very", "really", "extremely", "incredibly", "absolutely", "totally", "completely", "so", "quite"]);
    const negators = new Set(["not", "no", "never", "neither", "nobody", "nothing", "nowhere", "nor", "cannot", "can't", "don't", "doesn't", "didn't", "won't", "wouldn't", "shouldn't", "isn't", "aren't", "wasn't", "weren't"]);
    const analyzeText = (text) => {
      const words = text.toLowerCase().replace(/[^a-z'\s]/g, " ").split(/\s+/).filter(w => w.length > 0);
      let posCount = 0, negCount = 0;
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const prevWord = i > 0 ? words[i - 1] : "";
        const isNegated = negators.has(prevWord);
        const hasIntensifier = i > 0 && intensifiers.has(prevWord);
        const boost = hasIntensifier ? 1.5 : 1;
        if (positiveWords.has(w)) {
          if (isNegated) negCount += boost;
          else posCount += boost;
        } else if (negativeWords.has(w)) {
          if (isNegated) posCount += boost;
          else negCount += boost;
        }
      }
      const total = posCount + negCount;
      const score = total > 0 ? Math.round(((posCount - negCount) / total) * 100) / 100 : 0;
      return { posCount: Math.round(posCount * 10) / 10, negCount: Math.round(negCount * 10) / 10, score, label: score > 0.25 ? "positive" : score < -0.25 ? "negative" : "neutral" };
    };
    let segmentResults;
    if (segments.length > 0) {
      segmentResults = segments.map((seg, i) => {
        const analysis = analyzeText(seg.text || "");
        return { index: i, speaker: seg.speaker || "Unknown", text: (seg.text || "").substring(0, 120), ...analysis };
      });
    } else {
      const sentenceSplits = transcript.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
      segmentResults = sentenceSplits.map((s, i) => {
        const analysis = analyzeText(s);
        return { index: i, text: s.substring(0, 120), ...analysis };
      });
    }
    const overallPos = segmentResults.reduce((s, r) => s + r.posCount, 0);
    const overallNeg = segmentResults.reduce((s, r) => s + r.negCount, 0);
    const overallTotal = overallPos + overallNeg;
    const overallScore = overallTotal > 0 ? Math.round(((overallPos - overallNeg) / overallTotal) * 100) / 100 : 0;
    const positiveSegments = segmentResults.filter(r => r.label === "positive").length;
    const negativeSegments = segmentResults.filter(r => r.label === "negative").length;
    const neutralSegments = segmentResults.filter(r => r.label === "neutral").length;
    return { ok: true, result: { overallScore, overallLabel: overallScore > 0.25 ? "positive" : overallScore < -0.25 ? "negative" : "neutral", totalPositiveSignals: Math.round(overallPos * 10) / 10, totalNegativeSignals: Math.round(overallNeg * 10) / 10, segmentBreakdown: { positive: positiveSegments, negative: negativeSegments, neutral: neutralSegments, total: segmentResults.length }, segments: segmentResults, sentimentArc: segmentResults.length > 2 ? (segmentResults[segmentResults.length - 1].score > segmentResults[0].score ? "improving" : segmentResults[segmentResults.length - 1].score < segmentResults[0].score ? "declining" : "stable") : "insufficient-data" } };
  });

  registerLensAction("voice", "keywordSpot", (ctx, artifact, _params) => {
    const text = artifact.data?.transcript || artifact.data?.text || "";
    const keywords = artifact.data?.keywords || [];
    if (!text.trim()) return { ok: true, result: { message: "Provide a transcript to search for keywords." } };
    if (keywords.length === 0) return { ok: true, result: { message: "Provide a keywords array to spot in the transcript." } };
    const contextRadius = parseInt(artifact.data?.contextRadius) || 40;
    const results = keywords.map(kw => {
      const pattern = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      const occurrences = [];
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const start = Math.max(0, match.index - contextRadius);
        const end = Math.min(text.length, match.index + match[0].length + contextRadius);
        const snippet = (start > 0 ? "..." : "") + text.slice(start, end).replace(/\n/g, " ") + (end < text.length ? "..." : "");
        occurrences.push({ position: match.index, snippet: snippet.trim() });
      }
      return { keyword: kw, count: occurrences.length, occurrences };
    }).sort((a, b) => b.count - a.count);
    const totalOccurrences = results.reduce((s, r) => s + r.count, 0);
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    const density = wordCount > 0 ? Math.round((totalOccurrences / wordCount) * 10000) / 100 : 0;
    const notFound = results.filter(r => r.count === 0).map(r => r.keyword);
    const topKeywords = results.filter(r => r.count > 0).slice(0, 10);
    return { ok: true, result: { keywordsSearched: keywords.length, totalOccurrences, keywordDensity: `${density}%`, wordCount, topKeywords, notFound, distribution: results.filter(r => r.count > 0).map(r => ({ keyword: r.keyword, count: r.count, frequency: `${Math.round((r.count / wordCount) * 10000) / 100}%` })) } };
  });

  // ─── Otter.ai-shape recording / transcript substrate (per-user) ──────

  function getVoiceState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.voiceLens) STATE.voiceLens = {};
    if (!(STATE.voiceLens.recordings instanceof Map)) STATE.voiceLens.recordings = new Map(); // userId -> Array
    return STATE.voiceLens;
  }
  function saveVoice() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const vcId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const vcNow = () => new Date().toISOString();
  const vcActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const vcClean = (v, max = 4000) => String(v == null ? "" : v).trim().slice(0, max);
  const vcNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const vcList = (s, userId) => { if (!s.recordings.has(userId)) s.recordings.set(userId, []); return s.recordings.get(userId); };
  const ACTION_CUES = ["will ", "need to", "should ", "let's ", "i'll ", "we'll ", "action:", "todo", "follow up", "follow-up", "next step", "by tomorrow", "by friday", "make sure"];

  function durFromSegments(segments) {
    if (segments.length === 0) return 0;
    const last = segments[segments.length - 1];
    return Math.round(last.startSec + 5);
  }

  registerLensAction("voice", "recording-create", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = vcClean(params.title, 200);
    if (!title) return { ok: false, error: "recording title required" };
    const segments = [];
    if (Array.isArray(params.segments)) {
      let t = 0;
      for (const seg of params.segments) {
        const text = vcClean(seg.text, 4000);
        if (!text) continue;
        segments.push({
          id: vcId("sg"),
          speaker: vcClean(seg.speaker, 60) || "Speaker 1",
          text,
          startSec: Number.isFinite(Number(seg.startSec)) ? Math.max(0, Math.round(Number(seg.startSec))) : t,
          highlighted: false,
        });
        t += 8;
      }
    } else if (params.transcript) {
      // Split a raw transcript into pseudo-segments by sentence.
      const sentences = vcClean(params.transcript, 40000).split(/(?<=[.!?])\s+/).filter(Boolean);
      let t = 0;
      for (const sent of sentences) {
        segments.push({ id: vcId("sg"), speaker: "Speaker 1", text: sent.slice(0, 4000), startSec: t, highlighted: false });
        t += 8;
      }
    }
    const recording = {
      id: vcId("rec"),
      title,
      folder: vcClean(params.folder, 80) || "All recordings",
      durationSec: params.durationSec != null ? Math.max(0, Math.round(vcNum(params.durationSec))) : durFromSegments(segments),
      segments,
      summary: null,
      createdAt: vcNow(),
    };
    vcList(s, vcActor(ctx)).push(recording);
    saveVoice();
    return { ok: true, result: { recording } };
  });

  registerLensAction("voice", "recording-list", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let recs = [...vcList(s, vcActor(ctx))];
    if (params.folder) recs = recs.filter((r) => r.folder === params.folder);
    recs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const recordings = recs.map((r) => ({
      id: r.id, title: r.title, folder: r.folder, durationSec: r.durationSec,
      segmentCount: r.segments.length, speakerCount: new Set(r.segments.map((g) => g.speaker)).size,
      highlightCount: r.segments.filter((g) => g.highlighted).length,
      hasSummary: !!r.summary, createdAt: r.createdAt,
    }));
    return { ok: true, result: { recordings, count: recordings.length } };
  });

  registerLensAction("voice", "recording-detail", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rec = vcList(s, vcActor(ctx)).find((r) => r.id === params.id);
    if (!rec) return { ok: false, error: "recording not found" };
    return { ok: true, result: { recording: rec } };
  });

  registerLensAction("voice", "recording-rename", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rec = vcList(s, vcActor(ctx)).find((r) => r.id === params.id);
    if (!rec) return { ok: false, error: "recording not found" };
    const title = vcClean(params.title, 200);
    if (!title) return { ok: false, error: "title required" };
    rec.title = title;
    if (params.folder != null) rec.folder = vcClean(params.folder, 80) || rec.folder;
    saveVoice();
    return { ok: true, result: { recording: rec } };
  });

  registerLensAction("voice", "recording-delete", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = vcList(s, vcActor(ctx));
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "recording not found" };
    arr.splice(i, 1);
    saveVoice();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("voice", "segment-edit", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rec = vcList(s, vcActor(ctx)).find((r) => r.id === params.recordingId);
    if (!rec) return { ok: false, error: "recording not found" };
    const seg = rec.segments.find((g) => g.id === params.segmentId);
    if (!seg) return { ok: false, error: "segment not found" };
    if (params.text != null) seg.text = vcClean(params.text, 4000) || seg.text;
    if (params.speaker != null) seg.speaker = vcClean(params.speaker, 60) || seg.speaker;
    rec.summary = null; // transcript changed — invalidate summary
    saveVoice();
    return { ok: true, result: { segment: seg } };
  });

  registerLensAction("voice", "highlight-toggle", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rec = vcList(s, vcActor(ctx)).find((r) => r.id === params.recordingId);
    if (!rec) return { ok: false, error: "recording not found" };
    const seg = rec.segments.find((g) => g.id === params.segmentId);
    if (!seg) return { ok: false, error: "segment not found" };
    seg.highlighted = !seg.highlighted;
    saveVoice();
    return { ok: true, result: { segmentId: seg.id, highlighted: seg.highlighted } };
  });

  // recording-summary — deterministic transcript summary + action items.
  registerLensAction("voice", "recording-summary", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rec = vcList(s, vcActor(ctx)).find((r) => r.id === params.id);
    if (!rec) return { ok: false, error: "recording not found" };
    if (rec.segments.length === 0) return { ok: false, error: "recording has no transcript" };
    // Highlights are explicit summary points; otherwise pick the longest segments.
    const highlighted = rec.segments.filter((g) => g.highlighted);
    const keyPoints = (highlighted.length > 0
      ? highlighted
      : [...rec.segments].sort((a, b) => b.text.length - a.text.length).slice(0, 5).sort((a, b) => a.startSec - b.startSec)
    ).map((g) => g.text.slice(0, 200));
    const actionItems = [];
    for (const g of rec.segments) {
      const low = g.text.toLowerCase();
      if (ACTION_CUES.some((c) => low.includes(c))) {
        actionItems.push({ text: g.text.slice(0, 200), speaker: g.speaker });
      }
    }
    const summary = {
      keyPoints,
      actionItems: actionItems.slice(0, 12),
      speakers: [...new Set(rec.segments.map((g) => g.speaker))],
      composedAt: vcNow(),
    };
    rec.summary = summary;
    saveVoice();
    return { ok: true, result: { summary } };
  });

  registerLensAction("voice", "transcript-search", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = vcClean(params.query, 100).toLowerCase();
    if (!q) return { ok: false, error: "query required" };
    const hits = [];
    for (const rec of vcList(s, vcActor(ctx))) {
      for (const g of rec.segments) {
        if (g.text.toLowerCase().includes(q)) {
          hits.push({ recordingId: rec.id, recordingTitle: rec.title, segmentId: g.id, speaker: g.speaker, text: g.text.slice(0, 200), startSec: g.startSec });
        }
      }
    }
    return { ok: true, result: { hits, count: hits.length } };
  });

  registerLensAction("voice", "voice-dashboard", (ctx, _a, _params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const recs = vcList(s, vcActor(ctx));
    const totalSec = recs.reduce((n, r) => n + r.durationSec, 0);
    return {
      ok: true,
      result: {
        recordings: recs.length,
        totalMinutes: Math.round(totalSec / 60),
        totalSegments: recs.reduce((n, r) => n + r.segments.length, 0),
        highlights: recs.reduce((n, r) => n + r.segments.filter((g) => g.highlighted).length, 0),
        summarized: recs.filter((r) => r.summary).length,
        folders: [...new Set(recs.map((r) => r.folder))].length,
      },
    };
  });
}
