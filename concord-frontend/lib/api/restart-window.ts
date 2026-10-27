/**
 * Restart window — keeps backend restarts (deploys) from being counted as
 * "issues" in the System Status / error counters.
 *
 * When the backend restarts, requests fail with 502/503/504 (proxy or the
 * shutting-down 503) for ~10–20s. Recording each of those as an error makes
 * every deploy look like an outage. Instead, the first restart-shaped failure
 * opens a window; failures inside it are held, not recorded:
 *   - if /api/status answers healthy again inside the window, held errors
 *     are dropped;
 *   - if the window ends and the backend is still failing, held errors are
 *     recorded, so a real outage still shows.
 */

export const RESTART_WINDOW_MS = 60_000;
export const RESTART_PROBE_INTERVAL_MS = 5_000;

/** Statuses a proxy or a restarting server returns while the backend is down. */
export const RESTART_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

export interface RestartWindowOptions<T> {
  windowMs?: number;
  probeIntervalMs?: number;
  /** Resolves true when the backend is answering healthy again. */
  isHealthy: () => Promise<boolean>;
  /** Called with each held entry if the window ends while still failing. */
  record: (entry: T) => void;
}

export interface RestartWindow<T> {
  /** Open the window (no-op if already open). Used for shutting-down responses. */
  open: () => void;
  /** Hold an entry inside the window, opening it if needed. Always returns true. */
  hold: (entry: T) => void;
  isOpen: () => boolean;
}

export function createRestartWindow<T>(opts: RestartWindowOptions<T>): RestartWindow<T> {
  const windowMs = opts.windowMs ?? RESTART_WINDOW_MS;
  const probeIntervalMs = opts.probeIntervalMs ?? RESTART_PROBE_INTERVAL_MS;

  let held: T[] | null = null; // non-null === window open
  let probeTimer: ReturnType<typeof setInterval> | null = null;
  let endTimer: ReturnType<typeof setTimeout> | null = null;

  const close = (): T[] => {
    const entries = held ?? [];
    held = null;
    if (probeTimer) clearInterval(probeTimer);
    if (endTimer) clearTimeout(endTimer);
    probeTimer = null;
    endTimer = null;
    return entries;
  };

  const probe = () => {
    const generation = held;
    opts.isHealthy().then((healthy) => {
      // Only act if this same window is still open (not closed by the end timer).
      if (healthy && held !== null && held === generation) close();
    }, () => { /* a failed probe just means "not healthy yet" */ });
  };

  const open = () => {
    if (held !== null) return;
    held = [];
    probeTimer = setInterval(probe, probeIntervalMs);
    endTimer = setTimeout(() => {
      for (const entry of close()) opts.record(entry);
    }, windowMs);
  };

  return {
    open,
    hold: (entry) => {
      open();
      held?.push(entry);
    },
    isOpen: () => held !== null,
  };
}

/** Failures that look like a restart: a restart status, or no response at all. */
export function isRestartFailure(status: number | undefined, hasResponse: boolean): boolean {
  if (!hasResponse) return true;
  return status !== undefined && RESTART_STATUSES.has(status);
}
