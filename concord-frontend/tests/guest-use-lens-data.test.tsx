import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * GB-1536 §6f + §5 — useLensData for guests: the seed arrays render
 * client-side as labelled SAMPLE rows when the shelf is empty, and
 * the /bulk seed write NEVER fires for a guest in any NODE_ENV (the
 * old code fired it in development). A member's empty shelf stays
 * empty here (no sample substitution).
 */

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import { useLensData } from '@/lib/hooks/use-lens-data';
import { GuestProvider } from '@/lib/guest';

function wrapper(guest: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <GuestProvider value={guest}>{children}</GuestProvider>
      </QueryClientProvider>
    );
  };
}

const SEED = [
  { title: 'Sample Song One', data: { durationS: 30 } },
  { title: 'Sample Song Two', data: { durationS: 45 } },
];

describe('useLensData guest samples (GB-1536 §5)', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockResolvedValue({ data: { ok: true, artifacts: [], total: 0 } });
  });

  it('a guest with an empty shelf gets the seed rows as flagged samples', async () => {
    const { result } = renderHook(() => useLensData('music', 'track', { seed: SEED }), {
      wrapper: wrapper(true),
    });
    await waitFor(() => expect(result.current.isSample).toBe(true));
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].title).toBe('Sample Song One');
    expect(result.current.items[0].meta.sample).toBe(true);
    expect(result.current.items[0].id.startsWith('sample-')).toBe(true);
  });

  it('a guest NEVER triggers the /bulk seed write', async () => {
    const { result } = renderHook(() => useLensData('music', 'track', { seed: SEED }), {
      wrapper: wrapper(true),
    });
    await waitFor(() => expect(result.current.isSample).toBe(true));
    // Give the seed effect every chance to (wrongly) fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(post).not.toHaveBeenCalled();
  });

  it('a member with an empty shelf gets no sample substitution', async () => {
    const { result } = renderHook(() => useLensData('music', 'track', { seed: SEED }), {
      wrapper: wrapper(false),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isSample).toBe(false);
    expect(result.current.items).toHaveLength(0);
  });

  it('a guest with real public rows sees the real rows, not samples', async () => {
    get.mockResolvedValue({
      data: {
        ok: true,
        total: 1,
        artifacts: [
          { id: 'real-1', title: 'A Real Public Track', data: {}, meta: { tags: [], status: 'published', visibility: 'public' }, createdAt: '', updatedAt: '', version: 1 },
        ],
      },
    });
    const { result } = renderHook(() => useLensData('music', 'track', { seed: SEED }), {
      wrapper: wrapper(true),
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.isSample).toBe(false);
    expect(result.current.items[0].id).toBe('real-1');
  });
});
