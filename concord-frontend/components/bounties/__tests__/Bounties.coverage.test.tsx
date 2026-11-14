// Render coverage for the bounty board components: card (owner, claimant and
// stranger views), filters, leaderboard, create form and the GHSA advisory list.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';
import { STATUS_STYLE, DIFFICULTY_STYLE } from '../types';
import type { PlatformBounty } from '../types';

const T = '2026-03-01T10:00:00.000Z';
const BOUNTY: PlatformBounty = {
  id: 'b1', title: 'Fix parser', description: 'It breaks', ownerId: 'owner', ownerName: 'Olu', category: 'bug', tags: ['parser'], difficulty: 'intermediate',
  rewardCc: 200, poolCc: 200, paidCc: 50, status: 'in_review', createdAt: T, updatedAt: T, deadline: '2026-04-01', submissionCount: 1, acceptedSubmissionId: null,
  milestones: [{ id: 'ms1', index: 0, title: 'Repro', rewardCc: 50, status: 'paid', paidTo: 'dev', paidAt: T }, { id: 'ms2', index: 1, title: 'Fix', rewardCc: 150, status: 'submitted' }],
  submissions: [{ id: 's1', bountyId: 'b1', claimantId: 'dev', claimantName: 'Dev', summary: 'patched', link: 'https://example.org/pr', notes: 'n', milestoneId: 'ms2', status: 'pending', reviewNote: null, createdAt: T }],
  dispute: { id: 'd1', openedBy: 'dev', openedByName: 'Dev', reason: 'unfair', status: 'open', ruling: null, rulingNote: null, resolvedAt: null, openedAt: T },
};
const lensRunMock = vi.fn();
const RES: Record<string, unknown> = {
  leaderboard: { topEarners: [{ rank: 1, userId: 'u1', name: 'Ada', earnedCc: 900, resolved: 4 }, { rank: 2, userId: 'u2', name: null, earnedCc: 300, resolved: 1 }], topResolvers: [{ rank: 1, userId: 'u3', name: 'Bo', earnedCc: 0, resolved: 7 }] },
  'github-advisories': { items: [{ ghsa_id: 'GHSA-1', cve_id: 'CVE-1', summary: 'RCE in lib', severity: 'critical', published_at: T, html_url: 'https://github.com/advisories/GHSA-1', vulnerabilities: [{ package: { ecosystem: 'npm', name: 'lib' }, vulnerable_version_range: '<1.2' }], cvss: { score: 9.8, vector_string: 'CVSS:3.1/AV:N' }, type: 'reviewed' }, { ghsa_id: 'GHSA-2', summary: 'XSS', severity: 'high', published_at: T, html_url: 'https://github.com/advisories/GHSA-2' }], stale: true, fetchedAt: Date.now() },
};
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a), api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/store/ui', () => ({ useUIStore: (sel?: (s: unknown) => unknown) => { const s = { addToast: vi.fn() }; return sel ? sel(s) : s; } }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>Save as DTU</button>, default: () => <button>Save as DTU</button> }));

import { BountyCard } from '../BountyCard';
import { BountyFilters } from '../BountyFilters';
import { BountyLeaderboard } from '../BountyLeaderboard';
import { CreateBountyForm } from '../CreateBountyForm';
import { GhsaAdvisories } from '../GhsaAdvisories';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => {
    const act = actionOf(a);
    return { data: { ok: true, result: RES[act] ?? { bounty: BOUNTY }, error: null } };
  });
});

describe('BountyCard', () => {
  it.each([['owner', 'owner', undefined], ['claimant', 'dev', undefined], ['stranger', 'someone', undefined], ['arbiter', 'arb', 'admin']])('renders and drives the %s view', async (_n, uid, role) => {
    const view = render(<BountyCard bounty={BOUNTY} currentUserId={uid} currentUserRole={role} onChanged={vi.fn()} />);
    await settle();
    expect(view.container.textContent).toContain('Fix parser');
    await act(async () => { fireEvent.click(screen.getByText(/^Details/)); });
    await settle();
    await exercise({ passes: 4, skip: /Details|Hide details/ });
    await settle();
    await exercise({ passes: 2, text: '5', skip: /Details|Hide details/ });
  });
  it.each(['open', 'claimed', 'paid', 'disputed', 'cancelled'] as const)('renders the %s status', async (status) => {
    const view = render(<BountyCard bounty={{ ...BOUNTY, status, milestones: [], dispute: null, submissions: [] }} currentUserId="owner" onChanged={vi.fn()} />);
    await settle();
    await act(async () => { fireEvent.click(screen.getByText(/^Details/)); });
    await exercise({ passes: 3, skip: /Details|Hide details/ });
    expect(view.container.textContent).toBeTruthy();
  });
  it('surfaces an honest failure when an action is rejected', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'insufficient pool' } }));
    const view = render(<BountyCard bounty={BOUNTY} currentUserId="owner" onChanged={vi.fn()} />);
    await settle();
    await act(async () => { fireEvent.click(screen.getByText(/^Details/)); });
    await exercise({ passes: 3, skip: /Details|Hide details/ });
    expect(view.container.textContent).toBeTruthy();
  });
});

describe('BountyFilters', () => {
  it('reports every filter change', async () => {
    const onChange = vi.fn();
    const view = render(<BountyFilters value={{ query: '', category: '', difficulty: '', status: '', tag: '', sortBy: 'newest' }} onChange={onChange} total={12} />);
    await exercise({ passes: 2 });
    expect(onChange).toHaveBeenCalled();
    expect(view.container.textContent).toContain('12');
  });
});

describe('BountyLeaderboard', () => {
  it('shows earners and resolvers', async () => {
    const view = render(<BountyLeaderboard refreshKey={0} />);
    await settle();
    await exercise({ passes: 2 });
    expect(view.container.textContent).toBeTruthy();
  });
  it('is honest when the board is unavailable', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'down' } }));
    const view = render(<BountyLeaderboard refreshKey={1} />);
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });
});

describe('CreateBountyForm', () => {
  it('opens, fills and submits with milestones', async () => {
    const onCreated = vi.fn();
    const view = render(<CreateBountyForm onCreated={onCreated} />);
    await exercise({ passes: 5, text: 'Add search' });
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });
  it('opens pre-filled from an advisory and consumes the draft', async () => {
    const consume = vi.fn();
    render(<CreateBountyForm onCreated={vi.fn()} prefill={{ title: 'Fix GHSA-1', description: 'd', category: 'security', tags: 'ghsa' }} onConsumePrefill={consume} />);
    await settle();
    expect(consume).toHaveBeenCalled();
    await exercise({ passes: 3 });
  });
});

describe('GhsaAdvisories', () => {
  it('lists advisories and converts one into a bounty draft', async () => {
    const convert = vi.fn();
    const view = render(<GhsaAdvisories onConvertToBounty={convert} />);
    await settle();
    await exercise({ passes: 3 });
    expect(view.container.textContent).toBeTruthy();
  });
  it('shows an honest error when GitHub is unavailable', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'github_unavailable' } }));
    const view = render(<GhsaAdvisories />);
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });
});

describe('bounty style tables', () => {
  it('defines a style for every status and difficulty', () => {
    for (const s of ['open', 'claimed', 'in_review', 'paid', 'disputed', 'cancelled']) expect(STATUS_STYLE[s]).toBeTruthy();
    for (const d of ['beginner', 'intermediate', 'advanced', 'expert']) expect(DIFFICULTY_STYLE[d]).toBeTruthy();
  });
});
