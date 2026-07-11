/**
 * /lenses/photos — lightbox detail view (Wave 4 gap-closure).
 *
 * Pins that clicking a photo thumbnail opens `PhotoLightboxModal` and calls
 * the real `photos.get` macro (server/domains/photos.js) with the clicked
 * photo's id, then renders the macro's actual returned fields (caption,
 * world, visibility, DTU/royalty status) — not a client-invented summary.
 * `photos.get` returns `{ ok, photo: { id, user_id, world_id, caption,
 * taken_at, dtu_id, visibility, blob_path } }`; this test asserts against
 * that exact shape.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor, within } from '@testing-library/react';

const addToastMock = vi.fn();
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

  it('renders the real photos.get fields — caption, world, visibility, DTU/royalty status', async () => {
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

    // Full-size image streams from the real image route, keyed by the same id.
    // (The gallery thumbnail shares the same alt text, so scope the query to
    // the lightbox detail panel.)
    const img = within(detail).getByAltText('Sunset over the spire') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/photos/p_1/image');
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
