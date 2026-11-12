// FIX-repos-004 — Share > Lens > Social Feed must create a real social post.
// Pins for ContentPublisher:
//  1. The Lens tab's 'Social Feed' entry posts to /api/social/post (never
//     the generic /api/lens/feed artifact create, whose store no feed or
//     profile reads) and the success panel links to the created post.
//  2. When the post route refuses with HTTP 200 + { ok: false } (duplicate,
//     rate limit), neither the Feed tab nor the Lens-tab Social Feed entry
//     shows a success state — the refusal is shown as an alert instead.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiPost = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(async () => ({ data: {} })), post: (...a: unknown[]) => apiPost(...a) },
}));
vi.mock('@/lib/lenses/manifest', () => ({ getLensManifest: () => ({}) }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ContentPublisher } from '@/components/lens/ContentPublisher';

const render = (ui: React.ReactElement) =>
  rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};

beforeEach(() => {
  apiPost.mockReset();
  apiPost.mockResolvedValue({ data: { ok: true, post: { id: 'post_123' } } });
});
afterEach(() => cleanup());

describe('ContentPublisher — Social Feed share', () => {
  it('Lens tab > Social Feed creates a real post and links to it', async () => {
    render(<ContentPublisher domain="repos" artifactId="repo_1" title="My repo" />);
    await settle();
    await press(/^Share$/);
    fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'Check this out' } });
    await press(/^Lens$/);
    await press(/Social Feed/);
    const urls = apiPost.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain('/api/social/post');
    expect(urls).not.toContain('/api/lens/feed');
    expect(document.body.textContent).toMatch(/Posted to your Feed/);
    const link = document.querySelector('a[href="/lenses/social/post/post_123"]');
    expect(link).toBeTruthy();
  });

  it('a refused post (200 + ok:false) is an alert, never a success', async () => {
    apiPost.mockResolvedValue({ data: { ok: false, error: 'duplicate post' } });
    render(<ContentPublisher domain="repos" artifactId="repo_1" title="My repo" />);
    await settle();
    await press(/^Share$/);
    fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'Check this out' } });
    await press(/Post to Feed/);
    expect(document.body.textContent).not.toMatch(/Posted to your Feed/);
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toMatch(/duplicate post/);
  });

  it('the Lens-tab Social Feed entry is honest about a refusal too', async () => {
    apiPost.mockResolvedValue({ data: { ok: false, error: 'slow down: post limit' } });
    render(<ContentPublisher domain="repos" artifactId="repo_1" title="My repo" />);
    await settle();
    await press(/^Share$/);
    fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'Check this out' } });
    await press(/^Lens$/);
    await press(/Social Feed/);
    expect(document.body.textContent).not.toMatch(/Posted to your Feed/);
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/slow down/);
  });
});
