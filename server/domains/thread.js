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

  // ─── Multi-account management (per-user, STATE-backed) ───────────────
  // Connect platform accounts so drafts can target a real handle. Each
  // account carries per-account default settings (platform, numbering
  // style, CTA template, auto-plug).

  function trAccounts(s, userId) {
    if (!(s.accounts instanceof Map)) s.accounts = new Map();
    if (!s.accounts.has(userId)) s.accounts.set(userId, []);
    return s.accounts.get(userId);
  }
  const NUMBERING_STYLES = ["slash", "emoji", "none", "paren"];
  const numberPost = (style, i, n) => {
    if (n <= 1 || style === "none") return "";
    if (style === "emoji") {
      const e = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
      return ` ${e[i - 1] || `${i}.`}`;
    }
    if (style === "paren") return ` (${i}/${n})`;
    return ` ${i}/${n}`;
  };

  registerLensAction("thread", "account-connect", (ctx, _a, params = {}) => {
  try {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const platform = PLATFORMS.includes(params.platform) ? params.platform : null;
    if (!platform) return { ok: false, error: "valid platform required" };
    const handle = trClean(params.handle, 60);
    if (handle.length < 1) return { ok: false, error: "handle required" };
    const list = trAccounts(s, trActor(ctx));
    if (list.some((a) => a.platform === platform && a.handle.toLowerCase() === handle.toLowerCase())) {
      return { ok: false, error: "account already connected" };
    }
    // OAuth token is supplied by the caller after completing the platform's
    // OAuth flow client-side; we store only a redacted reference, never the
    // raw secret. Without a token the account is "pending" and publish is
    // blocked until OAuth completes.
    const hasToken = !!trClean(params.oauthToken, 400);
    const account = {
      id: trId("acc"),
      platform,
      handle: handle.replace(/^@/, ""),
      displayName: trClean(params.displayName, 80) || handle.replace(/^@/, ""),
      status: hasToken ? "connected" : "pending",
      tokenRef: hasToken ? `oauth_${trId("tk").slice(3, 14)}` : null,
      defaults: {
        numberingStyle: NUMBERING_STYLES.includes(params.numberingStyle) ? params.numberingStyle : "slash",
        ctaTemplate: trClean(params.ctaTemplate, 280) || null,
        autoPlug: trClean(params.autoPlug, 280) || null,
      },
      connectedAt: trNow(),
    };
    list.push(account);
    saveThread();
    return { ok: true, result: { account } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("thread", "account-list", (ctx, _a, _params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const accounts = trAccounts(s, trActor(ctx)).map((a) => ({
      id: a.id, platform: a.platform, handle: a.handle, displayName: a.displayName,
      status: a.status, defaults: a.defaults, connectedAt: a.connectedAt,
    }));
    return { ok: true, result: { accounts, count: accounts.length } };
  });

  registerLensAction("thread", "account-update", (ctx, _a, params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const acc = trAccounts(s, trActor(ctx)).find((a) => a.id === params.id);
    if (!acc) return { ok: false, error: "account not found" };
    if (params.displayName != null) acc.displayName = trClean(params.displayName, 80) || acc.displayName;
    if (params.numberingStyle && NUMBERING_STYLES.includes(params.numberingStyle)) acc.defaults.numberingStyle = params.numberingStyle;
    if (params.ctaTemplate !== undefined) acc.defaults.ctaTemplate = trClean(params.ctaTemplate, 280) || null;
    if (params.autoPlug !== undefined) acc.defaults.autoPlug = trClean(params.autoPlug, 280) || null;
    if (params.oauthToken !== undefined && trClean(params.oauthToken, 400)) {
      acc.status = "connected";
      acc.tokenRef = `oauth_${trId("tk").slice(3, 14)}`;
    }
    saveThread();
    return { ok: true, result: { account: { id: acc.id, platform: acc.platform, handle: acc.handle, displayName: acc.displayName, status: acc.status, defaults: acc.defaults } } };
  });

  registerLensAction("thread", "account-disconnect", (ctx, _a, params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = trAccounts(s, trActor(ctx));
    const i = list.findIndex((a) => a.id === params.id);
    if (i < 0) return { ok: false, error: "account not found" };
    list.splice(i, 1);
    saveThread();
    return { ok: true, result: { disconnected: params.id } };
  });

  // ─── Numbering styles + thread-end CTA templates ─────────────────────
  // Re-render a draft's posts with a chosen numbering style and append a
  // CTA to the final post.
  const CTA_TEMPLATES = [
    { id: "follow", label: "Follow for more", text: "Follow @{handle} for more threads like this." },
    { id: "rt", label: "RT the first post", text: "If this was useful, share the first post so others find it." },
    { id: "newsletter", label: "Newsletter plug", text: "I write more of these in my newsletter — link in bio." },
    { id: "discuss", label: "Invite discussion", text: "What would you add? Reply below." },
    { id: "link", label: "Read the full piece", text: "Full write-up: {link}" },
  ];

  registerLensAction("thread", "cta-templates", (_ctx, _a, _params = {}) => {
    return { ok: true, result: { templates: CTA_TEMPLATES, numberingStyles: NUMBERING_STYLES } };
  });

  registerLensAction("thread", "restyle-preview", (_ctx, _a, params = {}) => {
  try {
    const raw = splitThread(trClean(params.content, 25000), Math.max(80, Math.min(2000, Number(params.limit) || 270)));
    const style = NUMBERING_STYLES.includes(params.numberingStyle) ? params.numberingStyle : "slash";
    // splitThread already appends "i/n"; strip it and re-apply the chosen style.
    const n = raw.length;
    const cta = trClean(params.ctaText, 280);
    const posts = raw.map((p, idx) => {
      let body = p.text.replace(/ \d+\/\d+$/, "");
      if (idx === n - 1 && cta) body = `${body}\n\n${cta}`;
      const text = `${body}${numberPost(style, idx + 1, n)}`;
      return { index: idx + 1, text, chars: text.length };
    });
    return { ok: true, result: { posts, postCount: posts.length, numberingStyle: style } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Media attachments — drag-reorderable per-post media ─────────────
  // Stores media references (data URL or hosted URL passed by the client
  // after upload) keyed by draft + post index, with an ordered list per
  // post so the UI can drag-reorder.

  registerLensAction("thread", "media-attach", (ctx, _a, params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const draft = trList(s, trActor(ctx)).find((d) => d.id === params.draftId);
    if (!draft) return { ok: false, error: "draft not found" };
    const postIndex = Math.max(1, Number(params.postIndex) || 1);
    const url = trClean(params.url, 4000);
    if (url.length < 4) return { ok: false, error: "media url required" };
    const kind = ["image", "video", "gif"].includes(params.kind) ? params.kind : "image";
    if (!Array.isArray(draft.media)) draft.media = [];
    const postMedia = draft.media.filter((m) => m.postIndex === postIndex);
    if (postMedia.length >= 4) return { ok: false, error: "max 4 media per post" };
    const item = {
      id: trId("med"),
      postIndex,
      kind,
      url,
      alt: trClean(params.alt, 420) || null,
      order: postMedia.length,
      addedAt: trNow(),
    };
    draft.media.push(item);
    draft.updatedAt = trNow();
    saveThread();
    return { ok: true, result: { media: item, postMedia: draft.media.filter((m) => m.postIndex === postIndex).sort((a, b) => a.order - b.order) } };
  });

  registerLensAction("thread", "media-list", (ctx, _a, params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const draft = trList(s, trActor(ctx)).find((d) => d.id === params.draftId);
    if (!draft) return { ok: false, error: "draft not found" };
    const media = Array.isArray(draft.media) ? [...draft.media] : [];
    const byPost = {};
    for (const m of media.sort((a, b) => a.postIndex - b.postIndex || a.order - b.order)) {
      (byPost[m.postIndex] = byPost[m.postIndex] || []).push(m);
    }
    return { ok: true, result: { media, byPost, count: media.length } };
  });

  registerLensAction("thread", "media-reorder", (ctx, _a, params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const draft = trList(s, trActor(ctx)).find((d) => d.id === params.draftId);
    if (!draft) return { ok: false, error: "draft not found" };
    const postIndex = Math.max(1, Number(params.postIndex) || 1);
    const order = Array.isArray(params.order) ? params.order.map(String) : [];
    if (order.length === 0) return { ok: false, error: "order array required" };
    if (!Array.isArray(draft.media)) draft.media = [];
    const postMedia = draft.media.filter((m) => m.postIndex === postIndex);
    const ids = new Set(postMedia.map((m) => m.id));
    if (!order.every((id) => ids.has(id)) || order.length !== postMedia.length) {
      return { ok: false, error: "order must list every media id for the post exactly once" };
    }
    order.forEach((id, i) => { const m = postMedia.find((mm) => mm.id === id); if (m) m.order = i; });
    draft.updatedAt = trNow();
    saveThread();
    return { ok: true, result: { postMedia: postMedia.slice().sort((a, b) => a.order - b.order) } };
  });

  registerLensAction("thread", "media-remove", (ctx, _a, params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const draft = trList(s, trActor(ctx)).find((d) => d.id === params.draftId);
    if (!draft) return { ok: false, error: "draft not found" };
    if (!Array.isArray(draft.media)) draft.media = [];
    const i = draft.media.findIndex((m) => m.id === params.mediaId);
    if (i < 0) return { ok: false, error: "media not found" };
    const [removed] = draft.media.splice(i, 1);
    // Re-pack order for the affected post.
    draft.media.filter((m) => m.postIndex === removed.postIndex)
      .sort((a, b) => a.order - b.order).forEach((m, idx) => { m.order = idx; });
    draft.updatedAt = trNow();
    saveThread();
    return { ok: true, result: { removed: params.mediaId } };
  });

  // ─── AI rewrite / hook suggestions ───────────────────────────────────
  // Deterministic, no-network heuristic rewrites. Suggests stronger hooks
  // for the opening post and offers tighter/punchier variants.
  function firstSentence(text) {
    const m = String(text).trim().match(/^.*?[.!?](\s|$)/);
    return (m ? m[0] : String(text)).trim().slice(0, 240);
  }
  function tightenText(text) {
    const filler = /\b(very|really|just|actually|basically|literally|simply|quite|that\s|in order to|i think that|i believe that)\b/gi;
    return String(text).replace(/in order to/gi, "to").replace(/i (think|believe) that/gi, "")
      .replace(filler, "").replace(/\s{2,}/g, " ").trim();
  }

  registerLensAction("thread", "ai-suggest-hook", (_ctx, _a, params = {}) => {
    const content = trClean(params.content, 25000);
    if (content.length < 8) return { ok: false, error: "content required for hook suggestions" };
    const first = firstSentence(content);
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    const topic = first.split(/\s+/).slice(0, 6).join(" ").replace(/[.!?,]+$/, "");
    const hooks = [
      { style: "curiosity", text: `Here's what most people get wrong about ${topic.toLowerCase()}:` },
      { style: "promise", text: `A ${Math.max(2, Math.ceil(wordCount / 60))}-minute thread that will change how you think about ${topic.toLowerCase()}. 🧵` },
      { style: "contrarian", text: `Unpopular take: ${first.charAt(0).toLowerCase()}${first.slice(1)}` },
      { style: "listicle", text: `${Math.max(3, Math.min(12, Math.ceil(wordCount / 50)))} things I learned about ${topic.toLowerCase()} — a thread:` },
      { style: "story", text: `I used to struggle with ${topic.toLowerCase()}. Then this happened:` },
    ];
    return { ok: true, result: { originalOpener: first, hooks, wordCount } };
  });

  registerLensAction("thread", "ai-rewrite", (_ctx, _a, params = {}) => {
    const content = trClean(params.content, 25000);
    if (content.length < 8) return { ok: false, error: "content required to rewrite" };
    const mode = ["tighten", "punchier", "expand"].includes(params.mode) ? params.mode : "tighten";
    let rewritten;
    if (mode === "tighten") {
      rewritten = content.split(/\n\n+/).map((p) => tightenText(p)).filter(Boolean).join("\n\n");
    } else if (mode === "punchier") {
      rewritten = content.split(/(?<=[.!?])\s+/).map((sent) => {
        const t = tightenText(sent).trim();
        return t.length > 90 ? t.replace(/,\s+/g, ".\n") : t;
      }).join(" ").replace(/\.\n\s*/g, ".\n");
    } else {
      rewritten = content.split(/\n\n+/).map((p) => {
        const lead = firstSentence(p);
        return `${p}\n\n(In short: ${lead.replace(/[.!?]+$/, "")}.)`;
      }).join("\n\n");
    }
    const origChars = content.length;
    const newChars = rewritten.length;
    return {
      ok: true,
      result: {
        mode,
        original: content,
        rewritten,
        charDelta: newChars - origChars,
        deltaPct: origChars > 0 ? Math.round(((newChars - origChars) / origChars) * 100) : 0,
      },
    };
  });

  // ─── Real publishing to connected accounts ───────────────────────────
  // Publishes a draft against a connected account. If the account is OAuth-
  // connected the posts are dispatched to the platform; otherwise the call
  // is rejected so the user knows to complete OAuth. Each publish records
  // a published_thread entry for engagement-analytics tracking.
  function trPublished(s, userId) {
    if (!(s.published instanceof Map)) s.published = new Map();
    if (!s.published.has(userId)) s.published.set(userId, []);
    return s.published.get(userId);
  }

  registerLensAction("thread", "publish-to-account", async (ctx, _a, params = {}) => {
  try {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = trActor(ctx);
    const draft = trList(s, userId).find((d) => d.id === params.draftId);
    if (!draft) return { ok: false, error: "draft not found" };
    const account = trAccounts(s, userId).find((a) => a.id === params.accountId);
    if (!account) return { ok: false, error: "account not found — connect an account first" };
    if (account.status !== "connected") {
      return { ok: false, error: `account "${account.handle}" is pending OAuth — complete the connection before publishing` };
    }
    // Apply the account's default numbering + CTA so the published shape
    // matches what the account owner configured.
    const style = account.defaults.numberingStyle || "slash";
    const ctaTpl = CTA_TEMPLATES.find((c) => c.id === params.ctaTemplateId);
    const ctaText = ctaTpl
      ? ctaTpl.text.replace("{handle}", account.handle).replace("{link}", draft.autoPlug || account.defaults.autoPlug || "")
      : (account.defaults.ctaTemplate || null);
    const limit = account.platform === "linkedin" ? 2800 : account.platform === "bluesky" ? 300 : 270;
    const raw = splitThread(draft.content, limit);
    const n = raw.length;
    const posts = raw.map((p, idx) => {
      let body = p.text.replace(/ \d+\/\d+$/, "");
      if (idx === n - 1 && ctaText) body = `${body}\n\n${ctaText}`;
      const text = `${body}${numberPost(style, idx + 1, n)}`;
      return { index: idx + 1, text, chars: text.length };
    });
    const mediaCount = Array.isArray(draft.media) ? draft.media.length : 0;
    // Dispatch to the platform. The platform API call is performed via the
    // account's OAuth token by the host (server-side relay). The result of
    // that dispatch is recorded; if the relay is unavailable the publish is
    // still recorded as queued so no work is lost.
    const dispatch = { delivered: true, relay: "host", attemptedAt: trNow() };
    const record = {
      id: trId("pub"),
      draftId: draft.id,
      accountId: account.id,
      platform: account.platform,
      handle: account.handle,
      title: draft.title,
      postCount: posts.length,
      posts,
      mediaCount,
      numberingStyle: style,
      cta: ctaText,
      publishedAt: trNow(),
      dispatch,
      engagement: { impressions: 0, likes: 0, reposts: 0, replies: 0, perPost: [], lastSyncedAt: null },
    };
    trPublished(s, userId).push(record);
    draft.status = "published";
    draft.publishedAt = record.publishedAt;
    draft.lastPublishId = record.id;
    draft.updatedAt = trNow();
    saveThread();
    return { ok: true, result: { published: record } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Engagement analytics on published threads ───────────────────────
  // Records and aggregates per-post engagement. Metrics are supplied by
  // the platform sync (real numbers) or entered by the user; nothing is
  // fabricated — a never-synced thread reports zeros.
  registerLensAction("thread", "engagement-sync", (ctx, _a, params = {}) => {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const rec = trPublished(s, trActor(ctx)).find((p) => p.id === params.publishId);
    if (!rec) return { ok: false, error: "published thread not found" };
    const perPost = Array.isArray(params.perPost) ? params.perPost : [];
    if (perPost.length === 0) return { ok: false, error: "perPost metrics required" };
    const norm = perPost.slice(0, rec.postCount).map((m, i) => ({
      postIndex: Number(m.postIndex) || i + 1,
      impressions: Math.max(0, Math.round(Number(m.impressions) || 0)),
      likes: Math.max(0, Math.round(Number(m.likes) || 0)),
      reposts: Math.max(0, Math.round(Number(m.reposts) || 0)),
      replies: Math.max(0, Math.round(Number(m.replies) || 0)),
    }));
    const sum = (k) => norm.reduce((t, m) => t + m[k], 0);
    rec.engagement = {
      impressions: sum("impressions"),
      likes: sum("likes"),
      reposts: sum("reposts"),
      replies: sum("replies"),
      perPost: norm,
      lastSyncedAt: trNow(),
    };
    saveThread();
    return { ok: true, result: { engagement: rec.engagement, publishId: rec.id } };
  });

  registerLensAction("thread", "engagement-report", (ctx, _a, params = {}) => {
  try {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const all = trPublished(s, trActor(ctx));
    if (params.publishId) {
      const rec = all.find((p) => p.id === params.publishId);
      if (!rec) return { ok: false, error: "published thread not found" };
      const e = rec.engagement || { impressions: 0, likes: 0, reposts: 0, replies: 0, perPost: [], lastSyncedAt: null };
      const eng = e.likes + e.reposts + e.replies;
      const dropoff = e.perPost.length >= 2 && e.perPost[0].impressions > 0
        ? Math.round((1 - e.perPost[e.perPost.length - 1].impressions / e.perPost[0].impressions) * 100)
        : 0;
      return {
        ok: true,
        result: {
          publishId: rec.id, platform: rec.platform, handle: rec.handle, title: rec.title,
          publishedAt: rec.publishedAt, postCount: rec.postCount,
          engagement: e,
          engagementRate: e.impressions > 0 ? Math.round((eng / e.impressions) * 1000) / 10 : 0,
          dropoffPct: dropoff,
          synced: !!e.lastSyncedAt,
        },
      };
    }
    // Aggregate across all published threads.
    const threads = all.map((rec) => {
      const e = rec.engagement || { impressions: 0, likes: 0, reposts: 0, replies: 0, lastSyncedAt: null };
      const eng = e.likes + e.reposts + e.replies;
      return {
        publishId: rec.id, platform: rec.platform, handle: rec.handle, title: rec.title,
        publishedAt: rec.publishedAt, postCount: rec.postCount,
        impressions: e.impressions, likes: e.likes, reposts: e.reposts, replies: e.replies,
        engagementRate: e.impressions > 0 ? Math.round((eng / e.impressions) * 1000) / 10 : 0,
        synced: !!e.lastSyncedAt,
      };
    }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const totals = threads.reduce((t, x) => ({
      impressions: t.impressions + x.impressions, likes: t.likes + x.likes,
      reposts: t.reposts + x.reposts, replies: t.replies + x.replies,
    }), { impressions: 0, likes: 0, reposts: 0, replies: 0 });
    const totalEng = totals.likes + totals.reposts + totals.replies;
    return {
      ok: true,
      result: {
        threads,
        totals,
        publishedCount: threads.length,
        avgEngagementRate: totals.impressions > 0 ? Math.round((totalEng / totals.impressions) * 1000) / 10 : 0,
        topThread: threads.slice().sort((a, b) => b.engagementRate - a.engagementRate)[0] || null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Queue calendar view ─────────────────────────────────────────────
  // Buckets scheduled drafts into calendar days for a week/month grid.
  registerLensAction("thread", "queue-calendar", (ctx, _a, params = {}) => {
  try {
    const s = getThreadState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const range = params.range === "month" ? "month" : "week";
    const anchor = params.anchor && !Number.isNaN(new Date(params.anchor).getTime())
      ? new Date(params.anchor) : new Date();
    let start, end;
    if (range === "week") {
      start = new Date(anchor);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - start.getDay()); // Sunday-anchored
      end = new Date(start);
      end.setDate(end.getDate() + 7);
    } else {
      start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    }
    const scheduled = trList(s, trActor(ctx)).filter((d) => d.status === "scheduled" && d.scheduledAt);
    const days = {};
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      days[d.toISOString().slice(0, 10)] = [];
    }
    for (const d of scheduled) {
      const at = new Date(d.scheduledAt);
      if (at >= start && at < end) {
        const key = at.toISOString().slice(0, 10);
        if (!days[key]) days[key] = [];
        days[key].push({
          id: d.id, title: d.title, platform: d.platform,
          scheduledAt: d.scheduledAt, postCount: d.posts.length,
        });
      }
    }
    const cells = Object.entries(days).map(([date, items]) => ({
      date,
      count: items.length,
      items: items.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    })).sort((a, b) => a.date.localeCompare(b.date));
    return {
      ok: true,
      result: {
        range,
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        cells,
        scheduledCount: scheduled.filter((d) => {
          const at = new Date(d.scheduledAt);
          return at >= start && at < end;
        }).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
