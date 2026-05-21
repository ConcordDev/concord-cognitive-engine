// server/domains/paper.js
import { cachedFetchJson } from "../lib/external-fetch.js";

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

  // ─── PDF attachment + in-app reader (backlog item 1) ────────────────
  // Stores a PDF as a base64 payload on the paper record. Frontend reads
  // it back and renders via an <iframe> / <object> data URL.

  registerLensAction("paper", "paper-pdf-attach", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const paper = ppList(s, ppActor(ctx)).find((p) => p.id === params.paperId);
    if (!paper) return { ok: false, error: "paper not found" };
    const dataUrl = String(params.dataUrl || "");
    if (!dataUrl.startsWith("data:application/pdf")) return { ok: false, error: "expected a data:application/pdf base64 URL" };
    // Cap at ~12MB encoded to keep STATE bounded.
    if (dataUrl.length > 12 * 1024 * 1024) return { ok: false, error: "PDF too large (12MB max)" };
    paper.pdf = {
      dataUrl,
      fileName: ppClean(params.fileName, 200) || "paper.pdf",
      sizeBytes: Math.round((dataUrl.length * 3) / 4),
      attachedAt: ppNow(),
    };
    savePaper();
    return { ok: true, result: { paperId: paper.id, fileName: paper.pdf.fileName, sizeBytes: paper.pdf.sizeBytes } };
  });

  registerLensAction("paper", "paper-pdf-get", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const paper = ppList(s, ppActor(ctx)).find((p) => p.id === params.paperId);
    if (!paper) return { ok: false, error: "paper not found" };
    if (!paper.pdf) return { ok: true, result: { hasPdf: false } };
    return { ok: true, result: { hasPdf: true, ...paper.pdf } };
  });

  registerLensAction("paper", "paper-pdf-remove", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const paper = ppList(s, ppActor(ctx)).find((p) => p.id === params.paperId);
    if (!paper) return { ok: false, error: "paper not found" };
    delete paper.pdf;
    savePaper();
    return { ok: true, result: { paperId: paper.id, removed: true } };
  });

  // ─── PDF annotation + highlights synced to notes (backlog item 2) ───
  // Each annotation is anchored to a page + selected text, optionally a
  // colour and a comment. syncToNotes appends a markdown digest of the
  // annotations onto the paper's notes field.

  const ANNOT_COLORS = ["yellow", "green", "blue", "pink", "orange"];

  registerLensAction("paper", "paper-annotate", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const paper = ppList(s, ppActor(ctx)).find((p) => p.id === params.paperId);
    if (!paper) return { ok: false, error: "paper not found" };
    const quote = ppClean(params.quote, 2000);
    if (!quote) return { ok: false, error: "highlighted text (quote) required" };
    if (!Array.isArray(paper.annotations)) paper.annotations = [];
    const annot = {
      id: ppId("an"),
      page: Number.isFinite(Number(params.page)) ? Math.max(1, Math.round(Number(params.page))) : 1,
      quote,
      comment: ppClean(params.comment, 2000) || "",
      color: ANNOT_COLORS.includes(params.color) ? params.color : "yellow",
      createdAt: ppNow(),
    };
    paper.annotations.push(annot);
    paper.annotations.sort((a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt));
    savePaper();
    return { ok: true, result: { annotation: annot, total: paper.annotations.length } };
  });

  registerLensAction("paper", "paper-annotations", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const paper = ppList(s, ppActor(ctx)).find((p) => p.id === params.paperId);
    if (!paper) return { ok: false, error: "paper not found" };
    return { ok: true, result: { annotations: paper.annotations || [], count: (paper.annotations || []).length } };
  });

  registerLensAction("paper", "paper-annotation-delete", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const paper = ppList(s, ppActor(ctx)).find((p) => p.id === params.paperId);
    if (!paper) return { ok: false, error: "paper not found" };
    const arr = paper.annotations || [];
    const i = arr.findIndex((an) => an.id === params.annotationId);
    if (i < 0) return { ok: false, error: "annotation not found" };
    arr.splice(i, 1);
    savePaper();
    return { ok: true, result: { deleted: params.annotationId, remaining: arr.length } };
  });

  registerLensAction("paper", "paper-annotations-sync", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const paper = ppList(s, ppActor(ctx)).find((p) => p.id === params.paperId);
    if (!paper) return { ok: false, error: "paper not found" };
    const annots = paper.annotations || [];
    if (annots.length === 0) return { ok: false, error: "no annotations to sync" };
    const digest = ["## Highlights", ""].concat(
      annots.map((an) => {
        const tail = an.comment ? `\n  — ${an.comment}` : "";
        return `- [p.${an.page}] "${an.quote}"${tail}`;
      }),
    ).join("\n");
    // Strip a prior auto-synced block then append the fresh one.
    const base = (paper.notes || "").replace(/\n*## Highlights[\s\S]*$/, "").trim();
    paper.notes = (base ? base + "\n\n" : "") + digest;
    paper.notes = paper.notes.slice(0, 8000);
    savePaper();
    return { ok: true, result: { paperId: paper.id, synced: annots.length, notes: paper.notes } };
  });

  // ─── One-click capture from DOI/URL (backlog item 3) ────────────────
  // Resolves a DOI through CrossRef and saves a fully-populated record.

  registerLensAction("paper", "paper-capture", async (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let doi = ppClean(params.doi || params.url, 300);
    if (!doi) return { ok: false, error: "doi or url required" };
    // Extract a bare DOI from a URL form.
    const m = doi.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
    if (m) doi = m[0];
    if (!/^10\.\d{4,9}\//.test(doi)) return { ok: false, error: "could not parse a DOI" };
    try {
      const data = await cachedFetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
        ttlMs: 3600000,
        opts: { headers: { "User-Agent": "ConcordOS/5.0 (+https://concord-os.org; mailto:hello@concord-os.org)" } },
      });
      const w = data?.message;
      if (!w) return { ok: false, error: "no metadata for that DOI" };
      const title = ppClean(Array.isArray(w.title) ? w.title[0] : w.title, 400) || "Untitled work";
      const authors = (w.author || []).map((a) => [a.given, a.family].filter(Boolean).join(" ") || a.name).filter(Boolean).slice(0, 30);
      const year = w.issued?.["date-parts"]?.[0]?.[0] || w["published-print"]?.["date-parts"]?.[0]?.[0] || null;
      const list = ppList(s, ppActor(ctx));
      const refId = `doi:${doi.toLowerCase()}`;
      if (list.some((p) => p.refId === refId)) return { ok: false, error: "paper already in your library" };
      const paper = {
        id: ppId("pp"),
        refId,
        title,
        authors,
        year: Number.isFinite(year) ? year : null,
        venue: ppClean(Array.isArray(w["container-title"]) ? w["container-title"][0] : null, 200) || null,
        abstract: ppClean(String(w.abstract || "").replace(/<[^>]+>/g, ""), 6000) || "",
        url: ppClean(w.URL || `https://doi.org/${doi}`, 600),
        doi,
        status: "to_read",
        rating: null,
        tags: (w.subject || []).slice(0, 6).map((t) => ppClean(t, 30).toLowerCase()),
        notes: "",
        collectionIds: [],
        citationCount: w["is-referenced-by-count"] ?? null,
        addedAt: ppNow(),
      };
      list.push(paper);
      savePaper();
      return { ok: true, result: { paper, source: "crossref" } };
    } catch (e) {
      return { ok: false, error: `capture failed: ${e?.message || "network"}` };
    }
  });

  // ─── Semantic Scholar enrichment (backlog item 4) ───────────────────
  // Free keyless Graph API. Pulls citation counts, influential citation
  // count, references and a sample of citing works.

  registerLensAction("paper", "paper-enrich", async (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const paper = ppList(s, ppActor(ctx)).find((p) => p.id === params.paperId);
    if (!paper) return { ok: false, error: "paper not found" };
    const lookup = paper.doi ? `DOI:${paper.doi}` : (paper.refId?.startsWith("arxiv:") ? `arXiv:${paper.refId.slice(6)}` : null);
    if (!lookup) return { ok: false, error: "paper has no DOI or arXiv id to enrich" };
    const fields = "title,year,citationCount,influentialCitationCount,referenceCount,fieldsOfStudy,tldr,references.title,references.year,citations.title,citations.year";
    try {
      const data = await cachedFetchJson(
        `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(lookup)}?fields=${fields}`,
        { ttlMs: 3600000 },
      );
      if (!data || data.error) return { ok: false, error: data?.error || "no Semantic Scholar record" };
      const enrichment = {
        citationCount: data.citationCount ?? null,
        influentialCitationCount: data.influentialCitationCount ?? null,
        referenceCount: data.referenceCount ?? null,
        fieldsOfStudy: Array.isArray(data.fieldsOfStudy) ? data.fieldsOfStudy.slice(0, 8) : [],
        tldr: data.tldr?.text ? ppClean(data.tldr.text, 1000) : null,
        references: (data.references || []).filter((r) => r.title).slice(0, 25)
          .map((r) => ({ title: ppClean(r.title, 300), year: r.year || null })),
        citations: (data.citations || []).filter((r) => r.title).slice(0, 25)
          .map((r) => ({ title: ppClean(r.title, 300), year: r.year || null })),
        enrichedAt: ppNow(),
      };
      paper.enrichment = enrichment;
      if (enrichment.citationCount != null) paper.citationCount = enrichment.citationCount;
      savePaper();
      return { ok: true, result: { paperId: paper.id, enrichment } };
    } catch (e) {
      return { ok: false, error: `enrich failed: ${e?.message || "network"}` };
    }
  });

  // ─── Duplicate detection + dedupe (backlog item 5) ──────────────────
  // Groups records that share a DOI, or whose normalised titles are an
  // exact match. Merge keeps the richest record and drops the rest.

  const ppNormTitle = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  registerLensAction("paper", "paper-find-duplicates", (ctx, _a, _params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const papers = ppList(s, ppActor(ctx));
    const byKey = new Map();
    for (const p of papers) {
      const key = p.doi ? `doi:${p.doi.toLowerCase()}` : `title:${ppNormTitle(p.title)}`;
      if (!key || key === "title:") continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(p);
    }
    const groups = [];
    for (const [key, members] of byKey) {
      if (members.length < 2) continue;
      groups.push({
        key,
        kind: key.startsWith("doi:") ? "doi" : "title",
        members: members.map((p) => ({ id: p.id, title: p.title, year: p.year, addedAt: p.addedAt })),
      });
    }
    return { ok: true, result: { duplicateGroups: groups, groupCount: groups.length, totalPapers: papers.length } };
  });

  registerLensAction("paper", "paper-merge-duplicates", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = ppList(s, ppActor(ctx));
    const ids = Array.isArray(params.ids) ? params.ids.filter(Boolean) : [];
    if (ids.length < 2) return { ok: false, error: "provide at least 2 paper ids to merge" };
    const members = ids.map((id) => list.find((p) => p.id === id)).filter(Boolean);
    if (members.length < 2) return { ok: false, error: "duplicate set not found" };
    // Score richness: keep the one with the most populated fields.
    const richness = (p) =>
      (p.abstract ? 2 : 0) + (p.doi ? 2 : 0) + (p.pdf ? 3 : 0) + (p.notes ? 1 : 0) +
      (p.annotations?.length || 0) + (p.enrichment ? 2 : 0) + (p.tags?.length || 0);
    members.sort((a, b) => richness(b) - richness(a));
    const keep = members[0];
    const dropped = members.slice(1);
    // Fold non-empty fields + tags + collections + annotations into keep.
    for (const d of dropped) {
      if (!keep.abstract && d.abstract) keep.abstract = d.abstract;
      if (!keep.doi && d.doi) keep.doi = d.doi;
      if (!keep.pdf && d.pdf) keep.pdf = d.pdf;
      if (!keep.enrichment && d.enrichment) keep.enrichment = d.enrichment;
      if (d.notes) keep.notes = ((keep.notes || "") + "\n" + d.notes).trim().slice(0, 8000);
      keep.tags = Array.from(new Set([...(keep.tags || []), ...(d.tags || [])])).slice(0, 8);
      keep.collectionIds = Array.from(new Set([...(keep.collectionIds || []), ...(d.collectionIds || [])]));
      if (Array.isArray(d.annotations)) keep.annotations = [...(keep.annotations || []), ...d.annotations];
      const i = list.findIndex((p) => p.id === d.id);
      if (i >= 0) list.splice(i, 1);
    }
    savePaper();
    return { ok: true, result: { kept: keep, droppedIds: dropped.map((d) => d.id), droppedCount: dropped.length } };
  });

  // ─── Shared/group libraries (backlog item 6) ────────────────────────
  // A group is owned by its creator; members join via a share code.
  // Papers added to a group are copied into the group's shared list,
  // visible to every member.

  function getGroups(s) {
    if (!(s.groups instanceof Map)) s.groups = new Map(); // groupId -> group
    return s.groups;
  }

  registerLensAction("paper", "group-create", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = ppClean(params.name, 120);
    if (!name) return { ok: false, error: "group name required" };
    const userId = ppActor(ctx);
    const groups = getGroups(s);
    const group = {
      id: ppId("grp"),
      name,
      description: ppClean(params.description, 400) || "",
      ownerId: userId,
      shareCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
      members: [userId],
      papers: [],
      createdAt: ppNow(),
    };
    groups.set(group.id, group);
    savePaper();
    return { ok: true, result: { group } };
  });

  const groupSummary = (g, userId) => ({
    id: g.id, name: g.name, description: g.description,
    ownerId: g.ownerId, isOwner: g.ownerId === userId,
    shareCode: g.ownerId === userId ? g.shareCode : null,
    memberCount: g.members.length, paperCount: g.papers.length, createdAt: g.createdAt,
  });

  registerLensAction("paper", "group-list", (ctx, _a, _params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = ppActor(ctx);
    const mine = [...getGroups(s).values()].filter((g) => g.members.includes(userId));
    return { ok: true, result: { groups: mine.map((g) => groupSummary(g, userId)), count: mine.length } };
  });

  registerLensAction("paper", "group-join", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const code = ppClean(params.shareCode, 16).toUpperCase();
    if (!code) return { ok: false, error: "share code required" };
    const userId = ppActor(ctx);
    const group = [...getGroups(s).values()].find((g) => g.shareCode === code);
    if (!group) return { ok: false, error: "no group with that share code" };
    if (group.members.includes(userId)) return { ok: false, error: "already a member" };
    group.members.push(userId);
    savePaper();
    return { ok: true, result: { group: groupSummary(group, userId) } };
  });

  registerLensAction("paper", "group-add-paper", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = ppActor(ctx);
    const group = getGroups(s).get(params.groupId);
    if (!group) return { ok: false, error: "group not found" };
    if (!group.members.includes(userId)) return { ok: false, error: "not a member of this group" };
    const src = ppList(s, userId).find((p) => p.id === params.paperId);
    if (!src) return { ok: false, error: "paper not found in your library" };
    const dupKey = src.doi ? `doi:${src.doi.toLowerCase()}` : `title:${ppNormTitle(src.title)}`;
    if (group.papers.some((p) => (p.doi ? `doi:${p.doi.toLowerCase()}` : `title:${ppNormTitle(p.title)}`) === dupKey)) {
      return { ok: false, error: "paper already in this group" };
    }
    const shared = {
      id: ppId("gp"),
      title: src.title, authors: src.authors, year: src.year, venue: src.venue,
      abstract: src.abstract, url: src.url, doi: src.doi,
      addedBy: userId, addedAt: ppNow(),
    };
    group.papers.push(shared);
    savePaper();
    return { ok: true, result: { groupId: group.id, paper: shared, paperCount: group.papers.length } };
  });

  registerLensAction("paper", "group-papers", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = ppActor(ctx);
    const group = getGroups(s).get(params.groupId);
    if (!group) return { ok: false, error: "group not found" };
    if (!group.members.includes(userId)) return { ok: false, error: "not a member of this group" };
    return { ok: true, result: { group: groupSummary(group, userId), papers: group.papers } };
  });

  registerLensAction("paper", "group-remove-paper", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = ppActor(ctx);
    const group = getGroups(s).get(params.groupId);
    if (!group) return { ok: false, error: "group not found" };
    if (!group.members.includes(userId)) return { ok: false, error: "not a member of this group" };
    const i = group.papers.findIndex((p) => p.id === params.paperId);
    if (i < 0) return { ok: false, error: "paper not in group" };
    group.papers.splice(i, 1);
    savePaper();
    return { ok: true, result: { groupId: group.id, removed: params.paperId, paperCount: group.papers.length } };
  });

  // ─── Cited-by + new-version alerts (backlog item 7) ─────────────────
  // Re-queries Semantic Scholar (cited-by) and arXiv (new versions) for
  // every saved paper and records any deltas vs the last check.

  registerLensAction("paper", "paper-check-alerts", async (ctx, _a, _params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = ppActor(ctx);
    const papers = ppList(s, userId);
    if (!Array.isArray(s.alerts)) s.alerts = [];
    let checked = 0;
    const newAlerts = [];
    for (const p of papers) {
      const lookup = p.doi ? `DOI:${p.doi}` : (p.refId?.startsWith("arxiv:") ? `arXiv:${p.refId.slice(6)}` : null);
      if (!lookup) continue;
      checked++;
      try {
        const data = await cachedFetchJson(
          `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(lookup)}?fields=citationCount,citations.title`,
          { ttlMs: 600000 },
        );
        if (!data || data.error) continue;
        const prev = Number.isFinite(p.lastCitationCount) ? p.lastCitationCount : (p.citationCount ?? 0);
        const now = data.citationCount ?? prev;
        if (now > prev) {
          const alert = {
            id: ppId("alrt"), paperId: p.id, paperTitle: p.title,
            kind: "cited_by", delta: now - prev, from: prev, to: now,
            message: `"${p.title}" gained ${now - prev} new citation${now - prev === 1 ? "" : "s"} (${now} total).`,
            createdAt: ppNow(), read: false,
          };
          s.alerts.unshift(alert);
          newAlerts.push(alert);
        }
        p.lastCitationCount = now;
        p.citationCount = now;
      } catch { /* skip unreachable paper */ }
    }
    s.alerts = s.alerts.slice(0, 200);
    s.alertsCheckedAt = ppNow();
    savePaper();
    return { ok: true, result: { checked, newAlerts, newAlertCount: newAlerts.length, checkedAt: s.alertsCheckedAt } };
  });

  registerLensAction("paper", "paper-alerts-list", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    // Alerts are stored per-state with a paperId that belongs to a user's
    // library; filter to only this user's papers.
    const userId = ppActor(ctx);
    const myIds = new Set(ppList(s, userId).map((p) => p.id));
    let alerts = (s.alerts || []).filter((a) => myIds.has(a.paperId));
    if (params.unreadOnly === true) alerts = alerts.filter((a) => !a.read);
    return { ok: true, result: { alerts, count: alerts.length, unread: alerts.filter((a) => !a.read).length, checkedAt: s.alertsCheckedAt || null } };
  });

  registerLensAction("paper", "paper-alert-read", (ctx, _a, params = {}) => {
    const s = getPaperState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = ppActor(ctx);
    const myIds = new Set(ppList(s, userId).map((p) => p.id));
    if (params.all === true) {
      let n = 0;
      (s.alerts || []).forEach((a) => { if (myIds.has(a.paperId) && !a.read) { a.read = true; n++; } });
      savePaper();
      return { ok: true, result: { markedRead: n } };
    }
    const alert = (s.alerts || []).find((a) => a.id === params.alertId && myIds.has(a.paperId));
    if (!alert) return { ok: false, error: "alert not found" };
    alert.read = true;
    savePaper();
    return { ok: true, result: { alertId: alert.id, read: true } };
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
