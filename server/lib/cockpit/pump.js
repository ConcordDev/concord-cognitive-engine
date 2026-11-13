// Background driver for due runs (CKPT-09). Does nothing unless the RUNS flag is on.
import { cockpitFlag } from "./flags.js";
import { tablesReady, findDueRuns, getRun } from "./run-store.js";
import { driveRun } from "./engine.js";

/** @returns {Promise<number>} number of runs ticked */
export async function pumpOnce({ db, makeDeps, owner, limit = 3 }) {
  let n = 0;
  for (const id of findDueRuns(db, Math.floor(Date.now() / 1000), limit)) {
    try {
      const run = getRun(db, id);
      if (!run) continue;
      await driveRun({ db, runId: id, owner, deps: makeDeps(run), deadlineMs: Date.now() + 20000, maxTicks: 5 });
      n += 1;
    } catch { /* one run's failure never stops the pump */ }
  }
  return n;
}

export function startCockpitPump({ db, makeDeps, intervalMs = 5000 }) {
  if (!cockpitFlag("RUNS") || !tablesReady(db)) return { stop() {} };
  if (process.env.NODE_ENV === "test" || process.env.CONCORD_NO_LISTEN === "true") return { stop() {} };
  const owner = `pump:${process.pid}`;
  let busy = false;
  const handle = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      let pressured = false;
      try {
        const { getPressureStrikes } = await import("../request-admission.js");
        pressured = Number(getPressureStrikes?.()) > 0;
      } catch { /* admission module optional */ }
      if (!pressured) await pumpOnce({ db, makeDeps, owner });
    } catch { /* the pump never throws */ } finally { busy = false; }
  }, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  return { stop() { clearInterval(handle); } };
}
