// CB-0492 Part A — unconfirmed-destructive genus (RCA-missing-delete-confirm),
// panel leg: FIX-goddess-007 (alert unsubscribe) · FIX-expert-mode-003
// (document source + Space deletes) · FIX-fitness-018 (challenge leave) ·
// FIX-offline-004 (local doc delete). Nothing destructive fires until the
// two-step confirm is pressed.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';

const h = vi.hoisted(() => ({ calls: [] as Array<{ domain: string; action: string; input: unknown }>, deletedDocs: [] as string[] }));

vi.mock('@/lib/api/client', () => ({
  lensRun: (a: unknown, b?: unknown, c?: unknown) => {
    const domain = typeof a === 'string' ? a : (a as { domain: string }).domain;
    const action = typeof a === 'string' ? (b as string) : (a as { action: string }).action;
    const input = typeof a === 'string' ? c : (a as { input: unknown }).input;
    h.calls.push({ domain, action, input });
    const ok = (result: unknown) => Promise.resolve({ ok: true, data: { ok: true, result } });
    if (domain === 'goddess' && action === 'subscriptions') {
      return ok({ subscriptions: [{ id: 's1', tone: 'wrath', worldId: 'w1', createdAt: '2026-11-01' }], count: 1, notifications: [], unseenCount: 0 });
    }
    if (domain === 'expert_mode' && action === 'space_list') {
      return ok({ spaces: [{ id: 'sp1', name: 'Research Space', description: '', answerCount: 2, shareToken: null }] });
    }
    if (domain === 'expert_mode' && action === 'upload_list') {
      return ok({ uploads: [{ id: 'u1', name: 'Field Notes', kind: 'text', chars: 1200, createdAt: 1 }] });
    }
    if (domain === 'offline') return Promise.resolve({ ok: true, data: { ok: true, result: null } });
    if (domain === 'fitness' && action === 'club-list') return ok({ clubs: [] });
    if (domain === 'fitness' && action === 'challenge-list') {
      return ok({
        challenges: [{
          id: 'c1', name: 'Morning Miles', metric: 'distance', target: 10,
          startDate: '2026-11-01', endDate: '2026-12-01', active: true, joined: true,
          participantCount: 3, myProgress: { value: 2, pct: 20, complete: false }, leaderboard: [],
        }],
      });
    }
    return ok({});
  },
}));
vi.mock('@/hooks/useSmartPolling', () => ({
  useSmartPolling: (cb: () => unknown) => { useEffect(() => { void cb(); }, []); },
}));
vi.mock('@/components/viz', () => ({ TimelineView: () => null }));
vi.mock('@/components/offline/local-store', () => ({
  allDocs: () => Promise.resolve([{ id: 'doc-1', body: { title: 'Field note' }, rev: 'r1', baseRev: null, updatedAt: '2026-11-12', dirty: false, deleted: false }]),
  dirtyDocs: () => Promise.resolve([]),
  putDoc: () => Promise.resolve(),
  deleteDocLocal: (id: string) => { h.deletedDocs.push(id); return Promise.resolve(); },
  markClean: () => Promise.resolve(),
  applyServerChange: () => Promise.resolve(),
  clearLocal: () => Promise.resolve(),
  localBytes: () => Promise.resolve(128),
  getDeviceId: () => Promise.resolve('dev-1'),
}));

import { ToneSubscriptions } from '@/components/goddess/ToneSubscriptions';
import { SpacesPanel } from '@/components/expert-mode/SpacesPanel';
import { UploadSourcePanel } from '@/components/expert-mode/UploadSourcePanel';
import { StravaClubsPanel } from '@/components/fitness/StravaClubsPanel';
import { ReplicationPanel } from '@/components/offline/ReplicationPanel';

afterEach(() => { cleanup(); h.calls.length = 0; h.deletedDocs.length = 0; });

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
const called = (action: string) => h.calls.some((c) => c.action === action);

describe('FIX-goddess-007 unsubscribe confirm', () => {
  it('unsubscribe fires only from the confirm step', async () => {
    wrap(<ToneSubscriptions worldId="w1" onOpenDispatch={() => {}} />);
    const arm = await screen.findByRole('button', { name: 'Unsubscribe from wrath' });
    fireEvent.click(arm);
    expect(called('unsubscribe')).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm unsubscribe from wrath' }));
    await waitFor(() => expect(called('unsubscribe')).toBe(true));
  });
});

describe('FIX-expert-mode-003 space + source delete confirms', () => {
  it('space delete fires only from the confirm step', async () => {
    wrap(<SpacesPanel pendingAnswer={null} onAddedPending={() => {}} reloadKey={0} />);
    const arm = await screen.findByRole('button', { name: 'Delete space' });
    fireEvent.click(arm);
    expect(called('space_delete')).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete space Research Space' }));
    await waitFor(() => expect(called('space_delete')).toBe(true));
  });

  it('source delete fires only from the confirm step', async () => {
    wrap(<UploadSourcePanel selectedId={null} onSelect={() => {}} />);
    const arm = await screen.findByRole('button', { name: 'Delete Field Notes' });
    fireEvent.click(arm);
    expect(called('upload_delete')).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete Field Notes' }));
    await waitFor(() => expect(called('upload_delete')).toBe(true));
  });
});

describe('FIX-fitness-018 challenge leave confirm', () => {
  it('leaving a challenge fires only from the confirm step', async () => {
    wrap(<StravaClubsPanel />);
    const arm = await screen.findByRole('button', { name: 'Leave challenge Morning Miles' });
    fireEvent.click(arm);
    expect(called('challenge-join')).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm leave challenge Morning Miles' }));
    await waitFor(() => expect(called('challenge-join')).toBe(true));
    const join = h.calls.find((c) => c.action === 'challenge-join');
    expect((join?.input as { leave?: boolean })?.leave).toBe(true);
  });
});

describe('FIX-offline-004 local doc delete confirm', () => {
  it('deleting a local doc fires only from the confirm step', async () => {
    wrap(<ReplicationPanel onConflicts={() => {}} />);
    const arm = await screen.findByRole('button', { name: 'Delete doc-1' });
    fireEvent.click(arm);
    expect(h.deletedDocs).toEqual([]);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete doc-1' }));
    await waitFor(() => expect(h.deletedDocs).toEqual(['doc-1']));
  });
});
