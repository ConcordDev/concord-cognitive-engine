/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * Pins the DET-C batch 5 fix for PortfolioWorkbench: the server already
 * emits a real, correctly room-scoped 'crypto:alert' socket event
 * (server/domains/crypto.js#alert-deliver passes { userId }), but no
 * frontend code ever subscribed to it — a live-crossing alert only
 * surfaced after the user manually re-clicked "Check & deliver". The
 * component now subscribes via lib/realtime/socket#subscribe and toasts +
 * refreshes the delivered-alerts list on the real event.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('@/lib/realtime/socket', () => {
  const listeners: Record<string, Array<(data: unknown) => void>> = {};
  return {
    subscribe: vi.fn((event: string, cb: (data: unknown) => void) => {
      (listeners[event] ||= []).push(cb);
      return () => {
        listeners[event] = (listeners[event] || []).filter((f) => f !== cb);
      };
    }),
    __emit: (event: string, data?: unknown) => {
      (listeners[event] || []).forEach((cb) => cb(data));
    },
  };
});

const showToastMock = vi.fn();
vi.mock('@/components/common/Toasts', () => ({
  showToast: (...args: unknown[]) => showToastMock(...args),
}));

vi.mock('@/components/viz/ChartKit', () => ({
  ChartKit: () => null,
}));

import { PortfolioWorkbench } from '@/components/crypto/PortfolioWorkbench';
import * as socketMock from '@/lib/realtime/socket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

describe('PortfolioWorkbench — crypto:alert realtime wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'alert-deliveries-list') {
        return Promise.resolve({ data: { ok: true, result: { deliveries: [], unreadCount: 0 }, error: null } });
      }
      if (action === 'holdings-list') {
        return Promise.resolve({ data: { ok: true, result: { holdings: [] }, error: null } });
      }
      if (action === 'staking-positions-list') {
        return Promise.resolve({ data: { ok: true, result: { positions: [] }, error: null } });
      }
      if (action === 'onchain-syncs-list') {
        return Promise.resolve({ data: { ok: true, result: { syncs: [] }, error: null } });
      }
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('toasts and refetches delivered alerts on a real crypto:alert socket event', async () => {
    render(<PortfolioWorkbench />);

    await waitFor(() =>
      expect(lensRunMock.mock.calls.some((c) => c[1] === 'alert-deliveries-list')).toBe(true),
    );
    const deliveriesCallsAfterMount = lensRunMock.mock.calls.filter((c) => c[1] === 'alert-deliveries-list').length;

    emitSocket('crypto:alert', { message: 'BTC is above $50000 — now $50123', symbol: 'BTC' });

    await waitFor(() => expect(showToastMock).toHaveBeenCalled());
    expect(showToastMock.mock.calls[0][0]).toBe('info');
    expect(showToastMock.mock.calls[0][1]).toContain('BTC');

    await waitFor(() =>
      expect(
        lensRunMock.mock.calls.filter((c) => c[1] === 'alert-deliveries-list').length,
      ).toBeGreaterThan(deliveriesCallsAfterMount),
    );
  });
});
