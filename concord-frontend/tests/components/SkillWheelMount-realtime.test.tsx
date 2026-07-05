/**
 * Pins the realtime dead-event fix for SkillWheelMount: `skill:evolved`
 * (real server event, server/lib/skill-progression.js) used to be a dead
 * `window.addEventListener` alongside a phantom `concordia:skill-learned`
 * name nothing ever emits. Both listeners now react to the same real
 * `skill:evolved` socket event via `subscribe()` from `lib/realtime/socket`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

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

// The radial ActionWheel is a Three.js/canvas-driven widget unrelated to this
// fix — stub it to a passthrough so the test isolates SkillWheelMount's own
// fetch + subscribe wiring.
vi.mock('@/components/world/concordia-hud/ActionWheel', () => ({
  ActionWheel: ({ spokes }: { spokes?: Array<{ id: string; label: string }> }) => (
    <div data-testid="action-wheel">{(spokes || []).map((s) => s.label).join(',')}</div>
  ),
}));

import SkillWheelMount from '@/components/world/concordia-hud/SkillWheelMount';
import * as socketMock from '@/lib/realtime/socket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

describe('SkillWheelMount — realtime wiring', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, skills: [] }),
    } as Response)));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('refetches skills on a real skill:evolved socket event', async () => {
    render(<SkillWheelMount />);
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0));

    const callsAfterMount = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    emitSocket('skill:evolved', { userId: 'u1', skillId: 's1', skillName: 'Fireball', level: 2 });

    await waitFor(() =>
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterMount),
    );
  });
});
