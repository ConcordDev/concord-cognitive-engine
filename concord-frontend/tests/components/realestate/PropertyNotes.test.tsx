import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { PropertyNotes } from '@/components/realestate/PropertyNotes';

const NOTES = [
  { id: 'n1', listingId: 'listing-abc-123', text: 'Roof looks new', timestamp: '2026-05-01T00:00:00Z' },
  { id: 'n2', listingId: 'listing-abc-123', text: 'Kitchen dated', timestamp: '2026-05-02T00:00:00Z' },
];

describe('PropertyNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { notes: [] } } });
  });

  it('shows the all-listings empty state when no listingId', async () => {
    render(<PropertyNotes />);
    expect(await screen.findByText('No notes yet. Select a listing to add one.')).toBeInTheDocument();
    expect(screen.getByText('Notes (all)')).toBeInTheDocument();
  });

  it('shows the per-listing empty state and editor when listingId set', async () => {
    render(<PropertyNotes listingId="listing-abc-123" />);
    expect(await screen.findByText('No notes for this listing yet.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Quick note about this listing…')).toBeInTheDocument();
  });

  it('renders notes when populated', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { notes: NOTES } } });
    render(<PropertyNotes listingId="listing-abc-123" />);
    expect(await screen.findByText('Roof looks new')).toBeInTheDocument();
    expect(screen.getByText('Kitchen dated')).toBeInTheDocument();
  });

  it('does not save when the draft is blank', async () => {
    render(<PropertyNotes listingId="listing-abc-123" />);
    await screen.findByText('No notes for this listing yet.');
    const saveBtn = screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('saves a note and re-fetches', async () => {
    render(<PropertyNotes listingId="listing-abc-123" />);
    await screen.findByText('No notes for this listing yet.');
    fireEvent.change(screen.getByPlaceholderText('Quick note about this listing…'), { target: { value: 'Great yard' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notes-save', input: { listingId: 'listing-abc-123', text: 'Great yard' } }),
      ),
    );
  });

  it('deletes a note', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { notes: NOTES } } });
    render(<PropertyNotes listingId="listing-abc-123" />);
    await screen.findByText('Roof looks new');
    const delButtons = screen.getAllByRole('button').filter((b) => b.querySelector('svg'));
    fireEvent.click(delButtons[delButtons.length - 1]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notes-delete', input: { id: 'n2' } }),
      ),
    );
  });

  it('tolerates a list fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<PropertyNotes listingId="listing-abc-123" />);
    expect(await screen.findByText('No notes for this listing yet.')).toBeInTheDocument();
  });
});
