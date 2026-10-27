// loop-job-tracker.js — cheap, nestable, async-tolerant "what job is blocking the loop?" attribution.
//
// Use this for subsystems whose synchronous work is suspected of freezing the
// event loop (consolidation, archive sweep, shadow cleanup, embedding backfill,
// heartbeat modules). It is NOT a profiler — it only records job names and
// start/end timestamps. The companion drift probe in server.js reads the active
// + recently-ended jobs when the loop stalls and emits them in the structured log.

const MAX_HISTORY = 256; // bounded: live incidents only need the last few jobs

const _stack = [];      // { name, startedAt, token }
const _history = [];    // { name, startedAt, endedAt }

function _pushHistory(job) {
  _history.push(job);
  if (_history.length > MAX_HISTORY) _history.shift();
}

/**
 * Start a job. Returns a token that must be passed to endJob().
 * Jobs can nest (async re-entrancy is OK because each call gets a unique token).
 */
export function beginJob(name, startedAt = Date.now()) {
  const job = { name: String(name || "unknown"), startedAt, token: `${name}:${startedAt}:${Math.random().toString(36).slice(2)}` };
  _stack.push(job);
  return job.token;
}

/**
 * End a job by token. Tolerant of the job already having ended or the token
 * being unknown (returns false). Removes the matching stack entry wherever it
 * sits, so async completions out of order do not corrupt the active list.
 */
export function endJob(token) {
  if (!token) return false;
  for (let i = _stack.length - 1; i >= 0; i--) {
    if (_stack[i].token === token) {
      const job = _stack.splice(i, 1)[0];
      _pushHistory({ name: job.name, startedAt: job.startedAt, endedAt: Date.now() });
      return true;
    }
  }
  return false;
}

/**
 * Run `fn` inside a tracked job. Returns / throws fn's result, ending the job
 * in a finally block.
 */
export async function withJob(name, fn) {
  const token = beginJob(name);
  try {
    return await fn();
  } finally {
    endJob(token);
  }
}

/** Currently active jobs, outermost-first. */
export function activeJobs() {
  return _stack.map((j) => ({ name: j.name, startedAt: j.startedAt }));
}

/** The most recently-ended job, or the outermost active job if none ended yet. */
export function lastJob() {
  if (_history.length) {
    const h = _history[_history.length - 1];
    return { name: h.name, startedAt: h.startedAt, endedAt: h.endedAt };
  }
  if (_stack.length) {
    const j = _stack[_stack.length - 1];
    return { name: j.name, startedAt: j.startedAt, endedAt: null };
  }
  return null;
}

/**
 * Jobs active now or that ended within `windowMs` of `now`.
 * Returns up to `limit` entries sorted by duration desc.
 */
export function jobsInWindow(windowMs = 5000, now = Date.now(), limit = 5) {
  const since = now - windowMs;
  const active = _stack
    .filter((j) => j.startedAt <= now)
    .map((j) => ({ name: j.name, ms: now - j.startedAt, running: true }));
  const recent = _history
    .filter((j) => j.endedAt >= since)
    .map((j) => ({ name: j.name, ms: j.endedAt - j.startedAt, running: false }));
  return [...active, ...recent]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit);
}

/** Test-only: reset all state. */
export function _resetJobsForTest() {
  _stack.length = 0;
  _history.length = 0;
}
