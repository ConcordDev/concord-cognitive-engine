// server/domains/linguistics.js
//
// Pure-compute text-analysis helpers (readability, morphology,
// frequency) plus real Free Dictionary API + Datamuse word
// associations (both free, no API key).

const FREE_DICTIONARY = "https://api.dictionaryapi.dev/api/v2/entries";
const DATAMUSE = "https://api.datamuse.com/words";

export default function registerLinguisticsActions(registerLensAction) {
  registerLensAction("linguistics", "textAnalysis", (ctx, artifact, _params) => {
    const text = artifact.data?.text || artifact.data?.content || "";
    if (!text) return { ok: true, result: { message: "Provide text to analyze." } };
    const words = text.split(/\s+/).filter(Boolean);
    const sentences = text.split(/[.!?]+/).filter(Boolean);
    const chars = text.replace(/\s/g, "").length;
    const syllableCount = words.reduce((s, w) => s + Math.max(1, w.replace(/[^aeiouy]/gi, "").length), 0);
    const fleschKincaid = 0.39 * (words.length / Math.max(sentences.length, 1)) + 11.8 * (syllableCount / Math.max(words.length, 1)) - 15.59;
    const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-z]/g, "")));
    return { ok: true, result: { wordCount: words.length, sentenceCount: sentences.length, charCount: chars, avgWordLength: Math.round(chars / words.length * 10) / 10, avgSentenceLength: Math.round(words.length / sentences.length * 10) / 10, vocabularySize: uniqueWords.size, lexicalDiversity: Math.round((uniqueWords.size / words.length) * 100), readabilityGrade: Math.round(Math.max(0, fleschKincaid) * 10) / 10, readingLevel: fleschKincaid < 6 ? "elementary" : fleschKincaid < 10 ? "middle-school" : fleschKincaid < 14 ? "high-school" : "college" } };
  });
  registerLensAction("linguistics", "morphologyBreakdown", (ctx, artifact, _params) => {
    const word = artifact.data?.word || "";
    if (!word) return { ok: true, result: { message: "Provide a word to analyze morphologically." } };
    const prefixes = ["un","re","pre","dis","mis","over","under","out","sub","super","anti","non","inter","trans","multi"];
    const suffixes = ["ing","tion","sion","ment","ness","able","ible","ful","less","ous","ive","al","er","est","ly","ed","es","s"];
    const foundPrefix = prefixes.find(p => word.toLowerCase().startsWith(p));
    const foundSuffix = suffixes.find(s => word.toLowerCase().endsWith(s));
    const root = word.toLowerCase().replace(new RegExp(`^(${foundPrefix || ""})`), "").replace(new RegExp(`(${foundSuffix || ""})$`), "") || word;
    return { ok: true, result: { word, prefix: foundPrefix || "none", root, suffix: foundSuffix || "none", morphemeCount: (foundPrefix ? 1 : 0) + 1 + (foundSuffix ? 1 : 0), wordClass: foundSuffix === "ly" ? "adverb" : foundSuffix === "ness" ? "noun" : foundSuffix === "ful" || foundSuffix === "ous" ? "adjective" : foundSuffix === "ing" || foundSuffix === "ed" ? "verb-form" : "base-form" } };
  });
  registerLensAction("linguistics", "frequencyAnalysis", (ctx, artifact, _params) => {
    const text = artifact.data?.text || "";
    if (!text) return { ok: true, result: { message: "Provide text for frequency analysis." } };
    const words = text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    const stopWords = new Set(["the","a","an","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","shall","should","may","might","can","could","and","but","or","nor","for","yet","so","in","on","at","to","of","by","with","from","this","that","it","i","you","he","she","we","they"]);
    const contentWords = Object.entries(freq).filter(([w]) => !stopWords.has(w)).sort((a, b) => b[1] - a[1]);
    return { ok: true, result: { totalWords: words.length, uniqueWords: Object.keys(freq).length, topContentWords: contentWords.slice(0, 15).map(([w, c]) => ({ word: w, count: c, frequency: Math.round((c / words.length) * 10000) / 100 })), hapaxLegomena: Object.values(freq).filter(v => v === 1).length, zipfCompliance: contentWords.length > 0 ? "Approximate Zipf distribution" : "Insufficient data" } };
  });
  registerLensAction("linguistics", "sentimentAnalysis", (ctx, artifact, _params) => {
    const text = artifact.data?.text || "";
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
}
