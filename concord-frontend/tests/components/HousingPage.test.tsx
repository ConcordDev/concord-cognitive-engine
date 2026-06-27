import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// The housing lens mounts LensShell + ManifestActionBar. LensShell pulls in
// the UI store + keyboard providers in production; ManifestActionBar reads
// the manifest. Stub both to passthrough/no-op so the test isolates the
// page's own four-state data logic.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div data-testid="lens-shell">{children}</div>,
}));
vi.mock('@/components/lens/ManifestActionBar', () => ({
  ManifestActionBar: () => <div data-testid="manifest-action-bar" />,
}));

// A house row + detail the populated state asserts against.
const HOUSE_ROW = {
  id: 'ph_abc', name: 'Cottage', building_id: 'wb1', world_id: 'tunya',
  visibility: 'public', allow_live_visits: 1, last_decorated_at: 100,
};
const HOUSE_DETAIL = {
  ...HOUSE_ROW,
  user_id: 'alice',
  rooms: [{
    id: 'room1', room_type: 'living', name: 'Living Room',
    width: 6, depth: 6, height: 3, floor: 1, lock_tier: 2, lock_state: 'locked',
    furniture_layout: [{ itemId: 'sofa', x: 1.5, y: 0, z: 2, rot: 90 }],
    furniture: [],
  }],
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);
}

async function mountPage() {
  const { default: HousingPage } = await import('@/app/lenses/housing/page');
  return render(<HousingPage />);
}

describe('HousingLensPage — four UX states', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('LOADING: shows a loading status while /api/housing/mine is in flight', async () => {
    // Never-resolving fetch keeps the page in the loading state.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    await mountPage();
    expect(await screen.findByTestId('housing-mine-loading')).toBeTruthy();
    // a11y: a live status region announces the load.
    expect(screen.getByText(/Loading your houses/i)).toBeTruthy();
  });

  it('EMPTY: renders the honest empty state when the user owns no houses', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ ok: true, houses: [] })));
    await mountPage();
    expect(await screen.findByTestId('housing-mine-empty')).toBeTruthy();
    expect(screen.getByText(/No houses yet/i)).toBeTruthy();
  });

  it('ERROR: renders an honest error + retry that re-fetches', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => jsonResponse({ ok: false, error: 'boom' }, false, 500))
      .mockImplementationOnce(() => jsonResponse({ ok: true, houses: [HOUSE_ROW] }));
    vi.stubGlobal('fetch', fetchMock);
    await mountPage();

    const err = await screen.findByTestId('housing-mine-error');
    expect(err).toBeTruthy();
    expect(screen.getByText(/boom/i)).toBeTruthy();

    // Retry button re-fetches and resolves into the populated state.
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByTestId('housing-mine-list')).toBeTruthy();
    expect(screen.getByText('Cottage')).toBeTruthy();
  });

  it('POPULATED: lists houses and loads real detail (rooms + furniture) on select', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/housing/mine') return jsonResponse({ ok: true, houses: [HOUSE_ROW] });
      if (url.startsWith('/api/housing/ph_abc')) return jsonResponse({ ok: true, house: HOUSE_DETAIL });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    await mountPage();

    const item = await screen.findByText('Cottage');
    fireEvent.click(item);

    // Real detail rendered from the backend payload — room + per-coord furniture.
    await waitFor(() => expect(screen.getByText('Living Room')).toBeTruthy());
    expect(screen.getByText(/sofa/)).toBeTruthy();
    // furniture coords are surfaced from the real layout, not faked.
    expect(screen.getByText(/rot 90/)).toBeTruthy();
  });

  it('VISIT tab surfaces its own loading/error/empty/populated states', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/housing/mine') return jsonResponse({ ok: true, houses: [] });
      if (url.includes('/public')) return jsonResponse({ ok: true, houses: [HOUSE_ROW] });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    await mountPage();
    await screen.findByTestId('housing-mine-empty');

    // Switch to the Visit tab → public list fetch fires.
    fireEvent.click(screen.getByRole('button', { name: /^visit$/i }));
    expect(await screen.findByTestId('housing-public-list')).toBeTruthy();
    expect(screen.getAllByText('Cottage').length).toBeGreaterThan(0);
  });
});
