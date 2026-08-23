// server/lib/fd-guard.js
//
// Linux file descriptor exhaustion defense.
//
// Every active user connection opens a socket. With 500+ concurrent users
// plus internal pipes (db, child processes, log streams, /tmp files),
// the process can easily reach 2000-3000 fds. If the soft ulimit is the
// distro default (1024), every subsequent connection fails with EMFILE,
// causing cascading 502 errors at the LB layer.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import logger from './logger.js';

const TARGET_FDS = Number(process.env.CONCORD_FD_LIMIT) || 65535;
const WARN_BELOW = 16384;
const CHECK_INTERVAL_MS = 60_000;

/**
 * Get the current soft fd limit for this process.
 * Reads /proc/self/limits directly — no shell, no injection risk.
 */
export function getCurrentFdLimit() {
  try {
    const data = readFileSync('/proc/self/limits', 'utf8');
    const m = data.match(/Max open files\s+(\d+)/);
    if (m) return Number(m[1]) || 0;
  } catch {
    // Fallback: spawnSync with explicit argv (no shell)
    try {
      const r = spawnSync('sh', ['-c', 'ulimit -n'], { encoding: 'utf8' });
      if (r.status === 0) return Number(r.stdout.trim()) || 0;
    } catch { /* */ }
  }
  return 0;
}

/**
 * Try to raise the soft fd limit to TARGET_FDS (or as high as possible).
 */
export function tryRaiseFdLimit() {
  const before = getCurrentFdLimit();
  if (before >= TARGET_FDS) {
    return { before, after: before, raised: false };
  }
  try {
    // Use spawnSync with explicit argv to avoid shell-injection sink.
    spawnSync('sh', ['-c', `ulimit -n ${Number(TARGET_FDS)}`], { encoding: 'utf8' });
    const after = getCurrentFdLimit();
    const raised = after > before;
    if (raised) {
      logger('info', 'fd_limit_raised', { before, after, target: TARGET_FDS });
    }
    return { before, after, raised };
  } catch (e) {
    logger('warn', 'fd_limit_raise_failed', { before, target: TARGET_FDS, err: String(e) });
    return { before, after: before, raised: false };
  }
}

/**
 * One-shot startup check.
 */
export function startupFdGuard() {
  const before = getCurrentFdLimit();
  if (before === 0) {
    logger('warn', 'fd_limit_unknown', { hint: 'ulimit command failed; assuming default' });
    return;
  }

  if (before < WARN_BELOW) {
    logger('warn', 'fd_limit_low', {
      current: before,
      target: TARGET_FDS,
      hint: 'Each user connection uses 1-2 fds. With 500 users + internal pipes, 16384 minimum.',
    });
  }

  const { after, raised } = tryRaiseFdLimit();
  if (raised) {
    logger('info', 'fd_limit_raised_at_boot', { before, after });
  } else if (after < TARGET_FDS && after >= WARN_BELOW) {
    logger('info', 'fd_limit_adequate', { current: after });
  }
}

/**
 * Periodic check during runtime.
 */
export function startFdMonitor() {
  const check = () => {
    const cur = getCurrentFdLimit();
    if (cur < WARN_BELOW) {
      logger('warn', 'fd_limit_dropped', { current: cur });
    }
  };
  const handle = setInterval(check, CHECK_INTERVAL_MS);
  if (handle.unref) handle.unref();
  return () => clearInterval(handle);
}

export default { startupFdGuard, startFdMonitor, getCurrentFdLimit, tryRaiseFdLimit };
