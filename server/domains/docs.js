// server/domains/docs.js
// Domain actions for documentation management: readability scoring,
// cross-reference analysis, and semantic version diffing.

export default function registerDocsActions(registerLensAction) {
  /**
   * readabilityScore
   * Compute readability metrics: Flesch-Kincaid, Gunning Fog, Coleman-Liau,
   * SMOG, plus a custom technical readability index.
   * artifact.data.text = string (the document text)
   */
  registerLensAction("docs", "readabilityScore", (ctx, artifact, _params) => {
    const text = artifact.data?.text || "";
    if (text.length === 0) {
      return { ok: true, result: { message: "No text provided." } };
    }

    // Tokenization helpers
    function countSyllables(word) {
      word = word.toLowerCase().replace(/[^a-z]/g, "");
      if (word.length <= 2) return 1;
      // Remove trailing silent e
      word = word.replace(/e$/, "");
      const vowelGroups = word.match(/[aeiouy]+/g);
      const count = vowelGroups ? vowelGroups.length : 1;
      return Math.max(1, count);
    }

    // Split into sentences
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const sentenceCount = Math.max(1, sentences.length);

    // Split into words
    const words = text.split(/\s+/).filter(w => w.replace(/[^a-z0-9]/gi, "").length > 0);
    const wordCount = Math.max(1, words.length);

    // Character count (letters only)
    const charCount = text.replace(/[^a-z0-9]/gi, "").length;

    // Syllable counts
    const syllableCounts = words.map(w => countSyllables(w));
    const totalSyllables = syllableCounts.reduce((s, c) => s + c, 0);
    const polysyllabicWords = syllableCounts.filter(c => c >= 3).length;

    // Complex words (3+ syllables, not proper nouns or compound hyphenated)
    const complexWords = words.filter((w, i) => {
      const syl = syllableCounts[i];
      if (syl < 3) return false;
      // Exclude common suffixes that inflate syllable count
      const lower = w.toLowerCase();
      if (lower.endsWith("ing") || lower.endsWith("ed") || lower.endsWith("es")) {
        return syl >= 4;
      }
      return true;
    }).length;

    // Average calculations
    const avgWordsPerSentence = wordCount / sentenceCount;
    const avgSyllablesPerWord = totalSyllables / wordCount;
    const avgCharsPerWord = charCount / wordCount;

    // 1. Flesch-Kincaid Reading Ease
    const fleschReadingEase = 206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord;

    // 2. Flesch-Kincaid Grade Level
    const fleschKincaidGrade = 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59;

    // 3. Gunning Fog Index
    const gunningFog = 0.4 * (avgWordsPerSentence + 100 * (complexWords / wordCount));

    // 4. Coleman-Liau Index
    const L = (charCount / wordCount) * 100; // avg letters per 100 words
    const S = (sentenceCount / wordCount) * 100; // avg sentences per 100 words
    const colemanLiau = 0.0588 * L - 0.296 * S - 15.8;

    // 5. SMOG Index
    const smog = sentenceCount >= 3
      ? 1.0430 * Math.sqrt(polysyllabicWords * (30 / sentenceCount)) + 3.1291
      : 0;

    // 6. Automated Readability Index
    const ari = 4.71 * avgCharsPerWord + 0.5 * avgWordsPerSentence - 21.43;

    // 7. Custom Technical Readability Index
    // Penalizes: jargon density, abbreviation density, long sentences, passive voice
    const abbreviations = (text.match(/\b[A-Z]{2,}\b/g) || []).length;
    const abbreviationDensity = abbreviations / wordCount;
    const longSentences = sentences.filter(s => s.split(/\s+/).length > 30).length;
    const longSentenceRatio = longSentences / sentenceCount;
    // Passive voice detection (simple heuristic)
    const passiveMatches = text.match(/\b(is|are|was|were|been|being|be)\s+\w+ed\b/gi) || [];
    const passiveRatio = passiveMatches.length / sentenceCount;
    // Code-like tokens
    const codeTokens = (text.match(/[{}[\]<>()=;|&]/g) || []).length;
    const codeDensity = codeTokens / Math.max(1, charCount);

    const technicalIndex = Math.max(0, Math.min(100,
      70
      - abbreviationDensity * 200
      - longSentenceRatio * 30
      - passiveRatio * 15
      + (fleschReadingEase > 50 ? 10 : 0)
      - codeDensity * 500
      - (avgSyllablesPerWord > 2 ? (avgSyllablesPerWord - 2) * 20 : 0)
    ));

    const r = (v) => Math.round(v * 100) / 100;

    // Overall grade level (average of grade-level metrics)
    const gradeLevels = [fleschKincaidGrade, gunningFog, colemanLiau, ari].filter(v => v > 0);
    const avgGradeLevel = gradeLevels.length > 0
      ? gradeLevels.reduce((s, v) => s + v, 0) / gradeLevels.length
      : 0;

    // Reading time estimate (average adult reads ~250 wpm)
    const readingTimeMinutes = wordCount / 250;

    return {
      ok: true,
      result: {
        metrics: {
          fleschReadingEase: r(fleschReadingEase),
          fleschKincaidGrade: r(fleschKincaidGrade),
          gunningFog: r(gunningFog),
          colemanLiau: r(colemanLiau),
          smog: r(smog),
          automatedReadabilityIndex: r(ari),
          technicalReadabilityIndex: r(technicalIndex),
        },
        summary: {
          averageGradeLevel: r(avgGradeLevel),
          difficulty: avgGradeLevel > 16 ? "post-graduate" : avgGradeLevel > 12 ? "college" : avgGradeLevel > 8 ? "high-school" : avgGradeLevel > 5 ? "middle-school" : "elementary",
          fleschCategory: fleschReadingEase >= 90 ? "very easy" : fleschReadingEase >= 70 ? "easy" : fleschReadingEase >= 50 ? "fairly easy" : fleschReadingEase >= 30 ? "difficult" : "very difficult",
          readingTimeMinutes: r(readingTimeMinutes),
        },
        statistics: {
          wordCount,
          sentenceCount,
          characterCount: charCount,
          syllableCount: totalSyllables,
          avgWordsPerSentence: r(avgWordsPerSentence),
          avgSyllablesPerWord: r(avgSyllablesPerWord),
          avgCharsPerWord: r(avgCharsPerWord),
          complexWordCount: complexWords,
          complexWordPercentage: r((complexWords / wordCount) * 100),
          polysyllabicWordCount: polysyllabicWords,
        },
        technicalIndicators: {
          abbreviationCount: abbreviations,
          abbreviationDensity: r(abbreviationDensity * 100),
          longSentenceCount: longSentences,
          longSentencePercentage: r(longSentenceRatio * 100),
          passiveVoiceInstances: passiveMatches.length,
          passiveVoicePercentage: r(passiveRatio * 100),
        },
      },
    };
  });

  /**
   * crossReference
   * Analyze cross-references in documentation. Build reference graph,
   * detect broken links, circular references, and orphan pages.
   * artifact.data.pages = [{ id, title, content?, links: [targetId], backlinks?: [sourceId] }]
   */
  registerLensAction("docs", "crossReference", (ctx, artifact, _params) => {
    const pages = artifact.data?.pages || [];
    if (pages.length === 0) {
      return { ok: true, result: { message: "No pages provided." } };
    }

    const pageIds = new Set(pages.map(p => p.id));
    const adjacency = {}; // id -> [targetIds]
    const inbound = {};   // id -> [sourceIds]

    for (const page of pages) {
      adjacency[page.id] = page.links || [];
      if (!inbound[page.id]) inbound[page.id] = [];
      for (const target of (page.links || [])) {
        if (!inbound[target]) inbound[target] = [];
        inbound[target].push(page.id);
      }
    }

    // Broken links: targets that don't exist
    const brokenLinks = [];
    for (const page of pages) {
      for (const target of (page.links || [])) {
        if (!pageIds.has(target)) {
          brokenLinks.push({ source: page.id, target, sourceTitle: page.title });
        }
      }
    }

    // Orphan pages: no inbound links (except from broken refs)
    const orphanPages = pages.filter(p => {
      const inboundLinks = (inbound[p.id] || []).filter(src => pageIds.has(src));
      return inboundLinks.length === 0;
    }).map(p => ({ id: p.id, title: p.title }));

    // Dead-end pages: no outbound links
    const deadEndPages = pages.filter(p => (p.links || []).length === 0)
      .map(p => ({ id: p.id, title: p.title }));

    // Circular references: detect cycles via DFS
    const cycles = [];
    const globalVisited = new Set();

    function findCycles(startId) {
      const stack = [{ node: startId, path: [startId] }];
      const localVisited = new Set();

      while (stack.length > 0) {
        const { node, path } = stack.pop();
        localVisited.add(node);

        for (const neighbor of (adjacency[node] || [])) {
          if (!pageIds.has(neighbor)) continue;
          if (neighbor === startId && path.length > 1) {
            // Found a cycle
            const cyclePath = [...path, neighbor];
            const cycleKey = [...cyclePath].sort().join(",");
            if (!globalVisited.has(cycleKey)) {
              globalVisited.add(cycleKey);
              cycles.push({ path: cyclePath, length: path.length });
            }
          } else if (!localVisited.has(neighbor) && path.length < 20) {
            stack.push({ node: neighbor, path: [...path, neighbor] });
          }
        }
      }
    }

    for (const page of pages) {
      findCycles(page.id);
    }

    // Compute page importance via simplified PageRank (10 iterations)
    const n = pages.length;
    const dampingFactor = 0.85;
    let pageRank = {};
    for (const page of pages) {
      pageRank[page.id] = 1 / n;
    }

    for (let iter = 0; iter < 10; iter++) {
      const newRank = {};
      for (const page of pages) {
        let inboundScore = 0;
        const sources = (inbound[page.id] || []).filter(s => pageIds.has(s));
        for (const src of sources) {
          const outDegree = (adjacency[src] || []).filter(t => pageIds.has(t)).length;
          if (outDegree > 0) {
            inboundScore += pageRank[src] / outDegree;
          }
        }
        newRank[page.id] = (1 - dampingFactor) / n + dampingFactor * inboundScore;
      }
      pageRank = newRank;
    }

    // Page connectivity stats
    const pageStats = pages.map(p => {
      const outLinks = (p.links || []).filter(t => pageIds.has(t)).length;
      const inLinks = (inbound[p.id] || []).filter(s => pageIds.has(s)).length;
      return {
        id: p.id,
        title: p.title,
        outboundLinks: outLinks,
        inboundLinks: inLinks,
        totalConnections: outLinks + inLinks,
        pageRank: Math.round(pageRank[p.id] * 10000) / 10000,
        isOrphan: inLinks === 0,
        isDeadEnd: outLinks === 0,
      };
    }).sort((a, b) => b.pageRank - a.pageRank);

    // Graph density
    const maxEdges = n * (n - 1);
    const actualEdges = pages.reduce((s, p) => s + (p.links || []).filter(t => pageIds.has(t)).length, 0);
    const density = maxEdges > 0 ? Math.round((actualEdges / maxEdges) * 10000) / 10000 : 0;

    return {
      ok: true,
      result: {
        totalPages: pages.length,
        totalLinks: actualEdges,
        graphDensity: density,
        brokenLinks: { count: brokenLinks.length, items: brokenLinks.slice(0, 30) },
        circularReferences: { count: cycles.length, items: cycles.slice(0, 20) },
        orphanPages: { count: orphanPages.length, items: orphanPages },
        deadEndPages: { count: deadEndPages.length, items: deadEndPages },
        pageRankings: pageStats.slice(0, 20),
        healthScore: Math.max(0, Math.round(100
          - brokenLinks.length * 5
          - orphanPages.length * 3
          - cycles.length * 8
          - (density < 0.05 ? 15 : 0)
        )),
      },
    };
  });

  /**
   * versionDiff
   * Semantic diff between document versions: paragraph-level diff with
   * move detection, compute change significance score.
   * artifact.data.oldVersion = { text, title?, version? }
   * artifact.data.newVersion = { text, title?, version? }
   */
  registerLensAction("docs", "versionDiff", (ctx, artifact, _params) => {
    const oldDoc = artifact.data?.oldVersion || {};
    const newDoc = artifact.data?.newVersion || {};
    const oldText = oldDoc.text || "";
    const newText = newDoc.text || "";

    if (!oldText && !newText) {
      return { ok: true, result: { message: "No document versions provided." } };
    }

    // Split into paragraphs
    function splitParagraphs(text) {
      return text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
    }

    const oldParas = splitParagraphs(oldText);
    const newParas = splitParagraphs(newText);

    // Compute paragraph fingerprints for move detection
    function fingerprint(para) {
      const words = para.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2);
      return words.sort().join(" ");
    }

    // Compute similarity between two paragraphs (word-level Jaccard)
    function paragraphSimilarity(a, b) {
      const wordsA = new Set(a.toLowerCase().split(/\s+/));
      const wordsB = new Set(b.toLowerCase().split(/\s+/));
      let intersection = 0;
      for (const w of wordsA) if (wordsB.has(w)) intersection++;
      const union = new Set([...wordsA, ...wordsB]).size;
      return union > 0 ? intersection / union : 0;
    }

    // LCS-based diff on paragraphs
    const m = oldParas.length;
    const n = newParas.length;

    // Build similarity matrix
    const simMatrix = [];
    for (let i = 0; i < m; i++) {
      simMatrix[i] = [];
      for (let j = 0; j < n; j++) {
        simMatrix[i][j] = paragraphSimilarity(oldParas[i], newParas[j]);
      }
    }

    // LCS to find matched paragraphs (similarity > 0.5 counts as match)
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (simMatrix[i - 1][j - 1] > 0.5) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to find alignment
    const changes = [];
    const matchedOld = new Set();
    const matchedNew = new Set();
    let i = m, j = n;
    const alignments = [];

    while (i > 0 && j > 0) {
      if (simMatrix[i - 1][j - 1] > 0.5 && dp[i][j] === dp[i - 1][j - 1] + 1) {
        alignments.unshift({ oldIdx: i - 1, newIdx: j - 1, similarity: simMatrix[i - 1][j - 1] });
        matchedOld.add(i - 1);
        matchedNew.add(j - 1);
        i--; j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    // Identify modifications (matched but not identical)
    for (const align of alignments) {
      const sim = Math.round(align.similarity * 1000) / 1000;
      if (sim < 1.0) {
        changes.push({
          type: "modified",
          oldIndex: align.oldIdx,
          newIndex: align.newIdx,
          similarity: sim,
          oldPreview: oldParas[align.oldIdx].slice(0, 120),
          newPreview: newParas[align.newIdx].slice(0, 120),
        });
      } else {
        changes.push({
          type: "unchanged",
          oldIndex: align.oldIdx,
          newIndex: align.newIdx,
        });
      }
    }

    // Detect moves: unmatched paragraphs with high similarity to another unmatched paragraph
    const unmatchedOld = [];
    const unmatchedNew = [];
    for (let k = 0; k < m; k++) if (!matchedOld.has(k)) unmatchedOld.push(k);
    for (let k = 0; k < n; k++) if (!matchedNew.has(k)) unmatchedNew.push(k);

    const moves = [];
    const movedOld = new Set();
    const movedNew = new Set();

    for (const oi of unmatchedOld) {
      let bestMatch = -1;
      let bestSim = 0.6; // threshold for move detection
      for (const ni of unmatchedNew) {
        if (movedNew.has(ni)) continue;
        const sim = paragraphSimilarity(oldParas[oi], newParas[ni]);
        if (sim > bestSim) {
          bestSim = sim;
          bestMatch = ni;
        }
      }
      if (bestMatch >= 0) {
        moves.push({
          type: "moved",
          oldIndex: oi,
          newIndex: bestMatch,
          similarity: Math.round(bestSim * 1000) / 1000,
          preview: oldParas[oi].slice(0, 120),
        });
        movedOld.add(oi);
        movedNew.add(bestMatch);
      }
    }

    // Remaining unmatched = deletions and additions
    const deletions = unmatchedOld
      .filter(k => !movedOld.has(k))
      .map(k => ({ type: "deleted", oldIndex: k, preview: oldParas[k].slice(0, 120) }));

    const additions = unmatchedNew
      .filter(k => !movedNew.has(k))
      .map(k => ({ type: "added", newIndex: k, preview: newParas[k].slice(0, 120) }));

    // Compute change significance score
    const totalParas = Math.max(m, n, 1);
    const modifiedCount = changes.filter(c => c.type === "modified").length;
    const unchangedCount = changes.filter(c => c.type === "unchanged").length;

    // Weight: deletions and additions are more significant than modifications
    const significanceScore = Math.min(100, Math.round(
      (deletions.length * 3 + additions.length * 3 + modifiedCount * 2 + moves.length * 1) / totalParas * 25
    ));

    // Word-level stats
    const oldWords = oldText.split(/\s+/).length;
    const newWords = newText.split(/\s+/).length;
    const wordDelta = newWords - oldWords;

    return {
      ok: true,
      result: {
        versions: {
          old: { title: oldDoc.title, version: oldDoc.version, paragraphs: m, wordCount: oldWords },
          new: { title: newDoc.title, version: newDoc.version, paragraphs: n, wordCount: newWords },
        },
        wordDelta,
        changeSignificance: significanceScore,
        significanceLabel: significanceScore >= 70 ? "major revision" : significanceScore >= 40 ? "moderate changes" : significanceScore >= 15 ? "minor edits" : "minimal changes",
        summary: {
          unchanged: unchangedCount,
          modified: modifiedCount,
          added: additions.length,
          deleted: deletions.length,
          moved: moves.length,
        },
        changes: [
          ...changes.filter(c => c.type !== "unchanged"),
          ...moves,
          ...deletions,
          ...additions,
        ],
      },
    };
  });

  // ─── Notion-shape page/block document substrate (per-user, STATE) ────

  function getDocsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.docsLens) STATE.docsLens = {};
    if (!(STATE.docsLens.pages instanceof Map)) STATE.docsLens.pages = new Map(); // userId -> Array<page>
    return STATE.docsLens;
  }
  function saveDocs() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const dcId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const dcNow = () => new Date().toISOString();
  const dcActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const dcClean = (v, max = 4000) => String(v == null ? "" : v).trim().slice(0, max);
  const dcPages = (s, userId) => { if (!s.pages.has(userId)) s.pages.set(userId, []); return s.pages.get(userId); };

  const BLOCK_TYPES = [
    "paragraph", "heading1", "heading2", "heading3",
    "bulleted_list", "numbered_list", "todo", "code", "quote", "callout", "divider",
    // Rich block types (Notion parity)
    "toggle", "table", "embed",
  ];
  // Block types whose `data` field carries structured payload beyond `text`.
  const CODE_LANGUAGES = [
    "plain", "javascript", "typescript", "python", "rust", "go",
    "json", "sql", "bash", "html", "css", "markdown", "yaml",
  ];
  const CALLOUT_TONES = ["info", "warning", "success", "danger", "note"];

  // Normalise a block's structured `data` payload per type. Returns a
  // plain object; only the keys relevant to the block type are kept.
  function dcBlockData(type, raw = {}) {
    const data = {};
    if (type === "code") {
      data.language = CODE_LANGUAGES.includes(raw.language) ? raw.language : "plain";
    } else if (type === "callout") {
      data.tone = CALLOUT_TONES.includes(raw.tone) ? raw.tone : "info";
      data.emoji = dcClean(raw.emoji, 8) || "💡";
    } else if (type === "toggle") {
      data.open = raw.open === true;
    } else if (type === "embed") {
      data.url = dcClean(raw.url, 600);
      data.kind = ["link", "video", "image"].includes(raw.kind) ? raw.kind : "link";
    } else if (type === "table") {
      // rows: Array<Array<string>>; first row treated as header.
      const rows = Array.isArray(raw.rows) ? raw.rows : [["", ""], ["", ""]];
      data.rows = rows.slice(0, 50).map((r) =>
        (Array.isArray(r) ? r : []).slice(0, 12).map((c) => dcClean(c, 400)));
    }
    return data;
  }

  registerLensAction("docs", "page-create", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dcActor(ctx);
    const pages = dcPages(s, userId);
    const parentId = params.parentId && pages.some((p) => p.id === params.parentId) ? params.parentId : null;
    const page = {
      id: dcId("pg"),
      title: dcClean(params.title, 200) || "Untitled",
      icon: dcClean(params.icon, 8) || "📄",
      parentId,
      blocks: [],
      createdAt: dcNow(),
      updatedAt: dcNow(),
    };
    pages.push(page);
    saveDocs();
    return { ok: true, result: { page } };
  });

  registerLensAction("docs", "page-list", (ctx, _a, _params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pages = dcPages(s, dcActor(ctx)).map((p) => ({
      id: p.id, title: p.title, icon: p.icon, parentId: p.parentId,
      blockCount: p.blocks.length, updatedAt: p.updatedAt,
    }));
    return { ok: true, result: { pages, count: pages.length } };
  });

  registerLensAction("docs", "page-detail", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.id);
    if (!page) return { ok: false, error: "page not found" };
    return { ok: true, result: { page } };
  });

  registerLensAction("docs", "page-update", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.id);
    if (!page) return { ok: false, error: "page not found" };
    if (params.title != null) page.title = dcClean(params.title, 200) || page.title;
    if (params.icon != null) page.icon = dcClean(params.icon, 8) || page.icon;
    page.updatedAt = dcNow();
    saveDocs();
    return { ok: true, result: { page } };
  });

  registerLensAction("docs", "page-delete", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dcActor(ctx);
    const pages = dcPages(s, userId);
    if (!pages.some((p) => p.id === params.id)) return { ok: false, error: "page not found" };
    const toDelete = new Set([params.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of pages) {
        if (p.parentId && toDelete.has(p.parentId) && !toDelete.has(p.id)) { toDelete.add(p.id); grew = true; }
      }
    }
    s.pages.set(userId, pages.filter((p) => !toDelete.has(p.id)));
    saveDocs();
    return { ok: true, result: { deleted: [...toDelete] } };
  });

  registerLensAction("docs", "page-move", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pages = dcPages(s, dcActor(ctx));
    const page = pages.find((p) => p.id === params.id);
    if (!page) return { ok: false, error: "page not found" };
    const parentId = params.parentId || null;
    if (parentId === page.id) return { ok: false, error: "a page cannot be its own parent" };
    if (parentId && !pages.some((p) => p.id === parentId)) return { ok: false, error: "parent page not found" };
    page.parentId = parentId;
    page.updatedAt = dcNow();
    saveDocs();
    return { ok: true, result: { page } };
  });

  registerLensAction("docs", "block-add", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.pageId);
    if (!page) return { ok: false, error: "page not found" };
    const type = BLOCK_TYPES.includes(params.type) ? params.type : "paragraph";
    const block = {
      id: dcId("bl"),
      type,
      text: type === "divider" ? "" : dcClean(params.text, 8000),
      checked: type === "todo" ? params.checked === true : false,
      data: dcBlockData(type, params.data || {}),
      createdAt: dcNow(),
    };
    const afterIdx = params.afterId ? page.blocks.findIndex((b) => b.id === params.afterId) : -1;
    if (afterIdx >= 0) page.blocks.splice(afterIdx + 1, 0, block);
    else page.blocks.push(block);
    page.updatedAt = dcNow();
    saveDocs();
    return { ok: true, result: { block, blockCount: page.blocks.length } };
  });

  registerLensAction("docs", "block-update", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.pageId);
    if (!page) return { ok: false, error: "page not found" };
    const block = page.blocks.find((b) => b.id === params.blockId);
    if (!block) return { ok: false, error: "block not found" };
    if (params.text != null) block.text = dcClean(params.text, 8000);
    if (params.type != null && BLOCK_TYPES.includes(params.type)) {
      block.type = params.type;
      block.data = dcBlockData(block.type, params.data || block.data || {});
    }
    if (params.checked != null) block.checked = params.checked === true;
    if (params.data != null) block.data = dcBlockData(block.type, params.data);
    page.updatedAt = dcNow();
    saveDocs();
    return { ok: true, result: { block } };
  });

  registerLensAction("docs", "block-delete", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.pageId);
    if (!page) return { ok: false, error: "page not found" };
    const i = page.blocks.findIndex((b) => b.id === params.blockId);
    if (i < 0) return { ok: false, error: "block not found" };
    page.blocks.splice(i, 1);
    page.updatedAt = dcNow();
    saveDocs();
    return { ok: true, result: { deleted: params.blockId, blockCount: page.blocks.length } };
  });

  registerLensAction("docs", "block-reorder", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.pageId);
    if (!page) return { ok: false, error: "page not found" };
    const i = page.blocks.findIndex((b) => b.id === params.blockId);
    if (i < 0) return { ok: false, error: "block not found" };
    const j = Math.max(0, Math.min(page.blocks.length - 1, i + (params.direction === "down" ? 1 : -1)));
    if (i !== j) {
      const [m] = page.blocks.splice(i, 1);
      page.blocks.splice(j, 0, m);
      page.updatedAt = dcNow();
      saveDocs();
    }
    return { ok: true, result: { order: page.blocks.map((b) => b.id) } };
  });

  registerLensAction("docs", "docs-search", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = dcClean(params.query, 100).toLowerCase();
    if (!q) return { ok: false, error: "query required" };
    const results = [];
    for (const p of dcPages(s, dcActor(ctx))) {
      const titleHit = p.title.toLowerCase().includes(q);
      const blockHit = p.blocks.find((b) => b.text.toLowerCase().includes(q));
      if (titleHit || blockHit) {
        results.push({
          id: p.id, title: p.title, icon: p.icon,
          snippet: blockHit ? blockHit.text.slice(0, 160) : "",
          matchedIn: titleHit ? "title" : "content",
        });
      }
    }
    return { ok: true, result: { results, count: results.length } };
  });

  registerLensAction("docs", "docs-dashboard", (ctx, _a, _params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pages = dcPages(s, dcActor(ctx));
    const totalBlocks = pages.reduce((n, p) => n + p.blocks.length, 0);
    const todos = pages.flatMap((p) => p.blocks.filter((b) => b.type === "todo"));
    const words = pages.reduce((n, p) => n + p.blocks.reduce((w, b) => w + b.text.split(/\s+/).filter(Boolean).length, 0), 0);
    return {
      ok: true,
      result: {
        pages: pages.length,
        topLevelPages: pages.filter((p) => !p.parentId).length,
        totalBlocks,
        words,
        openTodos: todos.filter((t) => !t.checked).length,
        doneTodos: todos.filter((t) => t.checked).length,
      },
    };
  });

  // ─── Page version history + restore ──────────────────────────────────
  // Snapshots are stored per page in a Map: pageId -> Array<snapshot>.
  function dcSnapshots(s) {
    if (!(s.snapshots instanceof Map)) s.snapshots = new Map();
    return s.snapshots;
  }
  function dcSnapshotList(s, pageId) {
    const m = dcSnapshots(s);
    if (!m.has(pageId)) m.set(pageId, []);
    return m.get(pageId);
  }
  function dcPageWordCount(page) {
    return page.blocks.reduce(
      (w, b) => w + String(b.text || "").split(/\s+/).filter(Boolean).length, 0);
  }

  registerLensAction("docs", "version-snapshot", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.pageId);
    if (!page) return { ok: false, error: "page not found" };
    const list = dcSnapshotList(s, page.id);
    const snapshot = {
      id: dcId("snap"),
      pageId: page.id,
      label: dcClean(params.label, 120) || `Snapshot ${list.length + 1}`,
      title: page.title,
      icon: page.icon,
      blocks: JSON.parse(JSON.stringify(page.blocks)),
      wordCount: dcPageWordCount(page),
      blockCount: page.blocks.length,
      createdAt: dcNow(),
    };
    list.unshift(snapshot);
    // Cap at 50 snapshots per page.
    if (list.length > 50) list.length = 50;
    saveDocs();
    return { ok: true, result: { snapshotId: snapshot.id, count: list.length } };
  });

  registerLensAction("docs", "version-list", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.pageId);
    if (!page) return { ok: false, error: "page not found" };
    const list = dcSnapshotList(s, page.id).map((sn) => ({
      id: sn.id, label: sn.label, title: sn.title, icon: sn.icon,
      wordCount: sn.wordCount, blockCount: sn.blockCount, createdAt: sn.createdAt,
    }));
    return { ok: true, result: { snapshots: list, count: list.length } };
  });

  registerLensAction("docs", "version-restore", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.pageId);
    if (!page) return { ok: false, error: "page not found" };
    const snap = dcSnapshotList(s, page.id).find((sn) => sn.id === params.snapshotId);
    if (!snap) return { ok: false, error: "snapshot not found" };
    // Auto-snapshot current state before overwriting (so restore is reversible).
    const list = dcSnapshotList(s, page.id);
    list.unshift({
      id: dcId("snap"), pageId: page.id, label: "Before restore",
      title: page.title, icon: page.icon,
      blocks: JSON.parse(JSON.stringify(page.blocks)),
      wordCount: dcPageWordCount(page), blockCount: page.blocks.length,
      createdAt: dcNow(),
    });
    if (list.length > 50) list.length = 50;
    page.title = snap.title;
    page.icon = snap.icon;
    page.blocks = JSON.parse(JSON.stringify(snap.blocks));
    page.updatedAt = dcNow();
    saveDocs();
    return { ok: true, result: { page } };
  });

  // ─── Inline comments + suggestions on a block ────────────────────────
  function dcComments(s) {
    if (!(s.comments instanceof Map)) s.comments = new Map();
    return s.comments;
  }
  function dcCommentList(s, pageId) {
    const m = dcComments(s);
    if (!m.has(pageId)) m.set(pageId, []);
    return m.get(pageId);
  }

  registerLensAction("docs", "comment-add", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dcActor(ctx);
    const page = dcPages(s, userId).find((p) => p.id === params.pageId);
    if (!page) return { ok: false, error: "page not found" };
    const text = dcClean(params.text, 2000);
    if (!text) return { ok: false, error: "comment text required" };
    const kind = params.kind === "suggestion" ? "suggestion" : "comment";
    const comment = {
      id: dcId("cm"),
      pageId: page.id,
      blockId: params.blockId && page.blocks.some((b) => b.id === params.blockId)
        ? params.blockId : null,
      author: userId,
      kind,
      text,
      // For suggestions: the proposed replacement text for the block.
      suggestedText: kind === "suggestion" ? dcClean(params.suggestedText, 8000) : "",
      resolved: false,
      createdAt: dcNow(),
    };
    dcCommentList(s, page.id).push(comment);
    saveDocs();
    return { ok: true, result: { comment } };
  });

  registerLensAction("docs", "comment-list", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.pageId);
    if (!page) return { ok: false, error: "page not found" };
    let list = dcCommentList(s, page.id);
    if (params.blockId) list = list.filter((c) => c.blockId === params.blockId);
    if (params.openOnly === true) list = list.filter((c) => !c.resolved);
    return {
      ok: true,
      result: {
        comments: list,
        count: list.length,
        openCount: dcCommentList(s, page.id).filter((c) => !c.resolved).length,
      },
    };
  });

  registerLensAction("docs", "comment-resolve", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.pageId);
    if (!page) return { ok: false, error: "page not found" };
    const comment = dcCommentList(s, page.id).find((c) => c.id === params.commentId);
    if (!comment) return { ok: false, error: "comment not found" };
    comment.resolved = params.resolved === false ? false : true;
    saveDocs();
    return { ok: true, result: { comment } };
  });

  registerLensAction("docs", "comment-delete", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.pageId);
    if (!page) return { ok: false, error: "page not found" };
    const list = dcCommentList(s, page.id);
    const i = list.findIndex((c) => c.id === params.commentId);
    if (i < 0) return { ok: false, error: "comment not found" };
    list.splice(i, 1);
    saveDocs();
    return { ok: true, result: { deleted: params.commentId } };
  });

  registerLensAction("docs", "suggestion-accept", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.pageId);
    if (!page) return { ok: false, error: "page not found" };
    const comment = dcCommentList(s, page.id).find((c) => c.id === params.commentId);
    if (!comment) return { ok: false, error: "comment not found" };
    if (comment.kind !== "suggestion") return { ok: false, error: "not a suggestion" };
    const block = page.blocks.find((b) => b.id === comment.blockId);
    if (!block) return { ok: false, error: "target block no longer exists" };
    block.text = comment.suggestedText;
    comment.resolved = true;
    page.updatedAt = dcNow();
    saveDocs();
    return { ok: true, result: { block, comment } };
  });

  // ─── Real-time multi-cursor collaborative editing (presence) ─────────
  // Presence is ephemeral; stored on the per-user docs state keyed by page.
  function dcPresence(s) {
    if (!(s.presence instanceof Map)) s.presence = new Map();
    return s.presence;
  }
  const PRESENCE_TTL_MS = 30000;
  const PRESENCE_COLORS = ["#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#f87171", "#60a5fa"];

  registerLensAction("docs", "presence-ping", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dcActor(ctx);
    if (!params.pageId) return { ok: false, error: "pageId required" };
    const m = dcPresence(s);
    if (!m.has(params.pageId)) m.set(params.pageId, []);
    const list = m.get(params.pageId);
    const sessionId = dcClean(params.sessionId, 60) || userId;
    let entry = list.find((e) => e.sessionId === sessionId);
    if (!entry) {
      entry = {
        sessionId,
        userId,
        name: dcClean(params.name, 60) || userId,
        color: PRESENCE_COLORS[list.length % PRESENCE_COLORS.length],
      };
      list.push(entry);
    }
    entry.blockId = params.blockId ? dcClean(params.blockId, 60) : null;
    entry.cursorOffset = Number.isFinite(params.cursorOffset)
      ? Math.max(0, Math.floor(params.cursorOffset)) : 0;
    entry.lastSeen = Date.now();
    return { ok: true, result: { sessionId, color: entry.color } };
  });

  registerLensAction("docs", "presence-list", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!params.pageId) return { ok: false, error: "pageId required" };
    const m = dcPresence(s);
    const now = Date.now();
    const fresh = (m.get(params.pageId) || []).filter((e) => now - e.lastSeen < PRESENCE_TTL_MS);
    m.set(params.pageId, fresh);
    const selfSession = dcClean(params.sessionId, 60);
    return {
      ok: true,
      result: {
        cursors: fresh
          .filter((e) => e.sessionId !== selfSession)
          .map((e) => ({
            sessionId: e.sessionId, name: e.name, color: e.color,
            blockId: e.blockId, cursorOffset: e.cursorOffset,
          })),
        activeCount: fresh.length,
      },
    };
  });

  registerLensAction("docs", "presence-leave", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!params.pageId) return { ok: false, error: "pageId required" };
    const m = dcPresence(s);
    const list = m.get(params.pageId) || [];
    m.set(params.pageId, list.filter((e) => e.sessionId !== params.sessionId));
    return { ok: true, result: { left: params.sessionId || null } };
  });

  // ─── Database / table views (Notion-style structured pages) ──────────
  function dcDatabases(s, userId) {
    if (!(s.databases instanceof Map)) s.databases = new Map();
    if (!s.databases.has(userId)) s.databases.set(userId, []);
    return s.databases.get(userId);
  }
  const DB_COLUMN_TYPES = ["text", "number", "select", "checkbox", "date"];

  registerLensAction("docs", "db-create", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = dcDatabases(s, dcActor(ctx));
    const cols = Array.isArray(params.columns) && params.columns.length
      ? params.columns
      : [{ name: "Name", type: "text" }, { name: "Status", type: "select" }];
    const db = {
      id: dcId("db"),
      name: dcClean(params.name, 160) || "Untitled database",
      columns: cols.slice(0, 20).map((c) => ({
        id: dcId("col"),
        name: dcClean(c.name, 80) || "Column",
        type: DB_COLUMN_TYPES.includes(c.type) ? c.type : "text",
        options: Array.isArray(c.options)
          ? c.options.slice(0, 30).map((o) => dcClean(o, 60)).filter(Boolean) : [],
      })),
      rows: [],
      createdAt: dcNow(),
      updatedAt: dcNow(),
    };
    list.push(db);
    saveDocs();
    return { ok: true, result: { database: db } };
  });

  registerLensAction("docs", "db-list", (ctx, _a, _params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = dcDatabases(s, dcActor(ctx)).map((d) => ({
      id: d.id, name: d.name, columnCount: d.columns.length,
      rowCount: d.rows.length, updatedAt: d.updatedAt,
    }));
    return { ok: true, result: { databases: list, count: list.length } };
  });

  registerLensAction("docs", "db-detail", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const db = dcDatabases(s, dcActor(ctx)).find((d) => d.id === params.id);
    if (!db) return { ok: false, error: "database not found" };
    return { ok: true, result: { database: db } };
  });

  registerLensAction("docs", "db-delete", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dcActor(ctx);
    const list = dcDatabases(s, userId);
    const i = list.findIndex((d) => d.id === params.id);
    if (i < 0) return { ok: false, error: "database not found" };
    list.splice(i, 1);
    saveDocs();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("docs", "db-column-add", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const db = dcDatabases(s, dcActor(ctx)).find((d) => d.id === params.id);
    if (!db) return { ok: false, error: "database not found" };
    if (db.columns.length >= 20) return { ok: false, error: "column limit reached" };
    const col = {
      id: dcId("col"),
      name: dcClean(params.name, 80) || "Column",
      type: DB_COLUMN_TYPES.includes(params.type) ? params.type : "text",
      options: Array.isArray(params.options)
        ? params.options.slice(0, 30).map((o) => dcClean(o, 60)).filter(Boolean) : [],
    };
    db.columns.push(col);
    db.updatedAt = dcNow();
    saveDocs();
    return { ok: true, result: { column: col } };
  });

  registerLensAction("docs", "db-row-add", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const db = dcDatabases(s, dcActor(ctx)).find((d) => d.id === params.id);
    if (!db) return { ok: false, error: "database not found" };
    if (db.rows.length >= 1000) return { ok: false, error: "row limit reached" };
    const cells = {};
    const incoming = params.cells && typeof params.cells === "object" ? params.cells : {};
    for (const col of db.columns) {
      const v = incoming[col.id];
      if (col.type === "number") cells[col.id] = Number.isFinite(Number(v)) ? Number(v) : 0;
      else if (col.type === "checkbox") cells[col.id] = v === true;
      else cells[col.id] = dcClean(v, 1000);
    }
    const row = { id: dcId("row"), cells, createdAt: dcNow() };
    db.rows.push(row);
    db.updatedAt = dcNow();
    saveDocs();
    return { ok: true, result: { row } };
  });

  registerLensAction("docs", "db-row-update", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const db = dcDatabases(s, dcActor(ctx)).find((d) => d.id === params.id);
    if (!db) return { ok: false, error: "database not found" };
    const row = db.rows.find((r) => r.id === params.rowId);
    if (!row) return { ok: false, error: "row not found" };
    const incoming = params.cells && typeof params.cells === "object" ? params.cells : {};
    for (const col of db.columns) {
      if (!(col.id in incoming)) continue;
      const v = incoming[col.id];
      if (col.type === "number") row.cells[col.id] = Number.isFinite(Number(v)) ? Number(v) : 0;
      else if (col.type === "checkbox") row.cells[col.id] = v === true;
      else row.cells[col.id] = dcClean(v, 1000);
    }
    db.updatedAt = dcNow();
    saveDocs();
    return { ok: true, result: { row } };
  });

  registerLensAction("docs", "db-row-delete", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const db = dcDatabases(s, dcActor(ctx)).find((d) => d.id === params.id);
    if (!db) return { ok: false, error: "database not found" };
    const i = db.rows.findIndex((r) => r.id === params.rowId);
    if (i < 0) return { ok: false, error: "row not found" };
    db.rows.splice(i, 1);
    db.updatedAt = dcNow();
    saveDocs();
    return { ok: true, result: { deleted: params.rowId } };
  });

  // ─── Templates gallery ───────────────────────────────────────────────
  // Built-in templates: deterministic block structures, no demo data —
  // these are scaffolds with empty/placeholder content the user fills in.
  const PAGE_TEMPLATES = [
    {
      id: "blank", name: "Blank page", icon: "📄",
      description: "An empty page.", blocks: [],
    },
    {
      id: "meeting-notes", name: "Meeting notes", icon: "📝",
      description: "Agenda, attendees, action items.",
      blocks: [
        { type: "heading2", text: "Attendees" },
        { type: "bulleted_list", text: "" },
        { type: "heading2", text: "Agenda" },
        { type: "numbered_list", text: "" },
        { type: "heading2", text: "Decisions" },
        { type: "callout", text: "", data: { tone: "info", emoji: "✅" } },
        { type: "heading2", text: "Action items" },
        { type: "todo", text: "" },
      ],
    },
    {
      id: "project-plan", name: "Project plan", icon: "🎯",
      description: "Goal, milestones, risks.",
      blocks: [
        { type: "heading1", text: "Project plan" },
        { type: "heading2", text: "Goal" },
        { type: "paragraph", text: "" },
        { type: "heading2", text: "Milestones" },
        { type: "table", text: "", data: { rows: [["Milestone", "Owner", "Due"], ["", "", ""]] } },
        { type: "heading2", text: "Risks" },
        { type: "callout", text: "", data: { tone: "warning", emoji: "⚠️" } },
      ],
    },
    {
      id: "engineering-spec", name: "Engineering spec", icon: "⚙️",
      description: "Context, design, alternatives.",
      blocks: [
        { type: "heading1", text: "Spec" },
        { type: "heading2", text: "Context" },
        { type: "paragraph", text: "" },
        { type: "heading2", text: "Proposed design" },
        { type: "paragraph", text: "" },
        { type: "code", text: "", data: { language: "javascript" } },
        { type: "heading2", text: "Alternatives considered" },
        { type: "toggle", text: "Alternative A", data: { open: false } },
        { type: "heading2", text: "Open questions" },
        { type: "todo", text: "" },
      ],
    },
    {
      id: "knowledge-base", name: "Knowledge base article", icon: "📚",
      description: "Summary, steps, references.",
      blocks: [
        { type: "heading1", text: "Article title" },
        { type: "quote", text: "" },
        { type: "heading2", text: "Steps" },
        { type: "numbered_list", text: "" },
        { type: "heading2", text: "References" },
        { type: "embed", text: "", data: { kind: "link", url: "" } },
      ],
    },
  ];

  registerLensAction("docs", "template-list", (_ctx, _a, _params = {}) => {
    return {
      ok: true,
      result: {
        templates: PAGE_TEMPLATES.map((t) => ({
          id: t.id, name: t.name, icon: t.icon,
          description: t.description, blockCount: t.blocks.length,
        })),
        count: PAGE_TEMPLATES.length,
      },
    };
  });

  registerLensAction("docs", "template-apply", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const tpl = PAGE_TEMPLATES.find((t) => t.id === params.templateId);
    if (!tpl) return { ok: false, error: "template not found" };
    const userId = dcActor(ctx);
    const pages = dcPages(s, userId);
    const parentId = params.parentId && pages.some((p) => p.id === params.parentId)
      ? params.parentId : null;
    const page = {
      id: dcId("pg"),
      title: dcClean(params.title, 200) || tpl.name,
      icon: tpl.icon,
      parentId,
      blocks: tpl.blocks.map((b) => ({
        id: dcId("bl"),
        type: BLOCK_TYPES.includes(b.type) ? b.type : "paragraph",
        text: b.type === "divider" ? "" : dcClean(b.text, 8000),
        checked: false,
        data: dcBlockData(b.type, b.data || {}),
        createdAt: dcNow(),
      })),
      createdAt: dcNow(),
      updatedAt: dcNow(),
    };
    pages.push(page);
    saveDocs();
    return { ok: true, result: { page } };
  });

  // ─── Backlinks / mentions graph ──────────────────────────────────────
  // A page "mentions" another when a block's text contains [[Title]] or
  // [[pageId]]. backlinks resolves those mentions into a graph.
  function dcMentionTargets(text, pages) {
    const out = [];
    const re = /\[\[([^\]]{1,200})\]\]/g;
    let mm;
    while ((mm = re.exec(text)) !== null) {
      const token = mm[1].trim();
      if (!token) continue;
      const byId = pages.find((p) => p.id === token);
      const byTitle = pages.find(
        (p) => p.title.toLowerCase() === token.toLowerCase());
      if (byId) out.push(byId.id);
      else if (byTitle) out.push(byTitle.id);
    }
    return out;
  }

  registerLensAction("docs", "backlinks", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pages = dcPages(s, dcActor(ctx));
    const target = pages.find((p) => p.id === params.pageId);
    if (!target) return { ok: false, error: "page not found" };
    const incoming = [];
    for (const p of pages) {
      if (p.id === target.id) continue;
      const mentionedBlocks = [];
      for (const b of p.blocks) {
        const targets = dcMentionTargets(b.text || "", pages);
        if (targets.includes(target.id)) {
          mentionedBlocks.push({ blockId: b.id, snippet: b.text.slice(0, 160) });
        }
      }
      if (mentionedBlocks.length) {
        incoming.push({
          id: p.id, title: p.title, icon: p.icon, mentions: mentionedBlocks,
        });
      }
    }
    const outgoing = [];
    const seen = new Set();
    for (const b of target.blocks) {
      for (const tid of dcMentionTargets(b.text || "", pages)) {
        if (seen.has(tid) || tid === target.id) continue;
        seen.add(tid);
        const tp = pages.find((p) => p.id === tid);
        if (tp) outgoing.push({ id: tp.id, title: tp.title, icon: tp.icon });
      }
    }
    return {
      ok: true,
      result: {
        page: { id: target.id, title: target.title, icon: target.icon },
        backlinks: incoming,
        outgoingLinks: outgoing,
        backlinkCount: incoming.length,
        outgoingCount: outgoing.length,
      },
    };
  });

  registerLensAction("docs", "mentions-graph", (ctx, _a, _params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pages = dcPages(s, dcActor(ctx));
    const nodes = pages.map((p) => ({ id: p.id, title: p.title, icon: p.icon }));
    const edges = [];
    for (const p of pages) {
      const seen = new Set();
      for (const b of p.blocks) {
        for (const tid of dcMentionTargets(b.text || "", pages)) {
          if (tid === p.id || seen.has(tid)) continue;
          seen.add(tid);
          edges.push({ from: p.id, to: tid });
        }
      }
    }
    const inDegree = {};
    for (const e of edges) inDegree[e.to] = (inDegree[e.to] || 0) + 1;
    const mostLinked = nodes
      .map((nd) => ({ ...nd, backlinks: inDegree[nd.id] || 0 }))
      .sort((a, b) => b.backlinks - a.backlinks)
      .slice(0, 10);
    return {
      ok: true,
      result: { nodes, edges, edgeCount: edges.length, mostLinked },
    };
  });

  // ─── Share / permission controls per page ────────────────────────────
  function dcShares(s) {
    if (!(s.shares instanceof Map)) s.shares = new Map();
    return s.shares;
  }

  registerLensAction("docs", "share-set", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.pageId);
    if (!page) return { ok: false, error: "page not found" };
    const m = dcShares(s);
    const visibility = ["private", "link", "public"].includes(params.visibility)
      ? params.visibility : "private";
    const role = ["view", "edit"].includes(params.role) ? params.role : "view";
    let share = m.get(page.id);
    if (!share || visibility === "private") {
      share = {
        pageId: page.id,
        visibility,
        role,
        token: visibility === "private" ? null : (m.get(page.id)?.token || dcId("shr")),
        invites: m.get(page.id)?.invites || [],
        updatedAt: dcNow(),
      };
    } else {
      share.visibility = visibility;
      share.role = role;
      if (!share.token) share.token = dcId("shr");
      share.updatedAt = dcNow();
    }
    m.set(page.id, share);
    saveDocs();
    return {
      ok: true,
      result: {
        share,
        shareUrl: share.visibility === "private" ? null : `/shared/docs/${share.token}`,
      },
    };
  });

  registerLensAction("docs", "share-get", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.pageId);
    if (!page) return { ok: false, error: "page not found" };
    const share = dcShares(s).get(page.id) || {
      pageId: page.id, visibility: "private", role: "view",
      token: null, invites: [], updatedAt: null,
    };
    return {
      ok: true,
      result: {
        share,
        shareUrl: share.visibility === "private" || !share.token
          ? null : `/shared/docs/${share.token}`,
      },
    };
  });

  registerLensAction("docs", "share-invite", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.pageId);
    if (!page) return { ok: false, error: "page not found" };
    const invitee = dcClean(params.invitee, 120);
    if (!invitee) return { ok: false, error: "invitee required" };
    const m = dcShares(s);
    let share = m.get(page.id);
    if (!share) {
      share = {
        pageId: page.id, visibility: "private", role: "view",
        token: null, invites: [], updatedAt: dcNow(),
      };
      m.set(page.id, share);
    }
    const role = ["view", "edit"].includes(params.role) ? params.role : "view";
    const existing = share.invites.find((iv) => iv.invitee === invitee);
    if (existing) existing.role = role;
    else share.invites.push({ id: dcId("inv"), invitee, role, invitedAt: dcNow() });
    share.updatedAt = dcNow();
    saveDocs();
    return { ok: true, result: { invites: share.invites } };
  });

  registerLensAction("docs", "share-revoke", (ctx, _a, params = {}) => {
    const s = getDocsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const page = dcPages(s, dcActor(ctx)).find((p) => p.id === params.pageId);
    if (!page) return { ok: false, error: "page not found" };
    const share = dcShares(s).get(page.id);
    if (!share) return { ok: false, error: "no share settings" };
    const before = share.invites.length;
    share.invites = share.invites.filter((iv) => iv.id !== params.inviteId);
    if (share.invites.length === before) return { ok: false, error: "invite not found" };
    share.updatedAt = dcNow();
    saveDocs();
    return { ok: true, result: { invites: share.invites } };
  });
}
