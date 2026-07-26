/// <reference types="@testing-library/jest-dom/vitest" />
// Pins SaveToCollectionButton's picker modal — the gallery lens's only
// affordance for populating a saved collection with an artwork
// (components/gallery/SaveToCollectionButton.tsx). Covers the real
// open -> list collections -> save flow plus the modal a11y fix from the
// 2026-07-23 UX-polish audit: the backdrop/dialog `<div onClick>` pair had
// no keyboard dismissal path at all (no Escape, no focus management) —
// this pins that Escape now closes it, focus lands in the dialog on open,
// and clicking inside the dialog body does NOT close it (only a genuine
// backdrop click does).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { SaveToCollectionButton, type SaveableArtwork } from '@/components/gallery/SaveToCollectionButton';

const ARTWORK: SaveableArtwork = {
  refId: 'cma:123',
  title: 'Water Lilies',
  artist: 'Claude Monet',
};

function listResponse(collections: Array<{ id: string; name: string; artworkCount: number }>) {
  return { data: { ok: true, result: { collections } } };
}

describe('SaveToCollectionButton', () => {
  beforeEach(() => lensRun.mockReset());

  it('opens the picker and lists real collections from collection-list', async () => {
    lensRun.mockResolvedValueOnce(listResponse([{ id: 'col_1', name: 'Favorites', artworkCount: 2 }]));
    render(<SaveToCollectionButton artwork={ARTWORK} />);

    fireEvent.click(screen.getByRole('button', { name: /save to collection/i }));

    expect(lensRun).toHaveBeenCalledWith('gallery', 'collection-list', {});
    expect(await screen.findByText('Favorites')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /save to collection/i })).toBeInTheDocument();
  });

  it('saving to a collection calls artwork-save with the artwork fields and closes the modal', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([{ id: 'col_1', name: 'Favorites', artworkCount: 2 }]))
      .mockResolvedValueOnce({ data: { ok: true, result: {} } });

    render(<SaveToCollectionButton artwork={ARTWORK} />);
    fireEvent.click(screen.getByRole('button', { name: /save to collection/i }));
    await screen.findByText('Favorites');

    fireEvent.click(screen.getByText('Favorites'));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('gallery', 'artwork-save', {
      collectionId: 'col_1',
      title: 'Water Lilies',
      artist: 'Claude Monet',
      date: undefined,
      image: undefined,
      museum: undefined,
      refId: 'cma:123',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('pressing Escape closes the modal without saving', async () => {
    lensRun.mockResolvedValueOnce(listResponse([{ id: 'col_1', name: 'Favorites', artworkCount: 2 }]));
    render(<SaveToCollectionButton artwork={ARTWORK} />);
    fireEvent.click(screen.getByRole('button', { name: /save to collection/i }));
    const dialog = await screen.findByRole('dialog', { name: /save to collection/i });

    // Real modal a11y: focus lands inside the dialog on open.
    expect(dialog).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(lensRun).toHaveBeenCalledTimes(1); // only the initial collection-list call
  });

  it('clicking inside the dialog body does not close it; only a genuine backdrop click does', async () => {
    lensRun.mockResolvedValueOnce(listResponse([{ id: 'col_1', name: 'Favorites', artworkCount: 2 }]));
    render(<SaveToCollectionButton artwork={ARTWORK} />);
    fireEvent.click(screen.getByRole('button', { name: /save to collection/i }));
    const dialog = await screen.findByRole('dialog', { name: /save to collection/i });

    fireEvent.click(dialog);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // The backdrop is the dialog's parent `role="presentation"` node.
    fireEvent.click(dialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
