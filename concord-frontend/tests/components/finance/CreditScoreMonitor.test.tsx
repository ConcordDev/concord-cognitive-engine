import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

vi.mock('@/components/viz/ChartKit', () => ({
  ChartKit: () => React.createElement('div', { 'data-testid': 'chartkit' }, 'chart'),
}));

import { CreditScoreMonitor } from '@/components/finance/CreditScoreMonitor';

const REPORT = {
  history: [
    { id: 'h1', score: 700, bureau: 'fico', date: '2026-01-01', factors: { paymentHistoryPct: 98, utilisationPct: 22, creditAgeMonths: 80, inquiries12mo: 1, accountMix: 4 } },
    { id: 'h2', score: 740, bureau: 'fico', date: '2026-04-01', factors: { paymentHistoryPct: 99, utilisationPct: 15, creditAgeMonths: 83, inquiries12mo: 0, accountMix: 4 } },
  ],
  latest: { id: 'h2', score: 740, bureau: 'fico', date: '2026-04-01', factors: { paymentHistoryPct: 99, utilisationPct: 15, creditAgeMonths: 83, inquiries12mo: 0, accountMix: 4 } },
  band: 'very good',
  delta: 40,
  deltaFromPrior: 40,
  advice: ['Keep utilisation under 30%'],
};

describe('CreditScoreMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { history: [], latest: null, band: 'unknown', delta: 0, deltaFromPrior: 0, advice: [] } } });
  });

  it('shows empty state when no readings', async () => {
    render(<CreditScoreMonitor />);
    expect(await screen.findByText(/No credit-score readings logged/)).toBeInTheDocument();
  });

  it('renders the latest score, band, chart and advice', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: REPORT } });
    render(<CreditScoreMonitor />);
    await waitFor(() => expect(screen.getAllByText('740').length).toBeGreaterThan(0));
    expect(screen.getByText(/very good · fico/)).toBeInTheDocument();
    expect(screen.getByText('+40 all-time')).toBeInTheDocument();
    expect(screen.getByText(/Keep utilisation under 30/)).toBeInTheDocument();
    expect(screen.getByTestId('chartkit')).toBeInTheDocument();
  });

  it('renders negative delta path', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { ...REPORT, delta: -20, deltaFromPrior: -20 } } });
    render(<CreditScoreMonitor />);
    expect(await screen.findByText('-20 all-time')).toBeInTheDocument();
  });

  it('toggles the add form and rejects out-of-range scores', async () => {
    render(<CreditScoreMonitor />);
    await screen.findByText(/No credit-score readings logged/);
    fireEvent.click(screen.getByLabelText('Add reading'));
    fireEvent.change(await screen.findByPlaceholderText('Score (300-850)'), { target: { value: '900' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Record reading'));
    expect(lensRun).not.toHaveBeenCalledWith('finance', 'credit-score-record', expect.anything());
  });

  it('records a valid reading', async () => {
    render(<CreditScoreMonitor />);
    await screen.findByText(/No credit-score readings logged/);
    fireEvent.click(screen.getByLabelText('Add reading'));
    fireEvent.change(await screen.findByPlaceholderText('Score (300-850)'), { target: { value: '720' } });
    fireEvent.change(screen.getByPlaceholderText('Utilisation %'), { target: { value: '20' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'experian' } });
    lensRun.mockClear();
    lensRun.mockResolvedValue({ data: { ok: true, result: { history: [], latest: null, band: 'x', delta: 0, deltaFromPrior: 0, advice: [] } } });
    fireEvent.click(screen.getByText('Record reading'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('finance', 'credit-score-record', expect.objectContaining({ score: 720, bureau: 'experian', utilisationPct: 20 })),
    );
  });

  it('deletes a reading', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: REPORT } });
    render(<CreditScoreMonitor />);
    await waitFor(() => expect(screen.getAllByText('740').length).toBeGreaterThan(0));
    lensRun.mockClear();
    fireEvent.click(screen.getAllByLabelText('Delete reading')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('finance', 'credit-score-delete', expect.objectContaining({ id: expect.any(String) })),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<CreditScoreMonitor />);
    expect(await screen.findByText(/No credit-score readings logged/)).toBeInTheDocument();
  });
});
