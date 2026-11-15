/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * FIX-sandbox-005 — arena syncs raced: mount / add / remove / Apply /
 * Reset all fire enterArena with no ordering, so a slow earlier
 * response landing after a later one silently restored the earlier
 * dummy count (the arena showed 1 vs 3 dummies between identical
 * tries). Pin: when the mount sync (3 dummies) resolves AFTER the
 * add-dummy sync (4 dummies), the stale response must not apply.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/sandbox/SandboxRepos', () => ({ SandboxRepos: () => null }));
vi.mock('@/components/sandbox/LoadoutPicker', () => ({ LoadoutPicker: () => null }));
vi.mock('@/components/sandbox/DummyPresetPanel', () => ({ DummyPresetPanel: () => null }));
vi.mock('@/components/sandbox/TelemetryOverlay', () => ({ TelemetryOverlay: () => null }));
vi.mock('@/components/sandbox/ReplayPanel', () => ({ ReplayPanel: () => null }));
vi.mock('@/components/sandbox/SandboxArena3D', () => ({ SandboxArena3D: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('next/navigation', () => ({ useSearchParams: () => null }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/lib/realtime/socket', () => ({
  connectSocket: () => {},
  getSocket: () => ({ emit: () => {} }),
  subscribe: () => () => {},
}));

import SandboxPage from '@/app/lenses/sandbox/page';

interface Deferred { promise: Promise<unknown>; resolve: (v: unknown) => void }
function deferred(): Deferred {
  let resolve!: (v: unknown) => void;
  const promise = new Promise<unknown>((r) => { resolve = r; });
  return { promise, resolve };
}
const arenaResult = (count: number, hp = 100) => ({
  data: {
    ok: true,
    result: {
      cityId: 'sandbox_u1',
      dummies: Array.from({ length: count }, (_, i) => ({ index: i, npcId: `sandbox_u1_dummy_${i}`, hp })),
    },
  },
});

beforeEach(() => { lensRunMock.mockReset(); });

describe('FIX-sandbox-005 arena sync ordering', () => {
  it('a stale sync response never overwrites a newer dummy count', async () => {
    const pending: Deferred[] = [];
    lensRunMock.mockImplementation(() => {
      const d = deferred();
      pending.push(d);
      return d.promise;
    });
    render(<SandboxPage />);
    // Mount sync (#1, count 3) is in flight; click Add → sync #2 (count 4).
    await act(async () => { await Promise.resolve(); });
    expect(pending.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(pending.length).toBeGreaterThanOrEqual(2);
    // The NEWER sync resolves first…
    await act(async () => { pending[pending.length - 1].resolve(arenaResult(4)); });
    expect(screen.getByText('dummies: 4')).toBeInTheDocument();
    // …then the STALE mount sync resolves. It must not apply.
    await act(async () => { pending[0].resolve(arenaResult(3)); });
    expect(screen.getByText('dummies: 4')).toBeInTheDocument();
  });
});
