// Render + behaviour coverage for the government lens panels (permits, FOIA, payments,
// elections, advocacy, service requests, document library, case ops, action panel).
// Each panel is mounted against stubbed records, must show real rendered content, and
// survive a full exercise pass (fill every field, press every control); an offline
// backend must degrade to an honest state, not a crash.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise, fakeEntity } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
// Every government `*-list` action answers with each plural collection the panels read, each holding
// one plausible record, so lists, rows, detail drawers and per-row actions all render.
const KEYS = ['permits', 'fines', 'payments', 'documents', 'requests', 'elections', 'items', 'rows', 'candidates', 'issues', 'petitions', 'reports', 'cases', 'bills', 'contacts', 'representatives'];
function listOf(): Record<string, unknown> {
  const out: Record<string, unknown> = { stripeConfigured: true, count: 1 };
  for (const k of KEYS) out[k] = [fakeEntity(`${k}-1`)];
  // Documents carry a nested signatures list the generic entity can't fake.
  out.documents = [
    { id: 'doc-1', title: 'Zoning ordinance', category: 'ordinance', bodyText: 'Section 1', fileUrl: 'https://example.org/z.pdf', requiresSignature: true, signatures: [{ id: 's1', signerName: 'Ann', signedAt: '2026-03-02' }] },
    { id: 'doc-2', title: 'Budget memo', category: 'memo', bodyText: '', fileUrl: '', requiresSignature: false, signatures: [] },
  ];
  return out;
}
const resultFor = (action: string): unknown => (/-list$|^list|summary|stats/.test(action) ? listOf() : { ok: true, id: 'new-1' });
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })), delete: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [{ id: 'a1', title: 'Case one', type: 'Permit', createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-02T10:00:00.000Z', meta: { status: 'open', tags: ['x'] }, data: { title: 'Case one', status: 'open', amount: 120, description: 'Needs review', applicant: 'Ann', address: '1 Main St', tags: ['x'] } }, { id: 'a2', title: 'Case two', type: 'Permit', createdAt: '2026-03-03T10:00:00.000Z', updatedAt: '2026-03-03T10:00:00.000Z', meta: { status: 'closed' }, data: { title: 'Case two', status: 'closed' } }], isLoading: false, isError: false, error: null, refetch: vi.fn(), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), remove: vi.fn(async () => ({})), isCreating: false }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync: vi.fn(async () => ({ ok: true, result: {} })), mutate: vi.fn(), isPending: false }) }));
// The pin-drop map needs WebGL2, which jsdom does not have.
vi.mock('../PinDropMap', () => ({ PinDropMap: () => <div>pin drop map</div> }));
vi.mock('@/components/payment/StripePaymentForm', () => ({ StripePaymentForm: () => <div>stripe form</div> }));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn() }),
  useRecallableAction: () => ({ run: (fn: () => Promise<unknown>) => fn(), state: 'idle' }),
  RecallSlot: () => null,
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { AdvocacyPanel } from '../AdvocacyPanel';
import { CaseOpsPanel } from '../CaseOpsPanel';
import { DocumentLibraryPanel } from '../DocumentLibraryPanel';
import { ElectionsPanel } from '../ElectionsPanel';
import { FOIATracker } from '../FOIATracker';
import { GovernmentActionPanel } from '../GovernmentActionPanel';
import { PaymentsPanel } from '../PaymentsPanel';
import { PermitsPanel } from '../PermitsPanel';
import { ServiceRequestReporter } from '../ServiceRequestReporter';
import { ServiceRequestsPanel } from '../ServiceRequestsPanel';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['AdvocacyPanel', () => <AdvocacyPanel />],
  ...(['Permit', 'Project', 'Violation', 'EmergencyPlan', 'Record', 'CourtCase'] as const).flatMap((t): Array<[string, () => React.ReactElement]> => [
    [`CaseOpsPanel ${t} (files)`, () => <CaseOpsPanel artifactType={t as never} />],
    [`CaseOpsPanel ${t} (dashboard)`, () => <CaseOpsPanel artifactType={t as never} surface="dashboard" />],
  ]),
  ['DocumentLibraryPanel', () => <DocumentLibraryPanel />],
  ['ElectionsPanel', () => <ElectionsPanel />],
  ['FOIATracker', () => <FOIATracker />],
  ['GovernmentActionPanel', () => <GovernmentActionPanel />],
  ['PaymentsPanel', () => <PaymentsPanel />],
  ['PermitsPanel', () => <PermitsPanel />],
  ['ServiceRequestReporter', () => <ServiceRequestReporter />],
  ['ServiceRequestsPanel', () => <ServiceRequestsPanel />],
];

describe('government panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(10);
    expect(screen.getAllByRole('button').length + view.container.querySelectorAll('input, select, textarea').length).toBeGreaterThan(0);
    await exercise({ passes: 3 });
    await settle();
    await exercise({ passes: 1, text: '5' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container.textContent).toBeTruthy();
  });
});
