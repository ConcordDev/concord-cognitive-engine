/**
 * FIX-bridge-002 + FIX-bridge-003 (audit sweep CB-0447, cluster B) —
 * peers and mappings gain an edit control; opened frontier links gain
 * a delete. Pins the FE contracts:
 *  - a peer chip's Edit loads the peer into the register form; Save
 *    Peer fires peerUpdate with the peer's id (never peerRegister);
 *  - a mapping row's Edit loads the mapping into the editor; Save
 *    Changes fires mappingUpsert WITH the mappingId, so the row is
 *    updated in place;
 *  - a frontier board row's delete is a sticky confirm naming the
 *    link; arming fires nothing, the confirm fires link-delete.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/components/concord-link-frontier/CrossWorldFeed', () => ({ CrossWorldFeed: () => null }));

import { FederationConsole } from '@/components/bridge/FederationConsole';
import ConcordLinkFrontierPage from '@/app/lenses/concord-link-frontier/page';

function calls(action: string) {
  return lensRun.mock.calls.filter((c) => c[1] === action);
}

const PEER = { id: 'peer1', name: 'Alpha', kind: 'world', region: 'concordia-hub', endpoint: '', createdAt: '2026-11-01T00:00:00.000Z', enabled: true };
const MAPPING = { id: 'map1', source: 'first_name', target: 'firstName', transform: 'direct', dataType: 'string', required: false, peerId: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation(async (_domain: string, action: string) => {
    switch (action) {
      case 'peerList': return { data: { ok: true, result: { peers: [PEER], total: 1 } } };
      case 'syncTopology': return { data: { ok: true, result: { nodes: [], edges: [], peerCount: 1, edgeCount: 0, unhealthy: 0 } } };
      case 'mappingList': return { data: { ok: true, result: { mappings: [MAPPING], transforms: ['direct'] } } };
      case 'link-list': return { data: { ok: true, result: { links: [{ id: 'lk1', name: 'North gate' }], count: 1 } } };
      case 'link-detail': return { data: { ok: true, result: { link: { id: 'lk1', name: 'North gate', bearing: '', mark: null } } } };
      default: return { data: { ok: true, result: {} } };
    }
  });
});

describe('bridge edit controls (FIX-bridge-002)', () => {
  it('peer Edit loads the form and Save Peer fires peerUpdate with the peer id', async () => {
    render(<FederationConsole />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Alpha' }));
    const nameInput = screen.getByPlaceholderText('Peer name') as HTMLInputElement;
    expect(nameInput.value).toBe('Alpha');
    fireEvent.change(screen.getByPlaceholderText('Region'), { target: { value: 'eu-west' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Peer' }));
    await waitFor(() => expect(calls('peerUpdate')).toHaveLength(1));
    expect(calls('peerUpdate')[0][2]).toEqual({ peerId: 'peer1', name: 'Alpha', kind: 'world', region: 'eu-west', endpoint: '' });
    expect(calls('peerRegister')).toHaveLength(0);
  });

  it('mapping Edit loads the editor and Save Changes fires mappingUpsert with the mappingId', async () => {
    render(<FederationConsole />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mappings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit mapping first_name to firstName' }));
    const targetInput = screen.getByPlaceholderText('target field') as HTMLInputElement;
    expect(targetInput.value).toBe('firstName');
    fireEvent.change(targetInput, { target: { value: 'givenName' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(calls('mappingUpsert')).toHaveLength(1));
    expect(calls('mappingUpsert')[0][2]).toMatchObject({ mappingId: 'map1', source: 'first_name', target: 'givenName' });
  });
});

describe('frontier link delete (FIX-bridge-003)', () => {
  it('arming fires nothing; the confirm fires link-delete for the row', async () => {
    render(<ConcordLinkFrontierPage />);
    const arm = await screen.findByRole('button', { name: 'Delete link North gate' });
    fireEvent.click(arm);
    expect(calls('link-delete')).toHaveLength(0);
    const confirm = await screen.findByRole('button', { name: 'Confirm delete link North gate' });
    expect(confirm.textContent).toContain('Delete "North gate"?');
    fireEvent.click(confirm);
    await waitFor(() => expect(calls('link-delete')).toHaveLength(1));
    expect(calls('link-delete')[0][2]).toEqual({ id: 'lk1' });
  });
});
