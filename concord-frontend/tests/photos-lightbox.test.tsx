/**
 * /lenses/photos — lightbox detail view (Wave 4 gap-closure).
 *
 * Pins that clicking a photo thumbnail opens `PhotoLightboxModal` and calls
 * the real `photos.get` macro (server/domains/photos.js) with the clicked
 * photo's id, then renders the macro's actual returned fields (caption,
 * world, visibility, DTU id + royalty status, dimensions, file size, and
 * original filename when the row carries one) — not a client-invented
 * summary. `photos.get` returns `{ ok, photo: { id, user_id, world_id,
 * caption, taken_at, dtu_id, visibility, blob_path, width, height,
 * size_bytes, original_filename } }`; this test asserts against that exact
 * shape.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor, within } from '@testing-library/react';

const addToastMock = vi.fn();
// The north-star frame wires these into the page; stub them for a headless render.
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/store/ui', () => ({
  useUIStore: (selector: (s: { addToast: typeof addToastMock }) => unknown) =>
    selector({ addToast: addToastMock }),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/ManifestActionBar', () => ({
  ManifestActionBar: () => null,
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

// The gallery list still comes from raw fetch (/api/photos/mine); the
// lightbox detail comes from the real macro channel. Mock both separately.
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import PhotosLensPage from '@/app/lenses/photos/page';

const PHOTO = {
  id: 'p_1',
  user_id: 'u_1',
  world_id: 'tunya',
  caption: 'Sunset over the spire',
  taken_at: Math.floor(Date.now() / 1000) - 120,
  dtu_id: null,
  visibility: 'private',
};

const PHOTO_DETAIL = {
  id: 'p_1',
  user_id: 'u_1',
  world_id: 'tunya',
  caption: 'Sunset over the spire',
  taken_at: PHOTO.taken_at,
  dtu_id: 'dtu_abc123',
  visibility: 'public',
  blob_path: './data/photos/p_1.png',
  width: 1920,
  height: 1080,
  size_bytes: 204800,
  original_filename: 'IMG_0042.heic',
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  addToastMock.mockReset();
  lensRunMock.mockReset();
  vi.restoreAllMocks();
});

async function renderReady() {
  vi.spyOn(global, 'fetch').mockImplementation(() => jsonResponse({ ok: true, photos: [PHOTO] }));
  let view: ReturnType<typeof render>;
  await act(async () => { view = render(<PhotosLensPage />); });
  await waitFor(() => expect(view!.getByTestId('photos-list')).toBeInTheDocument());
  return view!;
}

describe('photos lens — lightbox (photos.get wiring)', () => {
  it('clicking a thumbnail calls photos.get with the clicked photo id', async () => {
    lensRunMock.mockReturnValue(
      Promise.resolve({ data: { ok: true, result: { ok: true, photo: PHOTO_DETAIL }, error: null } }),
    );
    const view = await renderReady();

    await act(async () => {
      fireEvent.click(view.getByLabelText('View photo Sunset over the spire'));
    });

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('photos', 'get', { id: 'p_1' }));
  });

  it('renders the real photos.get fields — caption, world, visibility, DTU id/royalty status, and F4 metadata (dimensions, size, original filename)', async () => {
    lensRunMock.mockReturnValue(
      Promise.resolve({ data: { ok: true, result: { ok: true, photo: PHOTO_DETAIL }, error: null } }),
    );
    const view = await renderReady();

    await act(async () => {
      fireEvent.click(view.getByLabelText('View photo Sunset over the spire'));
    });

    const detail = await waitFor(() => view.getByTestId('photo-lightbox-detail'));
    expect(detail.textContent).toMatch(/tunya/);
    expect(detail.textContent).toMatch(/public/);
    expect(detail.textContent).toMatch(/DTU minted/i);
    expect(detail.textContent).toMatch(/royalty active/i);
    // F2 — the mint claim shows the actual id, not just a bare "minted" label.
    expect(detail.textContent).toMatch(/dtu_abc123/);
    // F4 — dimensions, file type + size, and the original filename.
    expect(detail.textContent).toMatch(/1920.*1080/);
    expect(detail.textContent).toMatch(/PNG/);
    expect(detail.textContent).toMatch(/200\.0 KB/);
    expect(detail.textContent).toMatch(/IMG_0042\.heic/);

    // Full-size image streams from the real image route, keyed by the same id.
    // (The gallery thumbnail shares the same alt text, so scope the query to
    // the lightbox detail panel.)
    const img = within(detail).getByAltText('Sunset over the spire') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/photos/p_1/image');
  });

  it('F4: shows "unknown" for dimensions/filename rather than fabricating them when a row predates the metadata columns', async () => {
    lensRunMock.mockReturnValue(
      Promise.resolve({
        data: {
          ok: true,
          result: { ok: true, photo: { ...PHOTO_DETAIL, width: null, height: null, size_bytes: null, original_filename: null } },
          error: null,
        },
      }),
    );
    const view = await renderReady();

    await act(async () => {
      fireEvent.click(view.getByLabelText('View photo Sunset over the spire'));
    });

    const detail = await waitFor(() => view.getByTestId('photo-lightbox-detail'));
    expect(detail.textContent).toMatch(/unknown/i);
    expect(detail.textContent).not.toMatch(/IMG_0042/);
  });

  it('shows an honest "not shared" state when photos.get returns dtu_id: null', async () => {
    lensRunMock.mockReturnValue(
      Promise.resolve({
        data: { ok: true, result: { ok: true, photo: { ...PHOTO_DETAIL, dtu_id: null, visibility: 'private' } }, error: null },
      }),
    );
    const view = await renderReady();

    await act(async () => {
      fireEvent.click(view.getByLabelText('View photo Sunset over the spire'));
    });

    const detail = await waitFor(() => view.getByTestId('photo-lightbox-detail'));
    expect(detail.textContent).toMatch(/not shared yet/i);
  });

  it('LOADING: shows a busy skeleton while photos.get is in flight', async () => {
    lensRunMock.mockReturnValue(new Promise(() => {}));
    const view = await renderReady();

    await act(async () => {
      fireEvent.click(view.getByLabelText('View photo Sunset over the spire'));
    });

    const loading = await waitFor(() => view.getByTestId('photo-lightbox-loading'));
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('ERROR: surfaces the real photos.get failure reason (e.g. a 404\'d private photo)', async () => {
    lensRunMock.mockReturnValue(
      Promise.resolve({ data: { ok: false, result: null, error: 'not_found' } }),
    );
    const view = await renderReady();

    await act(async () => {
      fireEvent.click(view.getByLabelText('View photo Sunset over the spire'));
    });

    const error = await waitFor(() => view.getByTestId('photo-lightbox-error'));
    expect(error.textContent).toMatch(/not_found/);
  });

  it('closes via the modal close button and does not leave the detail rendered', async () => {
    lensRunMock.mockReturnValue(
      Promise.resolve({ data: { ok: true, result: { ok: true, photo: PHOTO_DETAIL }, error: null } }),
    );
    const view = await renderReady();

    await act(async () => {
      fireEvent.click(view.getByLabelText('View photo Sunset over the spire'));
    });
    await waitFor(() => view.getByTestId('photo-lightbox-detail'));

    await act(async () => {
      fireEvent.click(view.getByLabelText('Close modal'));
    });

    expect(view.queryByTestId('photo-lightbox-detail')).not.toBeInTheDocument();
  });
});
