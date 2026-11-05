// concord-frontend/tests/bridge-build.test.tsx
//
// Bridge full lens build (B2) — pins:
//   F1  BridgeActionsPanel runs the four actions via lensRun against the
//       console's own state — enabled when a peer is registered, with no
//       "connection artifact" anywhere; disabled with an honest notice
//       when no peer exists
//   F3  ConcordLinkWalkers scopes its walkers query to the entered world
//       (?homeWorld=) and shows the Anchors-form empty state
//   F4  the alert rule card renders "Error rate ≥ 25%" (unit after value)
//   F5  peer / rule deletes are two-step (arm, then Confirm) — one click
//       destroys nothing
//   F2  a recorded flow can be deleted from its row (two-step), calling
//       the new flowRemove verb
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BridgeActionsPanel } from '@/components/bridge/BridgeActionsPanel';
import { ConcordLinkWalkers } from '@/components/bridge/ConcordLinkWalkers';
import { FederationConsole } from '@/components/bridge/FederationConsole';
import { lensRun, api } from '@/lib/api/client';

vi.mock('@/lib/api/client', () => ({ lensRun: vi.fn(), api: { get: vi.fn() } }));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));
vi.mock('framer-motion', () => ({
  motion: { div: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> },
}));

const lensRunMock = vi.mocked(lensRun);
const apiGetMock = vi.mocked(api.get);

const PEER = { id: 'peer1', name: 'Peer A', kind: 'world', endpoint: '', region: 'concordia-hub', createdAt: '2026-11-01T00:00:00Z', enabled: true };
const FLOW_OK = { id: 'flow1', peerId: 'peer1', peerName: 'Peer A', action: 'sync', status: 'succeeded', records: 1000, durationMs: 1000, rps: 1000, error: null, attempts: 1, at: '2026-11-01T00:00:00Z' };
const FLOW_BAD = { id: 'flow2', peerId: 'peer1', peerName: 'Peer A', action: 'sync', status: 'failed', records: 500, durationMs: 2000, rps: 250, error: 'sync error', attempts: 1, at: '2026-11-01T00:01:00Z' };
const RULE = { id: 'rule1', metric: 'error-rate', threshold: 25, peerId: null, enabled: true, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' };

let withPeer = true;
function installLensRun() {
  lensRunMock.mockImplementation(async (_domain: string, verb: string) => {
    const ok = (result: unknown) => ({ data: { ok: true, result } });
    switch (verb) {
      case 'peerList': return ok({ peers: withPeer ? [PEER] : [], total: withPeer ? 1 : 0 });
      case 'flowList': return ok({ flows: [FLOW_OK, FLOW_BAD], total: 2, failed: 1, succeeded: 1 });
      case 'alertRuleList': return ok({ rules: [RULE], total: 1 });
      case 'connectionHealth': return ok({ overallHealth: 75, healthy: 1, degraded: 0, critical: 0, totalConnections: 1, connections: [{ name: 'Peer A', status: 'degraded', latencyMs: 1500, uptimePercent: 50, errorRate: 0.5, healthScore: 55 }] });
      case 'syncTopology': return ok({ nodes: [], edges: [], peerCount: 1, edgeCount: 0, unhealthy: 0 });
      case 'mappingList': return ok({ mappings: [], transforms: [] });
      case 'scheduleList': return ok({ schedules: [], total: 0, active: 0 });
      case 'throughputHistory': return ok({ buckets: [], samples: 0, avgRPS: 0, peakRPS: 0 });
      default: return ok({});
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  withPeer = true;
  installLensRun();
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('Bridge build', () => {
  it('F1: actions are enabled by a registered peer and run via lensRun', async () => {
    wrap(<BridgeActionsPanel />);
    const btn = await screen.findByRole('button', { name: /Connection Health/ });
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(screen.queryByText(/No bridge connection artifact found/)).toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('bridge', 'connectionHealth', {}));
    expect(await screen.findByText('Overall Health Score')).toBeTruthy();
  });

  it('F1: with no peer the actions stay disabled behind an honest notice', async () => {
    withPeer = false;
    installLensRun();
    wrap(<BridgeActionsPanel />);
    expect(await screen.findByText(/No federation peers yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Connection Health/ })).toBeDisabled();
  });

  it('F3: walkers are fetched for the entered world and rescope with it', async () => {
    apiGetMock.mockImplementation(async (url: string) => {
      if (url.includes('anchors')) return { data: { anchors: [] } };
      if (url.includes('homeWorld=concordia-hub')) {
        return { data: { walkers: [{ id: 'w1', name: 'Hub Walker', home_world: 'concordia-hub', current_world: 'concordia-hub', status: 'available', reputation: 5 }] } };
      }
      return { data: { walkers: [] } };
    });
    wrap(<ConcordLinkWalkers />);
    expect(await screen.findByText('Hub Walker')).toBeTruthy();
    expect(apiGetMock).toHaveBeenCalledWith(expect.stringContaining('/api/concord-link/walkers?homeWorld=concordia-hub'));
    const input = screen.getByPlaceholderText(/world id/);
    fireEvent.change(input, { target: { value: 'nonexistent-world-xyz' } });
    expect(await screen.findByText('No walkers in this world.')).toBeTruthy();
    expect(screen.queryByText('Hub Walker')).toBeNull();
  });

  it('F4 + F5: the rule card reads "Error rate ≥ 25%" and its delete is two-step', async () => {
    wrap(<FederationConsole />);
    fireEvent.click(await screen.findByRole('button', { name: /Alerts/ }));
    expect(await screen.findByText('Error rate ≥')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.queryByText(/≥ %/)).toBeNull();
    // Two "Delete" buttons exist here (the peer chip's and the rule's);
    // the rule row's is the second.
    fireEvent.click(screen.getAllByLabelText('Delete')[1]);
    expect(await screen.findByText('Delete rule?')).toBeTruthy();
    expect(lensRunMock).not.toHaveBeenCalledWith('bridge', 'alertRuleRemove', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('bridge', 'alertRuleRemove', { ruleId: 'rule1' }));
  });

  it('F5: deleting a peer takes two steps and names the flow cascade', async () => {
    wrap(<FederationConsole />);
    await screen.findByText('Peer A');
    fireEvent.click(screen.getByLabelText('Delete'));
    expect(await screen.findByText(/Delete Peer A and its recorded flows\?/)).toBeTruthy();
    expect(lensRunMock).not.toHaveBeenCalledWith('bridge', 'peerRemove', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('bridge', 'peerRemove', { peerId: 'peer1' }));
  });

  it('F2: a recorded flow can be deleted from its row via flowRemove', async () => {
    wrap(<FederationConsole />);
    fireEvent.click(await screen.findByRole('button', { name: /Flows/ }));
    await screen.findByText('1000 rec · 1000 rps');
    const deleteButtons = screen.getAllByLabelText('Delete flow');
    fireEvent.click(deleteButtons[0]);
    expect(await screen.findByText('Delete flow?')).toBeTruthy();
    expect(lensRunMock).not.toHaveBeenCalledWith('bridge', 'flowRemove', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('bridge', 'flowRemove', { flowId: expect.any(String) }));
  });
});
