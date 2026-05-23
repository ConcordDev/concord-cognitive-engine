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

vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    React.createElement('img', { src, alt }),
}));

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
  },
}));

import { SuggestedFollows } from '@/components/social/SuggestedFollows';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const SUGGESTIONS = [
  {
    userId: 's1',
    displayName: 'Alice',
    bio: 'builder',
    followerCount: 1200,
    sharedInterests: ['ai', 'rust', 'music', 'art', 'extra'],
    matchScore: 0.87,
    avatarUrl: '/a.png',
  },
  {
    userId: 's2',
    displayName: 'Bob',
    followerCount: 0,
    sharedInterests: [],
    matchScore: 0,
  },
];

describe('SuggestedFollows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockResolvedValue({ data: { suggestions: [] } });
    apiPost.mockResolvedValue({ data: { ok: true } });
  });
  afterEach(() => cleanup());

  it('renders nothing when there are no suggestions', async () => {
    const { container } = wrap(<SuggestedFollows currentUserId="u1" />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('h3')).toBeNull());
  });

  it('renders suggestion cards with follower counts and match score', async () => {
    apiGet.mockResolvedValue({ data: { suggestions: SUGGESTIONS } });
    wrap(<SuggestedFollows currentUserId="u1" />);
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('87% match')).toBeInTheDocument();
    // shared interests sliced to 4
    expect(screen.getByText('ai')).toBeInTheDocument();
    expect(screen.queryByText('extra')).toBeNull();
  });

  it('renders avatar image when avatarUrl present, initial otherwise', async () => {
    apiGet.mockResolvedValue({ data: { suggestions: SUGGESTIONS } });
    wrap(<SuggestedFollows currentUserId="u1" />);
    expect(await screen.findByAltText('Alice')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('follows then unfollows a creator toggling the button label', async () => {
    apiGet.mockResolvedValue({ data: { suggestions: SUGGESTIONS } });
    wrap(<SuggestedFollows currentUserId="u1" />);
    await screen.findByText('Alice');
    const followBtns = screen.getAllByText('Follow');
    fireEvent.click(followBtns[0]);
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/social/follow', { followedId: 's1' }),
    );
    const followingBtn = await screen.findByText('Following');
    fireEvent.click(followingBtn);
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/social/unfollow', { followedId: 's1' }),
    );
  });

  it('dismisses a suggestion, removing it from the list', async () => {
    apiGet.mockResolvedValue({ data: { suggestions: SUGGESTIONS } });
    wrap(<SuggestedFollows currentUserId="u1" />);
    await screen.findByText('Alice');
    const dismissBtns = screen.getAllByLabelText('Dismiss suggestion');
    fireEvent.click(dismissBtns[0]);
    await waitFor(() => expect(screen.queryByText('Alice')).toBeNull());
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('invokes onNavigateToUser when the name button is clicked', async () => {
    apiGet.mockResolvedValue({ data: { suggestions: SUGGESTIONS } });
    const onNavigateToUser = vi.fn();
    wrap(<SuggestedFollows currentUserId="u1" onNavigateToUser={onNavigateToUser} />);
    fireEvent.click(await screen.findByText('Alice'));
    expect(onNavigateToUser).toHaveBeenCalledWith('s1');
  });

  it('does not query when currentUserId is empty', () => {
    wrap(<SuggestedFollows currentUserId="" />);
    expect(apiGet).not.toHaveBeenCalled();
  });
});
