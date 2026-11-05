/**
 * Affect S-AFF-4 — policy derivation receipts (FE side).
 *
 * F5: policy signals were bare floats. The policy payload now carries
 * a `derivations` sibling (server/affect/policy.js POLICY_DERIVATIONS)
 * and the panel prints each signal's formula under its value.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

type QState = { data: unknown; isLoading: boolean; isError: boolean; error: unknown };
const q: Record<string, QState> = {
  'affect-state': { data: { state: {} }, isLoading: false, isError: false, error: null },
  'affect-policy': {
    data: {
      policy: { style: { verbosity: 0.51 } },
      derivations: {
        style: { verbosity: '0.5 + (coherence − 0.5) × 0.3 − arousal × 0.2 − fatigue × 0.15' },
      },
    },
    isLoading: false, isError: false, error: null,
  },
  'affect-health': { data: { healthy: true }, isLoading: false, isError: false, error: null },
  'affect-events': { data: { events: [] }, isLoading: false, isError: false, error: null },
};
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

import { PolicyPanel } from '@/components/affect/PolicyPanel';
import { AffectSessionProvider } from '@/components/affect/AffectSessionContext';

describe('Affect S-AFF-4 — derivations print under their signals', () => {
  it('renders the formula beneath the signal value', () => {
    const { getByText } = render(
      <AffectSessionProvider>
        <PolicyPanel />
      </AffectSessionProvider>
    );
    expect(getByText('verbosity')).toBeTruthy();
    expect(getByText('= 0.5 + (coherence − 0.5) × 0.3 − arousal × 0.2 − fatigue × 0.15')).toBeTruthy();
  });
});
