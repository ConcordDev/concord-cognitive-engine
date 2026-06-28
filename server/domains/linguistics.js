// server/domains/linguistics.js
//
// Pure-compute text-analysis helpers (readability, morphology,
// frequency) plus real Free Dictionary API + Datamuse word
// associations (both free, no API key).

const FREE_DICTIONARY = "https://api.dictionaryapi.dev/api/v2/entries";
const DATAMUSE = "https://api.datamuse.com/words";

export default function registerLinguisticsActions(registerLensAction) {
  registerLensAction("linguistics", "textAnalysis", (ctx, artifact, _params) => {
    // Coerce to String so a poisoned non-string input (number/object) degrades
    // gracefully instead of throwing `text.split is not a function` (fail-closed).
    const text = String(artifact.data?.text ?? artifact.data?.content ?? "");
    if (!text) return { ok: true, result: { message: "Provide text to analyze." } };
    const words = text.split(/\s+/).filter(Boolean);
    const sentences = text.split(/[.!?]+/).filter(Boolean);
    const chars = text.replace(/\s/g, "").length;
    const syllableCount = words.reduce((s, w) => s + Math.max(1, w.replace(/[^aeiouy]/gi, "").length), 0);
    const fleschKincaid = 0.39 * (words.length / Math.max(sentences.length, 1)) + 11.8 * (syllableCount / Math.max(words.length, 1)) - 15.59;
    const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-z]/g, "")));
    return { ok: true, result: { wordCount: words.length, sentenceCount: sentences.length, charCount: chars, avgWordLength: Math.round(chars / words.length * 10) / 10, avgSentenceLength: Math.round(words.length / sentences.length * 10) / 10, vocabularySize: uniqueWords.size, lexicalDiversity: Math.round((uniqueWords.size / words.length) * 100), readabilityGrade: Math.round(Math.max(0, fleschKincaid) * 10) / 10, readingLevel: fleschKincaid < 6 ? "elementary" : fleschKincaid < 10 ? "middle-school" : fleschKincaid < 14 ? "high-school" : "college" } };
  });
  // Morphosyntactic analysis for the lens "Analyze" surface
  // (app/lenses/linguistics/page.tsx posts {action:'analyze', input:{text, type:'morphosyntactic'}}
  // and renders result.content). Reads text from params OR artifact.data (the
  // /api/lens/run bridge populates both). Was called but never registered — the
  // Analyze button hit the utility-brain catch-all until this landed.
  registerLensAction("linguistics", "analyze", (ctx, artifact, params = {}) => {
    const text = String(params?.text || artifact?.data?.text || artifact?.data?.content || "").trim();
    if (!text) return { ok: false, error: "text required" };
    const words = text.split(/\s+/).filter(Boolean);
    const sentences = text.split(/[.!?]+/).filter(Boolean);
    const chars = text.replace(/\s/g, "").length;
    const syllables = words.reduce((s, w) => s + Math.max(1, w.replace(/[^aeiouy]/gi, "").length), 0);
    const fk = 0.39 * (words.length / Math.max(sentences.length, 1)) + 11.8 * (syllables / Math.max(words.length, 1)) - 15.59;
    const grade = Math.round(Math.max(0, fk) * 10) / 10;
    const level = fk < 6 ? "elementary" : fk < 10 ? "middle-school" : fk < 14 ? "high-school" : "college";
    const unique = new Set(words.map(w => w.toLowerCase().replace(/[^a-z]/g, "")).filter(Boolean));
    const ttr = words.length ? Math.round((unique.size / words.length) * 100) : 0;
    // Morphological sketch: tally inferable word-classes from common suffixes.
    const suffixClass = (w) => /ly$/.test(w) ? "adverb" : /(ness|tion|ment|ity)$/.test(w) ? "noun"
      : /(ful|ous|ive|al)$/.test(w) ? "adjective" : /(ing|ed|ise|ize)$/.test(w) ? "verb-form" : null;
    const classes = {};
    // Strip punctuation before suffix classification so "happily." still reads as -ly.
    for (const w of words) { const c = suffixClass(w.toLowerCase().replace(/[^a-z]/g, "")); if (c) classes[c] = (classes[c] || 0) + 1; }
    const morph = Object.entries(classes).sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c} ×${n}`).join(", ") || "no strongly-marked affixes detected";
    const content = [
      `Morphosyntactic analysis`,
      ``,
      `Tokens: ${words.length} words · ${sentences.length} sentence(s) · ${chars} non-space chars`,
      `Mean word length: ${Math.round(chars / Math.max(words.length, 1) * 10) / 10} chars · mean sentence length: ${Math.round(words.length / Math.max(sentences.length, 1) * 10) / 10} words`,
      `Lexical diversity (type/token): ${ttr}% · vocabulary: ${unique.size} distinct`,
      `Readability: Flesch-Kincaid grade ${grade} (${level})`,
      `Affix-inferred word classes: ${morph}`,
    ].join("\n");
    return { ok: true, result: { content, wordCount: words.length, sentenceCount: sentences.length, lexicalDiversity: ttr, readabilityGrade: grade, readingLevel: level, wordClasses: classes } };
  });
  registerLensAction("linguistics", "morphologyBreakdown", (ctx, artifact, _params) => {
    const word = String(artifact.data?.word ?? "");
    if (!word) return { ok: true, result: { message: "Provide a word to analyze morphologically." } };
    const prefixes = ["un","re","pre","dis","mis","over","under","out","sub","super","anti","non","inter","trans","multi"];
    const suffixes = ["ing","tion","sion","ment","ness","able","ible","ful","less","ous","ive","al","er","est","ly","ed","es","s"];
    const foundPrefix = prefixes.find(p => word.toLowerCase().startsWith(p));
    const foundSuffix = suffixes.find(s => word.toLowerCase().endsWith(s));
    const root = word.toLowerCase().replace(new RegExp(`^(${foundPrefix || ""})`), "").replace(new RegExp(`(${foundSuffix || ""})$`), "") || word;
    return { ok: true, result: { word, prefix: foundPrefix || "none", root, suffix: foundSuffix || "none", morphemeCount: (foundPrefix ? 1 : 0) + 1 + (foundSuffix ? 1 : 0), wordClass: foundSuffix === "ly" ? "adverb" : foundSuffix === "ness" ? "noun" : foundSuffix === "ful" || foundSuffix === "ous" ? "adjective" : foundSuffix === "ing" || foundSuffix === "ed" ? "verb-form" : "base-form" } };
  });
  registerLensAction("linguistics", "frequencyAnalysis", (ctx, artifact, _params) => {
    const text = String(artifact.data?.text ?? "");
    if (!text) return { ok: true, result: { message: "Provide text for frequency analysis." } };
    const words = text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    const stopWords = new Set(["the","a","an","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","shall","should","may","might","can","could","and","but","or","nor","for","yet","so","in","on","at","to","of","by","with","from","this","that","it","i","you","he","she","we","they"]);
    const contentWords = Object.entries(freq).filter(([w]) => !stopWords.has(w)).sort((a, b) => b[1] - a[1]);
    return { ok: true, result: { totalWords: words.length, uniqueWords: Object.keys(freq).length, topContentWords: contentWords.slice(0, 15).map(([w, c]) => ({ word: w, count: c, frequency: Math.round((c / words.length) * 10000) / 100 })), hapaxLegomena: Object.values(freq).filter(v => v === 1).length, zipfCompliance: contentWords.length > 0 ? "Approximate Zipf distribution" : "Insufficient data" } };
  });
  registerLensAction("linguistics", "sentimentAnalysis", (ctx, artifact, _params) => {
    const text = String(artifact.data?.text ?? "");
    if (!text) return { ok: true, result: { message: "Provide text for sentiment analysis." } };
    const positive = ["good","great","excellent","amazing","wonderful","love","happy","best","beautiful","perfect","fantastic","brilliant","outstanding","superb","delightful"];
    const negative = ["bad","terrible","awful","horrible","hate","worst","ugly","poor","disappointing","disgusting","dreadful","pathetic","miserable","annoying","boring"];
    const words = text.toLowerCase().split(/\s+/);
    let posCount = 0, negCount = 0;
    for (const w of words) { if (positive.some(p => w.includes(p))) posCount++; if (negative.some(n => w.includes(n))) negCount++; }
    const score = words.length > 0 ? Math.round(((posCount - negCount) / Math.max(posCount + negCount, 1)) * 100) : 0;
    return { ok: true, result: { sentiment: score > 20 ? "positive" : score < -20 ? "negative" : "neutral", score, positiveWords: posCount, negativeWords: negCount, totalWords: words.length, confidence: (posCount + negCount) > 3 ? "high" : (posCount + negCount) > 0 ? "moderate" : "low" } };
  });

  /**
   * dictionary-lookup — Real word definition via Free Dictionary API.
   * Returns definitions, etymology, examples, pronunciations (IPA +
   * audio URLs when available), synonyms/antonyms. Free, no API key.
   * params: { word: string, lang?: ISO-2 (default "en") }
   */
  registerLensAction("linguistics", "dictionary-lookup", async (_ctx, _artifact, params = {}) => {
    const word = String(params.word || "").trim();
    if (!word) return { ok: false, error: "word required" };
    const lang = String(params.lang || "en").toLowerCase();
    try {
      const r = await fetch(`${FREE_DICTIONARY}/${lang}/${encodeURIComponent(word)}`);
      if (r.status === 404) return { ok: false, error: `word not found: ${word}` };
      if (!r.ok) throw new Error(`dictionary ${r.status}`);
      const data = await r.json();
      const entries = (Array.isArray(data) ? data : []).map((entry) => ({
        word: entry.word,
        phonetic: entry.phonetic,
        phonetics: (entry.phonetics || []).map((p) => ({ text: p.text, audio: p.audio })),
        origin: entry.origin,
        meanings: (entry.meanings || []).map((m) => ({
          partOfSpeech: m.partOfSpeech,
          definitions: (m.definitions || []).map((d) => ({
            definition: d.definition,
            example: d.example,
            synonyms: d.synonyms || [],
            antonyms: d.antonyms || [],
          })),
          synonyms: m.synonyms || [],
          antonyms: m.antonyms || [],
        })),
      }));
      return {
        ok: true,
        result: { word, lang, entries, count: entries.length, source: "free-dictionary-api" },
      };
    } catch (e) {
      return { ok: false, error: `dictionary unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * datamuse-words — Word association lookup via Datamuse API.
   * Free, no key. Supports rhymes, synonyms, "means like", "sounds
   * like", "related to topic", and many more constraint queries.
   *
   * params: One or more of:
   *   rel_rhy: "perfectly rhyming with"
   *   rel_nry: "near-rhyming with"
   *   ml: "means like"
   *   sl: "sounds like"
   *   sp: "spelled like" (supports wildcards * and ?)
   *   rel_syn: "synonym of"
   *   rel_ant: "antonym of"
   *   topics: "related to topic"
   *   max?: 1-1000 (default 25)
   */
  registerLensAction("linguistics", "datamuse-words", async (_ctx, _artifact, params = {}) => {
    const allowed = ["rel_rhy", "rel_nry", "ml", "sl", "sp", "rel_syn", "rel_ant", "topics"];
    const supplied = Object.keys(params).filter((k) => allowed.includes(k));
    if (supplied.length === 0) {
      return { ok: false, error: `at least one of: ${allowed.join(", ")} required` };
    }
    const max = Math.max(1, Math.min(1000, Number(params.max) || 25));
    const qs = new URLSearchParams({ max: String(max) });
    for (const k of supplied) {
      qs.set(k, String(params[k]));
    }
    try {
      const r = await fetch(`${DATAMUSE}?${qs.toString()}`);
      if (!r.ok) throw new Error(`datamuse ${r.status}`);
      const data = await r.json();
      const words = (data || []).map((w) => ({
        word: w.word,
        score: w.score,
        numSyllables: w.numSyllables,
        tags: w.tags,
      }));
      return {
        ok: true,
        result: { query: Object.fromEntries(supplied.map((k) => [k, params[k]])), words, count: words.length, source: "datamuse" },
      };
    } catch (e) {
      return { ok: false, error: `datamuse unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Vocabulary builder (per-user word list with spaced review) ──────

  function getLingState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.linguisticsLens) STATE.linguisticsLens = {};
    if (!(STATE.linguisticsLens.words instanceof Map)) STATE.linguisticsLens.words = new Map(); // userId -> Array
    if (!(STATE.linguisticsLens.progress instanceof Map)) STATE.linguisticsLens.progress = new Map(); // userId -> {points, streak, ...}
    if (!(STATE.linguisticsLens.decks instanceof Map)) STATE.linguisticsLens.decks = new Map(); // userId -> Array
    return STATE.linguisticsLens;
  }
  function saveLing() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const lgId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const lgNow = () => new Date().toISOString();
  const lgActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const lgClean = (v, max = 600) => String(v == null ? "" : v).trim().slice(0, max);
  const lgWords = (s, userId) => { if (!s.words.has(userId)) s.words.set(userId, []); return s.words.get(userId); };
  // Leitner-box review intervals (days) by mastery level 0-5.
  const REVIEW_INTERVALS = [0, 1, 3, 7, 16, 45];

  registerLensAction("linguistics", "vocab-add", async (ctx, _a, params = {}) => {
    const s = getLingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const word = lgClean(params.word, 80).toLowerCase();
    if (!word) return { ok: false, error: "word required" };
    const list = lgWords(s, lgActor(ctx));
    if (list.some((w) => w.word === word)) return { ok: false, error: "word already in your vocabulary" };

    let definition = lgClean(params.definition, 600);
    let partOfSpeech = lgClean(params.partOfSpeech, 30) || null;
    let example = lgClean(params.example, 400) || null;
    let etymology = null;
    let phonetic = null;
    let audio = null;
    let autoFetched = false;

    // Auto-fetch definition when the caller didn't supply one (opt-out
    // with autoFetch: false). Free Dictionary API — no key.
    if (!definition && params.autoFetch !== false) {
      try {
        const r = await fetch(`${FREE_DICTIONARY}/en/${encodeURIComponent(word)}`);
        if (r.ok) {
          const data = await r.json();
          const entry = Array.isArray(data) ? data[0] : null;
          if (entry) {
            const meaning = (entry.meanings || [])[0];
            const def = meaning ? (meaning.definitions || [])[0] : null;
            if (def) {
              definition = lgClean(def.definition, 600);
              if (!example && def.example) example = lgClean(def.example, 400);
            }
            if (!partOfSpeech && meaning) partOfSpeech = lgClean(meaning.partOfSpeech, 30) || null;
            etymology = lgClean(entry.origin, 400) || null;
            phonetic = lgClean(entry.phonetic, 60) || null;
            const ph = (entry.phonetics || []).find((p) => p.audio);
            if (ph) audio = ph.audio;
            autoFetched = true;
          }
        }
      } catch (_e) { /* graceful — keep empty definition */ }
    }

    const entry = {
      id: lgId("vw"),
      word,
      definition,
      partOfSpeech,
      example,
      etymology,
      phonetic,
      audio,
      tags: Array.isArray(params.tags) ? params.tags.map((t) => lgClean(t, 30).toLowerCase()).filter(Boolean).slice(0, 6) : [],
      deckId: lgClean(params.deckId, 60) || null,
      level: 0,
      due: lgNow(),
      reviewCount: 0,
      correctCount: 0,
      addedAt: lgNow(),
    };
    list.push(entry);
    saveLing();
    return { ok: true, result: { word: entry, autoFetched } };
  });

  registerLensAction("linguistics", "vocab-list", (ctx, _a, params = {}) => {
    const s = getLingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let words = [...lgWords(s, lgActor(ctx))];
    if (params.tag) {
      const t = lgClean(params.tag, 30).toLowerCase();
      words = words.filter((w) => w.tags.includes(t));
    }
    const q = lgClean(params.query, 80).toLowerCase();
    if (q) words = words.filter((w) => w.word.includes(q) || (w.definition || "").toLowerCase().includes(q));
    words.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return { ok: true, result: { words, count: words.length } };
  });

  registerLensAction("linguistics", "vocab-update", (ctx, _a, params = {}) => {
    const s = getLingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const w = lgWords(s, lgActor(ctx)).find((x) => x.id === params.id);
    if (!w) return { ok: false, error: "word not found" };
    if (params.definition != null) w.definition = lgClean(params.definition, 600);
    if (params.example != null) w.example = lgClean(params.example, 400) || null;
    if (params.partOfSpeech != null) w.partOfSpeech = lgClean(params.partOfSpeech, 30) || null;
    if (Array.isArray(params.tags)) w.tags = params.tags.map((t) => lgClean(t, 30).toLowerCase()).filter(Boolean).slice(0, 6);
    saveLing();
    return { ok: true, result: { word: w } };
  });

  registerLensAction("linguistics", "vocab-delete", (ctx, _a, params = {}) => {
    const s = getLingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = lgWords(s, lgActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "word not found" };
    arr.splice(i, 1);
    saveLing();
    return { ok: true, result: { deleted: params.id } };
  });

  // vocab-review-due — words whose review is due now.
  registerLensAction("linguistics", "vocab-review-due", (ctx, _a, _params = {}) => {
    const s = getLingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const now = Date.now();
    const due = lgWords(s, lgActor(ctx))
      .filter((w) => new Date(w.due).getTime() <= now)
      .sort((a, b) => a.due.localeCompare(b.due));
    return { ok: true, result: { words: due, count: due.length } };
  });

  // vocab-review — record a review outcome; Leitner-box promote/demote.
  registerLensAction("linguistics", "vocab-review", (ctx, _a, params = {}) => {
    const s = getLingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const w = lgWords(s, lgActor(ctx)).find((x) => x.id === params.id);
    if (!w) return { ok: false, error: "word not found" };
    const known = params.known === true;
    w.level = known ? Math.min(5, w.level + 1) : 0;
    w.reviewCount += 1;
    if (typeof w.correctCount !== "number") w.correctCount = 0;
    if (known) w.correctCount += 1;
    w.due = new Date(Date.now() + REVIEW_INTERVALS[w.level] * 86400000).toISOString();
    w.lastReviewedAt = lgNow();
    lgRecordActivity(s, lgActor(ctx), known ? 5 : 1);
    saveLing();
    return { ok: true, result: { id: w.id, level: w.level, nextReviewInDays: REVIEW_INTERVALS[w.level] } };
  });

  registerLensAction("linguistics", "vocab-dashboard", (ctx, _a, _params = {}) => {
    const s = getLingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const words = lgWords(s, lgActor(ctx));
    const now = Date.now();
    return {
      ok: true,
      result: {
        totalWords: words.length,
        mastered: words.filter((w) => w.level >= 5).length,
        learning: words.filter((w) => w.level > 0 && w.level < 5).length,
        fresh: words.filter((w) => w.level === 0).length,
        dueNow: words.filter((w) => new Date(w.due).getTime() <= now).length,
      },
    };
  });

  // ─── Progress streaks & gamification ────────────────────────────────

  const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
  // Mastery badges unlocked by accumulated points (real, earned values).
  const BADGE_TIERS = [
    { id: "novice", label: "Novice", points: 50 },
    { id: "apprentice", label: "Apprentice", points: 200 },
    { id: "scholar", label: "Scholar", points: 600 },
    { id: "philologist", label: "Philologist", points: 1500 },
    { id: "polyglot", label: "Polyglot", points: 4000 },
  ];

  function lgProgress(s, userId) {
    if (!s.progress.has(userId)) {
      s.progress.set(userId, {
        points: 0, streak: 0, longestStreak: 0,
        lastActiveDay: null, dailyGoal: 20, todayPoints: 0, todayDay: null,
      });
    }
    return s.progress.get(userId);
  }
  // Record activity: bump points, advance/reset the daily streak.
  function lgRecordActivity(s, userId, points) {
    const p = lgProgress(s, userId);
    const today = dayKey();
    if (p.todayDay !== today) { p.todayDay = today; p.todayPoints = 0; }
    p.points += points;
    p.todayPoints += points;
    if (p.lastActiveDay !== today) {
      const yesterday = dayKey(new Date(Date.now() - 86400000));
      p.streak = p.lastActiveDay === yesterday ? p.streak + 1 : 1;
      p.lastActiveDay = today;
      if (p.streak > p.longestStreak) p.longestStreak = p.streak;
    }
  }

  registerLensAction("linguistics", "progress-stats", (ctx, _a, _params = {}) => {
    const s = getLingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = lgProgress(s, lgActor(ctx));
    const today = dayKey();
    const todayPoints = p.todayDay === today ? p.todayPoints : 0;
    // A streak only counts if active today or yesterday.
    const yesterday = dayKey(new Date(Date.now() - 86400000));
    const streak = (p.lastActiveDay === today || p.lastActiveDay === yesterday) ? p.streak : 0;
    const earned = BADGE_TIERS.filter((b) => p.points >= b.points).map((b) => b.id);
    const next = BADGE_TIERS.find((b) => p.points < b.points) || null;
    return {
      ok: true,
      result: {
        points: p.points,
        streak,
        longestStreak: p.longestStreak,
        dailyGoal: p.dailyGoal,
        todayPoints,
        goalMet: todayPoints >= p.dailyGoal,
        goalProgress: Math.min(100, Math.round((todayPoints / Math.max(p.dailyGoal, 1)) * 100)),
        badges: BADGE_TIERS.map((b) => ({ ...b, earned: earned.includes(b.id) })),
        nextBadge: next ? { id: next.id, label: next.label, pointsNeeded: next.points - p.points } : null,
      },
    };
  });

  registerLensAction("linguistics", "progress-set-goal", (ctx, _a, params = {}) => {
    const s = getLingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const goal = Math.max(5, Math.min(500, Math.round(Number(params.dailyGoal) || 0)));
    if (!goal) return { ok: false, error: "dailyGoal must be 5-500" };
    const p = lgProgress(s, lgActor(ctx));
    p.dailyGoal = goal;
    saveLing();
    return { ok: true, result: { dailyGoal: goal } };
  });

  // ─── Adaptive quiz engine ───────────────────────────────────────────

  // Build one quiz question for a target word. Multiple-choice draws 3
  // real distractor definitions from the user's own other words; falls
  // back to typing mode when there aren't enough words.
  function buildQuestion(word, pool, mode) {
    if (mode === "typing" || pool.length < 4) {
      return {
        wordId: word.id, mode: "typing", prompt: word.definition || "(no definition)",
        partOfSpeech: word.partOfSpeech, answer: word.word,
      };
    }
    const distractors = pool
      .filter((w) => w.id !== word.id && w.definition)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map((w) => w.definition);
    if (distractors.length < 3) {
      return {
        wordId: word.id, mode: "typing", prompt: word.definition || "(no definition)",
        partOfSpeech: word.partOfSpeech, answer: word.word,
      };
    }
    const choices = [...distractors, word.definition].sort(() => Math.random() - 0.5);
    return {
      wordId: word.id, mode: "multiple-choice", prompt: word.word,
      partOfSpeech: word.partOfSpeech, choices, answer: word.definition,
    };
  }

  // quiz-generate — adaptive question set. Weights lower-mastery and
  // due words higher so the quiz targets what the learner is weakest at.
  registerLensAction("linguistics", "quiz-generate", (ctx, _a, params = {}) => {
    const s = getLingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const all = lgWords(s, lgActor(ctx)).filter((w) => w.definition);
    if (all.length < 1) return { ok: false, error: "add words with definitions to take a quiz" };
    const count = Math.max(1, Math.min(20, Math.round(Number(params.count) || 8)));
    const now = Date.now();
    // Adaptive weight: weaker mastery + overdue = picked more often.
    const weighted = all.map((w) => {
      const masteryWeight = 6 - Math.min(5, w.level);
      const overdue = new Date(w.due).getTime() <= now ? 3 : 1;
      const accuracy = w.reviewCount > 0 ? (w.correctCount || 0) / w.reviewCount : 0.5;
      const accuracyWeight = 1 + (1 - accuracy) * 2;
      return { w, weight: masteryWeight * overdue * accuracyWeight };
    });
    // Weighted shuffle (no duplicates).
    const picked = [];
    const remaining = [...weighted];
    while (picked.length < count && remaining.length) {
      const total = remaining.reduce((a, x) => a + x.weight, 0);
      let r = Math.random() * total;
      let idx = 0;
      for (; idx < remaining.length; idx++) { r -= remaining[idx].weight; if (r <= 0) break; }
      picked.push(remaining.splice(Math.min(idx, remaining.length - 1), 1)[0].w);
    }
    const forceMode = params.mode === "typing" || params.mode === "multiple-choice" ? params.mode : null;
    const questions = picked.map((w) => buildQuestion(w, all, forceMode));
    return { ok: true, result: { questions, count: questions.length, poolSize: all.length } };
  });

  // quiz-grade — grade one answer, advance Leitner level + award points.
  registerLensAction("linguistics", "quiz-grade", (ctx, _a, params = {}) => {
    const s = getLingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const w = lgWords(s, lgActor(ctx)).find((x) => x.id === params.wordId);
    if (!w) return { ok: false, error: "word not found" };
    const given = lgClean(params.answer, 600).toLowerCase();
    const mode = params.mode === "typing" ? "typing" : "multiple-choice";
    const correct = mode === "typing"
      ? given === w.word.toLowerCase()
      : given === (w.definition || "").toLowerCase();
    w.reviewCount += 1;
    if (typeof w.correctCount !== "number") w.correctCount = 0;
    if (correct) {
      w.correctCount += 1;
      w.level = Math.min(5, w.level + 1);
    } else {
      w.level = 0;
    }
    w.due = new Date(Date.now() + REVIEW_INTERVALS[w.level] * 86400000).toISOString();
    w.lastReviewedAt = lgNow();
    // Typing answers are worth more — harder recall.
    const points = correct ? (mode === "typing" ? 10 : 6) : 1;
    lgRecordActivity(s, lgActor(ctx), points);
    saveLing();
    return {
      ok: true,
      result: { correct, correctAnswer: mode === "typing" ? w.word : w.definition, level: w.level, points },
    };
  });

  // ─── Pronunciation audio + word-in-context + etymology ──────────────

  // pronounce — IPA + audio clip URL for a word (Free Dictionary API).
  registerLensAction("linguistics", "pronounce", async (_ctx, _a, params = {}) => {
    const word = lgClean(params.word, 80).toLowerCase();
    if (!word) return { ok: false, error: "word required" };
    const lang = String(params.lang || "en").toLowerCase();
    try {
      const r = await fetch(`${FREE_DICTIONARY}/${lang}/${encodeURIComponent(word)}`);
      if (r.status === 404) return { ok: false, error: `word not found: ${word}` };
      if (!r.ok) throw new Error(`dictionary ${r.status}`);
      const data = await r.json();
      const entry = Array.isArray(data) ? data[0] : null;
      if (!entry) return { ok: false, error: `no pronunciation for: ${word}` };
      const phonetics = (entry.phonetics || [])
        .map((p) => ({ ipa: p.text || null, audio: p.audio || null }))
        .filter((p) => p.ipa || p.audio);
      const audioClip = phonetics.find((p) => p.audio) || null;
      return {
        ok: true,
        result: {
          word, lang,
          ipa: entry.phonetic || (phonetics.find((p) => p.ipa) || {}).ipa || null,
          audio: audioClip ? audioClip.audio : null,
          phonetics,
          source: "free-dictionary-api",
        },
      };
    } catch (e) {
      return { ok: false, error: `pronunciation unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // word-context — real usage sentences for a word. Pulls definition
  // examples from Free Dictionary; nothing fabricated.
  registerLensAction("linguistics", "word-context", async (_ctx, _a, params = {}) => {
    const word = lgClean(params.word, 80).toLowerCase();
    if (!word) return { ok: false, error: "word required" };
    try {
      const r = await fetch(`${FREE_DICTIONARY}/en/${encodeURIComponent(word)}`);
      if (r.status === 404) return { ok: false, error: `word not found: ${word}` };
      if (!r.ok) throw new Error(`dictionary ${r.status}`);
      const data = await r.json();
      const examples = [];
      for (const entry of (Array.isArray(data) ? data : [])) {
        for (const m of (entry.meanings || [])) {
          for (const d of (m.definitions || [])) {
            if (d.example) examples.push({ sentence: d.example, partOfSpeech: m.partOfSpeech, sense: d.definition });
          }
        }
      }
      return { ok: true, result: { word, examples, count: examples.length, source: "free-dictionary-api" } };
    } catch (e) {
      return { ok: false, error: `context unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // etymology — word-history view. Free Dictionary "origin" field where
  // present; falls back gracefully when the entry has no etymology.
  registerLensAction("linguistics", "etymology", async (_ctx, _a, params = {}) => {
    const word = lgClean(params.word, 80).toLowerCase();
    if (!word) return { ok: false, error: "word required" };
    try {
      const r = await fetch(`${FREE_DICTIONARY}/en/${encodeURIComponent(word)}`);
      if (r.status === 404) return { ok: false, error: `word not found: ${word}` };
      if (!r.ok) throw new Error(`dictionary ${r.status}`);
      const data = await r.json();
      const origins = [];
      for (const entry of (Array.isArray(data) ? data : [])) {
        if (entry.origin) origins.push(entry.origin);
      }
      return {
        ok: true,
        result: {
          word,
          origin: origins.length ? origins[0] : null,
          allOrigins: origins,
          hasEtymology: origins.length > 0,
          source: "free-dictionary-api",
        },
      };
    } catch (e) {
      return { ok: false, error: `etymology unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Curated word lists / decks ─────────────────────────────────────

  function lgDecks(s, userId) {
    if (!s.decks.has(userId)) s.decks.set(userId, []);
    return s.decks.get(userId);
  }

  // deck-create — themed pack the user defines (SAT, GRE, domain vocab).
  registerLensAction("linguistics", "deck-create", (ctx, _a, params = {}) => {
    const s = getLingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = lgClean(params.name, 80);
    if (!name) return { ok: false, error: "name required" };
    const deck = {
      id: lgId("dk"),
      name,
      description: lgClean(params.description, 400),
      theme: lgClean(params.theme, 40) || "general",
      createdAt: lgNow(),
    };
    lgDecks(s, lgActor(ctx)).push(deck);
    saveLing();
    return { ok: true, result: { deck } };
  });

  registerLensAction("linguistics", "deck-list", (ctx, _a, _params = {}) => {
    const s = getLingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const decks = lgDecks(s, lgActor(ctx));
    const words = lgWords(s, lgActor(ctx));
    const enriched = decks.map((d) => {
      const dws = words.filter((w) => w.deckId === d.id);
      return {
        ...d,
        wordCount: dws.length,
        mastered: dws.filter((w) => w.level >= 5).length,
      };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { decks: enriched, count: enriched.length } };
  });

  registerLensAction("linguistics", "deck-delete", (ctx, _a, params = {}) => {
    const s = getLingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = lgDecks(s, lgActor(ctx));
    const i = arr.findIndex((d) => d.id === params.id);
    if (i < 0) return { ok: false, error: "deck not found" };
    arr.splice(i, 1);
    // Unassign words from the removed deck (keep the words themselves).
    for (const w of lgWords(s, lgActor(ctx))) {
      if (w.deckId === params.id) w.deckId = null;
    }
    saveLing();
    return { ok: true, result: { deleted: params.id } };
  });

  // deck-import — bulk-add words to a deck. Each word in the list is a
  // real string the user supplies; definitions auto-fetched on demand.
  registerLensAction("linguistics", "deck-import", async (ctx, _a, params = {}) => {
    const s = getLingState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const deckId = lgClean(params.deckId, 60);
    if (!deckId) return { ok: false, error: "deckId required" };
    const deck = lgDecks(s, lgActor(ctx)).find((d) => d.id === deckId);
    if (!deck) return { ok: false, error: "deck not found" };
    const rawWords = Array.isArray(params.words) ? params.words : [];
    if (!rawWords.length) return { ok: false, error: "words array required" };
    const list = lgWords(s, lgActor(ctx));
    const autoFetch = params.autoFetch !== false;
    const added = [];
    const skipped = [];
    for (const raw of rawWords.slice(0, 100)) {
      const word = lgClean(raw, 80).toLowerCase();
      if (!word) continue;
      if (list.some((w) => w.word === word)) { skipped.push(word); continue; }
      let definition = "";
      let partOfSpeech = null;
      let example = null;
      if (autoFetch) {
        try {
          const r = await fetch(`${FREE_DICTIONARY}/en/${encodeURIComponent(word)}`);
          if (r.ok) {
            const data = await r.json();
            const entry = Array.isArray(data) ? data[0] : null;
            const meaning = entry ? (entry.meanings || [])[0] : null;
            const def = meaning ? (meaning.definitions || [])[0] : null;
            if (def) { definition = lgClean(def.definition, 600); if (def.example) example = lgClean(def.example, 400); }
            if (meaning) partOfSpeech = lgClean(meaning.partOfSpeech, 30) || null;
          }
        } catch (_e) { /* graceful */ }
      }
      const entry = {
        id: lgId("vw"), word, definition, partOfSpeech, example,
        etymology: null, phonetic: null, audio: null,
        tags: [], deckId, level: 0, due: lgNow(),
        reviewCount: 0, correctCount: 0, addedAt: lgNow(),
      };
      list.push(entry);
      added.push(word);
    }
    saveLing();
    return { ok: true, result: { deckId, added, addedCount: added.length, skipped, skippedCount: skipped.length } };
  });
}
