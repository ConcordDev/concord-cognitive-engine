import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock lucide-react icons used by NotificationCenter component
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
    Bell: createIcon('Bell'),
    BellOff: createIcon('BellOff'),
    Heart: createIcon('Heart'),
    MessageCircle: createIcon('MessageCircle'),
    UserPlus: createIcon('UserPlus'),
    Quote: createIcon('Quote'),
    Coins: createIcon('Coins'),
    Megaphone: createIcon('Megaphone'),
    Check: createIcon('Check'),
    CheckCheck: createIcon('CheckCheck'),
    Trash2: createIcon('Trash2'),
    X: createIcon('X'),
    ChevronRight: createIcon('ChevronRight'),
    Settings: createIcon('Settings'),
    Filter: createIcon('Filter'),
    Loader2: createIcon('Loader2'),
    Eye: createIcon('Eye'),
    EyeOff: createIcon('EyeOff'),
    Music: createIcon('Music'),
    Video: createIcon('Video'),
    FileText: createIcon('FileText'),
    Star: createIcon('Star'),
    AlertCircle: createIcon('AlertCircle'),
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

import { NotificationCenter } from '@/components/social/NotificationCenter';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

describe('NotificationCenter', () => {
  let queryClient: QueryClient;

  const mockNotifications = [
    {
      id: 'notif-1',
      type: 'like' as const,
      title: 'Content Liked',
      message: 'Alice liked your DTU',
      actorId: 'user-alice',
      actorName: 'Alice',
      targetId: 'dtu-1',
      targetTitle: 'My DTU',
      read: false,
      createdAt: '2026-02-28T10:00:00Z',
    },
    {
      id: 'notif-2',
      type: 'follow' as const,
      title: 'New Follower',
      message: 'Bob started following you',
      actorId: 'user-bob',
      actorName: 'Bob',
      read: false,
      createdAt: '2026-02-28T09:00:00Z',
    },
    {
      id: 'notif-3',
      type: 'comment' as const,
      title: 'New Comment',
      message: 'Carol commented on your post',
      actorId: 'user-carol',
      actorName: 'Carol',
      targetId: 'dtu-2',
      targetTitle: 'Another DTU',
      read: true,
      createdAt: '2026-02-27T15:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, refetchInterval: false },
      },
    });
    mockedApi.get.mockResolvedValue({ data: { notifications: mockNotifications } });
    mockedApi.post.mockResolvedValue({ data: { ok: true } });
    mockedApi.put.mockResolvedValue({ data: { ok: true } });
    mockedApi.delete.mockResolvedValue({ data: { ok: true } });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  function renderNotificationCenter(props: Record<string, unknown> = {}) {
    return render(
      React.createElement(QueryClientProvider, { client: queryClient },
        React.createElement(NotificationCenter, { userId: 'current-user', ...props })
      )
    );
  }

  it('renders header with unread count badge', async () => {
    renderNotificationCenter();

    await waitFor(() => {
      // The component shows unread count (2 unread notifications)
      expect(screen.getByText('2')).toBeDefined();
    });
  });

  it('notification items render in panel mode', async () => {
    renderNotificationCenter();

    // In panel mode (default), notifications are visible immediately
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeDefined();
      expect(screen.getByText('Bob')).toBeDefined();
      expect(screen.getByText('Carol')).toBeDefined();
    });
  });

  it('notification messages display', async () => {
    renderNotificationCenter();

    await waitFor(() => {
      expect(screen.getByText('Alice liked your DTU')).toBeDefined();
      expect(screen.getByText('Bob started following you')).toBeDefined();
      expect(screen.getByText('Carol commented on your post')).toBeDefined();
    });
  });

  it('mark all as read button works', async () => {
    renderNotificationCenter();

    await waitFor(() => {
      expect(screen.getByText('2')).toBeDefined();
    });

    // Find the mark-all-as-read button (has title "Mark all as read")
    const markAllBtn = screen.getByTitle('Mark all as read');
    fireEvent.click(markAllBtn);

    // Optimistic update should clear unread count
    await waitFor(() => {
      expect(screen.queryByText('2')).toBeNull();
    });
  });

  it('filter button toggles filter options', async () => {
    renderNotificationCenter();

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeDefined();
    });

    // Click the filter button
    const filterBtn = screen.getByTitle('Filter notifications');
    fireEvent.click(filterBtn);

    // Filter options should appear
    await waitFor(() => {
      expect(screen.getByText('Likes')).toBeDefined();
      expect(screen.getByText('Follows')).toBeDefined();
      expect(screen.getByText('Comments')).toBeDefined();
    });
  });

  it('clear all button works', async () => {
    renderNotificationCenter();

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeDefined();
    });

    // Find the clear all button (has title "Clear all")
    const clearAllBtn = screen.getByTitle('Clear all');
    fireEvent.click(clearAllBtn);

    // After clearing, should show empty state
    await waitFor(() => {
      const empty = screen.queryByText(/no notification|all caught up/i);
      expect(empty).not.toBeNull();
    });
  });

  it('empty state when no notifications', async () => {
    mockedApi.get.mockResolvedValue({
      data: { notifications: [] },
    });

    renderNotificationCenter();

    await waitFor(() => {
      const empty = screen.queryByText(/no notification|all caught up/i);
      expect(empty).not.toBeNull();
    });
  });

  it('unread count badge not shown when all read', async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        notifications: [
          {
            id: 'notif-1',
            type: 'like',
            title: 'Content Liked',
            message: 'Test notification',
            read: true,
            createdAt: '2026-02-28T10:00:00Z',
            actorName: 'Alice',
            actorId: 'user-alice',
          },
        ],
      },
    });

    renderNotificationCenter();

    await waitFor(() => {
      // Badge should not show count of 0
      expect(screen.queryByText('0')).toBeNull();
    });
  });

  it('renders Notifications header', async () => {
    renderNotificationCenter();

    expect(screen.getByText('Notifications')).toBeDefined();
  });
});
