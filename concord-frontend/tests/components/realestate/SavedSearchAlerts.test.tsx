import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { SavedSearchAlerts } from '@/components/realestate/SavedSearchAlerts';

const SEARCHES = [
  { id: 's1', name: '3BR Austin', filters: { minPrice: 300000, maxPrice: 600000, minBeds: 3, city: 'Austin' }, alertCadence: 'weekly', createdAt: '2026-05-01' },
  { id: 's2', name: 'Anything', filters: {}, alertCadence: 'never', createdAt: '2026-05-02' },
];
const ALERT_HITS = {
  searchId: 's1', searchName: '3BR Austin', totalMatches: 5, newMatchCount: 2, checkedAt: '2026-05-20T00:00:00Z',
  newMatches: [
    { id: 'm1', address: '9 New Rd', price: 525000 },
  ],
};
const ALERT_NONE = { searchId: 's2', searchName: 'Anything', totalMatches: 0, newMatchCount: 0, checkedAt: '2026-05-20T00:00:00Z', newMatches: [] };

function route(impl: (action: string) => unknown) {
  lensRun.mockImplementation((spec: { action: string }) => Promise.resolve(impl(spec.action)));
}

describe('SavedSearchAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { searches: [] } } });
  });

  it('shows the empty state when there are no saved searches', async () => {
    render(<SavedSearchAlerts />);
    expect(await screen.findByText(/No saved searches/)).toBeInTheDocument();
  });

  it('renders saved searches with a human-readable filter summary', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { searches: SEARCHES } } });
    render(<SavedSearchAlerts />);
    expect(await screen.findByText('3BR Austin')).toBeInTheDocument();
    expect(screen.getByText(/≥ \$300,000 · ≤ \$600,000 · 3\+ bd · Austin · weekly alerts/)).toBeInTheDocument();
    expect(screen.getByText(/any listing · never alerts/)).toBeInTheDocument();
  });

  it('adds a saved search through the form', async () => {
    route((action) => {
      if (action === 'saved-searches-list') return { data: { ok: true, result: { searches: [] } } };
      return { data: { ok: true } };
    });
    render(<SavedSearchAlerts />);
    await screen.findByText(/No saved searches/);
    fireEvent.click(screen.getByTitle('New saved search'));
    fireEvent.change(screen.getByPlaceholderText(/Search name/), { target: { value: 'Cheap condos' } });
    fireEvent.change(screen.getByPlaceholderText('Max $'), { target: { value: '250000' } });
    fireEvent.change(screen.getByPlaceholderText('City'), { target: { value: 'Dallas' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'save-search',
          input: expect.objectContaining({ name: 'Cheap condos', filters: { maxPrice: 250000, city: 'Dallas' } }),
        }),
      ),
    );
  });

  it('surfaces an error when saving fails', async () => {
    route((action) => {
      if (action === 'saved-searches-list') return { data: { ok: true, result: { searches: [] } } };
      return { data: { ok: false, error: 'name taken' } };
    });
    render(<SavedSearchAlerts />);
    await screen.findByText(/No saved searches/);
    fireEvent.click(screen.getByTitle('New saved search'));
    fireEvent.change(screen.getByPlaceholderText(/Search name/), { target: { value: 'X' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByText('name taken')).toBeInTheDocument();
  });

  it('removes a saved search', async () => {
    route((action) => {
      if (action === 'saved-searches-list') return { data: { ok: true, result: { searches: SEARCHES } } };
      return { data: { ok: true } };
    });
    render(<SavedSearchAlerts />);
    await screen.findByText('3BR Austin');
    fireEvent.click(screen.getAllByLabelText('Delete search')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete-search', input: { id: 's1' } })),
    );
  });

  it('checks alerts and renders new matches', async () => {
    const onSelect = vi.fn();
    route((action) => {
      if (action === 'saved-searches-list') return { data: { ok: true, result: { searches: SEARCHES } } };
      if (action === 'saved-search-check-alerts') return { data: { ok: true, result: ALERT_HITS } };
      return { data: { ok: true } };
    });
    render(<SavedSearchAlerts onSelect={onSelect} />);
    await screen.findByText('3BR Austin');
    fireEvent.click(screen.getAllByText('Check')[0]);
    expect(await screen.findByText('2 new matches')).toBeInTheDocument();
    fireEvent.click(screen.getByText('9 New Rd'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
  });

  it('shows the no-new-matches state for an empty alert', async () => {
    route((action) => {
      if (action === 'saved-searches-list') return { data: { ok: true, result: { searches: SEARCHES } } };
      if (action === 'saved-search-check-alerts') return { data: { ok: true, result: ALERT_NONE } };
      return { data: { ok: true } };
    });
    render(<SavedSearchAlerts />);
    await screen.findByText('Anything');
    fireEvent.click(screen.getAllByText('Check')[1]);
    expect(await screen.findByText('No new matches')).toBeInTheDocument();
  });

  it('tolerates a refresh rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<SavedSearchAlerts />);
    expect(await screen.findByText(/No saved searches/)).toBeInTheDocument();
  });
});
