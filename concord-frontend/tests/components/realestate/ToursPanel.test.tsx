import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ToursPanel } from '@/components/realestate/ToursPanel';

const TOURS = [
  { id: 't1', listingId: 'L1', date: '2026-06-10', time: '11:00', kind: 'in_person', status: 'requested', requestedAt: '2026-05-01', notes: 'bring keys' },
  { id: 't2', listingId: 'L2', date: '2026-06-11', time: '14:00', kind: 'video', status: 'confirmed', requestedAt: '2026-05-02', notes: '' },
  { id: 't3', listingId: 'L3', date: '2026-06-12', time: '09:00', kind: 'self_tour', status: 'cancelled', requestedAt: '2026-05-03', notes: '' },
];

describe('ToursPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { tours: [] } } });
  });

  it('shows empty state when no tours', async () => {
    render(<ToursPanel />);
    expect(await screen.findByText('No tours scheduled.')).toBeInTheDocument();
  });

  it('renders tours with status badges and the upcoming count', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { tours: TOURS } } });
    render(<ToursPanel />);
    expect(await screen.findByText('L1')).toBeInTheDocument();
    expect(screen.getByText('requested')).toBeInTheDocument();
    expect(screen.getByText('confirmed')).toBeInTheDocument();
    expect(screen.getByText('cancelled')).toBeInTheDocument();
    expect(screen.getByText('1 upcoming')).toBeInTheDocument();
  });

  it('opens the create form and pre-fills the default listing id', async () => {
    render(<ToursPanel defaultListingId="pre-fill-id" />);
    await screen.findByText('No tours scheduled.');
    fireEvent.click(screen.getByRole('button', { name: '' }) || screen.getAllByRole('button')[0]);
    const idInput = screen.getByPlaceholderText('Listing ID') as HTMLInputElement;
    expect(idInput.value).toBe('pre-fill-id');
  });

  it('does not request a tour without a date', async () => {
    render(<ToursPanel defaultListingId="L9" />);
    await screen.findByText('No tours scheduled.');
    fireEvent.click(screen.getAllByRole('button')[0]);
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Request'));
    await waitFor(() => {
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'tours-request' }));
    });
  });

  it('requests a tour when listing and date are present', async () => {
    render(<ToursPanel />);
    await screen.findByText('No tours scheduled.');
    fireEvent.click(screen.getAllByRole('button')[0]);
    fireEvent.change(screen.getByPlaceholderText('Listing ID'), { target: { value: 'L42' } });
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByPlaceholderText('Notes (optional)'), { target: { value: 'note' } });
    fireEvent.click(screen.getByText('Request'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tours-request',
          input: expect.objectContaining({ listingId: 'L42', date: '2026-07-01', notes: 'note' }),
        }),
      ),
    );
  });

  it('cancels a requested tour', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'tours-list') return Promise.resolve({ data: { ok: true, result: { tours: TOURS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<ToursPanel />);
    await screen.findByText('L1');
    fireEvent.click(screen.getByTitle('Cancel'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tours-cancel', input: { id: 't1' } }),
      ),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<ToursPanel />);
    expect(await screen.findByText('No tours scheduled.')).toBeInTheDocument();
  });
});
