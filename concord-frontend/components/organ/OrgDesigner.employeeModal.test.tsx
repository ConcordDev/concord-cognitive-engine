/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Pins the organ-capability-map "Team role (Belbin) / demographics fields"
// gap closure: OrgDesigner's EmployeeModal now has a Belbin-role select and
// two demographics selects (gender / age band), and submitting them sends
// `role` + `demographics` straight through `organ.employee-upsert` — the
// exact field names server/domains/organ.js#normEmployee and
// teamComposition already expect (verified against
// server/tests/depth/organ-behavior.test.js).

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { OrgDesigner } from './OrgDesigner';

// OrgDesigner's local `run()` helper does `const r = await lensRun(...); return r.data;`
// (matching the real client's `{ data: { ok, result, error } }` shape) — the mock
// must resolve to the same wrapped shape or `run()` dereferences `undefined.ok`.
const ok = <T,>(result: T) => ({ data: { ok: true, result, error: null as string | null } });

const emptyRoster = {
  employees: [], count: 0, activeCount: 0, openReqCount: 0, departedCount: 0,
  departments: [], tree: [],
};

function routeOrgan(handlers: Record<string, unknown | ((input: Record<string, unknown>) => unknown)>) {
  lensRun.mockImplementation((_domain: string, action: string, input: Record<string, unknown>) => {
    if (action in handlers) {
      const h = handlers[action];
      return Promise.resolve(typeof h === 'function' ? (h as (i: Record<string, unknown>) => unknown)(input) : h);
    }
    return Promise.reject(new Error(`unexpected organ action: ${action}`));
  });
}

describe('OrgDesigner EmployeeModal — role (Belbin) + demographics fields', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders the Belbin role select and gender/age-band demographics selects, and submits them on employee-upsert', async () => {
    let upsertInput: Record<string, unknown> | null = null;
    routeOrgan({
      'roster-list': ok(emptyRoster),
      'employee-upsert': (input: Record<string, unknown>) => { upsertInput = input; return ok({ employee: { id: 'e1', ...input }, count: 1 }); },
    });

    render(<OrgDesigner />);
    await waitFor(() => expect(screen.getByText(/no roster yet/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /add person/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Add Person' })).toBeInTheDocument());

    // Role field renders with all 9 Belbin options.
    const roleSelect = screen.getByLabelText(/team role \(belbin\)/i) as HTMLSelectElement;
    expect(roleSelect).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /plant \(ideas & creativity\)/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Coordinator' })).toBeInTheDocument();

    // Demographics selects render as closed dropdowns, not free text.
    const genderSelect = screen.getByLabelText(/gender/i) as HTMLSelectElement;
    const ageSelect = screen.getByLabelText(/age band/i) as HTMLSelectElement;
    expect(genderSelect.tagName).toBe('SELECT');
    expect(ageSelect.tagName).toBe('SELECT');

    fireEvent.change(screen.getByLabelText(/name \*/i), { target: { value: 'Ada' } });
    fireEvent.change(roleSelect, { target: { value: 'coordinator' } });
    fireEvent.change(genderSelect, { target: { value: 'Woman' } });
    fireEvent.change(ageSelect, { target: { value: '25-34' } });

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(upsertInput).not.toBeNull());
    expect(upsertInput!.role).toBe('coordinator');
    expect(upsertInput!.demographics).toEqual({ gender: 'Woman', ageBand: '25-34' });
  });

  it('leaves role/demographics out when left unset (backward-compatible with old rosters)', async () => {
    let upsertInput: Record<string, unknown> | null = null;
    routeOrgan({
      'roster-list': ok(emptyRoster),
      'employee-upsert': (input: Record<string, unknown>) => { upsertInput = input; return ok({ employee: { id: 'e2', ...input }, count: 1 }); },
    });

    render(<OrgDesigner />);
    await waitFor(() => expect(screen.getByText(/no roster yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add person/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Add Person' })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/name \*/i), { target: { value: 'Bo' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(upsertInput).not.toBeNull());
    expect(upsertInput!.role).toBe('');
    expect(upsertInput!.demographics).toEqual({});
  });

  it('pre-fills role + demographics selects when editing an existing employee that has them', async () => {
    const existing = {
      id: 'e3', name: 'Cy', title: '', department: '', managerId: null, email: '', location: '',
      compensation: 0, startDate: '', level: '', status: 'active', skills: [],
      role: 'shaper', demographics: { gender: 'Non-binary', ageBand: '35-44' },
    };
    routeOrgan({
      'roster-list': ok({ ...emptyRoster, employees: [existing], count: 1, tree: [{ id: 'e3', label: 'Cy', detail: '', tone: 'default', directReports: 0, children: [] }] }),
    });

    render(<OrgDesigner />);
    // "Cy" renders in both the tree diagram and the roster table — assert
    // presence via getAllByText rather than the ambiguous singular query.
    await waitFor(() => expect(screen.getAllByText('Cy').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByLabelText('Edit'));
    await waitFor(() => expect(screen.getByText('Edit Person')).toBeInTheDocument());

    expect((screen.getByLabelText(/team role \(belbin\)/i) as HTMLSelectElement).value).toBe('shaper');
    expect((screen.getByLabelText(/gender/i) as HTMLSelectElement).value).toBe('Non-binary');
    expect((screen.getByLabelText(/age band/i) as HTMLSelectElement).value).toBe('35-44');
  });
});
