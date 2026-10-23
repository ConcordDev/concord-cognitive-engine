// Event-loop stall profiler — names the code that froze the loop.
//
// Why this exists: the lag monitor in server.js measures HOW LONG the loop
// stalled (perf_hooks histogram) but attribution came from hand-placed
// recordLagWork() stamps, which only cover a few subsystems. Live logs
// (2026-10-19..22) had ~1,000 lag events/day, max 52 s, effectively all
// "culprit":"unattributed". A stall is synchronous JS by definition, so the
// honest way to name it is to sample the stack while it happens.
//
// How: an in-process inspector session runs V8's sampling CPU profiler for
// one capture window. V8 samples from its own thread, so a blocked main
// thread is still sampled. At the end, every run of consecutive non-idle
// samples above the threshold is attributed to the deepest frame in our own
// source (not node_modules / node internals) — i.e. the line in Concord that
// made the blocking call — plus the hottest leaf frames inside the run.
//
// One-shot by design: Profiler.start costs ~650 ms on the live heap, so a
// rolling profiler would cause the stalls it measures. Start/stop cost is
// logged. Opt-in via CONCORD_LAG_PROFILER=1 (wired in server.js).

import inspector from "node:inspector";

const IDLE = "(idle)";

/** Is this call frame Concord's own source (not deps / node internals / VM pseudo-frames)? */
export function isAppFrame(cf, appRoot) {
  const url = cf?.url || "";
  if (!url || url.startsWith("node:")) return false;
  if (url.includes("/node_modules/")) return false;
  return appRoot ? url.includes(appRoot) : url.startsWith("file:") || url.startsWith("/");
}

function frameLabel(cf, appRoot) {
  let url = cf?.url || "";
  if (appRoot && url.includes(appRoot)) url = url.slice(url.indexOf(appRoot) + appRoot.length).replace(/^\/+/, "");
  else if (url.startsWith("node:")) { /* keep */ } else if (url.includes("/node_modules/")) url = "node_modules/" + url.split("/node_modules/").pop();
  const fn = cf?.functionName || "(anonymous)";
  // V8 lineNumber is 0-based.
  return url ? `${fn} ${url}:${(cf.lineNumber ?? -1) + 1}` : fn;
}

/**
 * Pure analysis of a V8 CPU profile. Finds every contiguous run of busy
 * (non-idle) samples lasting at least `minStallMs` and attributes each one.
 *
 * A "busy run" is NOT necessarily one blocking task: work that yields via
 * setImmediate between batches never goes idle, so consecutive batches show
 * up as one run (live 2026-10-22: a 10.5 s NPC-tick run whose longest real
 * block, per the perf_hooks lag monitor, was ~0.4 s). Read these as "what
 * kept the loop busy", and use event_loop_lag_spike/burst_lag maxMs for how
 * long it was actually blocked.
 * "(garbage collector)" and "(program)" samples count as busy — a GC pause
 * stalls the loop exactly like JS does, and is reported by that name.
 *
 * @param {object} profile  V8 Profiler.Profile ({nodes, samples, timeDeltas, startTime, endTime})
 * @param {{appRoot?: string, minStallMs?: number}} opts
 * @returns {Array<{stallMs:number, startOffsetMs:number, owner:string|null, owners:string[], leaves:string[], stack:string[], samples:number}>}
 *          longest first
 */
export function findStalls(profile, { appRoot = "", minStallMs = 500 } = {}) {
  const nodes = profile?.nodes;
  const samples = profile?.samples;
  const deltas = profile?.timeDeltas;
  if (!Array.isArray(nodes) || !Array.isArray(samples) || !Array.isArray(deltas) || samples.length === 0) return [];

  const byId = new Map();
  const parent = new Map();
  for (const n of nodes) byId.set(n.id, n);
  for (const n of nodes) for (const c of n.children || []) parent.set(c, n.id);

  // Sample timestamps (µs, profile clock). A sample's weight is the gap to the
  // next sample (or to endTime for the last one).
  const ts = new Array(samples.length);
  let t = profile.startTime || 0;
  for (let i = 0; i < samples.length; i++) { t += deltas[i] || 0; ts[i] = t; }
  const nextT = (i) => (i + 1 < ts.length ? ts[i + 1] : (profile.endTime || ts[i]));

  const runs = [];
  let runStart = -1;
  const isIdle = (i) => byId.get(samples[i])?.callFrame?.functionName === IDLE;
  const close = (endIdx) => {
    if (runStart < 0) return;
    const us = nextT(endIdx) - ts[runStart];
    if (us / 1000 >= minStallMs) runs.push([runStart, endIdx, us]);
    runStart = -1;
  };
  for (let i = 0; i < samples.length; i++) {
    if (isIdle(i)) close(i - 1);
    else if (runStart < 0) runStart = i;
  }
  close(samples.length - 1);

  const top = (m, k) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  const fmt = (m, k) => top(m, k).map(([l, ms]) => `${l} (${Math.round(ms)}ms)`);

  return runs.sort((a, b) => b[2] - a[2]).map(([s, e, us]) => {
    const owners = new Map();
    const leaves = new Map();
    const stacks = new Map();
    for (let i = s; i <= e; i++) {
      const w = (nextT(i) - ts[i]) / 1000;
      const leaf = byId.get(samples[i]);
      const leafLabel = frameLabel(leaf?.callFrame, appRoot);
      leaves.set(leafLabel, (leaves.get(leafLabel) || 0) + w);
      // Walk to root; the first app frame met walking up is the deepest one.
      let owner = null;
      const chain = [];
      for (let id = samples[i]; id != null; id = parent.get(id)) {
        const cf = byId.get(id)?.callFrame;
        if (isAppFrame(cf, appRoot)) {
          const lbl = frameLabel(cf, appRoot);
          if (!owner) owner = lbl;
          chain.push(lbl);
        }
      }
      const ownerKey = owner || leafLabel;
      owners.set(ownerKey, (owners.get(ownerKey) || 0) + w);
      const stackKey = chain.reverse().join(" > ");
      if (stackKey) stacks.set(stackKey, (stacks.get(stackKey) || 0) + w);
    }
    const ownerTop = top(owners, 1)[0];
    const stackTop = top(stacks, 1)[0];
    return {
      stallMs: Math.round(us / 1000),
      startOffsetMs: Math.round((ts[s] - (profile.startTime || 0)) / 1000),
      owner: ownerTop ? ownerTop[0] : null,
      owners: fmt(owners, 3),
      leaves: fmt(leaves, 3),
      stack: stackTop ? stackTop[0].split(" > ").slice(-8) : [],
      samples: e - s + 1,
    };
  });
}

/** Longest stall in the profile, or null. */
export function analyzeProfile(profile, opts = {}) {
  return findStalls(profile, opts)[0] || null;
}

/**
 * One-shot capture: profile for `durationMs`, then log every stall found and
 * stop. Deliberately NOT a rolling profiler — measured on the live heap
 * (2026-10-22), Profiler.start costs ~650 ms because V8 re-logs every code
 * object, so restarting every window would itself stall the loop. One start,
 * one stop, then nothing: the same cost profile as the manual capture that
 * found the NPC-tick stalls.
 * @param {object} opts
 * @param {(finding: object) => void} opts.onStall  called once per stall (findStalls() entry + {at})
 * @param {(event: string, data: object) => void} [opts.onEvent]  lifecycle/self-cost reporting
 * @returns {{stop: () => void}}
 */
export function startLagProfiler({
  durationMs = 10 * 60_000,
  samplingIntervalUs = 10_000,
  minStallMs = 500,
  maxReported = 50,
  appRoot = "",
  onStall,
  onEvent = () => {},
} = {}) {
  let session;
  let timer = null;
  let done = false;
  const post = (method, params) => new Promise((resolve, reject) => {
    session.post(method, params || {}, (err, res) => (err ? reject(err) : resolve(res)));
  });

  function stop() {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    timer = null;
    try { session?.post("Profiler.stop", () => {}); session?.disconnect(); } catch (_e) { /* best effort */ }
  }

  const finish = async () => {
    if (done) return;
    let profile;
    try {
      const t0 = performance.now();
      ({ profile } = await post("Profiler.stop"));
      onEvent("lag_profiler_stopped", { stopMs: Math.round(performance.now() - t0) });
    } catch (e) {
      onEvent("lag_profiler_error", { error: String(e?.message || e) });
      stop();
      return;
    }
    stop();
    try {
      const stalls = findStalls(profile, { appRoot, minStallMs });
      const wallStart = Date.now() - Math.round(((profile.endTime || 0) - (profile.startTime || 0)) / 1000);
      for (const f of stalls.slice(0, maxReported)) {
        onStall({ ...f, at: new Date(wallStart + f.startOffsetMs).toISOString() });
      }
      onEvent("lag_profiler_summary", { stalls: stalls.length, reported: Math.min(stalls.length, maxReported), minStallMs, durationMs });
    } catch (e) {
      onEvent("lag_profiler_analyze_error", { error: String(e?.message || e) });
    }
  };

  (async () => {
    try {
      session = new inspector.Session();
      session.connect();
      await post("Profiler.enable");
      await post("Profiler.setSamplingInterval", { interval: samplingIntervalUs });
      const t0 = performance.now();
      await post("Profiler.start");
      onEvent("lag_profiler_started", { durationMs, samplingIntervalUs, minStallMs, startMs: Math.round(performance.now() - t0) });
      if (done) return;
      timer = setTimeout(() => { finish(); }, durationMs);
      timer.unref?.();
    } catch (e) {
      onEvent("lag_profiler_unavailable", { error: String(e?.message || e) });
      stop();
    }
  })();

  return { stop };
}

/**
 * Log individual GC pauses at or above `minMs`. A multi-second GC pause is
 * the signature of a heap near its ceiling or a heap that has been paged
 * out to swap (major GC must touch every page) — and it is invisible to the
 * CPU-profile attribution above unless the pause lands inside a window.
 * Cheap: perf_hooks emits one entry per GC; we filter and log only long ones.
 * @param {{minMs?: number, onPause: (p: {kind: string, ms: number, at: string}) => void}} opts
 * @returns {{stop: () => void}}
 */
export async function startGcPauseLogger({ minMs = 250, onPause } = {}) {
  const { PerformanceObserver, constants } = await import("node:perf_hooks");
  const KIND = {
    [constants.NODE_PERFORMANCE_GC_MAJOR]: "major",
    [constants.NODE_PERFORMANCE_GC_MINOR]: "minor",
    [constants.NODE_PERFORMANCE_GC_INCREMENTAL]: "incremental",
    [constants.NODE_PERFORMANCE_GC_WEAKCB]: "weakcb",
  };
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.duration < minMs) continue;
      try {
        onPause({
          kind: KIND[e.detail?.kind] || String(e.detail?.kind ?? "unknown"),
          ms: Math.round(e.duration),
          at: new Date(performance.timeOrigin + e.startTime).toISOString(),
        });
      } catch (_e) { /* informational */ }
    }
  });
  obs.observe({ entryTypes: ["gc"] });
  return { stop: () => obs.disconnect() };
}
