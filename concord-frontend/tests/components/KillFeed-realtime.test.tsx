/**
 * Pins the realtime dead-event fix for KillFeed: `combat:kill` and
 * `entity:death` used to be `window.addEventListener` calls that nothing
 * ever dispatched (both are real Socket.IO broadcasts server-side — never
 * window CustomEvents). The component now uses `subscribe()` from
 * `lib/realtime/socket`, mapping each event's REAL payload shape:
 *   - combat:kill  -> { attackerId, targetId }            (server.js)
 *   - entity:death -> { entityId, entityName, cause, ... } (death-protocol.js)
 * — not the killer/victim/skillId/isPlayer shape the old dead handler assumed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

import { KillFeed } from '@/components/world/KillFeed';
import * as socketMock from '@/lib/realtime/socket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

describe('KillFeed — realtime wiring', () => {
  beforeEach(() => {
    window.localStorage.setItem('concordia:killFeed', 'on');
  });
  afterEach(() => {
    window.localStorage.removeItem('concordia:killFeed');
  });

  it('renders a feed entry from a real combat:kill event (attackerId/targetId shape)', async () => {
    const { container } = render(<KillFeed worldId="lattice-crucible" />);
    act(() => {
      emitSocket('combat:kill', { attackerId: 'user-a', targetId: 'user-b' });
    });

    await waitFor(() => expect(container.textContent).toMatch(/user-a/));
    expect(container.textContent).toMatch(/user-b/);
    expect(container.textContent).toMatch(/defeated/);
  });

  it('renders a feed entry from a real entity:death event (entityName/cause shape)', async () => {
    const { container } = render(<KillFeed worldId="lattice-crucible" />);
    act(() => {
      emitSocket('entity:death', { entityId: 'npc-9', entityName: 'Grukk the Bandit', cause: 'combat' });
    });

    await waitFor(() => expect(container.textContent).toMatch(/Grukk the Bandit/));
    expect(container.textContent).toMatch(/combat/);
  });
});
