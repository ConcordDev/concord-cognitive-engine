/**
 * Simulation Jobs Queue
 *
 * In-memory async job queue for compute-intensive simulation workloads.
 * Supports job types: fea-frame, multiphysics, monte-carlo-stats,
 * chem-balance, quantum-circuit.
 *
 * Pattern matches server/emergent/research-jobs.js.
 * All state in-memory. Silent failure. Export all public functions.
 */

// ── In-Memory State ──────────────────────────────────────────────────────────

const _jobs = new Map();

const MAX_JOBS = 200;

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new simulation job and add it to the queue.
 *
 * @param {string} type - Job type (fea-frame|multiphysics|monte-carlo-stats|chem-balance|quantum-circuit)
 * @param {object} input - Job-specific input payload
 * @returns {{ id: string, status: 'queued' }}
 */
export function createJob(type, input) {
  const id = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id,
    type,
    status:      'queued',
    input,
    result:      null,
    error:       null,
    createdAt:   new Date().toISOString(),
    startedAt:   null,
    completedAt: null,
    progress:    0,
  };
  _jobs.set(id, job);
  return { id, status: 'queued' };
}

/**
 * Retrieve a job by ID.
 *
 * @param {string} id
 * @returns {object|null}
 */
export function getJob(id) {
  return _jobs.get(id) || null;
}

/**
 * List recent jobs sorted newest-first.
 *
 * @param {number} [limit=20]
 * @returns {object[]}
 */
export function listJobs(limit = 20) {
  return [..._jobs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/**
 * Execute a job using the provided executor function.
 * Updates job status through running → completed|failed.
 * Prunes the store to MAX_JOBS entries after completion.
 *
 * @param {string} jobId
 * @param {Function} executor - async () => result
 * @returns {Promise<void>}
 */
export async function runJob(jobId, executor) {
  const job = _jobs.get(jobId);
  if (!job) throw new Error('job not found');

  job.status    = 'running';
  job.startedAt = new Date().toISOString();

  try {
    job.result   = await executor();
    job.status   = 'completed';
    job.progress = 100;
  } catch (e) {
    job.error  = e?.message || String(e);
    job.status = 'failed';
  } finally {
    job.completedAt = new Date().toISOString();
  }

  // Prune: keep only last MAX_JOBS jobs (oldest first)
  if (_jobs.size > MAX_JOBS) {
    const oldest = [..._jobs.keys()].slice(0, _jobs.size - MAX_JOBS);
    oldest.forEach(k => _jobs.delete(k));
  }
}

/**
 * Cancel a queued job.
 * Only jobs in 'queued' state can be cancelled.
 *
 * @param {string} jobId
 * @returns {boolean} true if cancelled, false if not eligible
 */
export function cancelJob(jobId) {
  const job = _jobs.get(jobId);
  if (!job || job.status !== 'queued') return false;
  job.status      = 'cancelled';
  job.completedAt = new Date().toISOString();
  return true;
}
