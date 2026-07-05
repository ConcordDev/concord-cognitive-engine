/**
 * Pins the realtime dead-event fix for AchievementToast: `achievement:unlocked`
 * used to be a `window.addEventListener` reading `(ev as CustomEvent).detail`
 * — nothing ever dispatched that window event (the server emits it via
 * `globalThis._concordRealtimeEmit`, a Socket.IO broadcast). The component now
 * uses `subscribe()` from `lib/realtime/socket`, which hands the callback the
 * raw payload directly (no `.detail` wrapper).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

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

import { AchievementToast } from '@/components/world/AchievementToast';
import * as socketMock from '@/lib/realtime/socket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

describe('AchievementToast — realtime wiring', () => {
  it('renders a toast from a real achievement:unlocked socket payload', async () => {
    const { container } = render(<AchievementToast />);
    expect(container.textContent).toBe('');

    act(() => {
      emitSocket('achievement:unlocked', {
        userId: 'u1', achievementId: 'first_blood', title: 'First Blood',
        rarity: 'bronze', rewardSparks: 5, rewardTitle: null,
      });
    });

    await waitFor(() => expect(container.textContent).toMatch(/First Blood/));
    expect(container.textContent).toMatch(/Achievement unlocked/i);
    expect(container.textContent).toMatch(/\+5 Sparks/);
  });

  it('ignores a malformed payload with no achievementId', async () => {
    const { container } = render(<AchievementToast />);
    emitSocket('achievement:unlocked', {});
    await new Promise((r) => setTimeout(r, 10));
    expect(container.textContent).toBe('');
  });
});
