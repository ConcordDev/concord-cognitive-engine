/**
 * FIX-welding-002 (FE leg) — the certification form accepted reversed
 * dates (issued 2027-11-10, expires 2026-11-10) with no message and Add
 * certification enabled. The form now shows an inline error and
 * disables Add while the pair is reversed; a sane pair re-enables it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: false } })) } },
}));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { WeldingOperations } from '@/components/welding/WeldingOperations';

describe('FIX-welding-002 — reversed cert dates speak', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'cert-status') return Promise.resolve({ data: { ok: true, result: { certs: [], alerts: [], validCount: 0, atRiskCount: 0 } } });
      if (action === 'ops-summary') return Promise.resolve({ data: { ok: true, result: { activeJobs: 0, completedJobs: 0, pipelineValue: 0, outstanding: 0, collected: 0, overdueInvoices: 0, certAtRisk: 0 } } });
      if (action === 'calendar') return Promise.resolve({ data: { ok: true, result: { days: [], unscheduled: [], crewLoad: {}, scheduledCount: 0 } } });
      if (action === 'job-list') return Promise.resolve({ data: { ok: true, result: { jobs: [] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
  });

  it('flags expiry-before-issued inline and disables Add until fixed', async () => {
    render(<WeldingOperations />);
    fireEvent.click(await screen.findByRole('button', { name: /certs/i }));
    const welder = await screen.findByPlaceholderText('Welder name');
    fireEvent.change(welder, { target: { value: 'Sam Welder' } });
    fireEvent.change(screen.getByLabelText(/^issued$/i), { target: { value: '2027-11-10' } });
    fireEvent.change(screen.getByLabelText(/^expires$/i), { target: { value: '2026-11-10' } });

    expect(screen.getByRole('alert').textContent).toMatch(/before the issued date/i);
    expect((screen.getByRole('button', { name: /add certification/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/^expires$/i), { target: { value: '2028-11-10' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: /add certification/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});
