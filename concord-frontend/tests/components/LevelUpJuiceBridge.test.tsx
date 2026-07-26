// LevelUpJuiceBridge — bridges realtime `level:up`/`quality:approved`/etc.
// socket events to window CustomEvents for the juice/visual layer.
//
// DET-C batch 2: pins the fix for a real dead-event mismatch.
// WorldVisualHooks.tsx has listened for `concordia:level-up` (to fire a
// particle-column burst) since it was written, but this bridge only ever
// dispatched the generic `concordia:game-juice` event on a real `level:up`
// socket message — `concordia:level-up` itself was never dispatched
// anywhere, so the particle visual never fired on an actual level-up.
// Verified via the runtime dead-event-listener detector, not grep.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Capturing socket mock — same shape as tests/lenses/auction-page.test.tsx,
// lets the test fire the real server event name and assert the bridge's
// `subscribe('level:up', ...)` handler actually dispatches both window
// events it's supposed to.
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

import { LevelUpJuiceBridge } from '@/components/world-lens/LevelUpJuiceBridge';
import * as socketMock from '@/lib/realtime/socket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

describe('LevelUpJuiceBridge', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('dispatches both concordia:game-juice and concordia:level-up on a real level:up socket event', () => {
    render(<LevelUpJuiceBridge />);

    const gameJuiceHandler = vi.fn();
    const levelUpHandler = vi.fn();
    window.addEventListener('concordia:game-juice', gameJuiceHandler);
    window.addEventListener('concordia:level-up', levelUpHandler);

    emitSocket('level:up', { newRank: 5, title: 'Journeyman', totalXP: 1200 });

    expect(gameJuiceHandler).toHaveBeenCalledTimes(1);
    expect(levelUpHandler).toHaveBeenCalledTimes(1);
    const event = levelUpHandler.mock.calls[0][0] as CustomEvent<{ newRank: number; title: string; totalXP: number }>;
    expect(event.detail).toEqual({ newRank: 5, title: 'Journeyman', totalXP: 1200 });

    window.removeEventListener('concordia:game-juice', gameJuiceHandler);
    window.removeEventListener('concordia:level-up', levelUpHandler);
  });
});
