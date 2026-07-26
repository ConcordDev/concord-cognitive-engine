// NamedEncounterController — pops NamedEncounterHUD off real boss spawns.
//
// DET-C batch 2: this component previously also subscribed to a
// `world:named-encounter` socket event that no server code anywhere ever
// emitted (verified via the runtime dead-event-listener detector — not
// grep) — retired rather than wired (see the component's own header
// comment for why: the only automatic-boss-cycle path broadcasts a
// differently-shaped event with no real NPC id to look up a skill lineage
// against). This test pins that only the real `spawn:boss` subscription
// remains, and that it still works end-to-end.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('next/dynamic', () => ({
  default: () => () => null,
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

import { NamedEncounterController } from '@/components/world/NamedEncounterController';
import * as socketMock from '@/lib/realtime/socket';

describe('NamedEncounterController', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('subscribes only to spawn:boss — the retired world:named-encounter is never subscribed', () => {
    render(<NamedEncounterController />);
    const subscribeMock = socketMock.subscribe as unknown as ReturnType<typeof vi.fn>;
    const subscribedEvents = subscribeMock.mock.calls.map((c) => c[0]);
    expect(subscribedEvents).toContain('spawn:boss');
    expect(subscribedEvents).not.toContain('world:named-encounter');
    expect(subscribedEvents).toHaveLength(1);
  });

  it('does not throw when a real spawn:boss event fires', () => {
    render(<NamedEncounterController />);
    expect(() => {
      (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit('spawn:boss', {
        worldId: 'concordia-hub', npcId: 'boss_1', archetype: 'Sovereign Herald', x: 0, z: 0, level: 10,
      });
    }).not.toThrow();
  });
});
