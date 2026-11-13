// Audit fix sweep (PR #2356) — FIX-social-003 (FE half): the Inbox
// badge read only the social-store count (25) while the panel it
// opens counts both stores (75). Three legs: the social page badge
// adds the platform queue's unread (mirroring NotificationBell); the
// panel fetches the routes' full 200 window so its header chip
// counts the same population the badge totals; the server count
// filters muted types like the list (pinned server-side separately).
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';

const calls: Array<{ url: string; params?: Record<string, unknown> }> = [];
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn((url: string, opts?: { params?: Record<string, unknown> }) => {
      calls.push({ url, params: opts?.params });
      if (url === '/api/social/notifications') {
        return Promise.resolve({
          data: {
            notifications: Array.from({ length: 60 }, (_, i) => ({
              id: `s${i}`, type: 'follow', message: 'm', read: false,
              createdAt: '2026-03-02T10:00:00Z',
            })),
          },
        });
      }
      if (url === '/api/notifications') {
        return Promise.resolve({
          data: {
            notifications: Array.from({ length: 50 }, (_, i) => ({
              id: `p${i}`, title: 'Platform', payload: {}, readAt: null,
              createdAt: '2026-03-02T10:00:00Z',
            })),
          },
        });
      }
      return Promise.resolve({ data: {} });
    }),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
}));
vi.mock('@/lib/realtime/socket', () => ({
  getSocket: () => null,
  subscribe: vi.fn(() => () => {}),
}));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  motion: new Proxy({}, {
    get: () => ({ children, ...props }: { children: React.ReactNode }) =>
      React.createElement('div', props, children),
  }),
}));

import { NotificationCenter } from '@/components/social/NotificationCenter';

describe('social inbox badge consistency', () => {
  it('the panel fetches the full window and its chip counts both stores', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={qc}>
        <NotificationCenter userId="u1" isOpen onClose={() => {}} mode="panel" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(view.container.textContent).toContain('110'));
    const social = calls.find((c) => c.url === '/api/social/notifications');
    const platform = calls.find((c) => c.url === '/api/notifications');
    expect(social?.params?.limit).toBe(200);
    expect(platform?.params?.limit).toBe(200);
  });

  it('the social page Inbox badge sums the social and platform counts', () => {
    const src = readFileSync(
      join(process.cwd(), 'app/lenses/social/page.tsx'),
      'utf8',
    );
    expect(src).toContain("'notification-platform-count'");
    expect(src).toContain('(unreadData?.count ?? 0) + (platformUnread ?? 0)');
  });
});
