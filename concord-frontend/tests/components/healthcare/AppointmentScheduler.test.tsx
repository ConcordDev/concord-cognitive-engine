import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/lib/utils', () => ({ cn: (...a: unknown[]) => a.filter(Boolean).join(' ') }));
vi.mock('@/components/payment/StripePaymentForm', () => ({
  StripePaymentForm: ({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) =>
    React.createElement('div', { 'data-testid': 'stripe-form' },
      React.createElement('button', { onClick: onSuccess }, 'stripe-success'),
      React.createElement('button', { onClick: onCancel }, 'stripe-cancel'),
    ),
}));

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

import { AppointmentScheduler } from '@/components/healthcare/AppointmentScheduler';

const providers = [
  { id: 'pr1', name: 'Dr. Lee', specialty: 'Primary care', practice: 'Main Clinic', inNetwork: true,
    nextSlot: 'Tomorrow', acceptsTelehealth: true, rating: 4.8, distanceMi: 2.1 },
  { id: 'pr2', name: 'Dr. Kim', specialty: 'Cardiology', practice: 'Heart Center', inNetwork: false,
    acceptsTelehealth: false },
];
const slots = [
  { providerId: 'pr1', date: '2026-05-10', time: '09:00', kind: 'in_person' },
  { providerId: 'pr1', date: '2026-05-10', time: '10:00', kind: 'telehealth' },
];

describe('AppointmentScheduler', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('searches for providers on mount and renders the list', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { providers } } });
    render(<AppointmentScheduler />);
    await waitFor(() => expect(screen.getByText('Dr. Lee')).toBeInTheDocument());
    expect(screen.getByText('Dr. Kim')).toBeInTheDocument();
    expect(screen.getByText('In-net')).toBeInTheDocument();
  });

  it('shows the no-providers message when search returns empty', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { providers: [] } } });
    render(<AppointmentScheduler />);
    await waitFor(() => expect(screen.getByText(/No providers match/)).toBeInTheDocument());
  });

  it('loads slots when a provider is selected', async () => {
    lensRun.mockImplementation((arg: { action: string }) => {
      if (arg.action === 'providers-search') return Promise.resolve({ data: { ok: true, result: { providers } } });
      if (arg.action === 'provider-slots') return Promise.resolve({ data: { ok: true, result: { slots } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<AppointmentScheduler />);
    await waitFor(() => screen.getByText('Dr. Lee'));
    fireEvent.click(screen.getByText('Dr. Lee'));
    await waitFor(() => expect(screen.getByText('09:00')).toBeInTheDocument());
    expect(screen.getByText('10:00')).toBeInTheDocument();
  });

  it('books a slot and shows the confirmation', async () => {
    lensRun.mockImplementation((arg: { action: string }) => {
      if (arg.action === 'providers-search') return Promise.resolve({ data: { ok: true, result: { providers } } });
      if (arg.action === 'provider-slots') return Promise.resolve({ data: { ok: true, result: { slots } } });
      if (arg.action === 'appointment-book') return Promise.resolve({ data: { ok: true, result: { appointment: { id: 'appt1', copayUsd: 25 } } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<AppointmentScheduler />);
    await waitFor(() => screen.getByText('Dr. Lee'));
    fireEvent.click(screen.getByText('Dr. Lee'));
    await waitFor(() => screen.getByText('09:00'));
    fireEvent.click(screen.getByText('09:00'));
    await waitFor(() => expect(screen.getByText('Appointment booked!')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Pay \$25.00 co-pay/ })).toBeInTheDocument();
  });

  it('charges the co-pay and runs the Stripe success flow', async () => {
    lensRun.mockImplementation((arg: { action: string }) => {
      if (arg.action === 'providers-search') return Promise.resolve({ data: { ok: true, result: { providers } } });
      if (arg.action === 'provider-slots') return Promise.resolve({ data: { ok: true, result: { slots } } });
      if (arg.action === 'appointment-book') return Promise.resolve({ data: { ok: true, result: { appointment: { id: 'appt1', copayUsd: 25 } } } });
      if (arg.action === 'appointment-charge-copay') return Promise.resolve({ data: { ok: true, result: { clientSecret: 'cs_1', copayUsd: 25 } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<AppointmentScheduler />);
    await waitFor(() => screen.getByText('Dr. Lee'));
    fireEvent.click(screen.getByText('Dr. Lee'));
    await waitFor(() => screen.getByText('09:00'));
    fireEvent.click(screen.getByText('09:00'));
    await waitFor(() => screen.getByRole('button', { name: /Pay \$25.00 co-pay/ }));
    fireEvent.click(screen.getByRole('button', { name: /Pay \$25.00 co-pay/ }));
    await waitFor(() => expect(screen.getByTestId('stripe-form')).toBeInTheDocument());
    fireEvent.click(screen.getByText('stripe-success'));
    await waitFor(() => expect(screen.getByText(/Co-pay paid/)).toBeInTheDocument());
  });

  it('shows a co-pay error when the charge macro fails', async () => {
    lensRun.mockImplementation((arg: { action: string }) => {
      if (arg.action === 'providers-search') return Promise.resolve({ data: { ok: true, result: { providers } } });
      if (arg.action === 'provider-slots') return Promise.resolve({ data: { ok: true, result: { slots } } });
      if (arg.action === 'appointment-book') return Promise.resolve({ data: { ok: true, result: { appointment: { id: 'appt1', copayUsd: 25 } } } });
      if (arg.action === 'appointment-charge-copay') return Promise.resolve({ data: { ok: false, error: 'no card' } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<AppointmentScheduler />);
    await waitFor(() => screen.getByText('Dr. Lee'));
    fireEvent.click(screen.getByText('Dr. Lee'));
    await waitFor(() => screen.getByText('09:00'));
    fireEvent.click(screen.getByText('09:00'));
    await waitFor(() => screen.getByRole('button', { name: /Pay \$25.00 co-pay/ }));
    fireEvent.click(screen.getByRole('button', { name: /Pay \$25.00 co-pay/ }));
    await waitFor(() => expect(screen.getByText('no card')).toBeInTheDocument());
  });

  it('shows the select-a-provider placeholder before selection', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { providers } } });
    render(<AppointmentScheduler />);
    await waitFor(() => screen.getByText('Dr. Lee'));
    expect(screen.getByText(/Select a provider to see availability/)).toBeInTheDocument();
  });

  it('updates the specialty, insurance and zip filters', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { providers } } });
    render(<AppointmentScheduler />);
    await waitFor(() => screen.getByText('Dr. Lee'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Cardiology' } });
    fireEvent.change(screen.getByPlaceholderText('Insurance'), { target: { value: 'BlueCross' } });
    fireEvent.change(screen.getByPlaceholderText('ZIP code'), { target: { value: '90210' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
  });

  it('handles a provider-search error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('x'));
    render(<AppointmentScheduler />);
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    errSpy.mockRestore();
  });
});
