import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn().mockResolvedValue({ data: { ok: true, results: [] } }), post: vi.fn() },
}));

import { QuickPostComposer } from '@/components/social/QuickPostComposer';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

function withQuery(node: React.ReactElement, qc: QueryClient) {
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

describe('QuickPostComposer', () => {
  let qc: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    mockedApi.post.mockResolvedValue({ data: { ok: true, post: { id: 'post_x' } } });
  });
  afterEach(() => { cleanup(); qc.clear(); });

  it('disables submit on empty input', () => {
    const { container } = render(withQuery(
      React.createElement(QuickPostComposer, { currentUserId: 'me' }),
      qc,
    ));
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    expect(submit).not.toBeNull();
    expect(submit!.disabled).toBe(true);
  });

  it('blocks submit over 500 chars and styles the counter red', async () => {
    const { container } = render(withQuery(
      React.createElement(QuickPostComposer, { currentUserId: 'me' }),
      qc,
    ));
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'a'.repeat(501) } });
    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('sends a real POST /api/social/post on submit', async () => {
    const { container } = render(withQuery(
      React.createElement(QuickPostComposer, { currentUserId: 'me' }),
      qc,
    ));
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'hello world' } });
    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/api/social/post', expect.objectContaining({ content: 'hello world' })));
  });

  it('story mode sends isStory=true + expiresAt', async () => {
    const { container, getByText } = render(withQuery(
      React.createElement(QuickPostComposer, { currentUserId: 'me' }),
      qc,
    ));
    fireEvent.click(getByText(/24h Story/i));
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'just now' } });
    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    await waitFor(() => {
      const last = mockedApi.post.mock.calls[mockedApi.post.mock.calls.length - 1];
      expect(last[0]).toBe('/api/social/post');
      expect(last[1].isStory).toBe(true);
      expect(typeof last[1].expiresAt).toBe('string');
    });
  });
});
