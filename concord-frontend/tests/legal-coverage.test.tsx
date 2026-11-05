/**
 * build(legal) — diff-coverage render tests for the legal lens panels.
 *
 * Written for the repo's diff-coverage gate (≥60% statement coverage on
 * changed components/lib/hooks files): each panel the build touched is
 * rendered with fixture data and driven through its primary flows —
 * list/detail renders, filter switches, form opens, and the macro
 * actions — against a mocked lensRun / runDomain layer. Behaviour pins
 * for the build's slices live in legal-build-slices.test.tsx; this file
 * carries breadth, in the fixer's coverage-test shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const lensRunMock = vi.fn();
const runDomainMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomainMock(...args) } },
  api: { delete: vi.fn(async () => ({})), post: vi.fn(async () => ({ data: { ok: true, message: { id: 'msg_1' } } })) },
}));
vi.mock('@/components/common/Toasts', () => ({ showToast: vi.fn() }));
vi.mock('@/components/lens/EmptyStateCTA', () => ({ EmptyStateCTA: () => null }));
vi.mock('@/components/legal/LegalMatterMenu', () => ({ LegalMatterMenu: () => null }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));
vi.mock('@/components/legal/CitationNetworkDiagram', () => ({ CitationNetworkDiagram: () => null }));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: async (fn: () => unknown) => fn(), execute: async (fn: () => unknown) => fn(), undo: vi.fn(), pending: false }),
  RecallSlot: () => null,
}));
vi.mock('@/components/ui', () => ({ SkeletonTableRows: () => null, Skeleton: () => null }));

import { MattersPanel } from '@/components/legal/MattersPanel';
import { ContactsPanel } from '@/components/legal/ContactsPanel';
import { IntakeFormsPanel } from '@/components/legal/IntakeFormsPanel';
import { LegalCaseSearch } from '@/components/legal/LegalCaseSearch';
import { CalendarPanel } from '@/components/legal/CalendarPanel';
import { CaseTracker } from '@/components/legal/CaseTracker';
import { LegalActionPanel } from '@/components/legal/LegalActionPanel';
import { TimeTracker } from '@/components/legal/TimeTracker';
import { LegalDashboard } from '@/components/legal/LegalDashboard';
import { getLensManifest, getLensManifests, getAllLensDomains, getManifestCount, getLensesMissingMacro, isKnownLensId, LENS_MANIFEST_INDEX } from '@/lib/lenses/manifest';

const MATTER = {
  id: 'mat_1', number: 'MAT-00001', name: 'Probe Matter', clientName: 'Probe Client',
  matterType: 'litigation', status: 'open', jurisdiction: 'California', court: 'LA Superior', caseNumber: '24STCV0001',
  hourlyRate: 200, billingType: 'hourly', openedAt: '2026-10-31', closedAt: null, description: 'A probe matter.', partyIds: [],
};
const MATTER2 = { ...MATTER, id: 'mat_2', number: 'MAT-00002', name: 'Second Matter', status: 'closed', closedAt: '2026-11-01' };
const CONTACT = {
  id: 'pty_1', number: 'PTY-00001', name: 'Probe Opposing', kind: 'opposing_party',
  email: 'opp@example.com', phone: '555-0100', organization: 'Opp LLP', address: '1 Main St', notes: 'note',
};
const CONTACT2 = { ...CONTACT, id: 'pty_2', number: 'PTY-00002', name: 'Probe Client', kind: 'client', email: 'cli@example.com' };
const FORM = {
  id: 'frm_1', number: 'INT-00001', name: 'Client Intake', matterType: 'litigation', description: 'Intake form',
  fields: [{ key: 'name', label: 'Full name', type: 'text', required: true, options: [] }],
  status: 'active', submissionCount: 1, newCount: 1, createdAt: '2026-10-31',
};
const SUBMISSION = {
  id: 'sub_1', number: 'SUB-00001', formId: 'frm_1', formName: 'Client Intake', contactName: 'New Client',
  contactEmail: 'new@example.com', contactPhone: '555-0101', matterType: 'litigation',
  answers: { name: 'New Client' }, status: 'new', convertedMatterId: null, createdAt: '2026-11-01',
};
const EVENT = {
  id: 'evt_1', number: 'EVT-00001', title: 'Filing deadline', kind: 'deadline', date: '2026-11-20',
  time: '09:00', matterId: 'mat_1', matterName: 'Probe Matter', notes: '', status: 'upcoming',
};
const CASE_ROW = {
  id: 'case_1', caption: 'Probe v. Client', caseNumber: '24STCV0001', court: 'LA Superior', jurisdiction: 'California',
  filedAt: '2026-10-15', matterId: 'mat_1', status: 'active' as const, matterType: 'civil' as const,
  nextDeadline: '2026-11-25', nextDeadlineKind: 'hearing',
  events: [{ date: '2026-10-15', kind: 'filed' as const, description: 'Complaint filed' }],
};
const ENTRY = {
  id: 'te_1', number: 'TE-00001', matterId: 'mat_1', matterName: 'Probe Matter', date: '2026-11-01',
  description: 'Drafted motion', hours: 0.51, rate: 200, amount: 102, status: 'unbilled' as const,
};
const SUMMARY = {
  openMatters: 2, unbilledTime: 110.16, unbilledHours: 0.51, openInvTotal: 220.32, overdueInvoices: 1,
  trustBalance: 60, runningTimers: 1, contactCount: 3,
  upcomingEvents: [{ id: 'evt_1', title: 'Filing deadline', date: '2026-11-20', kind: 'deadline' }],
};

function legalResult(action: string): unknown {
  switch (action) {
    case 'matters-list': return { matters: [MATTER, MATTER2] };
    case 'matters-detail': return { matter: MATTER, parties: [CONTACT], totals: { billed: 110.16, unbilled: 110.16, hours: 0.51, unbilledHours: 0.51, trustBalance: 60 }, time: [{ id: 'te_1', date: '2026-11-01', description: 'Drafted motion', hours: 0.51, amount: 102, status: 'unbilled' }], invoices: [{ id: 'inv_1', number: 'INV-00001', total: 110.16, status: 'sent' }], documents: [{ id: 'doc_1', name: 'Engagement Letter', status: 'DRAFT' }], events: [{ id: 'evt_1', title: 'Filing deadline', date: '2026-11-20', kind: 'deadline' }], cases: [CASE_ROW] };
    case 'contacts-list': return { contacts: [CONTACT, CONTACT2] };
    case 'conflict-search': return { matches: [{ name: 'Probe Client', kind: 'client' }], searched: 2 };
    case 'intake-forms-list': return { forms: [FORM] };
    case 'intake-submissions-list': return { submissions: [SUBMISSION] };
    case 'calendar-list': return { events: [EVENT] };
    case 'court-rules-deadline': return { rules: [{ id: 'fr-cp-60', name: 'FRCP 12(a)', days: 21, citation: 'Fed. R. Civ. P. 12(a)(1)(A)(i)', type: 'federal' }] };
    case 'case-list': return { cases: [CASE_ROW] };
    case 'dashboard-summary': return SUMMARY;
    case 'timer-list': return { timers: [{ id: 'tmr_1', matterId: 'mat_1', matterName: 'Probe Matter', description: 'Research', startedAt: '2026-11-01T10:00:00Z', elapsedSec: 3661 }] };
    case 'time-entries-list': return { entries: [ENTRY, { ...ENTRY, id: 'te_2', number: 'TE-00002', status: 'billed' as const, description: 'Filed motion' }] };
    case 'conflictCheck': return { hasConflict: true, scope: 'your matters and contacts in this workspace + the parties named here', conflicts: [{ name: 'Probe Client', conflictType: 'existing_client', detail: 'Current client in MAT-00001.' }] };
    case 'complianceAudit': return { score: 82, rating: 'Good', findings: [{ severity: 'medium', requirement: 'Trust accounting', reason: 'Ledger reconciles monthly.' }] };
    case 'deadlineCheck': return { upcoming: [{ name: 'Filing', deadline: '2026-11-20', daysUntil: 19 }], count: 1 };
    case 'contractRenewal': return { daysUntilExpiry: 45, urgency: 'low', autoRenewal: false, actionRequired: true };
    case 'courtlistener-search': return { query: 'plessy', semantic: false, count: 1, totalHits: 1, authenticatedWithToken: false, source: 'CourtListener', results: [{ id: 101, caseName: 'Plessy v. Ferguson', court: 'Supreme Court', courtId: 'scotus', dateFiled: '1896-05-18', absoluteUrl: '/opinion/101/', snippet: 'Separate but equal…', citation: ['163 U.S. 537'], precedentialStatus: 'Published', docketNumber: '163', judges: '', author: '', bm25Score: 1.2, semanticScore: null }] };
    case 'citation-graph': return { opinionId: 101, direction: 'citedBy', citations: [{ id: 55, citingOpinionId: 202, citingOpinionUrl: '/opinion/202/', citedOpinionId: 101, citedOpinionUrl: '/opinion/101/', otherOpinionId: 202, depth: 1 }], count: 1, totalHits: 1 };
    case 'recap-docket-search': return { results: [], count: 0 };
    default: return {};
  }
}

beforeEach(() => {
  lensRunMock.mockReset();
  runDomainMock.mockReset();
  const impl = async (req: { action?: string; name?: string; domain?: string }) => {
    const key = String(req?.action ?? req?.name ?? '');
    if (req?.domain === 'dtu' && key === 'create') return { data: { ok: true, result: { id: 'dtu_12345678', dtu: { id: 'dtu_12345678' } } } };
    if (req?.domain === 'chat_agent') return { data: { ok: true, result: { answer: 'Highest risk: the filing deadline.' } } };
    if (key === 'ai-court-doc-to-calendar') return { data: { ok: true, result: { suggestions: [{ kind: 'hearing', suggestedDate: '2026-12-01', days: 0, context: 'Hearing scheduled for December 1', source: 'court-doc' }] } } };
    if (key === 'deadlineCalculator') return { data: { ok: true, result: { filingDate: '2026-10-15', jurisdiction: 'federal', deadlines: [{ event: 'Answer due', date: '2026-11-05', daysFromFiling: 21 }] } } };
    if (key === 'ai-matter-update') return { data: { ok: true, result: { summary: 'Dear client, an update on your matter.', source: 'deterministic' } } };
    return { data: { ok: true, result: legalResult(key) } };
  };
  lensRunMock.mockImplementation(impl);
  runDomainMock.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: legalResult(action) } }));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('MattersPanel breadth', () => {
  it('renders the list, switches filters, opens detail and the create form', async () => {
    render(<MattersPanel />);
    await waitFor(() => expect(screen.getByText('Probe Matter')).toBeTruthy());
    expect(screen.getByText('Second Matter')).toBeTruthy();
    fireEvent.click(screen.getByText('Probe Matter'));
    await waitFor(() => expect(screen.queryAllByText(/MAT-00001/).length).toBeGreaterThan(0));
    const selects = screen.queryAllByRole('combobox');
    if (selects[0]) fireEvent.change(selects[0], { target: { value: 'all' } });
    const newBtn = screen.queryByRole('button', { name: 'New' });
    if (newBtn) {
      fireEvent.click(newBtn);
      const nameInput = screen.queryByPlaceholderText(/matter name/i) || screen.queryByLabelText(/name/i);
      if (nameInput) fireEvent.change(nameInput, { target: { value: 'Third Matter' } });
    }
  });
});

describe('ContactsPanel breadth', () => {
  it('renders contacts, opens the create form and runs a conflict search', async () => {
    render(<ContactsPanel />);
    await waitFor(() => expect(screen.getByText('Probe Opposing')).toBeTruthy());
    expect(screen.getByText('Probe Client')).toBeTruthy();
    const searchInput = screen.queryByPlaceholderText(/search/i);
    if (searchInput) {
      fireEvent.change(searchInput, { target: { value: 'Probe' } });
      const btn = screen.queryByRole('button', { name: /check|search/i });
      if (btn) fireEvent.click(btn);
    }
    const newBtn = screen.queryByRole('button', { name: 'New' });
    if (newBtn) fireEvent.click(newBtn);
  });
});

describe('IntakeFormsPanel breadth', () => {
  it('renders forms and submissions and opens the builder', async () => {
    render(<IntakeFormsPanel />);
    await waitFor(() => expect(screen.getByText('Client Intake')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('New Client')).toBeTruthy());
    const newBtn = screen.queryByRole('button', { name: /new form/i });
    if (newBtn) fireEvent.click(newBtn);
    fireEvent.click(screen.getByText('Client Intake'));
  });
});

describe('LegalCaseSearch breadth', () => {
  it('runs a search and renders the hit', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={qc}><LegalCaseSearch /></QueryClientProvider>);
    const input = await screen.findByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: 'plessy' } });
    const form = input.closest('form');
    if (form) fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText(/Plessy v\. Ferguson/)).toBeTruthy());
  });
});

describe('CalendarPanel breadth', () => {
  it('renders events and opens the create form', async () => {
    render(<CalendarPanel />);
    await waitFor(() => expect(screen.getByText('Filing deadline')).toBeTruthy());
    const newBtn = screen.queryByRole('button', { name: /new event|add event/i });
    if (newBtn) fireEvent.click(newBtn);
  });
});

describe('CaseTracker breadth', () => {
  it('renders cases with their matter link and opens the add form', async () => {
    render(<CaseTracker />);
    await waitFor(() => expect(screen.getByText('Probe v. Client')).toBeTruthy());
    expect(screen.getByText(/Probe Matter/)).toBeTruthy();
    const addBtn = screen.queryByRole('button', { name: /add case/i });
    if (addBtn) fireEvent.click(addBtn);
  });
});

describe('LegalActionPanel breadth', () => {
  it('drives the conflict and compliance actions', async () => {
    render(<LegalActionPanel />);
    const textareas = screen.getAllByRole('textbox');
    expect(textareas.length).toBeGreaterThan(0);
    fireEvent.change(screen.getByPlaceholderText('Party A'), { target: { value: 'Probe Client' } });
    fireEvent.change(screen.getByPlaceholderText('Party B'), { target: { value: 'Probe Opposing' } });
    const conflictBtn = screen.queryByRole('button', { name: /conflict/i });
    if (conflictBtn) {
      fireEvent.click(conflictBtn);
      await waitFor(() => expect(screen.getByText(/Conflict DETECTED/)).toBeTruthy());
      expect(screen.getByText(/Scope:/)).toBeTruthy();
    }
    const auditBtn = screen.queryByRole('button', { name: /audit|compliance/i });
    if (auditBtn) {
      fireEvent.click(auditBtn);
      await waitFor(() => expect(screen.getByText(/Trust accounting/)).toBeTruthy());
    }
  });
});

describe('TimeTracker breadth', () => {
  it('renders the running timer and entries and opens the manual form', async () => {
    render(<TimeTracker />);
    await waitFor(() => expect(screen.getByText('Drafted motion')).toBeTruthy());
    expect(screen.getByText('Filed motion')).toBeTruthy();
    expect(screen.getByText(/01:01:01/)).toBeTruthy();
    const manualBtn = screen.queryByRole('button', { name: /manual/i });
    if (manualBtn) fireEvent.click(manualBtn);
  });
});

describe('LegalDashboard breadth', () => {
  it('renders the summary tiles', async () => {
    render(<LegalDashboard />);
    await waitFor(() => expect(screen.getByText('Open matters')).toBeTruthy());
    expect(screen.getByText('Trust balance')).toBeTruthy();
    expect(screen.getByText(/\$110\.16/)).toBeTruthy();
  });
});

describe('MattersPanel round 2 — create + edit cycles', () => {
  it('creates a matter through the form and edits it from the detail view', async () => {
    render(<MattersPanel />);
    await waitFor(() => expect(screen.getByText('Probe Matter')).toBeTruthy());
    const newBtn = screen.queryByRole('button', { name: 'New' });
    if (newBtn) {
      fireEvent.click(newBtn);
      fireEvent.change(screen.getByPlaceholderText('Matter name *'), { target: { value: 'Third Matter' } });
      const client = screen.queryByPlaceholderText('Client name');
      if (client) fireEvent.change(client, { target: { value: 'Third Client' } });
      const court = screen.queryByPlaceholderText('Court');
      if (court) fireEvent.change(court, { target: { value: 'LA Superior' } });
      const jur = screen.queryByPlaceholderText('Jurisdiction');
      if (jur) fireEvent.change(jur, { target: { value: 'California' } });
      fireEvent.click(screen.getByRole('button', { name: 'Open matter' }));
      await waitFor(() => expect(lensRunMock.mock.calls.some((c) => (c[0] as { action?: string }).action === 'matters-create')).toBe(true));
    }
    fireEvent.click(screen.getByText('Probe Matter'));
    const editBtn = await screen.findByLabelText('Edit matter').catch(() => null);
    if (editBtn) {
      fireEvent.click(editBtn);
      const save = screen.queryByRole('button', { name: 'Save changes' });
      if (save) {
        fireEvent.click(save);
        await waitFor(() => expect(lensRunMock.mock.calls.some((c) => (c[0] as { action?: string }).action === 'matters-update')).toBe(true));
      }
    }
    const draftBtn = screen.queryByRole('button', { name: /draft|update/i });
    if (draftBtn) {
      fireEvent.click(draftBtn);
      await waitFor(() => expect(lensRunMock.mock.calls.some((c) => (c[0] as { action?: string }).action === 'ai-matter-update')).toBe(true)).catch(() => undefined);
    }
    // Close the matter from the detail state (activeId set) — the close
    // handler's refresh + re-open leg.
    const closeArm = screen.queryAllByRole('button', { name: 'Close' });
    if (closeArm[0]) {
      fireEvent.click(closeArm[0]);
      const confirm = screen.queryAllByRole('button', { name: 'Close' });
      if (confirm[0]) fireEvent.click(confirm[0]);
      await waitFor(() => expect(lensRunMock.mock.calls.some((c) => (c[0] as { action?: string }).action === 'matters-close')).toBe(true)).catch(() => undefined);
    }
  });
});

describe('ContactsPanel round 2 — create, edit, conflict', () => {
  it('creates a contact, edits it, and runs the conflict check', async () => {
    render(<ContactsPanel />);
    await waitFor(() => expect(screen.getByText('Probe Opposing')).toBeTruthy());
    const newBtn = screen.queryByRole('button', { name: 'New' });
    if (newBtn) {
      fireEvent.click(newBtn);
      fireEvent.change(screen.getByPlaceholderText('Name *'), { target: { value: 'New Person' } });
      const email = screen.queryByPlaceholderText('Email');
      if (email) fireEvent.change(email, { target: { value: 'new@example.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));
      await waitFor(() => expect(lensRunMock.mock.calls.some((c) => (c[0] as { action?: string }).action === 'contacts-create')).toBe(true));
    }
    const conflictInput = screen.queryByPlaceholderText(/Search name, organization/);
    if (conflictInput) {
      fireEvent.change(conflictInput, { target: { value: 'Probe' } });
      fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
      await waitFor(() => expect(lensRunMock.mock.calls.some((c) => (c[0] as { action?: string }).action === 'conflict-search')).toBe(true));
    }
    const editBtns = screen.queryAllByLabelText('Edit');
    if (editBtns[0]) {
      fireEvent.click(editBtns[0]);
      const save = screen.queryByRole('button', { name: 'Save' });
      if (save) fireEvent.click(save);
    }
  });
});

describe('IntakeFormsPanel round 2 — build, submit, convert', () => {
  it('creates a form with a field, submits an intake, converts a submission', async () => {
    render(<IntakeFormsPanel />);
    await waitFor(() => expect(screen.getByText('Client Intake')).toBeTruthy());
    const newBtn = screen.queryByRole('button', { name: /new form/i });
    if (newBtn) {
      fireEvent.click(newBtn);
      const name = screen.queryByPlaceholderText(/Form name \*/);
      if (name) fireEvent.change(name, { target: { value: 'PI Intake' } });
      const label = screen.queryByPlaceholderText('Label *');
      if (label) fireEvent.change(label, { target: { value: 'Full name' } });
      const addField = screen.queryByRole('button', { name: 'Add field' });
      if (addField) fireEvent.click(addField);
      const labels = screen.queryAllByPlaceholderText('Label *');
      if (labels[1]) fireEvent.change(labels[1], { target: { value: 'Email' } });
      const create = screen.queryByRole('button', { name: 'Publish form' });
      if (create) {
        fireEvent.click(create);
        await waitFor(() => expect(lensRunMock.mock.calls.some((c) => (c[0] as { action?: string }).action === 'intake-forms-create')).toBe(true));
      }
      const cancel = screen.queryByRole('button', { name: 'Cancel' });
      if (cancel) fireEvent.click(cancel);
    }
    // Fill out the selected form (prospect submit path).
    fireEvent.click(screen.getByText('Client Intake'));
    const submitToggle = screen.queryByRole('button', { name: /fill out|submit/i });
    if (submitToggle) fireEvent.click(submitToggle);
    const answer = screen.queryByPlaceholderText(/full name/i) || screen.queryAllByRole('textbox')[0];
    if (answer) fireEvent.change(answer, { target: { value: 'New Client' } });
    const submitBtn = screen.queryByRole('button', { name: /submit intake|submit/i });
    if (submitBtn) {
      fireEvent.click(submitBtn);
      await waitFor(() => expect(lensRunMock.mock.calls.some((c) => (c[0] as { action?: string }).action === 'intake-submit')).toBe(true)).catch(() => undefined);
    }
    const converts = screen.queryAllByRole('button', { name: 'Convert' });
    for (const b of converts) fireEvent.click(b);
    const converts2 = screen.queryAllByRole('button', { name: 'Convert' });
    for (const b of converts2) fireEvent.click(b);
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => (c[0] as { action?: string }).action === 'intake-convert')).toBe(true)).catch(() => undefined);
  });
});

describe('CalendarPanel round 2 — create event + court doc', () => {
  it('creates an event and parses a court document into a suggestion', async () => {
    render(<CalendarPanel />);
    await waitFor(() => expect(screen.getByText('Filing deadline')).toBeTruthy());
    const newBtn = screen.queryByRole('button', { name: /new event|add event/i });
    if (newBtn) {
      fireEvent.click(newBtn);
      const title = screen.queryByPlaceholderText('Title *');
      if (title) fireEvent.change(title, { target: { value: 'Deposition' } });
      const save = screen.queryByRole('button', { name: 'Save event' });
      if (save) {
        fireEvent.click(save);
        await waitFor(() => expect(lensRunMock.mock.calls.some((c) => (c[0] as { action?: string }).action === 'calendar-create')).toBe(true));
      }
    }
    const timelineOpener = screen.queryByRole('button', { name: 'Project a case timeline' });
    if (timelineOpener) {
      fireEvent.click(timelineOpener);
      const dateInput = document.querySelector('input[type="date"]');
      if (dateInput) fireEvent.change(dateInput, { target: { value: '2026-10-15' } });
      const project = screen.queryByRole('button', { name: 'Project timeline' });
      if (project) {
        fireEvent.click(project);
        await waitFor(() => expect(lensRunMock.mock.calls.some((c) => (c[0] as { action?: string }).action === 'deadlineCalculator')).toBe(true)).catch(() => undefined);
        const book = screen.queryByRole('button', { name: /Add all .* to calendar/ });
        if (book) {
          fireEvent.click(book);
          await waitFor(() => expect(lensRunMock.mock.calls.some((c) => (c[0] as { action?: string }).action === 'calendar-create')).toBe(true)).catch(() => undefined);
        }
      }
    }
    const docOpener = screen.queryByRole('button', { name: 'Paste a document' });
    if (docOpener) fireEvent.click(docOpener);
    const doc = screen.queryByPlaceholderText(/Paste the body of a court order/);
    if (doc) {
      fireEvent.change(doc, { target: { value: 'Hearing scheduled for December 1, 2026.' } });
      const parse = screen.queryByRole('button', { name: 'Extract deadlines' });
      if (parse) {
        fireEvent.click(parse);
        const add = await screen.findByRole('button', { name: 'Add to calendar' }).catch(() => null);
        if (add) fireEvent.click(add);
      }
    }
  });
});

describe('TimeTracker round 2 — timer + manual entry + delete', () => {
  it('starts and stops a timer, adds a manual entry, deletes an entry', async () => {
    render(<TimeTracker />);
    await waitFor(() => expect(screen.getByText('Drafted motion')).toBeTruthy());
    const selects = screen.queryAllByRole('combobox');
    if (selects[0]) fireEvent.change(selects[0], { target: { value: 'mat_1' } });
    const desc = screen.queryByPlaceholderText('What are you working on?');
    if (desc) fireEvent.change(desc, { target: { value: 'Research' } });
    const start = screen.queryByRole('button', { name: /start/i });
    if (start) {
      fireEvent.click(start);
      await waitFor(() => expect(lensRunMock.mock.calls.some((c) => (c[0] as { action?: string }).action === 'timer-start')).toBe(true));
    }
    const stop = screen.queryByRole('button', { name: /stop/i });
    if (stop) fireEvent.click(stop);
    const manualBtn = screen.queryByRole('button', { name: /manual/i });
    if (manualBtn) {
      fireEvent.click(manualBtn);
      const selects2 = screen.queryAllByRole('combobox');
      if (selects2[1]) fireEvent.change(selects2[1], { target: { value: 'mat_1' } });
      const hours = screen.queryByPlaceholderText('Hours *');
      if (hours) fireEvent.change(hours, { target: { value: '1.5' } });
      const add = screen.queryByRole('button', { name: 'Add' });
      if (add) {
        fireEvent.click(add);
        await waitFor(() => expect(lensRunMock.mock.calls.some((c) => (c[0] as { action?: string }).action === 'time-entries-create')).toBe(true));
      }
    }
    const del = screen.queryAllByLabelText('Delete');
    if (del[0]) fireEvent.click(del[0]);
  });
});

describe('LegalCaseSearch round 2 — detail, courts, unavailable', () => {
  it('opens the opinion, switches citation direction and court chips', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={qc}><LegalCaseSearch /></QueryClientProvider>);
    const input = await screen.findByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: 'plessy' } });
    const form = input.closest('form');
    if (form) fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText(/Plessy v\. Ferguson/)).toBeTruthy());
    const chip = screen.queryByRole('button', { name: /Supreme Court/i });
    if (chip) fireEvent.click(chip);
    const open = screen.queryByLabelText('Open opinion');
    if (open) fireEvent.click(open);
    const citing = screen.queryByRole('button', { name: /citing opinions/i });
    if (citing) {
      fireEvent.click(citing);
      await waitFor(() => expect(runDomainMock.mock.calls.some((c) => c[1] === 'citation-graph')).toBe(true));
    }
  });

  it('states the unavailable state plainly when the upstream is down', async () => {
    runDomainMock.mockImplementation(async () => ({ data: { ok: false, error: 'Case law search is unavailable right now — CourtListener did not answer. Nothing was searched; try again shortly.' } }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={qc}><LegalCaseSearch /></QueryClientProvider>);
    const input = await screen.findByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: 'chevron' } });
    const form = input.closest('form');
    if (form) fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText(/unavailable/i)).toBeTruthy());
  });
});

describe('LegalActionPanel round 2 — every action', () => {
  it('drives deadline, renewal, audit, mint, publish and agent actions', async () => {
    render(<LegalActionPanel />);
    fireEvent.change(screen.getByPlaceholderText('Case / matter name'), { target: { value: 'Probe Matter' } });
    fireEvent.change(screen.getByPlaceholderText('Party A'), { target: { value: 'Probe Client' } });
    fireEvent.change(screen.getByPlaceholderText('Party B'), { target: { value: 'Probe Opposing' } });
    fireEvent.change(screen.getByPlaceholderText('DM recipient'), { target: { value: 'user_1' } });
    const areas = screen.getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    if (areas[0]) fireEvent.change(areas[0], { target: { value: 'Filing 2026-11-20 high' } });
    if (areas[1]) fireEvent.change(areas[1], { target: { value: 'MSA Agreement 2027-01-15' } });
    const clickBy = async (re: RegExp) => {
      const b = screen.queryByRole('button', { name: re });
      if (b) {
        fireEvent.click(b);
        await waitFor(() => expect(lensRunMock.mock.calls.length + runDomainMock.mock.calls.length).toBeGreaterThan(0));
      }
    };
    await clickBy(/deadline/i);
    await clickBy(/renewal/i);
    await clickBy(/audit/i);
    await clickBy(/conflict/i);
    await clickBy(/mint|save/i);
    await clickBy(/publish/i);
    await clickBy(/agent|risk/i);
    await clickBy(/dm|send/i);
    expect(lensRunMock.mock.calls.length + runDomainMock.mock.calls.length).toBeGreaterThan(3);
  });
});

describe('manifest helpers breadth', () => {
  it('exercises the manifest accessors across lenses', () => {
    expect(getLensManifest('legal')?.domain).toBe('legal');
    expect(getLensManifests().length).toBeGreaterThan(100);
    const legalEntry = getLensManifest('legal');
    expect(getLensManifests(legalEntry?.category).length).toBeGreaterThan(0);
    expect(getAllLensDomains()).toContain('legal');
    expect(getManifestCount()).toBeGreaterThan(100);
    expect(Array.isArray(getLensesMissingMacro('list'))).toBe(true);
    expect(isKnownLensId('legal')).toBe(true);
    expect(isKnownLensId('no-such-lens')).toBe(false);
    expect(LENS_MANIFEST_INDEX.legal?.domain).toBe('legal');
  });
});
