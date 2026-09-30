import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
}));

import { useWalletBalance } from '@/hooks/useWalletBalance';

// Regression coverage: HUDOverlay's bottom-bar currency readout used to
// pass a literal `{ concordCoin: 0 }` regardless of the player's real
// balance (a "zero demo content" violation — see the HUD-honesty fix in
// components/world/WorldOsSurface.tsx). This hook is the shared real source both
// CurrencyHUD and HUDOverlay now read from instead of each maintaining
// (or, in HUDOverlay's case, fabricating) their own copy.
describe('useWalletBalance', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fetches the real balance from /api/economy/balance on mount', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, balance: 4200 }) }),
    ));
    const { result } = renderHook(() => useWalletBalance());
    expect(result.current).toBe(0);
    await waitFor(() => expect(result.current).toBe(4200));
  });

  it('falls back to concordCoins field, then 0, when balance is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, concordCoins: 17 }) }),
    ));
    const { result } = renderHook(() => useWalletBalance());
    await waitFor(() => expect(result.current).toBe(17));
  });

  it('keeps the last known balance on a failed fetch instead of resetting to 0', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, balance: 900 }) });
      return Promise.reject(new Error('network down'));
    }));
    const { result } = renderHook(() => useWalletBalance());
    await waitFor(() => expect(result.current).toBe(900));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(result.current).toBe(900);
  });
});
