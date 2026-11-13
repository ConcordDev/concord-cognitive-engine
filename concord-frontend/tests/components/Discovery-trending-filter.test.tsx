// Discovery-trending-filter.test.tsx
//
// FIX-feed-005: Explore's Filters bar is global, but the Trending
// query ignored the category filter (it lived only in the queryKey,
// refetching the identical unfiltered list), so Audio / Video /
// Images / Docs / Text changed nothing on the default tab. The
// trending cards are now filtered by mediaType — a post with no media
// attachment counts as a text post.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('lucide-react', () => {
  const createIcon = (name: string) => {
    const Component = (props: Record<string, unknown>) => React.createElement('span', { 'data-testid': `icon-${name}`, ...props });
    Component.displayName = name;
    return Component;
  };
  return {
    Search: createIcon('Search'), TrendingUp: createIcon('TrendingUp'), Users: createIcon('Users'),
    Hash: createIcon('Hash'), Sparkles: createIcon('Sparkles'), Filter: createIcon('Filter'),
    ChevronDown: createIcon('ChevronDown'), Music: createIcon('Music'), Video: createIcon('Video'),
    Image: createIcon('Image'), FileText: createIcon('FileText'), Heart: createIcon('Heart'),
    Eye: createIcon('Eye'), Quote: createIcon('Quote'), UserPlus: createIcon('UserPlus'),
    Star: createIcon('Star'), Loader2: createIcon('Loader2'), Radio: createIcon('Radio'),
    Play: createIcon('Play'), Flame: createIcon('Flame'), BookOpen: createIcon('BookOpen'),
    BarChart3: createIcon('BarChart3'), X: createIcon('X'),
  };
});
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: {
    div: ({ children, ...p }: Record<string, unknown>) => React.createElement('div', p, children as React.ReactNode),
    button: ({ children, ...p }: Record<string, unknown>) => React.createElement('button', p, children as React.ReactNode),
    span: ({ children, ...p }: Record<string, unknown>) => React.createElement('span', p, children as React.ReactNode),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: vi.fn(async () => ({ data: {} })) },
  createSharedSession: vi.fn(async () => ({})),
  activeSharedSessions: vi.fn(async () => ({ data: [] })),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'me' }, isLoading: false, isAuthenticated: true, logout: vi.fn(), refresh: vi.fn() }),
}));

import { Discovery } from '@/components/social/Discovery';

const POSTS = [
  { id: 'p-audio', title: 'Audio Post', authorId: 'a1', authorName: 'Kai', tags: [], score: 9, createdAt: new Date().toISOString(), mediaType: 'audio', engagement: { views: 3, likes: 1, comments: 0 } },
  { id: 'p-video', title: 'Video Post', authorId: 'a2', authorName: 'Rae', tags: [], score: 8, createdAt: new Date().toISOString(), mediaType: 'video', engagement: { views: 3, likes: 1, comments: 0 } },
  { id: 'p-text', title: 'Plain Text Post', authorId: 'a3', authorName: 'Jo', tags: [], score: 7, createdAt: new Date().toISOString(), engagement: { views: 3, likes: 1, comments: 0 } },
];

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

describe('Discovery Explore media-type filters (FIX-feed-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/social/trending') return { data: { posts: POSTS } };
      if (url.startsWith('/api/social/discover/')) return { data: { suggestions: [] } };
      if (url === '/api/media/feed') return { data: { feed: [] } };
      return { data: {} };
    });
  });
  afterEach(() => cleanup());

  it('Audio shows only the audio post; Text shows only the attachment-free post', async () => {
    render(wrap(React.createElement(Discovery, {})));
    expect(await screen.findByText('Audio Post')).toBeTruthy();
    expect(screen.getByText('Video Post')).toBeTruthy();
    expect(screen.getByText('Plain Text Post')).toBeTruthy();

    fireEvent.click(screen.getByText('Filters'));
    fireEvent.click(await screen.findByText('Audio'));
    expect(await screen.findByText('Audio Post')).toBeTruthy();
    expect(screen.queryByText('Video Post')).toBeNull();
    expect(screen.queryByText('Plain Text Post')).toBeNull();

    fireEvent.click(screen.getByText('Text'));
    expect(await screen.findByText('Plain Text Post')).toBeTruthy();
    expect(screen.queryByText('Audio Post')).toBeNull();
  });
});
