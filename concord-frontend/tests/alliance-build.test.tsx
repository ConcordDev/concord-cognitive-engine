// concord-frontend/tests/alliance-build.test.tsx
//
// Alliance full lens build (B2) — pins:
//   F2  FactionWarIntel: unnamed feed entries are reported as a feed
//       gap — never rendered or saved as wars; the header no longer
//       claims the feed is "live"
//   F4  Compatibility renders the fifth component (strength similarity)
//       and the composite's formula + weights
//   F5  Risk renders the concentration basis and each partner's share
//   F6  alliance delete states its destruction scope before confirming
//       and announces itself after; the invite form says what it accepts
//   F7  the alliance type combobox carries a visible label
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor, within } from '@testing-library/react';
import React, { useCallback, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Status = 'idle' | 'dispatched' | 'running' | 'done' | 'error';
const lensRunMock = vi.fn();
const apiGetMock = vi.fn();
const runDomainMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGetMock(...a), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomainMock(...a) } },
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('@/hooks/useMacroDispatchFeedback', () => ({
  useMacroDispatchFeedback: () => {
    const [status, setStatus] = useState<Status>('done');
    const [result, setResult] = useState<{ alliances: unknown[]; count: number } | null>({ alliances: [], count: 0 });
    const [error, setError] = useState<string | null>(null);
    const dispatch = useCallback(async (domain: string, action: string, input: Record<string, unknown> = {}) => {
      setStatus('dispatched');
      const r = await lensRunMock(domain, action, input);
      if (r?.data?.ok === false) { setError(r.data.error || 'failed'); setStatus('error'); setResult(null); return null; }
      setResult((r?.data?.result as { alliances: unknown[]; count: number }) || { alliances: [], count: 0 });
      setError(null); setStatus('done');
      return r?.data?.result ?? null;
    }, []);
    return { status, runId: null, domain: 'alliance', action: 'alliance-list', result, error, ms: null, stage: null, dispatch, reset: vi.fn() };
  },
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'tester' }, isLoading: false, isAuthenticated: true }) }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: (props: { title?: string; content?: string }) =>
    React.createElement('div', { 'data-testid': 'save-dtu', 'data-title': props.title || '' }, props.content || ''),
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  // One stable component per tag: a fresh function on every property read changes the
  // element type each render, which remounts the workspace and drops its notice on any
  // page re-render (the summary refresh after a delete).
  motion: (() => {
    const Stable = (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode);
    return new Proxy({}, { get: () => Stable });
  })(),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import AllianceLens from '@/app/lenses/alliance/page';
import { FactionWarIntel } from '@/components/alliance/FactionWarIntel';
import { AllianceAnalyticsPanel } from '@/components/alliance/AllianceAnalyticsPanel';

const CREATED = {
  id: 'alc_new', name: 'Fresh Pact', description: '', type: 'research', status: 'forming',
  members: [{ userId: 'u1', displayName: 'Tester', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z', isMe: true }],
  myRole: 'owner', channelCount: 1, activeProposals: 0, createdAt: '2026-01-01T00:00:00.000Z',
};
let store: { alliances: typeof CREATED[] };

function installLensRun() {
  store = { alliances: [] };
  lensRunMock.mockImplementation(async (domain: string, action: string, input: Record<string, unknown> = {}) => {
    if (domain !== 'alliance') return { data: { ok: true, result: null, error: null } };
    switch (action) {
      case 'alliance-list':
        return { data: { ok: true, result: { alliances: store.alliances, count: store.alliances.length }, error: null } };
      case 'notifications':
        return { data: { ok: true, result: { totalUnread: 0, pendingInvites: 0, perAlliance: [], invites: [] }, error: null } };
      case 'alliance-create': {
        const row = { ...CREATED, name: String(input.name || CREATED.name) };
        store.alliances = [row];
        return { data: { ok: true, result: { alliance: row, defaultChannel: { id: 'chn_1', name: 'general' } }, error: null } };
      }
      case 'alliance-delete':
        store.alliances = [];
        return { data: { ok: true, result: { deleted: true }, error: null } };
      case 'channel-list':
        return { data: { ok: true, result: { channels: [{ id: 'chn_1', name: 'general', topic: '', messageCount: 0, unread: 0, lastMessageAt: null }] }, error: null } };
      case 'proposal-list':
        return { data: { ok: true, result: { proposals: [] }, error: null } };
      case 'invite-list':
        return { data: { ok: true, result: { invites: [] }, error: null } };
      case 'message-list':
        return { data: { ok: true, result: { messages: [] }, error: null } };
      case 'dm-inbox':
        return { data: { ok: true, result: { threads: [] }, error: null } };
      default:
        return { data: { ok: true, result: null, error: null } };
    }
  });
}

beforeEach(() => {
  lensRunMock.mockReset();
  apiGetMock.mockReset();
  runDomainMock.mockReset();
  installLensRun();
});

describe('FactionWarIntel honesty (F2)', () => {
  it('renders only named wars, reports the unnamed entries, saves only named wars', async () => {
    apiGetMock.mockResolvedValue({
      data: {
        wars: [
          { id: 'w1', aggressorFaction: 'Crimson', defenderFaction: 'Azure', phase: 'open', momentum: 0.4 },
          { id: 'w2', aggressorFaction: 'Verdant', defenderFaction: 'Onyx', phase: 'open', momentum: 0.1 },
          { id: 'w3' }, { id: 'w4' }, { id: 'w5' },
        ],
      },
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><FactionWarIntel /></QueryClientProvider>);

    expect(await screen.findByText('Crimson')).toBeInTheDocument();
    expect(screen.getByText('Verdant')).toBeInTheDocument();
    expect(screen.getByText(/without faction data/)).toBeInTheDocument();
    expect(screen.getByText('/api/faction-war/active')).toBeInTheDocument();
    expect(screen.queryByText(/· live/)).not.toBeInTheDocument();
    const save = screen.getByTestId('save-dtu');
    expect(save.getAttribute('data-title')).toBe('Active faction wars — 2');
    expect(save.textContent).toContain('Crimson');
    expect(save.textContent).not.toContain('? → ?');
  });
});

describe('Alliance workspace lifecycle (F6/F7)', () => {
  it('labels the type combobox, explains invites, scopes and announces the delete', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><AllianceLens /></QueryClientProvider>);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('alliance', 'alliance-list', expect.anything()));

    fireEvent.click(await screen.findByLabelText('new alliance'));
    expect(await screen.findByText('Alliance type')).toBeInTheDocument();
    const nameInput = await screen.findByPlaceholderText(/Alliance name/i);
    fireEvent.change(nameInput, { target: { value: 'Fresh Pact' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));

    // Select the created alliance in the rail.
    const rail = (await screen.findAllByText('Fresh Pact'))[0];
    fireEvent.click(rail);
    fireEvent.click(await screen.findByRole('button', { name: /Members/i }));

    expect(await screen.findByText(/Invite by @username or the name shown on their profile/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete alliance' }));
    expect(await screen.findByText(/Deletes its 1 channel, all messages and 0 proposals\./)).toBeInTheDocument();
    // The armed confirm button's accessible name is `${ariaLabel} confirm` (visible label: Confirm delete).
    fireEvent.click(screen.getByRole('button', { name: 'Delete alliance confirm' }));
    expect(await screen.findByText(/Fresh Pact deleted — its channels, messages and proposals are gone\./)).toBeInTheDocument();
  });
});

describe('Alliance analytics disclosure (F4/F5)', () => {
  it('compatibility shows strength similarity and the formula; risk states its basis', async () => {
    runDomainMock.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'compatibilityScore') {
        return { data: { ok: true, result: {
          partnerA: 'A', partnerB: 'B', compositeScore: 47.5, compatibilityLevel: 'moderate',
          componentScores: { capabilitySimilarity: 50, valuesAlignment: 33.33, resourceSimilarity: 50, strengthSimilarity: 0, complementarity: 66.67 },
          overlap: { capabilities: [], values: [], resources: [] },
          uniqueContributions: {},
          weights: { capabilities: 0.3, values: 0.35, resources: 0.15, complementarity: 0.2 },
          formula: 'composite = (0.3 × capabilitySimilarity + 0.35 × valuesAlignment + 0.15 × resourceSimilarity + 0.2 × complementarity) / 1; each similarity is the Jaccard index; complementarity = mean(resource complementarity, strength complementarity)',
        } } };
      }
      if (action === 'riskAssessment') {
        return { data: { ok: true, result: {
          overallRiskScore: 42, riskLevel: 'moderate', hhi: 5200, hhiClassification: 'highly concentrated', diversificationIndex: 48,
          concentrationRisks: [
            { partnerName: 'Big', dependencyPct: 60, normalizedPct: 60, isConcentrated: true },
            { partnerName: 'Small', dependencyPct: 40, normalizedPct: 40, isConcentrated: true },
          ],
          concentrationThreshold: 30,
          concentrationBasis: 'a partner is concentrated when its share of total dependency is at least 30%',
          singlePointsOfFailure: [],
          summary: { concentratedPartners: 2, singleSourceCategories: 0, criticalSPOF: 0, totalCategories: 2 },
        } } };
      }
      return { data: { ok: true, result: null } };
    });

    render(<AllianceAnalyticsPanel />);
    const nameInputs = screen.getAllByPlaceholderText(/name \*/i);
    fireEvent.change(nameInputs[0], { target: { value: 'A' } });
    fireEvent.change(nameInputs[1], { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: /Score compatibility/i }));
    // the score card label and the formula prose both mention it
    expect((await screen.findAllByText(/strength\s*similarity/i)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/How this score is computed:/)).toBeInTheDocument();
    expect(screen.getByText(/Weights — capabilities 0\.3, values 0\.35/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Risk/i }));
    const partnerInput = await screen.findByPlaceholderText(/Partner name/i);
    fireEvent.change(partnerInput, { target: { value: 'Big' } });
    fireEvent.change(screen.getByPlaceholderText(/Dependency %/i), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Assess risk/i }));
    expect(await screen.findByText(/Concentrated means: a partner is concentrated when its share of total dependency is at least 30%\./)).toBeInTheDocument();
    expect(screen.getByText('Share of total')).toBeInTheDocument();
  });
});
