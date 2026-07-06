// Phase CA2 — confirm SubmarineHUD polls dive-state and renders it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { SubmarineHUD } from '@/components/world/SubmarineHUD';

interface DiveStateFixture {
  isSwimming?: boolean;
  swimDepth?: number;
  oxygenPct?: number;
  maxDepthExplored?: number;
  drowningDamage?: number;
  sonarContacts?: Array<{ id: string; speciesId: string; distance: number; depth: number }>;
}

const DEFAULT_DIVE_STATE: Required<DiveStateFixture> = {
  isSwimming: true,
  swimDepth: 12.3,
  oxygenPct: 72.5,
  maxDepthExplored: 45,
  drowningDamage: 0,
  sonarContacts: [],
};

// The component also calls useClientConfig(), which fetches
// /api/config/client — the mock below answers both endpoints so the real
// polling path (fetch -> /api/players/me/dive-state) is exercised for real.
function makeFetchMock(diveState: DiveStateFixture | null) {
  return vi.fn((url: unknown) => {
    const u = String(url);
    if (u === '/api/players/me/dive-state') {
      if (diveState === null) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, diveState: { ...DEFAULT_DIVE_STATE, ...diveState } }),
      });
    }
    if (u === '/api/config/client') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, config: {} }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  });
}

describe('Phase CA2 — Submarine HUD wired to dive-state', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('polls /api/players/me/dive-state with credentials on mount', async () => {
    const fetchMock = makeFetchMock({});
    vi.stubGlobal('fetch', fetchMock);
    render(<SubmarineHUD />);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/players/me/dive-state');
      expect(call).toBeTruthy();
      const [, opts] = call as [string, RequestInit];
      expect(opts.credentials).toBe('include');
    });
  });

  it('renders nothing when not swimming (isSwimming: false)', async () => {
    const fetchMock = makeFetchMock({ isSwimming: false });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<SubmarineHUD />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(container.textContent).toBe('');
  });

  it('reads and renders oxygen_pct, swim_depth, max_depth_explored, drowningDamage from the response', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      swimDepth: 12.3, oxygenPct: 72.5, maxDepthExplored: 45, drowningDamage: 8,
    }));
    render(<SubmarineHUD />);

    // Oxygen % — rendered as a single "{value}%" span (no children elements).
    await waitFor(() => {
      expect(screen.getByText('72.5%')).toBeDefined();
    });
    // Depth readings.
    expect(screen.getByText('12.3 m')).toBeDefined();
    expect(screen.getByText('45 m')).toBeDefined();
    // Drowning damage line only renders when > 0.
    expect(screen.getByText('Drowning damage: 8 HP')).toBeDefined();
  });

  it('omits the drowning-damage line when drowningDamage is 0', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ drowningDamage: 0 }));
    render(<SubmarineHUD />);

    await waitFor(() => {
      expect(screen.getByText('72.5%')).toBeDefined();
    });
    expect(screen.queryByText(/Drowning damage/)).toBeNull();
  });

  it('renders sonar contacts as a real list from sonarContacts', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      sonarContacts: [
        { id: 'c1', speciesId: 'anglerfish', distance: 23.4, depth: 15.2 },
        { id: 'c2', speciesId: 'reef-shark', distance: 8, depth: 3 },
      ],
    }));
    render(<SubmarineHUD />);

    await waitFor(() => {
      expect(screen.getByText('anglerfish')).toBeDefined();
    });
    expect(screen.getByText('reef-shark')).toBeDefined();
    // Header shows the live count, not a hardcoded number.
    expect(screen.getByText((_, node) => node?.textContent === 'Sonar — 2 contacts')).toBeDefined();
    // Distance/depth line for each contact (rounded, em-dash-prefixed depth).
    expect(screen.getByText('23m @ −15m')).toBeDefined();
    expect(screen.getByText('8m @ −3m')).toBeDefined();
  });

  it('hides the sonar block entirely when there are no contacts', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ sonarContacts: [] }));
    render(<SubmarineHUD />);

    await waitFor(() => {
      expect(screen.getByText('72.5%')).toBeDefined();
    });
    expect(screen.queryByText(/Sonar/)).toBeNull();
  });

  it('is neutral cyan below 30% oxygen, flips to amber (lowOx) between 10% and 30%', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ oxygenPct: 25 }));
    const { container } = render(<SubmarineHUD />);

    await waitFor(() => {
      expect(screen.getByText('25.0%')).toBeDefined();
    });
    expect(screen.getByText('25.0%').className).toContain('text-amber-200');
    expect(screen.getByText('O₂').className).toContain('text-amber-300');
    expect(container.querySelector('.bg-amber-500')).not.toBeNull();
    expect(container.querySelector('.bg-rose-500')).toBeNull();
    expect(screen.queryByText(/CRITICAL/)).toBeNull();
  });

  it('flips to rose + shows the CRITICAL banner below 10% oxygen', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ oxygenPct: 5 }));
    const { container } = render(<SubmarineHUD />);

    await waitFor(() => {
      expect(screen.getByText('5.0%')).toBeDefined();
    });
    expect(screen.getByText('5.0%').className).toContain('text-rose-200');
    expect(screen.getByText('O₂').className).toContain('text-rose-300');
    expect(container.querySelector('.bg-rose-500')).not.toBeNull();
    expect(screen.getByText(/CRITICAL/)).toBeDefined();
  });

  it('does not show amber/rose/CRITICAL styling above the 30% threshold', async () => {
    vi.stubGlobal('fetch', makeFetchMock({ oxygenPct: 80 }));
    const { container } = render(<SubmarineHUD />);

    await waitFor(() => {
      expect(screen.getByText('80.0%')).toBeDefined();
    });
    expect(screen.getByText('80.0%').className).toContain('text-cyan-100');
    expect(container.querySelector('.bg-amber-500')).toBeNull();
    expect(container.querySelector('.bg-rose-500')).toBeNull();
    expect(screen.queryByText(/CRITICAL/)).toBeNull();
  });
});
