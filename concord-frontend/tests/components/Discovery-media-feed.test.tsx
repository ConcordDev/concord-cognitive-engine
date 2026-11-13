// Discovery-media-feed.test.tsx
//
// FIX-feed-004: Explore → Media crashed with "Cannot read properties of
// undefined (reading 'length')" on every row. GET /api/media/feed returns
// media-DTU rows ({ id, author, authorName, mediaType, engagement, ... })
// but the media tab cast them raw `as TrendingDTU[]`, so MediaCard got
// dtuId === undefined and pickGradient(undefined) threw reading 'length'.
// The trending tab normalizes through asTrendingCard; the media tab now
// does the same. This pin serves the REAL server row shape (id, no
// dtuId, tags absent) and asserts the Media view renders the card.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('lucide-react', () => {
  const createIcon = (name: string) => {
    const Component = (props: Record<string, unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const React = require('react');
      return React.createElement('span', { 'data-testid': `icon-${name}`, ...props });
    };
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

vi.mock('framer-motion', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    useReducedMotion: () => false,
    MotionConfig: ({ children }: { children?: import('react').ReactNode }) => children,
    motion: {
      // eslint-disable-next-line react/display-name
      div: React.forwardRef(({ children }: Record<string, unknown>, ref: unknown) =>
        React.createElement('div', { ref }, children)
      ),
      // eslint-disable-next-line react/display-name
      button: React.forwardRef(({ children }: Record<string, unknown>, ref: unknown) =>
        React.createElement('button', { ref }, children)
      ),
      // eslint-disable-next-line react/display-name
      span: React.forwardRef(({ children }: Record<string, unknown>, ref: unknown) =>
        React.createElement('span', { ref }, children)
      ),
    },
    AnimatePresence: ({ children }: Record<string, unknown>) => React.createElement(React.Fragment, null, children),
  };
});

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  createSharedSession: vi.fn(),
  activeSharedSessions: vi.fn(async () => []),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'current-user', username: 'testuser', email: 'test@test.com', role: 'user' },
    isLoading: false,
    isAuthenticated: true,
    logout: vi.fn(),
    refresh: vi.fn(),
  })),
}));

import { Discovery } from '@/components/social/Discovery';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn> };

// The exact row shape server/lib/media-dtu.js getMediaFeed returns:
// `id` (never `dtuId`), `author` + `authorName`, tags possibly absent.
const MEDIA_FEED_RESPONSE = {
  data: {
    ok: true,
    tab: 'trending',
    total: 1,
    feed: [
      {
        id: 'media-dtu-1',
        title: 'Lo-fi Study Mix',
        description: 'beats',
        mediaType: 'audio',
        thumbnail: null,
        duration: 182,
        author: 'user-9',
        authorName: 'Kai',
        engagement: { views: 120, likes: 9, comments: 1 },
        createdAt: new Date().toISOString(),
        privacy: 'public',
        // tags intentionally absent — media DTUs do not always carry them
      },
    ],
  },
};

describe('Discovery Media tab (FIX-feed-004)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url === '/api/media/feed') return MEDIA_FEED_RESPONSE;
      if (url === '/api/social/trending') return { data: { trending: [] } };
      return { data: {} };
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it('renders media rows in the server shape without crashing', async () => {
    render(
      React.createElement(QueryClientProvider, { client: queryClient },
        React.createElement(Discovery, { currentUserId: 'current-user' }))
    );
    fireEvent.click(screen.getByText('Media'));
    await waitFor(() => {
      expect(screen.getByText('Lo-fi Study Mix')).toBeDefined();
    });
    expect(screen.getByText('Kai')).toBeDefined();
  });
});
