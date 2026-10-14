/// <reference types="@testing-library/jest-dom/vitest" />
/** INC-SWEEP government F3 — never paint $0B when budget-breakdown failed. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { BudgetVisualizer } from '@/components/government/BudgetVisualizer';

describe('BudgetVisualizer (F3)', () => {
  beforeEach(() => { lensRunMock.mockReset(); });
  afterEach(() => { cleanup(); });

  it('on failure shows the server error and NO dollar total', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: false,
        result: null,
        error: 'usaspending unreachable: usaspending 400',
      },
    });
    render(<BudgetVisualizer />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/usaspending unreachable/i);
    expect(screen.queryByText(/\$0B/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$\d+B/)).not.toBeInTheDocument();
  });

  it('on success renders the real totalBillions', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        result: {
          totalBillions: 1234.5,
          categories: [
            { name: 'Defense', amountBillions: 600, pctOfTotal: 48.6, yoyChangePct: 1.2, color: '#0ff' },
          ],
        },
      },
    });
    render(<BudgetVisualizer />);
    await waitFor(() => {
      expect(screen.getByText('$1235B')).toBeInTheDocument();
    });
    expect(screen.getByText('Defense')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
