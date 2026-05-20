// server/domains/thread.js
export default function registerThreadActions(registerLensAction) {
  registerLensAction("thread", "threadAnalyze", (ctx, artifact, _params) => {
    const messages = artifact.data?.messages || artifact.data?.posts || [];
    if (messages.length === 0) return { ok: true, result: { message: "Provide messages to analyze the thread." } };
    const totalChars = messages.reduce((s, m) => s + (m.text || m.content || "").length, 0);
    const avgLength = Math.round(totalChars / messages.length);
    const participants = [...new Set(messages.map(m => m.author || m.user || m.sender || "anonymous"))];
    const responseTimes = [];
    for (let i = 1; i < messages.length; i++) {
      const prev = new Date(messages[i - 1].timestamp || messages[i - 1].date || 0);
      const curr = new Date(messages[i].timestamp || messages[i].date || 0);
      if (prev.getTime() && curr.getTime()) responseTimes.push((curr.getTime() - prev.getTime()) / 60000);
    }
    const avgResponseMin = responseTimes.length > 0 ? Math.round(responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length) : null;
    const byHour = {};
    messages.forEach(m => {
      const h = new Date(m.timestamp || m.date || 0).getHours();
      if (!isNaN(h)) byHour[h] = (byHour[h] || 0) + 1;
    });
    const peakHour = Object.entries(byHour).sort((a, b) => b[1] - a[1])[0];
    return { ok: true, result: { messageCount: messages.length, participants: participants.length, participantList: participants, avgMessageLength: avgLength, totalCharacters: totalChars, avgResponseMinutes: avgResponseMin, peakActivityHour: peakHour ? parseInt(peakHour[0]) : null, threadDuration: messages.length >= 2 ? `${Math.round((new Date(messages[messages.length - 1].timestamp || messages[messages.length - 1].date || 0).getTime() - new Date(messages[0].timestamp || messages[0].date || 0).getTime()) / 3600000)} hours` : null } };
  });

  registerLensAction("thread", "sentimentMap", (ctx, artifact, _params) => {
    const messages = artifact.data?.messages || [];
    if (messages.length === 0) return { ok: true, result: { message: "Provide messages to map sentiment." } };
    const positive = ["good", "great", "love", "excellent", "amazing", "awesome", "fantastic", "wonderful", "happy", "perfect", "beautiful", "brilliant", "outstanding", "superb", "agree", "thanks", "thank", "helpful", "nice", "best"];
    const negative = ["bad", "terrible", "hate", "awful", "horrible", "disgusting", "annoyed", "angry", "frustrated", "disappointed", "wrong", "worst", "fail", "broken", "useless", "stupid", "disagree", "never", "problem", "issue"];
    const scored = messages.map((m, i) => {
      const text = (m.text || m.content || "").toLowerCase();
      const words = text.split(/\s+/);
      const posCount = words.filter(w => positive.includes(w.replace(/[^a-z]/g, ""))).length;
      const negCount = words.filter(w => negative.includes(w.replace(/[^a-z]/g, ""))).length;
      const score = words.length > 0 ? Math.round(((posCount - negCount) / Math.max(1, words.length)) * 100) : 0;
      return { index: i, author: m.author || m.user || "anonymous", sentiment: score > 2 ? "positive" : score < -2 ? "negative" : "neutral", score, positiveWords: posCount, negativeWords: negCount };
    });
    const avgSentiment = Math.round(scored.reduce((s, m) => s + m.score, 0) / scored.length * 10) / 10;
    return { ok: true, result: { messages: scored.length, avgSentiment, overallTone: avgSentiment > 1 ? "positive" : avgSentiment < -1 ? "negative" : "neutral", positiveMessages: scored.filter(s => s.sentiment === "positive").length, negativeMessages: scored.filter(s => s.sentiment === "negative").length, neutralMessages: scored.filter(s => s.sentiment === "neutral").length, sentimentFlow: scored.map(s => ({ index: s.index, sentiment: s.sentiment, score: s.score })), mostPositive: scored.sort((a, b) => b.score - a.score)[0], mostNegative: scored.sort((a, b) => a.score - b.score)[0] } };
  });

  registerLensAction("thread", "participantStats", (ctx, artifact, _params) => {
    const messages = artifact.data?.messages || [];
    if (messages.length === 0) return { ok: true, result: { message: "Provide messages to compute participant stats." } };
    const stats = {};
    messages.forEach((m, i) => {
      const author = m.author || m.user || m.sender || "anonymous";
      if (!stats[author]) stats[author] = { messages: 0, totalChars: 0, responseTimes: [], hours: [] };
      stats[author].messages++;
      stats[author].totalChars += (m.text || m.content || "").length;
      const hour = new Date(m.timestamp || m.date || 0).getHours();
      if (!isNaN(hour)) stats[author].hours.push(hour);
      if (i > 0) {
        const prev = new Date(messages[i - 1].timestamp || messages[i - 1].date || 0);
        const curr = new Date(m.timestamp || m.date || 0);
        if (prev.getTime() && curr.getTime()) stats[author].responseTimes.push((curr.getTime() - prev.getTime()) / 60000);
      }
    });
    const participants = Object.entries(stats).map(([name, data]) => ({
      name,
      messageCount: data.messages,
      sharePercent: Math.round((data.messages / messages.length) * 100),
      avgMessageLength: Math.round(data.totalChars / data.messages),
      avgResponseMinutes: data.responseTimes.length > 0 ? Math.round(data.responseTimes.reduce((s, t) => s + t, 0) / data.responseTimes.length) : null,
      peakHour: data.hours.length > 0 ? data.hours.sort((a, b) => data.hours.filter(h => h === b).length - data.hours.filter(h => h === a).length)[0] : null,
    })).sort((a, b) => b.messageCount - a.messageCount);
    return { ok: true, result: { totalParticipants: participants.length, totalMessages: messages.length, participants, mostActive: participants[0]?.name, leastActive: participants[participants.length - 1]?.name } };
  });

  registerLensAction("thread", "topicExtract", (ctx, artifact, _params) => {
    const messages = artifact.data?.messages || [];
    if (messages.length === 0) return { ok: true, result: { message: "Provide messages to extract topics." } };
    const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "and", "but", "or", "not", "so", "yet", "if", "when", "which", "who", "this", "that", "these", "those", "it", "its", "we", "our", "they", "their", "he", "she", "his", "her", "i", "me", "my", "you", "your", "just", "also", "very", "really", "too", "about", "up", "out", "all", "one", "two", "been", "some", "than", "them", "then", "what", "how", "more", "into", "only", "no", "yes"]);
    const wordFreq = {};
    messages.forEach(m => {
      const text = (m.text || m.content || "").toLowerCase();
      text.split(/\s+/).forEach(w => {
        const clean = w.replace(/[^a-z0-9-]/g, "");
        if (clean.length > 2 && !stopWords.has(clean)) wordFreq[clean] = (wordFreq[clean] || 0) + 1;
      });
    });
    const topics = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({ topic: word, mentions: count, frequency: Math.round((count / messages.length) * 100) }));
    // Bigram extraction
    const bigrams = {};
    messages.forEach(m => {
      const words = (m.text || m.content || "").toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z0-9-]/g, "")).filter(w => w.length > 2 && !stopWords.has(w));
      for (let i = 0; i < words.length - 1; i++) {
        const bg = `${words[i]} ${words[i + 1]}`;
        bigrams[bg] = (bigrams[bg] || 0) + 1;
      }
    });
    const topBigrams = Object.entries(bigrams).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([phrase, count]) => ({ phrase, count }));
    return { ok: true, result: { messagesAnalyzed: messages.length, topics, topBigrams, dominantTopic: topics[0]?.topic, topicDiversity: Math.round((Object.keys(wordFreq).length / messages.length) * 10) / 10 } };
  });

  // ─── Typefully-shape thread composer (per-user, STATE-backed) ────────
  // Write long-form text; it auto-splits into numbered posts. Drafts
  // queue for scheduling and publishing.

  function getThreadState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.threadLens) STATE.threadLens = {};
    if (!(STATE.threadLens.drafts instanceof Map)) STATE.threadLens.drafts = new Map(); // userId -> Array
    return STATE.threadLens;
  }
  function saveThread() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const trId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const trNow = () => new Date().toISOString();
  const trActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const trClean = (v, max = 25000) => String(v == null ? "" : v).trim().slice(0, max);
  const trList = (s, userId) => { if (!s.drafts.has(userId)) s.drafts.set(userId, []); return s.drafts.get(userId); };
  const PLATFORMS = ["x", "threads", "linkedin", "bluesky", "mastodon"];

  // Auto-split raw text into ≤limit-char posts on paragraph → sentence →
  // word boundaries, then number them "i/n" (Typefully's core trick).
  function splitThread(text, limit = 270) {
    const paras = String(text).split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    const chunks = [];
    const pushWordSplit = (sentence) => {
      let cur = "";
      for (const w of sentence.split(/\s+/)) {
        if ((cur ? cur + " " + w : w).length <= limit) cur = cur ? cur + " " + w : w;
        else { if (cur) chunks.push(cur); cur = w.slice(0, limit); }
      }
      if (cur) chunks.push(cur);
    };
    for (const para of paras) {
      if (para.length <= limit) { chunks.push(para); continue; }
      let cur = "";
      for (const sent of para.split(/(?<=[.!?])\s+/)) {
        if ((cur ? cur + " " + sent : sent).length <= limit) {
          cur = cur ? cur + " " + sent : sent;
        } else {
          if (cur) { chunks.push(cur); cur = ""; }
          if (sent.length <= limit) cur = sent;
          else pushWordSplit(sent);
        }
      }
      if (cur) chunks.push(cur);
    }
    const n = chunks.length;
    return chunks.map((c, i) => ({
      index: i + 1,
      text: n > 1 ? `${c} ${i + 1}/${n}` : c,
      chars: (n > 1 ? `${c} ${i + 1}/${n}` : c).length,
    }));
  }

  registerLensAction("thread", "split-preview", (_ctx, _a, params = {}) => {
    const posts = splitThread(trClean(params.content, 25000), Math.max(80, Math.min(2000, Number(params.limit) || 270)));
    return { ok: true, result: { posts, postCount: posts.length } };
  });

  registerLensAction("thread", "thread-draft", (ctx, _a, params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const content = trClean(params.content, 25000);
    if (content.length < 2) return { ok: false, error: "draft content required" };
    const platform = PLATFORMS.includes(params.platform) ? params.platform : "x";
    const limit = platform === "linkedin" ? 2800 : platform === "bluesky" ? 300 : 270;
    const draft = {
      id: trId("th"),
      title: trClean(params.title, 120) || content.split(/\n/)[0].slice(0, 80),
      content,
      platform,
      posts: splitThread(content, limit),
      status: "draft",
      scheduledAt: null,
      autoPlug: trClean(params.autoPlug, 280) || null,
      createdAt: trNow(),
      updatedAt: trNow(),
    };
    trList(s, trActor(ctx)).push(draft);
    saveThread();
    return { ok: true, result: { draft } };
  });

  registerLensAction("thread", "draft-list", (ctx, _a, params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let drafts = [...trList(s, trActor(ctx))];
    if (params.status) drafts = drafts.filter((d) => d.status === params.status);
    drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const out = drafts.map((d) => ({
      id: d.id, title: d.title, platform: d.platform, status: d.status,
      postCount: d.posts.length, scheduledAt: d.scheduledAt, updatedAt: d.updatedAt,
    }));
    return { ok: true, result: { drafts: out, count: out.length } };
  });

  registerLensAction("thread", "draft-detail", (ctx, _a, params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const draft = trList(s, trActor(ctx)).find((d) => d.id === params.id);
    if (!draft) return { ok: false, error: "draft not found" };
    return { ok: true, result: { draft } };
  });

  registerLensAction("thread", "draft-update", (ctx, _a, params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const draft = trList(s, trActor(ctx)).find((d) => d.id === params.id);
    if (!draft) return { ok: false, error: "draft not found" };
    if (params.content != null) {
      draft.content = trClean(params.content, 25000) || draft.content;
      const limit = draft.platform === "linkedin" ? 2800 : draft.platform === "bluesky" ? 300 : 270;
      draft.posts = splitThread(draft.content, limit);
    }
    if (params.title != null) draft.title = trClean(params.title, 120) || draft.title;
    if (params.autoPlug !== undefined) draft.autoPlug = trClean(params.autoPlug, 280) || null;
    draft.updatedAt = trNow();
    saveThread();
    return { ok: true, result: { draft } };
  });

  registerLensAction("thread", "draft-delete", (ctx, _a, params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = trList(s, trActor(ctx));
    const i = arr.findIndex((d) => d.id === params.id);
    if (i < 0) return { ok: false, error: "draft not found" };
    arr.splice(i, 1);
    saveThread();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("thread", "draft-schedule", (ctx, _a, params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const draft = trList(s, trActor(ctx)).find((d) => d.id === params.id);
    if (!draft) return { ok: false, error: "draft not found" };
    const at = trClean(params.scheduledAt, 40);
    if (!at || Number.isNaN(new Date(at).getTime())) return { ok: false, error: "valid scheduledAt required" };
    draft.scheduledAt = new Date(at).toISOString();
    draft.status = "scheduled";
    draft.updatedAt = trNow();
    saveThread();
    return { ok: true, result: { draft } };
  });

  registerLensAction("thread", "draft-publish", (ctx, _a, params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const draft = trList(s, trActor(ctx)).find((d) => d.id === params.id);
    if (!draft) return { ok: false, error: "draft not found" };
    draft.status = "published";
    draft.publishedAt = trNow();
    draft.updatedAt = trNow();
    saveThread();
    return { ok: true, result: { draft } };
  });

  registerLensAction("thread", "queue-list", (ctx, _a, _params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const queue = trList(s, trActor(ctx))
      .filter((d) => d.status === "scheduled")
      .sort((a, b) => (a.scheduledAt || "").localeCompare(b.scheduledAt || ""))
      .map((d) => ({ id: d.id, title: d.title, platform: d.platform, scheduledAt: d.scheduledAt, postCount: d.posts.length }));
    return { ok: true, result: { queue, count: queue.length } };
  });

  // best-time — deterministic best-time-to-post heuristic (engagement
  // peaks weekday mornings + early evenings).
  registerLensAction("thread", "best-time", (_ctx, _a, _params = {}) => {
    const slots = [
      { day: "Tue", time: "09:00", score: 96 },
      { day: "Wed", time: "12:00", score: 93 },
      { day: "Thu", time: "17:00", score: 91 },
      { day: "Mon", time: "08:00", score: 88 },
      { day: "Fri", time: "11:00", score: 84 },
    ];
    return { ok: true, result: { recommended: slots[0], slots } };
  });

  registerLensAction("thread", "thread-dashboard", (ctx, _a, _params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const drafts = trList(s, trActor(ctx));
    return {
      ok: true,
      result: {
        drafts: drafts.filter((d) => d.status === "draft").length,
        scheduled: drafts.filter((d) => d.status === "scheduled").length,
        published: drafts.filter((d) => d.status === "published").length,
        total: drafts.length,
        totalPosts: drafts.reduce((n, d) => n + d.posts.length, 0),
      },
    };
  });
}
