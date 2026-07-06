/**
 * Fix 1 (verification audit, 2026-07-05) — useSocket.ts's FORWARDED_EVENTS
 * bridge for the Refusal Field compound-threshold signal.
 *
 * The server only ever emits `refusal:compound-threshold`
 * (server/lib/refusal-field.js:134) — never a bare `refusal:compound`. This
 * hook used to register a socket forwarder for the wrong name (`refusal:compound`)
 * and mirror it onto a matching window CustomEvent; a socket event that never
 * fires meant the window CustomEvent never fired either, so every downstream
 * consumer (HUDContextProvider, the cinematic director) was silently starved.
 *
 * This is a dedicated, isolated test file (rather than appended to the shared
 * useSocket.test.ts) because useSocket.ts registers its FORWARDED_EVENTS
 * bridge on a module-level "registered once" guard (`_globalListenersRegistered`)
 * — sharing a module instance with other tests would make the registration
 * order-dependent.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockSocketInstance = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  removeAllListeners: vi.fn(),
  connected: false,
  io: { on: vi.fn(), off: vi.fn() },
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocketInstance),
}));

import { useSocket } from '@/hooks/useSocket';

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client: qc }, children);

// A single test, deliberately not split across it() blocks: useSocket.ts
// registers its FORWARDED_EVENTS bridge behind a module-level "registered
// once" guard (`_globalListenersRegistered`), and the shared tests/setup.ts
// runs a global `beforeEach(() => vi.clearAllMocks())` — splitting these
// assertions across separate `it()`s would wipe `mockSocketInstance.on`'s
// call history between them while the guard silently skips re-registering,
// making every test after the first one a false negative for the wrong
// reason. One render, one shared assertion set.
describe('useSocket — refusal:compound-threshold forwarding', () => {
  it('registers the real event name, not the old dead one, and mirrors it to a window CustomEvent', () => {
    renderHook(() => useSocket(), { wrapper });

    const staleCall = mockSocketInstance.on.mock.calls.find((c) => c[0] === 'refusal:compound');
    expect(staleCall).toBeUndefined();

    const call = mockSocketInstance.on.mock.calls.find((c) => c[0] === 'refusal:compound-threshold');
    expect(call).toBeTruthy();
    const handler = call![1] as (data: unknown) => void;

    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener('refusal:compound-threshold', listener);
    handler({ strength: 7, worldId: 'concordia-hub' });
    window.removeEventListener('refusal:compound-threshold', listener);

    expect(seen).toEqual([{ strength: 7, worldId: 'concordia-hub' }]);
  });
});
