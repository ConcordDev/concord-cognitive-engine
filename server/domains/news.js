// server/domains/news.js
// Domain actions for news analysis: media bias detection, event extraction,
// and narrative tracking across articles.

export default function registerNewsActions(registerLensAction) {
  /**
   * biasDetection
   * Detect media bias in news articles — sentiment asymmetry, source diversity,
   * loaded language detection, and framing analysis.
   * artifact.data.articles = [{ title, body, source?, date?, entities?: [string] }]
   */
  registerLensAction("news", "biasDetection", (ctx, artifact, params) => {
  try {
    const articles = artifact.data?.articles || [];
    if (articles.length === 0) {
      return { ok: true, result: { message: "No articles to analyze." } };
    }

    const r = (v) => Math.round(v * 10000) / 10000;

    // --- Loaded language lexicon (words that inject bias) ---
    const loadedPositive = new Set([
      "hero", "brave", "freedom", "patriot", "revolutionary", "visionary",
      "champion", "triumph", "beloved", "courageous", "historic", "landmark",
      "reform", "progress", "empower", "breakthrough", "innovative", "justice",
    ]);
    const loadedNegative = new Set([
      "radical", "extremist", "regime", "thug", "corrupt", "catastrophe",
      "crisis", "destroy", "devastating", "scandal", "failure", "dangerous",
      "threat", "controversial", "assault", "exploit", "scheme", "mob",
      "propaganda", "authoritarian", "reckless", "chaos",
    ]);
    const hedgeWords = new Set([
      "allegedly", "reportedly", "claimed", "purported", "so-called",
      "disputed", "unverified", "unconfirmed", "supposed",
    ]);

    // --- Analyze each article ---
    const articleAnalyses = articles.map((article, idx) => {
      const text = `${article.title || ""} ${article.body || ""}`.toLowerCase();
      const words = text.split(/\s+/).filter(w => w.length > 2);
      const wordCount = words.length;

      if (wordCount === 0) return { index: idx, source: article.source, biasScore: 0 };

      // Count loaded language
      let positiveCount = 0;
      let negativeCount = 0;
      let hedgeCount = 0;
      const foundLoaded = [];

      for (const word of words) {
        const clean = word.replace(/[^a-z]/g, "");
        if (loadedPositive.has(clean)) { positiveCount++; foundLoaded.push({ word: clean, polarity: "positive" }); }
        if (loadedNegative.has(clean)) { negativeCount++; foundLoaded.push({ word: clean, polarity: "negative" }); }
        if (hedgeWords.has(clean)) hedgeCount++;
      }

      // Loaded language density
      const loadedDensity = (positiveCount + negativeCount) / wordCount;

      // Sentiment asymmetry: if reporting on multiple entities but sentiment is one-sided
      const sentimentBalance = (positiveCount + negativeCount) > 0
        ? (positiveCount - negativeCount) / (positiveCount + negativeCount)
        : 0;

      // Hedge word ratio (higher = more tentative/balanced reporting)
      const hedgeRatio = hedgeCount / wordCount;

      // Framing detection: passive voice as proxy for agency framing
      const passivePattern = /\b(was|were|been|being|is|are)\s+\w+ed\b/g;
      const passiveMatches = text.match(passivePattern) || [];
      const passiveRatio = passiveMatches.length / Math.max(1, text.split(/[.!?]/).length);

      // Overall bias score for this article (0 = neutral, 1 = heavily biased)
      const biasScore = Math.min(1,
        loadedDensity * 15 +
        Math.abs(sentimentBalance) * 0.3 +
        (1 - Math.min(1, hedgeRatio * 50)) * 0.2
      );

      return {
        index: idx,
        source: article.source || "unknown",
        wordCount,
        loadedLanguage: {
          positive: positiveCount,
          negative: negativeCount,
          density: r(loadedDensity),
          examples: foundLoaded.slice(0, 10),
        },
        sentimentBalance: r(sentimentBalance),
        hedgeRatio: r(hedgeRatio),
        passiveVoiceRatio: r(passiveRatio),
        biasScore: r(biasScore),
        biasDirection: sentimentBalance > 0.2 ? "positive" : sentimentBalance < -0.2 ? "negative" : "neutral",
      };
    });

    // --- Source diversity analysis ---
    const sourceCounts = {};
    for (const a of articles) {
      const src = a.source || "unknown";
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
    }
    const sources = Object.keys(sourceCounts);
    const sourceEntropy = sources.length > 1
      ? -sources.reduce((s, src) => {
          const p = sourceCounts[src] / articles.length;
          return s + (p > 0 ? p * Math.log2(p) : 0);
        }, 0)
      : 0;
    const maxEntropy = Math.log2(sources.length || 1);
    const sourceDiversity = maxEntropy > 0 ? sourceEntropy / maxEntropy : 0;

    // --- Cross-article bias by source ---
    const sourceBias = {};
    for (const analysis of articleAnalyses) {
      const src = analysis.source;
      if (!sourceBias[src]) sourceBias[src] = { scores: [], sentiments: [] };
      sourceBias[src].scores.push(analysis.biasScore);
      sourceBias[src].sentiments.push(analysis.sentimentBalance);
    }
    const sourceBiasProfiles = Object.entries(sourceBias).map(([source, data]) => ({
      source,
      articleCount: data.scores.length,
      avgBiasScore: r(data.scores.reduce((s, v) => s + v, 0) / data.scores.length),
      avgSentiment: r(data.sentiments.reduce((s, v) => s + v, 0) / data.sentiments.length),
      consistency: r(1 - (data.scores.length > 1
        ? Math.sqrt(data.scores.reduce((s, v) => s + Math.pow(v - data.scores.reduce((a, b) => a + b, 0) / data.scores.length, 2), 0) / data.scores.length)
        : 0)),
    })).sort((a, b) => b.avgBiasScore - a.avgBiasScore);

    // --- Overall assessment ---
    const overallBias = articleAnalyses.reduce((s, a) => s + a.biasScore, 0) / articleAnalyses.length;

    return {
      ok: true,
      result: {
        articlesAnalyzed: articles.length,
        overallBiasScore: r(overallBias),
        biasLevel: overallBias > 0.6 ? "high" : overallBias > 0.3 ? "moderate" : "low",
        sourceDiversity: {
          uniqueSources: sources.length,
          entropy: r(sourceEntropy),
          normalizedDiversity: r(sourceDiversity),
          assessment: sourceDiversity > 0.8 ? "diverse" : sourceDiversity > 0.5 ? "moderate" : "concentrated",
        },
        sourceBiasProfiles,
        articleAnalyses: articleAnalyses.slice(0, 20),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * eventExtraction
   * Extract structured events from news text — identify who/what/when/where/why,
   * temporal ordering, and event clustering.
   * artifact.data.articles = [{ title, body, date?, source? }]
   */
  registerLensAction("news", "eventExtraction", (ctx, artifact, params) => {
  try {
    const articles = artifact.data?.articles || [];
    if (articles.length === 0) {
      return { ok: true, result: { message: "No articles for event extraction." } };
    }

    const r = (v) => Math.round(v * 10000) / 10000;

    // --- Event extraction patterns ---
    const actionVerbs = /\b(announced|signed|launched|arrested|attacked|voted|passed|approved|rejected|killed|fired|hired|appointed|resigned|banned|imposed|sanctioned|invaded|declared|discovered|released|closed|opened|merged|acquired|sued|convicted|charged|collapsed|elected|defeated|won|lost|protested|evacuated|rescued|crashed|exploded)\b/gi;

    const personPattern = /\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/g;
    const orgPattern = /\b(?:the\s+)?([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,3})\s+(?:Corp|Inc|Ltd|LLC|Group|Council|Commission|Authority|Department|Ministry|Agency|Organization|Association|Foundation|Institute|University|Bank|Company)\b/g;
    const locationPattern = /\b(?:in|at|from|near|across)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g;
    const datePattern = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|(?:yesterday|today|last\s+\w+|this\s+\w+))\b/gi;

    const allEvents = [];

    for (let artIdx = 0; artIdx < articles.length; artIdx++) {
      const article = articles[artIdx];
      const text = `${article.title || ""}. ${article.body || ""}`;
      const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);

      for (const sentence of sentences) {
        // Find action verbs
        const verbs = [];
        let match;
        const verbRegex = new RegExp(actionVerbs.source, "gi");
        while ((match = verbRegex.exec(sentence)) !== null) {
          verbs.push(match[1].toLowerCase());
        }

        if (verbs.length === 0) continue;

        // Extract entities
        const persons = [];
        const personRegex = new RegExp(personPattern.source, "g");
        while ((match = personRegex.exec(sentence)) !== null) {
          persons.push(match[1]);
        }

        const organizations = [];
        const orgRegex = new RegExp(orgPattern.source, "g");
        while ((match = orgRegex.exec(sentence)) !== null) {
          organizations.push(match[1].trim());
        }

        const locations = [];
        const locRegex = new RegExp(locationPattern.source, "g");
        while ((match = locRegex.exec(sentence)) !== null) {
          locations.push(match[1]);
        }

        const dates = [];
        const dateRegex = new RegExp(datePattern.source, "gi");
        while ((match = dateRegex.exec(sentence)) !== null) {
          dates.push(match[1]);
        }

        allEvents.push({
          articleIndex: artIdx,
          source: article.source || "unknown",
          articleDate: article.date || null,
          sentence: sentence.substring(0, 200),
          action: verbs[0],
          allActions: verbs,
          who: [...new Set([...persons, ...organizations])].slice(0, 5),
          where: [...new Set(locations)].slice(0, 3),
          when: dates.length > 0 ? dates[0] : (article.date || null),
        });
      }
    }

    // --- Temporal ordering ---
    const withDates = allEvents.map(e => {
      let ts = null;
      if (e.when) {
        const parsed = new Date(e.when);
        if (!isNaN(parsed.getTime())) ts = parsed.getTime();
      }
      if (!ts && e.articleDate) {
        const parsed = new Date(e.articleDate);
        if (!isNaN(parsed.getTime())) ts = parsed.getTime();
      }
      return { ...e, timestamp: ts };
    });

    const chronological = withDates
      .filter(e => e.timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);

    // --- Event clustering by action + entity similarity ---
    const clusters = [];
    const assigned = new Set();

    for (let i = 0; i < allEvents.length; i++) {
      if (assigned.has(i)) continue;
      const cluster = [i];
      assigned.add(i);

      for (let j = i + 1; j < allEvents.length; j++) {
        if (assigned.has(j)) continue;

        // Similarity: shared action verbs + shared entities
        const sharedActions = allEvents[i].allActions.filter(a => allEvents[j].allActions.includes(a)).length;
        const entitiesI = new Set(allEvents[i].who.map(e => e.toLowerCase()));
        const entitiesJ = new Set(allEvents[j].who.map(e => e.toLowerCase()));
        const sharedEntities = [...entitiesI].filter(e => entitiesJ.has(e)).length;
        const unionEntities = new Set([...entitiesI, ...entitiesJ]).size;

        const entitySim = unionEntities > 0 ? sharedEntities / unionEntities : 0;
        const actionSim = sharedActions > 0 ? 1 : 0;
        const similarity = entitySim * 0.6 + actionSim * 0.4;

        if (similarity > 0.3) {
          cluster.push(j);
          assigned.add(j);
        }
      }

      if (cluster.length > 0) {
        const clusterEvents = cluster.map(idx => allEvents[idx]);
        const allEntities = [...new Set(clusterEvents.flatMap(e => e.who))];
        const allActions = [...new Set(clusterEvents.flatMap(e => e.allActions))];

        clusters.push({
          eventCount: cluster.length,
          primaryAction: allActions[0],
          actions: allActions,
          entities: allEntities.slice(0, 10),
          sources: [...new Set(clusterEvents.map(e => e.source))],
          representative: clusterEvents[0].sentence,
        });
      }
    }

    clusters.sort((a, b) => b.eventCount - a.eventCount);

    return {
      ok: true,
      result: {
        articlesProcessed: articles.length,
        eventsExtracted: allEvents.length,
        events: allEvents.slice(0, 30),
        timeline: chronological.slice(0, 20).map(e => ({
          when: e.when,
          action: e.action,
          who: e.who,
          where: e.where,
          sentence: e.sentence,
        })),
        clusters: clusters.slice(0, 15),
        topEntities: (() => {
          const counts = {};
          for (const e of allEvents) for (const who of e.who) counts[who] = (counts[who] || 0) + 1;
          return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([entity, count]) => ({ entity, mentions: count }));
        })(),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * narrativeTracking
   * Track narrative evolution across articles — compute narrative similarity
   * over time, identify shifts in framing.
   * artifact.data.articles = [{ title, body, date, source? }]
   * params.windowSize — number of articles per window (default 3)
   */
  registerLensAction("news", "narrativeTracking", (ctx, artifact, params) => {
  try {
    const articles = artifact.data?.articles || [];
    if (articles.length < 2) {
      return { ok: true, result: { message: "Need at least 2 articles to track narrative." } };
    }

    const windowSize = params.windowSize || 3;
    const r = (v) => Math.round(v * 10000) / 10000;

    // Sort articles chronologically
    const sorted = [...articles].map((a, i) => ({
      ...a,
      originalIndex: i,
      ts: new Date(a.date).getTime(),
    })).sort((a, b) => (isNaN(a.ts) ? 0 : a.ts) - (isNaN(b.ts) ? 0 : b.ts));

    // --- Build TF-IDF vectors for each article ---
    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "shall", "can", "to", "of", "in", "for",
      "on", "with", "at", "by", "from", "as", "into", "through", "during",
      "before", "after", "above", "below", "and", "but", "or", "nor", "not",
      "so", "yet", "both", "either", "neither", "each", "every", "all",
      "any", "few", "more", "most", "other", "some", "such", "no", "only",
      "same", "than", "too", "very", "just", "that", "this", "these", "those",
      "it", "its", "he", "she", "they", "them", "his", "her", "their", "we",
      "our", "you", "your", "who", "which", "what", "where", "when", "how",
    ]);

    function tokenize(text) {
      return (text || "").toLowerCase()
        .replace(/[^a-z\s]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));
    }

    // Term frequency per document
    const docTokens = sorted.map(a => tokenize(`${a.title || ""} ${a.body || ""}`));
    const docTFs = docTokens.map(tokens => {
      const tf = {};
      for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
      const max = Math.max(...Object.values(tf), 1);
      for (const t of Object.keys(tf)) tf[t] = tf[t] / max;
      return tf;
    });

    // Inverse document frequency
    const allTerms = new Set(docTFs.flatMap(tf => Object.keys(tf)));
    const idf = {};
    for (const term of allTerms) {
      const docCount = docTFs.filter(tf => tf[term]).length;
      idf[term] = Math.log(sorted.length / (docCount + 1)) + 1;
    }

    // TF-IDF vectors
    const tfidfVectors = docTFs.map(tf => {
      const vec = {};
      for (const term of Object.keys(tf)) {
        vec[term] = tf[term] * (idf[term] || 1);
      }
      return vec;
    });

    // Cosine similarity between two sparse vectors
    function cosineSim(a, b) {
      const terms = new Set([...Object.keys(a), ...Object.keys(b)]);
      let dot = 0, normA = 0, normB = 0;
      for (const t of terms) {
        const va = a[t] || 0;
        const vb = b[t] || 0;
        dot += va * vb;
        normA += va * va;
        normB += vb * vb;
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      return denom > 0 ? dot / denom : 0;
    }

    // --- Pairwise narrative similarity over time ---
    const similarities = [];
    for (let i = 1; i < sorted.length; i++) {
      similarities.push({
        from: i - 1,
        to: i,
        date: sorted[i].date,
        similarity: r(cosineSim(tfidfVectors[i - 1], tfidfVectors[i])),
      });
    }

    // --- Windowed narrative analysis ---
    const windows = [];
    for (let i = 0; i <= sorted.length - windowSize; i++) {
      const windowArticles = sorted.slice(i, i + windowSize);
      const windowTokens = windowArticles.flatMap((_, j) => docTokens[i + j]);

      // Top terms in this window
      const termFreq = {};
      for (const t of windowTokens) termFreq[t] = (termFreq[t] || 0) + 1;
      const topTerms = Object.entries(termFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([term, count]) => ({ term, count }));

      // Average internal similarity
      let internalSim = 0;
      let pairs = 0;
      for (let j = i; j < i + windowSize; j++) {
        for (let k = j + 1; k < i + windowSize; k++) {
          internalSim += cosineSim(tfidfVectors[j], tfidfVectors[k]);
          pairs++;
        }
      }
      internalSim = pairs > 0 ? internalSim / pairs : 0;

      windows.push({
        windowStart: i,
        dateRange: { from: windowArticles[0].date, to: windowArticles[windowArticles.length - 1].date },
        topTerms,
        coherence: r(internalSim),
        articleCount: windowSize,
      });
    }

    // --- Detect narrative shifts (low similarity between consecutive windows) ---
    const shifts = [];
    for (let i = 1; i < windows.length; i++) {
      // Cross-window similarity
      const prevTerms = new Set(windows[i - 1].topTerms.map(t => t.term));
      const currTerms = new Set(windows[i].topTerms.map(t => t.term));
      const shared = [...prevTerms].filter(t => currTerms.has(t)).length;
      const overlap = (prevTerms.size + currTerms.size) > 0
        ? (2 * shared) / (prevTerms.size + currTerms.size)
        : 0;

      if (overlap < 0.4) {
        const newTerms = [...currTerms].filter(t => !prevTerms.has(t));
        const droppedTerms = [...prevTerms].filter(t => !currTerms.has(t));
        shifts.push({
          atWindow: i,
          date: windows[i].dateRange.from,
          topicOverlap: r(overlap),
          newFramingTerms: newTerms,
          droppedTerms,
          shiftMagnitude: r(1 - overlap),
        });
      }
    }

    // --- Overall narrative stability ---
    const avgSimilarity = similarities.length > 0
      ? similarities.reduce((s, sim) => s + sim.similarity, 0) / similarities.length
      : 0;

    return {
      ok: true,
      result: {
        articlesTracked: sorted.length,
        dateRange: {
          from: sorted[0].date,
          to: sorted[sorted.length - 1].date,
        },
        pairwiseSimilarities: similarities,
        narrativeStability: r(avgSimilarity),
        stabilityLevel: avgSimilarity > 0.6 ? "stable" : avgSimilarity > 0.3 ? "evolving" : "volatile",
        windows: windows.slice(0, 20),
        narrativeShifts: shifts,
        shiftCount: shifts.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Parity-sprint ──
  // ── Real headlines via GDELT Project (free, no key) ──
  //
  // GDELT 2.0 doc API returns real news articles indexed every 15 minutes
  // from sources worldwide. No API key, no rate limit for reasonable use.
  // Endpoint: api.gdeltproject.org/api/v2/doc/doc

  const CATEGORY_QUERIES = {
    top:        "(world OR breaking) sourcelang:eng",
    world:      "(world OR international OR foreign) sourcelang:eng",
    business:   "(business OR economy OR markets OR earnings) sourcelang:eng",
    tech:       "(technology OR AI OR software OR startup) sourcelang:eng",
    science:    "(science OR research OR climate OR space) sourcelang:eng",
    politics:   "(politics OR congress OR election OR policy) sourcelang:eng",
    sports:     "(sports OR olympics OR football OR basketball) sourcelang:eng",
    health:     "(health OR medicine OR vaccine OR pandemic) sourcelang:eng",
    entertainment: "(entertainment OR film OR music OR celebrity) sourcelang:eng",
  };

  async function fetchGdeltArticles(query, limit) {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&maxrecords=${limit}&format=json&sort=DateDesc`;
    const r = await globalThis.fetch(url);
    if (!r.ok) throw new Error(`GDELT ${r.status}`);
    const data = await r.json();
    return Array.isArray(data?.articles) ? data.articles : [];
  }

  function mapGdeltArticle(a, idx, category) {
    return {
      id: `hl_${category}_${idx}`,
      category,
      title: a.title || "",
      url: a.url || "",
      source: a.domain || "",
      sourceCountry: a.sourcecountry || null,
      language: a.language || "English",
      publishedAt: a.seendate ? new Date(`${a.seendate.slice(0,4)}-${a.seendate.slice(4,6)}-${a.seendate.slice(6,8)}T${a.seendate.slice(9,11)}:${a.seendate.slice(11,13)}:${a.seendate.slice(13,15)}Z`).toISOString() : new Date().toISOString(),
      socialImageUrl: a.socialimage || null,
    };
  }

  registerLensAction("news", "headlines", async (_ctx, _artifact, params = {}) => {
    const category = String(params.category || "top");
    const limit = Math.min(50, Math.max(5, Number(params.limit) || 30));
    const query = CATEGORY_QUERIES[category] || CATEGORY_QUERIES.top;
    try {
      const articles = await fetchGdeltArticles(query, limit);
      const headlines = articles.map((a, i) => mapGdeltArticle(a, i, category));
      return {
        ok: true,
        result: {
          headlines,
          category,
          count: headlines.length,
          source: "GDELT Project (real-time global news, no key required)",
        },
      };
    } catch (e) {
      return { ok: false, error: `headlines fetch failed: ${e?.message || "network"}` };
    }
  });

  registerLensAction("news", "daily-briefing", async (ctx, _artifact, _params = {}) => {
    const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const greeting = `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'} — here's what's happening today.`;
    let tops = [], biz = [], tech = [], sci = [];
    try {
      [tops, biz, tech, sci] = await Promise.all([
        fetchGdeltArticles(CATEGORY_QUERIES.world, 5),
        fetchGdeltArticles(CATEGORY_QUERIES.business, 4),
        fetchGdeltArticles(CATEGORY_QUERIES.tech, 4),
        fetchGdeltArticles(CATEGORY_QUERIES.science, 3),
      ]);
    } catch (e) {
      return { ok: false, error: `briefing fetch failed: ${e?.message || "network"}` };
    }
    const summarise = arr => arr.map(a => a.title).filter(Boolean);
    let briefing = {
      greeting, date: today,
      topStories: { heading: "Top stories", bullets: summarise(tops) },
      business: { heading: "Business & markets", bullets: summarise(biz) },
      tech: { heading: "Technology", bullets: summarise(tech) },
      science: { heading: "Science & health", bullets: summarise(sci) },
      closing: "That's the briefing. Read any story in full from the Headlines tab.",
      source: "GDELT Project",
    };
    if (ctx?.llm?.chat) {
      try {
        const llmRes = await ctx.llm.chat({
          messages: [
            { role: "system", content: `Write a 1-sentence punchy closing for a news briefing. Output ONLY the sentence, no quotes.` },
            { role: "user", content: `Briefing covered ${tops.length + biz.length + tech.length + sci.length} stories across world, business, tech, science.` },
          ],
          temperature: 0.7, maxTokens: 60, slot: "utility",
        });
        const t = String(llmRes?.text || llmRes?.content || "").trim();
        if (t && t.length < 200) briefing = { ...briefing, closing: t };
      } catch (_e) { /* keep default */ }
    }
    return { ok: true, result: briefing };
  });

  // ─── Apple News 2026 parity — personalized news reader ──────────────
  // Article directory, followed channels + topics, a personalized feed,
  // Today digest, saved stories, reading history + stats, reactions.

  function getNewsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.newsLens) STATE.newsLens = {};
    const s = STATE.newsLens;
    for (const k of [
      "articles", "followedChannels", "followedTopics", "saved",
      "readState", "reactions", "interestWeights",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveNewsState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const nwid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const nwnow = () => new Date().toISOString();
  const nwaid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const nwlistB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const nwclean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const NW_DAY = 86400000;

  function articleView(s, userId, art) {
    const read = (s.readState.get(userId) || []).find((r) => r.articleId === art.id);
    const saved = (s.saved.get(userId) || []).includes(art.id);
    return { ...art, read: !!read, readAt: read ? read.readAt : null, saved };
  }
  function bumpInterest(s, userId, topic, source, delta) {
    const w = s.interestWeights.get(userId) || { topics: {}, sources: {} };
    if (topic) w.topics[topic] = Math.max(-5, Math.min(10, (w.topics[topic] || 0) + delta));
    if (source) w.sources[source] = Math.max(-5, Math.min(10, (w.sources[source] || 0) + delta));
    s.interestWeights.set(userId, w);
  }
  function interestScore(s, userId, art) {
    const w = s.interestWeights.get(userId) || { topics: {}, sources: {} };
    return (w.topics[art.topic] || 0) + (w.sources[art.source] || 0);
  }

  // ── Articles ────────────────────────────────────────────────────────
  registerLensAction("news", "article-add", (ctx, _a, params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = nwclean(params.title, 240);
    if (!title) return { ok: false, error: "title required" };
    const source = nwclean(params.source, 80) || "Unknown";
    const art = {
      id: nwid("art"), title, source,
      topic: nwclean(params.topic, 60).toLowerCase() || "general",
      summary: nwclean(params.summary, 1000) || null,
      url: nwclean(params.url, 500) || null,
      publishedAt: nwclean(params.publishedAt, 25) || nwnow(),
      addedBy: nwaid(ctx), createdAt: nwnow(),
    };
    s.articles.set(art.id, art);
    saveNewsState();
    return { ok: true, result: { article: art } };
  });

  registerLensAction("news", "article-list", (ctx, _a, params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = nwaid(ctx);
    let arts = [...s.articles.values()];
    if (params.topic) arts = arts.filter((a) => a.topic === String(params.topic).toLowerCase());
    if (params.source) arts = arts.filter((a) => a.source === params.source);
    arts.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
    return { ok: true, result: { articles: arts.map((a) => articleView(s, userId, a)), count: arts.length } };
  });

  registerLensAction("news", "article-detail", (ctx, _a, params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = s.articles.get(String(params.id));
    if (!art) return { ok: false, error: "article not found" };
    return { ok: true, result: { article: articleView(s, nwaid(ctx), art) } };
  });

  registerLensAction("news", "article-search", (ctx, _a, params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = nwclean(params.query, 80).toLowerCase();
    const userId = nwaid(ctx);
    let arts = [...s.articles.values()];
    if (q) {
      arts = arts.filter((a) =>
        a.title.toLowerCase().includes(q) ||
        a.source.toLowerCase().includes(q) ||
        a.topic.includes(q) ||
        (a.summary || "").toLowerCase().includes(q));
    }
    arts.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
    return { ok: true, result: { articles: arts.map((a) => articleView(s, userId, a)), count: arts.length } };
  });

  registerLensAction("news", "article-delete", (ctx, _a, params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = s.articles.get(String(params.id));
    if (!art) return { ok: false, error: "article not found" };
    if (art.addedBy !== nwaid(ctx)) return { ok: false, error: "only the contributor can remove this article" };
    s.articles.delete(art.id);
    saveNewsState();
    return { ok: true, result: { deleted: art.id } };
  });

  // ── Channels (sources) ──────────────────────────────────────────────
  registerLensAction("news", "channel-list", (ctx, _a, _params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = nwaid(ctx);
    const followed = s.followedChannels.get(userId) || [];
    const counts = new Map();
    for (const a of s.articles.values()) counts.set(a.source, (counts.get(a.source) || 0) + 1);
    const channels = [...counts.entries()]
      .map(([source, count]) => ({ source, articleCount: count, followed: followed.includes(source) }))
      .sort((a, b) => b.articleCount - a.articleCount);
    return { ok: true, result: { channels, following: followed.length } };
  });

  registerLensAction("news", "channel-follow", (ctx, _a, params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const source = nwclean(params.source, 80);
    if (!source) return { ok: false, error: "source required" };
    const userId = nwaid(ctx);
    const list = nwlistB(s.followedChannels, userId);
    const idx = list.indexOf(source);
    const following = idx < 0;
    if (following) list.push(source);
    else list.splice(idx, 1);
    bumpInterest(s, userId, null, source, following ? 2 : -2);
    saveNewsState();
    return { ok: true, result: { source, following } };
  });

  registerLensAction("news", "channel-articles", (ctx, _a, params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const source = nwclean(params.source, 80);
    const userId = nwaid(ctx);
    const arts = [...s.articles.values()]
      .filter((a) => a.source === source)
      .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
      .map((a) => articleView(s, userId, a));
    return { ok: true, result: { source, articles: arts, count: arts.length } };
  });

  // ── Topics ──────────────────────────────────────────────────────────
  registerLensAction("news", "topic-list", (ctx, _a, _params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = nwaid(ctx);
    const followed = s.followedTopics.get(userId) || [];
    const counts = new Map();
    for (const a of s.articles.values()) counts.set(a.topic, (counts.get(a.topic) || 0) + 1);
    const topics = [...counts.entries()]
      .map(([topic, count]) => ({ topic, articleCount: count, followed: followed.includes(topic) }))
      .sort((a, b) => b.articleCount - a.articleCount);
    return { ok: true, result: { topics, following: followed.length } };
  });

  registerLensAction("news", "topic-follow", (ctx, _a, params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const topic = nwclean(params.topic, 60).toLowerCase();
    if (!topic) return { ok: false, error: "topic required" };
    const userId = nwaid(ctx);
    const list = nwlistB(s.followedTopics, userId);
    const idx = list.indexOf(topic);
    const following = idx < 0;
    if (following) list.push(topic);
    else list.splice(idx, 1);
    bumpInterest(s, userId, topic, null, following ? 2 : -2);
    saveNewsState();
    return { ok: true, result: { topic, following } };
  });

  registerLensAction("news", "topic-articles", (ctx, _a, params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const topic = nwclean(params.topic, 60).toLowerCase();
    const userId = nwaid(ctx);
    const arts = [...s.articles.values()]
      .filter((a) => a.topic === topic)
      .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
      .map((a) => articleView(s, userId, a));
    return { ok: true, result: { topic, articles: arts, count: arts.length } };
  });

  // ── Personalized feed ───────────────────────────────────────────────
  registerLensAction("news", "feed", (ctx, _a, _params = {}) => {
  try {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = nwaid(ctx);
    const channels = s.followedChannels.get(userId) || [];
    const topics = s.followedTopics.get(userId) || [];
    const hasFollows = channels.length > 0 || topics.length > 0;
    let arts = [...s.articles.values()];
    if (hasFollows) {
      arts = arts.filter((a) => channels.includes(a.source) || topics.includes(a.topic));
    }
    const view = arts.map((a) => articleView(s, userId, a));
    view.sort((a, b) => {
      if (a.read !== b.read) return a.read ? 1 : -1; // unread first
      return String(b.publishedAt).localeCompare(String(a.publishedAt));
    });
    return {
      ok: true,
      result: {
        articles: view, count: view.length,
        personalized: hasFollows,
        unread: view.filter((a) => !a.read).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("news", "today-digest", (ctx, _a, _params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = nwaid(ctx);
    const cutoff = Date.now() - 2 * NW_DAY;
    const recent = [...s.articles.values()]
      .filter((a) => new Date(a.publishedAt).getTime() >= cutoff || true) // include all; recency-sorted below
      .map((a) => articleView(s, userId, a))
      .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
    const byTopic = {};
    for (const a of recent) (byTopic[a.topic] = byTopic[a.topic] || []).push(a);
    const sections = Object.entries(byTopic)
      .map(([topic, items]) => ({ topic, items: items.slice(0, 5), count: items.length }))
      .sort((a, b) => b.count - a.count);
    return {
      ok: true,
      result: { topStories: recent.slice(0, 5), sections, totalArticles: recent.length },
    };
  });

  registerLensAction("news", "recommended", (ctx, _a, _params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = nwaid(ctx);
    const recs = [...s.articles.values()]
      .map((a) => ({ ...articleView(s, userId, a), score: interestScore(s, userId, a) }))
      .filter((a) => !a.read && a.score > 0)
      .sort((a, b) => b.score - a.score || String(b.publishedAt).localeCompare(String(a.publishedAt)));
    return { ok: true, result: { articles: recs.slice(0, 25), count: recs.length } };
  });

  registerLensAction("news", "trending", (ctx, _a, _params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const reads = new Map();
    for (const list of s.readState.values()) {
      for (const r of list) reads.set(r.articleId, (reads.get(r.articleId) || 0) + 1);
    }
    const reactions = new Map();
    for (const list of s.reactions.values()) {
      for (const r of list) if (r.kind === "more") reactions.set(r.articleId, (reactions.get(r.articleId) || 0) + 1);
    }
    const userId = nwaid(ctx);
    const ranked = [...s.articles.values()]
      .map((a) => ({
        ...articleView(s, userId, a),
        readCount: reads.get(a.id) || 0,
        engagement: (reads.get(a.id) || 0) + (reactions.get(a.id) || 0) * 2,
      }))
      .filter((a) => a.engagement > 0)
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, 20);
    return { ok: true, result: { articles: ranked, count: ranked.length } };
  });

  // ── Saved stories ───────────────────────────────────────────────────
  registerLensAction("news", "article-save", (ctx, _a, params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!s.articles.has(String(params.id))) return { ok: false, error: "article not found" };
    const userId = nwaid(ctx);
    const list = nwlistB(s.saved, userId);
    const idx = list.indexOf(String(params.id));
    const saved = idx < 0;
    if (saved) list.push(String(params.id));
    else list.splice(idx, 1);
    saveNewsState();
    return { ok: true, result: { articleId: params.id, saved } };
  });

  registerLensAction("news", "saved-list", (ctx, _a, _params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = nwaid(ctx);
    const articles = (s.saved.get(userId) || [])
      .map((id) => { const a = s.articles.get(id); return a ? articleView(s, userId, a) : null; })
      .filter(Boolean)
      .reverse();
    return { ok: true, result: { articles, count: articles.length } };
  });

  // ── Reading history + stats ─────────────────────────────────────────
  registerLensAction("news", "article-mark-read", (ctx, _a, params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = s.articles.get(String(params.id));
    if (!art) return { ok: false, error: "article not found" };
    const userId = nwaid(ctx);
    const list = nwlistB(s.readState, userId);
    const existing = list.find((r) => r.articleId === art.id);
    if (params.unread === true) {
      if (existing) list.splice(list.indexOf(existing), 1);
    } else if (!existing) {
      list.push({ articleId: art.id, readAt: nwnow() });
      bumpInterest(s, userId, art.topic, art.source, 0.5);
    }
    saveNewsState();
    return { ok: true, result: { articleId: art.id, read: params.unread !== true } };
  });

  registerLensAction("news", "reading-history", (ctx, _a, _params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = nwaid(ctx);
    const history = (s.readState.get(userId) || [])
      .map((r) => { const a = s.articles.get(r.articleId); return a ? { ...articleView(s, userId, a), readAt: r.readAt } : null; })
      .filter(Boolean)
      .sort((a, b) => String(b.readAt).localeCompare(String(a.readAt)));
    return { ok: true, result: { history, count: history.length } };
  });

  registerLensAction("news", "reading-stats", (ctx, _a, _params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = nwaid(ctx);
    const reads = s.readState.get(userId) || [];
    const weekAgo = Date.now() - 7 * NW_DAY;
    const byTopic = {};
    for (const r of reads) {
      const a = s.articles.get(r.articleId);
      if (a) byTopic[a.topic] = (byTopic[a.topic] || 0) + 1;
    }
    const topTopics = Object.entries(byTopic).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([topic, count]) => ({ topic, count }));
    return {
      ok: true,
      result: {
        totalRead: reads.length,
        thisWeek: reads.filter((r) => new Date(r.readAt).getTime() >= weekAgo).length,
        topTopics,
        saved: (s.saved.get(userId) || []).length,
      },
    };
  });

  // ── Personalization ─────────────────────────────────────────────────
  registerLensAction("news", "article-react", (ctx, _a, params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = s.articles.get(String(params.id));
    if (!art) return { ok: false, error: "article not found" };
    const kind = ["more", "less"].includes(String(params.kind).toLowerCase()) ? String(params.kind).toLowerCase() : null;
    if (!kind) return { ok: false, error: "kind must be 'more' or 'less'" };
    const userId = nwaid(ctx);
    const list = nwlistB(s.reactions, userId);
    list.push({ articleId: art.id, kind, at: nwnow() });
    bumpInterest(s, userId, art.topic, art.source, kind === "more" ? 1.5 : -1.5);
    saveNewsState();
    return { ok: true, result: { articleId: art.id, kind } };
  });

  registerLensAction("news", "interests", (ctx, _a, _params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const w = s.interestWeights.get(nwaid(ctx)) || { topics: {}, sources: {} };
    const sortWeights = (obj) => Object.entries(obj)
      .map(([name, weight]) => ({ name, weight: Math.round(weight * 10) / 10 }))
      .sort((a, b) => b.weight - a.weight);
    return { ok: true, result: { topics: sortWeights(w.topics), sources: sortWeights(w.sources) } };
  });

  // ─── Parity backlog — Ground News + Apple News surface ──────────────
  // Bias-spectrum comparison, story clustering, audio mode, push alerts,
  // offline sync, source transparency, digest scheduling.

  function getNewsParityState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.newsParity) STATE.newsParity = {};
    const s = STATE.newsParity;
    for (const k of ["alertSubs", "alertFeed", "offline", "digestSchedule"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }

  // Bias lexicon for left/center/right placement based on loaded language.
  const NW_LEFT_WORDS = new Set([
    "progressive", "reform", "equity", "climate", "marginalized", "rights",
    "inclusive", "solidarity", "regulation", "welfare", "diversity",
  ]);
  const NW_RIGHT_WORDS = new Set([
    "patriot", "freedom", "tradition", "liberty", "border", "deregulation",
    "taxpayer", "faith", "sovereignty", "enforcement", "values",
  ]);
  function nwBiasLean(text) {
    const words = String(text || "").toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z]/g, ""));
    let l = 0, rt = 0;
    for (const w of words) { if (NW_LEFT_WORDS.has(w)) l++; if (NW_RIGHT_WORDS.has(w)) rt++; }
    const total = l + rt;
    if (total === 0) return { lean: "center", score: 0, left: l, right: rt };
    const score = (rt - l) / total; // -1 left .. +1 right
    return {
      lean: score < -0.25 ? "left" : score > 0.25 ? "right" : "center",
      score: Math.round(score * 1000) / 1000,
      left: l, right: rt,
    };
  }

  // ── Bias-spectrum comparison ────────────────────────────────────────
  // Place every article on the same story across left/center/right.
  registerLensAction("news", "bias-spectrum", (ctx, _a, params = {}) => {
  try {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = nwaid(ctx);
    const topic = nwclean(params.topic, 60).toLowerCase();
    const q = nwclean(params.query, 80).toLowerCase();
    let arts = [...s.articles.values()];
    if (topic) arts = arts.filter((a) => a.topic === topic);
    if (q) {arts = arts.filter((a) =>
      a.title.toLowerCase().includes(q) || (a.summary || "").toLowerCase().includes(q));}
    if (arts.length === 0) {
      return { ok: true, result: { columns: { left: [], center: [], right: [], count: 0 } } };
    }
    const cols = { left: [], center: [], right: [] };
    for (const a of arts) {
      const b = nwBiasLean(`${a.title} ${a.summary || ""}`);
      cols[b.lean].push({ ...articleView(s, userId, a), biasLean: b.lean, biasScore: b.score });
    }
    for (const k of ["left", "center", "right"]) {
      cols[k].sort((x, y) => String(y.publishedAt).localeCompare(String(x.publishedAt)));
    }
    const total = arts.length;
    return {
      ok: true,
      result: {
        topic: topic || q || "all",
        columns: cols,
        count: total,
        coverage: {
          left: Math.round((cols.left.length / total) * 100),
          center: Math.round((cols.center.length / total) * 100),
          right: Math.round((cols.right.length / total) * 100),
        },
        blindspot:
          cols.left.length === 0 ? "left" :
          cols.right.length === 0 ? "right" :
          cols.center.length === 0 ? "center" : null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Story clustering ────────────────────────────────────────────────
  // Group articles covering the same event into one story by title/summary
  // token overlap (Jaccard >= threshold).
  registerLensAction("news", "story-clusters", (ctx, _a, params = {}) => {
  try {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = nwaid(ctx);
    const threshold = Math.min(0.9, Math.max(0.1, Number(params.threshold) || 0.28));
    const STOP = new Set(["the", "a", "an", "is", "are", "was", "were", "to", "of", "in",
      "for", "on", "with", "at", "by", "from", "as", "and", "but", "or", "this", "that"]);
    const toks = (t) => new Set(String(t || "").toLowerCase().replace(/[^a-z\s]/g, " ")
      .split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)));
    const arts = [...s.articles.values()].map((a) => ({
      art: a, tk: toks(`${a.title} ${a.summary || ""}`),
    }));
    const jac = (x, y) => {
      if (x.size === 0 || y.size === 0) return 0;
      let inter = 0;
      for (const t of x) if (y.has(t)) inter++;
      return inter / (x.size + y.size - inter);
    };
    const used = new Set();
    const clusters = [];
    for (let i = 0; i < arts.length; i++) {
      if (used.has(i)) continue;
      const members = [i]; used.add(i);
      for (let j = i + 1; j < arts.length; j++) {
        if (used.has(j)) continue;
        if (jac(arts[i].tk, arts[j].tk) >= threshold) { members.push(j); used.add(j); }
      }
      const memArts = members.map((m) => arts[m].art);
      memArts.sort((x, y) => String(y.publishedAt).localeCompare(String(x.publishedAt)));
      const sources = [...new Set(memArts.map((m) => m.source))];
      const leans = memArts.map((m) => nwBiasLean(`${m.title} ${m.summary || ""}`).lean);
      clusters.push({
        storyId: `story_${memArts[0].id}`,
        headline: memArts[0].title,
        articleCount: memArts.length,
        sourceCount: sources.length,
        sources,
        latest: memArts[0].publishedAt,
        spread: {
          left: leans.filter((l) => l === "left").length,
          center: leans.filter((l) => l === "center").length,
          right: leans.filter((l) => l === "right").length,
        },
        articles: memArts.map((m) => articleView(s, userId, m)),
      });
    }
    clusters.sort((a, b) => b.articleCount - a.articleCount ||
      String(b.latest).localeCompare(String(a.latest)));
    return {
      ok: true,
      result: {
        clusters,
        storyCount: clusters.length,
        multiSource: clusters.filter((c) => c.sourceCount > 1).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Audio / read-aloud mode ─────────────────────────────────────────
  // Returns a clean, sentence-segmented script + estimated duration so the
  // client can drive the Web Speech API.
  registerLensAction("news", "article-audio", (ctx, _a, params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = s.articles.get(String(params.id));
    if (!art) return { ok: false, error: "article not found" };
    const body = [art.title, art.summary].filter(Boolean).join(". ");
    const segments = body.split(/(?<=[.!?])\s+/).map((t) => t.trim()).filter(Boolean);
    const wordCount = body.split(/\s+/).filter(Boolean).length;
    const estSeconds = Math.max(3, Math.round((wordCount / 165) * 60)); // ~165 wpm
    return {
      ok: true,
      result: {
        articleId: art.id,
        title: art.title,
        source: art.source,
        segments,
        wordCount,
        estimatedSeconds: estSeconds,
      },
    };
  });

  // ── Push notifications — breaking + followed-topic alerts ───────────
  registerLensAction("news", "alert-subscribe", (ctx, _a, params = {}) => {
    const p = getNewsParityState(); if (!p) return { ok: false, error: "STATE unavailable" };
    const userId = nwaid(ctx);
    const kind = ["breaking", "topic", "channel"].includes(String(params.kind))
      ? String(params.kind) : null;
    if (!kind) return { ok: false, error: "kind must be 'breaking', 'topic' or 'channel'" };
    const target = kind === "breaking" ? "*" : nwclean(params.target, 80).toLowerCase();
    if (kind !== "breaking" && !target) return { ok: false, error: "target required" };
    const list = nwlistB(p.alertSubs, userId);
    const existing = list.find((x) => x.kind === kind && x.target === target);
    if (existing) {
      list.splice(list.indexOf(existing), 1);
      saveNewsState();
      return { ok: true, result: { subscribed: false, kind, target } };
    }
    const sub = { id: nwid("alsub"), kind, target, createdAt: nwnow() };
    list.push(sub);
    saveNewsState();
    return { ok: true, result: { subscribed: true, subscription: sub } };
  });

  registerLensAction("news", "alert-list", (ctx, _a, _params = {}) => {
    const p = getNewsParityState(); if (!p) return { ok: false, error: "STATE unavailable" };
    const subs = p.alertSubs.get(nwaid(ctx)) || [];
    return { ok: true, result: { subscriptions: subs, count: subs.length } };
  });

  // Generate alerts by matching newly-added articles against subscriptions.
  registerLensAction("news", "alert-feed", (ctx, _a, params = {}) => {
  try {
    const p = getNewsParityState(); if (!p) return { ok: false, error: "STATE unavailable" };
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = nwaid(ctx);
    const subs = p.alertSubs.get(userId) || [];
    const delivered = nwlistB(p.alertFeed, userId);
    const deliveredIds = new Set(delivered.map((d) => d.articleId + ":" + d.subId));
    if (subs.length > 0) {
      for (const art of s.articles.values()) {
        for (const sub of subs) {
          const match =
            sub.kind === "breaking" ||
            (sub.kind === "topic" && art.topic === sub.target) ||
            (sub.kind === "channel" && art.source.toLowerCase() === sub.target);
          if (!match) continue;
          const key = art.id + ":" + sub.id;
          if (deliveredIds.has(key)) continue;
          deliveredIds.add(key);
          delivered.push({
            id: nwid("alert"), articleId: art.id, subId: sub.id,
            kind: sub.kind, title: art.title, source: art.source,
            topic: art.topic, deliveredAt: nwnow(), read: false,
          });
        }
      }
      saveNewsState();
    }
    if (params.markRead === true) {
      for (const d of delivered) d.read = true;
      saveNewsState();
    }
    const sorted = [...delivered].sort((a, b) => String(b.deliveredAt).localeCompare(String(a.deliveredAt)));
    return {
      ok: true,
      result: { alerts: sorted, count: sorted.length, unread: sorted.filter((a) => !a.read).length },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Offline reading / save-for-later sync ───────────────────────────
  registerLensAction("news", "offline-sync", (ctx, _a, params = {}) => {
    const p = getNewsParityState(); if (!p) return { ok: false, error: "STATE unavailable" };
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const art = s.articles.get(String(params.id));
    if (!art) return { ok: false, error: "article not found" };
    const userId = nwaid(ctx);
    const list = nwlistB(p.offline, userId);
    const existing = list.find((x) => x.articleId === art.id);
    if (existing) {
      list.splice(list.indexOf(existing), 1);
      saveNewsState();
      return { ok: true, result: { synced: false, articleId: art.id } };
    }
    list.push({
      articleId: art.id,
      snapshot: { title: art.title, summary: art.summary, source: art.source,
        topic: art.topic, url: art.url, publishedAt: art.publishedAt },
      syncedAt: nwnow(),
    });
    saveNewsState();
    return { ok: true, result: { synced: true, articleId: art.id } };
  });

  registerLensAction("news", "offline-list", (ctx, _a, _params = {}) => {
    const p = getNewsParityState(); if (!p) return { ok: false, error: "STATE unavailable" };
    const list = (p.offline.get(nwaid(ctx)) || [])
      .slice().sort((a, b) => String(b.syncedAt).localeCompare(String(a.syncedAt)));
    return {
      ok: true,
      result: {
        articles: list.map((x) => ({ articleId: x.articleId, ...x.snapshot, syncedAt: x.syncedAt })),
        count: list.length,
      },
    };
  });

  // ── Source transparency — ownership, factuality, blindspot ──────────
  registerLensAction("news", "source-profile", (ctx, _a, params = {}) => {
  try {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const source = nwclean(params.source, 80);
    if (!source) return { ok: false, error: "source required" };
    const arts = [...s.articles.values()].filter((a) => a.source === source);
    if (arts.length === 0) return { ok: false, error: "no articles from this source" };
    const leans = arts.map((a) => nwBiasLean(`${a.title} ${a.summary || ""}`));
    const avgScore = leans.reduce((acc, l) => acc + l.score, 0) / leans.length;
    // Factuality proxy: hedge-word presence + summary completeness.
    const hedge = /\b(allegedly|reportedly|claimed|unverified|disputed|sources say)\b/i;
    let withSummary = 0, hedged = 0;
    for (const a of arts) {
      if (a.summary && a.summary.length > 40) withSummary++;
      if (hedge.test(`${a.title} ${a.summary || ""}`)) hedged++;
    }
    const summaryRate = withSummary / arts.length;
    const hedgeRate = hedged / arts.length;
    const factuality = Math.round(
      Math.max(0, Math.min(1, 0.5 + summaryRate * 0.4 - hedgeRate * 0.3)) * 100,
    );
    const topics = {};
    for (const a of arts) topics[a.topic] = (topics[a.topic] || 0) + 1;
    return {
      ok: true,
      result: {
        source,
        articleCount: arts.length,
        contributors: [...new Set(arts.map((a) => a.addedBy))].length,
        biasLean: avgScore < -0.25 ? "left" : avgScore > 0.25 ? "right" : "center",
        biasScore: Math.round(avgScore * 1000) / 1000,
        factualityRating: factuality,
        factualityLabel: factuality >= 75 ? "high" : factuality >= 50 ? "mixed" : "low",
        transparency: {
          summaryRate: Math.round(summaryRate * 100),
          hedgeRate: Math.round(hedgeRate * 100),
        },
        topicSpread: Object.entries(topics)
          .map(([topic, count]) => ({ topic, count }))
          .sort((a, b) => b.count - a.count),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Personalized digest scheduling ──────────────────────────────────
  registerLensAction("news", "digest-schedule-set", (ctx, _a, params = {}) => {
    const p = getNewsParityState(); if (!p) return { ok: false, error: "STATE unavailable" };
    const userId = nwaid(ctx);
    const cadence = ["daily", "weekdays", "weekly", "off"].includes(String(params.cadence))
      ? String(params.cadence) : null;
    if (!cadence) return { ok: false, error: "cadence must be daily, weekdays, weekly or off" };
    const hour = Math.max(0, Math.min(23, Math.round(Number(params.hour))));
    if (!Number.isFinite(hour)) return { ok: false, error: "hour must be 0-23" };
    const schedule = {
      cadence, hour,
      topicsOnly: params.topicsOnly === true,
      updatedAt: nwnow(),
    };
    p.digestSchedule.set(userId, schedule);
    saveNewsState();
    return { ok: true, result: { schedule } };
  });

  registerLensAction("news", "digest-schedule-get", (ctx, _a, _params = {}) => {
    const p = getNewsParityState(); if (!p) return { ok: false, error: "STATE unavailable" };
    const schedule = p.digestSchedule.get(nwaid(ctx)) || null;
    let nextDelivery = null;
    if (schedule && schedule.cadence !== "off") {
      const now = new Date();
      const next = new Date(now);
      next.setHours(schedule.hour, 0, 0, 0);
      if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
      if (schedule.cadence === "weekdays") {
        while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
      } else if (schedule.cadence === "weekly") {
        while (next.getDay() !== 1) next.setDate(next.getDate() + 1); // Monday
      }
      nextDelivery = next.toISOString();
    }
    return { ok: true, result: { schedule, nextDelivery } };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("news", "news-dashboard", (ctx, _a, _params = {}) => {
    const s = getNewsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = nwaid(ctx);
    const channels = s.followedChannels.get(userId) || [];
    const topics = s.followedTopics.get(userId) || [];
    const reads = s.readState.get(userId) || [];
    const readIds = new Set(reads.map((r) => r.articleId));
    let feedUnread = 0;
    const hasFollows = channels.length || topics.length;
    for (const a of s.articles.values()) {
      if ((!hasFollows || channels.includes(a.source) || topics.includes(a.topic)) && !readIds.has(a.id)) feedUnread++;
    }
    return {
      ok: true,
      result: {
        articles: s.articles.size,
        followedChannels: channels.length,
        followedTopics: topics.length,
        feedUnread,
        saved: (s.saved.get(userId) || []).length,
        read: reads.length,
      },
    };
  });
}

