/**
 * Affect S-AFF-3 — health verdict integrity.
 *
 * F6/F18: the Health verdict was a score-branch literal — a session
 * scoring ≥65% printed "healthy range / all dimensions within normal
 * parameters" while a CRITICAL warning (Arousal 11%) sat directly
 * beneath it, Recovery read "No recovery actions needed", and System
 * Health Details rendered the baseline object as "[object Object]"
 * and integer counts as "8.000". The score formula was stated nowhere.
 *
 * Pins:
 *  - a critical warning drives the verdict, whatever the average says;
 *  - a critical warning always yields a recovery recommendation;
 *  - the score formula is printed on the panel;
 *  - details render objects/arrays readably and integers without .000;
 *  - a genuinely clean state still reads healthy with no actions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

type QState = { data: unknown; isLoading: boolean; isError: boolean; error: unknown };
const q: Record<string, QState> = {};
const refetch = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    const key = String((opts.queryKey || [])[0] || '');
    const st = q[key] || { data: null, isLoading: false, isError: false, error: null };
    return { ...st, refetch };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    affect: {
      state: vi.fn(), policy: vi.fn(), health: vi.fn(), events: vi.fn(), reset: vi.fn(), emit: vi.fn(),
    },
  },
  lensRun: vi.fn(),
}));

vi.mock('@/components/common/EmptyState', () => ({
  ErrorState: () => null,
}));

import { HealthPanel } from '@/components/affect/HealthPanel';
import { AffectSessionProvider } from '@/components/affect/AffectSessionContext';

function setQueries(state: Record<string, number>, health: Record<string, unknown>) {
  q['affect-state'] = { data: { state }, isLoading: false, isError: false, error: null };
  q['affect-policy'] = { data: { policy: {} }, isLoading: false, isError: false, error: null };
  q['affect-health'] = { data: health, isLoading: false, isError: false, error: null };
  q['affect-events'] = { data: { events: [] }, isLoading: false, isError: false, error: null };
}

function renderPanel() {
  return render(
    <AffectSessionProvider>
      <HealthPanel />
    </AffectSessionProvider>
  );
}

beforeEach(() => {
  for (const k of Object.keys(q)) delete q[k];
});

describe('Affect S-AFF-3 — the verdict follows the warnings', () => {
  it('a critical warning overrides a ≥65% average', () => {
    // Mean with fatigue inverted = (0.7+0.11+0.9+0.8+0.7+0.7+0.8)/7 ≈ 67%,
    // yet Arousal at 11% is a critical warning.
    setQueries(
      { v: 0.7, a: 0.11, s: 0.9, c: 0.8, g: 0.7, t: 0.7, f: 0.2 },
      { healthy: true, sessions: 8 }
    );
    const { getByText, queryByText } = renderPanel();
    expect(getByText(/Needs attention — Arousal critically low at 11%/)).toBeTruthy();
    expect(queryByText(/healthy range\. All dimensions are operating within normal parameters/)).toBeNull();
  });

  it('a critical warning always yields a recovery recommendation', () => {
    setQueries(
      { v: 0.7, a: 0.11, s: 0.9, c: 0.8, g: 0.7, t: 0.7, f: 0.2 },
      { healthy: true, sessions: 8 }
    );
    const { getByText, queryByText } = renderPanel();
    expect(getByText(/Arousal is low\. Engaging, novel stimulation/)).toBeTruthy();
    expect(queryByText(/No recovery actions needed/)).toBeNull();
  });

  it('prints the score formula on the panel', () => {
    setQueries(
      { v: 0.7, a: 0.5, s: 0.8, c: 0.8, g: 0.7, t: 0.7, f: 0.2 },
      { healthy: true, sessions: 8 }
    );
    const { getByText } = renderPanel();
    expect(getByText(/Score = mean of the seven dimensions, with Fatigue counted inverted/)).toBeTruthy();
  });

  it('a clean state still reads healthy with no actions needed', () => {
    setQueries(
      { v: 0.7, a: 0.5, s: 0.8, c: 0.8, g: 0.7, t: 0.7, f: 0.2 },
      { healthy: true, sessions: 8 }
    );
    const { getByText } = renderPanel();
    expect(getByText(/healthy range\. All dimensions are operating within normal parameters/)).toBeTruthy();
    expect(getByText(/No recovery actions needed\. Emotional state is healthy\./)).toBeTruthy();
  });
});

describe('Affect S-AFF-3 — System Health Details render readably (F18)', () => {
  it('objects render as per-dimension percentages, integers without .000', () => {
    setQueries(
      { v: 0.7, a: 0.5, s: 0.8, c: 0.8, g: 0.7, t: 0.7, f: 0.2 },
      {
        healthy: true,
        sessions: 8,
        baseline: { v: 0.5, a: 0.25, s: 0.8, c: 0.8, g: 0.7, t: 0.7, f: 0.2 },
        dimensions: ['v', 'a', 's', 'c', 'g', 't', 'f'],
      }
    );
    const { getByText, queryByText } = renderPanel();
    expect(getByText('8')).toBeTruthy();
    expect(queryByText('8.000')).toBeNull();
    expect(getByText(/v 50% · a 25% · s 80% · c 80% · g 70% · t 70% · f 20%/)).toBeTruthy();
    expect(queryByText(/\[object Object\]/)).toBeNull();
    expect(getByText('v · a · s · c · g · t · f')).toBeTruthy();
  });
});
