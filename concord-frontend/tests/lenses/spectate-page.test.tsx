/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// Stub the lens chrome so we exercise the spectate page's own data + state logic.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock('@/components/lens/ManifestActionBar', () => ({
  ManifestActionBar: () => null,
}));

// Mock the real backend call (spectate.list macro via lensRun).
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import SpectateIndexPage from '@/app/lenses/spectate/page';

/** lensRun envelope: { data: { ok, result, error } } */
function listEnvelope(spectacles: unknown[]) {
  return { data: { ok: true, result: { ok: true, spectacles }, error: null } };
}
function errorEnvelope(error: string) {
  return { data: { ok: false, result: null, error } };
}
function fetchJson(body: unknown) {
  return Promise.resolve({ json: () => Promise.resolve(body) } as Response);
}

const LIVE_SPECTACLE = {
  worldId: 'sovereign-ruins',
  watching: 12,
  openMarketCount: 2,
  totalPoolSparks: 4500,
  live: true,
  authored: true,
};

beforeEach(() => {
  lensRun.mockReset();
  // Default fetch fallback returns an empty-but-ok counts payload.
  global.fetch = vi.fn(() => fetchJson({ ok: true, counts: {} })) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/lenses/spectate — four UX states', () => {
  it('LOADING: shows the spinner while the request is in flight', async () => {
    // Never-resolving promise keeps both the macro and the page in loading.
    lensRun.mockReturnValue(new Promise(() => {}));
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    render(<SpectateIndexPage />);
    expect(await screen.findByText(/Loading live spectacles/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('EMPTY: honest empty state when no spectacles are live', async () => {
    lensRun.mockResolvedValue(listEnvelope([]));
    render(<SpectateIndexPage />);
    expect(await screen.findByText('No spectacles yet')).toBeInTheDocument();
    expect(screen.getByText(/When a world has watchers or an open prediction market/i)).toBeInTheDocument();
  });

  it('ERROR: honest error + working retry that recovers', async () => {
    // First load: macro fails AND fetch fallback fails → hard error.
    lensRun.mockResolvedValueOnce(errorEnvelope('spectator service down'));
    global.fetch = vi.fn(() => fetchJson({ ok: false })) as unknown as typeof fetch;
    render(<SpectateIndexPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Couldn.t load spectacles/i);
    expect(alert).toHaveTextContent('spectator service down');

    // Retry now succeeds with a populated grid.
    lensRun.mockResolvedValueOnce(listEnvelope([LIVE_SPECTACLE]));
    fireEvent.click(screen.getByText('Retry'));
    expect(await screen.findByText('Sovereign Ruins')).toBeInTheDocument();
  });

  it('POPULATED: renders a real live spectacle with watcher + market counts', async () => {
    lensRun.mockResolvedValue(listEnvelope([LIVE_SPECTACLE]));
    render(<SpectateIndexPage />);

    expect(await screen.findByText('Sovereign Ruins')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument(); // watcher count
    expect(screen.getByText(/2 markets/i)).toBeInTheDocument();
    expect(screen.getByText(/4,500 SPARKS/i)).toBeInTheDocument();
    // The "live" badge in the header.
    expect(screen.getByLabelText(/1 live spectacles/i)).toBeInTheDocument();
  });

  it('A11Y: the populated card exposes an aria-label describing the spectacle', async () => {
    lensRun.mockResolvedValue(listEnvelope([LIVE_SPECTACLE]));
    render(<SpectateIndexPage />);
    expect(
      await screen.findByLabelText(/Watch Sovereign Ruins — 12 watching, 2 open markets/i),
    ).toBeInTheDocument();
  });

  it('called the real spectate.list macro (no mock backend)', async () => {
    lensRun.mockResolvedValue(listEnvelope([]));
    render(<SpectateIndexPage />);
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    expect(lensRun).toHaveBeenCalledWith('spectate', 'list', {});
  });

  it('FALLBACK: degrades to the public watcher-count endpoint when the macro is unavailable', async () => {
    // Macro returns a non-ok envelope; fetch fallback supplies real counts.
    lensRun.mockResolvedValue(errorEnvelope('unauthorized'));
    global.fetch = vi.fn(() =>
      fetchJson({ ok: true, counts: { cyber: 7 } }),
    ) as unknown as typeof fetch;
    render(<SpectateIndexPage />);
    expect(await screen.findByText('Cyber')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});
