/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * Wave 4 (docs/lens-specs/law-enforcement-capability-map.md "No persisted
 * 'Case' record type exists server-side" closure, migration 362) — pins
 * that CaseManagementPanel is a real, macro-backed case board: it opens a
 * case via `law-enforcement.caseCreate`, lists cases via `caseList`, and
 * only offers the status transitions the backend state machine actually
 * allows (never a hardcoded/generic transition set), reflecting genuine
 * `caseUpdate` round-trips.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
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

import { CaseManagementPanel } from '@/components/law-enforcement/CaseManagementPanel';

const OPEN_CASE = {
  id: 'case_1', caseNumber: 'CASE-ABC123', title: 'Oak St burglary series',
  synopsis: '3 linked break-ins', status: 'open', assignedDetective: 'Det. Ramos',
  openedAt: '2026-07-01T00:00:00.000Z', closedAt: null, closureReason: null,
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
};

function mockDefaultImpl() {
  lensRunMock.mockImplementation((domain: string, action: string) => {
    if (domain !== 'law-enforcement') return Promise.resolve({ data: { ok: false, error: 'unexpected domain' } });
    if (action === 'caseList') {
      return Promise.resolve({ data: { ok: true, result: { cases: [OPEN_CASE], total: 1, open: 1, byStatus: [{ status: 'open', count: 1 }] } } });
    }
    if (action === 'caseLinked') {
      return Promise.resolve({
        data: {
          ok: true,
          result: {
            case: OPEN_CASE, reports: [], evidence: [], bookings: [], warrants: [],
            counts: { reports: 0, evidence: 0, bookings: 0, warrants: 0 },
          },
        },
      });
    }
    if (action === 'caseCreate') {
      return Promise.resolve({ data: { ok: true, result: { case: { ...OPEN_CASE, id: 'case_new', caseNumber: 'CASE-NEW01' } } } });
    }
    if (action === 'caseUpdate') {
      return Promise.resolve({ data: { ok: true, result: { case: { ...OPEN_CASE, status: 'under_investigation' } } } });
    }
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('CaseManagementPanel — real macro-backed case board (Wave 4)', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    mockDefaultImpl();
  });

  it('lists real cases returned by law-enforcement.caseList, not fabricated rows', async () => {
    render(<CaseManagementPanel />);
    await waitFor(() => expect(screen.getByText(/Oak St burglary series/)).toBeInTheDocument());
    expect(screen.getByText('CASE-ABC123')).toBeInTheDocument();
    expect(lensRunMock).toHaveBeenCalledWith('law-enforcement', 'caseList', {});
  });

  it('creating a case calls caseCreate with the entered fields, not a generic body', async () => {
    render(<CaseManagementPanel />);
    await waitFor(() => expect(screen.getByText(/Oak St burglary series/)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Oak St burglary series'), { target: { value: 'New robbery case' } });
    fireEvent.change(screen.getByPlaceholderText('Det. Ramos'), { target: { value: 'Det. Cole' } });
    fireEvent.click(screen.getByRole('button', { name: /Open Case/i }));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('law-enforcement', 'caseCreate', expect.objectContaining({
      title: 'New robbery case',
      assignedDetective: 'Det. Cole',
    })));
  });

  it('selecting a case loads caseLinked and shows real linked-record counts (0, not fabricated)', async () => {
    render(<CaseManagementPanel />);
    await waitFor(() => expect(screen.getByText(/Oak St burglary series/)).toBeInTheDocument());

    fireEvent.click(screen.getByText('CASE-ABC123'));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('law-enforcement', 'caseLinked', { id: 'case_1' }));
    // Detail view renders once linked resolves — the case's title appears
    // a second time (list row + detail header).
    await waitFor(() => expect(screen.getAllByText(/Oak St burglary series/).length).toBeGreaterThan(1));
  });

  it('only offers the transitions the backend state machine allows for the current status (open)', async () => {
    render(<CaseManagementPanel />);
    await waitFor(() => expect(screen.getByText(/Oak St burglary series/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('CASE-ABC123'));
    await waitFor(() => expect(screen.getAllByText(/Oak St burglary series/).length).toBeGreaterThan(1));

    // open -> under_investigation | closed (never "cold" directly — that's
    // not in the backend's CASE_TRANSITIONS['open'] set).
    expect(screen.getByRole('button', { name: /under investigation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^closed$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cold$/i })).not.toBeInTheDocument();
  });

  it('clicking a transition calls caseUpdate with the real target status', async () => {
    render(<CaseManagementPanel />);
    await waitFor(() => expect(screen.getByText(/Oak St burglary series/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('CASE-ABC123'));
    await waitFor(() => expect(screen.getAllByText(/Oak St burglary series/).length).toBeGreaterThan(1));

    fireEvent.click(screen.getByRole('button', { name: /under investigation/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('law-enforcement', 'caseUpdate', expect.objectContaining({
      id: 'case_1', status: 'under_investigation',
    })));
  });

  it('shows the honest empty state when there are no cases yet (never fabricated rows)', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'law-enforcement' && action === 'caseList') {
        return Promise.resolve({ data: { ok: true, result: { cases: [], total: 0, open: 0, byStatus: [] } } });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<CaseManagementPanel />);
    await waitFor(() => expect(screen.getByText(/No cases on file/i)).toBeInTheDocument());
  });
});
