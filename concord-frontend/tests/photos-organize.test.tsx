/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
const addToastMock = vi.fn();
vi.mock('@/store/ui', () => ({
  useUIStore: (selector: (s: { addToast: typeof addToastMock }) => unknown) => selector({ addToast: addToastMock }),
}));

import PhotosLensPage from '@/app/lenses/photos/page';

const NOW = Math.floor(Date.now() / 1000);
const PHOTOS = [
  { id: 'p1', caption: 'Beach day', taken_at: NOW - 60, dtu_id: null, favorite: 0 },
  { id: 'p2', caption: 'Mountain hut', taken_at: NOW - 120, dtu_id: null, favorite: 1 },
];
const json = (body: unknown, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);

beforeEach(() => { addToastMock.mockReset(); vi.restoreAllMocks(); });

describe('photos lens — organize', () => {
  it('search filters by caption and favorites view shows only starred photos', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => json({ ok: true, photos: PHOTOS }));
    render(<PhotosLensPage />);
    await screen.findByText('Beach day');
    fireEvent.change(screen.getByLabelText('Search captions'), { target: { value: 'mount' } });
    expect(screen.queryByText('Beach day')).toBeNull();
    expect(screen.getByText('Mountain hut')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search captions'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Favorites' }));
    expect(screen.queryByText('Beach day')).toBeNull();
    expect(screen.getByText('Mountain hut')).toBeInTheDocument();
  });

  it('favorite toggles optimistically and rolls back with an error toast when the server refuses', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL) =>
      String(input).includes('/update') ? json({ ok: false, error: 'not_owner' }, false, 403) : json({ ok: true, photos: PHOTOS }));
    render(<PhotosLensPage />);
    const star = await screen.findByLabelText('Favorite Beach day');
    await act(async () => { fireEvent.click(star); });
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(screen.getByLabelText('Favorite Beach day')).toHaveAttribute('aria-pressed', 'false');
  });

  it('caption edit posts the new caption and shows what the server returned', async () => {
    const posted: unknown[] = [];
    vi.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/p1/update')) {
        posted.push(JSON.parse(String(init?.body)));
        return json({ ok: true, photo: { id: 'p1', caption: 'Beach at noon' } });
      }
      return json({ ok: true, photos: PHOTOS });
    });
    render(<PhotosLensPage />);
    fireEvent.click(await screen.findByLabelText('Edit caption Beach day'));
    fireEvent.change(screen.getByLabelText('Caption for Beach day'), { target: { value: 'Beach at noon' } });
    await act(async () => { fireEvent.click(screen.getByText('Save')); });
    await screen.findByText('Beach at noon');
    expect(posted).toEqual([{ caption: 'Beach at noon' }]);
  });

  it('albums view lists real albums and adding a photo posts membership', async () => {
    const calls: string[] = [];
    vi.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method || 'GET'} ${url}`);
      if (url.endsWith('/api/photos/albums')) return json({ ok: true, albums: [{ id: 'a1', name: 'Trip', count: 0, cover_photo_id: null }] });
      if (url.includes('/albums/a1/items')) return json({ ok: true });
      return json({ ok: true, photos: PHOTOS });
    });
    render(<PhotosLensPage />);
    await screen.findByText('Beach day');
    expect(calls.some((c) => c.includes('/albums'))).toBe(false);
    await act(async () => { fireEvent.click(screen.getByLabelText('Add Beach day to album')); });
    await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: 'Trip' })); });
    expect(calls).toContain('POST /api/photos/albums/a1/items');
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Albums' })); });
    expect(await screen.findByLabelText('Open album Trip')).toBeInTheDocument();
  });
});
