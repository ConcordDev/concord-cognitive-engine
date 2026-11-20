/**
 * The Atelier (Art lens): it opens straight onto a canvas (the linked piece,
 * else your latest, else a fresh one), the old ?artwork= link still works and
 * a hostile id is ignored, the pieces drawer only stretches a named canvas,
 * and "Put on sale" files the rendered picture as your image DTU and consigns
 * it to the Auction House with the piece it came from.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/components/lens/LensAgentFab', () => ({ default: () => null }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/components/art/ArtCanvas', () => ({
  ArtCanvas: ({ artworkId, onExit, onSell }: { artworkId: string; onExit: () => void; onSell?: (c: HTMLCanvasElement | null, a: { id: string; title: string }) => void }) => (
    <div>
      <div data-testid="art-canvas">{artworkId}</div>
      <button type="button" onClick={onExit}>Pieces</button>
      <button type="button" onClick={() => onSell?.(document.createElement('canvas'), { id: artworkId, title: 'Harbour' })}>Put on sale</button>
    </div>
  ),
}));

import { Atelier } from '@/components/art/atelier/Atelier';
import { SellDialog } from '@/components/art/atelier/SellDialog';

const env = (result: unknown) => ({ data: { ok: true, result } });
const piece = (id: string, title = id) => ({ id, title, width: 1280, height: 800, background: '#ffffff', thumbnail: null, layerCount: 1, strokeCount: 3, updatedAt: new Date().toISOString() });
function route(map: Record<string, (input: Record<string, unknown>) => unknown>) {
  lensRun.mockImplementation(async (_d: string, action: string, input: Record<string, unknown>) => (action in map ? env(map[action](input)) : env({})));
}

beforeEach(() => { lensRun.mockReset(); window.history.replaceState({}, '', '/lenses/art'); });
afterEach(cleanup);

describe('opening the Atelier', () => {
  it('opens your latest piece straight onto the canvas', async () => {
    route({ 'artwork-list': () => ({ artworks: [piece('art_new'), piece('art_old')] }) });
    render(<Atelier />);
    await waitFor(() => expect(screen.getByTestId('art-canvas').textContent).toBe('art_new'));
    expect(window.location.search).toBe('?piece=art_new');
  });

  it('the old ?artwork= link (chat drawings) still opens that piece; a hostile id is ignored', async () => {
    route({ 'artwork-list': () => ({ artworks: [piece('art_new'), piece('art_123')] }) });
    window.history.replaceState({}, '', '/lenses/art?artwork=art_123');
    render(<Atelier />);
    await waitFor(() => expect(screen.getByTestId('art-canvas').textContent).toBe('art_123'));
    cleanup();
    window.history.replaceState({}, '', '/lenses/art?artwork=' + encodeURIComponent('../../etc/passwd'));
    render(<Atelier />);
    await waitFor(() => expect(screen.getByTestId('art-canvas').textContent).toBe('art_new'));
  });

  it('a first visit stretches a fresh canvas rather than showing an empty room', async () => {
    let made = false;
    route({
      'artwork-list': () => ({ artworks: made ? [piece('art_first', 'First study')] : [] }),
      'artwork-create': () => { made = true; return { artwork: { id: 'art_first' } }; },
    });
    render(<Atelier />);
    await waitFor(() => expect(screen.getByTestId('art-canvas').textContent).toBe('art_first'));
    expect(lensRun).toHaveBeenCalledWith('art', 'artwork-create', expect.objectContaining({ title: 'First study' }));
  });
});

describe('your pieces', () => {
  it('only stretches a canvas you have named, at the size and ground you chose', async () => {
    route({
      'artwork-list': () => ({ artworks: [piece('art_a', 'Harbour')] }),
      'art-dashboard': () => ({ artworks: 1, totalStrokes: 3, palettes: 0, referenceBoards: 0, promptOfTheDay: { category: 'light', text: 'Paint a window at night.' } }),
      'artwork-create': () => ({ artwork: { id: 'art_b' } }),
    });
    render(<Atelier />);
    await screen.findByTestId('art-canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Pieces' }));
    await screen.findByTestId('at-pieces');
    expect(await screen.findByText('Paint a window at night.')).toBeTruthy();
    const go = screen.getByTestId('at-create') as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('at-new-title'), { target: { value: 'Night window' } });
    fireEvent.click(screen.getByRole('button', { name: /Square/ }));
    fireEvent.click(go);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('art', 'artwork-create', { title: 'Night window', width: 1000, height: 1000, background: '#faf7f1' }));
    await waitFor(() => expect(screen.getByTestId('art-canvas').textContent).toBe('art_b'));
  });
});

describe('putting a piece on sale', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(new Blob(['png-bytes'], { type: 'image/png' })); };
  });
  afterEach(() => vi.unstubAllGlobals());

  it('files the rendered picture as your image DTU, then consigns it with the piece it came from', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ dtuId: 'dtu_img1' }) });
    route({
      'house-lots-for-piece': () => ({ lots: [] }),
      'house-terms': () => ({ combinedRate: 0.0546, balance: 10 }),
      'house-consign': () => ({ lot: { id: 'mel_lot9a2b', title: 'Harbour', price: 20, free: false, status: 'active', sold: 0 } }),
    });
    render(<SellDialog canvas={document.createElement('canvas')} artwork={{ id: 'art_a', title: 'Harbour' }} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('at-sell-price'), { target: { value: '20' } });
    expect(await screen.findByText('18.91 CC')).toBeTruthy(); // 20 less the 5.46% fee
    fireEvent.click(screen.getByTestId('at-sell-go'));
    await waitFor(() => expect(screen.getByTestId('at-sold-ok').textContent).toMatch(/Lot 9A2B at 20 CC/));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/artifact/upload');
    expect(init.headers['Content-Type']).toBe('image/png');
    expect(init.body).toBeInstanceOf(Blob);
    expect(lensRun).toHaveBeenCalledWith('market', 'house-consign', expect.objectContaining({ dtuId: 'dtu_img1', price: 20, license: 'nonexclusive', sourceArtworkId: 'art_a' }));
  });

  it('a failed upload is said plainly and nothing is consigned', async () => {
    fetchSpy.mockResolvedValue({ ok: false, json: async () => ({ error: 'Upload too large' }) });
    route({ 'house-lots-for-piece': () => ({ lots: [] }), 'house-terms': () => ({ combinedRate: 0.0546, balance: 10 }) });
    render(<SellDialog canvas={document.createElement('canvas')} artwork={{ id: 'art_a', title: 'Harbour' }} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('at-sell-go'));
    await waitFor(() => expect(screen.getByTestId('at-sell-error').textContent).toBe('Upload too large'));
    expect(lensRun).not.toHaveBeenCalledWith('market', 'house-consign', expect.anything());
  });
});
