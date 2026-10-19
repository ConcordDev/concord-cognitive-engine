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

/** Time a chat turn keeps back from generate_3d so a local layout can still be returned. */
export const GEN_3D_FALLBACK_RESERVE_MS = 12_000;
/** Don't start TRELLIS after a layout unless at least this much GPU time is left. */
export const GEN_3D_MIN_AFTER_LAYOUT_MS = 5_000;

/**
 * Clamp a generate_3d attempt to the time left after the conkay reserve.
 * JSON and stream turns both use this. No deadline and no timeout: nothing to clamp.
 * @returns {{ reserveMs: number, deadlineMs: number, timeoutMs: number, enough: boolean }}
 */
export function clampGenerate3dBudget({ deadlineMs = 0, timeoutMs = 0, now = Date.now(), reserveMs = GEN_3D_FALLBACK_RESERVE_MS } = {}) {
  const reserve = Math.max(0, Number(reserveMs) || 0);
  const deadline = Number(deadlineMs) > 0 ? Number(deadlineMs) : 0;
  const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 0;
  let gpuDeadline = 0;
  let gpuTimeout = 0;
  if (deadline) {
    gpuDeadline = deadline - reserve;
    gpuTimeout = Math.max(0, gpuDeadline - now);
    if (timeout) gpuTimeout = Math.min(gpuTimeout, timeout);
  } else if (timeout) {
    gpuTimeout = Math.max(0, timeout - reserve);
    gpuDeadline = now + gpuTimeout;
  }
  return {
    reserveMs: reserve,
    deadlineMs: gpuDeadline,
    timeoutMs: gpuTimeout,
    enough: gpuTimeout >= GEN_3D_MIN_AFTER_LAYOUT_MS,
  };
}

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

/** Milliseconds left before `deadlineMs`; Infinity when there is no deadline. */
export function budgetLeftMs(deadlineMs, now = Date.now()) {
  const d = Number(deadlineMs);
  return Number.isFinite(d) && d > 0 ? d - now : Infinity;
}

/**
 * Settle with `promise`, or with `onLate()` once `deadlineMs` passes, whichever
 * is first. The late work is not cancelled (fetch timeouts do that); the turn
 * just stops waiting for it so the JSON reply leaves before Cloudflare's 524.
 * No deadline: returns the promise unchanged.
 */
export function raceDeadline(promise, deadlineMs, onLate) {
  const left = budgetLeftMs(deadlineMs);
  if (!Number.isFinite(left)) return promise;
  let timer = null;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => {
      try { resolve(onLate()); } catch { resolve(null); }
    }, Math.max(0, left));
  });
  // Swallow a late rejection from the abandoned work.
  Promise.resolve(promise).catch(() => {});
  return Promise.race([promise, late]).finally(() => { if (timer) clearTimeout(timer); });
}
