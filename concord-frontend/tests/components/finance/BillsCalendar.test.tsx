import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { BillsCalendar } from '@/components/finance/BillsCalendar';

const BILLS = [
  { id: 'b1', name: 'Rent', amount: 1500, dueDay: 1, cadence: 'monthly', autopay: true, category: 'Housing', paidThisCycle: false, lastPaidAt: null },
  { id: 'b2', name: 'Car Insurance', amount: 1200, dueDay: 15, cadence: 'annual', autopay: false, category: 'Insurance', paidThisCycle: false, lastPaidAt: null },
  { id: 'b3', name: 'Internet', amount: 60, dueDay: 10, cadence: 'monthly', autopay: false, category: 'Utilities', paidThisCycle: true, lastPaidAt: '2026-05-09T00:00:00Z' },
];

const FORECAST = {
  series: [
    { date: '2026-05-01', credit: 3000, debit: 0, balance: 5000 },
    { date: '2026-05-15', credit: 0, debit: 1500, balance: 3500 },
    { date: '2026-06-01', credit: 0, debit: 600, balance: -200 },
  ],
  startBalance: 2000,
  finalBalance: -200,
  lowestBalance: -200,
  lowestDate: '2026-06-01',
  alert: 'Balance projected to go negative on 2026-06-01',
};

describe('BillsCalendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { result: { bills: [] } } });
  });

  it('shows empty state with no bills', async () => {
    render(<BillsCalendar />);
    expect(await screen.findByText(/No bills yet/)).toBeInTheDocument();
  });

  it('renders bills, monthly total, paid + upcoming sections', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'bills-list') return Promise.resolve({ data: { result: { bills: BILLS } } });
      if (spec.action === 'cashflow-forecast') return Promise.resolve({ data: { result: FORECAST } });
      return Promise.resolve({ data: { result: {} } });
    });
    render(<BillsCalendar />);
    expect(await screen.findByText('Rent')).toBeInTheDocument();
    expect(screen.getByText('Car Insurance')).toBeInTheDocument();
    expect(screen.getByText('Internet')).toBeInTheDocument();
    expect(screen.getByText('AUTOPAY')).toBeInTheDocument();
    // forecast alert + negative end balance
    await waitFor(() => expect(screen.getByText(/Balance projected to go negative/)).toBeInTheDocument());
    expect(screen.getByText('End: $-200')).toBeInTheDocument();
  });

  it('toggles create form and ignores empty submit', async () => {
    render(<BillsCalendar />);
    await screen.findByText(/No bills yet/);
    fireEvent.click(screen.getByTitle('New bill'));
    expect(await screen.findByPlaceholderText('Name')).toBeInTheDocument();
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Add'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'bills-add' }));
  });

  it('creates a new bill', async () => {
    render(<BillsCalendar />);
    await screen.findByText(/No bills yet/);
    fireEvent.click(screen.getByTitle('New bill'));
    fireEvent.change(await screen.findByPlaceholderText('Name'), { target: { value: 'Phone' } });
    fireEvent.change(screen.getByPlaceholderText('$'), { target: { value: '55' } });
    fireEvent.change(screen.getByPlaceholderText('Day'), { target: { value: '20' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'weekly' } });
    lensRun.mockClear();
    lensRun.mockResolvedValue({ data: { result: { bills: [] } } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({
        action: 'bills-add', input: expect.objectContaining({ name: 'Phone', amount: 55, dueDay: 20, cadence: 'weekly' }),
      })),
    );
  });

  it('pays and deletes a bill', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'bills-list') return Promise.resolve({ data: { result: { bills: BILLS } } });
      if (spec.action === 'cashflow-forecast') return Promise.resolve({ data: { result: FORECAST } });
      return Promise.resolve({ data: { result: {} } });
    });
    render(<BillsCalendar />);
    await screen.findByText('Rent');
    lensRun.mockClear();
    fireEvent.click(screen.getAllByTitle('Mark paid')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'bills-pay' })));
    // The Delete button is only visible on hover (opacity-0 group-hover:opacity-100), but DOM-wise it
    // is still in the document — so getAllByTitle still finds it. We just need to ensure refresh()
    // post-pay completed and the row is still mounted.
    await waitFor(() => expect(screen.getAllByTitle('Delete').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTitle('Delete')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'bills-delete' })));
  });

  it('renders forecast chart with no series gracefully', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'bills-list') return Promise.resolve({ data: { result: { bills: BILLS } } });
      if (spec.action === 'cashflow-forecast') return Promise.resolve({ data: { result: { ...FORECAST, series: [], finalBalance: 100, alert: null } } });
      return Promise.resolve({ data: { result: {} } });
    });
    render(<BillsCalendar />);
    await screen.findByText('Rent');
    await waitFor(() => expect(screen.getByText('End: $100')).toBeInTheDocument());
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<BillsCalendar />);
    expect(await screen.findByText(/No bills yet/)).toBeInTheDocument();
  });
});
