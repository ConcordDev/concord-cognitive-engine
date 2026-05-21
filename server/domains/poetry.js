// server/domains/poetry.js
//
// Pure-compute poetry helpers (meter, rhyme scheme, form guide,
// word frequency) plus real PoetryDB integration (~3000 classical
// poems by 100+ authors). Free, no API key.

import { cachedFetchJson } from "../lib/external-fetch.js";

const POETRYDB_BASE = "https://poetrydb.org";
const DATAMUSE_BASE = "https://api.datamuse.com";

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

  // feed — ingest classic poems from the public-domain PoetryDB as DTUs.
  registerLensAction("poetry", "feed", async (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(12, Math.round(Number(params.limit) || 6)));
    try {
      const r = await fetch(`https://poetrydb.org/random/${limit}`);
      if (!r.ok) return { ok: false, error: `poetrydb ${r.status}` };
      const poems = await r.json();
      if (!Array.isArray(poems)) return { ok: false, error: "poetrydb returned no poems" };
      let ingested = 0, skipped = 0;
      const dtuIds = [];
      for (const p of poems) {
        const key = `${p.author}::${p.title}`;
        if (s.feedSeen.has(key)) { skipped++; continue; }
        const body = Array.isArray(p.lines) ? p.lines.join("\n") : "";
        const title = `${p.title} — ${p.author}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${p.title}\nby ${p.author}\n\n${body}`,
          tags: ["poetry", "feed", "public-domain"],
          source: "poetrydb-feed",
          meta: { poemTitle: p.title, author: p.author, lineCount: Array.isArray(p.lines) ? p.lines.length : 0 },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(key); }
      }
      savePoetry();
      return { ok: true, result: { ingested, skipped, source: "poetrydb", dtuIds } };
    } catch (e) {
      return { ok: false, error: `poetrydb unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Form constraint rules (shared by templates + live checking) ─────

  const FORM_RULES = {
    haiku: { lineCount: 3, syllablesPerLine: [5, 7, 5], rhyme: null,
      template: "first line — five beats\nthe middle holds seven beats\nclose with five again",
      hint: "3 lines · 5-7-5 syllables · no rhyme required" },
    sonnet: { lineCount: 14, syllablesPerLine: null, rhyme: "ABABCDCDEFEFGG", meterTarget: 10,
      template: "",
      hint: "14 lines · iambic pentameter (~10 syllables/line) · ABAB CDCD EFEF GG" },
    limerick: { lineCount: 5, syllablesPerLine: [9, 9, 6, 6, 9], rhyme: "AABBA",
      template: "",
      hint: "5 lines · AABBA rhyme · lines 1,2,5 longer; 3,4 shorter" },
    villanelle: { lineCount: 19, syllablesPerLine: null, rhyme: null, meterTarget: 10,
      template: "",
      hint: "19 lines · 5 tercets + a quatrain · 2 repeating refrains" },
    tercet: { lineCount: 3, syllablesPerLine: null, rhyme: "ABA",
      template: "",
      hint: "3 lines · often ABA rhyme" },
    couplet: { lineCount: 2, syllablesPerLine: null, rhyme: "AA",
      template: "",
      hint: "2 lines · rhyming pair" },
    quatrain: { lineCount: 4, syllablesPerLine: null, rhyme: "ABAB",
      template: "",
      hint: "4 lines · ABAB or AABB rhyme" },
    "free-verse": { lineCount: null, syllablesPerLine: null, rhyme: null,
      template: "",
      hint: "no fixed structure — let meaning shape the line" },
  };

  function syllablesForLine(line) {
    return line.trim().split(/\s+/).filter(Boolean)
      .reduce((s, w) => s + Math.max(1, (w.match(/[aeiouy]+/gi) || []).length), 0);
  }

  /**
   * form-rules — return the constraint spec for a poetic form so the
   * editor can do live constraint checking. Pure compute, no I/O.
   */
  registerLensAction("poetry", "form-rules", (_ctx, _a, params = {}) => {
    const form = poClean(params.form, 40).toLowerCase() || "free-verse";
    const rules = FORM_RULES[form] || FORM_RULES["free-verse"];
    return { ok: true, result: { form, rules: { ...rules } } };
  });

  /**
   * form-check — validate a poem body against a form's constraints and
   * return a per-line + overall pass/fail report for live editing.
   */
  registerLensAction("poetry", "form-check", (_ctx, _a, params = {}) => {
    const form = poClean(params.form, 40).toLowerCase() || "free-verse";
    const body = poClean(params.body, 12000);
    const rules = FORM_RULES[form] || FORM_RULES["free-verse"];
    const lines = body.split("\n").filter((l) => l.trim());
    const lineReports = lines.map((l, i) => {
      const syll = syllablesForLine(l);
      const target = Array.isArray(rules.syllablesPerLine) ? rules.syllablesPerLine[i] : rules.meterTarget;
      const ok = target == null || syll === target || (rules.meterTarget && Math.abs(syll - target) <= 2);
      return { index: i, syllables: syll, target: target ?? null, ok };
    });
    const violations = [];
    if (rules.lineCount != null && lines.length !== rules.lineCount) {
      violations.push(`expected ${rules.lineCount} lines, found ${lines.length}`);
    }
    for (const lr of lineReports) {
      if (!lr.ok && lr.target != null) {
        violations.push(`line ${lr.index + 1}: ${lr.syllables} syllables (want ${lr.target})`);
      }
    }
    return {
      ok: true,
      result: {
        form,
        valid: violations.length === 0 && lines.length > 0,
        lineCount: lines.length,
        expectedLineCount: rules.lineCount ?? null,
        lineReports,
        violations,
      },
    };
  });

  // ─── Inline rhyme + word suggestion (Datamuse, free, no key) ─────────

  /**
   * word-suggest — surface rhymes / near-rhymes / synonyms for a word as
   * the poet types. params: { word, kind?: 'rhyme'|'near'|'synonym'|'means-like' }
   */
  registerLensAction("poetry", "word-suggest", async (_ctx, _a, params = {}) => {
    const word = poClean(params.word, 60).toLowerCase().replace(/[^a-z'\- ]/g, "");
    if (!word) return { ok: false, error: "word required" };
    const kind = ["rhyme", "near", "synonym", "means-like"].includes(params.kind) ? params.kind : "rhyme";
    const paramByKind = {
      rhyme: `rel_rhy=${encodeURIComponent(word)}`,
      near: `rel_nry=${encodeURIComponent(word)}`,
      synonym: `rel_syn=${encodeURIComponent(word)}`,
      "means-like": `ml=${encodeURIComponent(word)}`,
    };
    const url = `${DATAMUSE_BASE}/words?${paramByKind[kind]}&md=s&max=30`;
    try {
      const data = await cachedFetchJson(url, { ttlMs: 30 * 60 * 1000 });
      const words = (Array.isArray(data) ? data : []).map((w) => ({
        word: w.word,
        score: w.score || 0,
        syllables: w.numSyllables || null,
      }));
      return { ok: true, result: { word, kind, words, count: words.length, source: "datamuse" } };
    } catch (e) {
      return { ok: false, error: `datamuse unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Poem-a-day / curated discovery feed ────────────────────────────

  // Themed collections built from real PoetryDB authors — each theme is
  // a curated author set; poems are fetched live, never hardcoded.
  const POETRY_THEMES = {
    "love-and-longing": { label: "Love & Longing", authors: ["Elizabeth Barrett Browning", "John Keats", "Christina Rossetti"] },
    "nature-and-seasons": { label: "Nature & Seasons", authors: ["Robert Frost", "William Wordsworth", "Emily Dickinson"] },
    "war-and-loss": { label: "War & Loss", authors: ["Wilfred Owen", "Walt Whitman"] },
    "wit-and-wonder": { label: "Wit & Wonder", authors: ["Lewis Carroll", "Edward Lear"] },
    "the-soul-and-time": { label: "The Soul & Time", authors: ["William Blake", "Percy Bysshe Shelley", "William Butler Yeats"] },
  };

  /**
   * discovery-themes — list available curated themed collections.
   */
  registerLensAction("poetry", "discovery-themes", (_ctx, _a, _params = {}) => {
    const themes = Object.entries(POETRY_THEMES).map(([id, t]) => ({
      id, label: t.label, authorCount: t.authors.length,
    }));
    return { ok: true, result: { themes, count: themes.length } };
  });

  /**
   * poem-of-the-day — a single featured poem, deterministic per calendar
   * day so every user sees the same poem on a given date (no randomness,
   * no hardcoded content — fetched live from PoetryDB).
   */
  registerLensAction("poetry", "poem-of-the-day", async (_ctx, _a, params = {}) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date || "")
      ? params.date : new Date().toISOString().slice(0, 10);
    try {
      // Day-seeded pick across the whole catalogue of authors.
      const authorsData = await cachedFetchJson(`${POETRYDB_BASE}/author`, { ttlMs: 24 * 60 * 60 * 1000 });
      const authors = authorsData?.authors || [];
      if (!authors.length) return { ok: false, error: "poetrydb returned no authors" };
      let seed = 0;
      for (const ch of date) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
      const author = authors[seed % authors.length];
      const poems = await cachedFetchJson(
        `${POETRYDB_BASE}/author/${encodeURIComponent(author)}`,
        { ttlMs: 24 * 60 * 60 * 1000 });
      const list = Array.isArray(poems) ? poems : [];
      if (!list.length) return { ok: false, error: "no poems found for featured author" };
      const p = list[seed % list.length];
      return {
        ok: true,
        result: {
          date,
          poem: {
            title: p.title,
            author: p.author,
            lines: p.lines || [],
            lineCount: parseInt(p.linecount, 10) || (p.lines || []).length,
          },
          source: "poetrydb",
        },
      };
    } catch (e) {
      return { ok: false, error: `poetrydb unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * themed-collection — fetch live poems for a curated theme.
   * params: { themeId, perAuthor?: number }
   */
  registerLensAction("poetry", "themed-collection", async (_ctx, _a, params = {}) => {
    const theme = POETRY_THEMES[params.themeId];
    if (!theme) return { ok: false, error: "unknown theme" };
    const perAuthor = Math.max(1, Math.min(3, Math.round(Number(params.perAuthor) || 2)));
    const poems = [];
    for (const author of theme.authors) {
      try {
        const data = await cachedFetchJson(
          `${POETRYDB_BASE}/author/${encodeURIComponent(author)}`,
          { ttlMs: 24 * 60 * 60 * 1000 });
        const list = Array.isArray(data) ? data : [];
        for (const p of list.slice(0, perAuthor)) {
          poems.push({
            title: p.title,
            author: p.author,
            lines: p.lines || [],
            lineCount: parseInt(p.linecount, 10) || (p.lines || []).length,
          });
        }
      } catch (_e) { /* skip an unreachable author, keep the rest */ }
    }
    if (!poems.length) return { ok: false, error: "poetrydb unreachable for this theme" };
    return {
      ok: true,
      result: { themeId: params.themeId, label: theme.label, poems, count: poems.length, source: "poetrydb" },
    };
  });

  // ─── Reading history + favorites (bookmark discovered poems) ─────────

  function poFavList(s, userId) {
    if (!(s.favorites instanceof Map)) s.favorites = new Map();
    if (!s.favorites.has(userId)) s.favorites.set(userId, []);
    return s.favorites.get(userId);
  }
  function poHistList(s, userId) {
    if (!(s.history instanceof Map)) s.history = new Map();
    if (!s.history.has(userId)) s.history.set(userId, []);
    return s.history.get(userId);
  }
  const poRefOf = (title, author) =>
    `${poClean(author, 80).toLowerCase()}::${poClean(title, 200).toLowerCase()}`;

  /**
   * favorite-add — bookmark a discovered poem (real title/author/lines).
   */
  registerLensAction("poetry", "favorite-add", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = poClean(params.title, 200);
    const author = poClean(params.author, 80);
    if (!title) return { ok: false, error: "poem title required" };
    const arr = poFavList(s, poActor(ctx));
    const ref = poRefOf(title, author);
    if (arr.some((f) => f.ref === ref)) {
      return { ok: true, result: { favorite: arr.find((f) => f.ref === ref), already: true } };
    }
    const lines = Array.isArray(params.lines)
      ? params.lines.map((l) => poClean(l, 400)).slice(0, 200) : [];
    const fav = {
      id: poId("fav"),
      ref,
      title,
      author: author || "Unknown",
      lines,
      lineCount: lines.length,
      source: poClean(params.source, 40) || "poetrydb",
      savedAt: poNow(),
    };
    arr.unshift(fav);
    if (arr.length > 500) arr.length = 500;
    savePoetry();
    return { ok: true, result: { favorite: fav } };
  });

  /**
   * favorite-list — list a user's bookmarked poems.
   */
  registerLensAction("poetry", "favorite-list", (ctx, _a, _params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const favorites = [...poFavList(s, poActor(ctx))];
    return { ok: true, result: { favorites, count: favorites.length } };
  });

  /**
   * favorite-remove — un-bookmark a poem by id.
   */
  registerLensAction("poetry", "favorite-remove", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = poFavList(s, poActor(ctx));
    const i = arr.findIndex((f) => f.id === params.id);
    if (i < 0) return { ok: false, error: "favorite not found" };
    arr.splice(i, 1);
    savePoetry();
    return { ok: true, result: { removed: params.id } };
  });

  /**
   * reading-log — record that the user opened/read a discovered poem.
   */
  registerLensAction("poetry", "reading-log", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = poClean(params.title, 200);
    const author = poClean(params.author, 80);
    if (!title) return { ok: false, error: "poem title required" };
    const arr = poHistList(s, poActor(ctx));
    const ref = poRefOf(title, author);
    const existing = arr.find((h) => h.ref === ref);
    if (existing) {
      existing.readCount += 1;
      existing.lastReadAt = poNow();
    } else {
      arr.unshift({
        id: poId("rd"),
        ref,
        title,
        author: author || "Unknown",
        source: poClean(params.source, 40) || "poetrydb",
        readCount: 1,
        firstReadAt: poNow(),
        lastReadAt: poNow(),
      });
    }
    if (arr.length > 300) arr.length = 300;
    savePoetry();
    return { ok: true, result: { logged: ref } };
  });

  /**
   * reading-history — recently read discovered poems, most-recent first.
   */
  registerLensAction("poetry", "reading-history", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let history = [...poHistList(s, poActor(ctx))]
      .sort((a, b) => b.lastReadAt.localeCompare(a.lastReadAt));
    const limit = Math.max(1, Math.min(100, Math.round(Number(params.limit) || 30)));
    history = history.slice(0, limit);
    return { ok: true, result: { history, count: history.length } };
  });

  // ─── Audio recordings — record / store / play poem readings ─────────
  // Audio is stored as a data URL the client captured via MediaRecorder.

  function poRecList(s, userId) {
    if (!(s.recordings instanceof Map)) s.recordings = new Map();
    if (!s.recordings.has(userId)) s.recordings.set(userId, []);
    return s.recordings.get(userId);
  }

  /**
   * recording-save — store an audio reading of one of the user's poems.
   * params: { poemId, audioDataUrl, durationSec, mimeType }
   */
  registerLensAction("poetry", "recording-save", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const poemId = poClean(params.poemId, 80);
    const poem = poList(s, poActor(ctx)).find((p) => p.id === poemId);
    if (!poem) return { ok: false, error: "poem not found" };
    const audioDataUrl = String(params.audioDataUrl || "");
    if (!audioDataUrl.startsWith("data:")) return { ok: false, error: "audio data URL required" };
    // Cap at ~6MB encoded to keep STATE light.
    if (audioDataUrl.length > 6 * 1024 * 1024) return { ok: false, error: "recording too large (max ~4MB)" };
    const arr = poRecList(s, poActor(ctx));
    const rec = {
      id: poId("rec"),
      poemId,
      poemTitle: poem.title,
      audioDataUrl,
      durationSec: Math.max(0, Math.round(Number(params.durationSec) || 0)),
      mimeType: poClean(params.mimeType, 60) || "audio/webm",
      createdAt: poNow(),
    };
    arr.unshift(rec);
    if (arr.length > 100) {
      arr.length = 100;
    }
    savePoetry();
    return { ok: true, result: { recording: { id: rec.id, poemId, poemTitle: rec.poemTitle, durationSec: rec.durationSec, createdAt: rec.createdAt } } };
  });

  /**
   * recording-list — list recordings, optionally filtered to one poem.
   * Omits the heavy audioDataUrl payload; use recording-get for playback.
   */
  registerLensAction("poetry", "recording-list", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let recs = [...poRecList(s, poActor(ctx))];
    if (params.poemId) recs = recs.filter((r) => r.poemId === params.poemId);
    const out = recs.map((r) => ({
      id: r.id, poemId: r.poemId, poemTitle: r.poemTitle,
      durationSec: r.durationSec, mimeType: r.mimeType, createdAt: r.createdAt,
    }));
    return { ok: true, result: { recordings: out, count: out.length } };
  });

  /**
   * recording-get — fetch a single recording with its audio payload.
   */
  registerLensAction("poetry", "recording-get", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rec = poRecList(s, poActor(ctx)).find((r) => r.id === params.id);
    if (!rec) return { ok: false, error: "recording not found" };
    return { ok: true, result: { recording: rec } };
  });

  /**
   * recording-delete — remove a recording.
   */
  registerLensAction("poetry", "recording-delete", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = poRecList(s, poActor(ctx));
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "recording not found" };
    arr.splice(i, 1);
    savePoetry();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── Workshop / peer feedback — share + line-level critique ──────────

  function poShareList(s) {
    if (!(s.workshop instanceof Map)) s.workshop = new Map();
    return s.workshop; // shareId -> shared poem record
  }

  /**
   * workshop-share — publish one of the user's poems to the shared
   * workshop so peers can leave line-level critique.
   */
  registerLensAction("poetry", "workshop-share", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = poActor(ctx);
    const poem = poList(s, userId).find((p) => p.id === params.poemId);
    if (!poem) return { ok: false, error: "poem not found" };
    if (!poem.body.trim()) return { ok: false, error: "poem has no text to share" };
    const shared = poShareList(s);
    // One share per poem — re-share updates the snapshot.
    let existing = null;
    for (const v of shared.values()) {
      if (v.poemId === poem.id && v.ownerId === userId) { existing = v; break; }
    }
    if (existing) {
      existing.title = poem.title;
      existing.body = poem.body;
      existing.form = poem.form;
      existing.updatedAt = poNow();
      savePoetry();
      return { ok: true, result: { share: { id: existing.id, title: existing.title, critiqueCount: existing.critiques.length }, reshared: true } };
    }
    const share = {
      id: poId("ws"),
      poemId: poem.id,
      ownerId: userId,
      ownerName: poClean(params.authorName, 60) || "Anonymous",
      title: poem.title,
      body: poem.body,
      form: poem.form,
      note: poClean(params.note, 600),
      critiques: [],
      createdAt: poNow(),
      updatedAt: poNow(),
    };
    shared.set(share.id, share);
    savePoetry();
    return { ok: true, result: { share: { id: share.id, title: share.title, critiqueCount: 0 } } };
  });

  /**
   * workshop-list — browse poems shared to the workshop by all users.
   */
  registerLensAction("poetry", "workshop-list", (_ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const shared = [...poShareList(s).values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const out = shared.map((sh) => ({
      id: sh.id,
      title: sh.title,
      ownerName: sh.ownerName,
      form: sh.form,
      lineCount: sh.body.split("\n").filter((l) => l.trim()).length,
      critiqueCount: sh.critiques.length,
      note: sh.note,
      updatedAt: sh.updatedAt,
    }));
    const limit = Math.max(1, Math.min(100, Math.round(Number(params.limit) || 40)));
    return { ok: true, result: { shares: out.slice(0, limit), count: out.length } };
  });

  /**
   * workshop-detail — the full shared poem with its line-level critiques.
   */
  registerLensAction("poetry", "workshop-detail", (_ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const share = poShareList(s).get(params.id);
    if (!share) return { ok: false, error: "shared poem not found" };
    return {
      ok: true,
      result: {
        share: {
          id: share.id,
          title: share.title,
          ownerName: share.ownerName,
          form: share.form,
          body: share.body,
          note: share.note,
          critiques: [...share.critiques].sort((a, b) =>
            (a.lineIndex - b.lineIndex) || a.createdAt.localeCompare(b.createdAt)),
          createdAt: share.createdAt,
        },
      },
    };
  });

  /**
   * workshop-critique — leave a line-level critique on a shared poem.
   * params: { id (shareId), lineIndex, comment, criticName, kind? }
   */
  registerLensAction("poetry", "workshop-critique", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const share = poShareList(s).get(params.id);
    if (!share) return { ok: false, error: "shared poem not found" };
    const comment = poClean(params.comment, 1000);
    if (!comment) return { ok: false, error: "critique comment required" };
    const lineCount = share.body.split("\n").length;
    let lineIndex = Math.round(Number(params.lineIndex));
    if (!Number.isFinite(lineIndex) || lineIndex < -1) lineIndex = -1; // -1 = whole-poem note
    if (lineIndex >= lineCount) lineIndex = lineCount - 1;
    const kind = ["praise", "suggestion", "question"].includes(params.kind) ? params.kind : "suggestion";
    const critique = {
      id: poId("crit"),
      lineIndex,
      comment,
      kind,
      criticId: poActor(ctx),
      criticName: poClean(params.criticName, 60) || "Anonymous",
      createdAt: poNow(),
    };
    share.critiques.push(critique);
    share.updatedAt = poNow();
    savePoetry();
    return { ok: true, result: { critique, critiqueCount: share.critiques.length } };
  });

  /**
   * workshop-unshare — owner removes their poem from the workshop.
   */
  registerLensAction("poetry", "workshop-unshare", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const shared = poShareList(s);
    const share = shared.get(params.id);
    if (!share) return { ok: false, error: "shared poem not found" };
    if (share.ownerId !== poActor(ctx)) return { ok: false, error: "only the owner can unshare" };
    shared.delete(params.id);
    savePoetry();
    return { ok: true, result: { unshared: params.id } };
  });

  // ─── Publish / collection export — chapbook ─────────────────────────

  /**
   * chapbook-export — assemble selected poems into a chapbook manuscript.
   * Returns a structured manuscript + a print-ready HTML document the
   * client can save as PDF (browser print-to-PDF) or download as a file.
   * params: { title, author, poemIds?: string[] (default: all finished) }
   */
  registerLensAction("poetry", "chapbook-export", (ctx, _a, params = {}) => {
    const s = getPoetryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const poems = poList(s, poActor(ctx));
    let selected;
    if (Array.isArray(params.poemIds) && params.poemIds.length) {
      const ids = new Set(params.poemIds.map((x) => String(x)));
      selected = poems.filter((p) => ids.has(p.id));
    } else {
      selected = poems.filter((p) => p.status === "finished");
    }
    if (!selected.length) return { ok: false, error: "no poems selected for the chapbook" };
    const cbTitle = poClean(params.title, 160) || "Collected Poems";
    const cbAuthor = poClean(params.author, 80) || "Anonymous";
    const esc = (v) => String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const manuscript = selected.map((p, i) => ({
      order: i + 1,
      title: p.title,
      form: p.form,
      body: p.body,
      lineCount: p.body.split("\n").filter((l) => l.trim()).length,
    }));
    const totalLines = manuscript.reduce((n, m) => n + m.lineCount, 0);
    const toc = manuscript
      .map((m) => `      <li>${esc(m.title)}</li>`).join("\n");
    const pages = manuscript.map((m) => `    <section class="poem">
      <h2>${esc(m.title)}</h2>
      <pre>${esc(m.body)}</pre>
    </section>`).join("\n");
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(cbTitle)}</title>
  <style>
    @page { margin: 2.4cm; }
    body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; line-height: 1.6; }
    .cover { text-align: center; padding: 30vh 0; page-break-after: always; }
    .cover h1 { font-size: 2.4rem; font-style: italic; margin: 0 0 0.6rem; }
    .cover p { font-size: 1.1rem; color: #555; }
    .toc { page-break-after: always; }
    .toc h2 { font-variant: small-caps; }
    .toc ol { line-height: 2; }
    .poem { page-break-inside: avoid; margin-bottom: 3rem; }
    .poem h2 { font-style: italic; font-weight: normal; font-size: 1.4rem; }
    .poem pre { font-family: Georgia, serif; white-space: pre-wrap; font-size: 1.05rem; }
  </style>
</head>
<body>
  <div class="cover">
    <h1>${esc(cbTitle)}</h1>
    <p>poems by ${esc(cbAuthor)}</p>
    <p>${manuscript.length} poems · ${totalLines} lines</p>
  </div>
  <div class="toc">
    <h2>Contents</h2>
    <ol>
${toc}
    </ol>
  </div>
${pages}
</body>
</html>`;
    return {
      ok: true,
      result: {
        chapbook: {
          title: cbTitle,
          author: cbAuthor,
          poemCount: manuscript.length,
          totalLines,
          manuscript,
        },
        html,
        filename: `${cbTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chapbook"}.html`,
      },
    };
  });
}
