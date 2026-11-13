// CB-0500 — counts that lie, cluster B pin (FIX-ar-003 / FIX-ar-010,
// SceneStudio half).
//
// The AR page header counts were mount/tab-switch snapshots while
// SceneStudio mutated and re-read the same lists in place. Pin:
// SceneStudio reports every list reload through onCountsStale — the
// mount load, and the reload after a delete — so the page can re-read
// the counts it derives from the same lists.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: ReactNode }) => children ?? null,
  useFrame: () => {},
}));

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { SceneStudio } from '@/components/ar/SceneStudio';

const SCENE = {
  id: 'scene-1', name: 'Harbor Walk', anchor: 'plane', objectCount: 2,
  behaviorCount: 1, audioCount: 0, version: 1, updatedAt: '2026-10-11T00:00:00.000Z',
};

describe('ar-003/ar-010 — SceneStudio reports list reloads', () => {
  let scenes = [SCENE];
  beforeEach(() => {
    scenes = [SCENE];
    lensRun.mockReset();
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'sceneList') return { data: { ok: true, result: { scenes, count: scenes.length }, error: null } };
      if (action === 'sceneDelete') { scenes = []; return { data: { ok: true, result: { deleted: true }, error: null } }; }
      return { data: { ok: true, result: { targets: [], captures: [] }, error: null } };
    });
  });

  it('fires onCountsStale on load and again after a delete reload', async () => {
    const onCountsStale = vi.fn();
    render(<SceneStudio onCountsStale={onCountsStale} />);
    expect(await screen.findByText('Harbor Walk')).toBeTruthy();
    await waitFor(() => expect(onCountsStale.mock.calls.length).toBeGreaterThan(0));
    const afterLoad = onCountsStale.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /delete scene/i }));
    fireEvent.click(await screen.findByRole('button', { name: /confirm delete scene harbor walk/i }));
    await waitFor(() => expect(screen.queryByText('Harbor Walk')).toBeNull());
    await waitFor(() => expect(onCountsStale.mock.calls.length).toBeGreaterThan(afterLoad));
  });
});
