/**
 * Phase 3 controls: find people, settings, push only when VAPID exists,
 * and a profile message that posts to the DM route.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const calls: Array<{ method: string; url: string; body?: unknown }> = [];

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) =>
    React.createElement('a', { href }, children),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ username: 'bea' }),
  useRouter: () => ({ push: vi.fn() }),
  // The profile page's open-in-place plumbing (JOB 7) reads the router's
  // URL state; derive it from window.location like the real contract.
  usePathname: () => '/lenses/social/u/bea',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('next/image', () => ({
  default: (props: { alt?: string }) => React.createElement('img', { alt: props.alt || '' }),
}));
vi.mock('framer-motion', () => {
  const passthrough = (tag: string) => {
    const Comp = React.forwardRef<HTMLElement, { children?: React.ReactNode }>((props, ref) =>
      React.createElement(tag, { ref }, props.children));
    Comp.displayName = `Motion${tag}`;
    return Comp;
  };
  return {
    useReducedMotion: () => false,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
    motion: { div: passthrough('div'), button: passthrough('button'), span: passthrough('span') },
  };
});
vi.mock('@/hooks/useWebPush', () => ({
  useWebPush: () => ({ status: 'not_subscribed', error: null, enable: vi.fn(), disable: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(async (url: string) => {
      calls.push({ method: 'GET', url });
      if (url === '/api/push/vapid-public-key') return { data: { ok: true, publicKey: null } };
      if (url === '/api/social/topics/trending') return { data: { topics: [{ tag: 'music', count: 2 }] } };
      if (String(url).includes('/api/social/users/search')) {
        return { data: { users: [{ id: 'u2', username: 'bea', displayName: 'Bea' }] } };
      }
      if (String(url).includes('/api/social/users/by-username/')) return { data: { ok: true, user: { id: 'u2', username: 'bea' } } };
      if (url === '/api/auth/me') return { data: { user: { id: 'u1' } } };
      if (String(url).includes('/api/social/profile/')) {
        return { data: { profile: { userId: 'u2', displayName: 'Bea', username: 'bea', bio: 'hi', avatar: '', isPublic: true, specialization: [], website: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', stats: { dtuCount: 0, publicDtuCount: 0, citationCount: 0, followerCount: 1, followingCount: 0 } } } };
      }
      if (String(url).includes('/api/social/following/')) return { data: { following: [] } };
      if (String(url).includes('/api/social/posts/')) return { data: { posts: [] } };
      return { data: { ok: true } };
    }),
    post: vi.fn(async (url: string, body?: unknown) => {
      calls.push({ method: 'POST', url, body });
      return { data: { ok: true, interests: ['music'] } };
    }),
  },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));

import { FindPeople } from '@/components/social/FindPeople';
import { SocialPreferencesForm } from '@/components/social/SocialPreferencesForm';
import { PushEnableButton } from '@/components/social/PushEnableButton';
import SocialProfilePage from '@/app/lenses/social/u/[username]/page';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('social core loop controls', () => {
  beforeEach(() => { calls.length = 0; });

  it('links a search result to the shareable profile', async () => {
    wrap(<FindPeople />);
    fireEvent.change(screen.getByLabelText('Find people'), { target: { value: 'be' } });
    const link = await screen.findByRole('link', { name: /Bea/ });
    expect(link.getAttribute('href')).toBe('/lenses/social/u/bea');
    expect(calls.some((c) => c.url.includes('/api/social/users/search'))).toBe(true);
  });

  it('saves interests and DM policy', async () => {
    wrap(<SocialPreferencesForm />);
    fireEvent.click(await screen.findByRole('button', { name: '#music' }));
    fireEvent.change(screen.getByLabelText('Who can message me'), { target: { value: 'followers' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/social/preferences')).toBe(true);
    });
  });

  it('hides push when the server has no VAPID key', async () => {
    wrap(<PushEnableButton />);
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/push/vapid-public-key')).toBe(true);
    });
    expect(screen.queryByRole('button', { name: /Enable notifications/i })).toBeNull();
  });

  it('sends a message from the profile link', async () => {
    wrap(<SocialProfilePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Message' }));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/social/dm')).toBe(true);
    });
  });
});
