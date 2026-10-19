// Wall-clock budget for a chat turn that runs GPU generation.
//
// POST /api/chat (web rail ?full=1, axios JSON, phone fallback) returns one
// body. Cloudflare answers 524 at about 100s if no bytes have left, so the
// whole turn — brain, generate_3d, and the local layout fallback — has to
// finish under ~90s. /api/chat/stream writes a keepalive every 15s, so it
// can hold a longer combined generate_3d budget, still one deadline for
// concept + mesh rather than stacking the two timeouts.

export const JSON_TURN_BUDGET_MS = 85_000;
export const STREAM_TURN_BUDGET_MS = 120_000;
const JSON_RESERVE_MS = 4_000;
const STREAM_RESERVE_MS = 2_000;

/** Operator override for tests. Clamped so a JSON turn cannot be set past the Cloudflare budget. */
export function jsonTurnBudgetMs() {
  const n = Number(process.env.CONCORD_CHAT_JSON_BUDGET_MS);
  if (Number.isFinite(n) && n >= 200 && n <= 90_000) return n;
  return JSON_TURN_BUDGET_MS;
}

export function resolveChatTransport(ctx) {
  const t = ctx?.chatTransport;
  if (t === "sse" || t === "socket" || t === "json") return t;
  const path = String(ctx?.reqMeta?.path || ctx?.req?.path || "");
  if (path.includes("/chat/stream")) return "sse";
  return "json";
}

/**
 * @returns {{ transport: "json"|"sse"|"socket", deadlineMs: number, timeoutMs: number, skipGpu: boolean, capMs: number }}
 */
export function chatGenerationBudget({ transport, startedAt, now = Date.now(), ctx } = {}) {
  const kind = transport || resolveChatTransport(ctx);
  const cap = kind === "json" ? jsonTurnBudgetMs() : STREAM_TURN_BUDGET_MS;
  const start = Number(startedAt) > 0 ? Number(startedAt) : now;
  const deadlineMs = start + cap;
  const remain = deadlineMs - now;
  const reserve = kind === "json" ? JSON_RESERVE_MS : STREAM_RESERVE_MS;
  const timeoutMs = Math.max(0, Math.min(cap, remain - reserve));
  return {
    transport: kind,
    deadlineMs,
    timeoutMs,
    skipGpu: timeoutMs < 1_000,
    capMs: cap,
  };
}
