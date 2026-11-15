// CB-0438 cluster 5 — sticky confirms on the remaining claimed
// surfaces: sync-004 (device revoke) · timeline-006 (the timeline
// lens's own PostCard; /lenses/feed rides the shared panel, pinned in
// delete-confirm-pins) · social-018 (DM take back / remove for me) ·
// world-creator-006 (inspector entity delete + faction remove) ·
// realestate-009 (ListingsBrowser: the homegrown two-step named
// nothing and had no Cancel — the shared sticky confirm names the
// listing and cancels).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

const lensRunMock = vi.fn();
const apiGet = vi.fn(async () => ({ data: { requests: [] } }));
const apiPost = vi.fn(async () => ({ data: { ok: true } }));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a), delete: vi.fn(async () => ({ data: {} })) },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/world-creator/SceneCanvas', () => ({
  SceneCanvas: (props: { onSelect: (kind: string, id: string) => void }) => (
    <button type="button" onClick={() => props.onSelect('prop', 'prop1')}>pick-prop</button>
  ),
}));
vi.mock('@/components/world-creator/BiomePreview', () => ({ BiomePreview: () => null }));

import { SyncDashboard } from '@/components/sync/SyncDashboard';
import { PostCard } from '@/components/timeline/PostCard';
import { DMInbox } from '@/components/social/feed/DMInbox';
import { DraftEditor } from '@/components/world-creator/DraftEditor';
import { ListingsBrowser } from '@/components/realestate/ListingsBrowser';

type Call = { domain?: string; action?: string; input?: Record<string, unknown> };
const norm = (c: unknown[]): Call => {
  const a = c as [unknown, unknown, unknown];
  if (typeof a[0] === 'object' && a[0] !== null) return a[0] as Call;
  return { domain: a[0] as string, action: a[1] as string, input: a[2] as Record<string, unknown> };
};
const calls = () => lensRunMock.mock.calls.map(norm);
const sent = (action: string) => calls().find((c) => c.action === action);
const withQc = (ui: ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{ui}</QueryClientProvider>
);

const DEVICE = {
  id: 'dev_abc123', label: 'MacBook Pro', autoSync: true, online: true,
  lastSeenAt: Date.now(), lastSyncAt: null, lastSyncStatus: 'never',
  scopes: ['personal'], quotaBytes: 50 * 1024 ** 3, usedBytes: 0, quotaPct: 0,
  dtusSynced: 0, revoked: false,
};
const DRAFT = {
  id: 'd1', name: 'Ember Realm', description: '', universeType: 'fantasy', template: null,
  biome: 'forest', rules: {}, props: [{ id: 'prop1', kind: 'tree', x: 0, z: 0, rotation: 0, scale: 1 }],
  spawnPoints: [], zones: [], npcs: [],
  factions: [{ id: 'f1', name: 'Ember Court', ethos: 'bold', color: '#f00', stance: 'war' }],
  terrain: { seed: 1, roughness: 0.5, waterLevel: 0.2 }, visibility: 'private', publishedWorldId: null,
};
const LISTING = {
  id: 'lst-1', address: '12 Main St', city: 'Poughkeepsie', state: 'NY', zip: '12601',
  price: 350000, beds: 3, baths: 2, sqft: 1500, yearBuilt: 1990,
  kind: 'single_family' as const, status: 'for_sale' as const, daysOnMarket: 4,
};

beforeEach(() => {
  lensRunMock.mockReset();
  apiPost.mockClear();
  lensRunMock.mockImplementation(async (...a: unknown[]) => {
    const { action } = norm(a);
    switch (action) {
      case 'list_devices': return { data: { ok: true, result: { devices: [DEVICE], count: 1 } } };
      case 'sync_status': return { data: { ok: true, result: { deviceCount: 1, onlineCount: 1, lastSyncAt: null, dtusSynced: 0, usedBytes: 0, quotaBytes: DEVICE.quotaBytes, quotaPct: 0, openConflicts: 0, state: 'online' } } };
      case 'list_conflicts': return { data: { ok: true, result: { conflicts: [], open: 0, resolved: 0 } } };
      case 'sync_history': return { data: { ok: true, result: { entries: [], timeline: [], total: 0 } } };
      case 'available_scopes': return { data: { ok: true, result: { scopes: [] } } };
      case 'inbox': return { data: { ok: true, result: { threads: [{ threadKey: 'k1', with: 'u2', withName: 'Bo', lastMessage: { id: 'm1', from: 'me', body: 'hi', createdAt: '2026-11-10T00:00:00Z' }, messageCount: 1, unread: 0 }] } } };
      case 'conversation': return { data: { ok: true, result: { messages: [{ id: 'm1', from: 'me', body: 'hi there', createdAt: '2026-11-10T00:00:00Z', readBy: ['u2'] }], threadKey: 'k1', with: 'u2', withName: 'Bo' } } };
      case 'draft-get': return { data: { ok: true, result: { draft: DRAFT } } };
      case 'biomes': return { data: { ok: true, result: { biomes: [] } } };
      case 'listings-list': return { data: { ok: true, result: { listings: [LISTING] } } };
      case 'favourites-list': return { data: { ok: true, result: { ids: [] } } };
      default: return { data: { ok: true, result: {} } };
    }
  });
});
afterEach(() => cleanup());

describe('CB-0438 cluster 5 — sticky delete confirms', () => {
  it('sync-004: device revoke arms first; confirm revokes the device', async () => {
    render(<SyncDashboard />);
    const arm = await screen.findByRole('button', { name: 'Revoke device MacBook Pro' });
    fireEvent.click(arm);
    expect(sent('revoke_device')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke device MacBook Pro' }));
    await waitFor(() => expect(sent('revoke_device')?.input).toMatchObject({ deviceId: 'dev_abc123' }));
  });

  it('timeline-006: PostCard delete arms first; confirm deletes the post', async () => {
    const post = {
      id: 'p-1', authorId: 'me', authorDisplayName: 'Me', content: 'hello world',
      media: [], privacy: 'public' as const, taggedUserIds: [], sharedFrom: null,
      createdAt: '2026-11-10T00:00:00Z',
    };
    render(withQc(<PostCard post={post as never} viewerId="me" />));
    fireEvent.click(screen.getByRole('button', { name: 'Delete post' }));
    expect(sent('post-delete')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete post' }));
    await waitFor(() => expect(sent('post-delete')?.input).toMatchObject({ postId: 'p-1' }));
  });

  it('social-018: DM take back and remove-for-me arm first; confirm sends each', async () => {
    render(<DMInbox currentUserId="me" />);
    fireEvent.click(await screen.findByText('Bo'));
    const takeBack = await screen.findByRole('button', { name: 'Take back message' });
    fireEvent.click(takeBack);
    expect(apiPost.mock.calls.some((c) => String(c[0]).includes('recall'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm take back message' }));
    await waitFor(() => expect(apiPost.mock.calls.some((c) => String(c[0]).includes('/dm/recall') && (c[1] as { messageId?: string })?.messageId === 'm1')).toBe(true));

    const removeForMe = await screen.findByRole('button', { name: 'Remove message for me' });
    fireEvent.click(removeForMe);
    expect(apiPost.mock.calls.some((c) => String(c[0]).includes('hide'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove message for me' }));
    await waitFor(() => expect(apiPost.mock.calls.some((c) => String(c[0]).includes('/dm/hide'))).toBe(true));
  });

  it('world-creator-006: faction remove arms first; confirm removes the faction', async () => {
    render(<DraftEditor draftId="d1" onClose={vi.fn()} />);
    const arm = await screen.findByRole('button', { name: 'Remove faction Ember Court' });
    fireEvent.click(arm);
    expect(sent('faction-remove')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove faction Ember Court' }));
    await waitFor(() => expect(sent('faction-remove')?.input).toMatchObject({ draftId: 'd1', factionId: 'f1' }));
  });

  it('world-creator-006: inspector entity delete arms first; confirm removes the prop', async () => {
    render(<DraftEditor draftId="d1" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('pick-prop'));
    const arm = await screen.findByRole('button', { name: 'Delete selected prop' });
    fireEvent.click(arm);
    expect(sent('prop-remove')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete selected prop' }));
    await waitFor(() => expect(sent('prop-remove')?.input).toMatchObject({ draftId: 'd1', propId: 'prop1' }));
  });

  it('realestate-009: the confirm names the listing and Cancel disarms without deleting', async () => {
    render(<ListingsBrowser />);
    const arm = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(arm);
    expect(sent('listings-delete')).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Confirm delete' }).textContent).toContain('12 Main St');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel delete' }));
    expect(sent('listings-delete')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(sent('listings-delete')?.input).toMatchObject({ id: 'lst-1' }));
  });
});
