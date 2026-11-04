/**
 * HR build (GB-1088 Wave 1) — pins for the R5 first-pass findings, through
 * the real channel (lensRun('hr', <macro>, params)) with the mocked-envelope
 * style of hr-compliance-i9.test.tsx:
 *
 *   F2  the employee detail carries an Edit form that saves through the
 *       registered employee-update verb (previously create-only records).
 *   F7  Offboard is a two-step confirmation, and former employees are
 *       listed with a Rehire control riding employee-offboard {rehire:true}
 *       (previously one click, irreversible, no way back).
 *   F3  a pay run whose stubs carry stateTax: null (state tax excluded)
 *       opens its detail WITHOUT crashing, renders the excluded column as
 *       a dash, and names the exclusion (previously the lens error page).
 *   F4  the org acknowledgement stat renders the server's counts and never
 *       invents a percentage at an empty set (previously a default 100%).
 *   F5  the I-9 strip separates pending from missing, and the record row
 *       shows the Document # the form collected.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })), get: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn() } },
  lensRun: (...a: unknown[]) => lensRunMock(...a),
}));

import { HrPeoplePanel } from '@/components/hr/HrPeoplePanel';
import { HrPayrollPanel } from '@/components/hr/HrPayrollPanel';
import { HrCompliancePanel } from '@/components/hr/HrCompliancePanel';

const env = (result: unknown) => ({ data: { ok: true, result } });

const EMP = {
  id: 'emp_1', name: 'Alex Doe', title: 'Engineer', department: 'Engineering',
  managerId: null, email: null, salary: 52000, employmentType: 'full_time', status: 'active',
};
const FORMER = {
  id: 'emp_2', name: 'Sam Lee', title: 'Designer', department: 'Product',
  managerId: null, email: null, salary: 48000, employmentType: 'full_time',
  status: 'terminated', terminationDate: '2026-10-15',
};

function peopleMock() {
  lensRunMock.mockImplementation((_lens: string, action: string, params: Record<string, unknown> = {}) => {
    switch (action) {
      case 'employee-list':
        return Promise.resolve(env({ employees: params.includeInactive ? [EMP, FORMER] : [EMP], count: 1 }));
      case 'org-chart': return Promise.resolve(env({ chart: [], totalEmployees: 1 }));
      case 'onboarding-list': return Promise.resolve(env({ tasks: [] }));
      case 'hr-document-list': return Promise.resolve(env({ documents: [] }));
      case 'employee-update':
        return Promise.resolve(env({ employee: { ...EMP, title: params.title, email: params.email } }));
      case 'employee-offboard':
        return Promise.resolve(env({ employee: params.rehire ? { ...FORMER, status: 'active', terminationDate: null } : { ...EMP, status: 'terminated' } }));
      default: return Promise.resolve(env({}));
    }
  });
}

function callsTo(action: string) {
  return lensRunMock.mock.calls.filter((c) => c[1] === action);
}

describe('HrPeoplePanel — F2 edit + F7 offboard/rehire', () => {
  beforeEach(() => { lensRunMock.mockReset(); peopleMock(); });

  it('saves an edit through employee-update', async () => {
    const { getByText, getByPlaceholderText } = render(<HrPeoplePanel onChange={() => {}} />);
    await waitFor(() => expect(getByText('Alex Doe')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Alex Doe')); });
    await waitFor(() => expect(getByText('Edit employee')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Edit employee')); });
    fireEvent.change(getByPlaceholderText('Title'), { target: { value: 'Senior Engineer' } });
    fireEvent.change(getByPlaceholderText('Email'), { target: { value: 'alex@example.com' } });
    await act(async () => { fireEvent.click(getByText('Save changes')); });
    await waitFor(() => expect(callsTo('employee-update').length).toBe(1));
    expect(callsTo('employee-update')[0][2]).toMatchObject({ id: 'emp_1', title: 'Senior Engineer', email: 'alex@example.com' });
    await waitFor(() => expect(getByText('Employee record saved.')).toBeInTheDocument());
  });

  it('offboard requires a confirmation click before the verb fires', async () => {
    const { getByText } = render(<HrPeoplePanel onChange={() => {}} />);
    await waitFor(() => expect(getByText('Alex Doe')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Alex Doe')); });
    await act(async () => { fireEvent.click(getByText('Offboard employee')); });
    expect(callsTo('employee-offboard').length).toBe(0);
    await act(async () => { fireEvent.click(getByText('Confirm offboard')); });
    await waitFor(() => expect(callsTo('employee-offboard').length).toBe(1));
    expect(callsTo('employee-offboard')[0][2]).toMatchObject({ id: 'emp_1' });
  });

  it('lists former employees with a working Rehire control', async () => {
    const { getByText } = render(<HrPeoplePanel onChange={() => {}} />);
    await waitFor(() => expect(getByText('Former employees')).toBeInTheDocument());
    expect(getByText('Sam Lee')).toBeInTheDocument();
    await act(async () => { fireEvent.click(getByText('Rehire')); });
    await waitFor(() => expect(callsTo('employee-offboard').length).toBe(1));
    expect(callsTo('employee-offboard')[0][2]).toMatchObject({ id: 'emp_2', rehire: true });
  });
});

describe('HrPayrollPanel — F3 pay-run detail with excluded state tax', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    const run = {
      id: 'pay_1', periodLabel: 'PP-01', payDate: '2026-11-01', frequency: 'biweekly',
      headcount: 1, totalGross: 2000, totalDeductions: 296.92, totalNet: 1703.08,
      status: 'completed', createdAt: '2026-11-01T00:00:00Z',
      assumptions: { stateTaxRate: { value: null, note: 'not supplied; state tax excluded' } },
      missingInputs: ['stateTaxRate'],
      stubs: [{
        employeeId: 'emp_1', employeeName: 'Alex Doe', grossPay: 2000,
        federalTax: 180, stateTax: null, socialSecurity: 124, medicare: 29,
        totalDeductions: 296.92, netPay: 1703.08,
      }],
    };
    lensRunMock.mockImplementation((_l: string, action: string) =>
      Promise.resolve(env(action === 'payroll-list' ? { runs: [run], count: 1, ytdPaid: 1703.08 } : {})));
  });

  it('opens the run detail without crashing and names the exclusion', async () => {
    const { getByText, getAllByText } = render(<HrPayrollPanel />);
    await waitFor(() => expect(getByText('PP-01')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('PP-01')); });
    await waitFor(() => expect(getByText(/State tax excluded/)).toBeInTheDocument());
    expect(getByText('Alex Doe')).toBeInTheDocument();
    expect(getAllByText('$1,703.08').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });
});

describe('HrCompliancePanel — F4/F5 statistics honesty', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation((_l: string, action: string, params: Record<string, unknown> = {}) => {
      switch (action) {
        case 'employee-list': return Promise.resolve(env({ employees: [EMP], count: 1 }));
        case 'compliance-doc-list': return Promise.resolve(env({ documents: [], count: 0 }));
        case 'compliance-status':
          return Promise.resolve(env(params.employeeId
            ? { documents: [], outstanding: 0 }
            : { totalRequired: 0, totalAcknowledged: 0, compliancePct: null, reason: 'no documents or employees' }));
        case 'i9-list':
          return Promise.resolve(env({
            records: [{
              id: 'i9_1', employeeId: 'emp_1', employeeName: 'Alex Doe',
              documentType: 'us_passport', documentIdentifier: 'X123', status: 'pending',
              expirationDate: null, daysUntilExpiration: null, everifyCaseNumber: null,
              everifyStatus: 'not_submitted', rejectionReason: null, attachedDocumentIds: [],
            }],
            count: 1,
          }));
        case 'i9-status':
          return Promise.resolve(env({ activeEmployees: 1, verified: 0, pending: 1, missing: 0, overdue: 0, compliancePct: 0 }));
        default: return Promise.resolve(env({}));
      }
    });
  });

  it('never invents an org percentage at an empty set', async () => {
    const { container, getByText } = render(<HrCompliancePanel />);
    await waitFor(() => expect(getByText('No documents or employees to measure yet')).toBeInTheDocument());
    expect(container.textContent).not.toContain('100%');
  });

  it('separates pending from missing and shows the document number', async () => {
    const { getByText } = render(<HrCompliancePanel />);
    await waitFor(() => expect(getByText('Pending review')).toBeInTheDocument());
    expect(getByText('No I-9 on file')).toBeInTheDocument();
    expect(getByText('· # X123')).toBeInTheDocument();
  });
});
