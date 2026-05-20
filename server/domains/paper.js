// server/domains/paper.js
export default function registerPaperActions(registerLensAction) {
  registerLensAction("paper", "citationAnalyze", (ctx, artifact, _params) => {
    const citations = artifact.data?.citations || artifact.data?.references || [];
    if (citations.length === 0) return { ok: true, result: { message: "Add citations/references to analyze." } };
    const now = new Date().getFullYear();
    const byType = {};
    const byYear = {};
    let selfCites = 0;
    const authorName = artifact.data?.author || "";
    citations.forEach(c => {
      const type = c.type || (c.journal ? "journal" : c.conference ? "conference" : c.url ? "web" : "other");
      byType[type] = (byType[type] || 0) + 1;
      const year = parseInt(c.year) || 0;
      if (year > 1900) byYear[year] = (byYear[year] || 0) + 1;
      if (authorName && (c.authors || "").toLowerCase().includes(authorName.toLowerCase())) selfCites++;
    });
    const years = Object.keys(byYear).map(Number).sort();
    const medianYear = years.length > 0 ? years[Math.floor(years.length / 2)] : now;
    const recent5yr = citations.filter(c => (parseInt(c.year) || 0) >= now - 5).length;
    return { ok: true, result: { totalCitations: citations.length, byType, byYear, selfCitations: selfCites, selfCitationRate: Math.round((selfCites / citations.length) * 100), medianYear, recencyIndex: Math.round((recent5yr / citations.length) * 100), recentCount: recent5yr, oldestYear: years[0] || null, newestYear: years[years.length - 1] || null, avgAge: years.length > 0 ? Math.round(now - years.reduce((s, y) => s + y, 0) / years.length) : null } };
  });

  registerLensAction("paper", "readabilityScore", (ctx, artifact, _params) => {
    const text = artifact.data?.text || artifact.data?.content || "";
    if (!text || text.length < 50) return { ok: true, result: { message: "Provide at least 50 characters of text to score." } };
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 2);
    const words = text.split(/\s+/).filter(Boolean);
    const syllableCount = w => {
      const word = w.toLowerCase().replace(/[^a-z]/g, "");
      if (word.length <= 3) return 1;
      const count = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").match(/[aeiouy]{1,2}/g);
      return count ? count.length : 1;
    };
    const totalSyllables = words.reduce((s, w) => s + syllableCount(w), 0);
    const avgSyllables = totalSyllables / words.length;
    const avgWordsPerSentence = words.length / Math.max(1, sentences.length);
    const fleschKincaid = Math.round((0.39 * avgWordsPerSentence + 11.8 * avgSyllables - 15.59) * 10) / 10;
    const fleschEase = Math.round((206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllables) * 10) / 10;
    const complexWords = words.filter(w => syllableCount(w) >= 3).length;
    const gunningFog = Math.round((avgWordsPerSentence + 100 * (complexWords / words.length)) * 0.4 * 10) / 10;
    let level;
    if (fleschKincaid <= 6) level = "Elementary";
    else if (fleschKincaid <= 8) level = "Middle School";
    else if (fleschKincaid <= 12) level = "High School";
    else if (fleschKincaid <= 16) level = "College";
    else level = "Graduate";
    return { ok: true, result: { fleschKincaidGrade: fleschKincaid, fleschReadingEase: fleschEase, gunningFog, readingLevel: level, stats: { words: words.length, sentences: sentences.length, avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10, avgSyllablesPerWord: Math.round(avgSyllables * 100) / 100, complexWordRate: Math.round((complexWords / words.length) * 100) } } };
  });

  registerLensAction("paper", "abstractSummarize", (ctx, artifact, _params) => {
    const text = artifact.data?.text || artifact.data?.content || "";
    if (!text || text.length < 100) return { ok: true, result: { message: "Provide at least 100 characters of text to summarize." } };
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
    if (sentences.length < 3) return { ok: true, result: { message: "Need at least 3 sentences to summarize." } };
    const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "shall", "can", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between", "under", "and", "but", "or", "nor", "not", "so", "yet", "both", "either", "neither", "each", "every", "all", "any", "few", "more", "most", "other", "some", "such", "no", "only", "own", "same", "than", "too", "very", "just", "because", "if", "when", "which", "who", "whom", "this", "that", "these", "those", "it", "its", "we", "our", "they", "their", "he", "she", "his", "her"]);
    const wordFreq = {};
    sentences.forEach(s => s.toLowerCase().split(/\s+/).forEach(w => { const clean = w.replace(/[^a-z]/g, ""); if (clean.length > 2 && !stopWords.has(clean)) wordFreq[clean] = (wordFreq[clean] || 0) + 1; }));
    const maxFreq = Math.max(...Object.values(wordFreq));
    const scored = sentences.map((s, i) => {
      const words = s.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z]/g, "")).filter(w => w.length > 2);
      const score = words.reduce((sum, w) => sum + ((wordFreq[w] || 0) / maxFreq), 0) / Math.max(1, words.length);
      const positionBoost = i === 0 ? 0.3 : i === sentences.length - 1 ? 0.2 : 0;
      return { sentence: s, score: score + positionBoost, index: i };
    }).sort((a, b) => b.score - a.score);
    const topN = Math.max(2, Math.min(5, Math.ceil(sentences.length * 0.3)));
    const summary = scored.slice(0, topN).sort((a, b) => a.index - b.index).map(s => s.sentence);
    const keywords = Object.entries(wordFreq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
    return { ok: true, result: { summary: summary.join(". ") + ".", sentenceCount: sentences.length, summaryLength: summary.length, compressionRatio: Math.round((summary.length / sentences.length) * 100), keywords } };
  });

  registerLensAction("paper", "revisionDiff", (ctx, artifact, _params) => {
    const oldText = artifact.data?.original || artifact.data?.v1 || "";
    const newText = artifact.data?.revised || artifact.data?.v2 || "";
    if (!oldText || !newText) return { ok: true, result: { message: "Provide 'original' and 'revised' text to compare." } };
    const oldLines = oldText.split("\n");
    const newLines = newText.split("\n");
    const oldWords = oldText.split(/\s+/).filter(Boolean);
    const newWords = newText.split(/\s+/).filter(Boolean);
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    const added = newLines.filter(l => !oldSet.has(l));
    const removed = oldLines.filter(l => !newSet.has(l));
    const unchanged = oldLines.filter(l => newSet.has(l));
    const oldChars = oldText.length;
    const newChars = newText.length;
    return { ok: true, result: { oldStats: { lines: oldLines.length, words: oldWords.length, chars: oldChars }, newStats: { lines: newLines.length, words: newWords.length, chars: newChars }, diff: { linesAdded: added.length, linesRemoved: removed.length, linesUnchanged: unchanged.length, wordDelta: newWords.length - oldWords.length, charDelta: newChars - oldChars }, changeRate: Math.round(((added.length + removed.length) / Math.max(1, oldLines.length)) * 100), addedPreview: added.slice(0, 10), removedPreview: removed.slice(0, 10) } };
  });

  // ─── Real paper search via arXiv (free, no key) ──
  //
  // arXiv export API: http://export.arxiv.org/api/query — returns Atom XML
  // with title, summary, authors, published date, primary category, links
  // to PDF/abstract. Covers physics, math, CS, biology, finance, statistics,
  // economics. Comprehensive academic preprint repository.

  function parseArxivAtom(xml) {
    // Lightweight Atom parser — extracts <entry> blocks
    const entries = [];
    const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    for (const entryXml of entryMatches) {
      const get = (tag) => {
        const m = entryXml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
        return m ? m[1].trim() : "";
      };
      const id = get("id");
      const arxivId = id.replace(/^http(s)?:\/\/arxiv\.org\/abs\//, "").trim();
      const authors = [];
      const authorMatches = entryXml.match(/<author>[\s\S]*?<\/author>/g) || [];
      for (const am of authorMatches) {
        const n = am.match(/<name>([\s\S]*?)<\/name>/);
        if (n) authors.push(n[1].trim());
      }
      const linkPdf = entryXml.match(/<link[^>]+title="pdf"[^>]+href="([^"]+)"/);
      entries.push({
        id: arxivId,
        title: get("title").replace(/\s+/g, " "),
        abstract: get("summary").replace(/\s+/g, " "),
        authors,
        published: get("published"),
        updated: get("updated"),
        url: id,
        pdfUrl: linkPdf ? linkPdf[1] : null,
        primaryCategory: (entryXml.match(/<arxiv:primary_category[^>]+term="([^"]+)"/) || [, null])[1],
      });
    }
    return entries;
  }

  registerLensAction("paper", "search", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 20));
    try {
      const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent("all:" + query)}&start=0&max_results=${limit}&sortBy=relevance`;
      const r = await globalThis.fetch(url);
      if (!r.ok) return { ok: false, error: `arxiv ${r.status}` };
      const xml = await r.text();
      const papers = parseArxivAtom(xml);
      return {
        ok: true,
        result: {
          papers,
          query,
          count: papers.length,
          source: "arXiv export API",
        },
      };
    } catch (e) {
      return { ok: false, error: `arxiv search failed: ${e?.message || "network"}` };
    }
  });

  registerLensAction("paper", "summarize", async (ctx, _artifact, params = {}) => {
    const text = String(params.text || "").trim();
    if (text.length < 300) return { ok: false, error: "text too short" };
    if (!ctx?.llm?.chat) {
      return { ok: true, result: { problem: "(AI unavailable)", approach: text.slice(0, 200), results: "", limitations: "", whyItMatters: "", keyTerms: [] } };
    }
    const sys = `Summarize a research paper. Output ONLY JSON: {"problem":"...","approach":"...","results":"...","limitations":"...","whyItMatters":"...","keyTerms":["..."]}. Each field 1-2 sentences; keyTerms 3-6 strings.`;
    try {
      const r = await ctx.llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: text.slice(0, 10000) }],
        temperature: 0.2, maxTokens: 1500, slot: "conscious",
      });
      const raw = String(r?.text || r?.content || "").trim();
      const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const body = fence ? fence[1] : raw;
      const first = body.indexOf("{");
      const last = body.lastIndexOf("}");
      if (first < 0) return { ok: false, error: "parse failed" };
      const parsed = JSON.parse(body.slice(first, last + 1));
      return { ok: true, result: parsed };
    } catch (e) { return { ok: false, error: e?.message || "summarize failed" }; }
  });

  // ─── Paper library (Semantic Scholar / Zotero-shape reading list) ────

  function getPaperState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.paperLens) STATE.paperLens = {};
    const s = STATE.paperLens;
    if (!(s.papers instanceof Map)) s.papers = new Map();           // userId -> Array
    if (!(s.collections instanceof Map)) s.collections = new Map(); // userId -> Array
    return s;
  }
  function savePaper() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const ppId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const ppNow = () => new Date().toISOString();
  const ppActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const ppClean = (v, max = 600) => String(v == null ? "" : v).trim().slice(0, max);
  const ppList = (s, userId) => { if (!s.papers.has(userId)) s.papers.set(userId, []); return s.papers.get(userId); };
  const ppCollections = (s, userId) => { if (!s.collections.has(userId)) s.collections.set(userId, []); return s.collections.get(userId); };
  const READ_STATUS = ["to_read", "reading", "read"];

  registerLensAction("paper", "paper-save", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = ppClean(params.title, 400);
    if (!title) return { ok: false, error: "paper title required" };
    const list = ppList(s, ppActor(ctx));
    const refId = ppClean(params.refId, 120) || title.toLowerCase();
    if (list.some((p) => p.refId === refId)) return { ok: false, error: "paper already in your library" };
    const paper = {
      id: ppId("pp"),
      refId,
      title,
      authors: Array.isArray(params.authors) ? params.authors.map((a) => ppClean(a, 120)).filter(Boolean).slice(0, 30) : [],
      year: Number.isFinite(Number(params.year)) ? Math.round(Number(params.year)) : null,
      venue: ppClean(params.venue, 200) || null,
      abstract: ppClean(params.abstract, 6000) || "",
      url: ppClean(params.url, 600) || null,
      doi: ppClean(params.doi, 120) || null,
      status: "to_read",
      rating: null,
      tags: Array.isArray(params.tags) ? params.tags.map((t) => ppClean(t, 30).toLowerCase()).filter(Boolean).slice(0, 8) : [],
      notes: "",
      collectionIds: [],
      addedAt: ppNow(),
    };
    list.push(paper);
    savePaper();
    return { ok: true, result: { paper } };
  });

  registerLensAction("paper", "paper-list", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let papers = [...ppList(s, ppActor(ctx))];
    if (params.status && READ_STATUS.includes(params.status)) papers = papers.filter((p) => p.status === params.status);
    if (params.collectionId) papers = papers.filter((p) => p.collectionIds.includes(params.collectionId));
    if (params.tag) {
      const t = ppClean(params.tag, 30).toLowerCase();
      papers = papers.filter((p) => p.tags.includes(t));
    }
    const q = ppClean(params.query, 120).toLowerCase();
    if (q) papers = papers.filter((p) => p.title.toLowerCase().includes(q) || p.abstract.toLowerCase().includes(q));
    papers.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return { ok: true, result: { papers, count: papers.length } };
  });

  registerLensAction("paper", "paper-detail", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const paper = ppList(s, ppActor(ctx)).find((p) => p.id === params.id);
    if (!paper) return { ok: false, error: "paper not found" };
    return { ok: true, result: { paper } };
  });

  registerLensAction("paper", "paper-update", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const paper = ppList(s, ppActor(ctx)).find((p) => p.id === params.id);
    if (!paper) return { ok: false, error: "paper not found" };
    if (params.status != null && READ_STATUS.includes(params.status)) paper.status = params.status;
    if (params.rating != null) paper.rating = Number.isFinite(Number(params.rating)) ? Math.max(1, Math.min(5, Math.round(Number(params.rating)))) : null;
    if (params.notes != null) paper.notes = ppClean(params.notes, 8000);
    if (Array.isArray(params.tags)) paper.tags = params.tags.map((t) => ppClean(t, 30).toLowerCase()).filter(Boolean).slice(0, 8);
    savePaper();
    return { ok: true, result: { paper } };
  });

  registerLensAction("paper", "paper-delete", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = ppList(s, ppActor(ctx));
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "paper not found" };
    arr.splice(i, 1);
    savePaper();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("paper", "collection-create", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = ppClean(params.name, 120);
    if (!name) return { ok: false, error: "collection name required" };
    const collection = { id: ppId("col"), name, createdAt: ppNow() };
    ppCollections(s, ppActor(ctx)).push(collection);
    savePaper();
    return { ok: true, result: { collection } };
  });

  registerLensAction("paper", "collection-list", (ctx, _a, _params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = ppActor(ctx);
    const papers = ppList(s, userId);
    const collections = ppCollections(s, userId).map((c) => ({
      ...c, paperCount: papers.filter((p) => p.collectionIds.includes(c.id)).length,
    }));
    return { ok: true, result: { collections, count: collections.length } };
  });

  registerLensAction("paper", "collection-assign", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = ppActor(ctx);
    const paper = ppList(s, userId).find((p) => p.id === params.paperId);
    if (!paper) return { ok: false, error: "paper not found" };
    const collection = ppCollections(s, userId).find((c) => c.id === params.collectionId);
    if (!collection) return { ok: false, error: "collection not found" };
    if (params.remove === true) {
      paper.collectionIds = paper.collectionIds.filter((id) => id !== collection.id);
    } else if (!paper.collectionIds.includes(collection.id)) {
      paper.collectionIds.push(collection.id);
    }
    savePaper();
    return { ok: true, result: { paperId: paper.id, collectionIds: paper.collectionIds } };
  });

  registerLensAction("paper", "library-dashboard", (ctx, _a, _params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = ppActor(ctx);
    const papers = ppList(s, userId);
    return {
      ok: true,
      result: {
        totalPapers: papers.length,
        toRead: papers.filter((p) => p.status === "to_read").length,
        reading: papers.filter((p) => p.status === "reading").length,
        read: papers.filter((p) => p.status === "read").length,
        collections: ppCollections(s, userId).length,
        withNotes: papers.filter((p) => p.notes && p.notes.trim()).length,
      },
    };
  });

  // feed — ingest the latest scholarly works (Crossref) as visible DTUs.
  registerLensAction("paper", "feed", async (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 10)));
    try {
      const r = await fetch(`https://api.crossref.org/works?sort=created&order=desc&rows=${limit}&select=DOI,title,author,container-title,created`, {
        headers: { "User-Agent": "Concord-OS/1.0 (https://concord-os.org)" },
      });
      if (!r.ok) return { ok: false, error: `crossref ${r.status}` };
      const data = await r.json();
      const items = data.message?.items || [];
      let ingested = 0, skipped = 0;
      const dtuIds = [];
      for (const it of items) {
        if (!it.DOI || s.feedSeen.has(it.DOI)) { skipped++; continue; }
        const title = ppClean(Array.isArray(it.title) ? it.title[0] : it.title, 300) || "Untitled work";
        const authors = (it.author || []).map((a) => `${a.given || ""} ${a.family || ""}`.trim()).filter(Boolean);
        const venue = Array.isArray(it["container-title"]) ? it["container-title"][0] : null;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nAuthors: ${authors.join(", ") || "—"}\nVenue: ${venue || "—"}\nDOI: ${it.DOI}\nhttps://doi.org/${it.DOI}`,
          tags: ["paper", "feed", "crossref"],
          source: "crossref-feed",
          meta: { doi: it.DOI, authors, venue },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(it.DOI); }
      }
      savePaper();
      return { ok: true, result: { ingested, skipped, source: "crossref", dtuIds } };
    } catch (e) {
      return { ok: false, error: `crossref unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}

// Note: prior versions held a SAMPLE_PAPERS array of 8 hand-curated ML
// preprints used to back paper-search. Per the "everything must be real"
// directive, that table has been removed — paper.search now hits the
// arXiv export API directly (free, no key, full preprint repository
// covering physics, math, CS, biology, finance, statistics, economics).
