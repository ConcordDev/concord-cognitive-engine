import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AdvocacyPanel } from '@/components/government/AdvocacyPanel';

const ACTIONS = [
  {
    id: 'a1', billId: 'HR1234-119', billTitle: 'Climate Act', stance: 'support',
    channel: 'email', message: 'Please support this', representative: 'Rep Smith',
    bioguideId: 'B001', contactedAt: '2026-05-01T00:00:00Z',
  },
  {
    id: 'a2', billId: 'S99-119', billTitle: '', stance: 'oppose',
    channel: 'call', message: '', representative: '',
    bioguideId: '', contactedAt: '2026-05-02T00:00:00Z',
  },
  {
    id: 'a3', billId: 'HR5-119', billTitle: 'Tax Bill', stance: 'comment',
    channel: 'letter', message: 'A comment', representative: 'Sen Doe',
    bioguideId: 'D001', contactedAt: '2026-05-03T00:00:00Z',
  },
];

describe('AdvocacyPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { actions: [] } } });
  });

  it('shows empty state when no actions', async () => {
    render(<AdvocacyPanel />);
    expect(await screen.findByText('No advocacy actions logged yet.')).toBeInTheDocument();
  });

  it('renders populated actions with channels and stances', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { actions: ACTIONS } } });
    render(<AdvocacyPanel />);
    expect(await screen.findByText('Climate Act')).toBeInTheDocument();
    expect(screen.getByText('support')).toBeInTheDocument();
    expect(screen.getByText('oppose')).toBeInTheDocument();
    expect(screen.getByText('comment')).toBeInTheDocument();
    expect(screen.getByText('via Rep Smith (email)')).toBeInTheDocument();
    expect(screen.getByText('Please support this')).toBeInTheDocument();
  });

  it('validates bill ID is required', async () => {
    render(<AdvocacyPanel />);
    await screen.findByText('No advocacy actions logged yet.');
    fireEvent.click(screen.getByText('Log advocacy action'));
    expect(await screen.findByText(/Bill ID required/)).toBeInTheDocument();
  });

  it('validates message required for non-call channels', async () => {
    render(<AdvocacyPanel />);
    await screen.findByText('No advocacy actions logged yet.');
    fireEvent.change(screen.getByPlaceholderText('Bill ID (HR1234-119)'), { target: { value: 'HR1' } });
    fireEvent.click(screen.getByText('Log advocacy action'));
    expect(await screen.findByText(/Message required/)).toBeInTheDocument();
  });

  it('allows call channel without a message', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'advocacy-record') return Promise.resolve({ data: { ok: true } });
      return Promise.resolve({ data: { ok: true, result: { actions: [] } } });
    });
    render(<AdvocacyPanel />);
    await screen.findByText('No advocacy actions logged yet.');
    fireEvent.change(screen.getByPlaceholderText('Bill ID (HR1234-119)'), { target: { value: 'HR1' } });
    fireEvent.change(screen.getByDisplayValue('Comment'), { target: { value: 'call' } });
    fireEvent.click(screen.getByText('Log advocacy action'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'advocacy-record' })),
    );
  });

  it('records an advocacy action and clears the form', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'advocacy-record') return Promise.resolve({ data: { ok: true } });
      return Promise.resolve({ data: { ok: true, result: { actions: [] } } });
    });
    render(<AdvocacyPanel />);
    await screen.findByText('No advocacy actions logged yet.');
    const billInput = screen.getByPlaceholderText('Bill ID (HR1234-119)') as HTMLInputElement;
    fireEvent.change(billInput, { target: { value: 'HR9-119' } });
    fireEvent.change(screen.getByPlaceholderText('Bill title'), { target: { value: 'My Bill' } });
    fireEvent.change(screen.getByPlaceholderText(/Representative contacted/), { target: { value: 'Rep X' } });
    fireEvent.change(screen.getByPlaceholderText(/Your message/), { target: { value: 'hi' } });
    fireEvent.change(screen.getByDisplayValue('Support'), { target: { value: 'oppose' } });
    fireEvent.click(screen.getByText('Log advocacy action'));
    await waitFor(() => expect(billInput.value).toBe(''));
  });

  it('surfaces a server-side record error', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'advocacy-record')
        return Promise.resolve({ data: { ok: false, error: 'duplicate action' } });
      return Promise.resolve({ data: { ok: true, result: { actions: [] } } });
    });
    render(<AdvocacyPanel />);
    await screen.findByText('No advocacy actions logged yet.');
    fireEvent.change(screen.getByPlaceholderText('Bill ID (HR1234-119)'), { target: { value: 'HR1' } });
    fireEvent.change(screen.getByPlaceholderText(/Your message/), { target: { value: 'hi' } });
    fireEvent.click(screen.getByText('Log advocacy action'));
    expect(await screen.findByText('duplicate action')).toBeInTheDocument();
  });

  it('handles record rejection', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'advocacy-record') return Promise.reject(new Error('network down'));
      return Promise.resolve({ data: { ok: true, result: { actions: [] } } });
    });
    render(<AdvocacyPanel />);
    await screen.findByText('No advocacy actions logged yet.');
    fireEvent.change(screen.getByPlaceholderText('Bill ID (HR1234-119)'), { target: { value: 'HR1' } });
    fireEvent.change(screen.getByPlaceholderText(/Your message/), { target: { value: 'hi' } });
    fireEvent.click(screen.getByText('Log advocacy action'));
    expect(await screen.findByText('network down')).toBeInTheDocument();
  });

  it('deletes an action', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { actions: ACTIONS } } });
    render(<AdvocacyPanel />);
    await screen.findByText('Climate Act');
    const buttons = document.querySelectorAll('button');
    // delete buttons are the last button in each row
    lensRun.mockClear();
    lensRun.mockResolvedValue({ data: { ok: true } });
    fireEvent.click(buttons[buttons.length - 3]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'advocacy-delete' })),
    );
  });

  it('shows a tally when a bill id is clicked', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'advocacy-bill-tally')
        return Promise.resolve({
          data: { ok: true, result: { tally: { support: 5, oppose: 2, comment: 1 }, total: 8 } },
        });
      return Promise.resolve({ data: { ok: true, result: { actions: ACTIONS } } });
    });
    render(<AdvocacyPanel />);
    await screen.findByText('Climate Act');
    fireEvent.click(screen.getByText('HR1234-119'));
    await waitFor(() => expect(screen.getByText(/8 actions/)).toBeInTheDocument());
  });

  it('tolerates a refresh rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<AdvocacyPanel />);
    expect(await screen.findByText('No advocacy actions logged yet.')).toBeInTheDocument();
  });
});
