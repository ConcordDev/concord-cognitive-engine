/**
 * Scene Studio delete: the list button says "Delete scene", sends the
 * list id, and the scene is gone once sceneList reloads.
 */

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
  id: 'scene-1',
  name: 'Harbor Walk',
  anchor: 'plane',
  objectCount: 2,
  behaviorCount: 1,
  audioCount: 0,
  version: 1,
  updatedAt: '2026-10-11T00:00:00.000Z',
};

describe('SceneStudio delete', () => {
  let scenes = [SCENE];

  beforeEach(() => {
    scenes = [SCENE];
    lensRun.mockReset();
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'sceneList') {
        return { data: { ok: true, result: { scenes, count: scenes.length }, error: null } };
      }
      if (action === 'sceneDelete') {
        scenes = [];
        return { data: { ok: true, result: { deleted: true, sceneId: 'scene-1' }, error: null } };
      }
      return { data: { ok: true, result: { targets: [], captures: [] }, error: null } };
    });
  });

  it('removes the scene after Delete scene reloads the list', async () => {
    render(<SceneStudio />);
    expect(await screen.findByText('Harbor Walk')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /delete scene/i }));
    await waitFor(() => expect(screen.queryByText('Harbor Walk')).toBeNull());
    expect(screen.getByText(/no ar scenes yet/i)).toBeTruthy();
    const del = lensRun.mock.calls.find((c) => c[1] === 'sceneDelete');
    expect(del?.[2]).toMatchObject({ sceneId: 'scene-1', id: 'scene-1' });
    const lists = lensRun.mock.calls.filter((c) => c[1] === 'sceneList');
    expect(lists.length).toBeGreaterThanOrEqual(2);
  });
});
