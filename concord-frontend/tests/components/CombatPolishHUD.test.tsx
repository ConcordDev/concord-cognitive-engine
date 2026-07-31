/**
 * CombatPolishHUD — pins the stateRef-write-in-render -> useEffect fix.
 *
 * `stateRef.current = state` used to be a direct render-body mutation,
 * moved to `useEffect(() => { stateRef.current = state; }, [state])`. This
 * exercises the component end-to-end: no-user null render, bootstrap fetch
 * on mount, live combo/rocked/gas updates via 'combat:polish' socket
 * events, and the stance/profile/awareness display.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

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

import { CombatPolishHUD } from '@/components/world/CombatPolishHUD';
import * as socketMock from '@/lib/realtime/socket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

const ACTOR_STATE = {
  actor_kind: 'player' as const,
  actor_id: 'u1',
  world_id: 'concordia-hub',
  profile_id: 'sifu_brawler',
  stance: 'orthodox',
  posture: 'guard',
  awareness: 'combat',
  awareness_target: 'npc_1',
  gas: 80,
  max_gas: 100,
  combo_count: 0,
  combo_last_at_ms: 0,
  rocked_until_ms: 0,
  grapple_target: null,
  updated_at: Date.now(),
};

function mockFetchOnce(state: typeof ACTOR_STATE | null) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ok: true, result: { ok: true, state } }),
  } as Response)));
}

describe('CombatPolishHUD', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders nothing with no userId (no bootstrap fetch, no subscription)', () => {
    mockFetchOnce(ACTOR_STATE);
    const { container } = render(<CombatPolishHUD userId={null} />);
    expect(container.firstChild).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renders nothing until the bootstrap fetch resolves, then shows the HUD', async () => {
    mockFetchOnce(ACTOR_STATE);
    const { container } = render(<CombatPolishHUD userId="u1" />);
    expect(container.firstChild).toBeNull();

    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith('/api/lens/run', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByText('SIFU · orthodox')).toBeInTheDocument();
    expect(screen.getByText(/combat/i)).toBeInTheDocument();
  });

  it('a combo_start event bumps the combo counter and flashes', async () => {
    mockFetchOnce(ACTOR_STATE);
    const { container } = render(<CombatPolishHUD userId="u1" />);
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument());

    act(() => {
      emitSocket('combat:polish', {
        id: 'e1', worldId: 'concordia-hub', actorKind: 'player', actorId: 'u1',
        eventKind: 'combo_start', detail: { combo: 3 }, ts: Date.now(),
      });
    });

    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
  });

  it('a rocked event shows the red vignette overlay', async () => {
    mockFetchOnce(ACTOR_STATE);
    const { container } = render(<CombatPolishHUD userId="u1" />);
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument());

    act(() => {
      emitSocket('combat:polish', {
        id: 'e2', worldId: 'concordia-hub', actorKind: 'player', actorId: 'u1',
        eventKind: 'rocked', detail: { until: Date.now() + 5000 }, ts: Date.now(),
      });
    });

    await waitFor(() => {
      const overlays = container.querySelectorAll('[aria-hidden]');
      expect(overlays.length).toBeGreaterThan(0);
    });
  });

  it('a gassed_out event shows the "gas out" badge', async () => {
    mockFetchOnce(ACTOR_STATE);
    const { container } = render(<CombatPolishHUD userId="u1" />);
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument());

    act(() => {
      emitSocket('combat:polish', {
        id: 'e3', worldId: 'concordia-hub', actorKind: 'player', actorId: 'u1',
        eventKind: 'gassed_out', detail: { gas_after: 5 }, ts: Date.now(),
      });
    });

    await waitFor(() => expect(screen.getByText('gas out')).toBeInTheDocument());
  });

  it('ignores an event for a different actorId', async () => {
    mockFetchOnce(ACTOR_STATE);
    const { container } = render(<CombatPolishHUD userId="u1" />);
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument());

    act(() => {
      emitSocket('combat:polish', {
        id: 'e4', worldId: 'concordia-hub', actorKind: 'player', actorId: 'someone-else',
        eventKind: 'combo_start', detail: { combo: 9 }, ts: Date.now(),
      });
    });

    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.queryByText('9')).not.toBeInTheDocument();
  });

  it('a bootstrap fetch failure leaves the HUD unmounted', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: false }),
    } as Response)));
    const { container } = render(<CombatPolishHUD userId="u1" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
