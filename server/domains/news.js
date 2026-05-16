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
  });

  /**
   * eventExtraction
   * Extract structured events from news text — identify who/what/when/where/why,
   * temporal ordering, and event clustering.
   * artifact.data.articles = [{ title, body, date?, source? }]
   */
  registerLensAction("news", "eventExtraction", (ctx, artifact, params) => {
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
  });

  /**
   * narrativeTracking
   * Track narrative evolution across articles — compute narrative similarity
   * over time, identify shifts in framing.
   * artifact.data.articles = [{ title, body, date, source? }]
   * params.windowSize — number of articles per window (default 3)
   */
  registerLensAction("news", "narrativeTracking", (ctx, artifact, params) => {
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
}

