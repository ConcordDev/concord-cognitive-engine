// The Darkroom: the library reads photos.library and culls with the keys a
// photographer uses (optimistic, settled by the server); an import sends the
// file's own bytes; a develop change saves as a named history step; export
// sizes come from the pipeline's own geometry; a release refuses a bad
// price; the wall is public and buying goes through photos.release-buy.
// Mocked at the network; the preview worker is absent in jsdom (the view
// says so instead of pretending to render).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const lensRun = vi.fn();
const apiPost = vi.fn();
const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
  api: { post: (...a: unknown[]) => apiPost(...a), get: (...a: unknown[]) => apiGet(...a) },
}));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import Darkroom from '@/components/photos/darkroom/Darkroom';
import { ExportDialog, ReleaseDialog, sizeAt } from '@/components/photos/darkroom/Dialogs';
import { Prints } from '@/components/photos/darkroom/Prints';
import { defaultEdit } from '@/lib/photos/develop';
import type { Photo } from '@/components/photos/darkroom/dr';

const ok = (result: unknown) => Promise.resolve({ data: { ok: true, result } });
const calls = (a: string) => lensRun.mock.calls.filter((c) => c[1] === a).map((c) => c[2]);
const PHOTO = (id: string, o: Partial<Photo> = {}): Photo => ({
  id, caption: `Frame ${id}`, altText: null, tags: [], favorite: false, rating: 0, flag: 'none', label: null,
  width: 6000, height: 4000, sizeBytes: 8_200_000, filename: `DSCF${id}.JPG`, mime: 'image/jpeg', source: 'import', worldId: null,
  takenAt: 1_790_000_000, capturedAt: 1_790_000_000, camera: 'Fujifilm X-T5', lens: 'XF23mmF2',
  exif: { iso: 400, fNumber: 2.8, exposureTime: 0.008, focalLength: 23 }, edited: false, editedAt: null,
  visibility: 'private', dtuId: null, thumbUrl: `/api/photos/${id}/thumb`, previewUrl: `/api/photos/${id}/preview`, ...o,
});
const FACETS = { total: 2, picks: 0, rejects: 0, rated: 0, labels: {}, keywords: {}, cameras: { 'Fujifilm X-T5': 2 }, concordia: 0 };
function library(photos: Photo[], facets = FACETS) {
  lensRun.mockImplementation((_d: string, a: string, input: { ids?: string[]; rating?: number; flag?: string }) => {
    if (a === 'library') return ok({ photos, total: photos.length, facets, filter: {} });
    if (a === 'album-index') return ok({ albums: [] });
    if (a === 'preset-list') return ok({ presets: [] });
    if (a === 'catalog-set') {
      // the server answers with the rows as they now stand
      for (const p of photos) if (input.ids?.includes(p.id)) { if (input.rating != null) p.rating = input.rating; if (input.flag) p.flag = input.flag as Photo['flag']; }
      return ok({ photos: photos.filter((p) => input.ids?.includes(p.id)).map((p) => ({ ...p })) });
    }
    if (a === 'photo') return ok({ photo: photos[0], edit: defaultEdit(), history: [], releases: [] });
    if (a === 'edit-save') return ok({ edit: defaultEdit(), historyId: 7, edited: true });
    return ok({});
  });
}

beforeEach(() => { lensRun.mockReset(); apiPost.mockReset(); apiGet.mockReset(); });

describe('the library', () => {
  it('reads photos.library and shows the photos with their camera facts', async () => {
    library([PHOTO('a'), PHOTO('b')]);
    render(<Darkroom />);
    expect(await screen.findAllByTestId('dr-thumb')).toHaveLength(2);
    fireEvent.click(screen.getAllByTestId('dr-thumb')[0]);
    const exif = screen.getByTestId('dr-exif');
    expect(exif).toHaveTextContent('Fujifilm X-T5');
    expect(exif).toHaveTextContent('1/125 · ƒ/2.8 · ISO 400');
    expect(exif).toHaveTextContent('6000 × 4000');
    expect(exif).toHaveTextContent('JPEG');
  });
  it('an empty darkroom invites an import, honestly', async () => {
    library([], { ...FACETS, total: 0, cameras: {} });
    render(<Darkroom />);
    expect(await screen.findByTestId('dr-empty')).toHaveTextContent('The darkroom is empty.');
  });
  it('culls with the keys: 5 stars and P pick, shown at once and saved', async () => {
    library([PHOTO('a'), PHOTO('b')]);
    render(<Darkroom />);
    fireEvent.click((await screen.findAllByTestId('dr-thumb'))[1]);
    fireEvent.keyDown(window, { key: '5' });
    fireEvent.keyDown(window, { key: 'p' });
    await waitFor(() => expect(calls('catalog-set')).toEqual([{ ids: ['b'], rating: 5 }, { ids: ['b'], flag: 'pick' }]));
    expect(screen.getAllByTestId('dr-thumb')[1]).toHaveAccessibleName(/5 stars, Pick/);
  });
  it('filters ask the server, not the page', async () => {
    library([PHOTO('a')]);
    render(<Darkroom />);
    await screen.findAllByTestId('dr-thumb');
    fireEvent.change(screen.getByLabelText('Flag filter'), { target: { value: 'pick' } });
    await waitFor(() => expect(calls('library').some((i) => (i as { filter: { flag?: string } }).filter.flag === 'pick')).toBe(true));
  });
  it('an import sends the file itself, and says which file failed and why', async () => {
    library([]);
    apiPost.mockResolvedValueOnce({ status: 400, data: { ok: false, error: "HEIC photos can't be read here yet." } });
    render(<Darkroom />);
    await screen.findByTestId('dr-empty');
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], 'IMG_0001.HEIC', { type: 'image/heic' });
    fireEvent.change(screen.getByTestId('dr-import-input'), { target: { files: [file] } });
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][0]).toBe('/api/photos/upload?name=IMG_0001.HEIC');
    expect(apiPost.mock.calls[0][1]).toBe(file);
    expect(await screen.findByText(/IMG_0001\.HEIC: HEIC photos can't be read here yet\./)).toBeTruthy();
  });
  it('signed out, the darkroom says so and still shows the wall', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'sign in to use the darkroom' } });
    apiGet.mockResolvedValue({ status: 200, data: { ok: true, releases: [] } });
    render(<Darkroom />);
    expect(await screen.findByTestId('dr-signed-out')).toBeTruthy();
    fireEvent.click(screen.getByText('See the wall'));
    expect(await screen.findByText('Nobody has released a photo yet.')).toBeTruthy();
  });
});

describe('developing', () => {
  it('opens a photo with its panels; a slider change saves as a named history step', async () => {
    library([PHOTO('a')]);
    render(<Darkroom />);
    fireEvent.doubleClick((await screen.findAllByTestId('dr-thumb'))[0]);
    const slider = await screen.findByTestId('dr-slider-exposure');
    expect(screen.getByTestId('dr-panel-curve')).toBeTruthy();
    expect(screen.getByTestId('dr-panel-masks')).toBeTruthy();
    act(() => { slider.focus(); });
    fireEvent.keyDown(slider, { key: 'ArrowRight', shiftKey: true });
    await waitFor(() => expect(calls('edit-save').length).toBe(1), { timeout: 2000 });
    const saved = calls('edit-save')[0] as { id: string; edit: { basic: { exposure: number } }; label: string };
    expect(saved.id).toBe('a');
    expect(saved.edit.basic.exposure).toBeCloseTo(0.5, 5);
    expect(saved.label).toBe('Exposure +0.50');
  });
});

describe('export and release', () => {
  const photo = PHOTO('a');
  it('the export size is the cropped photo at the asked long edge', () => {
    const e = defaultEdit(); e.geometry.crop = { x: 0, y: 0, w: 0.5, h: 1 };
    expect(sizeAt(photo, e, 0)).toEqual({ width: 3000, height: 4000 });
    expect(sizeAt(photo, e, 2048)).toEqual({ width: 1536, height: 2048 });
    e.geometry.orient = 90;
    expect(sizeAt(photo, e, 0)).toEqual({ width: 2000, height: 6000 });
  });
  it('exports by asking the server to render the original', async () => {
    apiGet.mockResolvedValue({ status: 200, data: new Blob(['x']), headers: { 'content-disposition': 'attachment; filename="Frame a.webp"', 'x-photo-width': '2048', 'x-photo-height': '1365' } });
    const toast = vi.fn();
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x'); globalThis.URL.revokeObjectURL = vi.fn();
    render(<ExportDialog photo={photo} edit={defaultEdit()} onClose={() => {}} onToast={toast} beforeExport={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'WEBP' }));
    fireEvent.change(screen.getByLabelText('Long edge'), { target: { value: '2048' } });
    expect(screen.getByTestId('dr-export-size')).toHaveTextContent('2048 × 1365 px');
    fireEvent.click(screen.getByTestId('dr-export-go'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Exported 2048 × 1365/)));
    expect(apiGet.mock.calls[0][0]).toBe('/api/photos/a/export?format=webp&quality=90&longEdge=2048&exif=1&location=0');
  });
  it('a release refuses a price outside 0.5–1000 CC and sends a good one', async () => {
    lensRun.mockImplementation(() => ok({ release: { id: 'prel_1', title: 'Low tide', priceCC: 12.5, width: 6000, height: 4000, proofUrl: '/p', downloadUrl: '/d' } }));
    render(<ReleaseDialog photo={photo} edit={defaultEdit()} onClose={() => {}} onToast={() => {}} beforeRelease={async () => {}} onReleased={() => {}} />);
    const price = screen.getByLabelText('Price in Concord Coin');
    fireEvent.change(price, { target: { value: '0.1' } });
    expect(screen.getByTestId('dr-release-go')).toBeDisabled();
    expect(screen.getByText(/from 0\.5 to 1000 CC/)).toBeTruthy();
    fireEvent.change(price, { target: { value: '12.5' } });
    fireEvent.click(screen.getByTestId('dr-release-go'));
    await waitFor(() => expect(calls('release-create')[0]).toEqual(expect.objectContaining({ photoId: 'a', priceCC: 12.5, longEdge: 0 })));
    expect(await screen.findByTestId('dr-released')).toHaveTextContent('12.5 CC for the 6000 × 4000 file');
  });
});

describe('the wall', () => {
  it('is public; buying goes through photos.release-buy and then the file downloads', async () => {
    const REL = { id: 'prel_9', title: 'Harbour at nine', description: '', priceCC: 4, width: 4000, height: 3000, format: 'jpeg', longEdge: 0, status: 'published', publishedAt: 1, photographer: { name: 'ada', isMe: false }, owned: false, canDownload: false, buyers: null, proofUrl: '/api/photos/releases/prel_9/proof', downloadUrl: '/api/photos/releases/prel_9/download' };
    apiGet.mockResolvedValue({ status: 200, data: { ok: true, releases: [REL] } });
    lensRun.mockImplementation((_d: string, a: string) => (a === 'release-buy' ? ok({ release: { ...REL, owned: true, canDownload: true }, price: 4 }) : ok({})));
    const toast = vi.fn();
    render(<Prints signedIn onToast={toast} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Harbour at nine by ada' }));
    fireEvent.click(screen.getByTestId('dr-print-buy'));
    fireEvent.click(screen.getByTestId('dr-print-pay'));
    await waitFor(() => expect(calls('release-buy')[0]).toEqual({ id: 'prel_9' }));
    expect(await screen.findByTestId('dr-print-download')).toHaveTextContent('Download 4000 × 3000');
    expect(apiGet.mock.calls[0][0]).toBe('/api/photos/releases');
  });
});
