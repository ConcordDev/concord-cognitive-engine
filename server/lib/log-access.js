// Cross-user log / telemetry / debug read policy.
//
// STATE.logs is one process-wide ring. Chat turns land in it with session
// ids, DTU ids, and reply text (ctx.log("chat", ...)). GET /api/logs and
// the sibling event/trace/debug reads used to return the whole ring to any
// caller. This module is the single filter those routes and macros share.
//
// Rules:
//   - no actor → 401 authentication_required
//   - member → only rows attributed to them (entry.userId or a session
//     they own / participate in). Unattributed system rows stay hidden.
//   - owner / admin / founder / sovereign → every row
//   - secrets and tokens are stripped for every role, including admin

const LOG_ADMIN_ROLES = new Set(["owner", "admin", "founder", "sovereign"]);

// Key names that are credentials. sessionId is intentionally NOT here:
// it is the ownership key a member uses to see their own chat row.
const SECRET_KEY_RE = /(?:^|_)(?:password|passwd|pwd|secret|token|authorization|cookie|api[_-]?key|apikey|bearer|jwt|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|founder[_-]?secret|credentials|session[_-]?token)(?:$|_)/i;

// Credential shapes embedded in an otherwise-ordinary string (a chat
// reply that pasted a key, a stack that echoed an Authorization header).
const EMBEDDED_SECRET_RE = /(?:Bearer\s+[A-Za-z0-9\-._~+/]+=*|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|sk-(?:ant-)?[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|ya29\.[A-Za-z0-9_\-]{20,})/g;

const REDACTED = "[redacted]";

export function isLogAdmin(actor) {
  return LOG_ADMIN_ROLES.has(actor?.role);
}

export function actorFromReq(req) {
  const user = req?.user;
  const id = user?.id || user?.userId || null;
  if (!id || id === "anon") return { userId: null, role: null };
  return { userId: id, role: user.role || "member" };
}

export function actorFromCtx(ctx) {
  const a = ctx?.actor || null;
  if (ctx?.internal === true || a?.internal === true) {
    return { userId: a?.userId || "system", role: a?.role || "owner", internal: true };
  }
  const userId = a?.userId || a?.id || null;
  if (!userId || userId === "anon") return { userId: null, role: null };
  return { userId, role: a?.role || "member" };
}

export function redactLogValue(value, depth = 0) {
  if (depth > 8) return REDACTED;
  if (value == null) return value;
  if (typeof value === "string") {
    EMBEDDED_SECRET_RE.lastIndex = 0;
    return value.replace(EMBEDDED_SECRET_RE, REDACTED);
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactLogValue(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    if (SECRET_KEY_RE.test(k)) out[k] = REDACTED;
    else out[k] = redactLogValue(v, depth + 1);
  }
  return out;
}

export function gateLogRead(req) {
  const actor = actorFromReq(req);
  if (!actor.userId) return { ok: false, status: 401, error: "authentication_required" };
  return { ok: true, status: 200, actor };
}

export function gateLogAdmin(req) {
  const gate = gateLogRead(req);
  if (!gate.ok) return gate;
  if (!isLogAdmin(gate.actor)) return { ok: false, status: 403, error: "forbidden", actor: gate.actor };
  return gate;
}

export function denyUnlessAuthenticated(actor) {
  if (!actor?.userId) return { ok: false, error: "authentication_required" };
  return null;
}

export function denyUnlessAdmin(actor) {
  const auth = denyUnlessAuthenticated(actor);
  if (auth) return auth;
  if (!isLogAdmin(actor)) return { ok: false, error: "forbidden" };
  return null;
}

export function httpStatusForLogMacro(out) {
  if (!out || out.ok !== false) return null;
  if (out.error === "authentication_required") return 401;
  if (out.error === "forbidden") return 403;
  if (typeof out.error === "string" && /admin role/i.test(out.error)) return 403;
  return null;
}

function entryUserIds(entry) {
  if (!entry || typeof entry !== "object") return [];
  const meta = entry.meta && typeof entry.meta === "object" ? entry.meta : {};
  return [entry.userId, entry.actorUserId, entry.ownerUserId, meta.userId, meta.actorId, meta.ownerId]
    .filter((id) => id && id !== "anon" && id !== "system");
}

/**
 * A member sees a row when it is stamped with their user id, or when its
 * sessionId belongs to a session they own or participate in. Rows with
 * neither (system boot logs, another user's chat) are admin-only.
 * Sessions with no ownerId fail closed for members — the bulk log dump
 * must not inherit the legacy "anonymous session is world-readable" rule.
 */
export function logVisibleTo(entry, actor, sessionOwner) {
  if (!actor?.userId) return false;
  if (isLogAdmin(actor)) return true;
  if (entryUserIds(entry).includes(actor.userId)) return true;
  const sessionId = entry?.meta?.sessionId || entry?.sessionId || null;
  if (sessionId && typeof sessionOwner === "function") {
    const owner = sessionOwner(sessionId);
    if (owner && owner === actor.userId) return true;
    const participants = sessionOwner.participants?.(sessionId);
    if (participants && typeof participants.has === "function" && participants.has(actor.userId)) return true;
  }
  return false;
}

export function projectLogs(logs, actor, { limit = 200, sessionOwner } = {}) {
  const src = Array.isArray(logs) ? logs : [];
  const visible = [];
  for (const entry of src) {
    if (!logVisibleTo(entry, actor, sessionOwner)) continue;
    visible.push(redactLogValue(entry));
  }
  const n = Math.min(Math.max(Number(limit) || 200, 1), 2000);
  return visible.slice(-n);
}

export function sessionDumpVisible(sess, actor) {
  if (!actor?.userId || !sess) return false;
  if (isLogAdmin(actor)) return true;
  if (sess.ownerId && sess.ownerId === actor.userId) return true;
  if (sess.participantIds?.has?.(actor.userId)) return true;
  return false;
}

export function sessionOwnerLookup(sessions) {
  const fn = (sessionId) => {
    const sess = sessions?.get?.(sessionId);
    return sess?.ownerId || null;
  };
  fn.participants = (sessionId) => sessions?.get?.(sessionId)?.participantIds || null;
  return fn;
}

export function mapPublicEvents(logs, idFn = () => null) {
  return (logs || []).map((entry) => redactLogValue({
    id: entry.id || idFn(),
    type: entry.type || entry.domain || "system",
    action: entry.action || "event",
    message: entry.message || "",
    timestamp: entry.ts || entry.timestamp || null,
    meta: entry.meta || {},
    userId: entry.userId || null,
  }));
}

export function buildChatConversations(sessions, actor, limit = 20) {
  const conversations = [];
  const entries = sessions instanceof Map ? sessions.entries() : Object.entries(sessions || {});
  for (const [sessionId, sess] of entries) {
    if (!sessionDumpVisible(sess, actor)) continue;
    const msgs = sess?.messages || [];
    if (msgs.length === 0) continue;
    const userMsgs = msgs.filter((m) => m.role === "user");
    const lastMsg = msgs[msgs.length - 1];
    conversations.push(redactLogValue({
      id: sessionId,
      title: userMsgs[0]?.content?.slice(0, 80) || "Untitled",
      summary: userMsgs.slice(-1)[0]?.content?.slice(0, 120) || "",
      lastMessage: lastMsg?.content?.slice(0, 200) || "",
      messageCount: msgs.length,
      createdAt: sess.createdAt || msgs[0]?.ts || null,
      updatedAt: lastMsg?.ts || sess.createdAt || null,
    }));
  }
  conversations.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return conversations.slice(0, n);
}

export function buildGenericEventLog(logs, actor, limit, sessionOwner) {
  const projected = projectLogs(logs, actor, { limit, sessionOwner });
  return mapPublicEvents([...projected].reverse());
}

/**
 * Activity-feed rows carry `_parties` (user ids allowed to see the row).
 * Admin sees every row. The private key is stripped before the response.
 */
export function finalizeActivityFeed(activities, actor, { limit = 50, offset = 0 } = {}) {
  const owned = (activities || []).filter((a) => {
    if (isLogAdmin(actor)) return true;
    const parties = Array.isArray(a?._parties) ? a._parties : [];
    return parties.includes(actor.userId);
  });
  owned.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const page = owned.slice(off, off + lim).map((a) => {
    const rest = { ...a };
    delete rest._parties;
    return redactLogValue(rest);
  });
  return { ok: true, events: page, total: owned.length, limit: lim, offset: off };
}

export function projectTraces(traces, actor, { limit = 50, minDuration = 0 } = {}) {
  let list = [...(traces || [])].reverse();
  if (minDuration > 0) list = list.filter((t) => (t.totalDuration || 0) >= minDuration);
  if (!isLogAdmin(actor)) list = list.filter((t) => t && t.userId === actor.userId);
  const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
  return list.slice(0, n).map((t) => redactLogValue(t));
}

export function resolveTrace(traces, id, actor) {
  const trace = (traces || []).find((t) => t && t.traceId === id);
  if (!trace) return { status: 404, body: { ok: false, error: "Trace not found" } };
  if (!isLogAdmin(actor) && trace.userId !== actor.userId) {
    return { status: 403, body: { ok: false, error: "forbidden" } };
  }
  return { status: 200, body: { ok: true, trace: redactLogValue(trace) } };
}

export function projectBusEvents(events, actor, limit = 100) {
  let list = Array.isArray(events) ? events : [];
  if (!isLogAdmin(actor)) list = list.filter((e) => e && e.userId === actor.userId);
  const n = Math.min(Math.max(Number(limit) || 100, 1), 1000);
  return list.slice(-n).map((e) => redactLogValue(e));
}

export function projectBridgeLog(entries, actor, { limit = 50, action } = {}) {
  const denied = denyUnlessAdmin(actor);
  if (denied) return denied;
  let log = Array.isArray(entries) ? entries : [];
  if (action) log = log.filter((e) => e.action === action);
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return { ok: true, log: log.slice(-n).map((e) => redactLogValue(e)), total: log.length };
}

export function recordOwnedByCaller(record, actor, fields) {
  if (!actor?.userId) return false;
  if (isLogAdmin(actor)) return true;
  const keys = fields || ["callerId", "caller_id", "userId", "user_id"];
  const uid = actor.userId;
  for (const key of keys) {
    const raw = record?.[key] ?? record?.data?.[key];
    if (raw == null) continue;
    const value = String(raw);
    if (value === uid) return true;
    const parts = value.split(":");
    if (parts.length > 1 && parts.includes(uid)) return true;
  }
  return false;
}

export function selectScopedUserId(actor, requested) {
  if (isLogAdmin(actor) && requested) return String(requested);
  return actor.userId;
}

export function summarizePerfSamples(samples, actor) {
  const s = Array.isArray(samples) ? samples : [];
  if (!s.length) return { ok: true, samples: 0, breachRate: 0, p50Fps: 0, p10Fps: 0 };
  const fps = s.map((x) => x.avgFps).sort((a, b) => a - b);
  const breaches = s.reduce((a, x) => a + (x.breaches || 0), 0);
  const total = s.reduce((a, x) => a + (x.samples || 0), 0) || 1;
  const body = {
    ok: true,
    samples: s.length,
    breachRate: Math.round((breaches / total) * 10000) / 100,
    p50Fps: fps[Math.floor(fps.length * 0.5)],
    p10Fps: fps[Math.floor(fps.length * 0.1)],
    p90Fps: fps[Math.floor(fps.length * 0.9)],
  };
  if (isLogAdmin(actor)) body.recent = redactLogValue(s.slice(-30));
  return body;
}

export function filterInferenceTraces(traces, actor) {
  const list = traces || [];
  if (isLogAdmin(actor)) return list;
  return list
    .filter((t) => (t.spans || []).some((span) => recordOwnedByCaller(span, actor, ["callerId", "userId"])))
    .map((t) => ({
      ...t,
      spans: (t.spans || []).filter((span) => recordOwnedByCaller(span, actor, ["callerId", "userId"])),
    }));
}

export function sendGate(res, gate) {
  return res.status(gate.status).json({ ok: false, error: gate.error });
}

/**
 * HLR traces carry the caller's question. Rows stamped with userId belong
 * to that caller; unstamped rows are operator-only.
 */
export function projectReasoningTraces(traces, actor) {
  const list = Array.isArray(traces) ? traces : [];
  const visible = isLogAdmin(actor)
    ? list
    : list.filter((t) => {
      const owner = t?.userId || t?.input?.userId || null;
      return owner && owner === actor?.userId;
    });
  return visible.map((t) => redactLogValue(t));
}

export function reasoningTraceAccess(trace, actor) {
  if (!actor?.userId) return { status: 401, error: "authentication_required" };
  if (!trace) return { status: 404, error: "no_trace" };
  const owner = trace.userId || trace.input?.userId || null;
  if (isLogAdmin(actor) || (owner && owner === actor.userId)) return { status: 200 };
  return { status: 403, error: "forbidden" };
}

/**
 * Anonymous chat messages are the cookie session only. A query sessionId
 * that names a different session is refused. Owned sessions follow the
 * same fail-closed owner/participant rule as the chat log dump.
 */
export function resolveAnonMessageRead({ session, actor, cookieSessionId, querySessionId }) {
  const admin = isLogAdmin(actor);
  if (!admin && querySessionId && querySessionId !== cookieSessionId) {
    return { status: 403, error: "forbidden", messages: [] };
  }
  const sessionId = admin ? (querySessionId || cookieSessionId || null) : (cookieSessionId || null);
  if (!sessionId) return { status: 401, error: "authentication_required", messages: [] };
  if (!session) return { status: 200, error: null, messages: [] };
  const owned = !!(session.ownerId || (session.participantIds && session.participantIds.size));
  if (owned && !sessionDumpVisible(session, actor)) {
    return {
      status: actor?.userId ? 403 : 401,
      error: actor?.userId ? "forbidden" : "authentication_required",
      messages: [],
    };
  }
  const messages = Array.isArray(session.messages) ? session.messages.slice(-50) : [];
  return { status: 200, error: null, messages: redactLogValue(messages) };
}

export function combatLogAccess(combatants, actor) {
  if (!actor?.userId) return { status: 401, error: "authentication_required" };
  if (isLogAdmin(actor)) return { status: 200 };
  const mine = (combatants || []).some((c) => {
    const id = c?.entity_id || c?.entityId || c?.userId;
    return id && String(id) === actor.userId;
  });
  return mine ? { status: 200 } : { status: 403, error: "forbidden" };
}
