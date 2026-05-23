import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { FOIATracker } from '@/components/government/FOIATracker';

const REQUESTS = [
  { id: 'f1', agency: 'GSA', subject: 'Contracts', body: 'b', submittedAt: '2026-01-01', status: 'fulfilled', trackingNumber: 'TRK9' },
  { id: 'f2', agency: 'FBI', subject: 'Records', body: 'b', submittedAt: '2026-01-02', status: 'denied' },
  { id: 'f3', agency: 'DOJ', subject: 'Review', body: 'b', submittedAt: '2026-01-03', status: 'in_review' },
  { id: 'f4', agency: 'EPA', subject: 'Draft', body: 'b', submittedAt: '2026-01-04', status: 'draft' },
];

describe('FOIATracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { requests: [] } } });
  });

  it('shows empty state', async () => {
    render(<FOIATracker />);
    expect(await screen.findByText(/No FOIA requests yet/)).toBeInTheDocument();
  });

  it('renders requests with every status branch', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { requests: REQUESTS } } });
    render(<FOIATracker />);
    expect(await screen.findByText('Contracts')).toBeInTheDocument();
    expect(screen.getByText('fulfilled')).toBeInTheDocument();
    expect(screen.getByText('denied')).toBeInTheDocument();
    expect(screen.getByText('in review')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByText(/#TRK9/)).toBeInTheDocument();
  });

  it('toggles the create form open and closed', async () => {
    render(<FOIATracker />);
    await screen.findByText(/No FOIA requests yet/);
    fireEvent.click(screen.getByTitle('New request'));
    expect(screen.getByPlaceholderText(/Agency/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText(/Agency/)).not.toBeInTheDocument();
  });

  it('applies a template to the draft fields', async () => {
    render(<FOIATracker />);
    await screen.findByText(/No FOIA requests yet/);
    fireEvent.click(screen.getByTitle('New request'));
    fireEvent.click(screen.getByText('Government contracts (vendor X)'));
    expect((screen.getByPlaceholderText(/Agency/) as HTMLInputElement).value).toBe('GSA');
    expect((screen.getByPlaceholderText('Subject') as HTMLInputElement).value).toBe('Government contracts (vendor X)');
  });

  it('disables Save until all fields filled, then saves', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'foia-create'
        ? Promise.resolve({ data: { ok: true } })
        : Promise.resolve({ data: { ok: true, result: { requests: [] } } }),
    );
    render(<FOIATracker />);
    await screen.findByText(/No FOIA requests yet/);
    fireEvent.click(screen.getByTitle('New request'));
    const save = screen.getByText('Save draft');
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Agency/), { target: { value: 'GSA' } });
    fireEvent.change(screen.getByPlaceholderText('Subject'), { target: { value: 'My FOIA' } });
    fireEvent.change(screen.getByPlaceholderText('Request body...'), { target: { value: 'body text' } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'foia-create', input: { agency: 'GSA', subject: 'My FOIA', body: 'body text' } }),
      ),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<FOIATracker />);
    expect(await screen.findByText(/No FOIA requests yet/)).toBeInTheDocument();
  });
});
