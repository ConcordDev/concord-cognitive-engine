/**
 * Affect S-AFF-1 — wire the state to its inputs.
 *
 * F1: a zero-event session displayed the ATS BASELINE constants as a
 * fully-formed personal state, labelled as nothing. F2: "Emit Affect
 * Event" was a silent no-op — the FE helper posted the sessionId at the
 * body's top level while POST /api/affect/event reads body.source.sessionId,
 * and the mutation's error path was console-only.
 *
 * Pins:
 *  - a zero-event session renders the labelled baseline, not a bare state;
 *  - a session with events does not carry the baseline label;
 *  - Emit calls the helper with the context session + the form's event,
 *    and the applied delta is surfaced as a receipt (never silence);
 *  - a failed emit surfaces its error in the panel;
 *  - the mood → FEEDBACK mapping: scale extremes are ±1, the midpoint
 *    honestly moves nothing, custom scales normalise by their own range.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

type QState = { data: unknown; isLoading: boolean; isError: boolean; error: unknown };
const BASE_STATE = { v: 0.5, a: 0.25, s: 0.8, c: 0.8, g: 0.7, t: 0.7, f: 0.2 };
const q: Record<string, QState> = {
  'affect-state': { data: { state: { ...BASE_STATE } }, isLoading: false, isError: false, error: null },
  'affect-policy': { data: { policy: {} }, isLoading: false, isError: false, error: null },
  'affect-health': { data: { healthy: true, sessions: 1 }, isLoading: false, isError: false, error: null },
  'affect-events': { data: { events: [] }, isLoading: false, isError: false, error: null },
};
const refetch = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    const key = String((opts.queryKey || [])[0] || '');
    const st = q[key] || { data: null, isLoading: false, isError: false, error: null };
    return { ...st, refetch };
  },
  useMutation: (cfg: {
    mutationFn: () => Promise<unknown>;
    onMutate?: () => void;
    onSuccess?: (res: unknown) => void;
    onError?: (err: unknown) => void;
  }) => ({
    mutate: async () => {
      cfg.onMutate?.();
      try {
        const res = await cfg.mutationFn();
        cfg.onSuccess?.(res);
      } catch (e) {
        cfg.onError?.(e);
      }
    },
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const emit = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    affect: {
      state: vi.fn(), policy: vi.fn(), health: vi.fn(), events: vi.fn(), reset: vi.fn(),
      emit: (...args: unknown[]) => emit(...args),
    },
  },
  lensRun: vi.fn(),
}));

vi.mock('@/components/affect/LiveAffectStream', () => ({
  LiveAffectStream: () => null,
}));

import { DimensionsPanel } from '@/components/affect/DimensionsPanel';
import { AffectSessionProvider } from '@/components/affect/AffectSessionContext';
import { moodToAffectEvent, summarizeDelta } from '@/components/affect/affect-model';

function renderPanel() {
  return render(
    <AffectSessionProvider>
      <DimensionsPanel />
    </AffectSessionProvider>
  );
}

beforeEach(() => {
  emit.mockReset();
  q['affect-events'] = { data: { events: [] }, isLoading: false, isError: false, error: null };
});

describe('Affect S-AFF-1 — the state is wired to its inputs', () => {
  it('labels the zero-event state as the baseline it is', () => {
    const { getByText, queryByText } = renderPanel();
    expect(getByText(/Baseline state\./)).toBeTruthy();
    expect(getByText(/neutral starting shape/)).toBeTruthy();
    expect(queryByText(/Event recorded/)).toBeNull();
  });

  it('drops the baseline label once the session has events', () => {
    q['affect-events'] = {
      data: { events: [{ type: 'SUCCESS', intensity: 1, polarity: 1 }] },
      isLoading: false, isError: false, error: null,
    };
    const { queryByText } = renderPanel();
    expect(queryByText(/Baseline state\./)).toBeNull();
  });

  it('emit calls the helper with the session and surfaces the applied delta', async () => {
    emit.mockResolvedValue({ data: { ok: true, delta: { v: 0.04, f: -0.01 } } });
    const { getByRole, findByText } = renderPanel();
    fireEvent.click(getByRole('button', { name: /Emit Event/ }));
    await waitFor(() => expect(emit).toHaveBeenCalledTimes(1));
    expect(emit).toHaveBeenCalledWith('default', { type: 'USER_MESSAGE', intensity: 0.5, polarity: 0 });
    expect(await findByText(/Event recorded — Valence \+4\.0 · Fatigue -1\.0/)).toBeTruthy();
  });

  it('a failed emit surfaces its error in the panel, never silence', async () => {
    emit.mockRejectedValue(new Error('ATS not loaded'));
    const { getByRole, findByRole } = renderPanel();
    fireEvent.click(getByRole('button', { name: /Emit Event/ }));
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('Emit failed — ATS not loaded');
  });
});

describe('mood → FEEDBACK mapping', () => {
  it('scale extremes are ±1 and the midpoint moves nothing', () => {
    expect(moodToAffectEvent([1, 2, 3, 4, 5], 5)).toEqual({ type: 'FEEDBACK', intensity: 1, polarity: 1 });
    expect(moodToAffectEvent([1, 2, 3, 4, 5], 1)).toEqual({ type: 'FEEDBACK', intensity: 1, polarity: -1 });
    expect(moodToAffectEvent([1, 2, 3, 4, 5], 3)).toEqual({ type: 'FEEDBACK', intensity: 0, polarity: 0 });
    expect(moodToAffectEvent([1, 2, 3, 4, 5], 4)).toEqual({ type: 'FEEDBACK', intensity: 0.5, polarity: 0.5 });
  });

  it('custom scales normalise by their own range', () => {
    expect(moodToAffectEvent([0, 5, 10], 10).polarity).toBe(1);
    expect(moodToAffectEvent([0, 5, 10], 0).polarity).toBe(-1);
    expect(moodToAffectEvent([0, 5, 10], 5).polarity).toBe(0);
  });

  it('summarizeDelta names only the dimensions that moved', () => {
    expect(summarizeDelta({ v: 0.04, f: -0.01, a: 0 })).toBe('Valence +4.0 · Fatigue -1.0');
    expect(summarizeDelta({})).toBe('');
    expect(summarizeDelta(undefined)).toBe('');
  });
});
