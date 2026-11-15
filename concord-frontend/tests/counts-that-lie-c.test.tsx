// CB-0500 — counts that lie, cluster C pin (FIX-ar-003 / FIX-ar-010,
// page half).
//
// Pin: the AR page hands SceneStudio an onCountsStale callback and
// derives its header tiles (Scenes authored / Image targets) from a
// react-query read of the same list calls the studio renders — so the
// studio's reload report alone re-reads the counts and the tile
// follows the list, with no remount and no tab switch. On the
// snapshot implementation the page passed no callback and the tile
// could never move this way.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

const studio = vi.hoisted(() => ({ props: null as null | { onCountsStale?: () => void } }));
vi.mock('@/components/ar/SceneStudio', () => ({
  SceneStudio: (p: { onCountsStale?: () => void }) => { studio.props = p; return null; },
}));
vi.mock('@/components/ar/SpatialDiagnostics', () => ({ SpatialDiagnostics: () => null }));
vi.mock('@/components/ar/AssetLibrary', () => ({ AssetLibrary: () => null }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return { ...orig, DensityToggle: () => null };
});
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/hooks/use-lens-data', () => ({ useLensData: () => ({ items: [] }) }));

import ARLensPage from '@/app/lenses/ar/page-client';

describe('ar-003/ar-010 — page header counts follow the list', () => {
  let sceneCount = 1;
  beforeEach(() => {
    sceneCount = 1;
    studio.props = null;
    lensRun.mockReset();
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'sceneList') return { data: { ok: true, result: { scenes: [], count: sceneCount }, error: null } };
      if (action === 'imageTargetList') return { data: { ok: true, result: { targets: [], count: 4 }, error: null } };
      return { data: { ok: true, result: {}, error: null } };
    });
  });

  const tile = (text: string) =>
    screen.findByText((_, el) => el?.textContent === text);

  it('re-reads the counts when SceneStudio reports a reload — no remount, no tab switch', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><ARLensPage /></QueryClientProvider>);

    expect(await tile('Scenes authored1')).toBeTruthy();
    expect(await tile('Image targets4')).toBeTruthy();
    // The page must hand SceneStudio the refresh callback.
    expect(typeof studio.props?.onCountsStale).toBe('function');

    // A scene is saved in the studio; the list now counts 2. The
    // studio's reload report alone must move the header tile.
    sceneCount = 2;
    studio.props?.onCountsStale?.();
    expect(await tile('Scenes authored2')).toBeTruthy();
  });
});
