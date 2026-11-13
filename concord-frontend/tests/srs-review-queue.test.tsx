/**
 * Reviewing a due card must reveal the next one. Re-adding a card that is
 * already scheduled says when it comes back, and not-due items stay removable.
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

function note(id: string, title: string) {
  return {
    id,
    title,
    ownerId: 'user-me',
    isGlobal: false,
    domain: 'chat',
    content: title,
    summary: title,
    human: { summary: title },
    tags: ['note'],
    timestamp: '2026-10-01T00:00:00.000Z',
    tier: 'regular',
    meta: {},
  };
}

const schedule = {
  interval: 1,
  easeFactor: 2.5,
  repetitions: 0,
  nextReview: '2020-01-01T00:00:00.000Z',
  history: [] as { quality: number; reviewedAt: string }[],
};

const queue: { cards: Array<{ dtu: ReturnType<typeof note>; card: typeof schedule }> } = { cards: [] };
const waiting: { items: Array<{ dtuId: string; title: string; nextReview: string; due: boolean }> } = { items: [] };
let addResult: { ok: boolean; already?: boolean; nextReview?: string; error?: string } = { ok: true };

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
  waiting.items = [];
  addResult = { ok: true };
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/srs/due') {
      return { data: { ok: true, cards: queue.cards, total: queue.cards.length } };
    }
    if (url === '/api/srs/scheduled') {
      return { data: { ok: true, items: waiting.items, total: waiting.items.length } };
    }
    if (url === '/api/dtus/paginated') {
      const items = [note('dtu-mine', 'My saved note')];
      return { data: { ok: true, items, dtus: items, total: 1, pagination: { total: 1 } } };
    }
    return { data: { ok: true, items: [], total: 0 } };
  });
  vi.spyOn(api, 'post').mockImplementation(async (url: string) => {
    if (String(url).endsWith('/review')) {
      const id = String(url).split('/')[3];
      queue.cards = queue.cards.filter((c) => c.dtu.id !== id);
      return { data: { ok: true } };
    }
    if (String(url).endsWith('/add')) return { data: addResult };
    return { data: { ok: true } };
  });
  vi.spyOn(api, 'delete').mockImplementation(async (url: string) => {
    const id = String(url).split('/').filter(Boolean).pop();
    queue.cards = queue.cards.filter((c) => c.dtu.id !== id);
    waiting.items = waiting.items.filter((item) => item.dtuId !== id);
    return { data: { ok: true, dtuId: id } };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('study review queue', () => {
  it('shows the next due card after a rating instead of saying all caught up', async () => {
    queue.cards = [
      { dtu: note('card-a', 'Card A'), card: schedule },
      { dtu: note('card-b', 'Card B'), card: schedule },
    ];
    renderStudy();
    expect(await screen.findByText('Card A')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    fireEvent.click(screen.getByRole('button', { name: /Good/ }));
    expect(await screen.findByText('Card B')).toBeTruthy();
    expect(screen.queryByText('All caught up.')).toBeNull();
  });

  it('says a card is already scheduled and lists not-due items so they can be removed', async () => {
    waiting.items = [{
      dtuId: 'later',
      title: 'Queued note',
      nextReview: '2026-12-01T15:00:00.000Z',
      due: false,
    }];
    addResult = { ok: true, already: true, nextReview: '2026-12-01T15:00:00.000Z' };
    renderStudy();
    expect(await screen.findByText('Queued note')).toBeTruthy();
    expect(screen.getByText(/Next review/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add to review' }));
    fireEvent.click(await screen.findByText('My saved note'));
    expect(await screen.findByText(/Already scheduled/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByText('Queued note')).toBeNull());
  });
});
