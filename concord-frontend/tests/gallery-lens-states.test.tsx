/**
 * /lenses/gallery — one wall.
 *
 * Hang a work calls gallery.artwork-save and shows the title only after
 * gallery.collection-detail contains that artwork id.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

const { lensRun, authUser } = vi.hoisted(() => ({
  lensRun: vi.fn(),
  authUser: { current: null as { username: string } | null },
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser.current, isLoading: false, isAuthenticated: !!authUser.current }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import GalleryPage from '@/app/lenses/gallery/page';

function list(collections: { id: string; artworkCount: number }[]) {
  return { data: { ok: true, result: { collections }, error: null } };
}

function detail(artworks: { id: string; title: string; artist?: string }[]) {
  return { data: { ok: true, result: { collection: { id: 'col_1', artworks } }, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('gallery wall', () => {
  it('F1 TIER: declares the wall as real, persistent account state', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'collection-list') return list([{ id: 'col_1', artworkCount: 0 }]);
      if (action === 'collection-detail') return detail([]);
      throw new Error(action);
    });
    const view = render(<GalleryPage />);
    await view.findByText('The wall is empty.');
    expect(view.getByTestId('gallery-tier')).toHaveTextContent(/Live/);
    expect(view.getByTestId('gallery-tier')).toHaveTextContent(/persisted/);
  });

  it('F2 IMAGE: an image URL is saved and rendered on the wall', async () => {
    const arts: { id: string; title: string; image?: string }[] = [];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string; image?: string }) => {
      if (action === 'collection-list') return list([{ id: 'col_1', artworkCount: arts.length }]);
      if (action === 'collection-detail') return detail(arts);
      if (action === 'artwork-save') {
        arts.push({ id: 'art_img', title: input?.title || '', image: input?.image });
        return { data: { ok: true, result: { artwork: { id: 'art_img' }, collectionId: 'col_1' }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<GalleryPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Hang a work' }));
    fireEvent.change(view.getByTestId('gallery-title'), { target: { value: 'Framed study' } });
    fireEvent.change(view.getByTestId('gallery-image-url'), { target: { value: 'https://example.org/art.png' } });
    fireEvent.click(view.getByRole('button', { name: 'Hang a work' }));
    const heading = await view.findByRole('heading', { name: 'Framed study' });
    expect(heading).toBeInTheDocument();
    const img = view.getByAltText('Framed study') as HTMLImageElement;
    expect(img.src).toBe('https://example.org/art.png');
    const save = lensRun.mock.calls.find((call) => call[1] === 'artwork-save');
    expect(save?.[2]).toEqual({ title: 'Framed study', image: 'https://example.org/art.png' });
  });

  it('F3 RENAME: edits a work title in place via artwork-update', async () => {
    const arts: { id: string; title: string }[] = [{ id: 'art_1', title: 'Old title' }];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string }) => {
      if (action === 'collection-list') return list([{ id: 'col_1', artworkCount: arts.length }]);
      if (action === 'collection-detail') return detail(arts);
      if (action === 'artwork-update') {
        arts[0] = { ...arts[0], title: input?.title || arts[0].title };
        return { data: { ok: true, result: { artwork: { id: 'art_1' } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<GalleryPage />);
    await view.findByRole('heading', { name: 'Old title' });
    fireEvent.click(view.getByRole('button', { name: 'Rename' }));
    const input = view.getByTestId('gallery-edit-title-art_1');
    fireEvent.change(input, { target: { value: 'New title' } });
    fireEvent.click(view.getByRole('button', { name: 'Save' }));
    expect(await view.findByRole('heading', { name: 'New title' })).toBeInTheDocument();
    const update = lensRun.mock.calls.find((call) => call[1] === 'artwork-update');
    expect(update?.[2]).toEqual({ collectionId: 'col_1', artworkId: 'art_1', title: 'New title' });
  });

  it('F3 TAKEDOWN: removes a work via artwork-remove and it leaves the wall', async () => {
    const arts: { id: string; title: string }[] = [{ id: 'art_1', title: 'Doomed study' }];
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'collection-list') return list([{ id: 'col_1', artworkCount: arts.length }]);
      if (action === 'collection-detail') return detail(arts);
      if (action === 'artwork-remove') {
        arts.length = 0;
        return { data: { ok: true, result: { removed: true }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<GalleryPage />);
    await view.findByRole('heading', { name: 'Doomed study' });
    // Take-down is two-step (#2231): the first click arms it, the confirm button does it.
    fireEvent.click(view.getByRole('button', { name: 'Take down' }));
    fireEvent.click(await view.findByRole('button', { name: 'Confirm take down' }));
    expect(await view.findByText('The wall is empty.')).toBeInTheDocument();
    const remove = lensRun.mock.calls.find((call) => call[1] === 'artwork-remove');
    expect(remove?.[2]).toEqual({ collectionId: 'col_1', artworkId: 'art_1' });
  });

  it('EMPTY: says the wall is empty and offers Hang a work', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'collection-list') return list([{ id: 'col_1', artworkCount: 0 }]);
      if (action === 'collection-detail') return detail([]);
      throw new Error(action);
    });
    const view = render(<GalleryPage />);
    expect(await view.findByText('The wall is empty.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'Gallery' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Hang a work' })).toBeEnabled();
    expect(view.queryByText('Browse')).toBeNull();
    expect(view.queryByText('Sigil gallery')).toBeNull();
    expect(view.queryByText('Unknown')).toBeNull();
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'collection-list') return { data: { ok: false, result: null, error: 'STATE unavailable' } };
      throw new Error(action);
    });
    const view = render(<GalleryPage />);
    expect(await view.findByRole('alert')).toHaveTextContent(/STATE unavailable/);
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'collection-list') return list([{ id: 'col_1', artworkCount: 0 }]);
      if (action === 'collection-detail') return detail([]);
      throw new Error(action);
    });
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('The wall is empty.')).toBeInTheDocument();
  });

  it('HANG: a blank title does not call artwork-save', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'collection-list') return list([{ id: 'col_1', artworkCount: 0 }]);
      if (action === 'collection-detail') return detail([]);
      throw new Error(action);
    });
    const view = render(<GalleryPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Hang a work' }));
    fireEvent.click(view.getByRole('button', { name: 'Hang a work' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A title is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('artwork-save');
  });

  it('HANG: shows the title only after collection-detail contains the id', async () => {
    const arts: { id: string; title: string; artist?: string }[] = [];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string }) => {
      if (action === 'collection-list') return list([{ id: 'col_1', artworkCount: arts.length }]);
      if (action === 'collection-detail') return detail(arts);
      if (action === 'artwork-save') {
        arts.push({ id: 'art_1', title: input?.title || '', artist: 'Unknown' });
        return { data: { ok: true, result: { artwork: { id: 'art_1' }, collectionId: 'col_1' }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<GalleryPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Hang a work' }));
    fireEvent.change(view.getByTestId('gallery-title'), { target: { value: 'Study 2246' } });
    fireEvent.click(view.getByRole('button', { name: 'Hang a work' }));
    expect(await view.findByRole('heading', { name: 'Study 2246' })).toBeInTheDocument();
    expect(view.queryByText('The wall is empty.')).toBeNull();
    expect(view.queryByText('Unknown')).toBeNull();
    const save = lensRun.mock.calls.find((call) => call[1] === 'artwork-save');
    expect(save?.[2]).toEqual({ title: 'Study 2246' });
  });

  it('HANG: a detail miss does not show the title', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'collection-list') return list([{ id: 'col_1', artworkCount: 0 }]);
      if (action === 'collection-detail') return detail([]);
      if (action === 'artwork-save') {
        return { data: { ok: true, result: { artwork: { id: 'art_missing' }, collectionId: 'col_1' }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<GalleryPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Hang a work' }));
    fireEvent.change(view.getByTestId('gallery-title'), { target: { value: 'Lost study' } });
    fireEvent.click(view.getByRole('button', { name: 'Hang a work' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.queryByRole('heading', { name: 'Lost study' })).toBeNull();
  });

  it('HEADER: shows the lens name signed-in', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'collection-list') return list([]);
      throw new Error(action);
    });
    const view = render(<GalleryPage />);
    expect(await view.findByRole('heading', { name: 'Gallery' })).toBeInTheDocument();
    expect(await view.findByText('The wall is empty.')).toBeInTheDocument();
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('collection-detail');
  });

  it('LOAD: shows titles already in collection-detail and skips a blank title', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'collection-list') return list([{ id: 'col_1', artworkCount: 2 }]);
      if (action === 'collection-detail') {
        return detail([
          { id: 'art_a', title: 'First study', artist: 'Unknown' },
          { id: 'art_b', title: '   ', artist: 'Unknown' },
        ]);
      }
      throw new Error(action);
    });
    const view = render(<GalleryPage />);
    expect(await view.findByRole('heading', { name: 'First study' })).toBeInTheDocument();
    expect(view.queryByText('The wall is empty.')).toBeNull();
    expect(view.queryByText('Unknown')).toBeNull();
  });

  it('LOAD: a failed detail is an error, not an empty wall', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'collection-list') return list([{ id: 'col_1', artworkCount: 1 }]);
      if (action === 'collection-detail') return { data: { ok: false, result: null, error: 'collection not found' } };
      throw new Error(action);
    });
    const view = render(<GalleryPage />);
    expect(await view.findByRole('alert')).toHaveTextContent(/collection not found/);
    expect(view.queryByText('The wall is empty.')).toBeNull();
  });

  it('HANG: a refused save does not show the title', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'collection-list') return list([{ id: 'col_1', artworkCount: 0 }]);
      if (action === 'collection-detail') return detail([]);
      if (action === 'artwork-save') {
        return { data: { ok: false, result: null, error: 'artwork already in this collection' } };
      }
      throw new Error(action);
    });
    const view = render(<GalleryPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Hang a work' }));
    fireEvent.change(view.getByTestId('gallery-title'), { target: { value: '  Study 2246  ' } });
    fireEvent.click(view.getByRole('button', { name: 'Hang a work' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/already in this collection/);
    expect(view.queryByRole('heading', { name: 'Study 2246' })).toBeNull();
    const save = lensRun.mock.calls.find((call) => call[1] === 'artwork-save');
    expect(save?.[2]).toEqual({ title: 'Study 2246' });
  });

  it('HANG: a second work stays beside the first when detail returns both', async () => {
    const arts: { id: string; title: string }[] = [{ id: 'art_1', title: 'First study' }];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { title?: string }) => {
      if (action === 'collection-list') return list([{ id: 'col_1', artworkCount: arts.length }]);
      if (action === 'collection-detail') return detail(arts);
      if (action === 'artwork-save') {
        arts.push({ id: 'art_2', title: input?.title || '' });
        return { data: { ok: true, result: { artwork: { id: 'art_2' }, collectionId: 'col_1' }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<GalleryPage />);
    expect(await view.findByRole('heading', { name: 'First study' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Hang a work' }));
    fireEvent.change(view.getByTestId('gallery-title'), { target: { value: 'Second study' } });
    fireEvent.click(view.getByRole('button', { name: 'Hang a work' }));
    expect(await view.findByRole('heading', { name: 'Second study' })).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'First study' })).toBeInTheDocument();
  });
});
