import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const addToast = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn().mockResolvedValue({ data: { ok: true, results: [] } }), post: vi.fn() },
}));
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => ({ addToast }), { getState: () => ({ addToast }) }),
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
    localStorage.clear();
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

  it('clicking Post and Ctrl+Enter both call the API, and success clears the text', async () => {
    const onPosted = vi.fn();
    const { container, unmount } = render(withQuery(
      React.createElement(QuickPostComposer, { currentUserId: 'me', onPosted }),
      qc,
    ));
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'zuko r5 check' } });
    fireEvent.click(container.querySelector('button[type="submit"]')!);
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith(
      '/api/social/post',
      expect.objectContaining({ content: 'zuko r5 check' }),
    ));
    await waitFor(() => expect(textarea.value).toBe(''));
    expect(onPosted).toHaveBeenCalledWith('post_x');
    unmount();

    mockedApi.post.mockClear();
    onPosted.mockClear();
    mockedApi.post.mockResolvedValue({ data: { ok: true, post: { id: 'post_y' } } });
    const again = render(withQuery(
      React.createElement(QuickPostComposer, { currentUserId: 'me', onPosted }),
      qc,
    ));
    const box = again.container.querySelector('textarea')!;
    fireEvent.change(box, { target: { value: 'from the keyboard' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith(
      '/api/social/post',
      expect.objectContaining({ content: 'from the keyboard' }),
    ));
    await waitFor(() => expect(box.value).toBe(''));
  });

  it('ok:false, 4xx, and network error each toast and keep the text', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { ok: false, error: 'duplicate post' } });
    const { container, unmount } = render(withQuery(
      React.createElement(QuickPostComposer, { currentUserId: 'me' }),
      qc,
    ));
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'keep me' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'duplicate post' }),
    ));
    expect(textarea.value).toBe('keep me');
    unmount();

    addToast.mockClear();
    mockedApi.post.mockRejectedValueOnce({ response: { status: 400, data: { ok: false, error: 'bad request' } } });
    const four = render(withQuery(
      React.createElement(QuickPostComposer, { currentUserId: 'me' }),
      qc,
    ));
    const fourBox = four.container.querySelector('textarea')!;
    fireEvent.change(fourBox, { target: { value: 'keep 4xx' } });
    fireEvent.submit(four.container.querySelector('form')!);
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'bad request' }),
    ));
    expect(fourBox.value).toBe('keep 4xx');
    four.unmount();

    addToast.mockClear();
    mockedApi.post.mockRejectedValueOnce(new Error('Network Error'));
    const net = render(withQuery(
      React.createElement(QuickPostComposer, { currentUserId: 'me' }),
      qc,
    ));
    const netBox = net.container.querySelector('textarea')!;
    fireEvent.change(netBox, { target: { value: 'keep net' } });
    fireEvent.submit(net.container.querySelector('form')!);
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Network Error' }),
    ));
    expect(netBox.value).toBe('keep net');
  });

  it('keeps the visibility choice after remount and toasts only after the server accepts the post', async () => {
    const { container, unmount } = render(withQuery(
      React.createElement(QuickPostComposer, { currentUserId: 'me' }),
      qc,
    ));
    const select = container.querySelector('select[aria-label="Who can see this"]') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'private' } });
    expect(localStorage.getItem('concord.social.composerPrivacy.me')).toBe('private');
    unmount();

    const again = render(withQuery(
      React.createElement(QuickPostComposer, { currentUserId: 'me' }),
      qc,
    ));
    const restored = again.container.querySelector('select[aria-label="Who can see this"]') as HTMLSelectElement;
    expect(restored.value).toBe('private');
    fireEvent.change(again.container.querySelector('textarea')!, { target: { value: 'kept private' } });
    fireEvent.submit(again.container.querySelector('form')!);
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Posted.' }),
    ));
    expect(mockedApi.post).toHaveBeenCalledWith('/api/social/post', expect.objectContaining({ privacy: 'private' }));
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

  it('at narrow width every composer option and the Post button stay reachable (no clipped right edge)', () => {
    // Real defect: the options row was a single no-wrap flex line inside the
    // form's overflow-hidden shell, so at 375-414 px everything past the tags
    // input ('Who can reply', visibility, server, Save draft, Post) was
    // clipped off the right edge. Structure assertion (jsdom has no
    // layout): the row now wraps and holds every control including the
    // submit button, so nothing can exceed the form's width.
    const { container } = render(withQuery(
      React.createElement(QuickPostComposer, { currentUserId: 'me' }),
      qc,
    ));
    const post = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(post).not.toBeNull();
    expect(post.getAttribute('aria-label')).toBe('Post');
    expect(post.className).toContain('min-h-[44px]');
    expect(post.className).toContain('ml-auto');
    const row = post.parentElement as HTMLElement;
    expect(row.className).toContain('flex-wrap');
    for (const label of ['Who can see this', 'Who can reply']) {
      const select = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
      expect(select).not.toBeNull();
      expect(row.contains(select)).toBe(true);
      expect(select.className).toContain('max-w-full');
    }
    const saveDraft = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Save draft');
    expect(saveDraft).toBeTruthy();
    expect(row.contains(saveDraft!)).toBe(true);
    const federation = container.querySelector('select[aria-label="Federation visibility"]') as HTMLSelectElement;
    expect(federation).not.toBeNull();
    expect(row.contains(federation)).toBe(true);
  });
});
