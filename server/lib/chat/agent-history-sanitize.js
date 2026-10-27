// The agent loop (lib/chat-agent.js runAgentLoop) used to splice its
// `history` argument straight into the prompt. ConKay's stream and the
// chat_agent.do macro take that history from the client, so a client could
// add role "system" / "tool" messages and steer the agent. Only notes the
// server built itself (registered here, by object identity, which JSON
// from a client can never carry) keep the system role; everything else is
// user/assistant text, capped.

const TRUSTED = new WeakSet();

/** A server-built system note for the agent history. */
export function trustedNote(content, role = "system") {
  const o = { role, content: String(content ?? "") };
  TRUSTED.add(o);
  return o;
}

/** Mark an existing server-built message as trusted (e.g. stored checkpoints). */
export function markTrusted(o) {
  if (o && typeof o === "object") TRUSTED.add(o);
  return o;
}

export function isTrustedNote(o) {
  return !!(o && typeof o === "object" && TRUSTED.has(o));
}

export const AGENT_HISTORY_MAX_ENTRIES = 24;
export const AGENT_HISTORY_MAX_CHARS = 4000;
export const AGENT_HISTORY_MAX_TOTAL = 24000;

// Text that imitates the loop's own protocol markers is quoted, so pasted
// "[TOOL_RESULT: ...]" in a message cannot pose as a real tool result.
function defuse(text) {
  return text.replace(/\[(\s*)(TOOL_RESULT|TOOL_CALL|SYSTEM)\b/gi, "[$1quoted $2");
}

function asText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === "string" ? p : (p && typeof p.text === "string" ? p.text : ""))).join(" ");
  }
  return "";
}

/**
 * @param {unknown} history
 * @returns {{role: string, content: string}[]}
 */
export function sanitizeAgentHistory(history, {
  maxEntries = AGENT_HISTORY_MAX_ENTRIES,
  maxChars = AGENT_HISTORY_MAX_CHARS,
  maxTotal = AGENT_HISTORY_MAX_TOTAL,
} = {}) {
  if (!Array.isArray(history)) return [];
  const out = [];
  let total = 0;
  let kept = 0;
  // Newest first so the caps drop the oldest client turns.
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (isTrustedNote(m)) { out.push(m); continue; }
    const role = m?.role;
    if (role !== "user" && role !== "assistant") continue; // system, tool, developer, function: dropped
    if (kept >= maxEntries || total >= maxTotal) continue;
    let text = asText(m.content).slice(0, maxChars);
    if (!text.trim()) continue;
    text = defuse(text).slice(0, Math.max(0, maxTotal - total));
    total += text.length;
    kept += 1;
    out.push({ role, content: text });
  }
  return out.reverse();
}
