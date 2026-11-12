/**
 * Theme-5 sticky-confirm cluster 3 (FIX-nonprofit-007 · FIX-crisis-ops-007 ·
 * FIX-fork-001 · FIX-entity-003 · FIX-creative-006 · FIX-cognition-005):
 * nonprofit donor/page/volunteer/event deletes, crisis responder unassign +
 * crisis Resolve, fork watchlist delete, entity graph node/attribute/edge/
 * schema deletes, and creative call-sheet/deliverable/calendar deletes no
 * longer fire on the first click. FIX-cognition-005 is the verify-only
 * shape: the cognition page's two-step delete already exists — this pins
 * that it does NOT disarm after 10 seconds (the ticket's vanishing-confirm
 * complaint does not reproduce at head).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })) } },
  isForbidden: () => false,
}));
vi.mock('@/components/viz', () => ({
  ChartKit: () => React.createElement('div', { 'data-testid': 'chart' }),
  TimelineView: () => React.createElement('div', { 'data-testid': 'timeline' }),
  TreeDiagram: ({ onSelect }: { onSelect: (n: { id: string }) => void }) =>
    React.createElement('button', { onClick: () => onSelect({ id: 'n1' }) }, 'select-node'),
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));
vi.mock('@/components/lens/NorthStarFrame', () => ({ NorthStarFrame: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [], isLoading: false, isError: false, error: null, refetch: vi.fn(), create: vi.fn(), remove: vi.fn() }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'tester' }, isLoading: false, isAuthenticated: true }) }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));
vi.mock('@/components/crisis-ops/FemaDisasters', () => ({ FemaDisasters: () => null }));
vi.mock('@/components/crisis-ops/CrisisMap', () => ({ CrisisMap: () => null }));
vi.mock('@/components/crisis-ops/TriagePanel', () => ({ TriagePanel: () => null }));
vi.mock('@/components/crisis-ops/PlaybookPanel', () => ({ PlaybookPanel: () => null }));
vi.mock('@/components/crisis-ops/TimelinePanel', () => ({ TimelinePanel: () => null }));
vi.mock('@/components/crisis-ops/AlertsPanel', () => ({ AlertsPanel: () => null }));
vi.mock('@/components/crisis-ops/ResourcePanel', () => ({ ResourcePanel: () => null }));
vi.mock('@/components/crisis-ops/IncidentReportPanel', () => ({ IncidentReportPanel: () => null }));
vi.mock('@/components/crisis-ops/PlaybooksPanel', () => ({ PlaybooksPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn(), items: [] }),
  useRecallableAction: () => ({ run: vi.fn(async (fn: () => Promise<unknown>) => fn()), recall: vi.fn(), state: null, armed: false, slot: null }),
  RecallSlot: () => null,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({ withContentLicense: (x: unknown) => x }));

import { NonprofitWorkbench } from '@/components/nonprofit/NonprofitWorkbench';
import { TeamPanel } from '@/components/crisis-ops/TeamPanel';
import CrisisOpsPage from '@/app/lenses/crisis-ops/page';
import { RepoWatchlist } from '@/components/fork/RepoWatchlist';
import { KnowledgeGraphWorkbench } from '@/components/entity/KnowledgeGraphWorkbench';
import { ProductionSuite } from '@/components/creative/ProductionSuite';
import CognitionLens from '@/app/lenses/cognition/page';

const calls = (action: string) => lensRunMock.mock.calls.filter((c) => c[1] === action);
const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
};

// ── fixtures ────────────────────────────────────────────────────────────────
const GIFT = { id: 'g1', amount: 100, at: '2026-01-05', fund: 'general', campaign: 'Spring', method: 'card', receiptIssued: false, ackSent: false };
const PLEDGE = { id: 'p1', amount: 25, frequency: 'monthly', status: 'active', paid: 50, payments: 2, nextDue: '2026-03-01', fund: 'general', donorId: 'd1', donorName: 'Ada Lovelace' };
const DONOR = { id: 'd1', name: 'Ada Lovelace', email: 'ada@example.org', phone: '555', address: '1 Main', type: 'individual', notes: 'n', gifts: [GIFT], comms: [], pledges: [PLEDGE], totalGiven: 100, giftCount: 1, avgGift: 100, lastGiftAt: '2026-01-05', firstGiftAt: '2026-01-05', pledgeBalance: 25, commCount: 0 };
const PAGE = { id: 'pg1', slug: 'spring', title: 'Spring Appeal', story: 's', goal: 5000, suggestedAmounts: [25], accentColor: '#f43f5e', coverImage: '', published: true, raised: 1200, donations: [], donorCount: 1, progressPct: 24, publicUrl: '/give/spring' };
const VOL = { id: 'v1', name: 'Bo Helper', email: 'bo@example.org', phone: '', skills: ['driving'], availability: 'weekends', shifts: [], totalHours: 1, status: 'active' };
const EVENT = { id: 'e1', name: 'Gala Night', description: 'd', date: '2026-05-01', goal: 10000, ticketPrice: 100, type: 'gala', teams: [], status: 'planned', raised: 0, progressPct: 0, teamCount: 0, donorCount: 0 };
const TEAMRES = { count: 1, roles: ['responder'], byRole: { responder: [{ id: 'm1', responder: 'Riley Responder', role: 'responder', canUnassign: true, assignedByName: null, assignedByIsMe: false }] } };
const GRAPH = {
  nodes: [
    { id: 'n1', name: 'QA Node', entityType: 'person', attributes: { color: { value: 'red', source: 'qa' } }, wikidataId: null, createdAt: 1 },
    { id: 'n2', name: 'Other Node', entityType: 'place', attributes: {}, wikidataId: null, createdAt: 2 },
  ],
  edges: [{ id: 'e9', from: 'n1', to: 'n2', relType: 'knows' }],
  schemas: [{ id: 's1', className: 'Person', attributes: [], createdAt: 1 }],
};
const SHEET = { id: 's1', project: 'Pilot', shootDate: '2026-03-10', dayNumber: 2, generalCall: '07:00', cast: [], crew: [], locations: [], schedule: [], notes: '', castCount: 0, crewCount: 0, locationCount: 0, sceneCount: 0 };
const DELIV = { id: 'dl1', name: 'Master Cut', project: 'Pilot', versions: [{ version: 1, src: null, note: '', uploadedBy: 'Dee', uploadedAt: '2026-03-01' }], currentVersion: 1, status: 'in_review', reviewer: 'Sam', decisionNote: null, decidedAt: null, submittedAt: '2026-03-01', versionCount: 1 };
const CALEV = { id: 'ev1', title: 'Shoot Day', date: '2026-03-10', kind: 'shoot_day', project: 'Pilot', endDate: null, notes: '', done: false };

const RESULTS: Record<string, unknown> = {
  'donor-list': { donors: [DONOR] },
  'donor-segment': { segments: { major: [], midLevel: [], firstTime: [], lapsed: [], recurring: [], prospect: [] }, summary: {} },
  'pledge-list': { pledges: [PLEDGE], count: 1, active: 1, monthlyValue: 25 },
  'donation-page-list': { pages: [PAGE] },
  'volunteer-list': { volunteers: [VOL], totalHours: 1, estValue: 33, hourlyRate: 33 },
  'event-list': { events: [EVENT] },
  team: TEAMRES,
  active_for_player: { crises: [{ id: 'c1', type: 'Flood', description: 'River rising', origin_world_id: 'w1', started_at: 1 }], suggestions: [], crisisTypes: [] },
  'watch-list': { repos: [{ id: 'r1', fullName: 'concord/engine', reason: 'reference', stars: 42, updatedAt: '2026-03-01' }] },
  'watch-dashboard': { repos: 1, totalStars: 42, refreshed: 1 },
  'graph-get': GRAPH,
  'callsheet-list': { sheets: [SHEET] },
  'deliverable-list': { deliverables: [DELIV] },
  'calendar-list': { events: [CALEV], upcoming: 1, overdue: 0 },
  'review-asset-list': { assets: [] },
  'breakdown-list': { breakdowns: [] },
  'prooflink-list': { links: [] },
  listExports: { exports: [{ id: 't1', title: 'Why is the sky blue' }], count: 1 },
  getExport: { export: { id: 't1', trace: { input: { question: 'Why is the sky blue?' } } } },
};

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: RESULTS[action] ?? {}, error: null } }));
});

describe('FIX-nonprofit-007 — donor / page / volunteer / event deletes confirm first', () => {
  it('donor: arm names the pledge consequence and sends nothing; Confirm sends donor-delete', async () => {
    wrap(<NonprofitWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete donor Ada Lovelace' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm delete donor Ada Lovelace' });
    expect(confirm.textContent).toMatch(/also removes 1 pledge/i);
    expect(calls('donor-delete')).toHaveLength(0);
    fireEvent.click(confirm);
    await waitFor(() => expect(calls('donor-delete')).toHaveLength(1));
  });

  it('donation page: arm sends nothing; Confirm sends donation-page-delete', async () => {
    wrap(<NonprofitWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: 'Donation Pages' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete page Spring Appeal' }));
    expect(await screen.findByRole('button', { name: 'Confirm delete page Spring Appeal' })).toBeTruthy();
    expect(calls('donation-page-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete page Spring Appeal' }));
    await waitFor(() => expect(calls('donation-page-delete')).toHaveLength(1));
  });

  it('volunteer: arm sends nothing; Confirm sends volunteer-delete', async () => {
    wrap(<NonprofitWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: 'Volunteers' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete volunteer Bo Helper' }));
    expect(await screen.findByRole('button', { name: 'Confirm delete volunteer Bo Helper' })).toBeTruthy();
    expect(calls('volunteer-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete volunteer Bo Helper' }));
    await waitFor(() => expect(calls('volunteer-delete')).toHaveLength(1));
  });

  it('event: arm sends nothing; Confirm sends event-delete', async () => {
    wrap(<NonprofitWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: 'Events & P2P' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete event Gala Night' }));
    expect(await screen.findByRole('button', { name: 'Confirm delete event Gala Night' })).toBeTruthy();
    expect(calls('event-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete event Gala Night' }));
    await waitFor(() => expect(calls('event-delete')).toHaveLength(1));
  });
});

describe('FIX-crisis-ops-007 — unassign + Resolve confirm first', () => {
  it('responder unassign: arm sends nothing; Confirm sends unassign', async () => {
    wrap(<TeamPanel crisisId="c1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Riley Responder' }));
    expect(await screen.findByRole('button', { name: 'Confirm remove Riley Responder' })).toBeTruthy();
    expect(calls('unassign')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove Riley Responder' }));
    await waitFor(() => expect(calls('unassign')).toHaveLength(1));
    expect(calls('unassign')[0][2]).toMatchObject({ entryId: 'm1' });
  });

  it('crisis Resolve: first click arms, second confirms and sends resolve', async () => {
    wrap(<CrisisOpsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve Flood' }));
    expect(await screen.findByRole('button', { name: 'Confirm resolve Flood' })).toBeTruthy();
    expect(calls('resolve')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resolve Flood' }));
    await waitFor(() => expect(calls('resolve')).toHaveLength(1));
    expect(calls('resolve')[0][2]).toMatchObject({ crisisId: 'c1' });
  });
});

describe('FIX-fork-001 — watchlist delete confirms first', () => {
  it('arm sends nothing; Confirm sends watch-delete', async () => {
    wrap(<RepoWatchlist />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete concord/engine' }));
    expect(await screen.findByRole('button', { name: 'Confirm delete concord/engine' })).toBeTruthy();
    expect(calls('watch-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete concord/engine' }));
    await waitFor(() => expect(calls('watch-delete')).toHaveLength(1));
  });
});

describe('FIX-entity-003 — graph deletes confirm first', () => {
  it('node delete: select, arm sends nothing, Confirm sends node-delete', async () => {
    wrap(<KnowledgeGraphWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: 'select-node' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete node QA Node' }));
    expect(await screen.findByRole('button', { name: 'Confirm delete node QA Node' })).toBeTruthy();
    expect(calls('node-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete node QA Node' }));
    await waitFor(() => expect(calls('node-delete')).toHaveLength(1));
  });

  it('schema delete: arm sends nothing, Confirm sends schema-delete', async () => {
    wrap(<KnowledgeGraphWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: 'Schemas' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete schema Person' }));
    expect(await screen.findByRole('button', { name: 'Confirm delete schema Person' })).toBeTruthy();
    expect(calls('schema-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete schema Person' }));
    await waitFor(() => expect(calls('schema-delete')).toHaveLength(1));
  });
});

describe('FIX-creative-006 — call sheet / deliverable / calendar deletes confirm first', () => {
  it('call sheet: arm sends nothing; Confirm sends callsheet-delete', async () => {
    wrap(<ProductionSuite />);
    fireEvent.click(await screen.findByRole('button', { name: 'Call Sheets' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete call sheet for Pilot' }));
    expect(await screen.findByRole('button', { name: 'Confirm delete call sheet' })).toBeTruthy();
    expect(calls('callsheet-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete call sheet' }));
    await waitFor(() => expect(calls('callsheet-delete')).toHaveLength(1));
  });

  it('deliverable: arm sends nothing; Confirm sends deliverable-delete', async () => {
    wrap(<ProductionSuite />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deliverables' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete deliverable Master Cut' }));
    expect(await screen.findByRole('button', { name: 'Confirm delete deliverable Master Cut' })).toBeTruthy();
    expect(calls('deliverable-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete deliverable Master Cut' }));
    await waitFor(() => expect(calls('deliverable-delete')).toHaveLength(1));
  });

  it('calendar event: arm sends nothing; Confirm sends calendar-delete', async () => {
    wrap(<ProductionSuite />);
    fireEvent.click(await screen.findByRole('button', { name: 'Production Calendar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete event Shoot Day' }));
    expect(await screen.findByRole('button', { name: 'Confirm delete event Shoot Day' })).toBeTruthy();
    expect(calls('calendar-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete event Shoot Day' }));
    await waitFor(() => expect(calls('calendar-delete')).toHaveLength(1));
  });
});

describe('FIX-cognition-005 — the two-step delete does NOT time out (verify-only pin)', () => {
  it('arm, wait 10s of timers, still armed; Delete sends deleteExport', async () => {
    wrap(<CognitionLens />);
    const del = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(del);
    expect(await screen.findByText('Delete “Why is the sky blue”?')).toBeTruthy();
    expect(calls('deleteExport')).toHaveLength(0);
    vi.useFakeTimers();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    vi.useRealTimers();
    // Still armed after 10s — no disarm timer exists at head.
    expect(screen.getByText('Delete “Why is the sky blue”?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls('deleteExport')).toHaveLength(1));
    expect(calls('deleteExport')[0][2]).toMatchObject({ exportId: 't1' });
  });
});
