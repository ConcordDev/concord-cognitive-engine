// server/lib/chat/tool-result-events.js
//
// Builds the `chat:tool_result` socket payloads for one chat turn.
//
// The `chat.respond` macro runs a real tool-execution loop (server.js's
// _parseToolCalls -> _executeToolCalls) and returns the per-tool outcome as
// `toolCalls`, but the chat socket handler only ever emitted `chat:complete`,
// so the rail's tool lines never rendered even though the tools genuinely ran.
// (Dead-subscription audit, docs/DEAD_SUBSCRIPTION_AUDIT.md Class C.)
//
// The listener is PersistentChatRail#handleToolResult. Two things about it are
// load-bearing and drove the shape of this module:
//
//  1. It renders by INTERPOLATION — `🔧 ${tool}: ${ok ? result : 'Error: ' +
//     result}` — so `result` must already be a string. The macro's toolCalls
//     entries carry `result` as `any`: a string for web_search, an object for
//     run_compute / run_lens_action, and null for browse_url / create_dtu
//     (which put their payload in sibling `url` / `title` / `key` fields).
//     Emitting those raw would print "[object Object]" in the chat.
//  2. On failure it shows `result` AS the error text, so a failed tool must
//     carry its error message in `result`, not in a separate `error` field the
//     rail never reads.
//
// It also drops any payload whose `sessionId` doesn't match its own, so the
// caller must stamp the real session id.

/** Max characters of a JSON-serialised tool result to put in the chat line. */
const MAX_RESULT_CHARS = 2000;

/**
 * Render one toolCalls entry as the STRING the rail expects.
 * @param {object} t — a `chat.respond` toolCalls entry
 * @returns {string}
 */
export function formatChatToolResultText(t) {
  if (!t) return "";
  // Failure: the rail prints this as the error text.
  if (!t.ok) return String(t.error || "tool failed");
  if (typeof t.result === "string") return t.result;
  // browse_url / create_dtu carry their payload in sibling fields.
  if (t.result == null) return String(t.title || t.url || t.key || "ok");
  try {
    return JSON.stringify(t.result).slice(0, MAX_RESULT_CHARS);
  } catch {
    return String(t.result);
  }
}

/**
 * Build one `chat:tool_result` payload per executed tool call.
 *
 * @param {object} macroResult — the `chat.respond` return value
 * @param {string} sessionId   — the chat session the rail is filtering on
 * @returns {Array<{ sessionId: string, tool: string, ok: boolean, result: string }>}
 */
export function buildChatToolResultEvents(macroResult, sessionId) {
  const calls = macroResult?.toolCalls;
  if (!Array.isArray(calls) || calls.length === 0) return [];
  return calls.map((t) => ({
    sessionId,
    tool: String(t?.tool || "tool"),
    ok: !!t?.ok,
    result: formatChatToolResultText(t),
  }));
}
