/**
 * Study picker defaults to the viewer's own DTUs. A system DTU already in
 * the queue is labeled Shared library. Remove stays gone after reload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-me', username: 'ramaj', email: 'r@example.com', role: 'member' },
    isLoading: false,
    isAuthenticated: true,
    logout: async () => {},
    refresh: async () => {},
  }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { api } from '@/lib/api/client';
import SRSLensPage from '@/app/lenses/srs/page';

const MINE = {
  id: 'dtu-mine',
  title: 'My saved note',
  ownerId: 'user-me',
  isGlobal: false,
  domain: 'chat',
  content: 'remember this',
  summary: 'remember this',
  human: { summary: 'remember this' },
  tags: ['note'],
  timestamp: '2026-10-01T00:00:00.000Z',
  tier: 'regular',
  meta: {},
};

const SYSTEM = {
  id: 'dtu-system',
  title: 'Seeded lattice fact',
  ownerId: 'system',
  isGlobal: true,
  scope: 'global',
  domain: 'knowledge',
  content: 'a shared fact',
  summary: 'a shared fact',
  human: { summary: 'a shared fact' },
  tags: [],
  timestamp: '2026-01-01T00:00:00.000Z',
  tier: 'regular',
  meta: {},
};

const schedule = {
  interval: 1,
  easeFactor: 2.5,
  repetitions: 0,
  nextReview: '2020-01-01T00:00:00.000Z',
  history: [] as { quality: number; reviewedAt: string }[],
};

const queue: { cards: Array<{ dtu: typeof MINE | typeof SYSTEM; card: typeof schedule }> } = { cards: [] };

function renderStudy() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <SRSLensPage />
    </QueryClientProvider>
  );
  return render(ui);
}

beforeEach(() => {
  queue.cards = [];
  vi.spyOn(api, 'get').mockImplementation(async (url: string, opts?: { params?: { scope?: string } }) => {
    if (url === '/api/srs/due') {
      return { data: { ok: true, cards: queue.cards, total: queue.cards.length } };
    }
    if (url === '/api/dtus/paginated') {
      const items = opts?.params?.scope === 'mine' ? [MINE] : [MINE, SYSTEM];
      return { data: { ok: true, items, dtus: items, total: items.length, pagination: { total: items.length } } };
    }
    return { data: { ok: true, dtus: [], items: [], total: 0 } };
  });
  vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true, dtus: [], total: 0 } });
  vi.spyOn(api, 'delete').mockImplementation(async (url: string) => {
    const id = String(url).split('/').filter(Boolean).pop();
    queue.cards = queue.cards.filter((c) => c.dtu.id !== id);
    return { data: { ok: true, dtuId: id } };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('study review owner scope', () => {
  it('lists only my DTUs in the picker by default', async () => {
    renderStudy();
    fireEvent.click(await screen.findByRole('button', { name: 'Add to review' }));
    expect(await screen.findByText('My saved note')).toBeTruthy();
    expect(screen.queryByText('Seeded lattice fact')).toBeNull();
    expect(api.get).toHaveBeenCalledWith('/api/dtus/paginated', {
      params: { scope: 'mine', limit: 100, offset: 0 },
    });
  });

  it('labels a system DTU as the shared library and a saved note as yours', async () => {
    queue.cards = [{ dtu: SYSTEM, card: schedule }];
    const system = renderStudy();
    expect(await screen.findByText('Shared library')).toBeTruthy();
    expect(screen.queryByText(/note you saved/i)).toBeNull();
    expect(screen.queryByText(/your knowledge notes/i)).toBeNull();
    system.unmount();

    queue.cards = [{ dtu: MINE, card: schedule }];
    renderStudy();
    expect(await screen.findByText('Your note')).toBeTruthy();
    expect(screen.queryByText('Shared library')).toBeNull();
  });

  it('keeps a removed card out of the queue after reload', async () => {
    queue.cards = [{ dtu: MINE, card: schedule }];
    const first = renderStudy();
    expect(await screen.findByText('Your note')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove from review' }));
    await waitFor(() => expect(screen.getByText('Nothing is due.')).toBeTruthy());
    expect(api.delete).toHaveBeenCalledWith('/api/srs/dtu-mine');
    first.unmount();

    renderStudy();
    expect(await screen.findByText('Nothing is due.')).toBeTruthy();
    expect(screen.queryByText('My saved note')).toBeNull();
    expect(screen.queryByText('Your note')).toBeNull();
  });
});
