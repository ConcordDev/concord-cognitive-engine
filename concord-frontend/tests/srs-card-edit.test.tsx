/** SRS browser — edit a single card's text and images through card-update + card-set-media. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { SrsWorkbench } from '@/components/srs/SrsWorkbench';

const CARD = { id: 'c1', deckId: 'd1', front: 'mitochondria', back: 'powerhouse', tags: ['bio'], state: 'review', reps: 3, lapses: 0, interval: 6, media: { frontImage: null, backImage: null } };

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((_d: string, action: string) => {
    if (action === 'deck-list' || action === 'deck-tree') return Promise.resolve({ data: { ok: true, result: { decks: [{ id: 'd1', name: 'Bio', options: {} }], tree: [] } } });
    if (action === 'card-browse') return Promise.resolve({ data: { ok: true, result: { cards: [CARD], tags: ['bio'] } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
});

describe('SRS card edit', () => {
  it('saves text through card-update and a new image through card-set-media', async () => {
    render(<SrsWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /browse/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit card' }));
    fireEvent.change(screen.getByLabelText('Back'), { target: { value: 'site of ATP synthesis' } });
    fireEvent.change(screen.getByLabelText('Back image URL'), { target: { value: 'https://example.org/mito.png' } });
    fireEvent.click(screen.getByRole('button', { name: /save card/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('srs', 'card-update', { id: 'c1', front: 'mitochondria', back: 'site of ATP synthesis', tags: ['bio'] }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('srs', 'card-set-media', { id: 'c1', frontImage: null, backImage: 'https://example.org/mito.png' }));
  });

  it('skips card-set-media when images are unchanged', async () => {
    render(<SrsWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /browse/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit card' }));
    fireEvent.change(screen.getByLabelText('Front'), { target: { value: 'Mitochondria' } });
    fireEvent.click(screen.getByRole('button', { name: /save card/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('srs', 'card-update', expect.objectContaining({ front: 'Mitochondria' })));
    expect(lensRunMock).not.toHaveBeenCalledWith('srs', 'card-set-media', expect.anything());
  });
});
