/**
 * /lenses/analytics — the Live stream's per-row event delete (F14 UI).
 *
 * Review 4's F14 acceptance surface: a tracked event ("PR4-qa-event")
 * offered no delete control in list, detail or live stream. The server
 * half adds the event-delete macro; this pins the control that calls
 * it from the stream — the surface R4 exercised:
 *   ROW DELETE — clicking a row's delete button calls
 *     lensRun('analytics', 'event-delete', { id }) with THAT row's id
 *     and the row leaves the stream.
 *   REFUSAL    — when the macro answers ok:false, the error is surfaced
 *     verbatim and the stream is re-read from the server (the row is
 *     restored from the authoritative list, not silently dropped).
 * lensRun is mocked at '@/lib/api/client' in the exact envelopes served.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
  api: { get: vi.fn() },
  apiHelpers: { dtus: { myDtus: vi.fn() } },
}));
vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
}));

import { AdvancedAnalytics } from '@/components/analytics/AdvancedAnalytics';

const EVENT = {
  id: 'ev_1', name: 'PR4-qa-event', distinctId: 'u1', properties: {},
  at: new Date().toISOString(),
};

function mockRun(deleteResult: unknown) {
  lensRun.mockImplementation((_domain: string, action: string) => {
    if (action === 'event-stats') {
      return Promise.resolve({ data: { ok: true, result: { topEvents: [{ name: 'PR4-qa-event', count: 1 }] } } });
    }
    if (action === 'event-stream') {
      return Promise.resolve({ data: { ok: true, result: { events: [EVENT], matched: 1, cursor: 'c1' } } });
    }
    if (action === 'event-delete') {
      return Promise.resolve({ data: deleteResult });
    }
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

async function openStream() {
  render(<AdvancedAnalytics />);
  fireEvent.click(screen.getByRole('button', { name: /Live stream/ }));
  await waitFor(() => expect(screen.getByText('PR4-qa-event')).toBeTruthy());
}

beforeEach(() => { vi.clearAllMocks(); });

describe('Live stream event delete (F14)', () => {
  it('the row delete calls event-delete with the row id and removes the row', async () => {
    mockRun({ ok: true, result: { deleted: 'ev_1' } });
    await openStream();
    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('analytics', 'event-delete', { id: 'ev_1' }));
    await waitFor(() => expect(screen.queryByText('PR4-qa-event')).toBeNull());
  });

  it('a macro refusal surfaces verbatim and the row is restored from the server', async () => {
    mockRun({ ok: false, error: 'event not found' });
    await openStream();
    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));
    await waitFor(() => expect(screen.getByText('event not found')).toBeTruthy());
    // The re-poll returns the event again — the row is back.
    await waitFor(() => expect(screen.getByText('PR4-qa-event')).toBeTruthy());
  });
});
