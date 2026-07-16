/// <reference types="@testing-library/jest-dom/vitest" />
// Pins SearchAlertsPanel (Wave 4 gap-closure, docs/WAVE4_INVENTORY.md row 219
// / docs/lens-specs/law-capability-map.md "GENUINELY MISSING — no
// persistence/notification substrate for saved searches") against the real
// law.search-alert-{add,list,check,remove} macro contract: create, list,
// on-demand "Check now" showing real new-results, remove, and honest
// empty/error states + honest on-demand (never automatic-push) labeling.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { SearchAlertsPanel } from '@/components/law/SearchAlertsPanel';

const ALERT = {
  id: 'alt_1',
  query: 'qualified immunity',
  alertType: 'case_law' as const,
  label: 'QI watch',
  court: 'scotus',
  checkInterval: 'manual',
  lastCheckedAt: null,
  neverChecked: true,
  hoursSinceLastCheck: null,
  lastCheckTotalResults: null,
  seenResultCount: 0,
  checkCount: 0,
};

function listResponse(alerts: Array<Record<string, unknown>> = []) {
  return { data: { ok: true, result: { alerts, count: alerts.length }, error: null } };
}

describe('SearchAlertsPanel', () => {
  beforeEach(() => lensRun.mockReset());

  it('loads via search-alert-list and renders the alert row', async () => {
    lensRun.mockResolvedValueOnce(listResponse([ALERT]));
    render(<SearchAlertsPanel />);

    expect(await screen.findByText('QI watch')).toBeInTheDocument();
    expect(screen.getByText(/qualified immunity/)).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('law', 'search-alert-list', {});
  });

  it('an empty book renders an honest empty state, not fabricated placeholder alerts', async () => {
    lensRun.mockResolvedValueOnce(listResponse([]));
    render(<SearchAlertsPanel />);
    await waitFor(() => expect(screen.getByText(/No saved search alerts yet/)).toBeInTheDocument());
  });

  it('honestly labels checks as on-demand only — never implies automatic/push delivery', async () => {
    lensRun.mockResolvedValueOnce(listResponse([]));
    render(<SearchAlertsPanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    expect(screen.getByText(/Checked on demand only/)).toBeInTheDocument();
    expect(screen.getByText(/no push\/email notification/i)).toBeInTheDocument();
  });

  it('a fresh, never-checked alert says so honestly', async () => {
    lensRun.mockResolvedValueOnce(listResponse([ALERT]));
    render(<SearchAlertsPanel />);
    expect(await screen.findByText('Never checked yet.')).toBeInTheDocument();
  });

  it('create calls search-alert-add with the typed fields and refreshes the list', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce({ data: { ok: true, result: { alert: { ...ALERT, id: 'alt_new', label: 'New watch', query: 'eminent domain' } }, error: null } })
      .mockResolvedValueOnce(listResponse([{ ...ALERT, id: 'alt_new', label: 'New watch', query: 'eminent domain' }]));

    render(<SearchAlertsPanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Save a search'));
    fireEvent.change(screen.getByPlaceholderText('Search terms (e.g. qualified immunity, or a citation)'), {
      target: { value: 'eminent domain' },
    });
    fireEvent.change(screen.getByPlaceholderText('Label (optional)'), { target: { value: 'New watch' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('law', 'search-alert-add', {
        query: 'eminent domain',
        alertType: 'case_law',
        label: 'New watch',
        court: undefined,
      }),
    );
    expect(await screen.findByText('New watch')).toBeInTheDocument();
  });

  it('rejects saving an alert with a blank query, without calling the macro', async () => {
    lensRun.mockResolvedValueOnce(listResponse([]));
    render(<SearchAlertsPanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Save a search'));
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByText(/search query is required/)).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledTimes(1); // only the initial list load
  });

  it('"Check now" calls search-alert-check and renders the REAL new-results returned', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([ALERT]))
      .mockResolvedValueOnce({
        data: {
          ok: true,
          result: {
            alertId: 'alt_1', alertType: 'case_law', query: 'qualified immunity',
            newResults: [{ id: 42, caseName: 'Doe v. Roe' }],
            newCount: 1, totalResults: 1, totalHits: 1,
            checkedAt: '2026-07-16T00:00:00.000Z', firstCheck: true,
          },
          error: null,
        },
      })
      .mockResolvedValueOnce(listResponse([{ ...ALERT, neverChecked: false, checkCount: 1, lastCheckTotalResults: 1, hoursSinceLastCheck: 0 }]));

    render(<SearchAlertsPanel />);
    const row = (await screen.findByText('QI watch')).closest('li') as HTMLElement;
    fireEvent.click(within(row).getByText('Check now'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('law', 'search-alert-check', { id: 'alt_1' }),
    );
    expect(await screen.findByText(/1 new result/)).toBeInTheDocument();
    expect(screen.getByText(/first check/)).toBeInTheDocument();
    expect(screen.getByText('Doe v. Roe')).toBeInTheDocument();
  });

  it('"Check now" with zero new results reports it honestly (not an error, not silence)', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([ALERT]))
      .mockResolvedValueOnce({
        data: {
          ok: true,
          result: {
            alertId: 'alt_1', alertType: 'case_law', query: 'qualified immunity',
            newResults: [], newCount: 0, totalResults: 3, totalHits: 3,
            checkedAt: '2026-07-16T00:00:00.000Z', firstCheck: false,
          },
          error: null,
        },
      })
      .mockResolvedValueOnce(listResponse([ALERT]));

    render(<SearchAlertsPanel />);
    const row = (await screen.findByText('QI watch')).closest('li') as HTMLElement;
    fireEvent.click(within(row).getByText('Check now'));

    expect(await screen.findByText(/No new results since the last check \(3 total fetched\)/)).toBeInTheDocument();
  });

  it('a failed underlying search surfaces the REAL error — never a fabricated "0 new results"', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([ALERT]))
      .mockResolvedValueOnce({ data: { ok: false, result: null, error: 'courtlistener rate limit — set COURTLISTENER_API_TOKEN env' } });

    render(<SearchAlertsPanel />);
    const row = (await screen.findByText('QI watch')).closest('li') as HTMLElement;
    fireEvent.click(within(row).getByText('Check now'));

    expect(await screen.findByText(/Check failed: courtlistener rate limit/)).toBeInTheDocument();
    expect(screen.queryByText(/No new results/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 new result/)).not.toBeInTheDocument();
  });

  it('remove calls search-alert-remove and drops the row from the list', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([ALERT]))
      .mockResolvedValueOnce({ data: { ok: true, result: { removed: 'alt_1' }, error: null } })
      .mockResolvedValueOnce(listResponse([]));

    render(<SearchAlertsPanel />);
    const row = (await screen.findByText('QI watch')).closest('li') as HTMLElement;
    fireEvent.click(within(row).getByTitle('Remove alert'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('law', 'search-alert-remove', { id: 'alt_1' }),
    );
    await waitFor(() => expect(screen.queryByText('QI watch')).not.toBeInTheDocument());
    expect(await screen.findByText(/No saved search alerts yet/)).toBeInTheDocument();
  });

  it('surfaces an honest error on a failed list load instead of a silent blank panel', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'STATE unavailable' } });
    render(<SearchAlertsPanel />);
    expect(await screen.findByText('STATE unavailable')).toBeInTheDocument();
  });
});
