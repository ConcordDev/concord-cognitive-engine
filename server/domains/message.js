// server/domains/message.js
//
// 2026 parity enhancements over the existing /api/social/dm/* DM substrate.
// Adds saved (starred) messages, full-text search across DM history snapshots,
// reactions store, and voice-note metadata registry — all per-user scoped.

export default function registerMessageActions(registerLensAction) {
  function getMessageState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.messageLens) {
      STATE.messageLens = {
        saved:     new Map(), // userId -> Map<messageId, savedEntry>
        reactions: new Map(), // userId -> Map<messageId, Map<emoji, count>>
        searchIdx: new Map(), // userId -> Array<{ messageId, threadId, body, sender, ts }>
        voice:     new Map(), // userId -> Map<messageId, voiceMeta>
      };
    }
    return STATE.messageLens;
  }
  function saveMessageState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function msgActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextMsgId(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function nowIsoMsg() { return new Date().toISOString(); }

  // ── Saved (starred) messages ──

  registerLensAction("message", "saved-list", (ctx, _artifact, _params = {}) => {
    const s = getMessageState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const map = s.saved.get(userId);
    if (!map) return { ok: true, result: { saved: [] } };
    const saved = Array.from(map.values())
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
    return { ok: true, result: { saved } };
  });

  registerLensAction("message", "save-message", (ctx, _artifact, params = {}) => {
    const s = getMessageState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const messageId = String(params.messageId || "");
    if (!messageId) return { ok: false, error: "messageId required" };
    const threadId = String(params.threadId || "");
    const sender = String(params.sender || "");
    const body = String(params.body || "");
    if (!body.trim()) return { ok: false, error: "body required" };
    if (body.length > 4000) return { ok: false, error: "body too long" };
    const note = String(params.note || "").slice(0, 200);
    if (!s.saved.has(userId)) s.saved.set(userId, new Map());
    const entry = {
      id: nextMsgId("sav"),
      messageId, threadId, sender, body, note,
      savedAt: nowIsoMsg(),
    };
    s.saved.get(userId).set(messageId, entry);
    saveMessageState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("message", "unsave-message", (ctx, _artifact, params = {}) => {
    const s = getMessageState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const messageId = String(params.messageId || "");
    if (!messageId) return { ok: false, error: "messageId required" };
    const map = s.saved.get(userId);
    if (!map || !map.has(messageId)) return { ok: false, error: "not saved" };
    map.delete(messageId);
    saveMessageState();
    return { ok: true, result: { unsaved: messageId } };
  });

  // ── Message search index + search ──

  registerLensAction("message", "index-message", (ctx, _artifact, params = {}) => {
    const s = getMessageState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const messageId = String(params.messageId || "");
    if (!messageId) return { ok: false, error: "messageId required" };
    if (!s.searchIdx.has(userId)) s.searchIdx.set(userId, []);
    const arr = s.searchIdx.get(userId);
    const existing = arr.findIndex((m) => m.messageId === messageId);
    const entry = {
      messageId,
      threadId: String(params.threadId || ""),
      body: String(params.body || "").slice(0, 4000),
      sender: String(params.sender || ""),
      ts: String(params.ts || nowIsoMsg()),
    };
    if (existing >= 0) arr[existing] = entry;
    else {
      arr.push(entry);
      // Cap index at 5000 messages
      if (arr.length > 5000) arr.splice(0, arr.length - 5000);
    }
    saveMessageState();
    return { ok: true, result: { messageId, total: arr.length } };
  });

  registerLensAction("message", "search-messages", (ctx, _artifact, params = {}) => {
    const s = getMessageState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const query = String(params.query || "").trim().toLowerCase();
    if (!query) return { ok: false, error: "query required" };
    if (query.length < 2) return { ok: false, error: "query too short (min 2 chars)" };
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 20));
    const arr = s.searchIdx.get(userId) || [];
    const terms = query.split(/\s+/).filter(Boolean);
    const fromSender = params.sender ? String(params.sender).toLowerCase() : null;
    const sinceMs = params.since ? new Date(String(params.since)).getTime() : null;
    const hits = [];
    for (const m of arr) {
      if (fromSender && !m.sender.toLowerCase().includes(fromSender)) continue;
      if (sinceMs && new Date(m.ts).getTime() < sinceMs) continue;
      const body = m.body.toLowerCase();
      let score = 0;
      for (const t of terms) if (body.includes(t)) score++;
      if (score === terms.length) {
        hits.push({ ...m, score });
      }
    }
    hits.sort((a, b) => b.score - a.score || new Date(b.ts).getTime() - new Date(a.ts).getTime());
    return { ok: true, result: { hits: hits.slice(0, limit), totalMatched: hits.length, totalIndexed: arr.length } };
  });

  // ── Reactions ──

  registerLensAction("message", "react", (ctx, _artifact, params = {}) => {
    const s = getMessageState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const messageId = String(params.messageId || "");
    if (!messageId) return { ok: false, error: "messageId required" };
    const emoji = String(params.emoji || "");
    if (!emoji) return { ok: false, error: "emoji required" };
    if (emoji.length > 16) return { ok: false, error: "emoji too long" };
    if (!s.reactions.has(userId)) s.reactions.set(userId, new Map());
    const userMap = s.reactions.get(userId);
    if (!userMap.has(messageId)) userMap.set(messageId, new Map());
    const reactMap = userMap.get(messageId);
    reactMap.set(emoji, (reactMap.get(emoji) || 0) + 1);
    saveMessageState();
    return { ok: true, result: { messageId, emoji, count: reactMap.get(emoji) } };
  });

  registerLensAction("message", "unreact", (ctx, _artifact, params = {}) => {
    const s = getMessageState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const messageId = String(params.messageId || "");
    if (!messageId) return { ok: false, error: "messageId required" };
    const emoji = String(params.emoji || "");
    if (!emoji) return { ok: false, error: "emoji required" };
    const userMap = s.reactions.get(userId);
    if (!userMap || !userMap.has(messageId)) return { ok: false, error: "no reactions on message" };
    const reactMap = userMap.get(messageId);
    if (!reactMap.has(emoji)) return { ok: false, error: "emoji not reacted" };
    const next = reactMap.get(emoji) - 1;
    if (next <= 0) reactMap.delete(emoji);
    else reactMap.set(emoji, next);
    saveMessageState();
    return { ok: true, result: { messageId, emoji, count: reactMap.get(emoji) || 0 } };
  });

  registerLensAction("message", "reactions-for", (ctx, _artifact, params = {}) => {
    const s = getMessageState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const messageId = String(params.messageId || "");
    if (!messageId) return { ok: false, error: "messageId required" };
    const userMap = s.reactions.get(userId);
    if (!userMap || !userMap.has(messageId)) return { ok: true, result: { messageId, reactions: {} } };
    const reactMap = userMap.get(messageId);
    const reactions = Object.fromEntries(reactMap);
    return { ok: true, result: { messageId, reactions } };
  });

  // ── Voice note metadata registry ──

  registerLensAction("message", "voice-register", (ctx, _artifact, params = {}) => {
    const s = getMessageState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const messageId = String(params.messageId || "");
    if (!messageId) return { ok: false, error: "messageId required" };
    const durationMs = Number(params.durationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) return { ok: false, error: "durationMs > 0 required" };
    if (durationMs > 600_000) return { ok: false, error: "duration max 10 minutes" };
    const meta = {
      messageId,
      durationMs,
      transcript: String(params.transcript || "").slice(0, 4000),
      registeredAt: nowIsoMsg(),
    };
    if (!s.voice.has(userId)) s.voice.set(userId, new Map());
    s.voice.get(userId).set(messageId, meta);
    saveMessageState();
    return { ok: true, result: { meta } };
  });

  registerLensAction("message", "voice-list", (ctx, _artifact, _params = {}) => {
    const s = getMessageState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const map = s.voice.get(userId);
    if (!map) return { ok: true, result: { voices: [] } };
    const voices = Array.from(map.values())
      .sort((a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime());
    return { ok: true, result: { voices } };
  });
}
