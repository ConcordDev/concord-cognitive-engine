/**
 * Stream deadlines for the chat send path (FIX-goddess-001).
 *
 * Two clocks guard a streamed turn:
 *  - idle: no bytes for `idleMs` — a half-open socket / dead stream.
 *  - total: the whole stream leg may not exceed `totalMs`, no matter
 *    how many bytes arrive. Proxy SSE heartbeats are bytes, so an
 *    idle-only watchdog is re-armed forever by a stream that
 *    heartbeats but never answers; the turn then never reaches its
 *    fallback or error paths.
 *
 * `beat()` is called on every chunk read and resets ONLY the idle
 * clock. `onExpire` fires exactly once, for whichever clock trips
 * first. Timers are injectable for tests.
 */
export interface StreamDeadline {
  start: () => void;
  beat: () => void;
  stop: () => void;
}

export interface StreamDeadlineOptions {
  idleMs: number;
  totalMs: number;
  onExpire: () => void;
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

export function createStreamDeadline(opts: StreamDeadlineOptions): StreamDeadline {
  const setT = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeoutFn ?? ((h) => clearTimeout(h));
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let totalTimer: ReturnType<typeof setTimeout> | null = null;
  let expired = false;
  let stopped = false;

  const clearBoth = () => {
    if (idleTimer !== null) { clearT(idleTimer); idleTimer = null; }
    if (totalTimer !== null) { clearT(totalTimer); totalTimer = null; }
  };
  const expire = () => {
    if (expired || stopped) return;
    expired = true;
    clearBoth();
    opts.onExpire();
  };
  const armIdle = () => {
    if (idleTimer !== null) clearT(idleTimer);
    idleTimer = setT(expire, opts.idleMs);
  };

  return {
    start() {
      if (stopped || expired) return;
      armIdle();
      totalTimer = setT(expire, opts.totalMs);
    },
    beat() {
      if (stopped || expired) return;
      armIdle();
    },
    stop() {
      stopped = true;
      clearBoth();
    },
  };
}
