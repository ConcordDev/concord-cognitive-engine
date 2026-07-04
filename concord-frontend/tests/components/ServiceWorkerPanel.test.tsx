import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ServiceWorkerPanel } from '@/components/offline/ServiceWorkerPanel';

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{<ServiceWorkerPanel />}</QueryClientProvider>);
}

function mockServiceWorker(overrides: Partial<{
  getRegistration: () => Promise<unknown>;
  controller: object | null;
  register: () => Promise<unknown>;
}> = {}) {
  const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
  const sw = {
    getRegistration: overrides.getRegistration ?? vi.fn().mockResolvedValue(undefined),
    register: overrides.register ?? vi.fn().mockResolvedValue({ active: true, update: vi.fn().mockResolvedValue(undefined), unregister: vi.fn().mockResolvedValue(true) }),
    controller: overrides.controller ?? null,
    addEventListener: vi.fn((type: string, fn: (...a: unknown[]) => void) => {
      (listeners[type] ??= []).push(fn);
    }),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true, writable: true });
  return { sw, listeners };
}

describe('ServiceWorkerPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    lensRunMock.mockReset();
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { cacheName: 'v1', precache: [], runtimeCaching: [], backgroundSyncTag: 'sync', maxCacheEntries: 100, maxCacheAgeHours: 24 } },
    });
  });

  // Prior tests' components must unmount before the next test's navigator.serviceWorker
  // mock is replaced, or leftover pending effects reference the stale mock and throw.
  afterEach(() => {
    cleanup();
  });

  it('shows "Not supported" when the browser has no serviceWorker API', async () => {
    // The component feature-detects via `'serviceWorker' in navigator` — a
    // property set to `undefined` still counts as present, so the property
    // must be deleted entirely to simulate a truly unsupported browser.
    // @ts-expect-error test-only: deleting a normally-readonly Navigator prop
    delete navigator.serviceWorker;
    renderPanel();
    expect(await screen.findByText(/Not supported in this browser/i)).toBeInTheDocument();
  });

  it('shows "Not registered" and an enable button when no registration exists', async () => {
    mockServiceWorker({ getRegistration: vi.fn().mockResolvedValue(undefined) });
    renderPanel();
    expect(await screen.findByText(/Not registered/i)).toBeInTheDocument();
    expect(screen.getByText(/Enable offline mode/i)).toBeInTheDocument();
  });

  it('shows active + controlling state when a registration is active', async () => {
    const { sw } = mockServiceWorker({
      getRegistration: vi.fn().mockResolvedValue({ active: true, scope: '/' }),
      controller: { postMessage: vi.fn() },
    });
    renderPanel();
    expect(await screen.findByText(/Active — offline caching enabled/i)).toBeInTheDocument();
    expect(sw.getRegistration).toHaveBeenCalledWith('/sw.js');
    expect(screen.getByText(/Disable offline mode/i)).toBeInTheDocument();
  });

  it('register button calls navigator.serviceWorker.register then refreshes state', async () => {
    const registerFn = vi.fn().mockResolvedValue({
      active: true, update: vi.fn().mockResolvedValue(undefined), unregister: vi.fn().mockResolvedValue(true),
    });
    mockServiceWorker({ getRegistration: vi.fn().mockResolvedValue(undefined), register: registerFn });
    renderPanel();
    const btn = await screen.findByText(/Enable offline mode/i);
    fireEvent.click(btn);
    await waitFor(() => expect(registerFn).toHaveBeenCalledWith('/sw.js', { scope: '/' }));
  });

  it('unregister button calls reg.unregister and clears cache stats', async () => {
    const unregisterFn = vi.fn().mockResolvedValue(true);
    mockServiceWorker({
      getRegistration: vi.fn().mockResolvedValue({ active: true, scope: '/', unregister: unregisterFn }),
    });
    renderPanel();
    const btn = await screen.findByText(/Disable offline mode/i);
    fireEvent.click(btn);
    await waitFor(() => expect(unregisterFn).toHaveBeenCalled());
  });

  it('renders the precache manifest once the offline.swManifest macro resolves', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        result: {
          cacheName: 'concord-v3',
          precache: [{ url: '/offline.html', role: 'fallback', strategy: 'cache-first' }],
          runtimeCaching: [{ pattern: '/api/*', strategy: 'network-first', note: 'API calls' }],
          backgroundSyncTag: 'sync-queue', maxCacheEntries: 200, maxCacheAgeHours: 48,
        },
      },
    });
    mockServiceWorker({ getRegistration: vi.fn().mockResolvedValue(undefined) });
    renderPanel();
    expect(await screen.findByText(/concord-v3/)).toBeInTheDocument();
    expect(screen.getByText('/offline.html')).toBeInTheDocument();
    expect(screen.getByText('/api/*')).toBeInTheDocument();
  });

  it('shows an error message when the manifest macro fails', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, error: 'boom' } });
    mockServiceWorker({ getRegistration: vi.fn().mockResolvedValue(undefined) });
    renderPanel();
    expect(await screen.findByText(/Could not load precache manifest/i)).toBeInTheDocument();
  });

  it('refresh button re-queries registration state', async () => {
    const getRegistration = vi.fn().mockResolvedValue(undefined);
    mockServiceWorker({ getRegistration });
    renderPanel();
    await screen.findByText(/Not registered/i);
    const refreshBtn = screen.getByLabelText(/Refresh service worker state/i);
    fireEvent.click(refreshBtn);
    await waitFor(() => expect(getRegistration).toHaveBeenCalledTimes(2));
  });
});
