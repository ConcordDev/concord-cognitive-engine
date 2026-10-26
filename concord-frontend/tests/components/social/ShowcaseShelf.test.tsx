/**
 * ShowcaseShelf — up to 6 of the owner's own public creations (job
 * oc-social-5, Social identity / JOB 8).
 *
 * Everything runs against the mocked HTTP layer (@/lib/api/client):
 * pin/unpin hit the real routes, order is kept by the up/down controls,
 * the max-6 cap is enforced in the UI (the Add button is disabled and
 * says Full), and a viewer's empty shelf renders nothing at all. The
 * shelf itself only renders what the SERVER sanitized into the profile
 * response — no fake items.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
    delete: (...a: unknown[]) => apiDelete(...a),
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

import { ShowcaseShelf, SHOWCASE_MAX, type ShowcaseItem } from '@/components/social/ShowcaseShelf';

const POST_PIN: ShowcaseItem = {
  kind: 'post',
  id: 'post_1',
  content: 'My latest render',
  title: 'Studio render',
  mediaType: 'image',
  mediaUrl: '/api/artifact/img/stream',
  media: [{ kind: 'image', url: '/api/artifact/img/stream' }],
  createdAt: '2026-10-01T00:00:00.000Z',
};

const LISTING_PIN: ShowcaseItem = {
  kind: 'listing',
  id: 'lst_1',
  title: 'Midnight Loop',
  price: 12,
};

const OPTIONS = {
  ok: true,
  options: [
    { kind: 'post', id: 'post_1', label: 'Studio render', detail: 'image', alreadyPinned: true },
    { kind: 'post', id: 'post_2', label: 'Behind the scenes', detail: 'video', alreadyPinned: false },
    { kind: 'listing', id: 'lst_1', label: 'Midnight Loop', detail: 'music', alreadyPinned: true },
    { kind: 'listing', id: 'lst_2', label: 'Sunrise Tape', detail: 'music', alreadyPinned: false },
  ],
};

function pins(count: number): ShowcaseItem[] {
  const base = [POST_PIN, LISTING_PIN];
  const out: ShowcaseItem[] = [];
  for (let i = 0; i < count; i++) {
    const pick = base[i % 2];
    out.push(i < 2 ? pick : { ...pick, id: `${pick.kind}_extra_${i}` });
  }
  return out;
}

function renderShelf(props: { showcase?: ShowcaseItem[]; isOwner?: boolean }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ShowcaseShelf
        userId="alice"
        showcase={props.showcase ?? []}
        isOwner={props.isOwner ?? false}
        onOpenPost={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('ShowcaseShelf', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiDelete.mockReset();
    apiGet.mockResolvedValue({ data: OPTIONS });
    apiPost.mockResolvedValue({ data: { ok: true } });
    apiDelete.mockResolvedValue({ data: { ok: true } });
  });
  afterEach(() => {
    cleanup();
  });

  it('renders the server-sanitized pins for every viewer, in order', () => {
    renderShelf({ showcase: [POST_PIN, LISTING_PIN] });
    expect(screen.getByRole('region', { name: 'Showcase' })).toBeTruthy();
    expect(screen.getByText('Studio render')).toBeTruthy();
    // The listing title appears on the pin card and inside the commerce
    // card — both are the real server payload, so require both renders.
    expect(screen.getAllByText('Midnight Loop').length).toBe(2);
    // No owner controls for a viewer.
    expect(screen.queryByRole('button', { name: /Add to Showcase/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove .* from Showcase/ })).toBeNull();
  });

  it('renders nothing at all for a viewer when the shelf is empty (no fake cards)', () => {
    const { container } = renderShelf({ showcase: [], isOwner: false });
    expect(container.firstElementChild).toBeNull();
  });

  it('pins a chosen creation through the real route', async () => {
    renderShelf({ showcase: [POST_PIN], isOwner: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add to Showcase' }));
    const pinBtn = await screen.findByRole('button', { name: 'Pin Behind the scenes to Showcase' });
    expect(apiGet).toHaveBeenCalledWith('/api/social/identity/showcase/options');
    fireEvent.click(pinBtn);
    await vi.waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/social/identity/showcase/pin', {
        kind: 'post',
        id: 'post_2',
      });
    });
  });

  it('unpins through the real route', async () => {
    renderShelf({ showcase: [POST_PIN, LISTING_PIN], isOwner: true });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Studio render from Showcase' }));
    await vi.waitFor(() => {
      expect(apiDelete).toHaveBeenCalledWith(
        '/api/social/identity/showcase/post/post_1',
      );
    });
  });

  it('reorders with the up/down controls through the real route', async () => {
    renderShelf({ showcase: [POST_PIN, LISTING_PIN], isOwner: true });
    // Move the second item up.
    fireEvent.click(screen.getByRole('button', { name: 'Move Midnight Loop up in Showcase' }));
    await vi.waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/social/identity/showcase/reorder', {
        order: [
          { kind: 'listing', id: 'lst_1' },
          { kind: 'post', id: 'post_1' },
        ],
      });
    });
    // First item's "up" is disabled at the top; last item's "down" is disabled at the bottom.
    expect((screen.getByRole('button', { name: 'Move Studio render up in Showcase' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move Midnight Loop down in Showcase' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('enforces the max-6 cap in the UI: Add disabled, honest Full label', () => {
    renderShelf({ showcase: pins(SHOWCASE_MAX), isOwner: true });
    const add = screen.getByRole('button', { name: 'Add to Showcase' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.textContent).toMatch(new RegExp(`Full \\(${SHOWCASE_MAX}\\)`));
    expect(screen.getByText(`6/${SHOWCASE_MAX} pinned`)).toBeTruthy();
  });

  it('offers more pins while under the cap, and marks already-pinned options Pinned', async () => {
    renderShelf({ showcase: [POST_PIN], isOwner: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add to Showcase' }));
    expect(await screen.findByRole('button', { name: 'Pin Behind the scenes to Showcase' })).toBeTruthy();
    const pinned = await screen.findByRole('button', { name: 'Pin Studio render to Showcase' });
    expect((pinned as HTMLButtonElement).disabled).toBe(true);
    expect(pinned.textContent).toBe('Pinned');
  });

  it('renders an image pin with its real media and an open-post control', () => {
    renderShelf({ showcase: [POST_PIN] });
    const img = screen.getByAltText('Studio render') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/artifact/img/stream');
    expect(screen.getByRole('button', { name: /Open post — Studio render/ })).toBeTruthy();
  });

  it('renders a listing pin with the existing commerce card (real title + price)', () => {
    renderShelf({ showcase: [LISTING_PIN] });
    // Pin card + commerce card both carry the title from the listing.
    expect(screen.getAllByText('Midnight Loop').length).toBe(2);
    expect(screen.getByText('12 CC')).toBeTruthy();
  });

  it('shows the server error when a pin is refused (no silent success)', async () => {
    apiPost.mockResolvedValue({ data: { ok: false, error: 'Showcase is full (max 6).' } });
    renderShelf({ showcase: [], isOwner: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add to Showcase' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pin Behind the scenes to Showcase' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Showcase is full/);
  });
});