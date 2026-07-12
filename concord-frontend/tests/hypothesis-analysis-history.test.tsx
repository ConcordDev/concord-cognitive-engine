/**
 * StatsWorkbench — History tab. Pins the previously-unsurfaced
 * `hypothesis.analysisHistory` macro (server/domains/hypothesis.js) now
 * wired in: every test in the battery (t-test/ANOVA/chi-square/correlation/
 * regression/Z-test/A-B-test/Bayesian/power/assumption-check/multiple-
 * comparison) calls `recordAnalysis()` on success, so this is a real
 * per-user run log. Clicking a row asks `hypothesis.apaReport` to
 * regenerate the write-up from the stored analysisId — no re-computation,
 * no invented numbers.
 *
 * lensRun is the one mock surface — no fabricated data.
 *   hypothesis.analysisHistory -> { ok:true, result: { items: [...], count } }
 *   hypothesis.apaReport       -> { ok:true, result: { kind, title, apa, ... } }
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor, screen } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { StatsWorkbench } from '@/components/hypothesis/StatsWorkbench';

const ITEMS = [
  { id: 'ana_2', kind: 'tTest', summary: 'welch t-test', createdAt: '2026-07-10T10:00:00.000Z' },
  { id: 'ana_1', kind: 'anova', summary: 'One-way ANOVA (3 groups)', createdAt: '2026-07-09T10:00:00.000Z' },
];

type MacroResponse = { data: { ok: boolean; result: unknown; error: string | null } };
type MacroOverride = (input: Record<string, unknown>) => MacroResponse;

function baseImpl(overrides: Record<string, MacroOverride> = {}) {
  return (domain: string, action: string, input: Record<string, unknown>) => {
    if (domain !== 'hypothesis') return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    if (overrides[action]) return Promise.resolve(overrides[action](input));
    return Promise.resolve({ data: { ok: true, result: {}, error: null } });
  };
}

beforeEach(() => {
  lensRunMock.mockReset();
});

async function openHistoryTab() {
  await act(async () => { render(<StatsWorkbench />); });
  await act(async () => { fireEvent.click(screen.getByText('History')); });
}

describe('StatsWorkbench — History tab (hypothesis.analysisHistory)', () => {
  it('renders the real saved analysis runs, most-recent first as the backend ordered them', async () => {
    lensRunMock.mockImplementation(baseImpl({
      analysisHistory: () => ({ data: { ok: true, result: { items: ITEMS, count: ITEMS.length }, error: null } }),
    }));

    await openHistoryTab();

    await waitFor(() => expect(screen.getByTestId('hypothesis-analysis-history')).toBeInTheDocument());
    const list = screen.getByTestId('hypothesis-analysis-history');
    const rows = list.querySelectorAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('welch t-test');
    expect(rows[0].textContent).toContain('tTest');
    expect(rows[1].textContent).toContain('One-way ANOVA (3 groups)');

    const call = lensRunMock.mock.calls.find((c) => c[1] === 'analysisHistory');
    expect(call).toBeTruthy();
  });

  it('shows an honest empty state when nothing has been analyzed yet', async () => {
    lensRunMock.mockImplementation(baseImpl({
      analysisHistory: () => ({ data: { ok: true, result: { items: [], count: 0 }, error: null } }),
    }));

    await openHistoryTab();

    await waitFor(() => expect(screen.getByText(/No analyses run yet/)).toBeInTheDocument());
    expect(screen.queryByTestId('hypothesis-analysis-history')).not.toBeInTheDocument();
  });

  it('clicking a run regenerates its APA report via apaReport({ analysisId }) — not a fresh computation', async () => {
    lensRunMock.mockImplementation(baseImpl({
      analysisHistory: () => ({ data: { ok: true, result: { items: ITEMS, count: ITEMS.length }, error: null } }),
      apaReport: (input) => ({
        data: {
          ok: true,
          result: {
            kind: 'tTest',
            title: 'Independent/Paired Samples t-Test',
            apa: `Results\n\nStored write-up for ${input.analysisId}.`,
            statement: 'x',
            generatedAt: '2026-07-11T00:00:00.000Z',
          },
          error: null,
        },
      }),
    }));

    await openHistoryTab();
    await waitFor(() => expect(screen.getByTestId('hypothesis-analysis-history')).toBeInTheDocument());

    fireEvent.click(screen.getByText('welch t-test'));

    await waitFor(() => expect(screen.getByText(/Stored write-up for ana_2/)).toBeInTheDocument());

    const call = lensRunMock.mock.calls.find((c) => c[1] === 'apaReport');
    expect(call?.[2]).toEqual({ analysisId: 'ana_2' });

    // Toggling the same row closed collapses the report again.
    fireEvent.click(screen.getByText('welch t-test'));
    await waitFor(() => expect(screen.queryByText(/Stored write-up for ana_2/)).not.toBeInTheDocument());
  });

  it('surfaces an honest error when the history load fails', async () => {
    lensRunMock.mockImplementation(baseImpl({
      analysisHistory: () => ({ data: { ok: false, result: null, error: 'no_user' } }),
    }));

    await openHistoryTab();
    await waitFor(() => expect(screen.getByText('no_user')).toBeInTheDocument());
  });
});
