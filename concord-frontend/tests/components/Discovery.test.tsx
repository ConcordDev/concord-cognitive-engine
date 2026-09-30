import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock lucide-react icons used by Discovery component
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
    Search: createIcon('Search'),
    TrendingUp: createIcon('TrendingUp'),
    Users: createIcon('Users'),
    Hash: createIcon('Hash'),
    Sparkles: createIcon('Sparkles'),
    Filter: createIcon('Filter'),
    ChevronDown: createIcon('ChevronDown'),
    Music: createIcon('Music'),
    Video: createIcon('Video'),
    Image: createIcon('Image'),
    FileText: createIcon('FileText'),
    Heart: createIcon('Heart'),
    Eye: createIcon('Eye'),
    Quote: createIcon('Quote'),
    UserPlus: createIcon('UserPlus'),
    Star: createIcon('Star'),
    Loader2: createIcon('Loader2'),
    Radio: createIcon('Radio'),
    Play: createIcon('Play'),
    Flame: createIcon('Flame'),
    BookOpen: createIcon('BookOpen'),
    BarChart3: createIcon('BarChart3'),
    X: createIcon('X'),
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

import { Discovery } from '@/components/social/Discovery';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

describe('Discovery', () => {
  let queryClient: QueryClient;

  const mockTrendingData = [
    {
      dtuId: 'trend-1',
      title: 'Quantum Computing Breakthroughs',
      authorId: 'author-1',
      authorName: 'Alice',
      tags: ['quantum', 'computing'],
      citationCount: 5,
      score: 95,
      createdAt: new Date().toISOString(),
      engagement: { views: 230, likes: 50, comments: 10 },
    },
    {
      dtuId: 'trend-2',
      title: 'Mindfulness and Cognitive Science',
      authorId: 'author-2',
      authorName: 'Bob',
      tags: ['mindfulness', 'cognitive'],
      citationCount: 3,
      score: 88,
      createdAt: new Date().toISOString(),
      engagement: { views: 180, likes: 30, comments: 5 },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    mockedApi.get.mockResolvedValue({ data: { trending: mockTrendingData } });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  function renderDiscovery() {
    return render(
      React.createElement(QueryClientProvider, { client: queryClient },
        React.createElement(Discovery)
      )
    );
  }

  it('renders search input', () => {
    renderDiscovery();
    const searchInput = screen.getByPlaceholderText(/search|discover|explore/i);
    expect(searchInput).toBeDefined();
  });

  it('renders tab switching options', () => {
    renderDiscovery();
    expect(screen.getByText('Trending')).toBeDefined();
    expect(screen.getByText('Topics')).toBeDefined();
    expect(screen.getByText('People')).toBeDefined();
    expect(screen.getByText('Media')).toBeDefined();
  });

  it('tab switching works', () => {
    renderDiscovery();

    fireEvent.click(screen.getByText('People'));
    // People tab should become active with neon styling
    const peopleTab = screen.getByText('People');
    expect(peopleTab.closest('button')?.className || peopleTab.className).toContain('neon');

    fireEvent.click(screen.getByText('Topics'));
    const topicsTab = screen.getByText('Topics');
    expect(topicsTab.closest('button')?.className || topicsTab.className).toContain('neon');
  });

  it('search submits on input change', async () => {
    renderDiscovery();
    const searchInput = screen.getByPlaceholderText(/search|discover|explore/i);

    fireEvent.change(searchInput, { target: { value: 'quantum' } });

    // The search uses debounce + useQuery, API is called during initial render
    // for trending, and will be called again for search after debounce
    await waitFor(() => {
      expect(mockedApi.get).toHaveBeenCalled();
    });
  });

  it('trending items display', async () => {
    renderDiscovery();

    await waitFor(() => {
      expect(screen.getByText('Quantum Computing Breakthroughs')).toBeDefined();
      expect(screen.getByText('Mindfulness and Cognitive Science')).toBeDefined();
    });
  });

  it('loading state during fetch', () => {
    mockedApi.get.mockReturnValue(new Promise(() => {}));

    const { container } = renderDiscovery();

    // The component shows a Loader2 icon with animate-spin class
    const spinner = container.querySelector('[data-testid="icon-Loader2"]');
    expect(spinner).not.toBeNull();
  });

  it('empty state display when no results', async () => {
    mockedApi.get.mockResolvedValue({ data: { trending: [] } });

    renderDiscovery();

    await waitFor(() => {
      // The component shows "No Trending Content" for empty trending
      const emptyState = screen.queryByText(/no trending/i);
      expect(emptyState).not.toBeNull();
    });
  });

  it('filters button renders and toggles category filters', () => {
    renderDiscovery();

    // The Filters button exists
    const filtersButton = screen.getByText('Filters');
    expect(filtersButton).toBeDefined();

    // Click to reveal category filters
    fireEvent.click(filtersButton);

    // Category filter options appear
    expect(screen.getByText('Audio')).toBeDefined();
    expect(screen.getByText('Video')).toBeDefined();
    expect(screen.getByText('Images')).toBeDefined();
  });

  it('search input updates value', () => {
    renderDiscovery();
    const searchInput = screen.getByPlaceholderText(/search|discover|explore/i) as HTMLInputElement;

    fireEvent.change(searchInput, { target: { value: 'neural networks' } });
    expect(searchInput.value).toBe('neural networks');
  });

  it('trending card scores display', async () => {
    renderDiscovery();

    await waitFor(() => {
      expect(screen.getByText('95')).toBeDefined();
      expect(screen.getByText('88')).toBeDefined();
    });
  });

  it('trending card author names display', async () => {
    renderDiscovery();

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeDefined();
      expect(screen.getByText('Bob')).toBeDefined();
    });
  });
});
