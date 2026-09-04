/**
 * FE-018: Lightweight performance observability.
 *
 * Records Web Vitals (LCP, FID, CLS, TTFB) and per-lens navigation timing.
 * Metrics are logged to the console in development and can be forwarded
 * to an analytics endpoint in production via `reportMetric()`.
 */

export interface PerfMetric {
  name: string;
  value: number;
  /** 'navigation' | 'resource' | 'web-vital' | 'custom' */
  kind: string;
  /** ISO timestamp */
  timestamp: string;
  /** Additional context (e.g. lens id, route) */
  meta?: Record<string, string>;
}

type MetricReporter = (metric: PerfMetric) => void;

let reporter: MetricReporter = (metric) => {
  if (process.env.NODE_ENV === 'development') {
    console.debug('[Perf]', metric.name, `${metric.value.toFixed(1)}ms`, metric.meta || '');
    return;
  }
  // In production, beacon metrics to the backend (fire-and-forget, no user data)
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    // sendBeacon's Content-Type defaults to text/plain;charset=UTF-8 when
    // given a plain string, which the backend's express.json() parser never
    // reads — req.body came back empty server-side, so every beacon 400'd
    // with "name and value required" (found live 2026-08-24, real-browser
    // load test). Wrapping in a Blob with an explicit type sets the header
    // sendBeacon actually honors, matching what express.json() expects.
    const payload = new Blob(
      [JSON.stringify({ name: metric.name, value: metric.value, kind: metric.kind })],
      { type: 'application/json' },
    );
    navigator.sendBeacon('/api/metrics/vitals', payload);
  }
};

/** Override the default console reporter (e.g. to POST metrics to an endpoint). */
export function setMetricReporter(fn: MetricReporter) {
  reporter = fn;
}

function report(name: string, value: number, kind: string, meta?: Record<string, string>) {
  reporter({ name, value, kind, timestamp: new Date().toISOString(), meta });
}

/**
 * Observe Web Vitals using the PerformanceObserver API.
 * Call once at app startup (e.g. in Providers.tsx).
 */
export function observeWebVitals() {
  if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return;

  // Largest Contentful Paint
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) report('LCP', last.startTime, 'web-vital');
    });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* unsupported */ }

  // First Input Delay
  try {
    const fidObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const fid = entry as PerformanceEventTiming;
        report('FID', fid.processingStart - fid.startTime, 'web-vital');
      }
    });
    fidObserver.observe({ type: 'first-input', buffered: true });
  } catch { /* unsupported */ }

  // Cumulative Layout Shift
  try {
    let clsValue = 0;
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(entry as unknown as { hadRecentInput: boolean }).hadRecentInput) {
          clsValue += (entry as unknown as { value: number }).value;
        }
      }
      report('CLS', clsValue, 'web-vital');
    });
    clsObserver.observe({ type: 'layout-shift', buffered: true });
  } catch { /* unsupported */ }

  // Time to First Byte
  try {
    const navEntries = performance.getEntriesByType('navigation');
    if (navEntries.length > 0) {
      const nav = navEntries[0] as PerformanceNavigationTiming;
      report('TTFB', nav.responseStart - nav.requestStart, 'web-vital');
    }
  } catch { /* unsupported */ }
}

/**
 * Measure how long a lens takes to become interactive after navigation.
 * Call at the top of a lens page component.
 */
export function markLensLoad(lensId: string) {
  if (typeof performance === 'undefined') return;
  const start = performance.now();

  // Use requestIdleCallback (or setTimeout fallback) to measure after hydration
  const cb = () => {
    const duration = performance.now() - start;
    report('lens-load', duration, 'custom', { lens: lensId });
  };

  if ('requestIdleCallback' in window) {
    (window as unknown as { requestIdleCallback: (cb: () => void, opts: { timeout: number }) => void }).requestIdleCallback(cb, { timeout: 3000 });
  } else {
    setTimeout(cb, 0);
  }
}
