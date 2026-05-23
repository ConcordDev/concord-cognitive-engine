import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AccountingAskBar } from '@/components/accounting/AccountingAskBar';

describe('AccountingAskBar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the sample-question chips', () => {
    render(<AccountingAskBar />);
    expect(screen.getByText('Show me overdue invoices')).toBeInTheDocument();
    expect(screen.getByText('How much runway?')).toBeInTheDocument();
  });

  it('does not show the submit button until the input has text', () => {
    render(<AccountingAskBar />);
    expect(screen.queryByRole('button', { name: '' })).toBeNull();
    const input = screen.getByPlaceholderText(/Ask anything about your books/);
    fireEvent.change(input, { target: { value: 'cash?' } });
    // submit button now exists inside the form
    expect(input.closest('form')!.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it('does not call the macro when submitting an empty question', () => {
    render(<AccountingAskBar />);
    const input = screen.getByPlaceholderText(/Ask anything about your books/);
    fireEvent.submit(input.closest('form')!);
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('asks a question via form submit and renders the answer', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { intent: 'cash', answer: 'You have $50k.' } } });
    render(<AccountingAskBar />);
    const input = screen.getByPlaceholderText(/Ask anything about your books/);
    fireEvent.change(input, { target: { value: 'How much cash?' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByText('You have $50k.')).toBeInTheDocument();
    expect(screen.getByText('intent: cash')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'accounting', action: 'ask', input: { question: 'How much cash?' } }),
    );
  });

  it('asks a question when a sample chip is clicked', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { intent: 'runway', answer: '8 months.' } } });
    render(<AccountingAskBar />);
    fireEvent.click(screen.getByText('How much runway?'));
    expect(await screen.findByText('8 months.')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ input: { question: 'How much runway?' } }),
    );
  });

  it('renders no answer panel when the macro returns no result', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
    render(<AccountingAskBar />);
    fireEvent.click(screen.getByText('YTD profit?'));
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    expect(screen.queryByText(/^intent:/)).toBeNull();
  });

  it('survives a rejected macro call without crashing', async () => {
    lensRun.mockRejectedValue(new Error('boom'));
    render(<AccountingAskBar />);
    fireEvent.click(screen.getByText('What bills are open?'));
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    expect(screen.queryByText(/^intent:/)).toBeNull();
  });
});
