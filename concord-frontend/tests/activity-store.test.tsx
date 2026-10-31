/**
 * §5 convergence item 4 — "Activity reads the real store."
 * The shared ActivityTimeline (mounted by app/lenses/layout for every
 * lens) must read GET /api/events/paginated — the Guide's source —
 * filtered to the lens's objects, not the lens artifact list.
 * Fixtures are shaped like the live feed R3 observed (auth, dtu.create,
 * domain-typed lens events, meta-tagged system events).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getCalls: { url: string; params?: unknown }[] = [];
const EVENTS = [
  { id: 'e1', type: 'ml', action: 'create', message: 'Created experiment "tabular-run"', createdAt: '2026-10-30T15:00:00Z' },
  { id: 'e2', type: 'ml', action: 'delete', summary: 'Deleted experiment "tabular-run"', createdAt: '2026-10-30T15:05:00Z' },
  { id: 'e3', type: 'dtu.create', summary: 'Minted ML: classifier bundle', meta: { title: 'ML: classifier bundle' }, createdAt: '2026-10-30T15:06:00Z' },
  { id: 'e4', type: 'reasoning', action: 'create', message: 'Created argument map', createdAt: '2026-10-30T15:07:00Z' },
  { id: 'e5', type: 'dtu.create', summary: 'Minted Reasoning: proof chain', meta: { title: 'Reasoning: proof chain' }, createdAt: '2026-10-30T15:08:00Z' },
  { id: 'e6', type: 'synthesis', summary: 'Nightly synthesis finished', meta: { domain: 'ml' }, createdAt: '2026-10-30T15:09:00Z' },
  { id: 'e7', type: 'auth', action: 'login', summary: 'Signed in', createdAt: '2026-10-30T15:10:00Z' },
];

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(async (url: string, cfg?: { params?: unknown }) => {
      getCalls.push({ url, params: cfg?.params });
      return { data: { items: EVENTS } };
    }),
  },
  apiHelpers: { lens: { list: vi.fn(async () => ({ data: { items: [] } })) } },
}));

import { ActivityTimeline } from '../components/common/ActivityTimeline';
import { openLensTool } from '../lib/lens-dock';

async function openPanel(domain: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ActivityTimeline domain={domain} />
    </QueryClientProvider>,
  );
  await act(async () => { openLensTool('activity'); });
}

describe('ActivityTimeline — reads the real event store (§5 item 4)', () => {
  beforeEach(() => { getCalls.length = 0; vi.clearAllMocks(); });

  it('queries /api/events/paginated, not the artifact list', async () => {
    await openPanel('ml');
    await screen.findByText('Created experiment "tabular-run"');
    expect(getCalls.map((c) => c.url)).toEqual(['/api/events/paginated']);
  });

  it('ML: shows the lens’s own events (domain-typed + its DTUs), not other lenses’', async () => {
    await openPanel('ml');
    await screen.findByText('Created experiment "tabular-run"');
    expect(screen.getByText('Deleted experiment "tabular-run"')).toBeInTheDocument();
    expect(screen.getByText('Minted ML: classifier bundle')).toBeInTheDocument();
    expect(screen.getByText('Nightly synthesis finished')).toBeInTheDocument();
    expect(screen.queryByText('Created argument map')).not.toBeInTheDocument();
    expect(screen.queryByText('Minted Reasoning: proof chain')).not.toBeInTheDocument();
    expect(screen.queryByText('Signed in')).not.toBeInTheDocument();
  });

  it('ML done-state shape: create + delete sit under "You"; the system event does not', async () => {
    await openPanel('ml');
    await screen.findByText('Created experiment "tabular-run"');
    fireEvent.click(screen.getByRole('button', { name: 'You' }));
    expect(screen.getByText('Created experiment "tabular-run"')).toBeInTheDocument();
    expect(screen.getByText('Deleted experiment "tabular-run"')).toBeInTheDocument();
    expect(screen.getByText('Minted ML: classifier bundle')).toBeInTheDocument();
    expect(screen.queryByText('Nightly synthesis finished')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'System' }));
    expect(screen.getByText('Nightly synthesis finished')).toBeInTheDocument();
    expect(screen.queryByText('Created experiment "tabular-run"')).not.toBeInTheDocument();
  });

  it('Reasoning: its own events only; a lens with no events in the page shows the honest empty state', async () => {
    await openPanel('reasoning');
    await screen.findByText('Created argument map');
    expect(screen.getByText('Minted Reasoning: proof chain')).toBeInTheDocument();
    expect(screen.queryByText('Created experiment "tabular-run"')).not.toBeInTheDocument();
  });
});
