// server/lib/messaging/channel-agent.js
//
// Sprint C #24 — channel-bound agent for messaging.
//
// One step per heartbeat tick (~1min). Six tools mirror the
// whiteboard canvas-agent shape:
//   post_message({body, parentMessageId?})
//   read_recent({limit?})
//   react({messageId, emoji})
//   summarize({})  → returns the live summary to use in the next step
//   mention_user({userId})  → posts an @-mention message
//   done({reason?})
//
// Real brain calls (conscious slot, 18s timeout). Real DB writes.
// Deterministic no-LLM fallback posts a single "agent fallback"
// message describing the task so the agent never silently no-ops.

import { hasRole, getConversation, listMessages, postMessage, toggleReaction } from "./persistence.js";

const TOOL_CATALOGUE = [
  { name: "post_message", description: "Post a new message. {body: string, parentMessageId?: string}" },
  { name: "read_recent", description: "Read recent messages. {limit?: number} → returns list" },
  { name: "react", description: "Toggle an emoji reaction. {messageId: string, emoji: string}" },
  { name: "summarize", description: "Summarise recent activity. {} → returns summary text" },
  { name: "mention_user", description: "Post a message that @-mentions a user. {userId: string, body: string}" },
  { name: "done", description: "Signal task complete. {reason?: string}" },
];

const STEP_TIMEOUT_MS = 18_000;
const MAX_RECENT_VISIBLE = 30;

function _withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout_${ms}ms`)), ms))]);
}

function _extractJsonObject(raw) {
  const stripped = String(raw || "").replace(/```(?:\w+)?\n?([\s\S]*?)```/g, "$1").trim();
  try { const v = JSON.parse(stripped); if (v && typeof v === "object") return v; } catch { /* try regex */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

function _summariseRecent(messages) {
  return messages.slice(-MAX_RECENT_VISIBLE).map((m) => ({
    id: m.id, author: m.author_id, body: String(m.body || "").slice(0, 200),
  }));
}

function _applyTool(db, { conversationId, userId, toolName, toolArgs }) {
  if (toolName === "post_message") {
    const r = postMessage(db, {
      conversationId, authorId: userId,
      body: String(toolArgs?.body || "").slice(0, 4000), bodyKind: "text",
      parentMessageId: toolArgs?.parentMessageId || null,
    });
    return r.ok ? { ok: true, observation: `Posted message ${r.id}` } : { ok: false, observation: `post_message failed: ${r.reason}` };
  }
  if (toolName === "read_recent") {
    const lim = Math.min(MAX_RECENT_VISIBLE, Math.max(1, Number(toolArgs?.limit) || 10));
    const msgs = listMessages(db, conversationId, { limit: lim });
    return { ok: true, observation: `Read ${msgs.length} recent messages: ${JSON.stringify(_summariseRecent(msgs))}` };
  }
  if (toolName === "react") {
    const r = toggleReaction(db, { id: String(toolArgs?.messageId || ""), userId, emoji: String(toolArgs?.emoji || "") });
    return r.ok ? { ok: true, observation: `Reacted ${r.emoji} (${r.action})` } : { ok: false, observation: `react failed: ${r.reason}` };
  }
  if (toolName === "summarize") {
    const msgs = listMessages(db, conversationId, { limit: 50 });
    const text = _summariseRecent(msgs).map((m) => `[${m.author}] ${m.body}`).join("\n");
    return { ok: true, observation: `Summary:\n${text || "(empty)"}` };
  }
  if (toolName === "mention_user") {
    const target = String(toolArgs?.userId || "");
    if (!target) return { ok: false, observation: "mention_user needs userId" };
    const r = postMessage(db, {
      conversationId, authorId: userId,
      body: `@${target} ${String(toolArgs?.body || "").slice(0, 3900)}`, bodyKind: "text",
      mentions: [target],
    });
    return r.ok ? { ok: true, observation: `Mentioned ${target} in ${r.id}` } : { ok: false, observation: `mention failed: ${r.reason}` };
  }
  if (toolName === "done") {
    return { ok: true, observation: `Done: ${toolArgs?.reason || "agent signalled completion"}`, done: true };
  }
  return { ok: false, observation: `unknown tool: ${toolName}` };
}

/**
 * Run a single agent step. Read recent messages → prompt brain → parse
 * tool call → execute. Returns { ok, toolCalled, observation, done }.
 */
export async function runChannelAgentStep({ ctx, conversationId, task, sessionId, history = [] }) {
  const db = ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db;
  const userId = ctx?.actor?.userId || ctx?.userId;
  if (!db || !userId) return { ok: false, reason: "auth_required" };
  if (!hasRole(db, conversationId, userId, "member")) return { ok: false, reason: "forbidden" };
  if (!getConversation(db, conversationId)) return { ok: false, reason: "conversation_not_found" };

  const recent = _summariseRecent(listMessages(db, conversationId, { limit: 30 }));

  const llm = ctx?.llm;
  if (!llm?.chat) {
    const res = _applyTool(db, { conversationId, userId, toolName: "post_message", toolArgs: { body: `[agent fallback] ${task}` } });
    return { ok: true, toolCalled: "post_message", observation: res.observation, done: true };
  }

  const sys = `You are a chat-channel collaboration agent. ONE tool call per turn.
Respond ONLY with JSON: { "tool": "<name>", "args": {...} }.
Available tools:
${TOOL_CATALOGUE.map((t) => `- ${t.name}: ${t.description}`).join("\n")}
After a few useful actions, call "done".`;
  const historyMsg = history.slice(-6).map((h, i) => `Step ${i + 1}: tool=${h.toolCalled} obs="${(h.observation || "").slice(0, 200)}"`).join("\n");
  const user = `Goal: ${task}\n\nRecent thread (${recent.length} messages):\n${JSON.stringify(recent)}\n\nHistory:\n${historyMsg || "(no prior steps)"}\n\nReturn next tool call as JSON.`;

  let raw = "";
  try {
    const r = await _withTimeout(llm.chat({
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.4, maxTokens: 600, slot: "conscious",
    }), STEP_TIMEOUT_MS);
    raw = String(r?.text || r?.content || r?.message?.content || "");
  } catch (e) {
    return { ok: false, reason: "llm_error", error: e?.message };
  }
  const parsed = _extractJsonObject(raw);
  if (!parsed || typeof parsed.tool !== "string") {
    return { ok: false, reason: "parse_failed", raw: raw.slice(0, 300) };
  }
  const toolArgs = parsed.args && typeof parsed.args === "object" ? parsed.args : {};
  const result = _applyTool(db, { conversationId, userId, toolName: parsed.tool, toolArgs });
  try {
    globalThis._concordREALTIME?.io?.to(`conversation:${conversationId}`).emit("messaging:agent-step", {
      conversationId, sessionId, toolCalled: parsed.tool, observation: result.observation, ts: Date.now(),
    });
  } catch { /* best effort */ }
  return { ok: true, toolCalled: parsed.tool, toolArgs, observation: result.observation, done: !!result.done };
}
