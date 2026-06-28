// server/domains/voice.js
// Domain actions for voice: transcript analysis, speaker diarization,
// sentiment scoring, and keyword spotting.

import { cachedFetchJson } from "../lib/external-fetch.js";

export default function registerVoiceActions(registerLensAction) {
  registerLensAction("voice", "transcriptAnalyze", (ctx, artifact, _params) => {
  try {
    const text = artifact.data?.transcript || artifact.data?.text || "";
    if (typeof text !== "string") return { ok: false, error: "invalid_input", message: "transcript must be a string" };
    if (!text.trim()) return { ok: true, result: { message: "Provide a transcript text to analyze." } };
    // Fail-closed on a poisoned durationMinutes — a non-finite value
    // (NaN / Infinity / "1e999") must not slip through to the WPM divide.
    if (artifact.data?.durationMinutes != null && artifact.data?.durationMinutes !== "") {
      const dm = Number(artifact.data.durationMinutes);
      if (!Number.isFinite(dm) || dm < 0) return { ok: false, error: "invalid_input", message: "durationMinutes must be a finite non-negative number" };
    }
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  registerLensAction("voice", "speakerDiarize", (ctx, artifact, _params) => {
  try {
    const segments = Array.isArray(artifact.data?.segments) ? artifact.data.segments : [];
    const transcript = artifact.data?.transcript || "";
    if (typeof transcript !== "string") return { ok: false, error: "invalid_input", message: "transcript must be a string" };
    if (segments.length === 0 && !transcript.trim()) return { ok: true, result: { message: "Provide segments (array of {speaker, text, startTime, endTime}) or a tagged transcript." } };
    const parsed = [...segments];
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("voice", "sentimentScore", (ctx, artifact, _params) => {
  try {
    const segments = Array.isArray(artifact.data?.segments) ? artifact.data.segments : [];
    const transcript = artifact.data?.transcript || artifact.data?.text || "";
    if (typeof transcript !== "string") return { ok: false, error: "invalid_input", message: "transcript must be a string" };
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  registerLensAction("voice", "keywordSpot", (ctx, artifact, _params) => {
  try {
    const text = artifact.data?.transcript || artifact.data?.text || "";
    if (typeof text !== "string") return { ok: false, error: "invalid_input", message: "transcript must be a string" };
    const keywords = Array.isArray(artifact.data?.keywords) ? artifact.data.keywords : [];
    if (!text.trim()) return { ok: true, result: { message: "Provide a transcript to search for keywords." } };
    if (keywords.length === 0) return { ok: true, result: { message: "Provide a keywords array to spot in the transcript." } };
    // Fail-closed on a poisoned contextRadius — a non-finite value must not
    // silently fall back to the default; reject it explicitly.
    let contextRadius = 40;
    if (artifact.data?.contextRadius != null && artifact.data?.contextRadius !== "") {
      const cr = Number(artifact.data.contextRadius);
      if (!Number.isFinite(cr) || cr < 0) return { ok: false, error: "invalid_input", message: "contextRadius must be a finite non-negative number" };
      contextRadius = Math.round(cr);
    }
    const results = keywords.map(kw => {
      const pattern = new RegExp(`\\b${String(kw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  // ─── Otter.ai-shape recording / transcript substrate (per-user) ──────

  function getVoiceState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.voiceLens) STATE.voiceLens = {};
    if (!(STATE.voiceLens.recordings instanceof Map)) STATE.voiceLens.recordings = new Map(); // userId -> Array
    if (!(STATE.voiceLens.liveSessions instanceof Map)) STATE.voiceLens.liveSessions = new Map(); // userId -> Array
    if (!(STATE.voiceLens.meetings instanceof Map)) STATE.voiceLens.meetings = new Map(); // userId -> Array
    if (!(STATE.voiceLens.voicePrints instanceof Map)) STATE.voiceLens.voicePrints = new Map(); // userId -> Array
    if (!(STATE.voiceLens.shares instanceof Map)) STATE.voiceLens.shares = new Map(); // recordingId -> share record
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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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

  // ─── Live in-browser transcription substrate ─────────────────────────
  // The browser streams ASR words via SpeechRecognition; the backend
  // persists each interim/final word into a live session that can be
  // finalised into a regular recording.
  const liveList = (s, userId) => { if (!s.liveSessions.has(userId)) s.liveSessions.set(userId, []); return s.liveSessions.get(userId); };

  registerLensAction("voice", "live-start", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = vcClean(params.title, 200) || `Live session ${new Date().toLocaleString()}`;
    const session = {
      id: vcId("live"),
      title,
      language: vcClean(params.language, 16) || "en-US",
      status: "live",
      words: [],
      startedAt: vcNow(),
      finalizedAt: null,
      recordingId: null,
    };
    liveList(s, vcActor(ctx)).unshift(session);
    saveVoice();
    return { ok: true, result: { session } };
  });

  registerLensAction("voice", "live-append", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const session = liveList(s, vcActor(ctx)).find((g) => g.id === params.sessionId);
    if (!session) return { ok: false, error: "live session not found" };
    if (session.status !== "live") return { ok: false, error: "session already finalized" };
    const text = vcClean(params.text, 8000);
    if (!text) return { ok: false, error: "text required" };
    const word = {
      id: vcId("lw"),
      text,
      isFinal: params.isFinal !== false,
      speaker: vcClean(params.speaker, 60) || "Speaker 1",
      atSec: Number.isFinite(Number(params.atSec)) ? Math.max(0, Math.round(Number(params.atSec))) : 0,
      addedAt: vcNow(),
    };
    // Interim chunks replace the trailing interim word; finals append.
    const last = session.words[session.words.length - 1];
    if (!word.isFinal && last && !last.isFinal) session.words[session.words.length - 1] = word;
    else session.words.push(word);
    saveVoice();
    return { ok: true, result: { wordCount: session.words.length, accepted: word } };
  });

  registerLensAction("voice", "live-detail", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const session = liveList(s, vcActor(ctx)).find((g) => g.id === params.sessionId);
    if (!session) return { ok: false, error: "live session not found" };
    return { ok: true, result: { session } };
  });

  registerLensAction("voice", "live-list", (ctx, _a, _params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sessions = liveList(s, vcActor(ctx)).map((g) => ({
      id: g.id, title: g.title, language: g.language, status: g.status,
      wordCount: g.words.length, startedAt: g.startedAt, finalizedAt: g.finalizedAt, recordingId: g.recordingId,
    }));
    return { ok: true, result: { sessions, count: sessions.length } };
  });

  registerLensAction("voice", "live-finalize", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = vcActor(ctx);
    const session = liveList(s, userId).find((g) => g.id === params.sessionId);
    if (!session) return { ok: false, error: "live session not found" };
    if (session.status === "finalized") return { ok: false, error: "session already finalized" };
    const finals = session.words.filter((w) => w.isFinal);
    if (finals.length === 0) return { ok: false, error: "no final words to finalize" };
    // Group consecutive finals by speaker into transcript segments.
    const segments = [];
    let cur = null;
    for (const w of finals) {
      if (!cur || cur.speaker !== w.speaker) {
        if (cur) segments.push(cur);
        cur = { id: vcId("sg"), speaker: w.speaker, text: w.text, startSec: w.atSec, highlighted: false };
      } else {
        cur.text = `${cur.text} ${w.text}`.trim();
      }
    }
    if (cur) segments.push(cur);
    const recording = {
      id: vcId("rec"),
      title: session.title,
      folder: "Live sessions",
      durationSec: segments.length ? Math.round((segments[segments.length - 1].startSec || 0) + 8) : 0,
      summary: null,
      segments,
      createdAt: vcNow(),
    };
    vcList(s, userId).push(recording);
    session.status = "finalized";
    session.finalizedAt = vcNow();
    session.recordingId = recording.id;
    saveVoice();
    return { ok: true, result: { recording, sessionId: session.id } };
  });

  // ─── LLM-written meeting summary (opt-in) ────────────────────────────
  registerLensAction("voice", "recording-summary-llm", async (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rec = vcList(s, vcActor(ctx)).find((r) => r.id === params.id);
    if (!rec) return { ok: false, error: "recording not found" };
    if (rec.segments.length === 0) return { ok: false, error: "recording has no transcript" };
    if (!ctx?.llm?.chat) return { ok: false, error: "llm unavailable — use recording-summary for the deterministic summary" };
    const transcript = rec.segments
      .map((g) => `${g.speaker}: ${g.text}`)
      .join("\n")
      .slice(0, 12000);
    const sys = `You summarize meeting transcripts. Output ONLY JSON, no prose, no fences:
{"tldr":"2-3 sentence overview","keyPoints":["..."],"decisions":["..."],"actionItems":[{"task":"...","owner":"speaker name or Unassigned"}],"openQuestions":["..."],"topics":["..."]}
Only use information present in the transcript. Do not invent owners or decisions.`;
    try {
      const llmRes = await ctx.llm.chat({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Transcript:\n${transcript}\n\nSummarize.` },
        ],
        temperature: 0.2, maxTokens: 1600, slot: "subconscious",
      });
      const raw = String(llmRes?.text || llmRes?.content || "").trim();
      let parsed = null;
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      } catch (_e) { parsed = null; }
      if (!parsed || !parsed.tldr) return { ok: false, error: "could not parse llm summary", raw: raw.slice(0, 200) };
      const summary = {
        composer: "llm",
        tldr: vcClean(parsed.tldr, 1000),
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map((p) => vcClean(p, 300)).filter(Boolean).slice(0, 20) : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map((p) => vcClean(p, 300)).filter(Boolean).slice(0, 20) : [],
        actionItems: Array.isArray(parsed.actionItems)
          ? parsed.actionItems.map((a) => ({ task: vcClean(a?.task, 300), owner: vcClean(a?.owner, 80) || "Unassigned" })).filter((a) => a.task).slice(0, 20)
          : [],
        openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions.map((p) => vcClean(p, 300)).filter(Boolean).slice(0, 20) : [],
        topics: Array.isArray(parsed.topics) ? parsed.topics.map((p) => vcClean(p, 80)).filter(Boolean).slice(0, 20) : [],
        speakers: [...new Set(rec.segments.map((g) => g.speaker))],
        composedAt: vcNow(),
      };
      rec.summary = summary;
      saveVoice();
      return { ok: true, result: { summary } };
    } catch (e) {
      return { ok: false, error: e?.message || "llm summary failed" };
    }
  });

  // ─── Automatic speaker identification (voice-print) ──────────────────
  // A voice-print is a lightweight acoustic fingerprint of a known
  // speaker. The browser computes a feature vector (pitch / energy /
  // spectral-centroid means via the Web Audio API) and registers it
  // here; later segments are matched by nearest-neighbour distance.
  const printList = (s, userId) => { if (!s.voicePrints.has(userId)) s.voicePrints.set(userId, []); return s.voicePrints.get(userId); };
  const normVector = (v) => {
    if (!Array.isArray(v)) return null;
    const nums = v.map((x) => Number(x)).filter((x) => Number.isFinite(x));
    return nums.length >= 2 ? nums : null;
  };
  const vectorDistance = (a, b) => {
    const n = Math.min(a.length, b.length);
    let sum = 0;
    for (let i = 0; i < n; i++) { const d = a[i] - b[i]; sum += d * d; }
    return Math.sqrt(sum);
  };

  registerLensAction("voice", "voiceprint-enroll", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = vcClean(params.name, 80);
    if (!name) return { ok: false, error: "speaker name required" };
    const vector = normVector(params.vector);
    if (!vector) return { ok: false, error: "vector required (numeric array of >= 2 acoustic features)" };
    const userId = vcActor(ctx);
    const arr = printList(s, userId);
    const existing = arr.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      // Running mean — re-enrollment refines the print.
      const n = existing.sampleCount + 1;
      existing.vector = existing.vector.map((x, i) => (x * existing.sampleCount + (vector[i] ?? x)) / n);
      existing.sampleCount = n;
      existing.updatedAt = vcNow();
      saveVoice();
      return { ok: true, result: { voicePrint: existing, refined: true } };
    }
    const print = { id: vcId("vp"), name, vector, sampleCount: 1, createdAt: vcNow(), updatedAt: vcNow() };
    arr.push(print);
    saveVoice();
    return { ok: true, result: { voicePrint: print, refined: false } };
  });

  registerLensAction("voice", "voiceprint-list", (ctx, _a, _params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const prints = printList(s, vcActor(ctx)).map((p) => ({
      id: p.id, name: p.name, sampleCount: p.sampleCount, dimensions: p.vector.length, updatedAt: p.updatedAt,
    }));
    return { ok: true, result: { voicePrints: prints, count: prints.length } };
  });

  registerLensAction("voice", "voiceprint-delete", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = printList(s, vcActor(ctx));
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "voice print not found" };
    arr.splice(i, 1);
    saveVoice();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("voice", "voiceprint-identify", (ctx, _a, params = {}) => {
  try {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const vector = normVector(params.vector);
    if (!vector) return { ok: false, error: "vector required (numeric array of acoustic features)" };
    const prints = printList(s, vcActor(ctx));
    if (prints.length === 0) return { ok: true, result: { matched: false, reason: "no enrolled voice prints" } };
    const threshold = Number.isFinite(Number(params.threshold)) ? Number(params.threshold) : 0.35;
    const ranked = prints
      .map((p) => ({ id: p.id, name: p.name, distance: Math.round(vectorDistance(p.vector, vector) * 1000) / 1000 }))
      .sort((a, b) => a.distance - b.distance);
    const best = ranked[0];
    const matched = best.distance <= threshold;
    return {
      ok: true,
      result: {
        matched,
        speaker: matched ? best.name : null,
        confidence: matched ? Math.round((1 - best.distance / threshold) * 100) / 100 : 0,
        bestDistance: best.distance,
        candidates: ranked.slice(0, 5),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // Apply identified speakers across a recording's segments by matching
  // each segment's stored acoustic vector against enrolled voice prints.
  registerLensAction("voice", "recording-auto-label-speakers", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = vcActor(ctx);
    const rec = vcList(s, userId).find((r) => r.id === params.id);
    if (!rec) return { ok: false, error: "recording not found" };
    const prints = printList(s, userId);
    if (prints.length === 0) return { ok: false, error: "no enrolled voice prints — enroll speakers first" };
    const threshold = Number.isFinite(Number(params.threshold)) ? Number(params.threshold) : 0.35;
    let relabeled = 0;
    const unmatched = [];
    for (const seg of rec.segments) {
      const v = normVector(seg.vector);
      if (!v) { unmatched.push(seg.id); continue; }
      const ranked = prints
        .map((p) => ({ name: p.name, distance: vectorDistance(p.vector, v) }))
        .sort((a, b) => a.distance - b.distance);
      if (ranked[0] && ranked[0].distance <= threshold) {
        if (seg.speaker !== ranked[0].name) relabeled += 1;
        seg.speaker = ranked[0].name;
        seg.speakerSource = "voiceprint";
      } else {
        unmatched.push(seg.id);
      }
    }
    if (relabeled > 0) rec.summary = null;
    saveVoice();
    return { ok: true, result: { relabeled, unmatched: unmatched.length, totalSegments: rec.segments.length } };
  });

  // ─── Calendar / meeting-bot integration ──────────────────────────────
  // Schedule meetings; a "bot" join records the meeting by attaching a
  // live transcription session that finalises into a recording.
  const meetList = (s, userId) => { if (!s.meetings.has(userId)) s.meetings.set(userId, []); return s.meetings.get(userId); };

  registerLensAction("voice", "meeting-schedule", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = vcClean(params.title, 200);
    if (!title) return { ok: false, error: "meeting title required" };
    const startAt = vcClean(params.startAt, 40);
    if (!startAt || Number.isNaN(Date.parse(startAt))) return { ok: false, error: "valid startAt (ISO datetime) required" };
    const meeting = {
      id: vcId("mtg"),
      title,
      startAt: new Date(startAt).toISOString(),
      durationMin: Number.isFinite(Number(params.durationMin)) ? Math.max(5, Math.round(Number(params.durationMin))) : 30,
      meetingUrl: vcClean(params.meetingUrl, 500),
      attendees: Array.isArray(params.attendees) ? params.attendees.map((a) => vcClean(a, 120)).filter(Boolean).slice(0, 50) : [],
      autoRecord: params.autoRecord !== false,
      botStatus: "scheduled", // scheduled -> joined -> recorded
      liveSessionId: null,
      recordingId: null,
      createdAt: vcNow(),
    };
    meetList(s, vcActor(ctx)).unshift(meeting);
    saveVoice();
    return { ok: true, result: { meeting } };
  });

  registerLensAction("voice", "meeting-list", (ctx, _a, params = {}) => {
  try {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let meetings = [...meetList(s, vcActor(ctx))];
    if (params.upcoming) {
      const now = Date.now();
      meetings = meetings.filter((m) => Date.parse(m.startAt) >= now);
    }
    meetings.sort((a, b) => a.startAt.localeCompare(b.startAt));
    return { ok: true, result: { meetings, count: meetings.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("voice", "meeting-cancel", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = meetList(s, vcActor(ctx));
    const i = arr.findIndex((m) => m.id === params.id);
    if (i < 0) return { ok: false, error: "meeting not found" };
    arr.splice(i, 1);
    saveVoice();
    return { ok: true, result: { deleted: params.id } };
  });

  // The meeting bot "joins": it opens a live transcription session the
  // browser then streams ASR words into via voice.live-append.
  registerLensAction("voice", "meeting-bot-join", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = vcActor(ctx);
    const meeting = meetList(s, userId).find((m) => m.id === params.id);
    if (!meeting) return { ok: false, error: "meeting not found" };
    if (meeting.botStatus === "joined") return { ok: false, error: "bot already joined this meeting" };
    if (meeting.botStatus === "recorded") return { ok: false, error: "meeting already recorded" };
    const session = {
      id: vcId("live"),
      title: `${meeting.title} (meeting)`,
      language: vcClean(params.language, 16) || "en-US",
      status: "live",
      words: [],
      startedAt: vcNow(),
      finalizedAt: null,
      recordingId: null,
      meetingId: meeting.id,
    };
    liveList(s, userId).unshift(session);
    meeting.botStatus = "joined";
    meeting.liveSessionId = session.id;
    saveVoice();
    return { ok: true, result: { meeting, session } };
  });

  // The bot "leaves": finalise the attached live session into a recording.
  registerLensAction("voice", "meeting-bot-finalize", (ctx, _a, params = {}) => {
  try {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = vcActor(ctx);
    const meeting = meetList(s, userId).find((m) => m.id === params.id);
    if (!meeting) return { ok: false, error: "meeting not found" };
    if (meeting.botStatus !== "joined" || !meeting.liveSessionId) return { ok: false, error: "bot has not joined this meeting" };
    const session = liveList(s, userId).find((g) => g.id === meeting.liveSessionId);
    if (!session) return { ok: false, error: "live session for this meeting is missing" };
    const finals = session.words.filter((w) => w.isFinal);
    if (finals.length === 0) return { ok: false, error: "no transcript captured for this meeting" };
    const segments = [];
    let cur = null;
    for (const w of finals) {
      if (!cur || cur.speaker !== w.speaker) {
        if (cur) segments.push(cur);
        cur = { id: vcId("sg"), speaker: w.speaker, text: w.text, startSec: w.atSec, highlighted: false };
      } else {
        cur.text = `${cur.text} ${w.text}`.trim();
      }
    }
    if (cur) segments.push(cur);
    const recording = {
      id: vcId("rec"),
      title: meeting.title,
      folder: "Meetings",
      durationSec: segments.length ? Math.round((segments[segments.length - 1].startSec || 0) + 8) : 0,
      summary: null,
      segments,
      createdAt: vcNow(),
    };
    vcList(s, userId).push(recording);
    session.status = "finalized";
    session.finalizedAt = vcNow();
    session.recordingId = recording.id;
    meeting.botStatus = "recorded";
    meeting.recordingId = recording.id;
    saveVoice();
    return { ok: true, result: { meeting, recording } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Share a recording + comment on segments ─────────────────────────
  registerLensAction("voice", "recording-share", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = vcActor(ctx);
    const rec = vcList(s, userId).find((r) => r.id === params.id);
    if (!rec) return { ok: false, error: "recording not found" };
    let share = s.shares.get(rec.id);
    if (!share) {
      share = {
        id: vcId("share"),
        recordingId: rec.id,
        ownerId: userId,
        collaborators: [],
        comments: [],
        createdAt: vcNow(),
      };
      s.shares.set(rec.id, share);
    }
    if (Array.isArray(params.collaborators)) {
      for (const c of params.collaborators) {
        const cid = vcClean(c, 120);
        if (cid && !share.collaborators.includes(cid)) share.collaborators.push(cid);
      }
    }
    share.collaborators = share.collaborators.slice(0, 50);
    saveVoice();
    return { ok: true, result: { share } };
  });

  registerLensAction("voice", "recording-unshare", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = vcActor(ctx);
    const rec = vcList(s, userId).find((r) => r.id === params.id);
    if (!rec) return { ok: false, error: "recording not found" };
    const share = s.shares.get(rec.id);
    if (!share) return { ok: false, error: "recording is not shared" };
    if (params.collaborator) {
      const cid = vcClean(params.collaborator, 120);
      share.collaborators = share.collaborators.filter((c) => c !== cid);
      saveVoice();
      return { ok: true, result: { share } };
    }
    s.shares.delete(rec.id);
    saveVoice();
    return { ok: true, result: { unshared: rec.id } };
  });

  registerLensAction("voice", "share-detail", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const recId = vcClean(params.recordingId, 80);
    const share = s.shares.get(recId);
    if (!share) return { ok: true, result: { shared: false, share: null } };
    return { ok: true, result: { shared: true, share } };
  });

  registerLensAction("voice", "segment-comment-add", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = vcActor(ctx);
    const recId = vcClean(params.recordingId, 80);
    // The recording must belong to the caller, or the caller must be a collaborator.
    const ownsIt = vcList(s, userId).some((r) => r.id === recId);
    let share = s.shares.get(recId);
    if (!ownsIt && !(share && share.collaborators.includes(userId))) {
      return { ok: false, error: "recording not found or not shared with you" };
    }
    if (!share) {
      share = { id: vcId("share"), recordingId: recId, ownerId: userId, collaborators: [], comments: [], createdAt: vcNow() };
      s.shares.set(recId, share);
    }
    const segmentId = vcClean(params.segmentId, 80);
    if (!segmentId) return { ok: false, error: "segmentId required" };
    const body = vcClean(params.body, 2000);
    if (!body) return { ok: false, error: "comment body required" };
    const comment = {
      id: vcId("cmt"),
      segmentId,
      authorId: userId,
      body,
      createdAt: vcNow(),
    };
    share.comments.push(comment);
    saveVoice();
    return { ok: true, result: { comment, commentCount: share.comments.length } };
  });

  registerLensAction("voice", "segment-comments-list", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const recId = vcClean(params.recordingId, 80);
    const share = s.shares.get(recId);
    if (!share) return { ok: true, result: { comments: [], count: 0 } };
    let comments = share.comments;
    if (params.segmentId) {
      const sid = vcClean(params.segmentId, 80);
      comments = comments.filter((c) => c.segmentId === sid);
    }
    return { ok: true, result: { comments, count: comments.length } };
  });

  registerLensAction("voice", "segment-comment-delete", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = vcActor(ctx);
    const recId = vcClean(params.recordingId, 80);
    const share = s.shares.get(recId);
    if (!share) return { ok: false, error: "recording is not shared" };
    const idx = share.comments.findIndex((c) => c.id === params.commentId);
    if (idx < 0) return { ok: false, error: "comment not found" };
    if (share.comments[idx].authorId !== userId && share.ownerId !== userId) {
      return { ok: false, error: "only the comment author or recording owner can delete this comment" };
    }
    share.comments.splice(idx, 1);
    saveVoice();
    return { ok: true, result: { deleted: params.commentId } };
  });

  // ─── Multi-language transcription + translation ──────────────────────
  // Translates a recording's transcript via the free, keyless MyMemory
  // translation API. Returns translated segments without mutating the
  // original; pass persist:true to store the translation on the record.
  const LANG_CODE_RE = /^[a-z]{2}(-[a-zA-Z]{2,8})?$/;

  registerLensAction("voice", "transcript-translate", async (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rec = vcList(s, vcActor(ctx)).find((r) => r.id === params.id);
    if (!rec) return { ok: false, error: "recording not found" };
    if (rec.segments.length === 0) return { ok: false, error: "recording has no transcript" };
    const target = vcClean(params.targetLang, 16);
    if (!target || !LANG_CODE_RE.test(target)) {
      return { ok: false, error: "valid targetLang required (e.g. 'es', 'fr', 'ja')" };
    }
    const source = vcClean(params.sourceLang, 16) || "en";
    if (!LANG_CODE_RE.test(source)) return { ok: false, error: "invalid sourceLang" };
    const srcShort = source.split("-")[0];
    const tgtShort = target.split("-")[0];
    if (srcShort === tgtShort) return { ok: false, error: "source and target language are the same" };
    const limit = Math.min(rec.segments.length, 60); // MyMemory free-tier guard
    const translated = [];
    try {
      for (let i = 0; i < limit; i++) {
        const seg = rec.segments[i];
        const q = (seg.text || "").slice(0, 480);
        if (!q) { translated.push({ id: seg.id, speaker: seg.speaker, startSec: seg.startSec, text: "", translated: "" }); continue; }
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent(srcShort)}|${encodeURIComponent(tgtShort)}`;
        const data = await cachedFetchJson(url, { ttlMs: 24 * 60 * 60 * 1000, timeoutMs: 8000 });
        const out = data?.responseData?.translatedText;
        if (!out || data?.responseStatus >= 400) {
          return { ok: false, error: `translation failed: ${data?.responseDetails || "upstream error"}` };
        }
        translated.push({ id: seg.id, speaker: seg.speaker, startSec: seg.startSec, text: q, translated: String(out) });
      }
    } catch (e) {
      return { ok: false, error: `translation service error: ${e?.message || "unreachable"}` };
    }
    const translation = {
      sourceLang: srcShort,
      targetLang: tgtShort,
      segments: translated,
      partial: rec.segments.length > limit,
      translatedAt: vcNow(),
    };
    if (params.persist) {
      if (!Array.isArray(rec.translations)) rec.translations = [];
      rec.translations = rec.translations.filter((t) => t.targetLang !== tgtShort);
      rec.translations.push(translation);
      saveVoice();
    }
    return { ok: true, result: { translation } };
  });

  registerLensAction("voice", "transcript-translations-list", (ctx, _a, params = {}) => {
    const s = getVoiceState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rec = vcList(s, vcActor(ctx)).find((r) => r.id === params.id);
    if (!rec) return { ok: false, error: "recording not found" };
    const translations = Array.isArray(rec.translations) ? rec.translations : [];
    return {
      ok: true,
      result: {
        translations: translations.map((t) => ({
          sourceLang: t.sourceLang, targetLang: t.targetLang,
          segmentCount: t.segments.length, partial: t.partial, translatedAt: t.translatedAt,
        })),
        count: translations.length,
      },
    };
  });
}
