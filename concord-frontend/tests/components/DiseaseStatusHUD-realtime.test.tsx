/**
 * Pins the realtime dead-event fix for DiseaseStatusHUD: `disease:contracted`
 * and `disease:cured` used to be `window.addEventListener` calls that nothing
 * ever dispatched (the server emits both via `globalThis._concordRealtimeEmit`,
 * a Socket.IO broadcast — never a window CustomEvent). The component now uses
 * `subscribe()` from `lib/realtime/socket` like the rest of the wired HUDs.
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

import { DiseaseStatusHUD } from '@/components/world/DiseaseStatusHUD';
import * as socketMock from '@/lib/realtime/socket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

const DISEASE = {
  id: 'pd_1', diseaseId: 'flu', name: 'Concord Flu', severity: 0.4,
  contagionRadiusM: 5, symptoms: ['cough'],
};

describe('DiseaseStatusHUD — realtime wiring', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      json: () => Promise.resolve({ ok: true, diseases: [DISEASE] }),
    } as Response)));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('refetches on a real disease:contracted socket event', async () => {
    const { getByLabelText } = render(<DiseaseStatusHUD />);
    await waitFor(() => expect(getByLabelText(/sick: 1 active infection/i)).toBeInTheDocument());

    const callsAfterMount = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    emitSocket('disease:contracted', { userId: 'me', diseaseId: 'pox', severity: 0.2 });
    await waitFor(() =>
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterMount),
    );
  });

  it('refetches on a real disease:cured socket event', async () => {
    const { getByLabelText } = render(<DiseaseStatusHUD />);
    await waitFor(() => expect(getByLabelText(/sick: 1 active infection/i)).toBeInTheDocument());

    const callsAfterMount = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    emitSocket('disease:cured', { userId: 'me', diseaseId: 'flu' });
    await waitFor(() =>
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsAfterMount),
    );
  });

  // Dead-event-listener fix (verification-audit campaign): the server has
  // always emitted a distinct 'disease:lethal-progression' warning (a real,
  // separate signal from the passive severity poll) but nothing ever
  // subscribed to it — a player only found out their infection turned
  // critical on the next 30s refresh, or not at all if death followed
  // first. Also fixed a realtime-emit-signature bug in the same emit
  // (userId was folded into the payload instead of the room-scoping
  // options arg, making it a global broadcast) — not exercised by this
  // frontend-only test, but covered by lib/disease-engine.js's own tests.
  it('shows a critical-infection alert on a real disease:lethal-progression event', async () => {
    const { getByLabelText, getByRole } = render(<DiseaseStatusHUD />);
    await waitFor(() => expect(getByLabelText(/sick: 1 active infection/i)).toBeInTheDocument());

    emitSocket('disease:lethal-progression', { diseaseId: 'flu', severity: 0.95 });
    await waitFor(() => {
      expect(getByRole('alert').textContent).toContain('Concord Flu');
      expect(getByRole('alert').textContent).toContain('critical');
    });
  });
});
