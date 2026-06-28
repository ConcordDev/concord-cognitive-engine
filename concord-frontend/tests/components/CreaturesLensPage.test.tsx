import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// LensShell pulls in next/dynamic + the UI store + a11y hooks; stub it to a
// passthrough so this test isolates the creatures page's own four states.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));

// The page reads world populations via lensRun('creatures','roster'); each test
// installs its own resolver. The optional emotional-weather fetch is mocked to
// resolve empty so it never interferes with the roster states.
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

function envelope(result: unknown, ok = true) {
  return Promise.resolve({ data: { ok, result, error: ok ? null : 'err' } });
}

async function renderPage() {
  const { default: CreaturesLensPage } = await import('@/app/lenses/creatures/page');
  render(React.createElement(CreaturesLensPage));
}

describe('CreaturesLensPage — four UX states', () => {
  beforeEach(() => {
    vi.resetModules();
    lensRunMock.mockReset();
    // affect fetch resolves empty so it never blocks roster rendering.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ ok: true, histogram: {}, recent: [], total: 0 }) })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('LOADING: shows a loading status while the roster is in flight', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'creatures' && action === 'roster') return new Promise(() => {}); // never resolves
      return envelope({ ok: true });
    });
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/loading populations/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('ERROR: shows an honest error with a Retry button when the roster errors', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'creatures' && action === 'roster') {
        return Promise.resolve({ data: { ok: false, result: null, error: 'db unavailable' } });
      }
      return envelope({ ok: true });
    });
    await renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/couldn’t load populations|couldn't load populations/i)).toBeInTheDocument();
    expect(screen.getByText(/db unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('EMPTY: shows a genuine empty state when there are no populations', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'creatures' && action === 'roster') return envelope({ ok: true, populations: [], count: 0 });
      return envelope({ ok: true });
    });
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no creature populations in/i)).toBeInTheDocument();
    });
    // Not loading, not error.
    expect(screen.queryByText(/loading populations/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('POPULATED: renders real populations from the roster', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'creatures' && action === 'roster') {
        return envelope({
          ok: true,
          count: 2,
          populations: [
            { id: 'pop1', world_id: 'concordia-hub', biome: 'forest', species_id: 'deer', lifestyle: 'herbivore', current_count: 12, topology: 'quadruped', clade: 'mammal' },
            { id: 'pop2', world_id: 'concordia-hub', biome: 'river', species_id: 'trout', lifestyle: 'filter', current_count: 5, topology: 'fish', clade: 'fish' },
          ],
        });
      }
      return envelope({ ok: true });
    });
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('deer')).toBeInTheDocument();
    });
    expect(screen.getByText('trout')).toBeInTheDocument();
    // Real data surfaced: the per-population detail line carries count + topology.
    expect(screen.getByText(/×12/)).toBeInTheDocument();
    expect(screen.getByText(/quadruped/)).toBeInTheDocument();
    // Not in loading / empty / error.
    expect(screen.queryByText(/loading populations/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no creature populations/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
