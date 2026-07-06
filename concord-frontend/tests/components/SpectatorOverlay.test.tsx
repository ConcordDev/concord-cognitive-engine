/**
 * Pins the /api/lens/run envelope-unwrap fix for SpectatorOverlay (finding 24).
 *
 * Pre-fix, refreshCount read `j?.data?.spectators || j?.spectators` — neither
 * path reaches the real payload, which POST /api/lens/run nests at
 * `j.result.spectators` (the transport envelope is `{ ok: true, result: PAYLOAD
 * }`, and `spectator.list_for_world` returns `{ ok, worldId, spectators }` as
 * PAYLOAD). The subscriber count badge was therefore always null.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';

// SpectatorOverlay subscribes to socket events for its backstop-refresh
// pattern (useRealtimeRefresh) and plays a juice sfx on enter — neither is
// under test here, so both are stubbed to keep this a pure fetch/state unit.
vi.mock('@/lib/realtime/socket', () => ({ subscribe: () => () => {} }));
vi.mock('@/lib/concordia/juice', () => ({ sfx: () => {} }));

import { SpectatorOverlay } from '@/components/world/SpectatorOverlay';

function envelope(macroPayload: Record<string, unknown>) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ok: true, result: macroPayload }),
  });
}

function fetchRouter() {
  return vi.fn((_url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) || '{}');
    if (body?.name === 'subscribe') return envelope({ ok: true });
    if (body?.name === 'list_for_world') {
      return envelope({ ok: true, worldId: body.input?.worldId, spectators: ['u1', 'u2', 'u3'] });
    }
    return envelope({ ok: false, reason: 'unknown_macro' });
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchRouter());
});

describe('SpectatorOverlay — envelope unwrap (finding 24)', () => {
  it('shows the subscriber count read from result.spectators', async () => {
    const { container } = render(<SpectatorOverlay />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('concordia:enter-spectator-mode', {
        detail: { worldId: 'concordia-hub', context: 'brawl' },
      }));
    });
    await waitFor(() => expect(container.textContent).toMatch(/3 watching/));
  });

  it('renders nothing before entering spectator mode', () => {
    const { container } = render(<SpectatorOverlay />);
    expect(container.textContent).toBe('');
  });

  it('regression guard: legacy top-level/data-nested paths do not populate the count', async () => {
    // Simulates the exact two shapes the old buggy code checked
    // (`j.data.spectators` and top-level `j.spectators`) alongside the real
    // envelope — proves the fix reads `.result.spectators` specifically and
    // not one of the old dead paths.
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) || '{}');
      if (body?.name === 'subscribe') return envelope({ ok: true });
      if (body?.name === 'list_for_world') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: { spectators: ['decoy-a', 'decoy-b'] }, // old dead path #1
            spectators: ['decoy-c'], // old dead path #2
            result: { ok: true, worldId: 'concordia-hub', spectators: ['real-1'] }, // the real path
          }),
        });
      }
      return envelope({ ok: false });
    }));
    const { container } = render(<SpectatorOverlay />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('concordia:enter-spectator-mode', {
        detail: { worldId: 'concordia-hub' },
      }));
    });
    await waitFor(() => expect(container.textContent).toMatch(/1 watching/));
  });
});
