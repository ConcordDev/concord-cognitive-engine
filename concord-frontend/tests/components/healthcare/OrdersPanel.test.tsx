import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/lib/utils', () => ({ cn: (...a: unknown[]) => a.filter(Boolean).join(' ') }));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { OrdersPanel } from '@/components/healthcare/OrdersPanel';

const orders = [
  { id: 'o1', number: 'ORD-1', kind: 'medication', name: 'Amoxicillin', status: 'active',
    priority: 'routine', details: '', dose: '500mg', frequency: 'BID', route: 'PO' },
  { id: 'o2', number: 'ORD-2', kind: 'lab', name: 'CBC', status: 'completed',
    priority: 'stat', details: '', dose: null, frequency: null, route: null },
];

describe('OrdersPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the loading then empty state', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { orders: [] } } });
    render(<OrdersPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/No orders for this patient/)).toBeInTheDocument());
  });

  it('renders the order list with priority and status', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { orders } } });
    render(<OrdersPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText('Amoxicillin')).toBeInTheDocument());
    expect(screen.getByText('CBC')).toBeInTheDocument();
    expect(screen.getByText('stat')).toBeInTheDocument();
  });

  it('does not place an order when the name is blank', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { orders: [] } } });
    render(<OrdersPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No orders for this patient/));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Place/ }));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('places a medication order and shows dose/frequency fields for medication kind', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { orders: [] } } });
    render(<OrdersPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No orders for this patient/));
    expect(screen.getByPlaceholderText(/dose/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Order name'), { target: { value: 'Ibuprofen' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Place/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'order-create')).toBe(true));
  });

  it('hides dose/frequency fields for a non-medication kind', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { orders: [] } } });
    render(<OrdersPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No orders for this patient/));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'lab' } });
    expect(screen.queryByPlaceholderText(/dose/)).not.toBeInTheDocument();
  });

  it('runs an interaction check showing the no-interactions branch', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { orders: [], interactions: [] } } });
    render(<OrdersPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No orders for this patient/));
    fireEvent.click(screen.getByRole('button', { name: /Check/ }));
    await waitFor(() => expect(screen.getByText(/No interactions detected/)).toBeInTheDocument());
  });

  it('runs an interaction check showing major/moderate interactions', async () => {
    lensRun.mockImplementation((arg: { action: string }) => {
      if (arg.action === 'drug-interaction-check') {
        return Promise.resolve({ data: { ok: true, result: { interactions: [
          { type: 'drug-drug', a: 'Warfarin', b: 'Aspirin', severity: 'major', note: 'Bleeding risk' },
          { type: 'drug-allergy', a: 'Penicillin', b: 'Amoxicillin', severity: 'moderate', note: 'Cross-reactivity' },
        ] } } });
      }
      return Promise.resolve({ data: { ok: true, result: { orders: [] } } });
    });
    render(<OrdersPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No orders for this patient/));
    fireEvent.change(screen.getByPlaceholderText(/Candidate drug/), { target: { value: 'Aspirin' } });
    fireEvent.click(screen.getByRole('button', { name: /Check/ }));
    await waitFor(() => expect(screen.getByText('Bleeding risk')).toBeInTheDocument());
    expect(screen.getByText('Cross-reactivity')).toBeInTheDocument();
  });

  it('updates an order status and cancels an open order', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { orders } } });
    render(<OrdersPanel patientId="p1" />);
    await waitFor(() => screen.getByText('Amoxicillin'));
    lensRun.mockClear();
    // status select for the active order (the lab order is closed/disabled)
    const statusSelects = screen.getAllByRole('combobox').slice(2);
    fireEvent.change(statusSelects[0], { target: { value: 'completed' } });
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'order-update-status')).toBe(true));
    lensRun.mockClear();
    fireEvent.click(screen.getByTestId('icon-X').closest('button')!);
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'order-cancel')).toBe(true));
  });

  it('handles a list error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('x'));
    render(<OrdersPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/No orders for this patient/)).toBeInTheDocument());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
