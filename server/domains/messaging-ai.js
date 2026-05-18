// server/domains/messaging-ai.js
//
// Message lens Sprint B items #11-#15:
//   summarize_thread      — utility brain → { summary, action_items, decisions, themes }
//   suggested_replies     — subconscious brain → N short reply candidates
//   compose_in_my_voice   — utility brain w/ user's last 50 outgoing as style anchors
//   triage_inbox          — subconscious brain + heuristics → { priority/normal/low/newsletter/spam }
//   translate             — utility brain → translated text (cached per message+lang)
//
// All real brain calls with deterministic fallbacks so the macros stay
// useful when Ollama is unavailable (UI labels the source).

import { listMessages, hasRole, getMessage } from "../lib/messaging/persistence.js";

const TIMEOUT_MS = 18_000;
const TRANSLATE_CACHE = new Map(); // (messageId|lang) → { text, ts } (in-memory; fine for hot path)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function _withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout_${ms}ms`)), ms))]);
}

function _stripFences(s) {
  const m = String(s || "").match(/```(?:\w+)?\n([\s\S]*?)```/);
  return m ? m[1] : s;
}

function _extractJsonObject(raw) {
  const stripped = _stripFences(raw).trim();
  try { const v = JSON.parse(stripped); if (v && typeof v === "object") return v; } catch { /* try regex */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

function _extractJsonArray(raw) {
  const stripped = _stripFences(raw).trim();
  try { const v = JSON.parse(stripped); if (Array.isArray(v)) return v; } catch { /* try regex */ }
  const m = stripped.match(/\[[\s\S]*\]/);
  if (m) { try { const v = JSON.parse(m[0]); if (Array.isArray(v)) return v; } catch { return null; } }
  return null;
}

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

// Heuristic-only triage. Used as deterministic fallback AND as a
// pre-filter before the LLM (LLM only sees ambiguous messages).
function _heuristicTriage({ body, mentions, callerId, hasAttachments }) {
  const b = String(body || "").toLowerCase();
  const len = b.length;
  if (mentions && mentions.includes(callerId)) return "priority";
  if (/\b(urgent|asap|now|critical|down|outage|escalat|sev[\- ]?[12])\b/.test(b)) return "priority";
  if (/\b(unsubscribe|newsletter|digest|view in browser|opt out)\b/.test(b)) return "newsletter";
  if (/\b(viagra|crypto\s+giveaway|free\s+gift|click\s+here|earn\s+\$|nigerian)\b/.test(b)) return "spam";
  if (len < 40 && /^(thx|thanks|ok|cool|lol|nice|👍|🙏|🚀)\b/i.test(body || "")) return "low";
  if (hasAttachments) return "normal";
  return "normal";
}

export default function registerMessagingAiMacros(register) {
  register("messaging", "summarize_thread", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const conversationId = String(input.conversationId || "");
    if (!conversationId) return { ok: false, reason: "conversationId_required" };
    if (!hasRole(db, conversationId, userId, "guest")) return { ok: false, reason: "forbidden" };
    const sinceServerTs = input.sinceServerTs ? Number(input.sinceServerTs) : null;
    // Gather messages — cap at 200, 1000 chars each to keep tokens bounded.
    const all = listMessages(db, conversationId, { limit: 500 });
    const filtered = sinceServerTs ? all.filter((m) => m.server_ts > sinceServerTs) : all;
    if (filtered.length === 0) return { ok: false, reason: "no_messages" };
    const items = filtered.slice(0, 200).map((m) => ({
      author: m.author_id, body: String(m.body || "").slice(0, 1000),
    }));
    const llm = ctx?.llm;
    if (!llm?.chat) {
      return {
        ok: true,
        summary: `${items.length} messages from ${new Set(items.map((m) => m.author)).size} participant(s); LLM offline.`,
        action_items: [], decisions: [], themes: [],
        source: "deterministic_fallback",
      };
    }
    const sys = `You are summarising a chat thread. Respond ONLY with JSON:
{
  "summary": "1-3 sentence prose summary",
  "action_items": ["short imperative actions", ...up to 10],
  "decisions": ["decisions the team made", ...up to 10],
  "themes": ["theme", ...up to 5]
}`;
    const user = `Thread (${items.length} messages):\n${items.map((m, i) => `${i + 1}. [${m.author}] ${m.body}`).join("\n")}`;
    try {
      const r = await _withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        temperature: 0.3, maxTokens: 1200, slot: "utility",
      }), TIMEOUT_MS);
      const raw = String(r?.text || r?.content || r?.message?.content || "");
      const obj = _extractJsonObject(raw);
      if (obj && typeof obj === "object") {
        return {
          ok: true,
          summary: String(obj.summary || "").slice(0, 1500),
          action_items: Array.isArray(obj.action_items) ? obj.action_items.slice(0, 10).map((s) => String(s).slice(0, 200)) : [],
          decisions: Array.isArray(obj.decisions) ? obj.decisions.slice(0, 10).map((s) => String(s).slice(0, 200)) : [],
          themes: Array.isArray(obj.themes) ? obj.themes.slice(0, 5).map((s) => String(s).slice(0, 100)) : [],
          messageCount: items.length,
          source: "llm",
        };
      }
      return { ok: false, reason: "parse_failed", raw: raw.slice(0, 300) };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Summarise a thread (sinceServerTs optional for catch-up); returns summary + action items + decisions + themes" });

  register("messaging", "suggested_replies", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const conversationId = String(input.conversationId || "");
    if (!conversationId) return { ok: false, reason: "conversationId_required" };
    if (!hasRole(db, conversationId, userId, "guest")) return { ok: false, reason: "forbidden" };
    const count = Math.min(5, Math.max(1, Number(input.count) || 3));
    // Use the last 10 messages as context.
    const recent = listMessages(db, conversationId, { limit: 10 });
    if (recent.length === 0) return { ok: false, reason: "no_messages" };
    const llm = ctx?.llm;
    if (!llm?.chat) {
      return {
        ok: true,
        replies: ["Got it", "Thanks", "I'll look into this"].slice(0, count),
        source: "deterministic_fallback",
      };
    }
    const sys = `You are suggesting ${count} short reply candidates. Respond ONLY with a JSON array of strings. Each reply ≤ 120 chars, casual, distinct in tone (e.g. acknowledge / ask for detail / commit / decline).`;
    const user = `Recent thread:\n${recent.map((m) => `[${m.author_id === userId ? "ME" : m.author_id}] ${String(m.body || "").slice(0, 400)}`).join("\n")}\n\nSuggest ${count} replies from ME.`;
    try {
      const r = await _withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        temperature: 0.7, maxTokens: 400, slot: "subconscious",
      }), TIMEOUT_MS);
      const raw = String(r?.text || r?.content || r?.message?.content || "");
      const arr = _extractJsonArray(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        return { ok: true, replies: arr.slice(0, count).map((s) => String(s).slice(0, 200)), source: "llm" };
      }
      return { ok: true, replies: ["Got it", "Thanks", "I'll look into this"].slice(0, count), source: "deterministic_fallback_parse_failed", raw: raw.slice(0, 200) };
    } catch (e) {
      return { ok: true, replies: ["Got it", "Thanks"].slice(0, count), source: "deterministic_fallback_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Generate N short reply candidates based on the last few messages" });

  register("messaging", "compose_in_my_voice", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const conversationId = String(input.conversationId || "");
    const prompt = String(input.prompt || "").trim();
    if (!conversationId) return { ok: false, reason: "conversationId_required" };
    if (!prompt) return { ok: false, reason: "prompt_required" };
    if (!hasRole(db, conversationId, userId, "guest")) return { ok: false, reason: "forbidden" };
    const llm = ctx?.llm;
    if (!llm?.chat) return { ok: false, reason: "llm_unavailable" };
    // Style anchors: caller's last 50 outgoing messages across ALL convos.
    const anchors = db.prepare(`
      SELECT body FROM messages
      WHERE author_id = ? AND deleted_at IS NULL AND body IS NOT NULL AND length(body) > 0
      ORDER BY server_ts DESC LIMIT 50
    `).all(userId).map((r) => String(r.body || "").slice(0, 300)).filter(Boolean);
    // Recent thread context: last 6 messages.
    const recent = listMessages(db, conversationId, { limit: 6 });
    const sys = `You are drafting a message in the user's own voice. Match their tone, sentence length, and vocabulary.
Respond ONLY with the message body. No prose around it. No quotes. No explanations.`;
    const user = `Style anchors (${anchors.length} of the user's previous messages):
${anchors.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Recent thread (don't repeat — just for context):
${recent.map((m) => `[${m.author_id === userId ? "ME" : m.author_id}] ${String(m.body || "").slice(0, 300)}`).join("\n")}

Draft a message from ME that: ${prompt}`;
    try {
      const r = await _withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        temperature: 0.6, maxTokens: 600, slot: "utility",
      }), TIMEOUT_MS);
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const draft = _stripFences(raw).trim();
      if (!draft || draft.length < 2) return { ok: false, reason: "empty_draft" };
      return { ok: true, draft: draft.slice(0, 4000), anchorCount: anchors.length, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Draft a message in the caller's voice — pulls their last 50 outgoing messages as style anchors" });

  register("messaging", "triage_inbox", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const limit = Math.min(100, Math.max(1, Number(input.limit) || 50));
    // Pull caller's unread messages across all conversations they're in.
    const rows = db.prepare(`
      SELECT m.id, m.conversation_id, m.author_id, m.body, m.attachments_json, m.mentions_json, m.server_ts
      FROM messages m
      JOIN conversation_participants p ON p.conversation_id = m.conversation_id
      LEFT JOIN message_read_receipts r ON r.message_id = m.id AND r.user_id = ?
      WHERE p.user_id = ?
        AND m.deleted_at IS NULL
        AND r.user_id IS NULL
        AND m.author_id != ?
      ORDER BY m.server_ts DESC LIMIT ?
    `).all(userId, userId, userId, limit);
    if (rows.length === 0) return { ok: true, buckets: { priority: [], normal: [], low: [], newsletter: [], spam: [] }, source: "empty" };
    const enriched = rows.map((m) => {
      let mentions = []; try { mentions = JSON.parse(m.mentions_json || "[]"); } catch { /* ok */ }
      const hasAttachments = !!m.attachments_json;
      return {
        ...m, mentions,
        heuristic_bucket: _heuristicTriage({ body: m.body, mentions, callerId: userId, hasAttachments }),
      };
    });
    // Ask LLM ONLY for the ambiguous "normal" bucket (cheap pre-filter).
    const llm = ctx?.llm;
    const ambiguous = enriched.filter((m) => m.heuristic_bucket === "normal");
    if (llm?.chat && ambiguous.length > 0) {
      const sys = `Classify each message into ONE of: priority, normal, low, newsletter, spam.
Respond ONLY with a JSON object mapping message_id → bucket.`;
      const user = `Messages:
${ambiguous.slice(0, 30).map((m) => `${m.id}: "${String(m.body || "").slice(0, 200)}"`).join("\n")}`;
      try {
        const r = await _withTimeout(llm.chat({
          messages: [{ role: "system", content: sys }, { role: "user", content: user }],
          temperature: 0.2, maxTokens: 1200, slot: "subconscious",
        }), TIMEOUT_MS);
        const raw = String(r?.text || r?.content || r?.message?.content || "");
        const obj = _extractJsonObject(raw);
        if (obj && typeof obj === "object") {
          for (const m of ambiguous) {
            const bucket = obj[m.id];
            if (typeof bucket === "string" && ["priority", "normal", "low", "newsletter", "spam"].includes(bucket)) {
              m.heuristic_bucket = bucket;
            }
          }
        }
      } catch { /* heuristic stays */ }
    }
    const buckets = { priority: [], normal: [], low: [], newsletter: [], spam: [] };
    for (const m of enriched) buckets[m.heuristic_bucket].push({
      id: m.id, conversation_id: m.conversation_id, author_id: m.author_id,
      body_preview: String(m.body || "").slice(0, 200), server_ts: m.server_ts,
    });
    return { ok: true, buckets, totalSeen: enriched.length, source: llm?.chat ? "llm+heuristic" : "heuristic" };
  }, { requiresLLM: true, note: "Triage the caller's unread inbox into priority/normal/low/newsletter/spam buckets" });

  register("messaging", "translate", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const messageId = String(input.messageId || "");
    const targetLang = String(input.targetLang || "").trim();
    if (!messageId || !targetLang) return { ok: false, reason: "messageId_and_targetLang_required" };
    if (!/^[a-z]{2,5}(-[A-Z]{2})?$/.test(targetLang)) return { ok: false, reason: "invalid_lang_code" };
    const m = getMessage(db, messageId);
    if (!m) return { ok: false, reason: "message_not_found" };
    if (!hasRole(db, m.conversation_id, userId, "guest")) return { ok: false, reason: "forbidden" };
    const cacheKey = `${messageId}|${targetLang}`;
    const cached = TRANSLATE_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return { ok: true, translated: cached.text, targetLang, source: "cache" };
    }
    const llm = ctx?.llm;
    if (!llm?.chat) return { ok: false, reason: "llm_unavailable" };
    const sys = `Translate the user's message into ${targetLang}. Respond ONLY with the translated text. No prose around it.`;
    try {
      const r = await _withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: String(m.body || "").slice(0, 4000) }],
        temperature: 0.1, maxTokens: 1200, slot: "utility",
      }), TIMEOUT_MS);
      const translated = String(r?.text || r?.content || r?.message?.content || "").trim().slice(0, 4000);
      if (!translated) return { ok: false, reason: "empty_translation" };
      TRANSLATE_CACHE.set(cacheKey, { text: translated, ts: Date.now() });
      return { ok: true, translated, targetLang, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Translate a message into a target language; results cached 24h in-process" });
}
