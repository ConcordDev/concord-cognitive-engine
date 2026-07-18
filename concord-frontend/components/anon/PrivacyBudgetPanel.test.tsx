/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PrivacyBudgetPanel } from './PrivacyBudgetPanel';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

describe('PrivacyBudgetPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls anon.privacyBudgetStatus on mount and renders the real fetched status', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        result: {
          totalSpent: 3.5,
          totalBudget: 10,
          remaining: 6.5,
          percentUsed: 35,
          callCount: 2,
          callHistory: [
            { epsilon: 1.5, purpose: 'census-count', timestamp: 1000 },
            { epsilon: 2.0, purpose: 'census-sum', timestamp: 2000 },
          ],
          createdAt: 500,
          resetAt: null,
          exhausted: false,
        },
        error: null,
      },
    });

    render(<PrivacyBudgetPanel />);

    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('anon', 'privacyBudgetStatus', {}),
    );
    await waitFor(() => expect(screen.getByTestId('privacy-budget-spent')).toBeInTheDocument());
    expect(screen.getByTestId('privacy-budget-spent')).toHaveTextContent('3.50');
    expect(screen.getByTestId('privacy-budget-remaining')).toHaveTextContent('6.50');
    expect(screen.getByTestId('privacy-budget-calls')).toHaveTextContent('2');

    const history = screen.getByTestId('privacy-budget-history');
    expect(history).toHaveTextContent('census-count');
    expect(history).toHaveTextContent('census-sum');
  });

  it('shows an honest loading state before the real fetch resolves', async () => {
    let resolveFn: (v: unknown) => void = () => {};
    lensRunMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );

    render(<PrivacyBudgetPanel />);
    expect(screen.getByTestId('privacy-budget-loading')).toBeInTheDocument();
    // No fabricated numbers rendered while loading.
    expect(screen.queryByTestId('privacy-budget-spent')).toBeNull();

    resolveFn({
      data: {
        ok: true,
        result: {
          totalSpent: 0, totalBudget: 10, remaining: 10, percentUsed: 0,
          callCount: 0, callHistory: [], createdAt: null, resetAt: null, exhausted: false,
        },
        error: null,
      },
    });
    await waitFor(() => expect(screen.getByTestId('privacy-budget-spent')).toBeInTheDocument());
  });

  it('shows an honest empty state for a fresh identity with zero real calls', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        result: {
          totalSpent: 0, totalBudget: 10, remaining: 10, percentUsed: 0,
          callCount: 0, callHistory: [], createdAt: null, resetAt: null, exhausted: false,
        },
        error: null,
      },
    });
    render(<PrivacyBudgetPanel />);
    await waitFor(() => expect(screen.getByTestId('privacy-budget-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('privacy-budget-history')).toBeNull();
  });

  it('updates after refreshKey changes — reflects a real running total, not a stale snapshot', async () => {
    lensRunMock.mockResolvedValueOnce({
      data: {
        ok: true,
        result: {
          totalSpent: 1.0, totalBudget: 10, remaining: 9.0, percentUsed: 10,
          callCount: 1, callHistory: [{ epsilon: 1.0, purpose: 'first', timestamp: 1 }],
          createdAt: 1, resetAt: null, exhausted: false,
        },
        error: null,
      },
    });

    const { rerender } = render(<PrivacyBudgetPanel refreshKey={0} />);
    await waitFor(() => expect(screen.getByTestId('privacy-budget-spent')).toHaveTextContent('1.00'));

    lensRunMock.mockResolvedValueOnce({
      data: {
        ok: true,
        result: {
          totalSpent: 3.0, totalBudget: 10, remaining: 7.0, percentUsed: 30,
          callCount: 2,
          callHistory: [
            { epsilon: 1.0, purpose: 'first', timestamp: 1 },
            { epsilon: 2.0, purpose: 'second', timestamp: 2 },
          ],
          createdAt: 1, resetAt: null, exhausted: false,
        },
        error: null,
      },
    });

    rerender(<PrivacyBudgetPanel refreshKey={1} />);
    await waitFor(() => expect(screen.getByTestId('privacy-budget-spent')).toHaveTextContent('3.00'));
    expect(lensRunMock).toHaveBeenCalledTimes(2);
  });

  it('reset requires confirmation, then calls privacyBudgetReset and updates the display', async () => {
    lensRunMock.mockResolvedValueOnce({
      data: {
        ok: true,
        result: {
          totalSpent: 5.0, totalBudget: 10, remaining: 5.0, percentUsed: 50,
          callCount: 3, callHistory: [{ epsilon: 5.0, purpose: 'x', timestamp: 1 }],
          createdAt: 1, resetAt: null, exhausted: false,
        },
        error: null,
      },
    });

    render(<PrivacyBudgetPanel />);
    await waitFor(() => expect(screen.getByTestId('privacy-budget-reset-btn')).toBeInTheDocument());

    // A stray click on the reset button must NOT immediately wipe the budget —
    // it only opens a confirmation step.
    fireEvent.click(screen.getByTestId('privacy-budget-reset-btn'));
    expect(screen.getByTestId('privacy-budget-reset-confirm')).toBeInTheDocument();
    expect(lensRunMock).toHaveBeenCalledTimes(1); // still just the initial status load

    lensRunMock.mockResolvedValueOnce({
      data: { ok: true, result: { reset: true, priorSpent: 5.0, priorCallCount: 3, resetAt: 999 }, error: null },
    });
    lensRunMock.mockResolvedValueOnce({
      data: {
        ok: true,
        result: {
          totalSpent: 0, totalBudget: 10, remaining: 10, percentUsed: 0,
          callCount: 0, callHistory: [], createdAt: 999, resetAt: 999, exhausted: false,
        },
        error: null,
      },
    });

    fireEvent.click(screen.getByTestId('privacy-budget-reset-confirm'));

    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('anon', 'privacyBudgetReset', {}),
    );
    await waitFor(() => expect(screen.getByTestId('privacy-budget-spent')).toHaveTextContent('0.00'));
    expect(screen.getByTestId('privacy-budget-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('privacy-budget-reset-confirm')).toBeNull();
  });

  it('cancelling the reset confirmation leaves the budget untouched', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        result: {
          totalSpent: 2.0, totalBudget: 10, remaining: 8.0, percentUsed: 20,
          callCount: 1, callHistory: [{ epsilon: 2.0, purpose: 'x', timestamp: 1 }],
          createdAt: 1, resetAt: null, exhausted: false,
        },
        error: null,
      },
    });
    render(<PrivacyBudgetPanel />);
    await waitFor(() => expect(screen.getByTestId('privacy-budget-reset-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('privacy-budget-reset-btn'));
    fireEvent.click(screen.getByTestId('privacy-budget-reset-cancel'));
    expect(screen.queryByTestId('privacy-budget-reset-confirm')).toBeNull();
    expect(screen.getByTestId('privacy-budget-spent')).toHaveTextContent('2.00');
    // Reset macro was never called.
    expect(lensRunMock).not.toHaveBeenCalledWith('anon', 'privacyBudgetReset', {});
  });

  it('surfaces an honest error on load failure without fabricating numbers', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, result: null, error: 'no_actor' } });
    render(<PrivacyBudgetPanel />);
    await waitFor(() => expect(screen.getByTestId('privacy-budget-error')).toBeInTheDocument());
    expect(screen.getByTestId('privacy-budget-error')).toHaveTextContent('no_actor');
    expect(screen.queryByTestId('privacy-budget-spent')).toBeNull();
  });

  it('surfaces an honest error when the reset call itself fails', async () => {
    lensRunMock.mockResolvedValueOnce({
      data: {
        ok: true,
        result: {
          totalSpent: 1.0, totalBudget: 10, remaining: 9.0, percentUsed: 10,
          callCount: 1, callHistory: [{ epsilon: 1.0, purpose: 'x', timestamp: 1 }],
          createdAt: 1, resetAt: null, exhausted: false,
        },
        error: null,
      },
    });
    render(<PrivacyBudgetPanel />);
    await waitFor(() => expect(screen.getByTestId('privacy-budget-reset-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('privacy-budget-reset-btn'));

    lensRunMock.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'reset_failed' } });
    fireEvent.click(screen.getByTestId('privacy-budget-reset-confirm'));

    await waitFor(() => expect(screen.getByTestId('privacy-budget-error')).toHaveTextContent('reset_failed'));
    // Budget display is unchanged — the failed reset did not silently wipe it.
    expect(screen.getByTestId('privacy-budget-spent')).toHaveTextContent('1.00');
  });
});
