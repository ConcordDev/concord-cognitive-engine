// PodcastSubscribeToast.test.tsx
//
// FIX-podcast-008: Browse subscribe/unsubscribe gave no confirmation
// and ignored the toggle's result (a failure refreshed silently as
// success). The panel now toasts the action's returned state —
// "Subscribed to X" / "Unsubscribed from X" — and a refused toggle
// lands on the panel error line with no toast.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', () => {
  const createIcon = (name: string) => {
    const Component = (props: Record<string, unknown>) => React.createElement('span', { 'data-testid': `icon-${name}`, ...props });
    Component.displayName = name;
    return Component;
  };
  const names = ['Loader2', 'Plus', 'Star', 'Check', 'ListPlus', 'Download', 'ChevronLeft', 'Trash2'];
  return Object.fromEntries(names.map((n) => [n, createIcon(n)]));
});

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/components/common/Toasts', () => ({ showToast: (...a: unknown[]) => toast(...a) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/components/ui', () => ({ ErrorState: ({ message }: { message: string }) => React.createElement('div', null, message) }));

const state = vi.hoisted(() => ({ subscribed: false, failSubscribe: false }));
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_domain: string, action: string) => {
    if (action === 'show-list') {
      return { data: { ok: true, result: { shows: [{
        id: 'sh1', title: 'NASA Daily', author: 'NASA', category: 'science',
        description: null, episodeCount: 3, subscribed: state.subscribed,
        rating: 0, reviewCount: 0,
      }] } } };
    }
    if (action === 'show-subscribe') {
      if (state.failSubscribe) return { data: { ok: false, error: 'show not found' } };
      state.subscribed = !state.subscribed;
      return { data: { ok: true, result: { showId: 'sh1', subscribed: state.subscribed } } };
    }
    return { data: { ok: true, result: {} } };
  }),
}));

import { PodcastBrowsePanel } from '@/components/podcast/PodcastBrowsePanel';

describe('Podcast subscribe feedback (FIX-podcast-008)', () => {
  beforeEach(() => { toast.mockReset(); state.subscribed = false; state.failSubscribe = false; });
  afterEach(() => cleanup());

  it('toasts subscribe and unsubscribe with the returned state', async () => {
    const view = render(React.createElement(PodcastBrowsePanel, { onChange: () => {} }));
    fireEvent.click(await screen.findByRole('button', { name: 'Subscribe' }));
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Subscribed to NASA Daily'));

    // The subscribed row's button is icon-only (a check mark).
    const iconOnly = [...view.container.querySelectorAll('button')].find((b) => b.textContent === '');
    expect(iconOnly).toBeTruthy();
    fireEvent.click(iconOnly!);
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Unsubscribed from NASA Daily'));
  });

  it('a refused toggle shows the error and no toast', async () => {
    state.failSubscribe = true;
    render(React.createElement(PodcastBrowsePanel, { onChange: () => {} }));
    fireEvent.click(await screen.findByRole('button', { name: 'Subscribe' }));
    await screen.findByText('show not found');
    expect(toast).not.toHaveBeenCalled();
  });
});
