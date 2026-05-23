import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { FinanceAssistant } from '@/components/finance/FinanceAssistant';

describe('FinanceAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { result: { answer: 'Save 15% of income.', source: 'conscious' } } });
  });

  it('renders suggestion chips on empty state', () => {
    render(<FinanceAssistant />);
    expect(screen.getByText(/Ask anything about your finances/)).toBeInTheDocument();
    expect(screen.getByText(/How much should I be saving for retirement/)).toBeInTheDocument();
  });

  it('sends a question via a suggestion and shows the answer', async () => {
    render(<FinanceAssistant />);
    fireEvent.click(screen.getByText(/Where am I overspending this month/));
    await waitFor(() => expect(screen.getByText('Save 15% of income.')).toBeInTheDocument());
    expect(screen.getByText('conscious')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'assistant-ask' }));
  });

  it('submits the form with typed input', async () => {
    render(<FinanceAssistant />);
    const input = screen.getByPlaceholderText(/Ask about your finances/);
    fireEvent.change(input, { target: { value: 'Should I refinance?' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    await waitFor(() => expect(screen.getByText('Should I refinance?')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Save 15% of income.')).toBeInTheDocument());
  });

  it('does not send a blank message', () => {
    render(<FinanceAssistant />);
    const input = screen.getByPlaceholderText(/Ask about your finances/);
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('falls back to empty-response text when no answer returned', async () => {
    lensRun.mockResolvedValue({ data: { result: {} } });
    render(<FinanceAssistant />);
    fireEvent.click(screen.getByText(/Should I pay off debt or invest/));
    await waitFor(() => expect(screen.getByText('(empty response)')).toBeInTheDocument());
  });

  it('shows an error bubble when the request rejects', async () => {
    lensRun.mockRejectedValue(new Error('brain offline'));
    render(<FinanceAssistant />);
    fireEvent.click(screen.getByText(/best way to hit my house-down-payment goal/));
    await waitFor(() => expect(screen.getByText(/Error: brain offline/)).toBeInTheDocument());
  });
});
