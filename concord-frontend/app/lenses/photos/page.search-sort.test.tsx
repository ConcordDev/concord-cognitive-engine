// @vitest-environment jsdom
/**
 * FIX-photos-010 — Photos had no sort control, and the caption search
 * text was lost on reload. The search and the sort now live in the URL
 * (?q=beach&sort=oldest): read at first render, written back on change
 * via history.replaceState, and the grid sorts newest / oldest /
 * caption A–Z (Google Photos keeps the query in the URL the same way).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/store/ui', () => ({
  useUIStore: (selector: (s: { addToast: () => void }) => unknown) => selector({ addToast: vi.fn() }),
}));
vi.mock('@/components/photos/PhotoLightboxModal', () => ({ PhotoLightboxModal: () => null }));
vi.mock('@/components/common/StickyDeleteConfirm', () => ({ StickyDeleteConfirm: () => null }));

import PhotosLensPage from './page';

const PHOTOS = [
  { id: 'p1', caption: 'beach sunset', dtu_id: null, taken_at: 1700000000, favorite: false },
  { id: 'p2', caption: 'mountain hike', dtu_id: null, taken_at: 1750000000, favorite: false },
  { id: 'p3', caption: 'beach house', dtu_id: null, taken_at: 1650000000, favorite: true },
];

function setUrl(path: string) {
  window.history.replaceState(null, '', path);
}

function mockFetch() {
  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url === '/api/photos/mine') {
      return { ok: true, status: 200, json: async () => ({ ok: true, photos: PHOTOS }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }) as unknown as typeof fetch;
}

function listOrder(): string[] {
  const list = screen.getByTestId('photos-list');
  return ['beach sunset', 'mountain hike', 'beach house'].filter(
    (c) => list.textContent?.includes(c),
  ).sort((a, b) => (list.textContent?.indexOf(a) ?? 0) - (list.textContent?.indexOf(b) ?? 0));
}

describe('Photos lens — search + sort in the URL (FIX-photos-010)', () => {
  beforeEach(() => {
    mockFetch();
    setUrl('/lenses/photos');
  });
  afterEach(() => {
    cleanup();
    setUrl('/');
    vi.restoreAllMocks();
  });

  it('opens with the search named by ?q= already applied', async () => {
    setUrl('/lenses/photos?q=beach');
    render(React.createElement(PhotosLensPage));
    const input = (await screen.findByLabelText('Search captions')) as HTMLInputElement;
    expect(input.value).toBe('beach');
    await waitFor(() => expect(screen.getByTestId('photos-list')).toBeTruthy());
    expect(screen.getByText('beach sunset')).toBeTruthy();
    expect(screen.getByText('beach house')).toBeTruthy();
    expect(screen.queryByText('mountain hike')).toBeNull();
  });

  it('typing a search writes ?q=, and a fresh mount (reload) restores it', async () => {
    const first = render(React.createElement(PhotosLensPage));
    const input = (await screen.findByLabelText('Search captions')) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'mountain' } });
    });
    expect(new URLSearchParams(window.location.search).get('q')).toBe('mountain');

    first.unmount();
    render(React.createElement(PhotosLensPage));
    const input2 = (await screen.findByLabelText('Search captions')) as HTMLInputElement;
    expect(input2.value).toBe('mountain');
    await waitFor(() => expect(screen.getByText('mountain hike')).toBeTruthy());
    expect(screen.queryByText('beach sunset')).toBeNull();
  });

  it('sorts oldest first on request, keeps it in ?sort=, and across a reload', async () => {
    const first = render(React.createElement(PhotosLensPage));
    await screen.findByLabelText('Search captions');
    await waitFor(() => expect(screen.getByTestId('photos-list')).toBeTruthy());
    // Default (newest first): mountain (2025) → beach sunset (2023) → beach house (2022).
    expect(listOrder()).toEqual(['mountain hike', 'beach sunset', 'beach house']);

    const select = screen.getByLabelText('Sort photos') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: 'oldest' } });
    });
    expect(listOrder()).toEqual(['beach house', 'beach sunset', 'mountain hike']);
    expect(new URLSearchParams(window.location.search).get('sort')).toBe('oldest');

    first.unmount();
    render(React.createElement(PhotosLensPage));
    await screen.findByLabelText('Search captions');
    await waitFor(() => expect(screen.getByTestId('photos-list')).toBeTruthy());
    expect((screen.getByLabelText('Sort photos') as HTMLSelectElement).value).toBe('oldest');
    expect(listOrder()).toEqual(['beach house', 'beach sunset', 'mountain hike']);
  });
});
