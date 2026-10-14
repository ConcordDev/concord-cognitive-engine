/**
 * Chat turn pipeline — one user send → one user row → one assistant reply.
 *
 * A single client send can hit chat.respond twice (SSE stream + buffered
 * POST fallback, or a raced retry). Without a gate, each call appends the
 * user turn and runs another brain pass — the second reply is often an
 * unrelated retrieved-note hallucination. This module is the choke point.
 */

/** @type {Map<string, Promise<unknown>>} */
const _inflight = new Map();

/** How long a completed (user, reply) pair is treated as the same send. */
export const TURN_DEDUP_WINDOW_MS = 120_000;

export function chatTurnKey(sessionId, { clientTurnId, prompt, forceNew } = {}) {
  if (forceNew) return null;
  const sid = String(sessionId || "default");
  const tid = clientTurnId != null && String(clientTurnId).trim()
    ? String(clientTurnId).trim()
    : null;
  if (tid) return `t:${sid}:${tid}`;
  const p = String(prompt || "");
  if (!p) return null;
  return `p:${sid}:${p}`;
}

/**
 * Coalesce concurrent chat.respond invocations for the same send.
 * Sequential retries after completion are handled by findCompletedChatTurn.
 */
export async function coalesceChatTurn(key, run) {
  if (!key) return run();
  const existing = _inflight.get(key);
  if (existing) return existing;
  const p = Promise.resolve()
    .then(run)
    .finally(() => {
      if (_inflight.get(key) === p) _inflight.delete(key);
    });
  _inflight.set(key, p);
  return p;
}

/** For tests — clear in-flight coalescing state. */
export function _resetChatTurnPipelineForTests() {
  _inflight.clear();
}

/**
 * If this session already finished the same user prompt (or clientTurnId)
 * within the dedupe window, return that assistant reply so we do not
 * append another user turn or call the brain again.
 */
export function findCompletedChatTurn(sess, prompt, { clientTurnId = null, windowMs = TURN_DEDUP_WINDOW_MS, now = Date.now() } = {}) {
  if (!sess) return null;
  const tid = clientTurnId != null && String(clientTurnId).trim()
    ? String(clientTurnId).trim()
    : null;
  if (tid && sess._turnCache instanceof Map && sess._turnCache.has(tid)) {
    const hit = sess._turnCache.get(tid);
    if (hit && hit.reply != null) return hit;
  }
  const msgs = Array.isArray(sess.messages) ? sess.messages : [];
  const want = String(prompt || "");
  if (!want) return null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!m || m.role !== "user") continue;
    if (String(m.content || "") !== want) {
      // Only the trailing user turn can be a retry of "this" send.
      break;
    }
    const next = msgs[i + 1];
    if (!next || next.role !== "assistant") break;
    const ts = Date.parse(m.ts) || Number(m.ts) || 0;
    const age = now - ts;
    if (Number.isFinite(age) && age >= 0 && age <= windowMs) {
      return {
        reply: next.content,
        userTs: m.ts,
        assistantTs: next.ts,
        from: "session_messages",
      };
    }
    break;
  }
  return null;
}

export function rememberCompletedChatTurn(sess, clientTurnId, reply) {
  if (!sess || clientTurnId == null || reply == null) return;
  const tid = String(clientTurnId).trim();
  if (!tid) return;
  if (!(sess._turnCache instanceof Map)) sess._turnCache = new Map();
  sess._turnCache.set(tid, { reply, rememberedAt: Date.now() });
  // Bound cache size — one entry per send is enough; drop oldest.
  if (sess._turnCache.size > 32) {
    const first = sess._turnCache.keys().next().value;
    sess._turnCache.delete(first);
  }
}

/**
 * Latest user row for a session when its content matches inside the dedupe
 * window. Used so a stream+fallback double-hit does not INSERT the user twice.
 */
export function recentDuplicateUserRow(db, sessionId, content, { windowMs = TURN_DEDUP_WINDOW_MS, now = Date.now() } = {}) {
  if (!db || !sessionId || content == null) return null;
  try {
    const row = db.prepare(`
      SELECT id, role, content, ts FROM chat_messages
      WHERE session_id = ? AND role = 'user'
      ORDER BY ts DESC, id DESC
      LIMIT 1
    `).get(sessionId);
    if (!row) return null;
    if (String(row.content) !== String(content)) return null;
    const age = now - Number(row.ts || 0);
    if (!(Number.isFinite(age) && age >= 0 && age <= windowMs)) return null;
    return row;
  } catch {
    return null;
  }
}

export function recentDuplicateUserInDb(db, sessionId, content, opts) {
  return !!recentDuplicateUserRow(db, sessionId, content, opts);
}

/** True when an assistant row already follows the given user message id. */
export function assistantFollowsUserInDb(db, sessionId, userRowId) {
  if (!db || !sessionId || userRowId == null) return false;
  try {
    const after = db.prepare(`
      SELECT role FROM chat_messages
      WHERE session_id = ? AND id > ?
      ORDER BY id ASC
      LIMIT 1
    `).get(sessionId, userRowId);
    return after?.role === "assistant";
  } catch {
    return false;
  }
}
