import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('div', props, props.children),
    },
  ),
}));
vi.mock('@/lib/api/client', () => ({ api: { post: vi.fn() } }));

import { GroupCard, GroupData } from '@/components/social/GroupCard';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as { post: ReturnType<typeof vi.fn> };

function withQuery(node: React.ReactElement, qc: QueryClient) {
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

const GROUP: GroupData = {
  groupId: 'g1',
  name: 'Rust Devs',
  description: 'A group',
  memberCount: 120,
  tags: ['rust', 'wasm', 'systems', 'extra'],
};

describe('GroupCard', () => {
  let qc: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    mockedApi.post.mockResolvedValue({ data: { ok: true } });
  });
  afterEach(() => {
    cleanup();
    qc.clear();
  });

  it('renders name, description and tags (capped at 3 + overflow)', () => {
    render(withQuery(<GroupCard group={GROUP} />, qc));
    expect(screen.getByText('Rust Devs')).toBeInTheDocument();
    expect(screen.getByText('rust')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('shows Join when not a member', () => {
    render(withQuery(<GroupCard group={GROUP} />, qc));
    expect(screen.getByText('Join')).toBeInTheDocument();
  });

  it('shows Leave when isMember=true', () => {
    render(withQuery(<GroupCard group={{ ...GROUP, isMember: true }} />, qc));
    expect(screen.getByText('Leave')).toBeInTheDocument();
  });

  it('clicking Join fires the join endpoint and flips to Leave', async () => {
    render(withQuery(<GroupCard group={GROUP} />, qc));
    fireEvent.click(screen.getByText('Join'));
    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/api/social/group/g1/join'),
    );
    expect(await screen.findByText('Leave')).toBeInTheDocument();
  });

  it('clicking Leave fires the leave endpoint', async () => {
    render(withQuery(<GroupCard group={{ ...GROUP, isMember: true }} />, qc));
    fireEvent.click(screen.getByText('Leave'));
    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/api/social/group/g1/leave'),
    );
  });

  it('clicking the card calls onNavigate', () => {
    const onNav = vi.fn();
    render(withQuery(<GroupCard group={GROUP} onNavigate={onNav} />, qc));
    fireEvent.click(screen.getByText('Rust Devs'));
    expect(onNav).toHaveBeenCalledWith('g1');
  });

  it('renders no tag row when tags is empty', () => {
    render(withQuery(<GroupCard group={{ ...GROUP, tags: [] }} />, qc));
    expect(screen.queryByText('rust')).toBeNull();
  });
});
