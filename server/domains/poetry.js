// server/domains/poetry.js
//
// Pure-compute poetry helpers (meter, rhyme scheme, form guide,
// word frequency) plus real PoetryDB integration (~3000 classical
// poems by 100+ authors). Free, no API key.

const POETRYDB_BASE = "https://poetrydb.org";

export default function registerPoetryActions(registerLensAction) {
  registerLensAction("poetry", "meterAnalysis", (ctx, artifact, _params) => { const text = artifact.data?.text || artifact.data?.poem || ""; if (!text) return { ok: true, result: { message: "Add poem text to analyze meter." } }; const lines = text.split("\n").filter(l => l.trim()); const syllableCounts = lines.map(l => { const words = l.trim().split(/\s+/); return words.reduce((s, w) => s + Math.max(1, (w.match(/[aeiouy]+/gi) || []).length), 0); }); const avgSyllables = syllableCounts.length > 0 ? Math.round(syllableCounts.reduce((s,v)=>s+v,0)/syllableCounts.length * 10) / 10 : 0; const consistent = syllableCounts.length > 1 && Math.max(...syllableCounts) - Math.min(...syllableCounts) <= 2; return { ok: true, result: { lines: lines.length, syllablesPerLine: syllableCounts, avgSyllables, meterConsistency: consistent ? "regular" : "irregular", possibleForm: syllableCounts.length === 14 ? "sonnet" : syllableCounts.join(",").includes("5,7,5") ? "haiku" : lines.length === 3 && syllableCounts[0] === syllableCounts[2] ? "tercet" : "free-verse" } }; });
  registerLensAction("poetry", "rhymeScheme", (ctx, artifact, _params) => { const text = artifact.data?.text || artifact.data?.poem || ""; if (!text) return { ok: true, result: { message: "Add poem text to detect rhyme scheme." } }; const lines = text.split("\n").filter(l => l.trim()); const endWords = lines.map(l => { const words = l.trim().split(/\s+/); return (words[words.length - 1] || "").toLowerCase().replace(/[^a-z]/g, ""); }); const getEnding = w => w.length > 2 ? w.slice(-2) : w; const scheme = []; const rhymeMap = {}; let letter = 65; for (const word of endWords) { const ending = getEnding(word); if (rhymeMap[ending]) { scheme.push(rhymeMap[ending]); } else { rhymeMap[ending] = String.fromCharCode(letter); scheme.push(rhymeMap[ending]); letter++; } } return { ok: true, result: { lines: lines.length, scheme: scheme.join(""), endWords, form: scheme.join("") === "ABAB" ? "alternate-rhyme" : scheme.join("") === "AABB" ? "couplets" : scheme.join("") === "ABBA" ? "enclosed-rhyme" : "other", rhyming: new Set(scheme).size < scheme.length } }; });
  registerLensAction("poetry", "formGuide", (ctx, artifact, _params) => { const form = (artifact.data?.form || "sonnet").toLowerCase(); const forms = { sonnet: { lines: 14, meter: "iambic pentameter", rhyme: "ABAB CDCD EFEF GG (Shakespearean) or ABBAABBA CDECDE (Petrarchan)", structure: "3 quatrains + couplet or octave + sestet" }, haiku: { lines: 3, meter: "5-7-5 syllables", rhyme: "none", structure: "Nature image → deeper meaning" }, limerick: { lines: 5, meter: "AABBA", rhyme: "AABBA", structure: "Setup (AA) → twist (BB) → punchline (A)" }, villanelle: { lines: 19, meter: "iambic pentameter", rhyme: "ABA pattern with refrains", structure: "5 tercets + quatrain, 2 refrains" }, "free-verse": { lines: "any", meter: "none required", rhyme: "none required", structure: "Let meaning dictate form" } }; const guide = forms[form] || forms["free-verse"]; return { ok: true, result: { form, ...guide, tip: "Start with the feeling, then fit it to the form" } }; });
  registerLensAction("poetry", "wordFrequency", (ctx, artifact, _params) => { const text = artifact.data?.text || ""; if (!text) return { ok: true, result: { message: "Add poem text to analyze word frequency." } }; const words = text.toLowerCase().replace(/[^a-z\s]/g,"").split(/\s+/).filter(Boolean); const freq = {}; const stopWords = new Set(["the","a","an","and","or","but","in","on","at","to","for","of","with","by","from","is","are","was","were","be","been","have","has","had","it","its","i","my","me","we","our","you","your","he","she","they","them","this","that","not","no"]); for (const w of words) { if (!stopWords.has(w)) freq[w] = (freq[w] || 0) + 1; } const ranked = Object.entries(freq).sort((a,b) => b[1] - a[1]); return { ok: true, result: { totalWords: words.length, uniqueWords: Object.keys(freq).length, topWords: ranked.slice(0,10).map(([w,c]) => ({ word: w, count: c })), keyImages: ranked.slice(0,5).map(([w]) => w), lexicalDensity: Math.round((Object.keys(freq).length / words.length) * 100) } }; });

  /**
   * poetrydb-search — Real classical poetry lookup via PoetryDB.
   * Free, no API key. ~3000 poems by 100+ public-domain authors
   * (Shakespeare, Dickinson, Frost, Whitman, etc.).
   *
   * params: { author?: string, title?: string, lines?: string (linecount: "14" or substring) }
   */
  registerLensAction("poetry", "poetrydb-search", async (_ctx, _artifact, params = {}) => {
    const author = params.author ? String(params.author).trim() : null;
    const title = params.title ? String(params.title).trim() : null;
    if (!author && !title) return { ok: false, error: "author or title required" };
    let path;
    if (author && title) {
      path = `/author,title/${encodeURIComponent(author)};${encodeURIComponent(title)}`;
    } else if (author) {
      path = `/author/${encodeURIComponent(author)}`;
    } else {
      path = `/title/${encodeURIComponent(title)}`;
    }
    try {
      const r = await fetch(`${POETRYDB_BASE}${path}`);
      if (!r.ok) throw new Error(`poetrydb ${r.status}`);
      const data = await r.json();
      // PoetryDB returns { status: 404, reason: "Not found" } on no match (still 200 HTTP)
      if (data && !Array.isArray(data) && data.status === 404) {
        return { ok: true, result: { poems: [], count: 0, source: "poetrydb", note: "no poems found" } };
      }
      const poems = (Array.isArray(data) ? data : []).map((p) => ({
        title: p.title,
        author: p.author,
        lines: p.lines || [],
        lineCount: parseInt(p.linecount, 10) || (p.lines || []).length,
      }));
      return {
        ok: true,
        result: { poems, count: poems.length, source: "poetrydb" },
      };
    } catch (e) {
      return { ok: false, error: `poetrydb unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * poetrydb-authors — Full list of authors available in PoetryDB.
   */
  registerLensAction("poetry", "poetrydb-authors", async (_ctx, _artifact, _params = {}) => {
    try {
      const r = await fetch(`${POETRYDB_BASE}/author`);
      if (!r.ok) throw new Error(`poetrydb ${r.status}`);
      const data = await r.json();
      const authors = data?.authors || [];
      return { ok: true, result: { authors, count: authors.length, source: "poetrydb" } };
    } catch (e) {
      return { ok: false, error: `poetrydb unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Poem workspace (per-user notebook with built-in prosody) ────────

  function getPoetryState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.poetryLens) STATE.poetryLens = {};
    if (!(STATE.poetryLens.poems instanceof Map)) STATE.poetryLens.poems = new Map(); // userId -> Array
    return STATE.poetryLens;
  }
  function savePoetry() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const poId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const poNow = () => new Date().toISOString();
  const poActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const poClean = (v, max = 12000) => String(v == null ? "" : v).trim().slice(0, max);
  const poList = (s, userId) => { if (!s.poems.has(userId)) s.poems.set(userId, []); return s.poems.get(userId); };

  // Compact prosody analysis shared by poem-analyze.
  function analyzePoem(body) {
    const lines = body.split("\n").filter((l) => l.trim());
    const syllables = lines.map((l) =>
      l.trim().split(/\s+/).reduce((s, w) => s + Math.max(1, (w.match(/[aeiouy]+/gi) || []).length), 0));
    const avg = syllables.length ? Math.round(syllables.reduce((a, b) => a + b, 0) / syllables.length * 10) / 10 : 0;
    const consistent = syllables.length > 1 && Math.max(...syllables) - Math.min(...syllables) <= 2;
    const endWords = lines.map((l) => {
      const w = l.trim().split(/\s+/);
      return (w[w.length - 1] || "").toLowerCase().replace(/[^a-z]/g, "");
    });
    const rhymeMap = {};
    let letter = 65;
    const scheme = endWords.map((w) => {
      const ending = w.length > 2 ? w.slice(-2) : w;
      if (!rhymeMap[ending]) rhymeMap[ending] = String.fromCharCode(letter++);
      return rhymeMap[ending];
    });
    const wordCount = body.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean).length;
    return {
      lineCount: lines.length,
      syllablesPerLine: syllables,
      avgSyllables: avg,
      meterConsistency: consistent ? "regular" : "irregular",
      rhymeScheme: scheme.join(""),
      rhyming: new Set(scheme).size < scheme.length,
      wordCount,
      detectedForm: syllables.length === 14 ? "sonnet"
        : syllables.join(",").includes("5,7,5") ? "haiku"
        : lines.length === 5 ? "limerick?"
        : "free-verse",
    };
  }

  registerLensAction("poetry", "poem-create", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = poClean(params.title, 160);
    if (!title) return { ok: false, error: "poem title required" };
    const poem = {
      id: poId("pm"),
      title,
      body: poClean(params.body, 12000),
      form: poClean(params.form, 40).toLowerCase() || "free-verse",
      tags: Array.isArray(params.tags) ? params.tags.map((t) => poClean(t, 30).toLowerCase()).filter(Boolean).slice(0, 8) : [],
      status: "draft",
      createdAt: poNow(),
      updatedAt: poNow(),
    };
    poList(s, poActor(ctx)).push(poem);
    savePoetry();
    return { ok: true, result: { poem } };
  });

  registerLensAction("poetry", "poem-list", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let poems = [...poList(s, poActor(ctx))];
    if (params.form) poems = poems.filter((p) => p.form === String(params.form).toLowerCase());
    if (params.status) poems = poems.filter((p) => p.status === params.status);
    poems.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const out = poems.map((p) => ({
      id: p.id, title: p.title, form: p.form, status: p.status,
      lineCount: p.body.split("\n").filter((l) => l.trim()).length, updatedAt: p.updatedAt,
    }));
    return { ok: true, result: { poems: out, count: out.length } };
  });

  registerLensAction("poetry", "poem-detail", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const poem = poList(s, poActor(ctx)).find((p) => p.id === params.id);
    if (!poem) return { ok: false, error: "poem not found" };
    return { ok: true, result: { poem } };
  });

  registerLensAction("poetry", "poem-update", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const poem = poList(s, poActor(ctx)).find((p) => p.id === params.id);
    if (!poem) return { ok: false, error: "poem not found" };
    if (params.title != null) poem.title = poClean(params.title, 160) || poem.title;
    if (params.body != null) poem.body = poClean(params.body, 12000);
    if (params.form != null) poem.form = poClean(params.form, 40).toLowerCase() || poem.form;
    if (params.status != null && ["draft", "revising", "finished"].includes(params.status)) poem.status = params.status;
    if (Array.isArray(params.tags)) poem.tags = params.tags.map((t) => poClean(t, 30).toLowerCase()).filter(Boolean).slice(0, 8);
    poem.updatedAt = poNow();
    savePoetry();
    return { ok: true, result: { poem } };
  });

  registerLensAction("poetry", "poem-delete", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = poList(s, poActor(ctx));
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "poem not found" };
    arr.splice(i, 1);
    savePoetry();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("poetry", "poem-analyze", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const poem = poList(s, poActor(ctx)).find((p) => p.id === params.id);
    if (!poem) return { ok: false, error: "poem not found" };
    if (!poem.body.trim()) return { ok: false, error: "poem has no text to analyze" };
    return { ok: true, result: { poemId: poem.id, title: poem.title, analysis: analyzePoem(poem.body) } };
  });

  registerLensAction("poetry", "poetry-dashboard", (ctx, _a, _params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const poems = poList(s, poActor(ctx));
    const byForm = {};
    for (const p of poems) byForm[p.form] = (byForm[p.form] || 0) + 1;
    return {
      ok: true,
      result: {
        poems: poems.length,
        finished: poems.filter((p) => p.status === "finished").length,
        drafts: poems.filter((p) => p.status === "draft").length,
        totalLines: poems.reduce((n, p) => n + p.body.split("\n").filter((l) => l.trim()).length, 0),
        byForm,
      },
    };
  });
}
