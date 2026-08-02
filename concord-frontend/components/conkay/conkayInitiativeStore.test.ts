/**
 * conkayInitiativeStore — the CK4 bridge to Concord's real conversational
 * initiative engine. Pins two things: (1) the normalizer never fabricates a
 * value for a field the response omitted, and only accepts a row that has a
 * real id + message; (2) the store's `ready` flag correctly distinguishes
 * "hasn't polled yet" from "polled and got zero," so a consumer can't
 * mistake silence for a confirmed empty state.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useConkayInitiativeStore, useConkayInitiativePoll } from './conkayInitiativeStore';

const store = () => useConkayInitiativeStore.getState();

beforeEach(() => {
  useConkayInitiativeStore.setState({ pending: [], ready: false });
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonOf(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

describe('conkayInitiativeStore — initial state', () => {
  it('starts empty and not-ready (never claims "definitely zero" before the first poll)', () => {
    expect(store().pending).toEqual([]);
    expect(store().ready).toBe(false);
  });
});

describe('useConkayInitiativePoll — real-data-only normalization', () => {
  it('polls the exact same endpoint InitiativeBell.tsx uses, with credentials', async () => {
    const fetchMock = vi.fn(() => jsonOf({ ok: true, initiatives: [] }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useConkayInitiativePoll(true, 30_000));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/initiative/pending', { credentials: 'include' }));
  });

  it('normalizes a real row, coercing types without inventing missing fields', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOf({
      ok: true,
      initiatives: [
        { id: 'init_1', message: 'A new DTU cites your work.', priority: 'high', score: 0.8, triggerType: 'citation_alert', createdAt: '2026-08-02T00:00:00Z' },
      ],
    })));

    renderHook(() => useConkayInitiativePoll(true, 30_000));
    await vi.waitFor(() => expect(store().ready).toBe(true));

    expect(store().pending).toEqual([
      { id: 'init_1', triggerType: 'citation_alert', message: 'A new DTU cites your work.', priority: 'high', score: 0.8, createdAt: '2026-08-02T00:00:00Z' },
    ]);
  });

  it('drops a row with no real id or no real message rather than fabricating one', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOf({
      ok: true,
      initiatives: [
        { message: 'no id here' },
        { id: 'init_2', message: '' },
        { id: 'init_3', message: 'genuinely real' },
        'not even an object',
      ],
    })));

    renderHook(() => useConkayInitiativePoll(true, 30_000));
    await vi.waitFor(() => expect(store().ready).toBe(true));

    expect(store().pending).toHaveLength(1);
    expect(store().pending[0].id).toBe('init_3');
  });

  it('a fetch failure leaves the store untouched rather than wiping real prior data', async () => {
    useConkayInitiativeStore.setState({ pending: [{ id: 'x', triggerType: 't', message: 'm', priority: 'normal', createdAt: '' }], ready: true });
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));

    const { unmount } = renderHook(() => useConkayInitiativePoll(true, 30_000));
    await new Promise((r) => setTimeout(r, 10));
    unmount();

    expect(store().pending).toHaveLength(1);
    expect(store().pending[0].id).toBe('x');
  });

  it('does not poll while disabled', async () => {
    const fetchMock = vi.fn(() => jsonOf({ ok: true, initiatives: [] }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useConkayInitiativePoll(false, 30_000));
    await new Promise((r) => setTimeout(r, 10));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
