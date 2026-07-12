/**
 * HrCompliancePanel — I-9 / E-Verify employment-eligibility sub-section.
 *
 * Pins the new I-9 tracking surface (Wave 4 gap-closure of the
 * "I-9 / E-Verify employment-eligibility compliance" item flagged
 * GENUINELY MISSING in docs/lens-specs/hr-capability-map.md) through the
 * real channel — lensRun('hr', <macro>, params) — with the same
 * mocked-envelope style as hr-lens-states.test.tsx:
 *
 *   - org-wide summary strip renders the real i9-status fields
 *     (compliancePct / missing / overdue / activeEmployees)
 *   - the roster renders each record's document-type label + status badge
 *   - "Track I-9" sends i9-add with the exact form fields (employeeId,
 *     documentType, documentIdentifier, expirationDate)
 *   - "Verify" on a pending record calls i9-verify
 *   - "Reject" reveals an inline reason field and calls i9-reject with it
 *   - a failed macro surfaces the exact handler error, never a silent-empty
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

import { HrCompliancePanel } from '@/components/hr/HrCompliancePanel';

const EMPLOYEES = [{ id: 'emp_1', name: 'Alex Doe' }, { id: 'emp_2', name: 'Sam Lee' }];
const I9_SUMMARY = { activeEmployees: 2, verified: 1, missing: 1, overdue: 1, compliancePct: 50 };
const I9_RECORDS = [
  {
    id: 'i9_1', employeeId: 'emp_1', employeeName: 'Alex Doe',
    documentType: 'us_passport', documentIdentifier: 'X123', status: 'pending',
    expirationDate: null, daysUntilExpiration: null,
    everifyCaseNumber: null, everifyStatus: 'not_submitted',
    rejectionReason: null, attachedDocumentIds: [],
  },
  {
    id: 'i9_2', employeeId: 'emp_2', employeeName: 'Sam Lee',
    documentType: 'employment_authorization_document', documentIdentifier: null, status: 'verified',
    expirationDate: '2099-01-01', daysUntilExpiration: 9000,
    everifyCaseNumber: null, everifyStatus: 'not_submitted',
    rejectionReason: null, attachedDocumentIds: [],
  },
];

function defaultImpl(domain: string, action: string) {
  if (domain !== 'hr') return Promise.resolve({ data: { ok: true, result: {} } });
  switch (action) {
    case 'employee-list':
      return Promise.resolve({ data: { ok: true, result: { employees: EMPLOYEES } } });
    case 'compliance-doc-list':
      return Promise.resolve({ data: { ok: true, result: { documents: [] } } });
    case 'compliance-status':
      return Promise.resolve({ data: { ok: true, result: { compliancePct: 100 } } });
    case 'i9-list':
      return Promise.resolve({ data: { ok: true, result: { records: I9_RECORDS } } });
    case 'i9-status':
      return Promise.resolve({ data: { ok: true, result: I9_SUMMARY } });
    default:
      return Promise.resolve({ data: { ok: true, result: {} } });
  }
}

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(defaultImpl);
});

async function renderPanel() {
  const utils = render(<HrCompliancePanel />);
  // wait for the async refresh() to have populated the I-9 roster. The
  // lowercase status badge text ("pending") is unique to the rendered
  // roster row — "U.S. Passport" / "Alex Doe" also appear as <option>
  // text in the document-type / employee <select>s.
  await waitFor(() => expect(utils.getByText('pending')).toBeInTheDocument());
  return utils;
}

describe('HrCompliancePanel — I-9 / E-Verify', () => {
  it('renders the org-wide I-9 summary strip from i9-status', async () => {
    await renderPanel();
    expect(document.body.textContent).toContain('50%');
    // missing=1, overdue=1, activeEmployees=2 all render as stat tiles
    const ones = [...document.querySelectorAll('p')].filter((p) => p.textContent === '1');
    expect(ones.length).toBeGreaterThanOrEqual(2);
    const twos = [...document.querySelectorAll('p')].filter((p) => p.textContent === '2');
    expect(twos.length).toBeGreaterThanOrEqual(1);
  });

  it('renders each I-9 record with its document-type label and status badge', async () => {
    const { getByText, getAllByText } = await renderPanel();
    // "U.S. Passport" / "Employment Authorization Document" also appear
    // as <option> text in the document-type picker, so assert at least
    // two occurrences (the option plus the roster row) rather than one.
    expect(getAllByText('U.S. Passport').length).toBeGreaterThanOrEqual(2);
    expect(getAllByText(/Employment Authorization Document/).length).toBeGreaterThanOrEqual(2);
    expect(getByText('pending')).toBeInTheDocument();
    expect(getByText('verified')).toBeInTheDocument();
  });

  it('Track I-9 sends i9-add with the exact form fields', async () => {
    const { container, getByText } = await renderPanel();
    // selects in document order: [0] "Acknowledge as employee" picker,
    // [1] I-9 employee picker, [2] I-9 document-type picker.
    const selects = container.querySelectorAll('select');
    fireEvent.change(selects[1], { target: { value: 'emp_1' } });
    fireEvent.change(selects[2], { target: { value: 'permanent_resident_card' } });
    const docNumInput = container.querySelector('input[placeholder="Document #"]') as HTMLInputElement;
    fireEvent.change(docNumInput, { target: { value: 'G-987654' } });

    lensRunMock.mockImplementationOnce(() => Promise.resolve({ data: { ok: true, result: { record: { id: 'i9_new' } } } }));
    await act(async () => { fireEvent.click(getByText('Track I-9')); });

    const call = lensRunMock.mock.calls.find((c) => c[0] === 'hr' && c[1] === 'i9-add');
    expect(call).toBeTruthy();
    expect(call![2]).toMatchObject({ employeeId: 'emp_1', documentType: 'permanent_resident_card', documentIdentifier: 'G-987654' });
  });

  it('Verify calls i9-verify for the pending record', async () => {
    const { getByText } = await renderPanel();
    lensRunMock.mockImplementationOnce(() => Promise.resolve({ data: { ok: true, result: { record: { ...I9_RECORDS[0], status: 'verified' } } } }));
    await act(async () => { fireEvent.click(getByText('Verify')); });
    const call = lensRunMock.mock.calls.find((c) => c[0] === 'hr' && c[1] === 'i9-verify');
    expect(call).toBeTruthy();
    expect(call![2]).toMatchObject({ id: 'i9_1' });
  });

  it('Reject reveals an inline reason field and calls i9-reject with it', async () => {
    const { getAllByText, getByText, getByPlaceholderText } = await renderPanel();
    // both the pending (i9_1) and verified (i9_2) records show a Reject
    // button; the first one in document order belongs to i9_1.
    await act(async () => { fireEvent.click(getAllByText('Reject')[0]); });
    const reasonInput = getByPlaceholderText('Rejection reason');
    fireEvent.change(reasonInput, { target: { value: 'document appears altered' } });
    lensRunMock.mockImplementationOnce(() => Promise.resolve({ data: { ok: true, result: { record: { ...I9_RECORDS[0], status: 'rejected' } } } }));
    await act(async () => { fireEvent.click(getByText('Confirm')); });
    const call = lensRunMock.mock.calls.find((c) => c[0] === 'hr' && c[1] === 'i9-reject');
    expect(call).toBeTruthy();
    expect(call![2]).toMatchObject({ id: 'i9_1', reason: 'document appears altered' });
  });

  it('ERROR: a failed i9-add surfaces the exact handler error, never a silent-empty', async () => {
    const { container, getByText } = await renderPanel();
    const selects = container.querySelectorAll('select');
    fireEvent.change(selects[1], { target: { value: 'emp_1' } });
    lensRunMock.mockImplementationOnce(() => Promise.resolve({ data: { ok: false, error: 'invalid document type; must be one of us_passport, ...' } }));
    await act(async () => { fireEvent.click(getByText('Track I-9')); });
    await waitFor(() => expect(getByText(/invalid document type/i)).toBeInTheDocument());
  });
});
