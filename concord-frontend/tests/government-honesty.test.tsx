// Government full-lens build — honesty + caseload arithmetic render tests.
//
// Amendment 3 of the builder standard (adopted 2026-11-05 after the
// nonprofit diff-coverage gap): changed panels carry render tests in the
// builder's own check set. These render the REAL components with the
// backend channels mocked in the exact shapes the hooks return:
//
//   S1 — the DepthBadge for government reads the lens's one true tier
//        statement (label + the per-lens caption naming both halves).
//   S2 — the point-of-action local-record notices render on the
//        voter-registration form (with the vote.gov link-out), the
//        fine form, and the 311 form.
//   S4 — the Caseload dashboard's arithmetic: a court case's fine is
//        INSIDE Revenue with its own printed row; Pending Requests
//        counts a filed record that carries no requestType; a project
//        standing at 'draft' clears "No active projects."
//   F11 — switching the mounted panel from the dashboard surface to the
//        Court files surface renders the Court list (the view state
//        re-syncs with the surface prop).
//   F6 — the card Delete is two-step: first click arms, second deletes.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── backend channel for the form panels: lensRun({domain, action, input}) ──
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
  api: { get: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: {},
}));

// ── backend channel for CaseOpsPanel: useLensData per artifact type ──
const removeSpy = vi.fn();
type Fixture = { id: string; title: string; data: Record<string, unknown>; meta: { status: string } };
const item = (id: string, title: string, data: Record<string, unknown>, status = 'draft'): Fixture => ({
  id, title, data, meta: { status },
});

const courtCase = item('case-1', 'PR2GOV-CASE-1101', {
  caseNumber: 'CV-1101', defendant: 'J. Henderson', judge: 'Hon. Patricia Wells',
  courtDate: '2027-03-20', fineAmount: 250, feesOwed: 75, feesCollected: 0,
  type: 'Code Enforcement', disposition: '', attorney: 'City Attorney', courtroom: 'Room 204',
}, 'draft');
// The walk's filed Record carried NO requestType — the old Pending
// Requests filter required one and read 0 over it.
const filedRecord = item('rec-1', 'PR2GOV-RECORD-1101', { description: 'Sidewalk repair records' }, 'draft');
// A created project stands at 'draft' — the old Active Projects filter
// rendered "No active projects." over it.
const draftProject = item('proj-1', 'PR2GOV-PROJECT-1101', {
  budget: 1000, spent: 100, progress: 10, contractor: 'DPW',
}, 'draft');

let fixtures: Record<string, Fixture[]> = {};
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_domain: string, type: string) => ({
    items: fixtures[type] ?? [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: removeSpy,
  }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn(async () => ({ ok: true, result: {} })), isPending: false }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/payment/StripePaymentForm', () => ({ StripePaymentForm: () => null }));

import { CaseOpsPanel } from '@/components/government/CaseOpsPanel';
import { ElectionsPanel } from '@/components/government/ElectionsPanel';
import { PaymentsPanel } from '@/components/government/PaymentsPanel';
import { ServiceRequestsPanel } from '@/components/government/ServiceRequestsPanel';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { getLensManifest } from '@/lib/lenses/manifest';

beforeEach(() => {
  removeSpy.mockClear();
  fixtures = {
    Permit: [],
    Project: [draftProject],
    Violation: [],
    EmergencyPlan: [],
    Record: [filedRecord],
    CourtCase: [courtCase],
  };
});

describe('S1 — one true tier statement', () => {
  it('the manifest declares REAL_LIVE for government', () => {
    expect(getLensManifest('government')?.dataTier).toBe('REAL_LIVE');
  });

  it('the badge reads Live with the government caption naming both halves', () => {
    render(<DepthBadge lensId="government" />);
    const badge = screen.getByLabelText(/^Data tier: Live\./);
    expect(badge.getAttribute('aria-label')).toMatch(/your own workspace records/);
    expect(badge.getAttribute('aria-label')).toMatch(/Congress\.gov, USAspending, data\.gov and NWS/);
    expect(badge.getAttribute('aria-label')).toMatch(/Nothing here is an official government service/);
  });
});

describe('S2 — official-status labelling at the point of action', () => {
  it('the voter-registration form says it does not register you to vote, and links vote.gov', async () => {
    render(<ElectionsPanel />);
    const note = await screen.findByText(/does not register you to vote/);
    expect(note).toBeTruthy();
    const link = screen.getByRole('link', { name: 'vote.gov' });
    expect(link.getAttribute('href')).toBe('https://vote.gov');
  });

  it('the fine form says a recorded fine is not a citation from any court or agency', async () => {
    render(<PaymentsPanel />);
    const note = await screen.findByText(/not a citation issued by any court or agency/);
    expect(note).toBeTruthy();
    // The payments family's pre-existing honest banner stands untouched.
    expect(screen.getByText(/Online payment is not configured/)).toBeTruthy();
  });

  it('the 311 form says it is not a filing with city or county 311', async () => {
    render(<ServiceRequestsPanel />);
    const note = await screen.findByText(/not a filing with your city or county 311/);
    expect(note).toBeTruthy();
  });
});

describe('S4 — Caseload dashboard arithmetic', () => {
  it('Revenue composes permit fees + violation fines + court fees + court fines, each printed', () => {
    render(<CaseOpsPanel artifactType="Permit" surface="dashboard" />);
    // $75 feesOwed + $250 fineAmount on the one standing case = $325.
    const finesRow = screen.getByText('Court Fines').closest('div');
    expect(finesRow?.textContent).toContain('$250');
    const feesRow = screen.getByText('Court Fees').closest('div');
    expect(feesRow?.textContent).toContain('$75');
    const revenuePanel = screen.getByText('Revenue Overview').closest('div')?.parentElement;
    expect(revenuePanel?.textContent).toContain('$325');
  });

  it('Pending Requests counts the filed record that carries no requestType', () => {
    render(<CaseOpsPanel artifactType="Permit" surface="dashboard" />);
    const label = screen.getByText('Pending Requests');
    const card = label.closest('div')?.parentElement;
    expect(card?.textContent).toMatch(/1\s*1 total records/);
  });

  it('a project standing at draft is listed; "No active projects." does not render over it', () => {
    render(<CaseOpsPanel artifactType="Permit" surface="dashboard" />);
    expect(screen.getByText('PR2GOV-PROJECT-1101')).toBeTruthy();
    expect(screen.queryByText('No active projects.')).toBeNull();
  });
});

describe('F11 — the Court list renders from its own surface', () => {
  it('switching the mounted panel from dashboard to Court files renders the list, not the summary', () => {
    const { rerender } = render(<CaseOpsPanel artifactType="Permit" surface="dashboard" />);
    expect(screen.getByText('Revenue Overview')).toBeTruthy();
    rerender(<CaseOpsPanel artifactType="CourtCase" surface="files" />);
    expect(screen.getByText('PR2GOV-CASE-1101')).toBeTruthy();
    expect(screen.queryByText('Revenue Overview')).toBeNull();
  });
});

describe('F6 — unconfirmed case delete is now two-step', () => {
  it('first click arms and deletes nothing; second click deletes', async () => {
    render(<CaseOpsPanel artifactType="CourtCase" surface="files" />);
    const del = screen.getByRole('button', { name: /^Delete$/ });
    fireEvent.click(del);
    expect(removeSpy).not.toHaveBeenCalled();
    // getByText, not getByRole: the card itself is a role="button" whose
    // accessible name contains the armed label too.
    const confirm = screen.getByText('Confirm delete?');
    fireEvent.click(confirm);
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith('case-1'));
  });

  it('the case detail view carries the local-record notice', () => {
    render(<CaseOpsPanel artifactType="CourtCase" surface="files" />);
    fireEvent.click(screen.getByText('PR2GOV-CASE-1101'));
    expect(screen.getByText(/this case file lives in your Concord workspace/)).toBeTruthy();
  });
});
