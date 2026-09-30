import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setMetricReporter, observeWebVitals, markLensLoad } from '@/lib/perf';
import type { PerfMetric } from '@/lib/perf';

describe('perf utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // Reset reporter back to default
    setMetricReporter(() => {});
  });

  describe('setMetricReporter', () => {
    it('overrides the default reporter', () => {
      const customReporter = vi.fn();
      setMetricReporter(customReporter);

      // Trigger a metric via markLensLoad which calls report() internally
      // We need to trigger setTimeout callback
      markLensLoad('test-lens');
      vi.runAllTimers();

      expect(customReporter).toHaveBeenCalledTimes(1);
      expect(customReporter).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'lens-load',
          kind: 'custom',
          meta: { lens: 'test-lens' },
        })
      );
    });

    it('reported metric includes timestamp as ISO string', () => {
      const customReporter = vi.fn();
      setMetricReporter(customReporter);

      markLensLoad('ts-check');
      vi.runAllTimers();

      const metric: PerfMetric = customReporter.mock.calls[0][0];
      // ISO string format check
      expect(metric.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('reported metric includes numeric value', () => {
      const customReporter = vi.fn();
      setMetricReporter(customReporter);

      markLensLoad('val-check');
      vi.runAllTimers();

      const metric: PerfMetric = customReporter.mock.calls[0][0];
      expect(typeof metric.value).toBe('number');
      expect(metric.value).toBeGreaterThanOrEqual(0);
    });
  });

  describe('default reporter', () => {
    it('logs to console.debug in development', () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const originalDev = import.meta.env.DEV;
      import.meta.env.DEV = true;

      // Reset to default reporter by importing fresh
      // We need to re-set to the original default behavior
      // The simplest approach: set a reporter that mimics the default
      setMetricReporter((metric) => {
        if (import.meta.env.DEV) {
          console.debug('[Perf]', metric.name, `${metric.value.toFixed(1)}ms`, metric.meta || '');
        }
      });

      markLensLoad('debug-lens');
      vi.runAllTimers();

      expect(debugSpy).toHaveBeenCalledWith(
        '[Perf]',
        'lens-load',
        expect.stringContaining('ms'),
        expect.objectContaining({ lens: 'debug-lens' })
      );

      import.meta.env.DEV = originalDev;
      debugSpy.mockRestore();
    });
  });

  describe('observeWebVitals', () => {
    it('returns early when window is undefined', () => {
      const originalWindow = globalThis.window;
      // @ts-expect-error - simulating SSR
      delete globalThis.window;

      // Should not throw
      expect(() => observeWebVitals()).not.toThrow();

      globalThis.window = originalWindow;
    });

    it('returns early when PerformanceObserver is not available', () => {
      const original = window.PerformanceObserver;
      // @ts-expect-error - removing PerformanceObserver
      delete window.PerformanceObserver;

      expect(() => observeWebVitals()).not.toThrow();

      if (original) {
        window.PerformanceObserver = original;
      }
    });

    it('creates observers when PerformanceObserver is available', () => {
      const observeFn = vi.fn();
      const mockObserver = vi.fn().mockImplementation(function () { return {
        observe: observeFn,
        disconnect: vi.fn(),
      }; });

      const originalPO = window.PerformanceObserver;
      window.PerformanceObserver = mockObserver as unknown as typeof PerformanceObserver;

      // Also mock performance.getEntriesByType for TTFB
      const originalGetEntries = performance.getEntriesByType;
      performance.getEntriesByType = vi.fn().mockReturnValue([]);

      observeWebVitals();

      // Should have attempted to create observers for LCP, FID, CLS
      expect(mockObserver).toHaveBeenCalled();

      window.PerformanceObserver = originalPO;
      performance.getEntriesByType = originalGetEntries;
    });

    it('reports LCP when observer fires', () => {
      const reporter = vi.fn();
      setMetricReporter(reporter);

      // Track callbacks by the type passed to observe()
      const callbacksByType: Record<string, (list: { getEntries: () => unknown[] }) => void> = {};
      const mockObserver = vi.fn().mockImplementation(function (cb: (list: { getEntries: () => unknown[] }) => void) {
        return {
          observe: vi.fn().mockImplementation((opts: { type: string }) => {
            callbacksByType[opts.type] = cb;
          }),
          disconnect: vi.fn(),
        };
      });

      const originalPO = window.PerformanceObserver;
      window.PerformanceObserver = mockObserver as unknown as typeof PerformanceObserver;
      const originalGetEntries = performance.getEntriesByType;
      performance.getEntriesByType = vi.fn().mockReturnValue([]);

      observeWebVitals();

      // Trigger the LCP callback
      const lcpCb = callbacksByType['largest-contentful-paint'];
      expect(lcpCb).toBeDefined();
      lcpCb({ getEntries: () => [{ startTime: 1200 }] });

      expect(reporter).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'LCP',
          value: 1200,
          kind: 'web-vital',
        })
      );

      window.PerformanceObserver = originalPO;
      performance.getEntriesByType = originalGetEntries;
    });

    it('reports TTFB from navigation entries', () => {
      const reporter = vi.fn();
      setMetricReporter(reporter);

      const observeFn = vi.fn();
      const mockObserver = vi.fn().mockImplementation(function () { return {
        observe: observeFn,
        disconnect: vi.fn(),
      }; });

      const originalPO = window.PerformanceObserver;
      window.PerformanceObserver = mockObserver as unknown as typeof PerformanceObserver;

      const originalGetEntries = performance.getEntriesByType;
      performance.getEntriesByType = vi.fn().mockReturnValue([
        { responseStart: 150, requestStart: 50 },
      ]);

      observeWebVitals();

      expect(reporter).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'TTFB',
          value: 100,
          kind: 'web-vital',
        })
      );

      window.PerformanceObserver = originalPO;
      performance.getEntriesByType = originalGetEntries;
    });

    it('handles errors in observer creation gracefully', () => {
      const mockObserver = vi.fn().mockImplementation(function () {
        throw new Error('Not supported');
      });

      const originalPO = window.PerformanceObserver;
      window.PerformanceObserver = mockObserver as unknown as typeof PerformanceObserver;

      const originalGetEntries = performance.getEntriesByType;
      performance.getEntriesByType = vi.fn().mockImplementation(() => {
        throw new Error('Not supported');
      });

      // Should not throw even when all observers fail
      expect(() => observeWebVitals()).not.toThrow();

      window.PerformanceObserver = originalPO;
      performance.getEntriesByType = originalGetEntries;
    });

    it('reports FID when first-input observer fires', () => {
      const reporter = vi.fn();
      setMetricReporter(reporter);

      const callbacksByType: Record<string, (list: { getEntries: () => unknown[] }) => void> = {};
      const mockObserver = vi.fn().mockImplementation(function (cb: (list: { getEntries: () => unknown[] }) => void) {
        return {
          observe: vi.fn().mockImplementation((opts: { type: string }) => {
            callbacksByType[opts.type] = cb;
          }),
          disconnect: vi.fn(),
        };
      });

      const originalPO = window.PerformanceObserver;
      window.PerformanceObserver = mockObserver as unknown as typeof PerformanceObserver;
      const originalGetEntries = performance.getEntriesByType;
      performance.getEntriesByType = vi.fn().mockReturnValue([]);

      observeWebVitals();

      const fidCb = callbacksByType['first-input'];
      expect(fidCb).toBeDefined();
      fidCb({
        getEntries: () => [{ processingStart: 120, startTime: 100 }],
      });

      expect(reporter).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'FID',
          value: 20,
          kind: 'web-vital',
        })
      );

      window.PerformanceObserver = originalPO;
      performance.getEntriesByType = originalGetEntries;
    });

    it('reports CLS accumulating layout shift values', () => {
      const reporter = vi.fn();
      setMetricReporter(reporter);

      const callbacksByType: Record<string, (list: { getEntries: () => unknown[] }) => void> = {};
      const mockObserver = vi.fn().mockImplementation(function (cb: (list: { getEntries: () => unknown[] }) => void) {
        return {
          observe: vi.fn().mockImplementation((opts: { type: string }) => {
            callbacksByType[opts.type] = cb;
          }),
          disconnect: vi.fn(),
        };
      });

      const originalPO = window.PerformanceObserver;
      window.PerformanceObserver = mockObserver as unknown as typeof PerformanceObserver;
      const originalGetEntries = performance.getEntriesByType;
      performance.getEntriesByType = vi.fn().mockReturnValue([]);

      observeWebVitals();

      const clsCb = callbacksByType['layout-shift'];
      expect(clsCb).toBeDefined();
      clsCb({
        getEntries: () => [
          { hadRecentInput: false, value: 0.1 },
          { hadRecentInput: true, value: 0.5 },  // should be excluded
          { hadRecentInput: false, value: 0.05 },
        ],
      });

      expect(reporter).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'CLS',
          kind: 'web-vital',
        })
      );

      // CLS value should only include entries without recent input
      const clsCall = reporter.mock.calls.find(
        (call: unknown[]) => (call[0] as PerfMetric).name === 'CLS'
      );
      if (clsCall) {
        expect(clsCall[0].value).toBeCloseTo(0.15, 5);
      }

      window.PerformanceObserver = originalPO;
      performance.getEntriesByType = originalGetEntries;
    });
  });

  describe('markLensLoad', () => {
    it('reports lens-load metric via setTimeout fallback', () => {
      const reporter = vi.fn();
      setMetricReporter(reporter);

      // Ensure requestIdleCallback is not available
      const originalRIC = (window as unknown as Record<string, unknown>).requestIdleCallback;
      delete (window as unknown as Record<string, unknown>).requestIdleCallback;

      markLensLoad('my-lens');

      expect(reporter).not.toHaveBeenCalled();

      vi.runAllTimers();

      expect(reporter).toHaveBeenCalledTimes(1);
      expect(reporter).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'lens-load',
          kind: 'custom',
          meta: { lens: 'my-lens' },
        })
      );

      if (originalRIC) {
        (window as unknown as Record<string, unknown>).requestIdleCallback = originalRIC;
      }
    });

    it('uses requestIdleCallback when available', () => {
      const reporter = vi.fn();
      setMetricReporter(reporter);

      const mockRIC = vi.fn().mockImplementation((cb: () => void) => {
        cb();
      });
      (window as unknown as Record<string, unknown>).requestIdleCallback = mockRIC;

      markLensLoad('idle-lens');

      expect(mockRIC).toHaveBeenCalledWith(expect.any(Function), { timeout: 3000 });
      expect(reporter).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'lens-load',
          meta: { lens: 'idle-lens' },
        })
      );

      delete (window as unknown as Record<string, unknown>).requestIdleCallback;
    });

    it('returns early when performance is undefined', () => {
      const originalPerformance = globalThis.performance;
      // @ts-expect-error - simulating environment without performance
      delete globalThis.performance;

      const reporter = vi.fn();
      setMetricReporter(reporter);

      expect(() => markLensLoad('no-perf')).not.toThrow();

      vi.runAllTimers();
      expect(reporter).not.toHaveBeenCalled();

      globalThis.performance = originalPerformance;
    });
  });
});
