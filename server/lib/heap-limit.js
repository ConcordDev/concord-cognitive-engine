// INC-149: the real V8 heap ceiling.
//
// The backend runs as `node --max-old-space-size=3072 server.js` and the env var
// MAX_OLD_SPACE_SIZE is NOT set, so code that read `process.env.MAX_OLD_SPACE_SIZE
// || 32768` believed the heap could reach 32 GB. The memory watchdog therefore
// never warned/shed/evicted, /health never flagged pressure, and the process hit
// the actual 3 GB limit and died ("Ineffective mark-compacts near heap limit").
//
// V8's own heap_size_limit reflects --max-old-space-size (and NODE_OPTIONS), so it
// is the source of truth. MAX_OLD_SPACE_SIZE only wins when it is LOWER than the
// real limit (an operator asking for earlier shedding) — never higher, because a
// number above the real ceiling hides pressure.
import v8 from "node:v8";

const MB = 1024 * 1024;

export function getHeapLimitMB(env = process.env) {
  let real = null;
  try {
    const lim = v8.getHeapStatistics().heap_size_limit;
    if (Number.isFinite(lim) && lim > 0) real = Math.round(lim / MB);
  } catch { /* restricted runtime */ }
  const fromEnv = Number(env?.MAX_OLD_SPACE_SIZE);
  const envOk = Number.isFinite(fromEnv) && fromEnv > 0;
  if (real && envOk) return Math.min(real, fromEnv);
  if (real) return real;
  if (envOk) return fromEnv;
  return 32768;
}

// Real process memory for diagnostics (MB, rounded) + heap use as % of the limit.
export function getMemorySnapshot() {
  const mu = process.memoryUsage();
  const heapLimitMB = getHeapLimitMB();
  const heapUsedMB = Math.round(mu.heapUsed / MB);
  return {
    rssMB: Math.round(mu.rss / MB),
    heapUsedMB,
    heapTotalMB: Math.round(mu.heapTotal / MB),
    externalMB: Math.round(mu.external / MB),
    arrayBuffersMB: Math.round((mu.arrayBuffers || 0) / MB),
    heapLimitMB,
    heapUsedPct: heapLimitMB ? Math.round((heapUsedMB / heapLimitMB) * 1000) / 10 : null,
  };
}
