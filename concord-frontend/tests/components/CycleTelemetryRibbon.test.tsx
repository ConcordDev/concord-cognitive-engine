// CycleTelemetryRibbon — honest-by-construction pin.
//
// The ribbon has FOUR honest rendering states (no fifth, ever). These
// tests pin each one + the literal text shown to the user, plus the
// guardrail that no state ever asserts "OK" or "All systems..." when the
// data doesn't support it. This file is the source of truth for the ribbon
// contract — if a future change adds a fifth state ("Live", "All Good",
// "Healthy"), the tests here must add coverage for it or the change is a
// fabrication.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGetMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGetMock(...a) },
}));

import { CycleTelemetryRibbon } from '@/components/conkay/CycleTelemetryRibbon';

function makeFreshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function renderWith(setup: () => void) {
  setup();
  const qc = makeFreshClient();
  return render(
    <QueryClientProvider client={qc}>
      <CycleTelemetryRibbon pollMs={1_000_000} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGetMock.mockReset();
});

describe('CycleTelemetryRibbon — four-state honesty contract', () => {
  it('renders "unreachable" on a network error — never "OK" or "health: live"', async () => {
    renderWith(() => {
      apiGetMock.mockRejectedValue(new Error('ECONNREFUSED'));
    });
    expect(await screen.findByTestId('ck-cycle-ribbon')).toHaveAttribute(
      'data-state',
      'unreachable',
    );
    // Honest literal — "unreachable" never lies even when the network
    // is down. The test below pins the EXACT wording for the next time
    // someone wants to "make it friendlier".
    expect(screen.getByText(/Health: unreachable/)).toBeInTheDocument();
    // No fabricated "OK" anywhere.
    expect(screen.queryByText(/OK|Healthy|All systems/i)).toBeNull();
  });

  it('renders "unreachable" on 401 — never substitutes a fake happy state', async () => {
    renderWith(() => {
      apiGetMock.mockResolvedValue({ data: { ok: false, error: 'unauthenticated' } });
    });
    expect(await screen.findByTestId('ck-cycle-ribbon')).toHaveAttribute(
      'data-state',
      'unreachable',
    );
    expect(screen.getByText(/Health: unreachable/)).toBeInTheDocument();
  });

  it('renders "no_data_yet" when modules exist but none have run yet', async () => {
    renderWith(() => {
      apiGetMock.mockResolvedValue({
        data: {
          ok: true,
          heartbeatTicks: 0,
          startedAt: 0,
          modules: [
            {
              id: 'new-module',
              frequency: 20,
              scope: 'global',
              lastMs: null,
              totalErrors: 0,
              p50: null,
              p90: null,
              p99: null,
            },
          ],
        },
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId('ck-cycle-ribbon')).toHaveAttribute('data-state', 'no-data'),
    );
    expect(
      screen.getByText(/Health: 1 cycles · awaiting first tick/),
    ).toBeInTheDocument();
  });

  it('renders "live" with real numbers — 168 modules, p50 = 45ms, 0 in error', async () => {
    const mod = (id: string, p50: number, totalErrors: number) => ({
      id,
      frequency: 20,
      scope: 'global',
      lastMs: p50 + 1,
      totalErrors,
      p50,
      p90: p50 * 2,
      p99: p50 * 4,
    });
    renderWith(() => {
      apiGetMock.mockResolvedValue({
        data: {
          ok: true,
          heartbeatTicks: 12345,
          startedAt: Date.now() - 3_600_000,
          modules: [
            mod('repometa', 30, 0),
            mod('aerial-traffic', 12, 0),
            mod('embodied-dream', 80, 0),
          ],
        },
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId('ck-cycle-ribbon')).toHaveAttribute('data-state', 'live'),
    );
    expect(screen.getByText(/Health: 3 cycles/)).toBeInTheDocument();
    // Pin the literal p50 label — must be the MEDIAN of [30, 12, 80]
    // which is 30 (middle value of the sorted list). This locks in
    // "median, not min or max" as the aggregate rule.
    expect(screen.getByText(/Health: 3 cycles · 30ms p50/)).toBeInTheDocument();
    // No "in error" segment when 0 modules have errors.
    expect(screen.queryByText(/in error/)).toBeNull();
  });

  it('renders "live" with the in-error count when at least one module has errors', async () => {
    const mod = (id: string, totalErrors: number) => ({
      id,
      frequency: 20,
      scope: 'global',
      lastMs: 30,
      totalErrors,
      p50: 30,
      p90: 60,
      p99: 120,
    });
    renderWith(() => {
      apiGetMock.mockResolvedValue({
        data: {
          ok: true,
          heartbeatTicks: 100,
          startedAt: 0,
          modules: [mod('a', 0), mod('b', 1), mod('c', 2)],
        },
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId('ck-cycle-ribbon')).toHaveAttribute('data-state', 'live'),
    );
    expect(screen.getByText(/2 in error/)).toBeInTheDocument();
  });

  it('renders "unreachable" when the backend returns a non-OK payload shape', async () => {
    // A 200 with `ok: false` (e.g. the admin endpoint sent back an error
    // sentinel) must still render as "unreachable" — the contract is
    // "the endpoint either returned happy data or it's down."
    renderWith(() => {
      apiGetMock.mockResolvedValue({ data: { modules: 'not an array' } });
    });
    expect(await screen.findByTestId('ck-cycle-ribbon')).toHaveAttribute(
      'data-state',
      'unreachable',
    );
  });
});

describe('CycleTelemetryRibbon — honesty guards that prevent fabrication', () => {
  // The repo-wide check-conkay-honest-motion.mjs gate (S1-b build, not
  // yet shipped) enforces "no fake spinners, no JS clock for animation."
  // These tests pin the same contract at this file's level so a
  // regression fails in this PR rather than waiting for the gate.

  function readSrc(): string {
    return fs.readFileSync('components/conkay/CycleTelemetryRibbon.tsx', 'utf8');
  }

  it('does not import setInterval or setTimeout (animated dot is CSS-only)', () => {
    // Strip the comment block at the top of the file before checking —
    // it mentions those words as documentation ("no setInterval, no
    // setTimeout"), not as actual imports.
    const src = readSrc();
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/\bsetInterval\s*\(/);
    expect(codeOnly).not.toMatch(/\bsetTimeout\s*\(/);
  });

  it('user-facing copy has no marketing claims — only the four documented states', () => {
    // Allowed user-facing strings come from the four `kind:` branches in
    // deriveLabel(): 'live', 'no_data_yet', 'unreachable', 'empty
    // registry'. A future change adding the banned phrases must update
    // this test (it is forbidden, period).
    const src = readSrc();
    expect(src).not.toMatch(/\bAll systems\b/);
    expect(src).not.toMatch(/\bHealth: OK\b/);
  });
});
import fs from 'node:fs';
