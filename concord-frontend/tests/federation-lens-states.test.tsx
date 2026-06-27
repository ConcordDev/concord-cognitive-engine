/**
 * /lenses/federation — four-UX-state contract (peer-manager surface).
 *
 * Pins that the Federation lens renders genuine loading / error (with a working
 * Retry) / empty / populated states against the real backend channel
 * (fetch('/api/federation/status' | '/instances' | '/peers'), which
 * server/routes/federation.js answers), plus a11y (loading is role=status,
 * error is role=alert with a working Retry, the tab controls are real buttons).
 *
 * No fabricated data: every state is driven by a mocked global fetch standing
 * in for the real node, returning exactly the { ok, enabled, federation } /
 * { peers } shapes the routes return. The headless LensShell + the panel
 * children (which do their own lensRun fetching) are stubbed so the test stays
 * on the page's own status-strip state machine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act, within } from '@testing-library/react';
import React from 'react';

// ── headless shell + lens chrome: render-only stubs ─────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));

// Panel children fetch via lensRun themselves — stub inert so the test is
// scoped to the page's status-strip + peers state machine.
vi.mock('@/components/federation/FediverseFeed', () => ({ FediverseFeed: () => null }));
vi.mock('@/components/federation/PeerPolicyPanel', () => ({ PeerPolicyPanel: () => null }));
vi.mock('@/components/federation/ModerationQueuePanel', () => ({ ModerationQueuePanel: () => null }));
vi.mock('@/components/federation/SyncPolicyPanel', () => ({ SyncPolicyPanel: () => null }));
vi.mock('@/components/federation/RelayPanel', () => ({ RelayPanel: () => null }));
vi.mock('@/components/federation/TrustHistoryPanel', () => ({ TrustHistoryPanel: () => null }));
vi.mock('@/components/federation/MetricsDashboardPanel', () => ({ MetricsDashboardPanel: () => null }));
vi.mock('@/components/federation/ActorKeysPanel', () => ({ ActorKeysPanel: () => null }));
vi.mock('@/components/federation/TrustGraphView', () => ({ default: () => null }));

// next/dynamic → resolve to a render-only stub synchronously.
vi.mock('next/dynamic', () => ({ default: () => () => null }));

// lens-artifact hooks used by the Sync / PeerManager tabs.
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useArtifacts: () => ({ data: { artifacts: [] }, isLoading: false }),
  useCreateArtifact: () => ({ mutate: () => {} }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

// Import AFTER mocks are registered.
import FederationPage from '@/app/lenses/federation/page';

// ── fetch stub helpers ──────────────────────────────────────────────────────
function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

// Route the three startup endpoints to the supplied bodies; everything else
// (search/sync/probe POSTs) resolves to an empty ok.
function installFetch(routes: Record<string, unknown | null>) {
  const fn = vi.fn((url: RequestInfo | URL) => {
    const u = String(url);
    for (const [frag, body] of Object.entries(routes)) {
      if (u.includes(frag)) {
        if (body === null) return Promise.reject(new Error('network down'));
        return jsonResponse(body);
      }
    }
    return jsonResponse({ ok: true });
  });
  // @ts-expect-error test global
  global.fetch = fn;
  return fn;
}

const STATUS_OK = {
  ok: true,
  enabled: true,
  federation: { instanceId: 'node-alpha', name: 'Alpha', trustedCount: 2, pendingPosts: 0, capabilities: ['dtu', 'trust'] },
};

const PEER = {
  instanceId: 'peer-beta', name: 'Beta Node', status: 'active',
  registryUrl: 'https://beta.example', lastSeen: 1735689600000,
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('federation lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the startup fetch is in flight', async () => {
    // status never resolves → page stays in initial loading.
    installFetch({ '/api/federation/status': new Promise(() => {}) as unknown });
    // Override the status route specifically with a never-resolving promise.
    // @ts-expect-error test global
    global.fetch = vi.fn((url: RequestInfo | URL) => {
      if (String(url).includes('/status')) return new Promise<Response>(() => {});
      return jsonResponse({ ok: true });
    });
    const { getByRole, getByText } = render(<FederationPage />);
    await waitFor(() => expect(getByRole('status')).toBeInTheDocument());
    expect(getByText(/Loading federation status/i)).toBeInTheDocument();
  });

  it('EMPTY: shows the honest "No peers yet" CTA when no peers are returned', async () => {
    installFetch({
      '/api/federation/status': { ...STATUS_OK, federation: { ...STATUS_OK.federation, trustedCount: 0 } },
      '/api/federation/instances': { peers: [] },
      '/api/federation/peers': { peers: [] },
    });
    const { getByText, getByRole } = render(<FederationPage />);
    // Default tab is Network; switch to Peers to see the empty peer list.
    await waitFor(() => expect(getByRole('button', { name: /Peers/i })).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByRole('button', { name: /Peers/i })); });
    await waitFor(() => expect(getByText(/No peers yet/i)).toBeInTheDocument());
  });

  it('ERROR: an unreachable status endpoint shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    // @ts-expect-error test global
    global.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/status')) {
        return fail ? jsonResponse(null) : jsonResponse(STATUS_OK);
      }
      if (u.includes('/instances') || u.includes('/peers')) return jsonResponse({ peers: fail ? [] : [PEER] });
      return jsonResponse({ ok: true });
    });
    const { getByText, container, queryByText } = render(<FederationPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/unreachable/i)).toBeInTheDocument();

    fail = false;
    const alert = container.querySelector('[role="alert"]') as HTMLElement;
    const retry = within(alert).getByRole('button', { name: /Try again/i });
    await act(async () => { fireEvent.click(retry); });
    // Error clears + the status strip (and its Peers stat) comes back.
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeFalsy());
    expect(queryByText(/unreachable/i)).toBeNull();
  });

  it('POPULATED: renders real peer rows + the live status strip', async () => {
    installFetch({
      '/api/federation/status': STATUS_OK,
      '/api/federation/instances': { peers: [PEER] },
      '/api/federation/peers': { peers: [] },
    });
    const { getByText, getByRole } = render(<FederationPage />);
    // Status strip shows the instance + the enabled state from the real body.
    await waitFor(() => expect(getByText(/Enabled/i)).toBeInTheDocument());
    // Switch to Peers and assert the real row from the macro/route body.
    await act(async () => { fireEvent.click(getByRole('button', { name: /Peers/i })); });
    await waitFor(() => expect(getByText('Beta Node')).toBeInTheDocument());
    expect(getByText('https://beta.example')).toBeInTheDocument();
  });

  it('a11y: the tab controls are real buttons with accessible text', async () => {
    installFetch({
      '/api/federation/status': STATUS_OK,
      '/api/federation/instances': { peers: [] },
      '/api/federation/peers': { peers: [] },
    });
    const { getByRole } = render(<FederationPage />);
    await waitFor(() => expect(getByRole('button', { name: /Network/i })).toBeInTheDocument());
    expect(getByRole('button', { name: /Defederation/i })).toBeInTheDocument();
    expect(getByRole('button', { name: /Actor keys/i })).toBeInTheDocument();
  });
});
