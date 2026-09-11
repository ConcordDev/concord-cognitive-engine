import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock lucide-react icons used by UserProfile component
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
    UserPlus: createIcon('UserPlus'),
    UserMinus: createIcon('UserMinus'),
    Settings: createIcon('Settings'),
    Share2: createIcon('Share2'),
    MapPin: createIcon('MapPin'),
    Link2: createIcon('Link2'),
    Calendar: createIcon('Calendar'),
    Heart: createIcon('Heart'),
    Music: createIcon('Music'),
    Video: createIcon('Video'),
    FileText: createIcon('FileText'),
    Image: createIcon('Image'),
    MessageCircle: createIcon('MessageCircle'),
    BookOpen: createIcon('BookOpen'),
    TrendingUp: createIcon('TrendingUp'),
    Award: createIcon('Award'),
    ExternalLink: createIcon('ExternalLink'),
    Copy: createIcon('Copy'),
    Check: createIcon('Check'),
    MoreHorizontal: createIcon('MoreHorizontal'),
    Loader2: createIcon('Loader2'),
    Users: createIcon('Users'),
    Eye: createIcon('Eye'),
    Quote: createIcon('Quote'),
  };
});

// Mock framer-motion
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

// Mock the api client
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock useAuth hook
vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'current-user', username: 'testuser', email: 'test@test.com', role: 'user' },
    isLoading: false,
    isAuthenticated: true,
    logout: vi.fn(),
    refresh: vi.fn(),
  })),
}));

import { UserProfile } from '@/components/social/UserProfile';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

describe('UserProfile', () => {
  let queryClient: QueryClient;

  const mockProfile = {
    userId: 'user-123',
    displayName: 'Jane Doe',
    bio: 'Explorer of knowledge',
    avatar: '',
    isPublic: true,
    specialization: ['AI', 'Cognitive Science'],
    website: '',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
    stats: {
      dtuCount: 42,
      publicDtuCount: 30,
      citationCount: 15,
      followerCount: 150,
      followingCount: 75,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    mockedApi.get.mockImplementation((url: string) => {
      if (url.includes('/api/social/profile/')) {
        return Promise.resolve({ data: { profile: mockProfile } });
      }
      if (url.includes('/api/social/posts/') || url.includes('/api/social/feed/') || url.includes('/api/media/author/')) {
        return Promise.resolve({ data: { posts: [], feed: [], media: [] } });
      }
      return Promise.resolve({ data: {} });
    });
    mockedApi.post.mockResolvedValue({ data: { ok: true } });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  function renderUserProfile(props: Record<string, unknown> = {}) {
    return render(
      React.createElement(QueryClientProvider, { client: queryClient },
        React.createElement(UserProfile, { userId: 'user-123', currentUserId: 'current-user', ...props })
      )
    );
  }

  it('renders profile header with name and avatar', async () => {
    renderUserProfile();

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeDefined();
    });
  });

  it('renders username', async () => {
    renderUserProfile();

    await waitFor(() => {
      // Component renders @{profile.userId}
      expect(screen.getByText('@user-123')).toBeDefined();
    });
  });

  it('renders bio', async () => {
    renderUserProfile();

    await waitFor(() => {
      expect(screen.getByText('Explorer of knowledge')).toBeDefined();
    });
  });

  it('shows follow button when viewing another user', async () => {
    renderUserProfile();

    await waitFor(() => {
      // Use exact match to avoid matching "Followers" or "Following"
      const followButtons = screen.getAllByText(/follow/i);
      // At least one should be the Follow button (not Followers/Following stats)
      const followButton = followButtons.find(el => el.textContent?.trim() === 'Follow');
      expect(followButton).toBeDefined();
    });
  });

  it('follower count displays', async () => {
    renderUserProfile();

    await waitFor(() => {
      expect(screen.getByText('150')).toBeDefined();
      expect(screen.getByText(/followers/i)).toBeDefined();
    });
  });

  it('following count displays', async () => {
    renderUserProfile();

    await waitFor(() => {
      expect(screen.getByText('75')).toBeDefined();
      expect(screen.getByText(/following/i)).toBeDefined();
    });
  });

  it('content tabs render and switch', async () => {
    renderUserProfile();

    await waitFor(() => {
      expect(screen.getByText('Posts')).toBeDefined();
      // "DTUs" appears both in stats and tabs; find the tab button
      const dtusElements = screen.getAllByText('DTUs');
      expect(dtusElements.length).toBeGreaterThan(0);
    });

    // Find the DTUs tab button (in the content tabs area)
    const dtusElements = screen.getAllByText('DTUs');
    const dtusTabBtn = dtusElements.find(el => el.closest('button')?.className?.includes('border-b-2'));
    expect(dtusTabBtn).toBeDefined();
    fireEvent.click(dtusTabBtn!.closest('button')!);

    // Tab should be visually active after click
    expect(dtusTabBtn!.closest('button')?.className).toContain('neon');
  });

  it('follow button calls API when clicked', async () => {
    renderUserProfile();

    await waitFor(() => {
      const followButtons = screen.getAllByText(/follow/i);
      const followButton = followButtons.find(el => el.textContent?.trim() === 'Follow');
      expect(followButton).toBeDefined();
    });

    // Find the Follow button (exact text, not "Followers" or "Following")
    const followButtons = screen.getAllByText(/follow/i);
    const followButton = followButtons.find(el => el.textContent?.trim() === 'Follow');
    fireEvent.click(followButton!);

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith(
        expect.stringContaining('follow'),
        expect.anything()
      );
    });
  });

  it('handles loading state', () => {
    mockedApi.get.mockReturnValue(new Promise(() => {}));

    const { container } = renderUserProfile();

    // The component shows a Loader2 icon for loading
    const spinner = container.querySelector('[data-testid="icon-Loader2"]');
    expect(spinner).not.toBeNull();
  });

  it('handles error state', async () => {
    mockedApi.get.mockRejectedValue(new Error('Failed to load profile'));

    renderUserProfile();

    // Component has retry: 2 in its useQuery config, so we need to wait
    // for all retries to exhaust before the error state appears
    await waitFor(() => {
      // Component shows "Profile Not Found"
      const errorText = screen.queryByText(/not found|error|failed/i);
      expect(errorText).not.toBeNull();
    }, { timeout: 10000 });
  });

  it('renders Media tab', async () => {
    renderUserProfile();

    await waitFor(() => {
      expect(screen.getByText('Media')).toBeDefined();
    });
  });

  it('renders Liked tab', async () => {
    renderUserProfile();

    await waitFor(() => {
      expect(screen.getByText('Liked')).toBeDefined();
    });
  });
});
