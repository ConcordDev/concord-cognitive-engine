import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('div', props, children),
    },
  ),
  AnimatePresence: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
}));

const apiGet = vi.fn();
const apiDelete = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...a: unknown[]) => apiGet(...a),
    delete: (...a: unknown[]) => apiDelete(...a),
  },
}));

import { PostScheduler } from '@/components/social/PostScheduler';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const FUTURE = new Date(Date.now() + 7 * 86400000).toISOString();
const PAST = new Date(Date.now() - 7 * 86400000).toISOString();

describe('PostScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockResolvedValue({ data: { posts: [] } });
    apiDelete.mockResolvedValue({ data: { ok: true } });
  });
  afterEach(() => cleanup());

  it('shows the empty queue state when no scheduled posts', async () => {
    wrap(<PostScheduler userId="u1" />);
    expect(await screen.findByText('No scheduled posts')).toBeInTheDocument();
  });

  it('renders upcoming posts with tags and a count', async () => {
    apiGet.mockResolvedValue({
      data: {
        posts: [
          { postId: 'p1', content: 'Future post', scheduledAt: FUTURE, tags: ['ai', 'rust'] },
        ],
      },
    });
    wrap(<PostScheduler userId="u1" />);
    expect(await screen.findByText('Future post')).toBeInTheDocument();
    expect(screen.getByText('(1 upcoming)')).toBeInTheDocument();
    expect(screen.getByText('#ai')).toBeInTheDocument();
  });

  it('renders the recently posted section for past posts', async () => {
    apiGet.mockResolvedValue({
      data: { posts: [{ postId: 'p2', content: 'Old post', scheduledAt: PAST }] },
    });
    wrap(<PostScheduler userId="u1" />);
    expect(await screen.findByText('Recently posted')).toBeInTheDocument();
    expect(screen.getByText('Old post')).toBeInTheDocument();
  });

  it('disables Schedule Post until date and time set, then calls onSchedulePost', async () => {
    const onSchedulePost = vi.fn();
    const { container } = wrap(<PostScheduler userId="u1" onSchedulePost={onSchedulePost} />);
    await screen.findByText('No scheduled posts');
    const btn = screen.getByText('Schedule Post');
    expect(btn).toBeDisabled();
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2099-01-01' } });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onSchedulePost).toHaveBeenCalledWith(expect.stringContaining('2099-01-01'));
  });

  it('handleSchedule no-ops when time is cleared', async () => {
    const onSchedulePost = vi.fn();
    const { container } = wrap(<PostScheduler userId="u1" onSchedulePost={onSchedulePost} />);
    await screen.findByText('No scheduled posts');
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    const timeInput = container.querySelector('input[type="time"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2099-01-01' } });
    fireEvent.change(timeInput, { target: { value: '' } });
    fireEvent.click(screen.getByText('Schedule Post'));
    expect(onSchedulePost).not.toHaveBeenCalled();
  });

  it('cancels a scheduled post via the trash button', async () => {
    apiGet.mockResolvedValue({
      data: { posts: [{ postId: 'p9', content: 'Cancel me', scheduledAt: FUTURE }] },
    });
    wrap(<PostScheduler userId="u1" />);
    await screen.findByText('Cancel me');
    fireEvent.click(screen.getByTitle('Cancel scheduled post'));
    await waitFor(() =>
      expect(apiDelete).toHaveBeenCalledWith('/api/social/scheduled/p9'),
    );
  });

  it('does not query when userId is empty', () => {
    wrap(<PostScheduler userId="" />);
    expect(apiGet).not.toHaveBeenCalled();
  });
});
