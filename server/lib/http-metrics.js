/**
 * Concord Cognitive Engine — HTTP Metrics Middleware
 *
 * Collects Prometheus-compatible HTTP metrics:
 * - Request counts by status code
 * - Duration histogram with standard buckets
 * - Error counts (4xx/5xx)
 * - Active request gauge for graceful shutdown
 */

import { noteInflightResponse } from "./shutdown-http.js";

const HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

// Global metrics store
const metrics = {
  totalRequests: 0,
  totalDuration: 0,
  errorCount: 0,
  activeRequests: 0,
  statusCodes: {},
  durationBuckets: {},
};

// Initialize buckets
for (const b of HISTOGRAM_BUCKETS) {
  metrics.durationBuckets[b] = 0;
}

/**
 * Express middleware that tracks HTTP request metrics.
 */
export function httpMetricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  metrics.activeRequests++;
  // The shutdown drain waits on these response objects, not the counter.
  noteInflightResponse(res);

  const onFinish = () => {
    res.removeListener("finish", onFinish);
    res.removeListener("close", onFinish);

    metrics.activeRequests--;
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationS = durationNs / 1e9;

    metrics.totalRequests++;
    metrics.totalDuration += durationS;

    // Status code counter
    const status = res.statusCode;
    const bucket = `${Math.floor(status / 100)}xx`;
    metrics.statusCodes[bucket] = (metrics.statusCodes[bucket] || 0) + 1;

    // Error counter
    if (status >= 400) {
      metrics.errorCount++;
    }

    // Histogram buckets
    for (const le of HISTOGRAM_BUCKETS) {
      if (durationS <= le) {
        metrics.durationBuckets[le]++;
      }
    }
  };

  res.on("finish", onFinish);
  res.on("close", onFinish);
  next();
}

/**
 * Returns current active request count (for graceful shutdown).
 */
export function getActiveRequests() {
  return metrics.activeRequests;
}

/**
 * Install metrics on globalThis for Prometheus endpoint access.
 */
export function installGlobalMetrics() {
  globalThis._concordHttpMetrics = metrics;
}
