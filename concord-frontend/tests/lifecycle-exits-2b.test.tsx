/**
 * CB-0513 — hr / society / sentinel pins.
 *
 * FIX-hr-003 — a former employee's record can be permanently deleted
 *   from the Former list (employee-delete, sticky confirm); Rehire
 *   stays beside it.
 * FIX-society-006 — a saved chart can be deleted by its owner from
 *   the Saved list (wb-delete-chart, sticky confirm).
 * FIX-sentinel-005 — empty submissions speak: the monitor create,
 *   the threat report, and the scan-rule forms each name the missing
 *   field beside the disabled control.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
  MapView: () => null,
}));

import { HrPeoplePanel } from '@/components/hr/HrPeoplePanel';
import { DataExplorer } from '@/components/society/DataExplorer';
import { SentinelMonitors } from '@/components/sentinel/SentinelMonitors';
import { SentinelShield } from '@/components/sentinel/SentinelShield';
import { SentinelScanConfig } from '@/components/sentinel/SentinelScanConfig';

const ok = (result: unknown) => Promise.resolve({ data: { ok: true, result, error: null } });

beforeEach(() => {
  lensRunMock.mockReset();
});

const FORMER = {
  id: 'emp_1', name: 'Jamie Former', title: 'Tech', department: 'Ops',
  managerId: null, email: null, salary: 0, employmentType: 'full_time',
  status: 'terminated', terminationDate: '2026-10-01',
};

describe('FIX-hr-003 — former employees can be permanently deleted', () => {
  it('deletes through the sticky confirm beside Rehire', async () => {
    lensRunMock.mockImplementation((_d: string, action: string, input: Record<string, unknown>) => {
      if (action === 'employee-list') {
        return ok({ employees: input?.includeInactive ? [FORMER] : [] });
      }
      if (action === 'org-chart') return ok({ chart: [] });
      if (action === 'employee-delete') return ok({ deleted: 'emp_1', removed: { onboardingTasks: 0, reviews: 0, goals: 0 } });
      return ok({});
    });
    render(<HrPeoplePanel onChange={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Rehire' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Permanently delete Jamie Former's record" }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm permanent delete' }));
    await waitFor(() => {
      expect(lensRunMock.mock.calls.some((c) => c[1] === 'employee-delete' && (c[2] as { id: string }).id === 'emp_1')).toBe(true);
    });
  });
});

describe('FIX-society-006 — saved charts can be deleted', () => {
  it('deletes through the sticky confirm in the Saved list', async () => {
    let deleted = false;
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'wb-list-charts') {
        return ok({ charts: deleted ? [] : [{ id: 'soc_abc123', title: 'US GDP/cap', createdAt: '2026-06-01T00:00:00.000Z', permalink: '/lenses/society?chart=soc_abc123' }], count: deleted ? 0 : 1 });
      }
      if (action === 'wb-delete-chart') { deleted = true; return ok({ deleted: 'soc_abc123' }); }
      return ok({ indicators: {} });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<DataExplorer />); });
    await act(async () => { fireEvent.click(view!.getByRole('button', { name: 'Saved' })); });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete saved chart US GDP/cap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete saved chart' }));
    await waitFor(() => {
      expect(lensRunMock.mock.calls.some((c) => c[1] === 'wb-delete-chart' && (c[2] as { id: string }).id === 'soc_abc123')).toBe(true);
    });
  });
});

describe('FIX-sentinel-005 — empty submissions name the missing field', () => {
  it('monitor create: note clears when the name is typed', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'monitor.list') return ok({ monitors: [] });
      if (action === 'alerts.list') return ok({ alerts: [] });
      return ok({});
    });
    render(<SentinelMonitors />);
    expect(await screen.findByText('A monitor name is required to create the monitor.')).toBeTruthy();
    const nameInput = screen.getByPlaceholderText(/monitor name/i) ?? screen.getAllByRole('textbox')[0];
    fireEvent.change(nameInput, { target: { value: 'nightly' } });
    expect(screen.queryByText('A monitor name is required to create the monitor.')).toBeNull();
  });

  it('threat report: the note shows while the description is empty', async () => {
    lensRunMock.mockImplementation(() => ok({}));
    render(<SentinelShield />);
    fireEvent.click(await screen.findByRole('button', { name: /Report a threat/ }));
    expect(await screen.findByText('Describe what you observed to submit the report.')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Describe what you observed…'), { target: { value: 'beaconing' } });
    expect(screen.queryByText('Describe what you observed to submit the report.')).toBeNull();
  });

  it('scan rule: note clears when the pattern is typed', async () => {
    lensRunMock.mockImplementation(() => ok({
      config: { scopes: ['chat'], activeScopes: ['chat'], rules: [], autoTriageMinSeverity: 'medium', updatedAt: '2026-11-12T00:00:00Z' },
    }));
    render(<SentinelScanConfig />);
    expect(await screen.findByText('A rule pattern is required to add the rule.')).toBeTruthy();
    const patternInput = screen.getByPlaceholderText(/pattern/i) ?? screen.getAllByRole('textbox')[0];
    fireEvent.change(patternInput, { target: { value: 'eval(' } });
    expect(screen.queryByText('A rule pattern is required to add the rule.')).toBeNull();
  });
});
