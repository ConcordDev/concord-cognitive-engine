// CB-0500 — counts that lie, cluster A behaviour pins.
//
// mesh-011: MeshRepos rendered its Repos / Total stars stats from
// `repos.data?.items || []` with no placeholderData — every topic
// switch dropped data to undefined and the stats flashed a definitive
// 0 for the whole GitHub fetch. Pin: while a switch fetch is in
// flight the previous topic's real counts stay on screen (and the
// first-ever load shows '—', never 0).
//
// event-timeline-005: FirehosePanel rendered '{n} events' and the
// 'No events yet…' empty copy from first paint, before the first feed
// fetch settled. Pin: a loading state renders instead; the count and
// the empty copy appear only after the first fetch resolves.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lensRun } from '@/lib/api/client';
import { MeshRepos } from '@/components/mesh/MeshRepos';
import { FirehosePanel } from '@/components/event-timeline/FirehosePanel';

vi.mock('@/lib/api/client', () => ({ lensRun: vi.fn() }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/event-timeline/ChannelTrends', () => ({ ChannelTrends: () => null }));
vi.mock('@/components/event-timeline/EventDetailPanel', () => ({ EventDetailPanel: () => null }));
vi.mock('@/components/event-timeline/SavedViewsBar', () => ({ SavedViewsBar: () => null }));

const run = vi.mocked(lensRun);

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const repo = (id: number, name: string, stars: number) => ({
  id, full_name: name, html_url: `https://github.com/${name}`,
  stargazers_count: stars, forks_count: 1,
});
const okRepos = (items: ReturnType<typeof repo>[]) => ({
  data: { ok: true, result: { items, stale: false, fetchedAt: null } },
});

describe('mesh-011 — MeshRepos counts never flash 0', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('keeps the previous topic counts on screen while the next topic loads', async () => {
    const dA = deferred<ReturnType<typeof okRepos>>();
    const dB = deferred<ReturnType<typeof okRepos>>();
    run.mockImplementation((_d: string, _n: string, input?: { topic?: string }) =>
      (input?.topic === 'p2p' ? dB.promise : dA.promise) as never);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MeshRepos /></QueryClientProvider>);

    // First load in flight: stats show the pending mark, never a 0.
    expect(screen.queryByText('0')).toBeNull();

    // The stat boxes' textContent is label+value ('Repos3'); row meta
    // text would collide with bare-number queries.
    const stat = (label: string, value: string) =>
      screen.findByText((_, el) => el?.textContent === `${label}${value}`);

    dA.resolve(okRepos([repo(1, 'a/one', 5), repo(2, 'a/two', 5), repo(3, 'a/three', 5)]));
    expect(await stat('Repos', '3')).toBeTruthy();
    expect(await stat('Total stars', '15')).toBeTruthy();

    // Switch topics: the fetch is in flight, the previous real counts
    // stay — no 0 flash — and the refresh is visibly in progress.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p2p' } });
    expect(screen.getByText('Repos').parentElement?.textContent).toBe('Repos3');
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByText(/Pulling/)).toBeTruthy();

    dB.resolve(okRepos([repo(9, 'b/only', 7)]));
    expect(await stat('Repos', '1')).toBeTruthy();
    expect(await stat('Total stars', '7')).toBeTruthy();
  });
});

describe('event-timeline-005 — Firehose never flashes 0 events', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows a loading state until the first feed fetch settles', async () => {
    const dRecent = deferred<{ data: { result: { ok: boolean; rows: unknown[] } } }>();
    run.mockImplementation((_d: string, name: string) => {
      if (name === 'recent') return dRecent.promise as never;
      return Promise.resolve({ data: { result: { ok: true, channels: [] } } }) as never;
    });

    render(<FirehosePanel />);

    expect(screen.getByText('Loading events…')).toBeTruthy();
    expect(screen.queryByText('0 events')).toBeNull();
    expect(screen.queryByText(/No events yet/)).toBeNull();

    const row = (id: number) => ({
      id, channel: 'combat:hit', world_id: null, actor_kind: 'agent',
      actor_id: 'a1', payload: { summary: 'Hit landed' }, created_at: 1700000000 + id,
    });
    dRecent.resolve({ data: { result: { ok: true, rows: [row(1), row(2)] } } });

    expect(await screen.findByText('2 events')).toBeTruthy();
    expect((await screen.findAllByText('Hit landed')).length).toBe(2);
  });
});
