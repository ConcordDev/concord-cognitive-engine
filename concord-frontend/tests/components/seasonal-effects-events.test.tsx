/**
 * Fix 2 + Fix 3 (verification audit, 2026-07-05) — SeasonalEffects' socket
 * wiring.
 *
 * The component used to listen for `concordia:season-transition` /
 * `concordia:weather` window CustomEvents — names nothing dispatches. The
 * server emits `world:season-transition` (server/lib/seasons.js) and
 * `world:weather` (server/lib/weather.js) directly on the socket, with no
 * window-bridge for either. Fixed to subscribe() to the socket directly.
 *
 * A second, related bug: the season payload's real field is `seasonName`
 * (server/lib/seasons.js#advanceSeasonForWorld emits
 * `{worldId, seasonIdx, seasonName, year, narrative}`), not `toSeason` —
 * so even with the event name fixed, the component would have silently
 * never updated its season. Both are pinned here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

const { subscribeHandlers, subscribeMock } = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    subscribeHandlers: handlers,
    subscribeMock: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    }),
  };
});
vi.mock('@/lib/realtime/socket', () => ({
  subscribe: subscribeMock,
}));

import SeasonalEffects from '@/components/world-lens/SeasonalEffects';

const AUTUMN_TINT = 'rgba(220, 160, 90, 0.08)';
// jsdom's CSSOM normalizes the trailing zero on the alpha channel
// (0.10 → 0.1) when reading back style.background.
const DEEP_WINTER_TINT = 'rgba(180, 200, 220, 0.1)';

describe('SeasonalEffects — socket event wiring', () => {
  beforeEach(() => {
    subscribeHandlers.clear();
    subscribeMock.mockClear();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
  });

  it('subscribes to the real server event names, not the phantom concordia:* window-bridge names', () => {
    render(<SeasonalEffects worldId="concordia-hub" />);
    expect(subscribeMock).toHaveBeenCalledWith('world:season-transition', expect.any(Function));
    expect(subscribeMock).toHaveBeenCalledWith('world:weather', expect.any(Function));
  });

  it('applies a season tint when the real payload (seasonName field) arrives for this world', async () => {
    const { container } = render(<SeasonalEffects worldId="concordia-hub" />);
    await waitFor(() => expect(subscribeHandlers.has('world:season-transition')).toBe(true));

    act(() => {
      subscribeHandlers.get('world:season-transition')!({
        worldId: 'concordia-hub', seasonIdx: 5, seasonName: 'autumn', year: 3, narrative: 'Leaves fall.',
      });
    });

    await waitFor(() => {
      const tintDiv = container.querySelector('div[aria-hidden]');
      expect(tintDiv).toBeTruthy();
      expect((tintDiv as HTMLElement).style.background).toBe(AUTUMN_TINT);
    });
  });

  it('does NOT update on the old, non-existent "toSeason" field alone', async () => {
    const { container } = render(<SeasonalEffects worldId="concordia-hub" />);
    await waitFor(() => expect(subscribeHandlers.has('world:season-transition')).toBe(true));

    act(() => {
      // @ts-expect-error — deliberately sending the old, wrong field name to
      // prove the component no longer reads it.
      subscribeHandlers.get('world:season-transition')!({ worldId: 'concordia-hub', toSeason: 'deep_winter' });
    });

    // Give any (incorrect) state update a chance to flush, then confirm
    // nothing rendered — no season means the component returns null.
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('div[aria-hidden]')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('ignores a season-transition event scoped to a different world', async () => {
    const { container } = render(<SeasonalEffects worldId="concordia-hub" />);
    await waitFor(() => expect(subscribeHandlers.has('world:season-transition')).toBe(true));

    act(() => {
      subscribeHandlers.get('world:season-transition')!({ worldId: 'tunya', seasonName: 'deep_winter' });
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('div[aria-hidden]')).toBeNull();
  });

  it('updates the tint again on a second, different season for the same world', async () => {
    const { container } = render(<SeasonalEffects worldId="concordia-hub" />);
    await waitFor(() => expect(subscribeHandlers.has('world:season-transition')).toBe(true));

    act(() => {
      subscribeHandlers.get('world:season-transition')!({ worldId: 'concordia-hub', seasonName: 'autumn' });
    });
    await waitFor(() => {
      expect((container.querySelector('div[aria-hidden]') as HTMLElement).style.background).toBe(AUTUMN_TINT);
    });

    act(() => {
      subscribeHandlers.get('world:season-transition')!({ worldId: 'concordia-hub', seasonName: 'deep_winter' });
    });
    await waitFor(() => {
      expect((container.querySelector('div[aria-hidden]') as HTMLElement).style.background).toBe(DEEP_WINTER_TINT);
    });
  });
});
