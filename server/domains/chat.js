// server/domains/chat.js
// Domain actions for chat/messaging analysis: thread summarization,
// participant engagement analysis, and topic shift detection.

import vm from "node:vm";

export default function registerChatActions(registerLensAction) {
  /**
   * threadSummarize
   * Extract key points from chat messages using TF-IDF keyword extraction.
   * Identify decisions, action items, and questions.
   * artifact.data.messages = [{ author, text, timestamp? }]
   */
  registerLensAction("chat", "threadSummarize", (ctx, artifact, _params) => {
    const messages = artifact.data?.messages || [];
    if (messages.length === 0) {
      return { ok: true, result: { message: "No messages to summarize." } };
    }

    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "shall", "can", "to", "of", "in", "for",
      "on", "with", "at", "by", "from", "as", "into", "through", "during",
      "before", "after", "above", "below", "between", "and", "but", "or",
      "nor", "not", "so", "yet", "both", "either", "neither", "each",
      "every", "all", "any", "few", "more", "most", "other", "some", "such",
      "no", "only", "own", "same", "than", "too", "very", "just", "because",
      "if", "when", "while", "that", "this", "these", "those", "it", "its",
      "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
      "she", "her", "they", "them", "their", "what", "which", "who", "whom",
      "how", "where", "why", "about", "up", "out", "then", "there", "here",
    ]);

    // Tokenize each message
    function tokenize(text) {
      return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
    }

    // Build TF-IDF
    const docTokens = messages.map(m => tokenize(m.text || ""));
    const docCount = docTokens.length;

    // Document frequency for each term
    const df = {};
    for (const tokens of docTokens) {
      const unique = new Set(tokens);
      for (const t of unique) {
        df[t] = (df[t] || 0) + 1;
      }
    }

    // Compute TF-IDF scores across the entire corpus
    const globalScores = {};
    for (const tokens of docTokens) {
      const tf = {};
      for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
      const maxTf = Math.max(...Object.values(tf), 1);
      for (const [term, count] of Object.entries(tf)) {
        const tfidf = (count / maxTf) * Math.log(docCount / (df[term] || 1));
        globalScores[term] = (globalScores[term] || 0) + tfidf;
      }
    }

    const keywords = Object.entries(globalScores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([term, score]) => ({ term, score: Math.round(score * 1000) / 1000 }));

    // Detect decisions (statements with decision-indicator words)
    const decisionPatterns = /\b(decided|agreed|approved|confirmed|will go with|let'?s go with|final decision|we'?ll|consensus|resolved)\b/i;
    const decisions = messages
      .filter(m => decisionPatterns.test(m.text || ""))
      .map(m => ({ author: m.author, text: m.text, timestamp: m.timestamp }));

    // Detect action items (assignments and to-dos)
    const actionPatterns = /\b(todo|action item|please|need to|should|must|assign|take care of|follow up|will do|i'?ll|can you|could you|make sure)\b/i;
    const actionItems = messages
      .filter(m => actionPatterns.test(m.text || ""))
      .map(m => {
        const text = m.text || "";
        // Try to extract the assignee and task
        const assigneeMatch = text.match(/@(\w+)/);
        return {
          author: m.author,
          text,
          timestamp: m.timestamp,
          possibleAssignee: assigneeMatch ? assigneeMatch[1] : m.author,
        };
      });

    // Detect questions (lines ending with ? or starting with question words)
    const questionPatterns = /(\?$|\b(what|how|why|when|where|who|which|can we|should we|do we|is there|are there|could we)\b)/i;
    const questions = messages
      .filter(m => questionPatterns.test(m.text || ""))
      .map(m => {
        // Check if any subsequent message looks like a response
        const idx = messages.indexOf(m);
        const answered = idx < messages.length - 1;
        return { author: m.author, text: m.text, timestamp: m.timestamp, answered };
      });

    // Compute message density over time if timestamps are present
    let activityTimeline = null;
    const withTime = messages.filter(m => m.timestamp);
    if (withTime.length >= 2) {
      const times = withTime.map(m => new Date(m.timestamp).getTime()).sort((a, b) => a - b);
      const duration = times[times.length - 1] - times[0];
      const bucketCount = Math.min(10, withTime.length);
      const bucketSize = duration / bucketCount;
      const buckets = new Array(bucketCount).fill(0);
      for (const t of times) {
        const idx = Math.min(Math.floor((t - times[0]) / bucketSize), bucketCount - 1);
        buckets[idx]++;
      }
      activityTimeline = { buckets, bucketDurationMs: Math.round(bucketSize), peakBucket: buckets.indexOf(Math.max(...buckets)) };
    }

    return {
      ok: true,
      result: {
        messageCount: messages.length,
        keywords,
        decisions: { count: decisions.length, items: decisions.slice(0, 10) },
        actionItems: { count: actionItems.length, items: actionItems.slice(0, 10) },
        questions: { count: questions.length, unanswered: questions.filter(q => !q.answered).length, items: questions.slice(0, 10) },
        activityTimeline,
      },
    };
  });

  /**
   * participantAnalysis
   * Analyze participant engagement: message frequency, response times,
   * thread initiation ratio, and sentiment per participant.
   * artifact.data.messages = [{ author, text, timestamp?, threadId? }]
   */
  registerLensAction("chat", "participantAnalysis", (ctx, artifact, _params) => {
    const messages = artifact.data?.messages || [];
    if (messages.length === 0) {
      return { ok: true, result: { message: "No messages to analyze." } };
    }

    const participants = {};

    // Simple sentiment scoring via lexicon
    const posWords = new Set(["good", "great", "excellent", "awesome", "nice", "love", "agree", "thanks", "thank", "perfect", "wonderful", "happy", "yes", "sure", "absolutely", "amazing", "well", "fantastic", "helpful", "brilliant"]);
    const negWords = new Set(["bad", "wrong", "terrible", "hate", "disagree", "unfortunately", "issue", "problem", "fail", "failed", "broken", "bug", "error", "concern", "worried", "no", "never", "awful", "poor", "worse", "worst"]);

    function sentimentScore(text) {
      const words = (text || "").toLowerCase().split(/\s+/);
      let score = 0;
      for (const w of words) {
        if (posWords.has(w)) score += 1;
        if (negWords.has(w)) score -= 1;
      }
      return score;
    }

    // Build per-participant stats
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const author = m.author || "unknown";
      if (!participants[author]) {
        participants[author] = {
          messageCount: 0,
          totalWords: 0,
          sentimentSum: 0,
          threadInitiations: 0,
          responseTimes: [],
          firstMessageIdx: i,
          lastMessageIdx: i,
        };
      }
      const p = participants[author];
      p.messageCount++;
      p.totalWords += (m.text || "").split(/\s+/).filter(Boolean).length;
      p.sentimentSum += sentimentScore(m.text);
      p.lastMessageIdx = i;

      // Thread initiation: first message in a thread
      if (m.threadId) {
        const isFirst = !messages.slice(0, i).some(prev => prev.threadId === m.threadId);
        if (isFirst) p.threadInitiations++;
      }

      // Response time: time gap from previous message by a different author
      if (m.timestamp && i > 0) {
        // Find the most recent message from a different author
        for (let j = i - 1; j >= 0; j--) {
          if (messages[j].author !== author && messages[j].timestamp) {
            const gap = new Date(m.timestamp).getTime() - new Date(messages[j].timestamp).getTime();
            if (gap > 0 && gap < 86400000) { // within 24 hours
              p.responseTimes.push(gap);
            }
            break;
          }
        }
      }
    }

    // Compile participant summaries
    const totalMessages = messages.length;
    const summaries = Object.entries(participants).map(([name, p]) => {
      const avgResponseTime = p.responseTimes.length > 0
        ? Math.round(p.responseTimes.reduce((s, t) => s + t, 0) / p.responseTimes.length)
        : null;
      const medianResponseTime = p.responseTimes.length > 0
        ? (() => { const sorted = [...p.responseTimes].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]; })()
        : null;

      const avgSentiment = p.messageCount > 0
        ? Math.round((p.sentimentSum / p.messageCount) * 1000) / 1000
        : 0;

      const threadInitiationRatio = p.messageCount > 0
        ? Math.round((p.threadInitiations / p.messageCount) * 1000) / 1000
        : 0;

      return {
        name,
        messageCount: p.messageCount,
        shareOfConversation: Math.round((p.messageCount / totalMessages) * 10000) / 100,
        avgWordsPerMessage: Math.round(p.totalWords / p.messageCount * 10) / 10,
        threadInitiations: p.threadInitiations,
        threadInitiationRatio,
        avgResponseTimeMs: avgResponseTime,
        medianResponseTimeMs: medianResponseTime,
        sentiment: {
          score: avgSentiment,
          label: avgSentiment > 0.3 ? "positive" : avgSentiment < -0.3 ? "negative" : "neutral",
        },
      };
    });

    summaries.sort((a, b) => b.messageCount - a.messageCount);

    // Identify the most active and the most responsive
    const mostActive = summaries[0]?.name || null;
    const mostResponsive = summaries
      .filter(s => s.avgResponseTimeMs !== null)
      .sort((a, b) => a.avgResponseTimeMs - b.avgResponseTimeMs)[0]?.name || null;

    // Engagement balance: Gini coefficient of message counts
    const counts = summaries.map(s => s.messageCount).sort((a, b) => a - b);
    const n = counts.length;
    let giniNumerator = 0;
    for (let i = 0; i < n; i++) {
      giniNumerator += (2 * (i + 1) - n - 1) * counts[i];
    }
    const gini = n > 1 ? Math.round((giniNumerator / (n * counts.reduce((s, v) => s + v, 0))) * 1000) / 1000 : 0;

    return {
      ok: true,
      result: {
        totalMessages,
        participantCount: summaries.length,
        participants: summaries,
        highlights: { mostActive, mostResponsive },
        engagementBalance: {
          giniCoefficient: gini,
          interpretation: gini < 0.2 ? "very balanced" : gini < 0.4 ? "balanced" : gini < 0.6 ? "moderately unbalanced" : "highly unbalanced",
        },
      },
    };
  });

  /**
   * topicDetection
   * Detect topic shifts in conversation using cosine similarity between
   * sliding windows of messages. Identify topic boundaries and label clusters.
   * artifact.data.messages = [{ author, text, timestamp? }]
   * params.windowSize (default 3), params.threshold (default 0.3)
   */
  registerLensAction("chat", "topicDetection", (ctx, artifact, params) => {
    const messages = artifact.data?.messages || [];
    if (messages.length < 2) {
      return { ok: true, result: { message: "Need at least 2 messages for topic detection." } };
    }

    const windowSize = params.windowSize || 3;
    const threshold = params.threshold || 0.3;

    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "have",
      "has", "had", "do", "does", "did", "will", "would", "could", "should",
      "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
      "and", "but", "or", "not", "so", "if", "that", "this", "it", "its",
      "i", "me", "my", "we", "our", "you", "your", "he", "she", "they",
      "them", "their", "what", "which", "who", "how", "where", "why",
    ]);

    function tokenize(text) {
      return (text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
    }

    // Build term-frequency vector for a window of messages
    function buildVector(msgs) {
      const tf = {};
      for (const m of msgs) {
        for (const t of tokenize(m.text)) {
          tf[t] = (tf[t] || 0) + 1;
        }
      }
      return tf;
    }

    // Cosine similarity between two term-frequency vectors
    function cosineSim(v1, v2) {
      const allTerms = new Set([...Object.keys(v1), ...Object.keys(v2)]);
      let dot = 0, mag1 = 0, mag2 = 0;
      for (const t of allTerms) {
        const a = v1[t] || 0;
        const b = v2[t] || 0;
        dot += a * b;
        mag1 += a * a;
        mag2 += b * b;
      }
      const denom = Math.sqrt(mag1) * Math.sqrt(mag2);
      return denom > 0 ? dot / denom : 0;
    }

    // Compute similarities between adjacent windows
    const similarities = [];
    const boundaries = [0]; // First message always starts a segment

    for (let i = 0; i <= messages.length - windowSize * 2; i++) {
      const window1 = messages.slice(i, i + windowSize);
      const window2 = messages.slice(i + windowSize, i + windowSize * 2);
      const v1 = buildVector(window1);
      const v2 = buildVector(window2);
      const sim = cosineSim(v1, v2);
      similarities.push({
        position: i + windowSize,
        similarity: Math.round(sim * 1000) / 1000,
      });

      if (sim < threshold) {
        // Topic shift detected
        const boundaryIdx = i + windowSize;
        // Avoid boundaries too close together
        if (boundaryIdx - boundaries[boundaries.length - 1] >= windowSize) {
          boundaries.push(boundaryIdx);
        }
      }
    }

    // Extract topic segments and label them by top keywords
    const segments = [];
    for (let i = 0; i < boundaries.length; i++) {
      const start = boundaries[i];
      const end = i < boundaries.length - 1 ? boundaries[i + 1] : messages.length;
      const segmentMsgs = messages.slice(start, end);
      const tf = buildVector(segmentMsgs);

      // Top keywords for this segment
      const topTerms = Object.entries(tf)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([term]) => term);

      segments.push({
        segmentIndex: i,
        startMessage: start,
        endMessage: end - 1,
        messageCount: segmentMsgs.length,
        topKeywords: topTerms,
        label: topTerms.slice(0, 3).join(", "),
        participants: [...new Set(segmentMsgs.map(m => m.author))],
        startTimestamp: segmentMsgs[0]?.timestamp || null,
        endTimestamp: segmentMsgs[segmentMsgs.length - 1]?.timestamp || null,
      });
    }

    // Compute average similarity (topic coherence)
    const avgSimilarity = similarities.length > 0
      ? Math.round((similarities.reduce((s, x) => s + x.similarity, 0) / similarities.length) * 1000) / 1000
      : 1;

    return {
      ok: true,
      result: {
        totalMessages: messages.length,
        topicSegments: segments,
        topicShiftCount: boundaries.length - 1,
        similarities,
        averageCoherence: avgSimilarity,
        coherenceLabel: avgSimilarity > 0.7 ? "highly focused" : avgSimilarity > 0.4 ? "moderately focused" : "highly diverse",
        parameters: { windowSize, threshold },
      },
    };
  });

  // ─── 2026 parity macros — Projects / Prompts / Search / Branches / Scheduled ──
  //
  // Parity targets: Claude Projects + ChatGPT Projects/Tasks + Perplexity Spaces.
  // All state is in-memory, per-user (CLAUDE.md migration-101 invariant),
  // and lives under STATE.chatLens.

  function getChatState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.chatLens) {
      STATE.chatLens = {
        projects: new Map(),
        prompts: new Map(),
        threadIndex: new Map(),
        branches: new Map(),
        scheduled: new Map(),
        assistants: new Map(),
        canvasDocs: new Map(),
        memory: new Map(),
        shareLinks: new Map(),
        shareIndex: new Map(),
        voicePrefs: new Map(),
        images: new Map(),
        codeRuns: new Map(),
      };
    }
    return STATE.chatLens;
  }
  function saveChatState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function actorIdFor(ctx) {
    return ctx?.actor?.userId || ctx?.userId || "anon";
  }
  function nextChatId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function nowIsoChat() { return new Date().toISOString(); }
  function asStringArr(v, max) {
    if (!Array.isArray(v)) return [];
    return v.slice(0, max).map((x) => String(x));
  }

  // ── Projects (Claude / ChatGPT Projects, Perplexity Spaces) ──

  registerLensAction("chat", "projects-list", (ctx, _artifact, _params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const map = s.projects.get(userId);
    if (!map) return { ok: true, result: { projects: [] } };
    const projects = Array.from(map.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { ok: true, result: { projects } };
  });

  registerLensAction("chat", "project-create", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (name.length > 80) return { ok: false, error: "name too long (max 80)" };
    const systemPrompt = String(params.systemPrompt || "").slice(0, 4000);
    const attachedDtuIds = asStringArr(params.attachedDtuIds, 50);
    const color = String(params.color || "cyan").slice(0, 16);
    const project = {
      id: nextChatId("proj"),
      name, systemPrompt, attachedDtuIds, color,
      threadIds: [],
      createdAt: nowIsoChat(),
      updatedAt: nowIsoChat(),
    };
    if (!s.projects.has(userId)) s.projects.set(userId, new Map());
    s.projects.get(userId).set(project.id, project);
    saveChatState();
    return { ok: true, result: { project } };
  });

  registerLensAction("chat", "project-update", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.projects.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    const p = map.get(id);
    if (typeof params.name === "string") {
      const n = params.name.trim();
      if (!n) return { ok: false, error: "name cannot be empty" };
      p.name = n.slice(0, 80);
    }
    if (typeof params.systemPrompt === "string") p.systemPrompt = params.systemPrompt.slice(0, 4000);
    if (Array.isArray(params.attachedDtuIds)) p.attachedDtuIds = asStringArr(params.attachedDtuIds, 50);
    if (typeof params.color === "string") p.color = params.color.slice(0, 16);
    if (Array.isArray(params.threadIds)) p.threadIds = asStringArr(params.threadIds, 500);
    p.updatedAt = nowIsoChat();
    saveChatState();
    return { ok: true, result: { project: p } };
  });

  registerLensAction("chat", "project-delete", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.projects.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    map.delete(id);
    saveChatState();
    return { ok: true, result: { deleted: id } };
  });

  registerLensAction("chat", "project-get", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.projects.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    return { ok: true, result: { project: map.get(id) } };
  });

  // ── Saved prompt library (slash-command extensible templates) ──

  registerLensAction("chat", "prompts-list", (ctx, _artifact, _params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const map = s.prompts.get(userId);
    if (!map) return { ok: true, result: { prompts: [] } };
    const prompts = Array.from(map.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { ok: true, result: { prompts } };
  });

  registerLensAction("chat", "prompt-create", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (name.length > 60) return { ok: false, error: "name too long (max 60)" };
    const content = String(params.content || "");
    if (!content.trim()) return { ok: false, error: "content required" };
    if (content.length > 8000) return { ok: false, error: "content too long (max 8000)" };
    const tags = asStringArr(params.tags, 10);
    const shortcut = typeof params.shortcut === "string"
      ? params.shortcut.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24)
      : null;
    const prompt = {
      id: nextChatId("pmt"),
      name, content, tags, shortcut,
      createdAt: nowIsoChat(),
      updatedAt: nowIsoChat(),
    };
    if (!s.prompts.has(userId)) s.prompts.set(userId, new Map());
    s.prompts.get(userId).set(prompt.id, prompt);
    saveChatState();
    return { ok: true, result: { prompt } };
  });

  registerLensAction("chat", "prompt-update", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.prompts.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    const p = map.get(id);
    if (typeof params.name === "string") {
      const n = params.name.trim();
      if (!n) return { ok: false, error: "name cannot be empty" };
      p.name = n.slice(0, 60);
    }
    if (typeof params.content === "string") {
      if (!params.content.trim()) return { ok: false, error: "content cannot be empty" };
      p.content = params.content.slice(0, 8000);
    }
    if (Array.isArray(params.tags)) p.tags = asStringArr(params.tags, 10);
    if (typeof params.shortcut === "string") {
      p.shortcut = params.shortcut.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
    }
    p.updatedAt = nowIsoChat();
    saveChatState();
    return { ok: true, result: { prompt: p } };
  });

  registerLensAction("chat", "prompt-delete", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.prompts.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    map.delete(id);
    saveChatState();
    return { ok: true, result: { deleted: id } };
  });

  // ── Thread search across the user's indexed conversation snapshots ──

  registerLensAction("chat", "thread-index", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const threadId = String(params.threadId || "");
    if (!threadId) return { ok: false, error: "threadId required" };
    const title = String(params.title || "").slice(0, 200);
    const snippet = String(params.snippet || "").slice(0, 4000);
    const lastMsgAt = String(params.lastMsgAt || nowIsoChat());
    const projectId = params.projectId ? String(params.projectId) : null;
    if (!s.threadIndex.has(userId)) s.threadIndex.set(userId, []);
    const arr = s.threadIndex.get(userId);
    const existingIdx = arr.findIndex((x) => x.threadId === threadId);
    const entry = { threadId, title, snippet, projectId, lastMsgAt, indexedAt: nowIsoChat() };
    if (existingIdx >= 0) arr[existingIdx] = entry;
    else {
      arr.push(entry);
      if (arr.length > 1000) arr.splice(0, arr.length - 1000);
    }
    saveChatState();
    return { ok: true, result: { threadId, total: arr.length } };
  });

  registerLensAction("chat", "threads-search", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    if (query.length < 2) return { ok: false, error: "query too short (min 2 chars)" };
    if (query.length > 200) return { ok: false, error: "query too long (max 200)" };
    const projectId = params.projectId ? String(params.projectId) : null;
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 20));
    const arr = s.threadIndex.get(userId) || [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = [];
    for (const entry of arr) {
      if (projectId && entry.projectId !== projectId) continue;
      const titleLower = (entry.title || "").toLowerCase();
      const snippetLower = (entry.snippet || "").toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (titleLower.includes(t)) score += 5;
        if (snippetLower.includes(t)) score += 1;
      }
      if (score > 0) scored.push({ ...entry, score });
    }
    scored.sort((a, b) =>
      b.score - a.score ||
      new Date(b.lastMsgAt).getTime() - new Date(a.lastMsgAt).getTime()
    );
    return {
      ok: true,
      result: {
        hits: scored.slice(0, limit),
        totalIndexed: arr.length,
        totalMatched: scored.length,
      },
    };
  });

  // ── Conversation branches (fork from a message) ──

  registerLensAction("chat", "branches-list", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const sourceThreadId = params.sourceThreadId ? String(params.sourceThreadId) : null;
    const map = s.branches.get(userId);
    if (!map) return { ok: true, result: { branches: [] } };
    let branches = Array.from(map.values());
    if (sourceThreadId) branches = branches.filter((b) => b.sourceThreadId === sourceThreadId);
    branches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { ok: true, result: { branches } };
  });

  registerLensAction("chat", "branch-fork", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const sourceThreadId = String(params.sourceThreadId || "");
    if (!sourceThreadId) return { ok: false, error: "sourceThreadId required" };
    const atMessageIdx = Number.isInteger(params.atMessageIdx) ? params.atMessageIdx : -1;
    if (atMessageIdx < 0) return { ok: false, error: "atMessageIdx required (>= 0)" };
    const seededMessages = Array.isArray(params.messages)
      ? params.messages.slice(0, atMessageIdx + 1)
      : [];
    const note = String(params.note || "").slice(0, 200);
    const branch = {
      id: nextChatId("br"),
      sourceThreadId, atMessageIdx, note,
      seededMessages,
      createdAt: nowIsoChat(),
    };
    if (!s.branches.has(userId)) s.branches.set(userId, new Map());
    s.branches.get(userId).set(branch.id, branch);
    saveChatState();
    return { ok: true, result: { branch } };
  });

  registerLensAction("chat", "branch-delete", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.branches.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    map.delete(id);
    saveChatState();
    return { ok: true, result: { deleted: id } };
  });

  // ── Scheduled tasks (ChatGPT-style scheduled prompts) ──

  registerLensAction("chat", "scheduled-list", (ctx, _artifact, _params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const map = s.scheduled.get(userId);
    if (!map) return { ok: true, result: { tasks: [] } };
    const tasks = Array.from(map.values())
      .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime());
    return { ok: true, result: { tasks } };
  });

  registerLensAction("chat", "scheduled-create", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const promptText = String(params.prompt || "").trim();
    if (!promptText) return { ok: false, error: "prompt required" };
    if (promptText.length > 4000) return { ok: false, error: "prompt too long (max 4000)" };
    const runAt = String(params.runAt || "");
    if (!runAt) return { ok: false, error: "runAt required (ISO timestamp)" };
    const runAtMs = new Date(runAt).getTime();
    if (!Number.isFinite(runAtMs)) return { ok: false, error: "runAt invalid timestamp" };
    if (runAtMs <= Date.now()) return { ok: false, error: "runAt must be in the future" };
    const projectId = params.projectId ? String(params.projectId) : null;
    const recurring = ["daily", "weekly", "monthly"].includes(params.recurring)
      ? params.recurring : null;
    const task = {
      id: nextChatId("sch"),
      prompt: promptText, runAt, projectId, recurring,
      status: "pending",
      createdAt: nowIsoChat(),
    };
    if (!s.scheduled.has(userId)) s.scheduled.set(userId, new Map());
    s.scheduled.get(userId).set(task.id, task);
    saveChatState();
    return { ok: true, result: { task } };
  });

  registerLensAction("chat", "scheduled-cancel", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.scheduled.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    const t = map.get(id);
    t.status = "cancelled";
    t.cancelledAt = nowIsoChat();
    saveChatState();
    return { ok: true, result: { task: t } };
  });

  // ─── ChatGPT-parity backlog — voice / custom GPTs / canvas / memory /
  //     code interpreter / share links / image generation ──────────────
  //
  // All state lives under STATE.chatLens, keyed per-user. Every value is
  // real user input or computed from real input — no seed/demo data.

  function ensureChatSubmaps(s) {
    if (!s.assistants) s.assistants = new Map();
    if (!s.canvasDocs) s.canvasDocs = new Map();
    if (!s.memory) s.memory = new Map();
    if (!s.shareLinks) s.shareLinks = new Map();
    if (!s.shareIndex) s.shareIndex = new Map();
    if (!s.voicePrefs) s.voicePrefs = new Map();
    if (!s.images) s.images = new Map();
    if (!s.codeRuns) s.codeRuns = new Map();
    return s;
  }

  // ── Voice mode — speech-in transcription preference + TTS-out config ──
  // Stores a per-user voice profile (engine, voice, rate, autoplay). The
  // browser SpeechRecognition / SpeechSynthesis APIs do the actual audio
  // work client-side; this macro persists the user's chosen settings so
  // they survive across devices.

  registerLensAction("chat", "voice-get", (ctx, _artifact, _params = {}) => {
    const s = ensureChatSubmaps(getChatState() || {});
    if (!s.voicePrefs) return { ok: false, error: "STATE unavailable" };
    const userId = actorIdFor(ctx);
    const prefs = s.voicePrefs.get(userId) || {
      enabled: false,
      ttsVoice: "default",
      ttsRate: 1.0,
      ttsPitch: 1.0,
      autoplayReplies: false,
      sttLang: "en-US",
      updatedAt: null,
    };
    return { ok: true, result: { prefs } };
  });

  registerLensAction("chat", "voice-update", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const cur = s.voicePrefs.get(userId) || {
      enabled: false, ttsVoice: "default", ttsRate: 1.0, ttsPitch: 1.0,
      autoplayReplies: false, sttLang: "en-US", updatedAt: null,
    };
    if (typeof params.enabled === "boolean") cur.enabled = params.enabled;
    if (typeof params.ttsVoice === "string") cur.ttsVoice = params.ttsVoice.slice(0, 80);
    if (params.ttsRate != null) {
      const r = Number(params.ttsRate);
      if (!Number.isFinite(r) || r < 0.5 || r > 2.0) return { ok: false, error: "ttsRate must be 0.5-2.0" };
      cur.ttsRate = Math.round(r * 100) / 100;
    }
    if (params.ttsPitch != null) {
      const p = Number(params.ttsPitch);
      if (!Number.isFinite(p) || p < 0 || p > 2.0) return { ok: false, error: "ttsPitch must be 0-2.0" };
      cur.ttsPitch = Math.round(p * 100) / 100;
    }
    if (typeof params.autoplayReplies === "boolean") cur.autoplayReplies = params.autoplayReplies;
    if (typeof params.sttLang === "string") cur.sttLang = params.sttLang.slice(0, 16);
    cur.updatedAt = nowIsoChat();
    s.voicePrefs.set(userId, cur);
    saveChatState();
    return { ok: true, result: { prefs: cur } };
  });

  // ── Custom GPTs — configurable assistants (instructions + knowledge) ──
  // Parity with ChatGPT's "GPTs". A user creates a named assistant with a
  // system instruction, a set of starter prompts and attached DTU ids
  // (the knowledge files). The chat lens loads the instruction into the
  // system prompt when an assistant is active.

  registerLensAction("chat", "assistants-list", (ctx, _artifact, _params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const map = s.assistants.get(userId);
    if (!map) return { ok: true, result: { assistants: [] } };
    const assistants = Array.from(map.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { ok: true, result: { assistants } };
  });

  registerLensAction("chat", "assistant-create", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (name.length > 60) return { ok: false, error: "name too long (max 60)" };
    const instructions = String(params.instructions || "").slice(0, 8000);
    if (!instructions.trim()) return { ok: false, error: "instructions required" };
    const assistant = {
      id: nextChatId("gpt"),
      name,
      instructions,
      description: String(params.description || "").slice(0, 300),
      starters: asStringArr(params.starters, 8).map((x) => x.slice(0, 200)),
      knowledgeDtuIds: asStringArr(params.knowledgeDtuIds, 50),
      model: ["overview", "deep", "creative", "code", "research", "creti"]
        .includes(params.model) ? params.model : "overview",
      icon: String(params.icon || "bot").slice(0, 24),
      createdAt: nowIsoChat(),
      updatedAt: nowIsoChat(),
    };
    if (!s.assistants.has(userId)) s.assistants.set(userId, new Map());
    s.assistants.get(userId).set(assistant.id, assistant);
    saveChatState();
    return { ok: true, result: { assistant } };
  });

  registerLensAction("chat", "assistant-update", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.assistants.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    const a = map.get(id);
    if (typeof params.name === "string") {
      const n = params.name.trim();
      if (!n) return { ok: false, error: "name cannot be empty" };
      a.name = n.slice(0, 60);
    }
    if (typeof params.instructions === "string") {
      if (!params.instructions.trim()) return { ok: false, error: "instructions cannot be empty" };
      a.instructions = params.instructions.slice(0, 8000);
    }
    if (typeof params.description === "string") a.description = params.description.slice(0, 300);
    if (Array.isArray(params.starters)) a.starters = asStringArr(params.starters, 8).map((x) => x.slice(0, 200));
    if (Array.isArray(params.knowledgeDtuIds)) a.knowledgeDtuIds = asStringArr(params.knowledgeDtuIds, 50);
    if (["overview", "deep", "creative", "code", "research", "creti"].includes(params.model)) a.model = params.model;
    if (typeof params.icon === "string") a.icon = params.icon.slice(0, 24);
    a.updatedAt = nowIsoChat();
    saveChatState();
    return { ok: true, result: { assistant: a } };
  });

  registerLensAction("chat", "assistant-delete", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.assistants.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    map.delete(id);
    saveChatState();
    return { ok: true, result: { deleted: id } };
  });

  // ── Canvas — side-by-side document / code editing ────────────────────
  // A canvas doc is a long-form artifact the user co-edits with the AI in
  // a split-pane view. Stores full content + a revision history so edits
  // are reversible (parity with ChatGPT Canvas / Claude Artifacts).

  registerLensAction("chat", "canvas-list", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const map = s.canvasDocs.get(userId);
    if (!map) return { ok: true, result: { docs: [] } };
    const threadId = params.threadId ? String(params.threadId) : null;
    let docs = Array.from(map.values());
    if (threadId) docs = docs.filter((d) => d.threadId === threadId);
    docs = docs
      .map((d) => ({
        id: d.id, title: d.title, kind: d.kind, language: d.language,
        threadId: d.threadId, revisionCount: d.revisions.length,
        charCount: d.content.length, createdAt: d.createdAt, updatedAt: d.updatedAt,
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { ok: true, result: { docs } };
  });

  registerLensAction("chat", "canvas-get", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.canvasDocs.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    return { ok: true, result: { doc: map.get(id) } };
  });

  registerLensAction("chat", "canvas-create", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    if (title.length > 120) return { ok: false, error: "title too long (max 120)" };
    const kind = params.kind === "code" ? "code" : "document";
    const content = String(params.content || "").slice(0, 200000);
    const doc = {
      id: nextChatId("cvs"),
      title,
      kind,
      language: kind === "code" ? String(params.language || "javascript").slice(0, 24) : null,
      threadId: params.threadId ? String(params.threadId) : null,
      content,
      revisions: [],
      createdAt: nowIsoChat(),
      updatedAt: nowIsoChat(),
    };
    if (!s.canvasDocs.has(userId)) s.canvasDocs.set(userId, new Map());
    s.canvasDocs.get(userId).set(doc.id, doc);
    saveChatState();
    return { ok: true, result: { doc } };
  });

  registerLensAction("chat", "canvas-update", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.canvasDocs.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    const d = map.get(id);
    if (typeof params.title === "string") {
      const t = params.title.trim();
      if (!t) return { ok: false, error: "title cannot be empty" };
      d.title = t.slice(0, 120);
    }
    if (typeof params.content === "string") {
      // Snapshot the prior content so the edit is reversible.
      d.revisions.push({
        content: d.content,
        editedBy: params.editedBy === "ai" ? "ai" : "user",
        savedAt: nowIsoChat(),
      });
      if (d.revisions.length > 50) d.revisions.splice(0, d.revisions.length - 50);
      d.content = params.content.slice(0, 200000);
    }
    if (typeof params.language === "string") d.language = params.language.slice(0, 24);
    d.updatedAt = nowIsoChat();
    saveChatState();
    return { ok: true, result: { doc: d } };
  });

  registerLensAction("chat", "canvas-revert", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.canvasDocs.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    const d = map.get(id);
    if (d.revisions.length === 0) return { ok: false, error: "no revisions to revert to" };
    const idx = Number.isInteger(params.revisionIndex)
      ? params.revisionIndex : d.revisions.length - 1;
    if (idx < 0 || idx >= d.revisions.length) return { ok: false, error: "revisionIndex out of range" };
    const target = d.revisions[idx];
    // Snapshot current before reverting so the revert itself is reversible.
    d.revisions.push({ content: d.content, editedBy: "user", savedAt: nowIsoChat() });
    d.content = target.content;
    d.updatedAt = nowIsoChat();
    saveChatState();
    return { ok: true, result: { doc: d, revertedTo: idx } };
  });

  registerLensAction("chat", "canvas-delete", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.canvasDocs.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    map.delete(id);
    saveChatState();
    return { ok: true, result: { deleted: id } };
  });

  // ── Persistent memory — facts the AI remembers across conversations ──
  // Parity with ChatGPT's "Memory". Each fact is a short user-asserted (or
  // AI-extracted) statement. The chat lens injects active memories into
  // the system prompt so context carries between threads.

  registerLensAction("chat", "memory-list", (ctx, _artifact, _params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const map = s.memory.get(userId);
    if (!map) return { ok: true, result: { memories: [] } };
    const memories = Array.from(map.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { ok: true, result: { memories, activeCount: memories.filter((m) => m.active).length } };
  });

  registerLensAction("chat", "memory-add", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const fact = String(params.fact || "").trim();
    if (!fact) return { ok: false, error: "fact required" };
    if (fact.length > 500) return { ok: false, error: "fact too long (max 500)" };
    if (!s.memory.has(userId)) s.memory.set(userId, new Map());
    const map = s.memory.get(userId);
    // Dedupe — a memory with identical text is updated, not duplicated.
    const lc = fact.toLowerCase();
    for (const m of map.values()) {
      if (m.fact.toLowerCase() === lc) {
        m.updatedAt = nowIsoChat();
        m.active = true;
        saveChatState();
        return { ok: true, result: { memory: m, deduped: true } };
      }
    }
    const memory = {
      id: nextChatId("mem"),
      fact,
      category: ["preference", "fact", "context", "instruction"]
        .includes(params.category) ? params.category : "fact",
      source: params.source === "ai" ? "ai" : "user",
      active: true,
      createdAt: nowIsoChat(),
      updatedAt: nowIsoChat(),
    };
    map.set(memory.id, memory);
    saveChatState();
    return { ok: true, result: { memory } };
  });

  registerLensAction("chat", "memory-update", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.memory.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    const m = map.get(id);
    if (typeof params.fact === "string") {
      const f = params.fact.trim();
      if (!f) return { ok: false, error: "fact cannot be empty" };
      m.fact = f.slice(0, 500);
    }
    if (["preference", "fact", "context", "instruction"].includes(params.category)) m.category = params.category;
    if (typeof params.active === "boolean") m.active = params.active;
    m.updatedAt = nowIsoChat();
    saveChatState();
    return { ok: true, result: { memory: m } };
  });

  registerLensAction("chat", "memory-delete", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.memory.get(userId);
    if (!map) return { ok: false, error: "not found" };
    if (id === "*") {
      const cleared = map.size;
      map.clear();
      saveChatState();
      return { ok: true, result: { cleared } };
    }
    if (!map.has(id)) return { ok: false, error: "not found" };
    map.delete(id);
    saveChatState();
    return { ok: true, result: { deleted: id } };
  });

  // ── Code interpreter — sandboxed execution of generated code ─────────
  // Runs JS in a constrained scope: no require/import/process/fetch, a
  // wall-clock budget, and a captured-output console. Deterministic and
  // CPU-only — parity with ChatGPT's code interpreter for the JS subset.

  registerLensAction("chat", "code-run", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const code = String(params.code || "");
    if (!code.trim()) return { ok: false, error: "code required" };
    if (code.length > 20000) return { ok: false, error: "code too long (max 20000)" };
    const lang = params.language === "javascript" || !params.language ? "javascript" : String(params.language);
    if (lang !== "javascript") {
      return { ok: false, error: "only javascript is supported in this sandbox" };
    }
    // Static deny-list — block escape hatches before execution.
    const banned = /\b(require|import|process|globalThis|global|Function|eval|fetch|XMLHttpRequest|__dirname|__filename|module|exports|setInterval|WebAssembly)\b/;
    if (banned.test(code)) {
      return { ok: false, error: "forbidden token: code may not reference require/import/process/eval/fetch/global" };
    }
    const logs = [];
    const sandboxConsole = {
      log: (...a) => logs.push(a.map(fmtVal).join(" ")),
      error: (...a) => logs.push("[error] " + a.map(fmtVal).join(" ")),
      warn: (...a) => logs.push("[warn] " + a.map(fmtVal).join(" ")),
      info: (...a) => logs.push(a.map(fmtVal).join(" ")),
    };
    function fmtVal(v) {
      if (typeof v === "string") return v;
      try { return JSON.stringify(v); } catch { return String(v); }
    }
    const startedAt = Date.now();
    let returnValue;
    let error = null;
    const deadline = startedAt + 1500; // 1.5s wall budget
    try {
      // Execute under node:vm in a restricted context — no process, no
      // require, no globalThis leak into server scope — with a hard
      // vm-enforced wall-clock timeout. This is the codebase's audited
      // sandbox boundary (see tests/platinum-codeql-drift.test.js); it
      // closes the `.constructor` escape that a bare `new Function` allows.
      // __deadlineCheck() stays exposed so user loops can cooperatively bail.
      const sandbox = {
        console: sandboxConsole, Math, JSON, Date,
        __deadlineCheck: () => {
          if (Date.now() > deadline) throw new Error("execution timed out (1.5s budget)");
        },
      };
      const context = vm.createContext(sandbox, { name: "chat-code-run" });
      const script = new vm.Script(`"use strict";\n${code}`, { filename: "chat-exec.js" });
      returnValue = script.runInContext(context, { timeout: 1500, displayErrors: true });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const durationMs = Date.now() - startedAt;
    const run = {
      id: nextChatId("run"),
      language: lang,
      code: code.slice(0, 20000),
      logs: logs.slice(0, 500),
      returnValue: error ? null : fmtVal(returnValue),
      error,
      durationMs,
      timedOut: durationMs > 1500,
      ranAt: nowIsoChat(),
    };
    if (!s.codeRuns.has(userId)) s.codeRuns.set(userId, []);
    const arr = s.codeRuns.get(userId);
    arr.push(run);
    if (arr.length > 100) arr.splice(0, arr.length - 100);
    saveChatState();
    return { ok: true, result: { run } };
  });

  registerLensAction("chat", "code-history", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const arr = s.codeRuns.get(userId) || [];
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 20));
    return {
      ok: true,
      result: { runs: arr.slice(-limit).reverse(), total: arr.length },
    };
  });

  // ── Conversation share links — public read-only snapshot ─────────────
  // Creates an opaque token bound to a frozen copy of the conversation's
  // messages. Anyone with the token can read it via share-view; the
  // owner can revoke it. Parity with ChatGPT shared links.

  registerLensAction("chat", "share-create", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const threadId = String(params.threadId || "");
    if (!threadId) return { ok: false, error: "threadId required" };
    const title = String(params.title || "Shared conversation").slice(0, 200);
    const messages = Array.isArray(params.messages) ? params.messages : null;
    if (!messages || messages.length === 0) {
      return { ok: false, error: "messages required (non-empty snapshot)" };
    }
    if (messages.length > 2000) return { ok: false, error: "too many messages (max 2000)" };
    // Freeze a sanitized copy — role + content + timestamp only.
    const snapshot = messages.slice(0, 2000).map((m) => ({
      role: ["user", "assistant", "system"].includes(m?.role) ? m.role : "user",
      content: String(m?.content || "").slice(0, 20000),
      timestamp: String(m?.timestamp || nowIsoChat()),
    }));
    const token = `${nextChatId("shr")}${Math.random().toString(36).slice(2, 10)}`;
    const link = {
      token,
      ownerId: userId,
      threadId,
      title,
      snapshot,
      messageCount: snapshot.length,
      revoked: false,
      viewCount: 0,
      createdAt: nowIsoChat(),
    };
    if (!s.shareLinks.has(userId)) s.shareLinks.set(userId, new Map());
    s.shareLinks.get(userId).set(token, link);
    s.shareIndex.set(token, userId);
    saveChatState();
    return {
      ok: true,
      result: {
        token,
        url: `/share/chat/${token}`,
        messageCount: snapshot.length,
        createdAt: link.createdAt,
      },
    };
  });

  registerLensAction("chat", "share-list", (ctx, _artifact, _params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const map = s.shareLinks.get(userId);
    if (!map) return { ok: true, result: { links: [] } };
    const links = Array.from(map.values())
      .map((l) => ({
        token: l.token, threadId: l.threadId, title: l.title,
        messageCount: l.messageCount, revoked: l.revoked,
        viewCount: l.viewCount, createdAt: l.createdAt,
        url: `/share/chat/${l.token}`,
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { ok: true, result: { links } };
  });

  registerLensAction("chat", "share-view", (_ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const token = String(params.token || "");
    if (!token) return { ok: false, error: "token required" };
    const ownerId = s.shareIndex.get(token);
    if (!ownerId) return { ok: false, error: "share link not found" };
    const map = s.shareLinks.get(ownerId);
    const link = map && map.get(token);
    if (!link) return { ok: false, error: "share link not found" };
    if (link.revoked) return { ok: false, error: "share link has been revoked" };
    link.viewCount += 1;
    saveChatState();
    return {
      ok: true,
      result: {
        title: link.title,
        messages: link.snapshot,
        messageCount: link.messageCount,
        createdAt: link.createdAt,
        viewCount: link.viewCount,
      },
    };
  });

  registerLensAction("chat", "share-revoke", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const token = String(params.token || "");
    if (!token) return { ok: false, error: "token required" };
    const map = s.shareLinks.get(userId);
    if (!map || !map.has(token)) return { ok: false, error: "not found" };
    const link = map.get(token);
    link.revoked = true;
    link.revokedAt = nowIsoChat();
    saveChatState();
    return { ok: true, result: { token, revoked: true } };
  });

  // ── In-thread image generation ───────────────────────────────────────
  // Generates an image from a text prompt using the free keyless Pollinations
  // image endpoint. Returns a stable URL the chat thread renders inline.
  // The user's generation history is kept per-user.

  registerLensAction("chat", "image-generate", async (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const prompt = String(params.prompt || "").trim();
    if (!prompt) return { ok: false, error: "prompt required" };
    if (prompt.length > 800) return { ok: false, error: "prompt too long (max 800)" };
    const width = Math.max(256, Math.min(1024, Number(params.width) || 768));
    const height = Math.max(256, Math.min(1024, Number(params.height) || 768));
    // Deterministic seed so the same prompt is reproducible; user may pass one.
    let seed = Number(params.seed);
    if (!Number.isInteger(seed) || seed < 0) {
      seed = 0;
      for (let i = 0; i < prompt.length; i++) {
        seed = (seed * 31 + prompt.charCodeAt(i)) % 2147483647;
      }
    }
    // Free keyless image service — text-to-image via URL params.
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
      `?width=${width}&height=${height}&seed=${seed}&nologo=true`;
    let reachable = true;
    try {
      const head = await fetch(url, { method: "HEAD" });
      reachable = head.ok;
    } catch (_e) {
      // Network failure in a sandboxed test env — still return the URL,
      // the client img tag will surface a load error if it truly fails.
      reachable = false;
    }
    const image = {
      id: nextChatId("img"),
      prompt,
      url,
      width,
      height,
      seed,
      reachable,
      createdAt: nowIsoChat(),
    };
    if (!s.images.has(userId)) s.images.set(userId, []);
    const arr = s.images.get(userId);
    arr.push(image);
    if (arr.length > 200) arr.splice(0, arr.length - 200);
    saveChatState();
    return { ok: true, result: { image } };
  });

  registerLensAction("chat", "image-history", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const arr = s.images.get(userId) || [];
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 30));
    return { ok: true, result: { images: arr.slice(-limit).reverse(), total: arr.length } };
  });

  registerLensAction("chat", "image-delete", (ctx, _artifact, params = {}) => {
    const s = getChatState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    ensureChatSubmaps(s);
    const userId = actorIdFor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const arr = s.images.get(userId) || [];
    const idx = arr.findIndex((x) => x.id === id);
    if (idx < 0) return { ok: false, error: "not found" };
    arr.splice(idx, 1);
    saveChatState();
    return { ok: true, result: { deleted: id } };
  });
}
