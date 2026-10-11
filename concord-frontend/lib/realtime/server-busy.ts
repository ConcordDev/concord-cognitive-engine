/**
 * Server-busy signal — a 503 `service_overloaded` / `busy_retry` is the
 * host shedding load, not a dropped socket. ConnectionStatus renders this
 * separately from "Connection lost".
 *
 * The API client notes a busy response (and retries with the server's
 * Retry-After). A later 2xx clears it. The banner also clears on its own
 * after the retry window so a one-off shed doesn't stick.
 */

export type ServerBusyDetail = {
  retryAfterS: number;
  message: string;
  at: number;
};

type Listener = (detail: ServerBusyDetail | null) => void;

const listeners = new Set<Listener>();
let current: ServerBusyDetail | null = null;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  for (const cb of listeners) {
    try {
      cb(current);
    } catch {
      // A banner listener must not break the client.
    }
  }
}

export function isServiceOverloadedPayload(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const body = data as { error?: string; code?: string; reason?: string; warming?: boolean };
  if (body.warming === true) return true;
  if (body.error === 'service_overloaded') return true;
  if (body.code === 'service_overloaded' || body.code === 'service_warming' || body.code === 'busy_retry') {
    return true;
  }
  if (typeof body.reason === 'string' && /^event_loop_lag/.test(body.reason)) return true;
  return false;
}

export function noteServerBusy(input: { retryAfterS?: number; message?: string } = {}): void {
  const retryAfterS = Number.isFinite(input.retryAfterS) && (input.retryAfterS as number) > 0
    ? Math.min(input.retryAfterS as number, 60)
    : 2;
  current = {
    retryAfterS,
    message: input.message || 'Server busy. Retrying…',
    at: Date.now(),
  };
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    current = null;
    clearTimer = null;
    notify();
  }, (retryAfterS + 1) * 1000);
  notify();
}

export function clearServerBusy(): void {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  if (!current) return;
  current = null;
  notify();
}

export function getServerBusy(): ServerBusyDetail | null {
  return current;
}

export function onServerBusy(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Test helper — drop listeners, the banner, and the auto-clear timer. */
export function _resetServerBusyForTest(): void {
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = null;
  current = null;
  listeners.clear();
}
