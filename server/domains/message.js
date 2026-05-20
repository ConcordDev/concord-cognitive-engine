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
    const s = STATE.messageLens;
    // 2026 parity backfills — append-only.
    if (!s.channels)       s.channels       = new Map();
    if (!s.channelMembers) s.channelMembers = new Map();
    if (!s.messages)       s.messages       = new Map();
    if (!s.threads)        s.threads        = new Map();
    if (!s.labels)         s.labels         = new Map();
    if (!s.messageLabels)  s.messageLabels  = new Map();
    if (!s.snoozed)        s.snoozed        = new Map();
    if (!s.scheduled)      s.scheduled      = new Map();
    if (!s.readState)      s.readState      = new Map();
    if (!s.mentions)       s.mentions       = new Map();
    if (!s.seq)            s.seq            = new Map();
    if (!s.pins)           s.pins           = new Map();
    if (!s.bookmarks)      s.bookmarks      = new Map();
    if (!s.status)         s.status         = new Map();
    return s;
  }
  function saveMessageState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function msgActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextMsgId(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function nowIsoMsg() { return new Date().toISOString(); }

  // Multi-device sync: emit to the per-user room so a star/react/voice
  // on one device flips instantly on every other device the user has
  // open. The DM substrate already broadcasts the messages themselves;
  // this is purely the lens-scoped layer (saves / reactions / voice).
  function emitToUserRoom(userId, name, payload) {
    const REALTIME = globalThis._concordREALTIME;
    try {
      REALTIME?.io?.to(`user:${userId}`).emit(name, { userId, ...payload, ts: Date.now() });
    } catch (_e) { /* best effort */ }
  }

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
    emitToUserRoom(userId, "message:saved", { messageId, threadId, entry });
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
    emitToUserRoom(userId, "message:unsaved", { messageId });
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
    const count = reactMap.get(emoji);
    emitToUserRoom(userId, "message:reacted", { messageId, emoji, count });
    return { ok: true, result: { messageId, emoji, count } };
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
    const count = reactMap.get(emoji) || 0;
    emitToUserRoom(userId, "message:reacted", { messageId, emoji, count });
    return { ok: true, result: { messageId, emoji, count } };
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
    emitToUserRoom(userId, "message:voice-registered", { messageId, durationMs });
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

  // ═══════════════════════════════════════════════════════════════
  //  Slack / Gmail 2026 parity — channels, DMs, threads, mentions,
  //  labels, snooze, schedule-send, AI summary / smart reply / action items.
  // ═══════════════════════════════════════════════════════════════

  function ensureSeqM(s, userId) {
    if (!s.seq.has(userId)) s.seq.set(userId, { ch: 1, msg: 1, lbl: 1, sched: 1 });
    const seq = s.seq.get(userId);
    for (const k of ['ch','msg','lbl','sched']) if (!Number.isFinite(seq[k])) seq[k] = 1;
    return seq;
  }
  function listB(map, k) { if (!map.has(k)) map.set(k, []); return map.get(k); }
  function mapB(map, k) { if (!map.has(k)) map.set(k, new Map()); return map.get(k); }

  // ── Channels ──────────────────────────────────────────────────

  registerLensAction("message", "channels-list", (ctx, _a, _p = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const list = listB(s.channels, userId);
    if (list.length === 0) {
      // Seed a default workspace so the lens has something to show on first open.
      const seq = ensureSeqM(s, userId);
      const general = { id: nextMsgId('ch'), number: `C-${String(seq.ch).padStart(4, '0')}`, name: 'general', kind: 'channel', isPrivate: false, topic: 'Default workspace channel', createdAt: nowIsoMsg() };
      seq.ch++;
      const random = { id: nextMsgId('ch'), number: `C-${String(seq.ch).padStart(4, '0')}`, name: 'random', kind: 'channel', isPrivate: false, topic: 'Anything goes', createdAt: nowIsoMsg() };
      seq.ch++;
      list.push(general, random);
      saveMessageState();
    }
    // Compute unread count per channel
    const reads = mapB(s.readState, userId);
    const enriched = list.map(c => {
      const msgs = listB(mapB(s.messages, userId), c.id);
      const lastRead = reads.get(c.id) || 0;
      const unread = msgs.filter(m => new Date(m.ts).getTime() > lastRead && m.senderId !== userId).length;
      const lastMsg = msgs[msgs.length - 1] || null;
      return { ...c, unread, lastTs: lastMsg?.ts || null, lastPreview: lastMsg?.body?.slice(0, 80) || '' };
    });
    return { ok: true, result: { channels: enriched.sort((a, b) => (b.lastTs || '').localeCompare(a.lastTs || '')) } };
  });

  registerLensAction("message", "channels-create", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const name = String(params.name || "").trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) return { ok: false, error: "name required" };
    const kind = ['channel','dm','group_dm'].includes(params.kind) ? params.kind : 'channel';
    const list = listB(s.channels, userId);
    if (list.some(c => c.name === name && c.kind === kind)) return { ok: false, error: "channel name already exists" };
    const seq = ensureSeqM(s, userId);
    const ch = {
      id: nextMsgId('ch'),
      number: `C-${String(seq.ch).padStart(4, '0')}`,
      name,
      kind,
      isPrivate: Boolean(params.isPrivate),
      topic: String(params.topic || ""),
      participants: Array.isArray(params.participants) ? params.participants.map(String) : [],
      createdAt: nowIsoMsg(),
    };
    seq.ch++;
    list.push(ch);
    saveMessageState();
    return { ok: true, result: { channel: ch } };
  });

  registerLensAction("message", "channels-archive", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listB(s.channels, msgActor(ctx));
    const c = list.find(x => x.id === String(params.id || ""));
    if (!c) return { ok: false, error: "channel not found" };
    c.archived = true;
    c.archivedAt = nowIsoMsg();
    saveMessageState();
    return { ok: true, result: { channel: c } };
  });

  // ── Messages (per-channel) ────────────────────────────────────

  registerLensAction("message", "messages-list", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const channelId = String(params.channelId || "");
    if (!channelId) return { ok: false, error: "channelId required" };
    const limit = Math.max(1, Math.min(500, Number(params.limit) || 100));
    const before = params.before ? String(params.before) : null;
    const all = listB(mapB(s.messages, userId), channelId);
    let scoped = all;
    if (before) scoped = scoped.filter(m => m.ts < before);
    const slice = scoped.slice(-limit);
    return { ok: true, result: { messages: slice, hasMore: scoped.length > limit, total: all.length } };
  });

  registerLensAction("message", "messages-send", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const channelId = String(params.channelId || "");
    const body = String(params.body || "").trim();
    if (!channelId || !body) return { ok: false, error: "channelId + body required" };
    const channel = listB(s.channels, userId).find(c => c.id === channelId);
    if (!channel) return { ok: false, error: "channel not found" };
    const seq = ensureSeqM(s, userId);
    const msg = {
      id: nextMsgId('msg'),
      number: `M-${String(seq.msg).padStart(6, '0')}`,
      channelId,
      senderId: userId,
      senderName: String(params.senderName || ctx?.actor?.displayName || userId),
      body,
      ts: nowIsoMsg(),
      edited: false,
      threadCount: 0,
      attachments: Array.isArray(params.attachments) ? params.attachments : [],
    };
    seq.msg++;
    // Extract @mentions for the activity feed.
    const mentions = Array.from(new Set((body.match(/@([\w-]+)/g) || []).map(m => m.slice(1))));
    if (mentions.length > 0) {
      msg.mentions = mentions;
      for (const target of mentions) {
        const mentionList = listB(s.mentions, target);
        mentionList.push({ messageId: msg.id, channelId, senderId: userId, body, ts: msg.ts });
      }
    }
    const msgs = listB(mapB(s.messages, userId), channelId);
    msgs.push(msg);
    // Author auto-reads their own message
    mapB(s.readState, userId).set(channelId, new Date(msg.ts).getTime());
    emitToUserRoom(userId, 'message:new', { channelId, messageId: msg.id });
    saveMessageState();
    return { ok: true, result: { message: msg, mentionsFanout: mentions.length } };
  });

  registerLensAction("message", "messages-edit", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const channelId = String(params.channelId || "");
    const id = String(params.id || "");
    const newBody = String(params.body || "").trim();
    if (!channelId || !id || !newBody) return { ok: false, error: "channelId + id + body required" };
    const msgs = listB(mapB(s.messages, userId), channelId);
    const m = msgs.find(x => x.id === id);
    if (!m) return { ok: false, error: "message not found" };
    if (m.senderId !== userId) return { ok: false, error: "only sender can edit" };
    m.body = newBody;
    m.edited = true;
    m.editedAt = nowIsoMsg();
    saveMessageState();
    return { ok: true, result: { message: m } };
  });

  registerLensAction("message", "messages-delete", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const channelId = String(params.channelId || "");
    const id = String(params.id || "");
    const msgs = listB(mapB(s.messages, userId), channelId);
    const i = msgs.findIndex(x => x.id === id);
    if (i < 0) return { ok: false, error: "message not found" };
    if (msgs[i].senderId !== userId) return { ok: false, error: "only sender can delete" };
    msgs.splice(i, 1);
    saveMessageState();
    return { ok: true, result: { deleted: true } };
  });

  registerLensAction("message", "messages-mark-read", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const channelId = String(params.channelId || "");
    if (!channelId) return { ok: false, error: "channelId required" };
    const upTo = params.upToTs ? new Date(params.upToTs).getTime() : Date.now();
    mapB(s.readState, userId).set(channelId, upTo);
    saveMessageState();
    return { ok: true, result: { channelId, lastReadTs: upTo } };
  });

  // ── Threads ───────────────────────────────────────────────────

  registerLensAction("message", "thread-reply", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const channelId = String(params.channelId || "");
    const rootId = String(params.rootId || "");
    const body = String(params.body || "").trim();
    if (!channelId || !rootId || !body) return { ok: false, error: "channelId + rootId + body required" };
    const root = listB(mapB(s.messages, userId), channelId).find(x => x.id === rootId);
    if (!root) return { ok: false, error: "root message not found" };
    const seq = ensureSeqM(s, userId);
    const reply = {
      id: nextMsgId('msg'),
      number: `M-${String(seq.msg).padStart(6, '0')}`,
      rootId, channelId,
      senderId: userId,
      senderName: String(params.senderName || ctx?.actor?.displayName || userId),
      body,
      ts: nowIsoMsg(),
    };
    seq.msg++;
    const list = listB(mapB(s.threads, userId), rootId);
    list.push(reply);
    root.threadCount = list.length;
    saveMessageState();
    return { ok: true, result: { reply, threadCount: root.threadCount } };
  });

  registerLensAction("message", "thread-list", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const rootId = String(params.rootId || "");
    const replies = listB(mapB(s.threads, userId), rootId);
    return { ok: true, result: { replies } };
  });

  // ── Mentions / Activity feed ─────────────────────────────────

  registerLensAction("message", "activity-feed", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    // The 'mentions' bucket key is the username (extracted from @mention) — fall back to userId here.
    const handle = String(params.handle || ctx?.actor?.handle || userId);
    const limit = Math.max(1, Math.min(200, Number(params.limit) || 50));
    const list = listB(s.mentions, handle).slice(-limit).reverse();
    return { ok: true, result: { mentions: list, handle } };
  });

  // ── Labels (Gmail-style) ──────────────────────────────────────

  registerLensAction("message", "labels-list", (ctx, _a, _p = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { labels: listB(s.labels, msgActor(ctx)) } };
  });

  registerLensAction("message", "labels-create", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const list = listB(s.labels, userId);
    if (list.some(l => l.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: "label exists" };
    const seq = ensureSeqM(s, userId);
    const lbl = { id: nextMsgId('lbl'), number: `L-${String(seq.lbl).padStart(4, '0')}`, name, color: String(params.color || '#06b6d4'), createdAt: nowIsoMsg() };
    seq.lbl++;
    list.push(lbl);
    saveMessageState();
    return { ok: true, result: { label: lbl } };
  });

  registerLensAction("message", "labels-apply", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const messageId = String(params.messageId || "");
    const labelId = String(params.labelId || "");
    if (!messageId || !labelId) return { ok: false, error: "messageId + labelId required" };
    const labelMap = mapB(s.messageLabels, userId);
    if (!labelMap.has(messageId)) labelMap.set(messageId, new Set());
    labelMap.get(messageId).add(labelId);
    saveMessageState();
    return { ok: true, result: { messageId, labels: Array.from(labelMap.get(messageId)) } };
  });

  registerLensAction("message", "labels-remove", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const labelMap = mapB(s.messageLabels, userId);
    const set = labelMap.get(String(params.messageId || ""));
    if (!set) return { ok: false, error: "no labels for message" };
    set.delete(String(params.labelId || ""));
    saveMessageState();
    return { ok: true, result: { labels: Array.from(set) } };
  });

  registerLensAction("message", "labels-for-message", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const set = mapB(s.messageLabels, userId).get(String(params.messageId || "")) || new Set();
    const labels = listB(s.labels, userId).filter(l => set.has(l.id));
    return { ok: true, result: { labels } };
  });

  // ── Snooze / unsnooze ────────────────────────────────────────

  registerLensAction("message", "snooze", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const messageId = String(params.messageId || "");
    const until = String(params.until || "");
    if (!messageId || !until) return { ok: false, error: "messageId + until (ISO date) required" };
    if (isNaN(new Date(until).getTime())) return { ok: false, error: "until must be a valid ISO timestamp" };
    const list = listB(s.snoozed, userId);
    list.push({ messageId, until, snoozedAt: nowIsoMsg() });
    saveMessageState();
    return { ok: true, result: { messageId, until } };
  });

  registerLensAction("message", "snooze-list", (ctx, _a, _p = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const now = Date.now();
    const list = listB(s.snoozed, userId);
    const active = list.filter(x => new Date(x.until).getTime() > now);
    return { ok: true, result: { snoozed: active.sort((a, b) => a.until.localeCompare(b.until)) } };
  });

  registerLensAction("message", "unsnooze", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const list = listB(s.snoozed, userId);
    const i = list.findIndex(x => x.messageId === String(params.messageId || ""));
    if (i < 0) return { ok: false, error: "not snoozed" };
    list.splice(i, 1);
    saveMessageState();
    return { ok: true, result: { unsnoozed: true } };
  });

  // ── Schedule send (compose now → deliver later) ──────────────

  registerLensAction("message", "schedule-send", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const channelId = String(params.channelId || "");
    const body = String(params.body || "").trim();
    const sendAt = String(params.sendAt || "");
    if (!channelId || !body || !sendAt) return { ok: false, error: "channelId + body + sendAt required" };
    if (isNaN(new Date(sendAt).getTime())) return { ok: false, error: "sendAt must be a valid ISO timestamp" };
    if (new Date(sendAt).getTime() <= Date.now()) return { ok: false, error: "sendAt must be in the future" };
    const seq = ensureSeqM(s, userId);
    const item = {
      id: nextMsgId('sched'),
      number: `S-${String(seq.sched).padStart(4, '0')}`,
      channelId,
      body,
      sendAt,
      createdAt: nowIsoMsg(),
      sent: false,
    };
    seq.sched++;
    listB(s.scheduled, userId).push(item);
    saveMessageState();
    return { ok: true, result: { scheduled: item } };
  });

  registerLensAction("message", "schedule-list", (ctx, _a, _p = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const list = listB(s.scheduled, userId).filter(x => !x.sent);
    return { ok: true, result: { scheduled: list.slice().sort((a, b) => a.sendAt.localeCompare(b.sendAt)) } };
  });

  registerLensAction("message", "schedule-cancel", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listB(s.scheduled, msgActor(ctx));
    const i = list.findIndex(x => x.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "scheduled item not found" };
    list.splice(i, 1);
    saveMessageState();
    return { ok: true, result: { cancelled: true } };
  });

  // Flush due scheduled sends — call this on demand or wire to a heartbeat.
  registerLensAction("message", "schedule-flush-due", (ctx, _a, _p = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const list = listB(s.scheduled, userId);
    const now = Date.now();
    const due = list.filter(x => !x.sent && new Date(x.sendAt).getTime() <= now);
    const sent = [];
    for (const item of due) {
      const seq = ensureSeqM(s, userId);
      const msg = {
        id: nextMsgId('msg'),
        number: `M-${String(seq.msg).padStart(6, '0')}`,
        channelId: item.channelId,
        senderId: userId,
        senderName: ctx?.actor?.displayName || userId,
        body: item.body,
        ts: nowIsoMsg(),
        edited: false,
        threadCount: 0,
        scheduledFrom: item.id,
      };
      seq.msg++;
      listB(mapB(s.messages, userId), item.channelId).push(msg);
      item.sent = true;
      item.sentAt = nowIsoMsg();
      sent.push(msg);
    }
    if (sent.length > 0) saveMessageState();
    return { ok: true, result: { sentCount: sent.length, sent } };
  });

  // ── AI 2026 features ──────────────────────────────────────────

  registerLensAction("message", "ai-summarize-channel", async (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const channelId = String(params.channelId || "");
    if (!channelId) return { ok: false, error: "channelId required" };
    const msgs = listB(mapB(s.messages, userId), channelId);
    if (msgs.length === 0) return { ok: true, result: { summary: "(channel has no messages)", source: 'deterministic', messageCount: 0 } };
    const limit = Math.max(1, Math.min(200, Number(params.limit) || 50));
    const recent = msgs.slice(-limit);
    const participants = Array.from(new Set(recent.map(m => m.senderName)));
    const deterministic = `Last ${recent.length} messages from ${participants.length} participant(s): ${participants.slice(0, 5).join(', ')}${participants.length > 5 ? '…' : ''}. Most recent: "${recent[recent.length - 1].body.slice(0, 200)}".`;
    const brain = ctx?.llm?.chat;
    if (typeof brain !== 'function') return { ok: true, result: { summary: deterministic, source: 'deterministic', messageCount: recent.length } };
    try {
      const transcript = recent.map(m => `${m.senderName}: ${m.body}`).join('\n');
      const r = await brain({
        messages: [
          { role: 'system', content: "Summarize this team chat in 2-4 short sentences. Focus on decisions made, action items, and blockers. Use only facts from the transcript." },
          { role: 'user', content: transcript.slice(0, 8000) },
        ],
        temperature: 0.2, maxTokens: 500,
      });
      const summary = String(r?.content || r?.text || '').trim() || deterministic;
      return { ok: true, result: { summary, source: 'brain', messageCount: recent.length } };
    } catch (e) {
      return { ok: true, result: { summary: deterministic, source: 'deterministic_after_brain_error', error: String(e), messageCount: recent.length } };
    }
  });

  registerLensAction("message", "ai-smart-reply", async (ctx, _a, params = {}) => {
    const lastMessage = String(params.lastMessage || "").trim();
    if (!lastMessage) return { ok: false, error: "lastMessage required" };
    function deterministic() {
      const lower = lastMessage.toLowerCase();
      if (/\?$/.test(lastMessage)) return ["Let me check and get back to you.", "Yes — here's what I found:", "Good question, I'll look into it."];
      if (/thanks|appreciate/.test(lower)) return ["You're welcome!", "Anytime.", "Happy to help."];
      if (/sorry|apolog/.test(lower)) return ["No worries.", "All good — thanks for letting me know.", "Appreciate the heads up."];
      if (/can you|could you|please/.test(lower)) return ["Sure, on it.", "Yes, will do.", "Can do — by when?"];
      return ["Got it.", "Thanks for the update.", "Acknowledged."];
    }
    const brain = ctx?.llm?.chat;
    if (typeof brain !== 'function') return { ok: true, result: { suggestions: deterministic(), source: 'deterministic' } };
    try {
      const r = await brain({
        messages: [
          { role: 'system', content: "Suggest 3 concise reply options (each ≤ 12 words) for the message. Output ONLY JSON: {\"suggestions\":[\"...\",\"...\",\"...\"]}. Vary tone." },
          { role: 'user', content: lastMessage },
        ],
        temperature: 0.4, maxTokens: 400,
      });
      const text = String(r?.content || r?.text || '').trim();
      const parsed = JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0]);
      const sug = Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String).slice(0, 3) : deterministic();
      return { ok: true, result: { suggestions: sug, source: sug.length === 3 ? 'brain' : 'deterministic_brain_unparseable' } };
    } catch (_e) {
      return { ok: true, result: { suggestions: deterministic(), source: 'deterministic_after_brain_error' } };
    }
  });

  registerLensAction("message", "ai-action-items", async (ctx, _a, params = {}) => {
    const text = String(params.text || "").trim();
    if (text.length < 30) return { ok: false, error: "text too short" };
    // Deterministic extract: sentences containing imperative verbs / "needs to" / "should" / "by [date]" / etc.
    const sentences = text.split(/(?<=[.!?])\s+/);
    const actionish = sentences.filter(s => /\b(need|should|must|todo|to do|will|going to|please|by (Mon|Tues|Wed|Thurs|Fri|Sat|Sun)|by next|deadline|owns?\s+|assign|action item)\b/i.test(s));
    const items = actionish.slice(0, 10).map((s, i) => ({
      id: `ai_${Date.now()}_${i}`,
      text: s.trim(),
      owner: (s.match(/@(\w+)/) || [, ''])[1] || null,
      due: (s.match(/by ([A-Z][a-z]+(?:day)?|\d{4}-\d{2}-\d{2})/) || [, ''])[1] || null,
    }));
    const brain = ctx?.llm?.chat;
    if (typeof brain !== 'function' || items.length >= 3) {
      return { ok: true, result: { actionItems: items, source: 'deterministic', count: items.length } };
    }
    try {
      const r = await brain({
        messages: [
          { role: 'system', content: "Extract action items from this conversation. Output ONLY JSON: {\"items\":[{\"text\":\"...\",\"owner\":\"@name or null\",\"due\":\"YYYY-MM-DD or null\"}]}. Use only facts from the text — never invent owners or deadlines." },
          { role: 'user', content: text.slice(0, 8000) },
        ],
        temperature: 0.2, maxTokens: 800,
      });
      const out = String(r?.content || r?.text || '').trim();
      const parsed = JSON.parse((out.match(/\{[\s\S]*\}/) || ['{}'])[0]);
      const bi = Array.isArray(parsed.items) ? parsed.items.slice(0, 10).map((x, i) => ({ id: `ai_b_${Date.now()}_${i}`, text: String(x.text || ''), owner: x.owner || null, due: x.due || null })) : items;
      return { ok: true, result: { actionItems: bi, source: 'brain', count: bi.length } };
    } catch (_e) {
      return { ok: true, result: { actionItems: items, source: 'deterministic_after_brain_error', count: items.length } };
    }
  });

  // Natural-language inbox search.
  registerLensAction("message", "ai-search-messages", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const q = String(params.query || "").trim().toLowerCase();
    if (!q) return { ok: false, error: "query required" };
    const allChannels = listB(s.channels, userId);
    const allMessages = mapB(s.messages, userId);
    const hits = [];
    for (const ch of allChannels) {
      const msgs = listB(allMessages, ch.id);
      for (const m of msgs) {
        if (m.body.toLowerCase().includes(q) || (m.senderName || '').toLowerCase().includes(q)) {
          hits.push({ channelId: ch.id, channelName: ch.name, ...m });
          if (hits.length >= 50) break;
        }
      }
      if (hits.length >= 50) break;
    }
    hits.sort((a, b) => b.ts.localeCompare(a.ts));
    return { ok: true, result: { query: q, hits, count: hits.length } };
  });

  // ── Inbox / dashboard summary ────────────────────────────────

  registerLensAction("message", "inbox-summary", (ctx, _a, _p = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const channels = listB(s.channels, userId);
    const messagesMap = mapB(s.messages, userId);
    const reads = mapB(s.readState, userId);
    let totalUnread = 0;
    let channelsWithUnread = 0;
    for (const c of channels) {
      const msgs = listB(messagesMap, c.id);
      const lastRead = reads.get(c.id) || 0;
      const u = msgs.filter(m => new Date(m.ts).getTime() > lastRead && m.senderId !== userId).length;
      if (u > 0) channelsWithUnread++;
      totalUnread += u;
    }
    const mentionCount = listB(s.mentions, ctx?.actor?.handle || userId).length;
    const scheduledCount = listB(s.scheduled, userId).filter(x => !x.sent).length;
    const snoozedCount = listB(s.snoozed, userId).filter(x => new Date(x.until).getTime() > Date.now()).length;
    return {
      ok: true,
      result: {
        channelCount: channels.length,
        totalUnread,
        channelsWithUnread,
        mentionCount,
        scheduledCount,
        snoozedCount,
      },
    };
  });

  // ── Pinned messages (Slack-shape, channel-scoped) ──────────────
  registerLensAction("message", "pin-message", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const channelId = String(params.channelId || "");
    const messageId = String(params.messageId || "");
    if (!channelId || !messageId) return { ok: false, error: "channelId + messageId required" };
    const channel = listB(s.channels, userId).find(c => c.id === channelId);
    if (!channel) return { ok: false, error: "channel not found" };
    const msg = listB(mapB(s.messages, userId), channelId).find(m => m.id === messageId);
    if (!msg) return { ok: false, error: "message not found" };
    const pins = listB(mapB(s.pins, userId), channelId);
    if (pins.some(p => p.messageId === messageId)) return { ok: false, error: "already pinned" };
    const pin = { messageId, body: msg.body, senderName: msg.senderName, pinnedBy: userId, pinnedAt: nowIsoMsg() };
    pins.push(pin);
    msg.pinned = true;
    saveMessageState();
    return { ok: true, result: { pin, pinCount: pins.length } };
  });

  registerLensAction("message", "unpin-message", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const channelId = String(params.channelId || "");
    const messageId = String(params.messageId || "");
    const pins = listB(mapB(s.pins, userId), channelId);
    const i = pins.findIndex(p => p.messageId === messageId);
    if (i < 0) return { ok: false, error: "not pinned" };
    pins.splice(i, 1);
    const msg = listB(mapB(s.messages, userId), channelId).find(m => m.id === messageId);
    if (msg) msg.pinned = false;
    saveMessageState();
    return { ok: true, result: { unpinned: messageId, pinCount: pins.length } };
  });

  registerLensAction("message", "pins-list", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const channelId = String(params.channelId || "");
    if (!channelId) return { ok: false, error: "channelId required" };
    const pins = listB(mapB(s.pins, userId), channelId);
    return { ok: true, result: { pins, count: pins.length } };
  });

  // ── Channel bookmarks ──────────────────────────────────────────
  registerLensAction("message", "bookmark-add", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const channelId = String(params.channelId || "");
    const title = String(params.title || "").trim().slice(0, 120);
    if (!channelId || !title) return { ok: false, error: "channelId + title required" };
    const channel = listB(s.channels, userId).find(c => c.id === channelId);
    if (!channel) return { ok: false, error: "channel not found" };
    const bookmarks = listB(mapB(s.bookmarks, userId), channelId);
    const bm = {
      id: nextMsgId('bm'),
      title,
      url: String(params.url || "").trim().slice(0, 500),
      emoji: String(params.emoji || "🔖").slice(0, 8),
      addedBy: userId,
      addedAt: nowIsoMsg(),
    };
    bookmarks.push(bm);
    saveMessageState();
    return { ok: true, result: { bookmark: bm, count: bookmarks.length } };
  });

  registerLensAction("message", "bookmark-list", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const channelId = String(params.channelId || "");
    if (!channelId) return { ok: false, error: "channelId required" };
    const bookmarks = listB(mapB(s.bookmarks, userId), channelId);
    return { ok: true, result: { bookmarks, count: bookmarks.length } };
  });

  registerLensAction("message", "bookmark-remove", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const channelId = String(params.channelId || "");
    const id = String(params.id || "");
    const bookmarks = listB(mapB(s.bookmarks, userId), channelId);
    const i = bookmarks.findIndex(b => b.id === id);
    if (i < 0) return { ok: false, error: "bookmark not found" };
    bookmarks.splice(i, 1);
    saveMessageState();
    return { ok: true, result: { removed: id, count: bookmarks.length } };
  });

  // ── Status & presence (Slack-shape) ────────────────────────────
  registerLensAction("message", "status-set", (ctx, _a, params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const presence = ['active', 'away', 'dnd'].includes(params.presence) ? params.presence : 'active';
    const durationMin = Number(params.durationMin) || 0;
    const status = {
      emoji: String(params.emoji || "").slice(0, 8),
      text: String(params.text || "").trim().slice(0, 100),
      presence,
      expiresAt: durationMin > 0 ? new Date(Date.now() + durationMin * 60000).toISOString() : null,
      setAt: nowIsoMsg(),
    };
    s.status.set(userId, status);
    saveMessageState();
    return { ok: true, result: { status } };
  });

  registerLensAction("message", "status-get", (ctx, _a, _params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = msgActor(ctx);
    const blank = { emoji: "", text: "", presence: "active", expiresAt: null };
    const status = s.status.get(userId);
    if (!status) return { ok: true, result: { status: blank } };
    if (status.expiresAt && new Date(status.expiresAt).getTime() <= Date.now()) {
      s.status.delete(userId);
      return { ok: true, result: { status: blank, expired: true } };
    }
    return { ok: true, result: { status } };
  });

  registerLensAction("message", "status-clear", (ctx, _a, _params = {}) => {
    const s = getMessageState(); if (!s) return { ok: false, error: "STATE unavailable" };
    s.status.delete(msgActor(ctx));
    saveMessageState();
    return { ok: true, result: { cleared: true } };
  });
}
