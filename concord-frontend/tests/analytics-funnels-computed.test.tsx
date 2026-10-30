/**
 * /lenses/analytics — Funnels tab computed results (Review 4 F9 / A7;
 * remainder slice R3).
 *
 * funnel-list (server/domains/analytics.js) already attaches each saved
 * funnel's computed result — { ...f, result: computeFunnel(log, f.steps) }.
 * FunnelsPanel used to type only { id, name, steps } and render the
 * definition, dropping the computation: the tab read as definition-only
 * even though the numbers were in the payload it already held. These
 * tests pin:
 *   COMPUTED — a funnel carrying a result renders per-step counts +
 *     conversion-from-start (the Events builder's own funnel idiom) and
 *     the overall-conversion line.
 *   HONEST ABSENCE — a funnel whose payload carries NO result stays
 *     definition-only; no conversion numbers are invented for it.
 *
 * Backend mocked at '@/lib/api/client' (lensRun) in the exact envelope
 * the component consumes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { FunnelsPanel } from '@/components/analytics/FunnelsPanel';

const COMPUTED = {
  id: 'f1',
  name: 'Checkout path',
  steps: ['view', 'cart', 'buy'],
  result: {
    steps: [
      { step: 1, event: 'view', count: 40, conversionFromStart: 100, conversionFromPrev: 100 },
      { step: 2, event: 'cart', count: 25, conversionFromStart: 62.5, conversionFromPrev: 62.5 },
      { step: 3, event: 'buy', count: 10, conversionFromStart: 25, conversionFromPrev: 40 },
    ],
    totalStarters: 40,
    overallConversion: 25,
  },
};
const BARE = { id: 'f2', name: 'Bare definition', steps: ['a', 'b'] };

beforeEach(() => {
  vi.clearAllMocks();
  lensRun.mockImplementation((_domain: string, action: string) => {
    if (action === 'funnel-list') {
      return Promise.resolve({ data: { result: { funnels: [COMPUTED, BARE], count: 2 } } });
    }
    return Promise.resolve({ data: { result: {} } });
  });
});

describe('Funnels tab computed results (R3)', () => {
  it('renders per-step counts + conversion and the overall line from the payload result', async () => {
    render(<FunnelsPanel />);
    await waitFor(() => expect(screen.getByText('Checkout path')).toBeTruthy());
    expect(screen.getByText('40 · 100%')).toBeTruthy();
    expect(screen.getByText('25 · 62.5%')).toBeTruthy();
    expect(screen.getByText('10 · 25%')).toBeTruthy();
    expect(screen.getByText('Overall conversion: 25% · 40 entered')).toBeTruthy();
  });

  it('a funnel with no result in the payload stays definition-only (no invented numbers)', async () => {
    render(<FunnelsPanel />);
    await waitFor(() => expect(screen.getByText('Bare definition')).toBeTruthy());
    // Exactly one overall-conversion line exists in the whole panel — the
    // computed funnel's. The bare funnel contributes none.
    expect(screen.getAllByText(/Overall conversion/)).toHaveLength(1);
  });
});
