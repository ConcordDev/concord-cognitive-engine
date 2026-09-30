// server/lib/parallel-agent-fabric.js
//
// P2 — Parallel agent fabric. Runs independent organ tool calls concurrently
// with bounded concurrency; persists per-worker results for crash recovery.

const DEFAULT_CONCURRENCY = Number(process.env.CONCORD_MISSION_PARALLEL_CONCURRENCY) || 3;

function safeParse(json, fallback = null) {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Execute a batch of tool calls in parallel through F0 dispatchMCP.
 *
 * @param {object} opts
 * @param {object} opts.db
 * @param {string} opts.missionId
 * @param {string} opts.traceId
 * @param {Array<{tool:string,args?:object}>} opts.tasks
 * @param {Function} opts.dispatchMCP
 * @param {number} [opts.concurrency]
 * @param {object} [opts.ctx]
 */
export async function runParallelBatch({
  db, missionId, traceId, tasks, dispatchMCP, concurrency = DEFAULT_CONCURRENCY, ctx = {},
}) {
  if (!db || !missionId || !Array.isArray(tasks) || !tasks.length) {
    return { ok: false, reason: "missing_inputs" };
  }
  if (typeof dispatchMCP !== "function") return { ok: false, reason: "missing_dispatch" };

  const cap = Math.min(Math.max(concurrency, 1), 8);
  const results = [];
  let workerIndex = 0;

  // Persist worker rows as pending
  const insert = db.prepare(`
    INSERT OR REPLACE INTO mission_workers
      (mission_id, worker_index, tool_name, args_json, status, trace_id)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `);

  for (const t of tasks) {
    insert.run(missionId, workerIndex, t.tool, JSON.stringify(t.args || {}), traceId || null);
    workerIndex++;
  }

  async function runOne(index, task) {
    const started = Date.now();
    db.prepare(`
      UPDATE mission_workers SET status = 'running', started_at = ? WHERE mission_id = ? AND worker_index = ?
    `).run(nowSec(), missionId, index);

    let gateResult;
    try {
      gateResult = await dispatchMCP(task.tool, task.args || {}, {
        ...ctx,
        trace_id: traceId,
        provenance: { mission_id: missionId, worker_index: index, parallel: true },
      });
    } catch (e) {
      gateResult = { ok: false, error: e?.message || String(e) };
    }

    const durationMs = Date.now() - started;
    const ok = gateResult?.ok !== false && gateResult?.result?.ok !== false;
    const status = ok ? "completed" : "failed";

    db.prepare(`
      UPDATE mission_workers
      SET status = ?, result_json = ?, completed_at = ?, duration_ms = ?
      WHERE mission_id = ? AND worker_index = ?
    `).run(
      status,
      JSON.stringify(gateResult?.result ?? gateResult ?? {}),
      nowSec(),
      durationMs,
      missionId,
      index,
    );

    return { index, tool: task.tool, ok, durationMs, gateResult };
  }

  // Bounded parallel pool
  const queue = tasks.map((t, i) => ({ index: i, task: t }));
  const inFlight = new Set();
  const completed = [];

  await new Promise((resolve) => {
    function pump() {
      while (inFlight.size < cap && queue.length > 0) {
        const { index, task } = queue.shift();
        const p = runOne(index, task).then((r) => {
          completed.push(r);
          inFlight.delete(p);
          pump();
        });
        inFlight.add(p);
      }
      if (inFlight.size === 0 && queue.length === 0) resolve();
    }
    pump();
  });

  completed.sort((a, b) => a.index - b.index);
  const allOk = completed.every((r) => r.ok);
  return {
    ok: allOk,
    missionId,
    workers: completed.length,
    results: completed,
    failed: completed.filter((r) => !r.ok).length,
  };
}

export function listMissionWorkers(db, missionId) {
  if (!db || !missionId) return [];
  try {
    return db.prepare(`
      SELECT worker_index, tool_name, args_json, status, duration_ms, result_json, started_at, completed_at
      FROM mission_workers WHERE mission_id = ? ORDER BY worker_index ASC
    `).all(missionId).map((r) => ({
      ...r,
      args: safeParse(r.args_json, {}),
      result: safeParse(r.result_json, null),
    }));
  } catch {
    return [];
  }
}

export function fabricOverview(db) {
  if (!db) return { ok: false, reason: "no_db" };
  try {
    const rows = db.prepare(`
      SELECT status, COUNT(*) AS c FROM mission_workers GROUP BY status
    `).all();
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.c]));
    return { ok: true, concurrency: DEFAULT_CONCURRENCY, workersByStatus: byStatus };
  } catch {
    return { ok: true, concurrency: DEFAULT_CONCURRENCY, workersByStatus: {} };
  }
}
