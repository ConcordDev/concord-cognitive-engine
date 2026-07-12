/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * Wave 4 (docs/lens-specs/spectate-capability-map.md "Honest residual" closure)
 * — the /lenses/spectate/[worldId] live event ticker's `push()` filter
 * (`if (eventWorldId && eventWorldId !== worldId) return;`) already existed
 * for npc:conversation-bid, but combat:hit / dtu:promoted / world:event:
 * scheduled / faction:war-declared / faction:alliance-formed / faction:
 * truce-sought never passed a worldId through, so it never actually filtered
 * for those six event types — every spectator saw every world's traffic.
 *
 * This pins that the ticker now genuinely filters: an event carrying the
 * CURRENT world's id is surfaced, an event carrying a DIFFERENT world's id is
 * dropped, and an event carrying no worldId at all (still a real possibility
 * — dtu:promoted, combat-netcode.js's other combat:hit emitter) is still
 * surfaced (honest signal beats no signal, matching npc:conversation-bid's
 * pre-existing behavior).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ worldId: 'tunya' }),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
}));

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
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
    joinRoom: vi.fn(),
    leaveRoom: vi.fn(),
    __emit: (event: string, data?: unknown) => {
      (listeners[event] || []).forEach((cb) => cb(data));
    },
  };
});

import SpectatorWorldPage from '@/app/lenses/spectate/[worldId]/page';
import * as socketMock from '@/lib/realtime/socket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

function fetchJson(body: unknown) {
  return Promise.resolve({ json: () => Promise.resolve(body) } as Response);
}

beforeEach(() => {
  lensRun.mockReset();
  // spectate.get resolves to a ready, empty spectacle so the ticker column renders.
  lensRun.mockImplementation((domain: string, action: string) => {
    if (domain === 'spectate' && action === 'get') {
      return Promise.resolve({
        data: { ok: true, result: { spectacle: { watching: 3, openMarkets: [], dispatches: [] } }, error: null },
      });
    }
    // spectate.watch — best-effort, resolve harmlessly.
    return Promise.resolve({ data: { ok: true, result: { ok: true }, error: null } });
  });
  global.fetch = vi.fn(() => fetchJson({ ok: true, flavor: null })) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/lenses/spectate/[worldId] — live ticker worldId filtering (Wave 4)', () => {
  it('surfaces a combat:hit event whose worldId matches the spectated world', async () => {
    render(<SpectatorWorldPage />);
    await waitFor(() => expect(screen.getByText(/3 viewers|Live event stream/i)).toBeInTheDocument());

    emitSocket('combat:hit', { attackerId: 'a1', targetId: 't1', damage: 12, worldId: 'tunya' });

    await waitFor(() => expect(screen.getByText(/combat:hit/)).toBeInTheDocument());
    expect(screen.getByText(/a1 hit t1 for 12/)).toBeInTheDocument();
  });

  it('drops a combat:hit event from a DIFFERENT world', async () => {
    render(<SpectatorWorldPage />);
    await waitFor(() => expect(screen.getByText(/Live event stream/i)).toBeInTheDocument());

    emitSocket('combat:hit', { attackerId: 'a2', targetId: 't2', damage: 99, worldId: 'sovereign-ruins' });

    // Give the effect loop a beat, then assert it never rendered.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/a2 hit t2 for 99/)).not.toBeInTheDocument();
    // The empty-state copy still shows since nothing matched.
    expect(screen.getByText(/Waiting for events/i)).toBeInTheDocument();
  });

  it('still surfaces a dtu:promoted event with no worldId at all (honest signal beats no signal)', async () => {
    render(<SpectatorWorldPage />);
    await waitFor(() => expect(screen.getByText(/Live event stream/i)).toBeInTheDocument());

    emitSocket('dtu:promoted', { dtuId: 'dtu_9' }); // no worldId — DTUs are cross-world by design

    await waitFor(() => expect(screen.getByText(/dtu:promoted/)).toBeInTheDocument());
    expect(screen.getByText(/DTU dtu_9 promoted/)).toBeInTheDocument();
  });

  it('filters faction:war-declared / faction:alliance-formed / faction:truce-sought by worldId', async () => {
    render(<SpectatorWorldPage />);
    await waitFor(() => expect(screen.getByText(/Live event stream/i)).toBeInTheDocument());

    // Matches this world → surfaced.
    emitSocket('faction:war-declared', {
      factionId: 'f_a', targetFactionId: 'f_b', summary: 'F_A declares war on F_B', worldId: 'tunya',
    });
    // Different world → dropped.
    emitSocket('faction:alliance-formed', {
      factionId: 'f_c', targetFactionId: 'f_d', summary: 'F_C allies with F_D', worldId: 'crime',
    });
    // Newly-subscribed this pass (was missing entirely pre-Wave-4) — matches this world.
    emitSocket('faction:truce-sought', {
      factionId: 'f_e', targetFactionId: 'f_f', summary: 'F_E seeks truce with F_F', worldId: 'tunya',
    });

    await waitFor(() => expect(screen.getByText(/F_A declares war on F_B/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/F_E seeks truce with F_F/)).toBeInTheDocument());
    expect(screen.queryByText(/F_C allies with F_D/)).not.toBeInTheDocument();
  });

  it('joins the world:<worldId> room on mount and leaves it on unmount', async () => {
    const { unmount } = render(<SpectatorWorldPage />);
    await waitFor(() => expect(socketMock.joinRoom).toHaveBeenCalledWith('world:tunya'));
    unmount();
    expect(socketMock.leaveRoom).toHaveBeenCalledWith('world:tunya');
  });
});
