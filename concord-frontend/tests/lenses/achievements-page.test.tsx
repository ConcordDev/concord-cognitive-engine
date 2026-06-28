import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

// LensShell mounts the UI store + keyboard providers in production; for an
// isolated page test stub it to a passthrough so we test the page's own four
// UX states, not the shell chrome.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/ManifestActionBar', () => ({
  ManifestActionBar: () => null,
}));

import AchievementsLensPage from '@/app/lenses/achievements/page';

const CATALOG = [
  { id: 'first_blood', title: 'First Blood', description: 'Land your first hit.', category: 'combat', rarity: 'bronze', hidden: false, rewardSparks: 5, rewardTitle: null },
  { id: 'duel_champion', title: 'Duel Champion', description: 'Win 25 duels.', category: 'combat', rarity: 'silver', hidden: false, rewardSparks: 50, rewardTitle: 'the Duelist' },
  { id: 'legendary_combatant', title: 'Legend', description: 'Win 1000 fights.', category: 'combat', rarity: 'legendary', hidden: true, rewardSparks: 500, rewardTitle: null },
];

function mockFetch(impl: (url: string) => unknown) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const body = impl(url);
    if (body === null) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as Response);
    return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
  }) as unknown as typeof fetch;
}

describe('AchievementsLensPage — four UX states', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { cleanup(); });

  it('LOADING: shows a busy skeleton before fetches resolve', async () => {
    let resolveCatalog: (v: unknown) => void = () => {};
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/catalog')) {
        return new Promise<Response>((res) => {
          resolveCatalog = (v) => res({ ok: true, status: 200, json: async () => v } as Response);
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, earned: [] }) } as Response);
    }) as unknown as typeof fetch;

    render(<AchievementsLensPage />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/loading catalog/i)).toBeInTheDocument();

    // Let it finish so we don't leak a pending promise.
    resolveCatalog({ ok: true, catalog: CATALOG });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('ERROR: shows an honest alert + retry when the catalog fetch fails', async () => {
    mockFetch((url) => (url.includes('/catalog') ? null : { ok: true, earned: [] }));
    render(<AchievementsLensPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/couldn't load achievements/i)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    expect(retry).toBeInTheDocument();

    // Retry succeeds → leaves the error state.
    mockFetch((url) => (url.includes('/catalog') ? { ok: true, catalog: CATALOG } : { ok: true, earned: [] }));
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByText('First Blood')).toBeInTheDocument();
  });

  it('EMPTY: real catalog, zero earned → honest empty state, no fabricated rows', async () => {
    mockFetch((url) => (url.includes('/catalog') ? { ok: true, catalog: [] } : { ok: true, earned: [] }));
    render(<AchievementsLensPage />);

    await waitFor(() => expect(screen.getByText(/no achievements unlocked yet/i)).toBeInTheDocument());
    // The hint must be honest guidance, never a fake achievement.
    expect(screen.getByText(/unlock achievements automatically/i)).toBeInTheDocument();
    expect(screen.queryByText('First Blood')).not.toBeInTheDocument();
  });

  it('POPULATED: renders the real catalog with earned vs locked + hides unearned hidden', async () => {
    mockFetch((url) =>
      url.includes('/catalog')
        ? { ok: true, catalog: CATALOG }
        : { ok: true, earned: [{ achievement_id: 'first_blood', earned_at: 1700000000 }] },
    );
    render(<AchievementsLensPage />);

    // Earned + non-hidden locked are present.
    expect(await screen.findByText('First Blood')).toBeInTheDocument();
    expect(screen.getByText('Duel Champion')).toBeInTheDocument();
    // The hidden, unearned achievement must NOT show.
    expect(screen.queryByText('Legend')).not.toBeInTheDocument();
    // Earned badge present for the unlocked one (exact "earned" text, distinct
    // from the header's "1 / 2 earned …" summary).
    expect(screen.getByText('earned')).toBeInTheDocument();
    // Header reflects real counts (1 earned / 2 visible / 3 total).
    expect(screen.getByText(/1 \/ 2 earned · 3 total/i)).toBeInTheDocument();
  });

  it('a11y: category filter is a labelled nav with aria-pressed state', async () => {
    mockFetch((url) => (url.includes('/catalog') ? { ok: true, catalog: CATALOG } : { ok: true, earned: [] }));
    render(<AchievementsLensPage />);
    await screen.findByText('First Blood');

    const nav = screen.getByRole('navigation', { name: /filter by category/i });
    expect(nav).toBeInTheDocument();
    const allBtn = screen.getByRole('button', { name: 'all' });
    expect(allBtn).toHaveAttribute('aria-pressed', 'true');
  });
});
