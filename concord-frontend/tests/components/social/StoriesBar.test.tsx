import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
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
vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a) },
}));

import { StoriesBar } from '@/components/social/StoriesBar';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const STORIES = [
  { id: 'st1', userId: 'a', displayName: 'Alice', content: 'Hello', createdAt: '2026-05-01' },
  { id: 'st2', userId: 'a', mediaUrl: '/img.png', createdAt: '2026-05-02', duration: 3 },
  { id: 'st3', userId: 'b', displayName: 'Bob', avatarUrl: '/b.png', title: 'Bob title', createdAt: '2026-05-03' },
];

describe('StoriesBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockResolvedValue({ data: { stories: [] } });
    Element.prototype.scrollBy = vi.fn();
  });
  afterEach(() => cleanup());

  it('renders the Your Story button with empty data', async () => {
    wrap(<StoriesBar currentUserId="u1" />);
    expect(await screen.findByText('Your Story')).toBeInTheDocument();
  });

  it('groups stories by user and renders circles', async () => {
    apiGet.mockResolvedValue({ data: { stories: STORIES } });
    wrap(<StoriesBar currentUserId="u1" />);
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    // Bob has an avatar
    expect(screen.getByAltText('Bob')).toBeInTheDocument();
  });

  it('invokes onCreateStory when Your Story is clicked', async () => {
    const onCreateStory = vi.fn();
    wrap(<StoriesBar currentUserId="u1" onCreateStory={onCreateStory} />);
    fireEvent.click(await screen.findByText('Your Story'));
    expect(onCreateStory).toHaveBeenCalled();
  });

  it('scroll buttons call scrollBy in both directions', async () => {
    wrap(<StoriesBar currentUserId="u1" />);
    await screen.findByText('Your Story');
    fireEvent.click(screen.getByLabelText('Previous'));
    fireEvent.click(screen.getByLabelText('Next'));
    expect(Element.prototype.scrollBy).toHaveBeenCalledTimes(2);
  });

  it('opens the story viewer and shows text content, closes via Escape', async () => {
    apiGet.mockResolvedValue({ data: { stories: STORIES } });
    wrap(<StoriesBar currentUserId="u1" />);
    const alice = await screen.findByText('Alice');
    fireEvent.click(alice.closest('button')!);
    // viewer renders the story text content
    expect(await screen.findByText('Hello')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await waitFor(() => expect(screen.queryByText('Hello')).toBeNull());
  });

  it('navigates between stories with arrow keys in the viewer', async () => {
    apiGet.mockResolvedValue({ data: { stories: STORIES } });
    wrap(<StoriesBar currentUserId="u1" />);
    const alice = await screen.findByText('Alice');
    fireEvent.click(alice.closest('button')!);
    await screen.findByText('Hello');
    // ArrowRight advances to Alice's second story (image), then to Bob
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })));
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('closes the viewer via the X button', async () => {
    apiGet.mockResolvedValue({ data: { stories: STORIES } });
    wrap(<StoriesBar currentUserId="u1" />);
    const alice = await screen.findByText('Alice');
    fireEvent.click(alice.closest('button')!);
    await screen.findByText('Hello');
    fireEvent.click(screen.getByLabelText('Close'));
    await waitFor(() => expect(screen.queryByText('Hello')).toBeNull());
  });

  it('does not query when currentUserId is empty', () => {
    wrap(<StoriesBar currentUserId="" />);
    expect(apiGet).not.toHaveBeenCalled();
  });
});
