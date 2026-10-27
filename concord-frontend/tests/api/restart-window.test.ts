import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRestartWindow, isRestartFailure, RESTART_WINDOW_MS, RESTART_PROBE_INTERVAL_MS } from '@/lib/api/restart-window';

describe('isRestartFailure', () => {
  it('treats 502/503/504 and no-response failures as restart-shaped', () => {
    expect(isRestartFailure(502, true)).toBe(true);
    expect(isRestartFailure(503, true)).toBe(true);
    expect(isRestartFailure(504, true)).toBe(true);
    expect(isRestartFailure(undefined, false)).toBe(true);
  });

  it('does not treat app errors as restart-shaped', () => {
    expect(isRestartFailure(500, true)).toBe(false);
    expect(isRestartFailure(429, true)).toBe(false);
    expect(isRestartFailure(400, true)).toBe(false);
  });
});

describe('createRestartWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds entries inside the window without recording them', async () => {
    const record = vi.fn();
    const win = createRestartWindow<string>({ isHealthy: () => Promise.resolve(false), record });

    win.hold('a');
    win.hold('b');
    expect(win.isOpen()).toBe(true);
    expect(record).not.toHaveBeenCalled();
  });

  it('drops held entries when the backend is healthy again inside the window', async () => {
    const record = vi.fn();
    const isHealthy = vi.fn().mockResolvedValue(true);
    const win = createRestartWindow<string>({ isHealthy, record });

    win.hold('a');
    await vi.advanceTimersByTimeAsync(RESTART_PROBE_INTERVAL_MS);

    expect(isHealthy).toHaveBeenCalled();
    expect(win.isOpen()).toBe(false);
    await vi.advanceTimersByTimeAsync(RESTART_WINDOW_MS);
    expect(record).not.toHaveBeenCalled();
  });

  it('records held entries when the window ends and the backend is still failing', async () => {
    const record = vi.fn();
    const win = createRestartWindow<string>({ isHealthy: () => Promise.resolve(false), record });

    win.hold('a');
    win.hold('b');
    await vi.advanceTimersByTimeAsync(RESTART_WINDOW_MS - 1);
    expect(record).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(record.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    expect(win.isOpen()).toBe(false);
  });

  it('treats a failing probe as not yet healthy', async () => {
    const record = vi.fn();
    const win = createRestartWindow<string>({ isHealthy: () => Promise.reject(new Error('down')), record });

    win.hold('a');
    await vi.advanceTimersByTimeAsync(RESTART_WINDOW_MS);
    expect(record).toHaveBeenCalledWith('a');
  });

  it('open() alone holds nothing and does not record anything', async () => {
    const record = vi.fn();
    const win = createRestartWindow<string>({ isHealthy: () => Promise.resolve(false), record });

    win.open();
    expect(win.isOpen()).toBe(true);
    await vi.advanceTimersByTimeAsync(RESTART_WINDOW_MS);
    expect(record).not.toHaveBeenCalled();
    expect(win.isOpen()).toBe(false);
  });

  it('a new failure after the window closed opens a fresh window', async () => {
    const record = vi.fn();
    const win = createRestartWindow<string>({ isHealthy: () => Promise.resolve(true), record });

    win.hold('first');
    await vi.advanceTimersByTimeAsync(RESTART_PROBE_INTERVAL_MS);
    expect(win.isOpen()).toBe(false);

    win.hold('second');
    expect(win.isOpen()).toBe(true);
    expect(record).not.toHaveBeenCalled();
  });
});
